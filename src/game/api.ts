import { Storage, User } from '@apps-in-toss/web-framework';

/**
 * 게임 서버 클라이언트. 서버 주소(VITE_API_BASE)가 없으면 서버를 쓰지 않고 기기 저장만으로 동작한다.
 * 로그인: User.createAnonymousKeyAuthCode()로 받은 일회용 코드를 서버에 보내면, 서버가 파트너 API로
 * 교환해 세션 토큰을 준다. 식별키 자체는 서버로 보내지 않는다.
 */
export const API_BASE: string | null = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '') || null;

export interface ServerSnapshot {
  coins: Record<string, number>;
  best: Record<string, number>;
  bestTime: Record<string, number>;
  bestScore?: Record<string, number>;
  cleared: string[];
  unlocked: string[];
  owned: string[];
  equipped: Record<string, string>;
  settings: { sound: boolean; haptic: boolean };
  attendanceClaimedToday: boolean;
  adRewardsLeft: number;
  imported: boolean;
  serverDate: string;
}

export interface LeaderboardData {
  board: string;
  order: 'higher' | 'lower';
  entries: { rank: number; player: string; value: number; me: boolean }[];
  me: { rank: number; value: number } | null;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** 네트워크·서버 오류처럼 나중에 다시 보내면 되는 실패 */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.code === 'too_fast' || this.code === 'rate_limited';
  }
}

const TIMEOUT_MS = 8000;
let token: string | null = null;
let tokenKey: string | null = null;
let loginPromise: Promise<void> | null = null;

/** 사용자(기기 저장 데이터)가 정해지면 부른다 — 토큰을 사용자별로 따로 둔다 */
export async function initApi(userKey: string | null): Promise<void> {
  tokenKey = `arcade-box.session.${userKey ?? 'anon'}`;
  try {
    token = await Storage.getItem(tokenKey);
  } catch {
    token = null;
  }
}

async function saveToken(value: string | null) {
  token = value;
  if (!tokenKey) return;
  try {
    if (value) await Storage.setItem(tokenKey, value);
    else await Storage.removeItem(tokenKey);
  } catch {
    // 토큰을 못 저장하면 다음 실행 때 다시 로그인한다
  }
}

async function rawFetch(method: string, path: string, body?: unknown, withAuth = true): Promise<unknown> {
  if (!API_BASE) throw new ApiError(0, 'no_server', '서버가 설정되지 않았어요');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(withAuth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'network', '서버에 연결하지 못했어요');
  } finally {
    window.clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, d.error ?? `http_${res.status}`, d.message ?? '요청을 처리하지 못했어요');
  }
  return data;
}

/** 일회용 인증 코드로 로그인한다. 동시에 여러 번 불러도 한 번만 로그인한다 */
export function login(): Promise<void> {
  if (!loginPromise) {
    loginPromise = (async () => {
      let code: string;
      try {
        code = (await User.createAnonymousKeyAuthCode()).code;
      } catch {
        throw new ApiError(0, 'auth_code_unavailable', '토스 앱에서 로그인 코드를 받지 못했어요');
      }
      // 코드는 저장하지 않고 바로 서버로 보낸다 (5분 안에 한 번만 쓸 수 있다)
      const res = (await rawFetch('POST', '/v1/auth/exchange', { code }, false)) as { token: string };
      await saveToken(res.token);
    })().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

/** 인증이 필요한 요청. 토큰이 없거나 만료됐으면 한 번 다시 로그인한다 */
async function authed<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!token) await login();
  try {
    return (await rawFetch(method, path, body)) as T;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await saveToken(null);
      await login();
      return (await rawFetch(method, path, body)) as T;
    }
    throw err;
  }
}

export type RunReport =
  | { board: 'pinball'; score: number; coins: number }
  | {
      board: string;
      won: boolean;
      seconds: number;
      /** 연 칸 수, 맞은 깃발, 틀린 깃발 — 점수는 서버가 이 값으로 계산한다 */
      opened: number;
      correctFlags: number;
      wrongFlags: number;
      coins: number;
    };

export const api = {
  me: () => authed<ServerSnapshot>('GET', '/v1/me'),
  importSave: (save: unknown) => authed<ServerSnapshot>('POST', '/v1/me/import', { save }),
  attendance: (gameId: string) => authed<ServerSnapshot>('POST', '/v1/me/attendance', { gameId }),
  adReward: (gameId: string) => authed<ServerSnapshot>('POST', '/v1/me/ad-reward', { gameId }),
  run: (report: RunReport) => authed<ServerSnapshot>('POST', '/v1/me/runs', report),
  buy: (itemId: string) => authed<ServerSnapshot>('POST', `/v1/me/items/${encodeURIComponent(itemId)}/buy`),
  equip: (itemId: string) => authed<ServerSnapshot>('PUT', '/v1/me/equipped', { itemId }),
  settings: (patch: { sound?: boolean; haptic?: boolean }) => authed<ServerSnapshot>('PUT', '/v1/me/settings', patch),
  leaderboard: (board: string, limit = 20) =>
    authed<LeaderboardData>('GET', `/v1/leaderboards/${encodeURIComponent(board)}?limit=${limit}`),
};
