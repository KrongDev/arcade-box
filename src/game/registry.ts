/**
 * 게임 목록 설정 — 새 게임은 여기에 한 줄 추가하고 화면을 끼워 넣는다.
 * 잠금 조건·코인 종류·홈 카드 표시는 전부 이 목록을 기준으로 한다.
 */

export type GameId = 'pinball' | 'minesweeper';

export interface UnlockRule {
  /** 이 게임의 최고 점수가 */
  gameId: GameId;
  /** 이 점수 이상이면 열린다 */
  score: number;
}

export interface GameDef {
  id: GameId;
  name: string;
  emoji: string;
  description: string;
  /** null이면 처음부터 열려 있다 */
  unlock: UnlockRule | null;
  /** 화면이 아직 없으면 false — 열려도 "준비 중"으로 보인다 */
  playable: boolean;
}

export const GAMES: GameDef[] = [
  {
    id: 'pinball',
    name: '핀볼',
    emoji: '🕹️',
    description: '플리퍼로 공을 튕겨 점수를 모아요',
    unlock: null,
    playable: true,
  },
  {
    id: 'minesweeper',
    name: '지뢰찾기',
    emoji: '💣',
    description: '숫자를 보고 지뢰를 피해 칸을 열어요',
    // 커트라인 값은 밸런싱 단계에서 확정한다 (PRD 4번 확인 필요)
    unlock: { gameId: 'pinball', score: 30000 },
    playable: true,
  },
];

export function getGame(id: GameId): GameDef {
  const game = GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`unknown game: ${id}`);
  return game;
}

/** 출석 보상 코인 (하루 1회, 0시 기준) */
export const ATTENDANCE_COINS = 50;

/** 보상형 광고 1회 시청 보상 코인과 하루 최대 횟수(전 게임 합산, 0시 기준) */
export const AD_REWARD_COINS = 50;
export const AD_REWARDS_PER_DAY = 3;
