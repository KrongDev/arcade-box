import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALLS_PER_GAME, BALL_SAVE_TIME, COIN_PICKUP_VALUE, LOWER_LANES_Y, MAX_COINS_PER_RUN, MAX_MULTIPLIER, MAX_SCORE, MILESTONES, POINTS, SAUCERS, TABLE_H } from '../../src/pinball/engine.ts';

const SAUCER = SAUCERS.lock;
import { clearBalls, engineWith, ofType, placeBall, run, runUntil } from './helpers.ts';

/**
 * 판을 바꿔도 남겨야 하는 규칙 — 레인 배율, 타깃 → 잠금 → 멀티볼, 잭팟, 공 살리기, 상한.
 * 장치 위치는 엔진에서 읽어 쓴다 (판 배치가 바뀌어도 규칙 테스트는 그대로 둔다).
 */

/** 레인 하나를 공으로 지나간다 */
function rollOver(e: ReturnType<typeof engineWith>, index: number) {
  clearBalls(e);
  placeBall(e, { x: e.lanes[index].x, y: e.lanes[index].y });
  return run(e, 1 / 120);
}

/** 드롭 타깃 하나를 옆에서 세게 맞힌다 */
function knockDown(e: ReturnType<typeof engineWith>, index: number) {
  const t = e.targets[index];
  clearBalls(e);
  placeBall(e, { x: t.x + 30, y: (t.y1 + t.y2) / 2, vx: -500 });
  return runUntil(e, 'target', 1);
}

/** 판 위의 공을 판 아래로 옮겨 잃는다 */
function loseBall(e: ReturnType<typeof engineWith>) {
  for (const b of e.balls) Object.assign(b, { x: 180, y: TABLE_H + 40, vx: 0, vy: 0 });
  return run(e, 1 / 60);
}

test('기본 점수와 판 규칙의 숫자는 정해진 값이다', () => {
  assert.deepEqual(
    { bumper: POINTS.bumper, sling: POINTS.sling, target: POINTS.target, bank: POINTS.bank, rollover: POINTS.rollover, lanes: POINTS.lanes, saucer: POINTS.saucer, jackpot: POINTS.jackpot, coin: POINTS.coin, comboPerHit: POINTS.comboPerHit },
    { bumper: 100, sling: 30, target: 500, bank: 5000, rollover: 300, lanes: 3000, saucer: 2000, jackpot: 20000, coin: 500, comboPerHit: 100 },
  );
  assert.deepEqual([BALLS_PER_GAME, MAX_MULTIPLIER, COIN_PICKUP_VALUE, MAX_COINS_PER_RUN, MAX_SCORE], [3, 5, 5, 400, 5_000_000]);
  assert.deepEqual(MILESTONES, [{ score: 10000, coins: 10 }, { score: 30000, coins: 20 }, { score: 50000, coins: 30 }]);
});

test('판 위에는 동전이 3개까지 놓인다 (예전 판과 같다)', () => {
  const e = engineWith();
  run(e, 40); // 공은 발사대에 있고 동전만 쌓인다
  assert.equal(e.coins.length, 3);
});

test('동전은 처음 1.5초 뒤에, 그다음부터 3.5초마다 하나씩 생긴다 (예전 판과 같다)', () => {
  const e = engineWith();
  run(e, 1.4);
  assert.equal(e.coins.length, 0);
  run(e, 0.2); // 1.6초
  assert.equal(e.coins.length, 1);
  run(e, 3.3); // 4.9초: 아직 하나
  assert.equal(e.coins.length, 1);
  run(e, 0.2); // 5.1초: 5.0초에 하나 더
  assert.equal(e.coins.length, 2);
  run(e, 3.5); // 8.6초: 8.5초에 하나 더
  assert.equal(e.coins.length, 3);
});

test('새 장치의 점수는 균형을 맞춘 값이다', () => {
  assert.deepEqual(
    { spinner: POINTS.spinner, standup: POINTS.standup, standupBank: POINTS.standupBank, bonusSmall: POINTS.bonusSmall, bonusBig: POINTS.bonusBig, ramp: POINTS.ramp, atticBumper: POINTS.atticBumper, kicker: POINTS.kicker, atticTarget: POINTS.atticTarget, atticHole: POINTS.atticHole, atticJackpot: POINTS.atticJackpot },
    { spinner: 250, standup: 500, standupBank: 3000, bonusSmall: 5000, bonusBig: 10000, ramp: 3000, atticBumper: 300, kicker: 50, atticTarget: 1500, atticHole: 3000, atticJackpot: 30000 },
  );
});

test('위쪽 레인을 다 켜면 배율이 오르고, 새 배율이 곱해진 보너스 3,000점을 받는다', () => {
  const e = engineWith();
  const events = e.lanes.flatMap((_, i) => rollOver(e, i));
  assert.equal(ofType(events, 'rollover').length, e.lanes.length);
  const [lanes] = ofType(events, 'lanes');
  assert.equal(e.multiplier, 2);
  assert.equal(lanes.multiplier, 2);
  assert.equal(lanes.points, POINTS.lanes * 2);
});

test('플리퍼를 누르면 켜진 레인 불이 누른 쪽으로 한 칸 옮겨 간다', () => {
  const e = engineWith();
  rollOver(e, 1);
  clearBalls(e);
  assert.deepEqual(e.lanes.map((l) => l.lit).indexOf(true), 1);
  e.setFlipper('left', true);
  assert.equal(e.lanes.findIndex((l) => l.lit), 0);
  e.setFlipper('right', true);
  assert.equal(e.lanes.findIndex((l) => l.lit), 1);
});

test('드롭 타깃을 다 쓰러뜨리면 잠금 불이 켜지고, 구멍에 넣으면 멀티볼이 된다', () => {
  const e = engineWith();
  const events = e.targets.flatMap((_, i) => knockDown(e, i));
  assert.equal(ofType(events, 'target').length, e.targets.length);
  assert.equal(ofType(events, 'bank')[0].points, POINTS.bank);
  assert.equal(e.lockLit, true);

  clearBalls(e);
  placeBall(e, { x: SAUCER.x, y: SAUCER.y });
  const caught = run(e, 1 / 120);
  assert.equal(ofType(caught, 'multiball').length, 1);
  assert.equal(e.lockLit, false);
  assert.equal(e.isMultiball, true);
  // 붙잡아 둔 동안 발사대에서 공 하나가 더 나온다
  const later = run(e, 0.7);
  assert.equal(ofType(later, 'launch')[0].auto, true);
  assert.equal(e.balls.length, 2);
});

test('멀티볼 중에 구멍에 넣으면 잭팟 20,000점의 2배를 받는다', () => {
  const e = engineWith();
  placeBall(e, { x: 300, y: 600, vy: -10 });
  placeBall(e, { x: SAUCER.x, y: SAUCER.y });
  const [saucer] = ofType(run(e, 1 / 120), 'saucer');
  assert.equal(saucer.jackpot, true);
  assert.equal(saucer.points, POINTS.jackpot * 2);
});

test('멀티볼이 아닐 때 구멍은 2,000점을 준다', () => {
  const e = engineWith();
  placeBall(e, { x: SAUCER.x, y: SAUCER.y });
  const [saucer] = ofType(run(e, 1 / 120), 'saucer');
  assert.equal(saucer.jackpot, false);
  assert.equal(saucer.points, POINTS.saucer);
});

/** 발사한 공을 그 자리에 붙들어 둔 채 seconds초를 보낸다 */
function holdBallAt(e: ReturnType<typeof engineWith>, at: { x: number; y: number }, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    e.gateClosed = true;
    Object.assign(e.balls[0], { ...at, vx: 0, vy: 0 });
    e.step(1 / 60);
  }
  e.drainEvents();
}
const UP_TOP = { x: 200, y: 300 };
const IN_LOWER_LANES = { x: 180, y: LOWER_LANES_Y + 20 };

test('공 살리기 시간은 5초다', () => {
  assert.equal(BALL_SAVE_TIME, 5);
});

test('공 살리기 시간은 공이 아래쪽 길에 내려오기 전에는 가지 않는다', () => {
  const e = engineWith();
  e.launch(1);
  holdBallAt(e, UP_TOP, 12);
  assert.equal(e.saveTimer, BALL_SAVE_TIME);
  // 위에서 한참 놀다 내려오자마자 잃어도 돌려준다
  assert.equal(ofType(loseBall(e), 'ballSaved').length, 1);
});

test('공이 아래쪽 길에 내려온 뒤 5초 안에 잃으면 돌려준다', () => {
  const e = engineWith();
  e.launch(1);
  holdBallAt(e, UP_TOP, 12);
  holdBallAt(e, IN_LOWER_LANES, 4.5);
  assert.ok(e.saveTimer > 0 && e.saveTimer < 1, `남은 시간 ${e.saveTimer}`);
  assert.equal(ofType(loseBall(e), 'ballSaved').length, 1);
});

test('공이 아래쪽 길에 내려온 뒤 5초가 지나면 돌려주지 않는다 (그사이 다시 위로 올라가도 시간은 간다)', () => {
  const e = engineWith();
  e.launch(1);
  holdBallAt(e, IN_LOWER_LANES, 1);
  holdBallAt(e, UP_TOP, 4.5);
  assert.equal(e.saveTimer, 0);
  const events = loseBall(e);
  assert.equal(ofType(events, 'ballSaved').length, 0);
  assert.equal(ofType(events, 'drain').length, 1);
});

test('발사 레인에 있는 공은 아래쪽 길에 내려온 것으로 세지 않는다', () => {
  const e = engineWith();
  e.launch(0); // 아주 약하게 쏴서 레인 안에서만 움직인다
  run(e, 1);
  assert.equal(e.saveTimer, BALL_SAVE_TIME);
});

test('공 살리기가 켜져 있을 때 잃은 공은 한 번 돌려주고, 두 번째는 잃는다', () => {
  const e = engineWith();
  assert.equal(e.launch(1), true);
  const first = loseBall(e);
  assert.equal(ofType(first, 'ballSaved').length, 1);
  assert.equal(e.ballsLeft, BALLS_PER_GAME);
  assert.equal(e.plungerLoaded, true);

  assert.equal(e.launch(1), true);
  const second = loseBall(e);
  assert.equal(ofType(second, 'ballSaved').length, 0);
  assert.equal(ofType(second, 'drain')[0].ballsLeft, BALLS_PER_GAME - 1);
  assert.equal(e.ballsLeft, BALLS_PER_GAME - 1);
});

test('공을 다 잃으면 판이 끝난다 (공마다 한 번씩은 돌려준다)', () => {
  const e = engineWith();
  const events = [];
  for (let i = 0; i < BALLS_PER_GAME * 2; i++) {
    assert.equal(e.launch(1), true, `${i + 1}번째 발사`);
    events.push(...loseBall(e));
  }
  assert.equal(ofType(events, 'ballSaved').length, BALLS_PER_GAME);
  assert.equal(ofType(events, 'gameOver').length, 1);
  assert.equal(e.over, true);
  assert.equal(e.ballsLeft, 0);
  assert.equal(e.launch(1), false);
});

test('점수는 상한을 넘지 않는다', () => {
  const e = engineWith();
  e.score = MAX_SCORE - 50;
  const b = e.bumpers[0];
  placeBall(e, { x: b.x, y: b.y - b.r - 12, vy: 300 });
  const [hit] = ofType(runUntil(e, 'bumper', 1), 'bumper');
  assert.equal(hit.points, 50);
  assert.equal(e.score, MAX_SCORE);
});

test('한 판 코인은 상한 400개를 넘지 않는다', () => {
  const e = engineWith();
  e.coinsEarned = MAX_COINS_PER_RUN - 2;
  e.coins.push({ id: 1, x: 150, y: 900, r: 10, age: 1 });
  placeBall(e, { x: 150, y: 900 });
  const [coin] = ofType(run(e, 1 / 120), 'coin');
  assert.equal(coin.coins, 2);
  assert.equal(e.coinsEarned, MAX_COINS_PER_RUN);
});

test('점수 구간을 넘으면 코인을 받는다', () => {
  const e = engineWith();
  e.score = 9_950;
  const b = e.bumpers[0];
  placeBall(e, { x: b.x, y: b.y - b.r - 12, vy: 300 });
  const [milestone] = ofType(runUntil(e, 'milestone', 1), 'milestone');
  assert.deepEqual({ score: milestone.score, coins: milestone.coins }, { score: 10_000, coins: 10 });
  assert.equal(e.coinsEarned, 10);
});
