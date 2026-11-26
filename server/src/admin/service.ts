import type { Args, Command } from '../shared/cli/index.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { insertAction, readConfig, writeConfig } from './repo.ts';

// ── 운영 기록 ────────────────────────────────────────────────

/** 운영 기록 한 줄을 남기고 그 번호를 돌려준다. 바꾸는 일과 같은 트랜잭션에서 부른다 */
export async function audit(
  tx: Tx,
  a: { actor: string; action: string; targetUserId?: string; targetRef?: string; params: unknown; reason: string },
): Promise<number> {
  if (a.reason.trim() === '') throw new RuleError(400, 'reason_required', '--reason으로 까닭을 적어 주세요');
  if (a.actor.trim() === '') throw new RuleError(400, 'actor_required', '누가 실행하는지 알 수 없어요 (ADMIN_ACTOR)');
  return insertAction(tx, {
    actor: a.actor,
    action: a.action,
    targetUserId: a.targetUserId ?? null,
    targetRef: a.targetRef ?? null,
    params: a.params ?? {},
    reason: a.reason,
  });
}

// ── 설정값 ──────────────────────────────────────────────────

export type ConfigKey = 'attendance_coins' | 'ad_reward_coins' | 'ad_rewards_per_day';

/** 처음 값은 v1과 같다: 출석 50코인, 광고 보상 50코인, 하루 3번 */
export const CONFIG_DEFAULTS: Record<ConfigKey, number> = { attendance_coins: 50, ad_reward_coins: 50, ad_rewards_per_day: 3 };

const CONFIG_MAX = 100_000;

export function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(CONFIG_DEFAULTS, key);
}

function checkKey(key: string): asserts key is ConfigKey {
  if (!isConfigKey(key)) {
    throw new RuleError(400, 'unknown_config', `모르는 설정이에요: ${key}. 쓸 수 있는 이름은 ${Object.keys(CONFIG_DEFAULTS).join(', ')}이에요`);
  }
}

function isConfigValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= CONFIG_MAX;
}

export async function getNumber(q: Q, key: ConfigKey): Promise<number> {
  checkKey(key);
  const stored = await readConfig(q, key);
  // 행이 없으면 기본값. 손으로 넣은 엉뚱한 값도 기본값으로 본다
  return isConfigValue(stored) ? stored : CONFIG_DEFAULTS[key];
}

/** 0~100,000의 정수만 받는다 */
export async function setNumber(tx: Tx, key: ConfigKey, value: number): Promise<void> {
  checkKey(key);
  if (!isConfigValue(value)) throw new RuleError(400, 'invalid_value', '설정값은 0~100,000의 정수여야 해요');
  await writeConfig(tx, key, value);
}

// ── 바꾸는 명령의 틀 ────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 무언가를 바꾸는 운영 명령은 모두 이 틀을 거친다 (스펙 5.11, 5.15).
 * `--reason`이 꼭 있어야 하고, 요약을 보여 준 뒤 확인을 받고(`--yes`면 건너뜀),
 * 한 트랜잭션 안에서 운영 기록을 남기고(`audit`) 바꾼다(`apply`). `apply`가 던지면 운영 기록도 남지 않는다.
 *
 * - `describe`: 무엇을 바꿀지 한 줄 요약. 인자가 틀렸으면 여기서 `RuleError`를 던진다 (확인을 묻기 전이다)
 * - `target`: 이 일이 가리키는 사용자나 대상 (운영 기록의 target_user_id, target_ref)
 * - `apply`: 바꾸는 일. 받은 `adminActionId`를 코인 기록·보유 같은 곳에 남길 수 있다
 * - `report`: 끝난 뒤 보여 줄 한 줄
 */
export function mutation<T>(
  db: Db,
  actor: string,
  spec: {
    action: string;
    describe(args: Args): string;
    target?(args: Args): { userId?: string; ref?: string };
    apply(tx: Tx, args: Args, adminActionId: number): Promise<T>;
    report?(result: T): string;
  },
): Command['run'] {
  return async (args, io) => {
    const reason = args.flags.reason;
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new RuleError(400, 'reason_required', '바꾸는 명령에는 --reason으로 까닭을 적어 주세요 (까닭이 --로 시작하면 --reason=… 으로 적어요)');
    }
    const summary = spec.describe(args);
    const target = spec.target?.(args) ?? {};
    if (target.userId !== undefined && !UUID.test(target.userId)) {
      throw new RuleError(400, 'invalid_user_id', `사용자 ID 모양이 아니에요: ${target.userId}`);
    }

    io.out(`[${spec.action}] ${summary}`);
    io.out(`까닭: ${reason} · 실행하는 사람: ${actor}`);
    if (args.flags.yes !== true && !(await io.confirm('이대로 실행할까요?'))) {
      throw new RuleError(409, 'canceled', '그만뒀어요. 아무것도 바뀌지 않았어요');
    }

    // 까닭은 따로 열에 들어가고 --yes는 뜻이 없으니 params에서 뺀다
    const { reason: _reason, yes: _yes, ...flags } = args.flags;
    const done = await db.transaction(async (tx) => {
      const id = await audit(tx, { actor, action: spec.action, targetUserId: target.userId, targetRef: target.ref, params: { positional: args.positional, flags }, reason });
      return { id, result: await spec.apply(tx, args, id) };
    });
    io.out(spec.report ? spec.report(done.result) : '끝났어요');
    io.out(`운영 기록 #${done.id}`);
  };
}
