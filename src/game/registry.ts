/**
 * 게임 목록 — 새 게임은 여기에 한 줄 추가하고 화면을 끼워 넣는다.
 * 잠금 조건·순위표·홈 카드 표시는 전부 이 목록을 기준으로 한다.
 * 서버(server/src/domain.ts)의 게임 ID·잠금 조건·순위표 ID와 같은 값을 쓴다.
 */

export type GameId = 'pinball' | 'minesweeper' | 'breakout';

/** 게임이 열리는 조건 */
export type UnlockRule =
  /** 다른 게임 최고 점수가 score 이상이면 열린다 */
  | { kind: 'score'; gameId: GameId; score: number }
  /** 이 단계(순위표 ID)를 한 번이라도 깨면 열린다 */
  | { kind: 'clear'; stage: string };

/** 순위표 하나 — ID는 서버 순위표 ID와 같다 */
export interface BoardDef {
  id: string;
  label: string;
}

export interface GameDef {
  id: GameId;
  name: string;
  description: string;
  /** null이면 처음부터 열려 있다 */
  unlock: UnlockRule | null;
  /** 화면이 아직 없으면 false — 열려도 "준비 중"으로 보인다 */
  playable: boolean;
  /** 이 게임의 순위표 (쉬운 단계부터) */
  boards: BoardDef[];
  /** 순위표 위에 보여 줄 점수 매기는 법 (없으면 생략) */
  scoreNote?: string;
}

export const GAMES: GameDef[] = [
  {
    id: 'pinball',
    name: '핀볼',
    description: '플리퍼로 공을 튕겨 점수를 모아요',
    unlock: null,
    playable: true,
    boards: [{ id: 'pinball', label: '핀볼' }],
  },
  {
    id: 'minesweeper',
    name: '지뢰찾기',
    description: '숫자를 보고 지뢰를 피해 칸을 열어요',
    unlock: { kind: 'score', gameId: 'pinball', score: 30000 },
    playable: true,
    boards: [
      { id: 'minesweeper.easy', label: '지뢰찾기 초급' },
      { id: 'minesweeper.normal', label: '지뢰찾기 중급' },
      { id: 'minesweeper.hard', label: '지뢰찾기 고급' },
    ],
    scoreNote: '연 칸·맞힌 깃발·클리어·빠른 시간으로 매긴 점수예요',
  },
  {
    id: 'breakout',
    name: '벽돌깨기',
    description: '공을 튕겨 벽돌을 모두 깨요',
    unlock: { kind: 'clear', stage: 'minesweeper.normal' },
    playable: true,
    boards: [{ id: 'breakout', label: '벽돌깨기' }],
    scoreNote: '깬 벽돌·스테이지 보너스·연속 배수로 매긴 점수예요',
  },
];

export function getGame(id: GameId): GameDef {
  const game = GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`unknown game: ${id}`);
  return game;
}

/** 순위표(=단계) ID로 화면에 보일 이름을 찾는다 */
export function boardLabel(boardId: string): string {
  for (const g of GAMES) {
    const board = g.boards.find((b) => b.id === boardId);
    if (board) return board.label;
  }
  return boardId;
}

/** 출석 보상 코인 (하루 1회, 0시 기준) */
export const ATTENDANCE_COINS = 50;

/** 보상형 광고 1회 시청 보상 코인과 하루 최대 횟수(전 게임 합산, 0시 기준) */
export const AD_REWARD_COINS = 50;
export const AD_REWARDS_PER_DAY = 3;
