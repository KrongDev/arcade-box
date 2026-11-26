import { getUser } from '../account/index.ts';
import { mutation } from '../admin/index.ts';
import type { Args, Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { MAX_BALANCE } from './rules.ts';
import { applyCoins, getBalance, verifyWallets } from './service.ts';

const noSuchUser = () => new RuleError(404, 'not_found', '없는 사용자예요 (지워진 사용자도 여기에 들어요)');

/**
 * `coins adjust <userId> <증감>`의 인자. 증감은 부호가 붙을 수 있는 숫자 글이어야 한다 (`500`, `+500`, `-300`).
 * `1.5`, `1e3`, `0`과 상한보다 큰 값은 받지 않는다. 사용자 ID의 모양은 `mutation`이 `target`으로 본다.
 */
function adjustArgs(args: Args): { userId: string; delta: number } {
  if (args.positional.length !== 2) throw new RuleError(400, 'invalid_args', '이렇게 써 주세요: coins adjust <userId> <증감> --reason <까닭>');
  const [userId, text] = args.positional;
  const delta = Number(text);
  if (!/^[+-]?[0-9]{1,16}$/.test(text) || delta === 0 || Math.abs(delta) > MAX_BALANCE) {
    throw new RuleError(400, 'invalid_delta', `증감은 0이 아닌 정수여야 해요 (예: 500, -300. 크기는 ${MAX_BALANCE.toLocaleString('en-US')}까지)`);
  }
  return { userId, delta };
}

const signed = (delta: number) => (delta > 0 ? `+${delta}` : String(delta));

export function commands(db: Db, actor: string): Command[] {
  return [
    {
      name: 'coins adjust',
      usage: 'coins adjust <userId> <증감> --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'coins.adjust',
        describe: (args) => {
          const { userId, delta } = adjustArgs(args);
          return delta > 0 ? `사용자 ${userId}에게 코인 ${delta}개를 줘요 (grant)` : `사용자 ${userId}의 코인 ${-delta}개를 빼요 (adjust)`;
        },
        target: (args) => ({ userId: adjustArgs(args).userId }),
        apply: async (tx, args, adminActionId) => {
          const { userId, delta } = adjustArgs(args);
          // applyCoins도 없는 사용자를 거절하지만 그 말("로그인이 필요해요")은 앱에 하는 말이라, 운영자에게는 먼저 알려 준다
          if ((await getUser(tx, userId))?.status !== 'active') throw noSuchUser();
          try {
            // 양수는 운영자 지급(grant), 음수는 운영자 조정(adjust)으로 적는다
            const result = await applyCoins(tx, { userId, delta, reason: delta > 0 ? 'grant' : 'adjust', adminActionId });
            return { delta, before: result.balance - delta, balance: result.balance };
          } catch (err) {
            if (err instanceof RuleError && err.code === 'insufficient_coins') {
              // 지갑이 아직 잠겨 있어서 이 잔액이 거절한 그 잔액이다
              throw new RuleError(409, 'insufficient_coins', `잔액이 ${await getBalance(tx, userId)}코인이라 ${-delta}코인을 뺄 수 없어요. 아무것도 바뀌지 않았어요`);
            }
            if (err instanceof RuleError && err.code === 'unauthorized') throw noSuchUser();
            throw err;
          }
        },
        report: (r) => `코인 ${signed(r.delta)}: 잔액 ${r.before} → ${r.balance}`,
      }),
    },
    {
      // 읽기만 한다: 까닭도 확인도 받지 않고 운영 기록도 남기지 않는다. 어긋난 것을 고치지 않는다
      name: 'wallet verify',
      usage: 'wallet verify [userId]',
      run: async (args, io) => {
        if (args.positional.length > 1) throw new RuleError(400, 'invalid_args', '이렇게 써 주세요: wallet verify [userId]');
        const userId = args.positional[0];
        // 사용자 ID 모양이 아닌 값은 쿼리에 넣지 않는다 (getUser가 모양을 본다)
        if (userId !== undefined && !(await getUser(db, userId))) throw new RuleError(404, 'not_found', '없는 사용자예요');
        const mismatched = await verifyWallets(db, userId);
        if (mismatched.length === 0) {
          io.out('어긋난 지갑이 없어요');
          return;
        }
        for (const m of mismatched) {
          io.out(`${m.userId}  잔액 ${m.balance} · 기록의 합 ${m.ledgerSum} · 마지막 balance_after ${m.lastBalanceAfter ?? '없음'}`);
        }
        // 점검에 걸렸으면 0이 아닌 값으로 끝낸다 (스크립트가 알아챌 수 있게)
        throw new RuleError(409, 'wallet_mismatch', `어긋난 지갑이 ${mismatched.length}개 있어요`);
      },
    },
  ];
}
