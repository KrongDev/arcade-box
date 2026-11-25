import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraTarget, focusBall, snapCamera, stepCamera } from '../../src/pinball/camera.ts';
import { PinballEngine } from '../../src/pinball/engine.ts';
import { FLIPPER_Y, LANE_X, TABLE_H, VIEW_H } from '../../src/pinball/table.ts';
import { reactiveBot, seeded } from './helpers.ts';

/** 화면이 공을 따라가는 방식 — 판(1300)이 화면(700)보다 길어서 세로로 0~600만큼 움직인다 */

const BOTTOM = TABLE_H - VIEW_H;
const ball = (y: number, level: 0 | 1 = 0, extra: { x?: number; held?: number; ride?: object | null; vy?: number } = {}) => ({ x: 200, y, vy: 0, level, held: 0, ride: null, ...extra });

test('화면은 세로로 0부터 600까지 움직인다', () => {
  assert.equal(BOTTOM, 600);
});

test('공이 하나면 그 공을 따라간다', () => {
  const only = ball(300, 1);
  assert.equal(focusBall([only]), only);
});

test('공이 여럿이면 1층에서 가장 아래 공을 따라간다', () => {
  const upper = ball(200);
  const lower = ball(900);
  const attic = ball(500, 1);
  assert.equal(focusBall([upper, attic, lower]), lower);
});

test('레일이나 미끄럼길을 타고 내려오는 공이 더 아래에 있으면 그 공을 따라간다 (곧 플리퍼에 닿는다)', () => {
  const onRail = ball(1000, 1, { ride: {} });
  const onChute = ball(1000, 0, { ride: {} });
  const free = ball(400);
  assert.equal(focusBall([onRail, free]), onRail);
  assert.equal(focusBall([free, onChute]), onChute);
});

test('발사 레인을 올라가는 공보다 판 위의 공을 먼저 따라간다', () => {
  const launching = ball(1100, 0, { x: LANE_X + 20 });
  const free = ball(300);
  assert.equal(focusBall([launching, free]), free);
});

test('판 위에 다른 공이 없으면 발사 레인의 공을 따라간다', () => {
  const launching = ball(1100, 0, { x: LANE_X + 20 });
  const attic = ball(500, 1);
  assert.equal(focusBall([launching]), launching);
  assert.equal(focusBall([attic, launching]), launching);
});

test('1층에 공이 없으면 가장 아래 공을 따라간다', () => {
  const a = ball(400, 1);
  const b = ball(560, 1);
  assert.equal(focusBall([a, b]), b);
});

test('공이 없으면 따라갈 공도 없고 화면은 맨 아래를 본다', () => {
  assert.equal(focusBall([]), null);
  assert.equal(cameraTarget(null), BOTTOM);
});

test('공이 판 아래쪽에 있으면 화면은 맨 아래에 붙는다', () => {
  assert.equal(cameraTarget({ y: 1000, vy: 0 }), BOTTOM);
  assert.equal(cameraTarget({ y: FLIPPER_Y, vy: 0 }), BOTTOM);
  // 판 아래쪽 3분의 1에 멈춰 있는 공이면 플리퍼까지 다 보인다
  assert.equal(cameraTarget({ y: Math.ceil((TABLE_H * 2) / 3), vy: 0 }), BOTTOM);
  // 플리퍼로 막 쳐 올린 공이어도 화면은 아직 맨 아래다
  assert.equal(cameraTarget({ y: FLIPPER_Y, vy: -1500 }), BOTTOM);
});

test('아래로 빠르게 내려오는 공은 아래쪽을 더 보여 준다', () => {
  assert.ok(cameraTarget({ y: 500, vy: 1000 }) > cameraTarget({ y: 500, vy: 0 }));
});

test('목표 위치는 범위를 벗어나지 않는다', () => {
  assert.equal(cameraTarget({ y: 20, vy: -1700 }), 0);
  assert.equal(cameraTarget({ y: 1290, vy: 1700 }), BOTTOM);
});

test('화면은 목표로 부드럽게 다가가고 지나치지 않는다', () => {
  let cam = 0;
  const seen: number[] = [];
  for (let i = 0; i < 120; i++) {
    cam = stepCamera(cam, 400, null, 1 / 60);
    seen.push(cam);
  }
  assert.ok(seen[0] > 0 && seen[0] < 120, `첫 프레임 ${seen[0]}`);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]));
  assert.ok(Math.abs(cam - 400) < 1);
});

test('가장 빠른 공이 화면 끝으로 달려가도 화면 밖으로 나가지 못한다', () => {
  // 목표가 제자리에 있어도(따라가기가 늦어도) 화면 끝에서 80(아래)·60(위) 안쪽을 지킨다. 30Hz 화면에서도
  for (const fps of [30, 60, 120]) {
    const dt = 1 / fps;
    let cam = 0;
    for (let y = 600; y < 1100; y += 1700 * dt) {
      cam = stepCamera(cam, cam, y, dt);
      assert.ok(y <= cam + VIEW_H - 80 + 1e-9, `${fps}Hz 아래: 공 ${y.toFixed(0)}, 화면 ${cam.toFixed(0)}`);
    }
    cam = BOTTOM;
    for (let y = 680; y > 200; y -= 1700 * dt) {
      cam = stepCamera(cam, cam, y, dt);
      assert.ok(y >= cam + 60 - 1e-9, `${fps}Hz 위: 공 ${y.toFixed(0)}, 화면 ${cam.toFixed(0)}`);
    }
  }
});

test('따라갈 공이 멀리 있는 공으로 바뀌어도 화면이 한 번에 건너뛰지 않고 빠르게 옮겨 간다', () => {
  // 맨 아래를 보고 있었는데 따라가던 공이 빠지고, 남은 공은 판 꼭대기에 있다
  let cam = BOTTOM;
  const far = { y: 100, vy: 0 };
  const moves: number[] = [];
  for (let i = 0; i < 30; i++) {
    const next = stepCamera(cam, cameraTarget(far), far.y, 1 / 60);
    moves.push(Math.abs(next - cam));
    cam = next;
  }
  assert.ok(Math.max(...moves) <= 120, `한 프레임에 ${Math.max(...moves).toFixed(0)}만큼 움직였어요`);
  assert.ok(far.y >= cam + 60 - 1e-9, `0.5초 뒤에도 공이 화면에 안 들어왔어요 (화면 ${cam.toFixed(0)})`);
});

test('멀티볼이 섞인 판에서도 화면이 한 프레임에 150 넘게 건너뛰지 않는다', () => {
  const dt = 1 / 60;
  let worst = 0;
  let multiballFrames = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const e = new PinballEngine(seeded(seed * 31));
    const bot = reactiveBot(seed, TABLE_H);
    let cam = cameraTarget(null);
    for (let t = 0; t < 240 && !e.over; t += dt) {
      bot(e, dt);
      e.step(dt);
      e.drainEvents();
      if (e.balls.length > 1) multiballFrames++;
      const focus = focusBall(e.balls);
      const next = stepCamera(cam, cameraTarget(focus), focus ? focus.y : null, dt);
      worst = Math.max(worst, Math.abs(next - cam));
      cam = next;
    }
  }
  assert.ok(multiballFrames > 600, `멀티볼이 거의 없었어요 (${multiballFrames}프레임)`);
  assert.ok(worst <= 150, `한 프레임에 ${worst.toFixed(0)}만큼 건너뛰었어요`);
});

/** 공을 곧장(벽에 부딪히지 않고) 떨어뜨려, 플리퍼가 다 보인 때부터 공이 플리퍼 높이에 닿을 때까지의 시간을 잰다 */
function headStart(y0: number, vy0: number, cam0: number): number {
  let y = y0;
  let vy = vy0;
  let cam = cam0;
  let seenAt = -1;
  const dt = 1 / 60;
  for (let t = 0; t < 4; t += dt) {
    vy = Math.min(1700, vy + 900 * dt);
    y += vy * dt;
    cam = stepCamera(cam, cameraTarget({ y, vy }), y, dt);
    if (seenAt < 0 && cam + VIEW_H >= FLIPPER_Y + 36) seenAt = t;
    if (y >= FLIPPER_Y - 34) return seenAt < 0 ? -1 : t - seenAt;
  }
  return -1;
}
/** 멈춰 있는 공을 보고 있을 때의 화면 자리 */
const centered = (y: number) => cameraTarget({ y, vy: 0 });

test('멈췄다 떨어지는 공은 닿기 0.2초 전에 플리퍼가 다 보인다', () => {
  for (const y0 of [150, 400, 700]) {
    const lead = headStart(y0, 0, centered(y0));
    assert.ok(lead >= 0.2, `y0=${y0}: 여유 ${lead.toFixed(2)}초`);
  }
});

test('범퍼가 갑자기 아래로 차 낸 공도 닿기 0.2초 전에 플리퍼가 다 보인다', () => {
  // 범퍼는 판 위쪽(y 400 위)에만 있고 차는 힘은 720이다. 화면은 차이기 전의 자리(공이 가운데)에서 출발한다
  for (const y0 of [190, 300, 400]) {
    const lead = headStart(y0, 900, centered(y0));
    assert.ok(lead >= 0.2, `y0=${y0}: 여유 ${lead.toFixed(2)}초`);
  }
});

test('이미 가장 빠르게 떨어지고 있는 공도 닿기 0.2초 전에 플리퍼가 다 보인다', () => {
  // 가장 빠른 속도는 한참 떨어진 뒤에야 나오므로, 화면은 이미 그 공을 따라가던 자리에서 출발한다
  for (const y0 of [400, 700]) {
    const lead = headStart(y0, 1700, cameraTarget({ y: y0, vy: 1700 }));
    assert.ok(lead >= 0.2, `y0=${y0}: 여유 ${lead.toFixed(2)}초`);
  }
});

test('프레임 간격이 아주 길어도 범위 안에 있다', () => {
  for (const [cam, target, y] of [[0, 600, 1200], [600, 0, 50], [300, 9999, null], [300, -9999, null]] as const) {
    const next = stepCamera(cam, target, y, 5);
    assert.ok(next >= 0 && next <= BOTTOM, `${next}`);
  }
});

test('그릴 때는 3의 배수로 맞춘다', () => {
  assert.equal(snapCamera(100.4), 99);
  assert.equal(snapCamera(101.6), 102);
  assert.equal(snapCamera(600), 600);
});
