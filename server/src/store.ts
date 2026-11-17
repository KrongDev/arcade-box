import type { UserState } from './domain.ts';

export interface RecordWrite {
  board: string;
  /** 이 사용자의 새 최고 기록 */
  value: number;
}

export interface RunLog {
  board: string;
  value: number | null;
  coins: number;
}

export interface Mutation<T> {
  state: UserState;
  records?: RecordWrite[];
  run?: RunLog;
  result: T;
}

export interface LeaderboardRow {
  userId: string;
  value: number;
  rank: number;
}

export interface Store {
  /** 익명 식별키로 사용자를 찾거나 만든다 */
  upsertUser(anonKey: string): Promise<string>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** 만료되지 않은 세션의 사용자. 없으면 null */
  sessionUser(tokenHash: string, now: Date): Promise<string | null>;
  readState(userId: string): Promise<UserState>;
  /**
   * 사용자 상태를 잠그고 읽어 fn으로 바꾼 뒤 한 트랜잭션으로 저장한다.
   * fn이 던지면 아무것도 저장하지 않는다.
   */
  mutate<T>(userId: string, fn: (state: UserState) => Mutation<T>): Promise<T>;
  top(board: string, order: 'higher' | 'lower', limit: number): Promise<LeaderboardRow[]>;
  rankOf(board: string, order: 'higher' | 'lower', userId: string): Promise<LeaderboardRow | null>;
  close(): Promise<void>;
}
