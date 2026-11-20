import { BRICK_GAP, BRICK_H, BRICK_LEFT, BRICK_TOP, BRICK_W } from './rules.ts';

/**
 * 벽돌깨기 스테이지 — 벽돌 배치와 동전·아이템 벽돌 고르기.
 * 배치는 글자 그림이다: '.' 빈칸, 'n' 보통 벽돌(한 번), 't' 단단한 벽돌(두 번).
 * 배치를 한 바퀴 다 돌면 처음부터 다시 돌고, 바퀴마다 보통 벽돌 일부가 단단해진다.
 */

export type PowerKind = 'wide' | 'multi' | 'slow';
export type BrickKind = 'normal' | 'tough';
/** 깨면 떨어지는 것: 동전, 아이템, 없음 */
export type Special = 'coin' | PowerKind | null;

export interface Brick {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BrickKind;
  /** 남은 맞힘 수 */
  hp: number;
  special: Special;
}

export interface StageOptions {
  /** 장착 능력: 동전 벽돌이 이 비율만큼 더 많이 나온다 */
  coinSpawn: number;
}

export const LAYOUTS: readonly (readonly string[])[] = [
  // 1. 줄 맞춰 쌓은 벽
  ['nnnnnnnnnn', 'nnnnnnnnnn', 'nnnnnnnnnn', 'nnnnnnnnnn'],
  // 2. 피라미드
  ['....tt....', '...nnnn...', '..nnnnnn..', '.nnnnnnnn.', 'nnnnnnnnnn'],
  // 3. 바둑판
  ['t.t.t.t.t.', '.n.n.n.n.n', 'n.n.n.n.n.', '.t.t.t.t.t', 'n.n.n.n.n.', '.n.n.n.n.n'],
  // 4. 다이아몬드
  ['....nn....', '...nttn...', '..nnttnn..', '.nnnnnnnn.', '..nnttnn..', '...nttn...', '....nn....'],
  // 5. 기둥 셋
  ['tt..tt..tt', 'nn..nn..nn', 'nn..nn..nn', 'nn..nn..nn', 'nnnnnnnnnn'],
  // 6. 물결
  ['n........n', 'nn......nn', '.nn....nn.', '..nn..nn..', '...nnnn...', 't..t..t..t'],
  // 7. 액자
  ['tttttttttt', 't........t', 't.nnnnnn.t', 't.nnnnnn.t', 't........t', 'tttttttttt'],
  // 8. 줄무늬
  ['tttttttttt', 'nnnnnnnnnn', '..........', 'tttttttttt', 'nnnnnnnnnn', 'nnnnnnnnnn'],
];

/** 보통 벽돌 중 동전 벽돌이 되는 기본 비율 */
const COIN_RATE = 0.08;
const POWERS: readonly PowerKind[] = ['wide', 'multi', 'slow'];

/** 스테이지 번호(1부터)의 벽돌을 만든다. 같은 난수면 같은 결과가 나온다 */
export function buildStage(stage: number, rng: () => number, opts: StageOptions): Brick[] {
  const index = (stage - 1) % LAYOUTS.length;
  const lap = Math.floor((stage - 1) / LAYOUTS.length);
  const toughRate = Math.min(0.5, 0.15 * lap);

  const bricks: Brick[] = [];
  let id = 1;
  LAYOUTS[index].forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '.') return;
      const tough = ch === 't' || rng() < toughRate;
      bricks.push({
        id: id++,
        row,
        col,
        x: BRICK_LEFT + col * (BRICK_W + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
        w: BRICK_W,
        h: BRICK_H,
        kind: tough ? 'tough' : 'normal',
        hp: tough ? 2 : 1,
        special: null,
      });
    });
  });

  // 특수 벽돌은 보통 벽돌에만 붙인다: 아이템 먼저, 남은 자리에 동전
  const plain = shuffle(
    bricks.filter((b) => b.kind === 'normal'),
    rng,
  );
  const powerCount = Math.min(4, 2 + Math.floor((stage - 1) / 2), plain.length);
  for (let i = 0; i < powerCount; i++) plain[i].special = POWERS[Math.floor(rng() * POWERS.length)];
  const rest = plain.slice(powerCount);
  // 기댓값의 소수 부분은 확률로 올린다 — 작은 능력(+10%)도 평균적으로 동전 벽돌을 늘린다
  const expected = rest.length * COIN_RATE * (1 + opts.coinSpawn);
  const rounded = Math.floor(expected) + (rng() < expected - Math.floor(expected) ? 1 : 0);
  const coinCount = Math.min(rest.length, Math.max(1, rounded));
  for (let i = 0; i < coinCount; i++) rest[i].special = 'coin';
  return bricks;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
