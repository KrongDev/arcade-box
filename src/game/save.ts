import { platform } from '../platform';
import { newlyUnlocked } from './progression';
import { GAMES, type GameId } from './registry';

/**
 * 기기에만 저장되는 진행 데이터. 게임별·항목별로 나눠 두어 v2에서 서버로
 * 그대로 옮길 수 있게 한다.
 */
export interface SaveData {
  version: 1;
  /** 게임별 코인 — 코인은 같은 게임의 아이템에만 쓴다 */
  coins: Partial<Record<GameId, number>>;
  /** 게임별 최고 점수 */
  best: Partial<Record<GameId, number>>;
  /** 열린 게임 */
  unlocked: GameId[];
  /** 마지막 출석 보상 날짜 (YYYY-MM-DD, 기기 시간 기준) */
  lastAttendance: string | null;
  /** 깬 단계 (예: minesweeper.easy) — 게임 안 난이도 잠금 해제에 쓴다 */
  cleared: string[];
  /** 단계별 최단 클리어 시간(초) */
  bestTime: Partial<Record<string, number>>;
  /** 지뢰찾기 난이도별 최고 점수 (순위표 값) */
  bestScore: Partial<Record<string, number>>;
  /** 코인으로 산 아이템 ID (기본 아이템은 따로 저장하지 않는다). 유료 아이템은 구매 내역으로 복원한다 */
  owned: string[];
  /** 슬롯별 장착 아이템 ID (예: { 'pinball.table': 'pinball.table.sunset' }) */
  equipped: Partial<Record<string, string>>;
  settings: Settings;
  /** 유료 아이템 지급 기록 — 주문번호 기준이라 같은 주문을 두 번 지급하지 않는다 */
  paidOrders: Partial<Record<string, PaidOrderRecord>>;
  /** 오늘 받은 광고 보상 횟수 (기기 시간 기준 날짜) */
  adRewards: { date: string | null; count: number };
  /**
   * 게임용 사용자 식별키(hash). 미니앱 안에서 같은 사용자면 앱을 지우거나 기기를 바꿔도 같은 값이다.
   * v2에서 서버로 데이터를 옮길 때 사용자를 잇는 키로 쓴다. 받지 못했으면 null
   */
  userKey: string | null;
}

export interface PaidOrderRecord {
  itemId: string;
  refunded: boolean;
}

export interface Settings {
  sound: boolean;
  haptic: boolean;
}

/** 사용자 식별키를 받기 전에 쓰던 저장 키. 처음 확인된 사용자의 저장 데이터로 옮긴다 */
const LEGACY_KEY = 'arcade-box.save.v1';
/** 마지막으로 확인한 사용자 식별키 — 식별키를 잠시 못 받을 때 같은 저장 데이터를 열기 위해 둔다 */
const LAST_USER_KEY = 'arcade-box.lastUser';

function saveKeyFor(userKey: string | null): string {
  return userKey ? `${LEGACY_KEY}.${userKey}` : LEGACY_KEY;
}

/** 이 사용자의 기기 저장 데이터를 지운다 (내 기록 지우기). 식별키 전 데이터도 함께 지운다 */
export async function eraseLocalSave(userKey: string | null): Promise<void> {
  await removeRaw(saveKeyFor(userKey));
  await removeRaw(LEGACY_KEY);
}

export function createDefaultSave(): SaveData {
  return {
    version: 1,
    coins: {},
    best: {},
    unlocked: GAMES.filter((g) => g.unlock === null).map((g) => g.id),
    lastAttendance: null,
    cleared: [],
    bestTime: {},
    bestScore: {},
    owned: [],
    equipped: {},
    settings: { sound: true, haptic: true },
    paidOrders: {},
    adRewards: { date: null, count: 0 },
    userKey: null,
  };
}

/** 기기 저장소 (플랫폼 저장소가 실패를 삼킨다 — 저장 실패는 플레이를 막지 않는다) */
const readRaw = (key: string): Promise<string | null> => platform.storage.getItem(key);
const writeRaw = (key: string, value: string): Promise<void> => platform.storage.setItem(key, value);
const removeRaw = (key: string): Promise<void> => platform.storage.removeItem(key);

/**
 * 게임용 사용자 식별키를 받는다. 받지 못하면(구버전 앱·일시 오류) 마지막으로 확인한 값을 쓰고,
 * 그것도 없으면 null. 게임 시작을 오래 막지 않도록 3초까지만 기다린다.
 */
export async function resolveUserKey(): Promise<string | null> {
  const fetched = await platform.userKey();
  if (fetched) {
    void writeRaw(LAST_USER_KEY, fetched);
    return fetched;
  }
  return readRaw(LAST_USER_KEY);
}

export async function loadSave(userKey: string | null): Promise<SaveData> {
  const base: SaveData = { ...createDefaultSave(), userKey };
  let raw = await readRaw(saveKeyFor(userKey));
  // 식별키를 쓰기 전에 저장된 데이터는 처음 확인된 사용자에게 옮긴다
  if (!raw && userKey) {
    raw = await readRaw(LEGACY_KEY);
    if (raw) {
      await writeRaw(saveKeyFor(userKey), raw);
      void removeRaw(LEGACY_KEY);
    }
  }
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const loaded: SaveData = {
      version: 1,
      coins: { ...parsed.coins },
      best: { ...parsed.best },
      unlocked: Array.from(new Set([...base.unlocked, ...(parsed.unlocked ?? [])])),
      lastAttendance: parsed.lastAttendance ?? null,
      cleared: Array.from(new Set(parsed.cleared ?? [])),
      bestTime: { ...parsed.bestTime },
      bestScore: { ...parsed.bestScore },
      owned: Array.from(new Set(parsed.owned ?? [])),
      equipped: { ...parsed.equipped },
      settings: { ...base.settings, ...parsed.settings },
      paidOrders: { ...parsed.paidOrders },
      adRewards: { ...base.adRewards, ...parsed.adRewards },
      userKey,
    };
    // 잠금 조건이 새로 생긴 게임(예: 벽돌깨기)은 이미 조건을 채운 저장 데이터면 바로 연다
    return { ...loaded, unlocked: [...loaded.unlocked, ...newlyUnlocked(loaded)] };
  } catch {
    return base;
  }
}

export function persistSave(save: SaveData): void {
  void writeRaw(saveKeyFor(save.userKey), JSON.stringify(save));
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
