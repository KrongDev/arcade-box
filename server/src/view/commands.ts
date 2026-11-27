import { findUserByIdentity, getUser, listProviders, type AccountProvider } from '../account/index.ts';
import { listOwned } from '../entitlement/index.ts';
import { listOrders } from '../order/index.ts';
import type { Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { getBalance, listLedger } from '../wallet/index.ts';

const FIND = 'user find --provider <google|apple> --sub <sub>';
const SHOW = 'user show <userId>';
/** 최근 코인 기록과 주문을 몇 개씩 보여 주나 */
const RECENT = 10;

const ACCOUNT_PROVIDERS: readonly string[] = ['google', 'apple'] satisfies AccountProvider[];

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * 사용자를 찾고 들여다보는 명령 (스펙 5.11). 둘 다 읽기만 한다: `--reason`·`--yes`를 받지 않고(`flags`에 없어 `runCli`가 거절한다),
 * 묻지 않고, 운영 기록을 남기지 않는다.
 */
export function commands(db: Db): Command[] {
  return [
    {
      name: 'user find',
      usage: FIND,
      flags: ['provider', 'sub'],
      async run(args, io) {
        const { provider, sub } = args.flags;
        if (typeof provider !== 'string' || !ACCOUNT_PROVIDERS.includes(provider)) {
          throw new RuleError(400, 'invalid_provider', `수단은 google이나 apple이에요. 이렇게 써 주세요: ${FIND}`);
        }
        if (typeof sub !== 'string' || sub.length > 255) throw new RuleError(400, 'invalid_sub', `이렇게 써 주세요: ${FIND}`);
        const userId = await findUserByIdentity(db, provider as AccountProvider, sub);
        if (!userId) throw new RuleError(404, 'not_found', `그 ${provider} 계정에 연결된 사용자가 없어요`);
        io.out(userId);
      },
    },
    {
      name: 'user show',
      usage: SHOW,
      flags: [],
      async run(args, io) {
        if (args.positional.length !== 1) throw new RuleError(400, 'invalid_args', `이렇게 써 주세요: ${SHOW}`);
        // 사용자부터 확인한다. 모양이 틀린 ID를 다른 함수에 바로 넘기면 DB 오류가 난다 (getUser는 모양을 먼저 본다)
        const user = await getUser(db, args.positional[0]);
        if (!user) throw new RuleError(404, 'not_found', '없는 사용자예요');
        const providers = await listProviders(db, user.id);
        const owned = await listOwned(db, user.id);
        const ledger = await listLedger(db, user.id, { limit: RECENT });
        const orders = await listOrders(db, user.id, { limit: RECENT });

        io.out(`사용자 ${user.id} · ${user.status} · 만든 때 ${user.createdAt}`);
        io.out(`수단: ${providers.length > 0 ? providers.join(', ') : '없음'}`);
        io.out(`잔액: ${await getBalance(db, user.id)}`);
        io.out(`가진 상품: ${owned.length > 0 ? owned.join(', ') : '없음'}`);
        io.out(`최근 코인 기록 (${ledger.entries.length}개):`);
        for (const e of ledger.entries) io.out(`  #${e.id} ${e.createdAt} ${signed(e.delta)} ${e.reason} → ${e.balanceAfter}`);
        io.out(`최근 주문 (${orders.orders.length}개):`);
        for (const o of orders.orders) {
          io.out(`  ${o.id} ${o.createdAt} ${o.productId} ${o.price.currency} ${o.price.amount} ${o.status} (${o.paymentMethod})`);
        }
      },
    },
  ];
}
