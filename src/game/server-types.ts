/**
 * 게임 서버와 주고받는 값의 모양. 런타임 의존이 없는 순수 타입이라 동기화 엔진(sync.ts)과
 * 테스트가 서버 클라이언트(api.ts) 없이 쓸 수 있다.
 */

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

/** 한 판 점수로 순위를 매기는 게임 */
export type ScoreGameId = 'pinball' | 'breakout';

export type RunReport =
  /** 점수 게임(순위표가 하나): 게임 ID가 곧 순위표 ID다 */
  | { board: ScoreGameId; score: number; coins: number }
  | {
      board: string;
      won: boolean;
      seconds: number;
      /** 연 칸 수, 맞은 깃발, 틀린 깃발 — 점수는 서버가 이 값으로 계산한다 */
      opened: number;
      correctFlags: number;
      wrongFlags: number;
      /** 지뢰 보호를 쓴 횟수 — 쓰면 서버가 점수를 깎는다 */
      shields?: number;
      coins: number;
    };
