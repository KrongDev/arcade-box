import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BREAKOUT_NO_GEAR, BreakoutEngine } from '../../src/breakout/engine.ts';
import { BALLS_PER_GAME, FIELD_H, MAX_COINS_PER_RUN, PADDLE_W, PADDLE_WIDE_W, stageBonus } from '../../src/breakout/rules.ts';
import { BALL_R, brick, engineWith, placeBall, runUntil, seeded } from './helpers.ts';

/** 화면 왼쪽 위 구석에 두는 벽돌 — 스테이지가 저절로 끝나지 않게 한다 */
const keeper = () => brick(11, 72);

test('처음에는 공이 패들 위에서 기다리고, 패들을 옮기면 공도 따라온다', () => {
  const e = new BreakoutEngine({ rng: seeded(1), gear: BREAKOUT_NO_GEAR });
  assert.equal(e.state, 'ready');
  assert.equal(e.stage, 1);
  assert.equal(e.lives, BALLS_PER_GAME);
  assert.equal(e.balls.length, 1);
  e.movePaddle(100);
  assert.equal(e.paddle.x, 100);
  assert.equal(e.balls[0].x, 100);
  assert.ok(e.balls[0].y < e.paddle.y);
});

test('패들은 화면 밖으로 나가지 않는다', () => {
  const e = new BreakoutEngine({ rng: seeded(1) });
  e.movePaddle(-50);
  assert.equal(e.paddle.x, PADDLE_W / 2);
});

test('발사하면 공이 위로 날아가고, 한 번만 발사된다', () => {
  const e = engineWith([[keeper()]]);
  assert.equal(e.launch(), true);
  assert.equal(e.launch(), false);
  const y0 = e.balls[0].y;
  e.step(1 / 30);
  assert.equal(e.state, 'live');
  assert.ok(e.balls[0].y < y0);
  assert.ok(e.drainEvents().some((ev) => ev.type === 'launch'));
});

test('왼쪽 벽과 천장에 부딪히면 튕겨 나온다', () => {
  const e = engineWith([[keeper()]]);
  e.launch();
  placeBall(e, BALL_R + 3, 300, -1, -1);
  const events = runUntil(e, 'wall', 1);
  assert.ok(events.some((ev) => ev.type === 'wall'));
  assert.ok(e.balls[0].vx > 0);

  placeBall(e, 300, BALL_R + 3, 0.2, -1);
  runUntil(e, 'wall', 1);
  assert.ok(e.balls[0].vy > 0);
});

test('패들 가운데에 맞으면 곧장 위로, 오른쪽 끝에 맞으면 오른쪽 위로 튄다', () => {
  const e = engineWith([[keeper()]]);
  e.movePaddle(180);
  e.launch();
  placeBall(e, 180, e.paddle.y - 30, 0, 1);
  runUntil(e, 'paddle', 1);
  assert.ok(Math.abs(e.balls[0].vx) < 1e-6);
  assert.ok(e.balls[0].vy < 0);

  placeBall(e, 180 + 28, e.paddle.y - 30, 0, 1);
  runUntil(e, 'paddle', 1);
  assert.ok(e.balls[0].vx > 0);
  assert.ok(e.balls[0].vy < 0);
  // 너무 눕지 않는다 (60도 이내)
  assert.ok(Math.abs(e.balls[0].vx) < Math.abs(e.balls[0].vy) * Math.tan(Math.PI / 3) + 1e-6);
});

test('보통 벽돌은 한 번에 깨지고 10점을 준다', () => {
  const e = engineWith([[keeper(), brick(164, 200)]]);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  const events = runUntil(e, 'brickBreak', 1);
  const br = events.find((ev) => ev.type === 'brickBreak');
  assert.ok(br && br.type === 'brickBreak' && br.points === 10);
  assert.equal(e.score, 10);
  assert.equal(e.bricks.length, 1);
  assert.ok(e.balls[0].vy > 0);
});

test('단단한 벽돌은 처음엔 금만 가고(5점) 두 번째에 깨진다(25점)', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'tough')]]);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  const first = runUntil(e, 'brickHit', 1);
  assert.ok(first.some((ev) => ev.type === 'brickHit'));
  assert.equal(e.bricks.find((b) => b.kind === 'tough')?.hp, 1);
  assert.equal(e.score, 5);

  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'brickBreak', 1);
  assert.equal(e.score, 30);
  assert.equal(e.bricks.length, 1);
});

test('패들에 닿지 않고 5개째 깨면 점수가 2배가 되고, 패들에 닿으면 연속이 끊긴다', () => {
  const e = engineWith([[keeper(), brick(164, 200)]]);
  e.launch();
  e.chain = 4;
  placeBall(e, 180, 260, 0, -1);
  const events = runUntil(e, 'brickBreak', 1);
  assert.equal(e.score, 20);
  assert.ok(events.some((ev) => ev.type === 'chain' && ev.multiplier === 2));
  assert.equal(e.multiplier, 2);

  e.movePaddle(180);
  placeBall(e, 180, e.paddle.y - 30, 0, 1);
  runUntil(e, 'paddle', 1);
  assert.equal(e.chain, 0);
  assert.equal(e.multiplier, 1);
});

test('동전 벽돌을 깨면 동전이 떨어지고, 패들로 받으면 코인을 준다 (장착 능력만큼 더)', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'normal', 'coin')]], { coinSpawn: 0, coinValue: 0.2 });
  e.movePaddle(180);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'brickBreak', 1);
  assert.equal(e.drops.length, 1);
  const events = runUntil(e, 'coin', 6);
  const coin = events.find((ev) => ev.type === 'coin');
  assert.ok(coin && coin.type === 'coin' && coin.coins === 6);
  assert.equal(e.coinsEarned, 6);
  assert.equal(e.drops.length, 0);
});

test('한 판 코인은 상한을 넘지 않는다', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'normal', 'coin')]]);
  e.movePaddle(180);
  e.launch();
  e.coinsEarned = MAX_COINS_PER_RUN - 2;
  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'coin', 6);
  assert.equal(e.coinsEarned, MAX_COINS_PER_RUN);
});

test('놓친 동전은 화면 아래로 사라진다', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'normal', 'coin')]]);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'brickBreak', 1);
  e.movePaddle(330);
  for (let i = 0; i < 6 * 60; i++) {
    e.step(1 / 60);
    if (e.drops.length === 0) break;
  }
  assert.equal(e.drops.length, 0);
  assert.equal(e.coinsEarned, 0);
});

test('공을 떨어뜨리면 목숨이 줄고 다시 패들 위에서 시작한다. 목숨이 다 떨어지면 끝난다', () => {
  const e = engineWith([[keeper()]]);
  for (let life = BALLS_PER_GAME; life >= 1; life--) {
    e.movePaddle(330);
    e.launch();
    placeBall(e, 20, FIELD_H - 20, 0, 1);
    const events = runUntil(e, life > 1 ? 'lifeLost' : 'gameOver', 1);
    assert.equal(e.lives, life - 1);
    if (life > 1) {
      assert.ok(events.some((ev) => ev.type === 'lifeLost'));
      assert.equal(e.state, 'ready');
      assert.equal(e.balls.length, 1);
    }
  }
  assert.equal(e.state, 'over');
  assert.equal(e.launch(), false);
});

test('멀티볼 아이템을 받으면 공이 셋이 되고, 그중 하나를 놓쳐도 목숨은 그대로다', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'normal', 'multi')]]);
  e.movePaddle(180);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  const events = runUntil(e, 'power', 6);
  assert.ok(events.some((ev) => ev.type === 'power' && ev.kind === 'multi'));
  assert.equal(e.balls.length, 3);

  e.movePaddle(330);
  placeBall(e, 20, FIELD_H - 10, 0, 1, 0);
  placeBall(e, 120, 120, 0.3, -1, 1);
  placeBall(e, 240, 120, -0.3, -1, 2);
  const lost = runUntil(e, 'ballLost', 1);
  assert.ok(lost.some((ev) => ev.type === 'ballLost'));
  assert.equal(e.balls.length, 2);
  assert.equal(e.lives, BALLS_PER_GAME);
});

test('넓은 패들 아이템은 잠시 패들을 넓혀 준다', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'normal', 'wide')]]);
  e.movePaddle(180);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'power', 6);
  assert.equal(e.paddle.w, PADDLE_WIDE_W);
  for (let i = 0; i < 13 * 60; i++) e.step(1 / 60);
  assert.equal(e.paddle.w, PADDLE_W);
});

test('벽돌을 다 깨면 보너스를 받고 다음 스테이지로 넘어가 공이 패들 위에서 기다린다', () => {
  const e = engineWith([[brick(164, 200)], [keeper()]]);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  const events = runUntil(e, 'stageClear', 1);
  const clear = events.find((ev) => ev.type === 'stageClear');
  assert.ok(clear && clear.type === 'stageClear' && clear.stage === 1 && clear.bonus === stageBonus(1));
  assert.equal(e.stage, 2);
  assert.equal(e.state, 'ready');
  assert.equal(e.score, 10 + stageBonus(1));
  assert.equal(e.bricks.length, 1);
});

test('가장 빠를 때도 공이 얇은 벽돌을 뚫고 지나가지 않는다', () => {
  const e = engineWith([[keeper(), brick(164, 100)]]);
  e.launch();
  e.stageTime = 100_000;
  placeBall(e, 180, 500, 0, -1);
  let broke = false;
  for (let i = 0; i < 120 && !broke; i++) {
    e.step(1 / 60);
    broke = e.drainEvents().some((ev) => ev.type === 'brickBreak');
    assert.ok(broke || e.balls[0].y > 100, '벽돌 위로 빠져나갔어요');
  }
  assert.ok(broke);
});

test('동전 코인 능력이 작아도(+5%) 소수점을 모아 두었다가 코인으로 준다', () => {
  const e = engineWith([[keeper()]], { coinSpawn: 0, coinValue: 0.05 });
  e.movePaddle(180);
  e.launch();
  placeBall(e, 30, 150, 0, -1);
  for (let i = 0; i < 20; i++) {
    e.drops.push({ id: 500 + i, x: e.paddle.x, y: e.paddle.y - 4, kind: 'coin' });
    e.step(1 / 60);
  }
  // 동전 20개 × 5.25 = 105
  assert.equal(e.coinsEarned, 105);
});

test('동전 벽돌은 보통 벽돌과 같은 점수다 (동전 벽돌을 늘리는 능력이 점수를 올리지 않는다)', () => {
  const e = engineWith([[keeper(), brick(164, 200, 'normal', 'coin')]]);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'brickBreak', 1);
  assert.equal(e.score, 10);
});

test('마지막 벽돌에서 나온 동전은 스테이지를 넘어가도 받는다', () => {
  const e = engineWith([[brick(164, 200, 'normal', 'coin')], [keeper()]]);
  e.launch();
  placeBall(e, 180, 260, 0, -1);
  runUntil(e, 'stageClear', 1);
  assert.equal(e.stage, 2);
  assert.equal(e.coinsEarned, 5);
});

test('패들 옆면에 닿은 공은 위로 순간이동하지 않고 옆으로 밀려나 떨어진다', () => {
  const e = engineWith([[keeper()]]);
  e.movePaddle(180);
  e.launch();
  const left = e.paddle.x - e.paddle.w / 2;
  placeBall(e, left - BALL_R + 2, e.paddle.y + 9, 1, 0.3);
  const events = runUntil(e, 'paddle', 0.05);
  assert.equal(events.some((ev) => ev.type === 'paddle'), false);
  assert.ok(e.balls[0].y > e.paddle.y);
  assert.ok(e.balls[0].vx < 0);
});

test('오래 벽돌을 못 맞히면 패들 가운데에 맞아도 공이 살짝 비스듬히 튄다 (같은 길만 오가지 않게)', () => {
  const e = engineWith([[keeper()]]);
  e.movePaddle(180);
  e.launch();
  e.idleTime = 30;
  placeBall(e, 180, e.paddle.y - 30, 0, 1);
  runUntil(e, 'paddle', 1);
  assert.ok(Math.abs(e.balls[0].vx) > 1);
});
