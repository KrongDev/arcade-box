import { and, eq, sql } from 'drizzle-orm';
import { getNumber } from '../admin/index.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { kstDate } from '../shared/time.ts';
import { applyCoins, lockWallet } from '../wallet/index.ts';
import { rewardClaims, type RewardKind } from './schema.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 거절하는 말은 v1과 같다 (표 K13, K14)
const alreadyClaimed = () => new RuleError(409, 'already_claimed', '오늘 출석 보상을 이미 받았어요');
const dailyLimit = () => new RuleError(429, 'daily_limit', '오늘 받을 수 있는 광고 보상을 다 받았어요');
const limitReached = (kind: RewardKind) => (kind === 'attendance' ? alreadyClaimed() : dailyLimit());

/** 그날 그 종류로 받은 횟수와 가장 큰 `seq`. 받은 적이 없으면 둘 다 0 */
async function claimedOn(q: Q, userId: string, kind: RewardKind, day: string): Promise<{ used: number; lastSeq: number }> {
  const [row] = await q
    .select({ used: sql<number>`count(*)::int`, lastSeq: sql<number>`coalesce(max(${rewardClaims.seq}), 0)::int` })
    .from(rewardClaims)
    .where(and(eq(rewardClaims.userId, userId), eq(rewardClaims.kind, kind), eq(rewardClaims.claimDate, day)));
  return { used: row?.used ?? 0, lastSeq: row?.lastSeq ?? 0 };
}

/** 하루에 받을 수 있는 횟수: 출석은 한 번, 광고 보상은 설정값(`ad_rewards_per_day`) */
async function limitOf(q: Q, kind: RewardKind): Promise<number> {
  return kind === 'attendance' ? 1 : getNumber(q, 'ad_rewards_per_day');
}

/**
 * 보상 하나를 받는다: 하루 한도 확인 → 코인 반영 → 받은 것으로 적기를 한 트랜잭션으로.
 * 코인 반영이 실패하면(지갑 상한) 받은 것으로 적지 않아서 그날의 몫이 남는다.
 *
 * **같은 사용자의 보상 요청은 차례로 처리된다.** 한도를 세기 전에 사용자 행 → 지갑 행을 잡아서(`lockWallet`),
 * 동시에 온 요청은 앞의 것이 끝난 뒤에 그날 받은 횟수를 센다. 그래서 광고 보상이 두 번 남았을 때 동시에 온 두 요청은
 * 둘 다 받고(같은 `seq`를 넣으려다 하나가 한도 오류를 받는 일이 없다), 10번을 동시에 보내도 정확히 한도만큼만 받는다.
 * 잠그는 순서는 판 결과·구매와 같다: 사용자 → 지갑 → 그 밖. 지갑을 잡으므로 코인이 0인 보상도 같은 줄에 선다.
 *
 * 하루 한도의 마지막 방어선은 `UNIQUE(user_id, kind, claim_date, seq)`다. 그래도 같은 줄을 넣게 되면
 * (손으로 고친 자료 등) 오류(500)가 아니라 한도 오류로 답하고, 방금 반영한 코인은 함께 되돌아간다.
 *
 * 날짜는 요청을 받은 시각(`now`)의 한국 날짜다: 23:59:59와 00:00:00은 다른 날이다.
 * 코인과 횟수는 운영자가 조정하는 설정값이고 받는 곳은 통일 지갑이다 (표 D3). 코인이 0이면 `applyCoins`가 0을 받지 않으므로
 * 코인 기록 없이(`ledger_id` null) 받은 것으로만 적는다.
 */
async function claim(db: Db, userId: string, now: Date, kind: RewardKind): Promise<{ coins: number; balance: number; left: number }> {
  return db.transaction(async (tx: Tx) => {
    let balance = await lockWallet(tx, userId, now);
    const day = kstDate(now);
    const limit = await limitOf(tx, kind);
    const { used, lastSeq } = await claimedOn(tx, userId, kind, day);
    if (used >= limit) throw limitReached(kind);

    const coins = await getNumber(tx, kind === 'attendance' ? 'attendance_coins' : 'ad_reward_coins');
    let ledgerId: number | null = null;
    if (coins > 0) {
      const paid = await applyCoins(tx, { userId, delta: coins, reason: kind, now });
      ledgerId = paid.ledgerId;
      balance = paid.balance;
    }
    const created = await tx
      .insert(rewardClaims)
      .values({ userId, kind, claimDate: day, seq: lastSeq + 1, ledgerId, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: rewardClaims.id });
    if (created.length === 0) throw limitReached(kind);
    return { coins, balance, left: limit - used - 1 };
  });
}

/**
 * 출석 보상 (스펙 5.9 `POST /v2/me/attendance`, 표 K13): 한국 날짜로 하루 한 번. 그날 이미 받았으면 `409 already_claimed`.
 * 받은 코인(설정값 `attendance_coins`)과 받은 뒤의 잔액을 준다. 지워진 사용자면 `401 unauthorized`.
 */
export async function claimAttendance(db: Db, userId: string, now: Date): Promise<{ coins: number; balance: number }> {
  const { coins, balance } = await claim(db, userId, now, 'attendance');
  return { coins, balance };
}

/**
 * 광고 보상 (스펙 5.9 `POST /v2/me/ad-reward`, 표 K14): 한국 날짜로 하루 `ad_rewards_per_day`번. 다 받았으면 `429 daily_limit`.
 * 받은 코인(설정값 `ad_reward_coins`), 받은 뒤의 잔액, 오늘 남은 횟수를 준다.
 *
 * 서버는 광고를 봤는지 확인할 수 없어서(앱의 시청 완료 이벤트가 기준) 하루 횟수만 서버 시간으로 막는다 (v1과 같다).
 */
export async function claimAdReward(db: Db, userId: string, now: Date): Promise<{ coins: number; balance: number; left: number }> {
  return claim(db, userId, now, 'ad_reward');
}

/** 오늘(한국 날짜) 출석을 받았는지와 남은 광고 보상 횟수 (`/v2/me`의 `rewards`). 읽기만 한다 */
export async function rewardStatus(q: Q, userId: string, now: Date): Promise<{ attendanceClaimedToday: boolean; adRewardsLeft: number }> {
  const limit = await limitOf(q, 'ad_reward');
  if (!UUID.test(userId)) return { attendanceClaimedToday: false, adRewardsLeft: limit };
  const day = kstDate(now);
  const attendance = await claimedOn(q, userId, 'attendance', day);
  const ads = await claimedOn(q, userId, 'ad_reward', day);
  return { attendanceClaimedToday: attendance.used > 0, adRewardsLeft: Math.max(0, limit - ads.used) };
}

/**
 * 이 사용자의 보상을 지운다 (계정 삭제, 스펙 5.4). 보상이 코인 기록을 가리키므로(`reward_claims.ledger_id`)
 * 지갑의 `purgeUser`보다 먼저 불려야 한다 (삭제 순서: order → reward → play → entitlement → wallet).
 */
export async function purgeUser(tx: Tx, userId: string): Promise<void> {
  await tx.delete(rewardClaims).where(eq(rewardClaims.userId, userId));
}
