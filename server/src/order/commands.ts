import { mutation } from '../admin/index.ts';
import type { Args, Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import type { Clock } from '../shared/time.ts';
import { checkRefundable, countExpiredOrders, getOrder, purgeExpiredIn, recentOrders, refundCoinOrder, retentionCutoff, RETENTION_YEARS, type OrderRecord } from './service.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const usage = (line: string) => new RuleError(400, 'invalid_args', `이렇게 써 주세요: ${line}`);
const noOrder = () => new RuleError(404, 'not_found', '없는 주문이에요');

const LIST = 'order list [--user <userId>] [--limit <1~100>]';
const SHOW = 'order show <주문ID>';
const REFUND = 'order refund <주문ID> --reason <까닭>';
const PURGE = 'orders purge-expired --reason <까닭>';

const LIST_DEFAULT = 20;

/** 자리 인자 하나: 주문 ID */
function orderArg(args: Args, line: string): string {
  if (args.positional.length !== 1) throw usage(line);
  const [orderId] = args.positional;
  if (!UUID.test(orderId)) throw new RuleError(400, 'invalid_order_id', `주문 ID 모양이 아니에요: ${orderId}`);
  return orderId;
}

function listArgs(args: Args): { userId?: string; limit: number } {
  if (args.positional.length !== 0) throw usage(LIST);
  const user = args.flags.user;
  const limit = args.flags.limit;
  if (user === true || limit === true) throw usage(LIST);
  if (user !== undefined && !UUID.test(user)) throw new RuleError(400, 'invalid_user_id', `사용자 ID 모양이 아니에요: ${user}`);
  if (limit !== undefined && (!/^[0-9]{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) throw new RuleError(400, 'invalid_limit', '--limit은 1~100의 정수로 적어 주세요');
  return { ...(user === undefined ? {} : { userId: user }), limit: limit === undefined ? LIST_DEFAULT : Number(limit) };
}

/** 주문 한 줄: 만든 때, 주문 ID, 상태, 결제 수단, 상품, 구매 당시 가격, 사용자 */
const line = (o: OrderRecord) => `${o.createdAt}  ${o.id}  ${o.status}  ${o.paymentMethod}  ${o.productId}  ${o.price.currency} ${o.price.amount}  ${o.userId}`;

/**
 * 주문 명령 (스펙 5.11). `order list`·`order show`는 읽기만 한다: 까닭도 확인도 받지 않고 운영 기록도 남기지 않는다.
 * `order refund`·`orders purge-expired`는 바꾸는 명령이라 `mutation` 틀을 거친다 (`--reason` 필수, 요약 확인, `admin_actions`).
 * 영수증 원문과 스토어 구매 토큰은 어느 명령도 보여 주지 않는다.
 *
 * `now`는 환불한 시각과 보관 기간의 기준 시각을 재는 시계다. 없으면 진짜 시계다.
 */
export function commands(db: Db, actor: string, now: Clock = () => new Date()): Command[] {
  return [
    {
      name: 'order list',
      usage: LIST,
      run: async (args, io) => {
        const found = await recentOrders(db, listArgs(args));
        if (found.length === 0) {
          io.out('주문이 없어요');
          return;
        }
        for (const o of found) io.out(line(o));
      },
    },
    {
      name: 'order show',
      usage: SHOW,
      run: async (args, io) => {
        const o = await getOrder(db, orderArg(args, SHOW));
        if (!o) throw noOrder();
        io.out(`주문 ${o.id}`);
        io.out(`사용자 ${o.userId}`);
        // 이름·종류·가격은 구매 당시 값이다 (지금의 상품과 다를 수 있다)
        io.out(`상품 ${o.productId} · ${o.productName} (${o.productKind}) · ${o.price.currency} ${o.price.amount}`);
        io.out(`결제 ${o.paymentMethod} · 상태 ${o.status} · 보유 ${o.entitlementId === null ? '없음' : `#${o.entitlementId}`}`);
        io.out(`만든 때 ${o.createdAt} · 결제가 끝난 때 ${o.completedAt ?? '-'} · 환불한 때 ${o.refundedAt ?? '-'}`);
        if (o.paymentMethod !== 'coin') io.out(`스토어 상품 코드 ${o.storeSku ?? '-'} · 스토어 주문 번호 ${o.storeOrderId ?? '-'} · 환경 ${o.storeEnvironment ?? '-'}`);
        io.out('사건:');
        for (const e of o.events) {
          const moved = e.toStatus === null ? '' : ` ${e.fromStatus ?? '(없음)'} → ${e.toStatus}`;
          const refs = [e.ledgerId === null ? '' : `코인 기록 #${e.ledgerId}`, e.adminActionId === null ? '' : `운영 기록 #${e.adminActionId}`, e.detail === null ? '' : JSON.stringify(e.detail)].filter(Boolean).join(' · ');
          io.out(`  #${e.id}  ${e.createdAt}  ${e.type}${moved}  (${e.actor})${refs ? `  ${refs}` : ''}`);
        }
      },
    },
    {
      // 환불할 수 없는 주문(없는 주문, 현금 주문, 이미 환불한 주문)은 확인을 묻기 전에 거절하려고 주문을 먼저 읽는다.
      // 읽은 주문으로 요약과 운영 기록의 대상(사용자, 주문)을 채운다. 환불 자체는 트랜잭션 안에서 주문을 잠그고 다시 확인한다
      name: 'order refund',
      usage: `${REFUND} [--yes]`,
      run: async (args, io) => {
        const order = await getOrder(db, orderArg(args, REFUND));
        if (!order) throw noOrder();
        checkRefundable(order);
        await mutation(db, actor, {
          action: 'order.refund',
          describe: () => `주문 ${order.id}을 환불해요: 사용자 ${order.userId}에게 ${order.price.amount}코인을 돌려주고 ${order.productId}(${order.productName})을 회수해요 (장착하고 있으면 풀어요)`,
          target: () => ({ userId: order.userId, ref: order.id }),
          apply: (tx, _args, adminActionId) => refundCoinOrder(tx, order.id, adminActionId, now()),
          report: () => `환불했어요 (${order.price.amount}코인을 돌려줬어요)`,
        })(args, io);
      },
    },
    {
      // 묻기 전에 지울 주문의 수와 기준 시각을 보여 주려고 먼저 센다. 지우는 일은 운영 기록과 한 트랜잭션이고 같은 시각으로 잰다
      name: 'orders purge-expired',
      usage: `${PURGE} [--yes]`,
      run: async (args, io) => {
        if (args.positional.length !== 0) throw usage(PURGE);
        const at = now();
        const expired = await countExpiredOrders(db, at);
        await mutation(db, actor, {
          action: 'orders.purge-expired',
          describe: () =>
            `결제가 끝나거나 환불된 지 ${RETENTION_YEARS}년이 지난 현금 주문 ${expired}개와 그 사건을 지워요 (${retentionCutoff(at).toISOString()}까지 끝난 것). ` +
            '그래서 주문이 하나도 남지 않는 지워진 계정의 사용자 행도 지워요. 되돌릴 수 없어요',
          apply: (tx) => purgeExpiredIn(tx, at),
          report: (r) => `주문 ${r.orders}개와 사용자 행 ${r.users}개를 지웠어요`,
        })(args, io);
      },
    },
  ];
}
