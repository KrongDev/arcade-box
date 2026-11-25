import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALLS_PER_GAME, POINTS } from '../../src/pinball/rules.ts';
import { KICKBACK, TABLE_H } from '../../src/pinball/table.ts';
import { clearBalls, engineWith, ofType, placeBall, run, runUntil } from './helpers.ts';

/** 킥백(왼쪽 바깥 길에서 한 번 살려 주기)과 오른쪽 타깃(다 맞히면 킥백을 다시 켬) */

const LEFT_OUTLANE = { x: 22, y: KICKBACK.sensor.y - 12 };
const RIGHT_OUTLANE = { x: 338, y: KICKBACK.sensor.y - 12 };

/** 오른쪽 타깃 하나를 왼쪽에서 세게 맞힌다 */
function hitStandup(e: ReturnType<typeof engineWith>, index: number) {
  const t = e.standups[index];
  clearBalls(e);
  placeBall(e, { x: t.x - 30, y: (t.y1 + t.y2) / 2, vx: 500 });
  return run(e, 0.2);
}

test('판을 시작하면 킥백이 켜져 있다', () => {
  assert.equal(engineWith().kickbackLit, true);
});

test('킥백이 켜져 있으면 왼쪽 바깥 길의 공을 살리고 꺼진다', () => {
  const e = engineWith();
  const ball = placeBall(e, LEFT_OUTLANE);
  const events = [];
  let backInPlay = false;
  for (let t = 0; t < 2; t += 1 / 120) {
    e.step(1 / 120);
    events.push(...e.drainEvents());
    if (!ball.ride && ball.x > 40 && ball.y < 1010) backInPlay = true;
  }
  assert.equal(ofType(events, 'kickback').length, 1);
  assert.equal(ofType(events, 'drain').length, 0);
  assert.equal(backInPlay, true, '공이 판 안으로 돌아오지 않았어요');
  assert.equal(e.kickbackLit, false);
  assert.equal(e.ballsLeft, BALLS_PER_GAME);
});

test('킥백이 꺼져 있으면 왼쪽 바깥 길의 공을 잃는다', () => {
  const e = engineWith();
  e.kickbackLit = false;
  placeBall(e, LEFT_OUTLANE);
  const events = run(e, 2);
  assert.equal(ofType(events, 'kickback').length, 0);
  assert.equal(ofType(events, 'drain').length, 1);
});

test('오른쪽 바깥 길에는 킥백이 없다', () => {
  const e = engineWith();
  placeBall(e, RIGHT_OUTLANE);
  const events = run(e, 2);
  assert.equal(ofType(events, 'kickback').length, 0);
  assert.equal(ofType(events, 'drain').length, 1);
  assert.equal(e.kickbackLit, true);
});

test('공을 잃고 새 공을 받으면 킥백이 다시 켜진다', () => {
  const e = engineWith();
  e.kickbackLit = false;
  placeBall(e, { x: 180, y: TABLE_H + 40 });
  const events = run(e, 1 / 60);
  assert.equal(ofType(events, 'drain').length, 1);
  assert.equal(e.kickbackLit, true);
});

test('오른쪽 타깃을 맞히면 불이 켜지고 300점을 받는다. 켜진 타깃은 또 맞혀도 점수가 없다', () => {
  const e = engineWith();
  const first = ofType(hitStandup(e, 0), 'standup');
  assert.equal(first.length, 1);
  assert.equal(first[0].points, POINTS.standup);
  assert.equal(e.standups[0].lit, true);
  const again = hitStandup(e, 0);
  assert.equal(ofType(again, 'standup').length, 0);
  assert.equal(e.score, POINTS.standup);
});

test('오른쪽 타깃 셋을 다 맞히면 2,000점을 받고 킥백이 다시 켜진다', () => {
  const e = engineWith();
  e.kickbackLit = false;
  const events = e.standups.flatMap((_, i) => hitStandup(e, i));
  const [bank] = ofType(events, 'standupBank');
  assert.equal(bank.points, POINTS.standupBank);
  assert.equal(bank.relit, true);
  assert.equal(e.kickbackLit, true);
  // 1초쯤 뒤에 불이 꺼지고 다시 시작한다
  clearBalls(e);
  run(e, 1.2);
  assert.deepEqual(e.standups.map((t) => t.lit), [false, false, false]);
});

test('킥백이 이미 켜져 있을 때 타깃을 다 맞히면 점수만 받는다', () => {
  const e = engineWith();
  const [bank] = ofType(e.standups.flatMap((_, i) => hitStandup(e, i)), 'standupBank');
  assert.equal(bank.relit, false);
  assert.equal(e.kickbackLit, true);
});

test('정해진 길 위의 공은 다른 공과 부딪히지 않는다', () => {
  const e = engineWith();
  const rider = placeBall(e, LEFT_OUTLANE);
  runUntil(e, 'kickback', 1);
  assert.ok(rider.ride, '킥백 길을 타지 않았어요');
  // 길 한가운데에 다른 공을 세워 둔다
  const other = placeBall(e, { x: 22, y: 1100 });
  run(e, 0.15);
  assert.equal(other.vx, 0, '세워 둔 공이 옆으로 밀렸어요');
  assert.ok(rider.ride === null || rider.y < 1100, '길 위의 공이 막혔어요');
});
