import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_SAVE_TIME, BONUS_COINS, BONUS_ORDER, MAX_COINS_PER_RUN, POINTS } from '../../src/pinball/rules.ts';
import { FLIPPERS, SAUCERS, SPINNER, TABLE_H } from '../../src/pinball/table.ts';
import { clearBalls, engineWith, ofType, placeBall, run, runUntil } from './helpers.ts';

/** 돌아가는 길의 스피너와 보너스 구멍(정해진 차례대로 보상) */

/** 보너스 구멍에 공을 한 번 넣는다 */
function enterBonus(e: ReturnType<typeof engineWith>) {
  clearBalls(e);
  placeBall(e, { x: SAUCERS.bonus.x, y: SAUCERS.bonus.y });
  const [bonus] = ofType(run(e, 1 / 120), 'bonus');
  return bonus;
}

test('스피너를 빠르게 지나가면 여러 번 돌고, 한 번 돌 때마다 400점을 받는다', () => {
  const e = engineWith();
  placeBall(e, { x: SPINNER.x, y: SPINNER.y + 12, vy: -900 });
  const spins = ofType(run(e, 1), 'spinner');
  assert.equal(spins.length, 5);
  assert.ok(spins.every((s) => s.points === POINTS.spinner));
  assert.equal(e.score, 5 * POINTS.spinner);
});

test('스피너를 느리게 지나가면 한 번만 돈다', () => {
  const e = engineWith();
  placeBall(e, { x: SPINNER.x, y: SPINNER.y - 12, vy: 60 });
  assert.equal(ofType(run(e, 1), 'spinner').length, 1);
});

test('아무리 빨라도 한 번 지나갈 때 8번까지만 돈다', () => {
  const e = engineWith();
  placeBall(e, { x: SPINNER.x, y: SPINNER.y + 12, vy: -1700 });
  assert.equal(ofType(run(e, 1.5), 'spinner').length, 8);
});

test('스피너는 콤보에 들어가지 않는다', () => {
  const e = engineWith();
  placeBall(e, { x: SPINNER.x, y: SPINNER.y + 12, vy: -900 });
  const events = run(e, 1);
  assert.equal(ofType(events, 'combo').length, 0);
  assert.equal(e.comboCount, 0);
});

test('돌아가는 길로 세게 올린 공은 길을 타고 판 꼭대기까지 간다', () => {
  const e = engineWith();
  const ball = placeBall(e, { x: SPINNER.x, y: SPINNER.y + 20, vy: -1500 });
  let top = TABLE_H;
  for (let t = 0; t < 1.2; t += 1 / 120) {
    e.step(1 / 120);
    e.drainEvents();
    top = Math.min(top, ball.y);
  }
  assert.ok(top < 140, `가장 높이 올라간 곳 y=${top.toFixed(0)}`);
});

test('보너스 구멍은 들어갈 때마다 정해진 차례대로 보상을 준다 (난수와 상관없이)', () => {
  assert.deepEqual([...BONUS_ORDER], ['small', 'coins', 'big', 'save', 'lock']);
  for (const seed of [7, 99]) {
    const e = engineWith({}, seed);
    const awards = Array.from({ length: 6 }, () => enterBonus(e).award);
    assert.deepEqual(awards, ['small', 'coins', 'big', 'save', 'lock', 'small'], `씨앗 ${seed}`);
  }
});

test('보너스 구멍의 보상: 5,000점, 코인 10개, 10,000점, 공 살리기, 잠금 불', () => {
  const e = engineWith();
  const small = enterBonus(e);
  assert.deepEqual([small.points, small.coins], [POINTS.bonusSmall, 0]);

  const coins = enterBonus(e);
  assert.deepEqual([coins.points, coins.coins], [0, BONUS_COINS]);
  assert.equal(e.coinsEarned, BONUS_COINS);

  const big = enterBonus(e);
  assert.equal(big.points, POINTS.bonusBig);

  e.saveUsed = true;
  e.saveTimer = 0;
  enterBonus(e);
  assert.equal(e.saveUsed, false);
  assert.ok(e.saveTimer > BALL_SAVE_TIME - 0.05, `공 살리기 남은 시간 ${e.saveTimer}`);

  assert.equal(e.lockLit, false);
  enterBonus(e);
  assert.equal(e.lockLit, true);
});

test('보너스 구멍 코인은 한 판 상한을 넘지 않는다', () => {
  const e = engineWith();
  e.coinsEarned = MAX_COINS_PER_RUN - 5;
  e.bonusIndex = BONUS_ORDER.indexOf('coins');
  assert.equal(enterBonus(e).coins, 5);
  assert.equal(e.coinsEarned, MAX_COINS_PER_RUN);
});

test('보너스 구멍 코인에는 공 스킨의 코인 능력이 붙지 않는다', () => {
  const e = engineWith({ coinValue: 0.3 });
  e.bonusIndex = BONUS_ORDER.indexOf('coins');
  assert.equal(enterBonus(e).coins, BONUS_COINS);
});

test('보너스 구멍에 공이 있어도 잠금 구멍은 따로 공을 받는다', () => {
  const e = engineWith();
  const a = placeBall(e, { x: SAUCERS.bonus.x, y: SAUCERS.bonus.y });
  const b = placeBall(e, { x: SAUCERS.lock.x, y: SAUCERS.lock.y });
  const events = run(e, 1 / 120);
  assert.equal(ofType(events, 'bonus').length, 1);
  assert.equal(ofType(events, 'saucer').length, 1);
  assert.deepEqual([a.heldBy, b.heldBy], ['bonus', 'lock']);
});

test('구멍이 뱉은 공은 플리퍼 사이 가운데나 바깥 길로 곧장 떨어지지 않는다', () => {
  const [left, right] = FLIPPERS;
  for (const id of ['lock', 'bonus'] as const) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const e = engineWith({}, seed);
      const ball = placeBall(e, { x: SAUCERS[id].x, y: SAUCERS[id].y });
      runUntil(e, () => false, 0.01);
      assert.equal(ball.heldBy, id);
      // 뱉을 때까지 기다린 뒤 1초 동안 지켜본다
      for (let t = 0; t < 3 && ball.held > 0; t += 1 / 120) e.step(1 / 120);
      for (let t = 0; t < 1; t += 1 / 120) {
        e.step(1 / 120);
        if (e.balls.length === 0) assert.fail(`${id} 씨앗 ${seed}: 뱉은 공을 1초 안에 잃었어요`);
        if (ball.y > left.py - 20 && ball.y < left.py + 30) {
          const overFlipper = (ball.x > left.px - 10 && ball.x < left.px + left.len - 4) || (ball.x < right.px + 10 && ball.x > right.px - right.len + 4);
          assert.ok(overFlipper, `${id} 씨앗 ${seed}: 플리퍼가 없는 곳으로 떨어졌어요 (x=${ball.x.toFixed(0)})`);
          break;
        }
      }
    }
  }
});
