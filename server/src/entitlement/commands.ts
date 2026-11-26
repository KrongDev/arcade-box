import { getUser } from '../account/index.ts';
import { mutation } from '../admin/index.ts';
import { isProductId } from '../product/index.ts';
import type { Args, Command } from '../shared/cli/index.ts';
import type { Db, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { grant, revoke } from './service.ts';

/** `<userId> <상품ID>`. 사용자 ID 모양은 `mutation`이 `target`으로 본다 */
function userProduct(args: Args, line: string): { userId: string; productId: string } {
  if (args.positional.length !== 2) throw new RuleError(400, 'invalid_args', `이렇게 써 주세요: ${line}`);
  const [userId, productId] = args.positional;
  if (!isProductId(productId)) throw new RuleError(400, 'invalid_product_id', `상품 ID 모양이 아니에요: ${productId}`);
  return { userId, productId };
}

/** 운영자에게는 "로그인이 필요해요"(앱에 하는 말) 대신 없는 사용자라고 먼저 알려 준다 */
async function activeUser(tx: Tx, userId: string): Promise<void> {
  if ((await getUser(tx, userId))?.status !== 'active') throw new RuleError(404, 'not_found', '없는 사용자예요 (지워진 사용자도 여기에 들어요)');
}

const GRANT = 'grant <userId> <상품ID> --reason <까닭>';
const REVOKE = 'revoke <userId> <상품ID> --reason <까닭>';

export function commands(db: Db, actor: string): Command[] {
  return [
    {
      name: 'grant',
      usage: `${GRANT} [--yes]`,
      flags: ['reason', 'yes'],
      run: mutation(db, actor, {
        action: 'grant',
        describe: (args) => {
          const a = userProduct(args, GRANT);
          return `사용자 ${a.userId}에게 ${a.productId}을 줘요 (source grant)`;
        },
        target: (args) => {
          const a = userProduct(args, GRANT);
          return { userId: a.userId, ref: a.productId };
        },
        apply: async (tx, args, adminActionId) => {
          const a = userProduct(args, GRANT);
          await activeUser(tx, a.userId);
          return grant(tx, { userId: a.userId, productId: a.productId, source: 'grant', adminActionId });
        },
        report: (id) => `줬어요 (보유 #${id})`,
      }),
    },
    {
      name: 'revoke',
      usage: `${REVOKE} [--yes]`,
      flags: ['reason', 'yes'],
      run: mutation(db, actor, {
        action: 'revoke',
        describe: (args) => {
          const a = userProduct(args, REVOKE);
          return `사용자 ${a.userId}의 ${a.productId}을 회수해요 (장착하고 있으면 풀어요)`;
        },
        target: (args) => {
          const a = userProduct(args, REVOKE);
          return { userId: a.userId, ref: a.productId };
        },
        apply: async (tx, args) => {
          const a = userProduct(args, REVOKE);
          await activeUser(tx, a.userId);
          await revoke(tx, { userId: a.userId, productId: a.productId, reason: 'admin' });
        },
        report: () => '회수했어요',
      }),
    },
  ];
}
