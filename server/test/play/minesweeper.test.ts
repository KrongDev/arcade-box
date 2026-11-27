import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VALIDATORS, type Board } from '../../src/play/index.ts';
import { checkValidatorParams, findValidator, minesweeperScore } from '../../src/play/validators.ts';
import { MS, thrown } from './helpers.ts';

/**
 * 지뢰찾기 검증기와 점수 식 (표 K9). `server/test/score.test.ts`와 `app.test.ts`의 지뢰찾기 경우를 그대로 옮겼다.
 * DB 없이 돈다: 검증기는 순위표와 입력만 받는 순수 함수다.
 */
const board = (size: keyof typeof MS, over: Partial<Board> = {}): Board => ({
  id: `minesweeper.${size}`,
  gameId: 'minesweeper',
  label: size,
  ordering: 'higher',
  minValue: 0,
  maxValue: 5_000_000,
  maxCoinsPerRun: 69,
  requiresBoardId: null,
  validator: 'minesweeper',
  validatorParams: MS[size],
  sortOrder: 0,
  ...over,
});

const easy = board('easy');
const check = (input: Record<string, unknown>, b: Board = easy) => VALIDATORS.minesweeper(b, input);

// ── 점수 식 (score.test.ts) ─────────────────────────────────────

test('깬 판: 연 칸 + 깃발 + 클리어 보너스 + 시간 보너스', () => {
  // 700 + 200 + 700 + (180-40)*10 = 3000
  assert.equal(minesweeperScore(MS.easy, { opened: 70, correctFlags: 10, wrongFlags: 0, won: true, seconds: 40 }), 3000);
});

test('0.1초 빠를수록 1점 더', () => {
  const a = minesweeperScore(MS.easy, { opened: 70, correctFlags: 0, wrongFlags: 0, won: true, seconds: 40.0 });
  const b = minesweeperScore(MS.easy, { opened: 70, correctFlags: 0, wrongFlags: 0, won: true, seconds: 39.9 });
  assert.equal(b - a, 1);
});

test('기준 시간보다 느리면 시간 보너스는 0 (음수 아님)', () => {
  assert.equal(minesweeperScore(MS.easy, { opened: 70, correctFlags: 0, wrongFlags: 0, won: true, seconds: 999 }), 1400);
});

test('못 깬 판: 시간 보너스·클리어 보너스 없음, 틀린 깃발 감점, 0점 아래로 안 내려감', () => {
  assert.equal(minesweeperScore(MS.easy, { opened: 30, correctFlags: 3, wrongFlags: 1, won: false, seconds: 5 }), 350);
  assert.equal(minesweeperScore(MS.easy, { opened: 0, correctFlags: 0, wrongFlags: 5, won: false, seconds: 5 }), 0);
});

test('깬 판은 늘 못 깬 판보다 높다 (같은 난이도)', () => {
  for (const size of ['easy', 'normal', 'hard'] as const) {
    const sp = MS[size];
    const slowWinNoFlags = minesweeperScore(sp, { opened: sp.safe, correctFlags: 0, wrongFlags: 0, won: true, seconds: 99999 });
    const bestLoss = minesweeperScore(sp, { opened: sp.safe - 1, correctFlags: sp.mines, wrongFlags: 0, won: false, seconds: 1 });
    assert.ok(slowWinNoFlags > bestLoss, size);
  }
});

test('보호를 쓴 판은 점수의 70%(내림)다', () => {
  const raw = minesweeperScore(MS.easy, { opened: 33, correctFlags: 1, wrongFlags: 0, won: false, seconds: 5 });
  const shielded = minesweeperScore(MS.easy, { opened: 33, correctFlags: 1, wrongFlags: 0, won: false, seconds: 5, shields: 1 });
  assert.equal(raw, 350);
  assert.equal(shielded, 245, '350 × 0.7 = 245 (소수 오차로 244가 되지 않는다)');
  // 검증기를 거쳐도 같다: 3000점짜리 깬 판에 보호를 쓰면 2100
  assert.equal(check({ won: true, seconds: 40, opened: 70, correctFlags: 10, wrongFlags: 0, shields: 1 }).value, 2100);
  assert.equal(check({ won: false, opened: 33, correctFlags: 1, wrongFlags: 0, shields: 1 }).value, 245);
  // 보호를 적지 않았거나 0이면 감점이 없다
  assert.equal(check({ won: false, opened: 33, correctFlags: 1, wrongFlags: 0, shields: 0 }).value, 350);
  assert.equal(check({ won: false, opened: 33, correctFlags: 1, wrongFlags: 0 }).value, 350);
});

// ── 판이 말이 되는지 (app.test.ts '불가능한 판 기록은 거부한다') ──────────────

test('연 칸이 안전한 칸보다 많거나, 깼다면서 다 열지 않았으면 400 invalid_board_stats', () => {
  const bad: Array<Record<string, unknown>> = [
    { won: false, opened: 71, correctFlags: 0, wrongFlags: 0 }, // 안전한 칸보다 많이 염
    { won: false, opened: 10, correctFlags: 11, wrongFlags: 0 }, // 지뢰보다 많은 맞은 깃발
    { won: false, opened: 65, correctFlags: 0, wrongFlags: 6 }, // 닫힌 안전한 칸(5)보다 많은 틀린 깃발
    { won: true, seconds: 30, opened: 69, correctFlags: 0, wrongFlags: 0 }, // 다 안 열었는데 깼다고 함
    { won: false, opened: 70, correctFlags: 0, wrongFlags: 0 }, // 다 열었는데 못 깼다고 함
    { won: false, opened: 1.5, correctFlags: 0, wrongFlags: 0 },
    { won: false, opened: 10, correctFlags: 0, wrongFlags: 0, shields: 2 }, // 지뢰 보호 상한(1번) 초과
    { won: false, opened: 10, correctFlags: 0, wrongFlags: 0, shields: -1 },
    // v1 테스트에 없던 것: 숫자가 아닌 값, 빠진 값, 음수, NaN
    { won: false, opened: '10', correctFlags: 0, wrongFlags: 0 },
    { won: false, correctFlags: 0, wrongFlags: 0 },
    { won: false, opened: 10, correctFlags: -1, wrongFlags: 0 },
    { won: false, opened: 10, correctFlags: 0, wrongFlags: Number.NaN },
    { won: false, opened: 10, correctFlags: 0, wrongFlags: 0, shields: 0.5 },
    { won: false, opened: 10, correctFlags: 0, wrongFlags: 0, shields: null },
    { won: false, opened: Number.POSITIVE_INFINITY, correctFlags: 0, wrongFlags: 0 },
  ];
  for (const b of bad) assert.throws(() => check(b), thrown(400, 'invalid_board_stats'), JSON.stringify(b));

  // 경계는 된다: 닫힌 안전한 칸 수만큼의 틀린 깃발, 지뢰 수만큼의 맞은 깃발, 보호 1번
  assert.equal(check({ won: false, opened: 65, correctFlags: 10, wrongFlags: 5, shields: 1 }).won, false);
  // `won`은 참(true)일 때만 깬 것이다: 글자 'true'나 1은 못 깬 판으로 읽는다 (다 열었다면 말이 안 되는 판)
  assert.throws(() => check({ won: 'true', seconds: 40, opened: 70, correctFlags: 0, wrongFlags: 0 }), thrown(400, 'invalid_board_stats'));
});

test('깬 판의 시간은 1~86,400초이고 0.1초로 반올림한다. 아니면 400 invalid_seconds', () => {
  const won = (seconds: unknown) => check({ won: true, seconds, opened: 70, correctFlags: 0, wrongFlags: 0 });
  for (const seconds of [0, 0.99, 86_400.01, 86_401, -40, Number.NaN, Number.POSITIVE_INFINITY, '40', null, undefined]) {
    assert.throws(() => won(seconds), thrown(400, 'invalid_seconds'), String(seconds));
  }
  assert.equal(won(1).seconds, 1);
  assert.equal(won(86_400).seconds, 86_400);
  assert.equal(won(40.04).seconds, 40);
  assert.equal(won(39.96).seconds, 40);
  assert.equal(won(40.06).seconds, 40.1);
  // 점수는 반올림한 시간으로 계산한다: 39.96초 → 40.0초
  assert.equal(won(39.96).value, won(40).value);
  // 못 깬 판은 시간을 보지 않는다 (v1과 같다): 엉뚱한 값이 와도 되고 기록에도 남지 않는다
  const lost = check({ won: false, seconds: 'abc', opened: 30, correctFlags: 3, wrongFlags: 1 });
  assert.deepEqual(lost, { value: 350, seconds: null, won: false });
});

test('검증기가 돌려주는 것: 깬 판은 점수·시간·won, 0점은 기록이 아니다(value null)', () => {
  assert.deepEqual(check({ won: true, seconds: 40, opened: 70, correctFlags: 10, wrongFlags: 0 }), { value: 3000, seconds: 40, won: true });
  assert.deepEqual(check({ won: false, opened: 0, correctFlags: 0, wrongFlags: 5 }), { value: null, seconds: null, won: false });
  // 판 크기는 순위표의 validator_params에서 읽는다: 중급은 180칸
  const normal = board('normal');
  assert.throws(() => check({ won: false, opened: 181, correctFlags: 0, wrongFlags: 0 }, normal), thrown(400, 'invalid_board_stats'));
  // 1800 + 720 + 1800 + (480-80)*10 = 8320
  assert.equal(check({ won: true, seconds: 80, opened: 180, correctFlags: 36, wrongFlags: 0 }, normal).value, 8320);
});

test('다시 계산한 점수도 순위표의 min_value~max_value 안이어야 한다 (스펙 5.9)', () => {
  const narrow = board('easy', { minValue: 100, maxValue: 3000 });
  assert.equal(check({ won: true, seconds: 40, opened: 70, correctFlags: 10, wrongFlags: 0 }, narrow).value, 3000);
  // 39.9초면 3001점이라 상한을 넘는다. 앱이 보낸 score는 보지 않는다
  assert.throws(() => check({ won: true, seconds: 39.9, opened: 70, correctFlags: 10, wrongFlags: 0, score: 3000 }, narrow), thrown(400, 'invalid_score'));
  assert.throws(() => check({ won: false, opened: 9, correctFlags: 0, wrongFlags: 0 }, narrow), thrown(400, 'invalid_score'), '90점은 하한 아래다');
  assert.equal(check({ won: false, opened: 10, correctFlags: 0, wrongFlags: 0 }, narrow).value, 100);
});

test('validator_params가 판 크기가 아니면 서버가 죽지 않고 503 board_unavailable로 답한다', () => {
  for (const params of [null, undefined, {}, { safe: 70, mines: 10 }, { safe: '70', mines: 10, par: 180 }, { safe: 0, mines: 10, par: 180 }, { safe: 70.5, mines: 10, par: 180 }, [70, 10, 180], 'x']) {
    assert.throws(() => check({ won: false, opened: 1, correctFlags: 0, wrongFlags: 0 }, board('easy', { validatorParams: params })), thrown(503, 'board_unavailable'), JSON.stringify(params));
  }
});

// ── 범위만 보는 검증기 (caps) ─────────────────────────────────────

const pinball: Board = { ...easy, id: 'pinball', gameId: 'pinball', validator: 'caps', validatorParams: null, maxCoinsPerRun: 400 };
const sprint: Board = { ...pinball, id: 'pinball.sprint', ordering: 'lower', minValue: 1, maxValue: 86_400 };

test('caps(higher): 점수는 min_value~max_value의 정수이고 0점은 기록이 아니다. 아니면 400 invalid_score', () => {
  assert.deepEqual(VALIDATORS.caps(pinball, { score: 31000 }), { value: 31000, seconds: null, won: null });
  assert.deepEqual(VALIDATORS.caps(pinball, { score: 0 }), { value: null, seconds: null, won: null });
  assert.equal(VALIDATORS.caps(pinball, { score: 5_000_000 }).value, 5_000_000);
  for (const score of [5_000_001, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', null, undefined, true, [1]]) {
    assert.throws(() => VALIDATORS.caps(pinball, { score }), thrown(400, 'invalid_score'), String(score));
  }
  // 상한과 하한은 순위표가 정한다
  const narrow = { ...pinball, minValue: 10, maxValue: 99 };
  assert.equal(VALIDATORS.caps(narrow, { score: 10 }).value, 10);
  assert.equal(VALIDATORS.caps(narrow, { score: 99 }).value, 99);
  assert.throws(() => VALIDATORS.caps(narrow, { score: 9 }), thrown(400, 'invalid_score'));
  assert.throws(() => VALIDATORS.caps(narrow, { score: 100 }), thrown(400, 'invalid_score'));
});

test('caps(lower): 깬 판만 기록이고 시간은 범위 안에서 0.1초로 반올림한다. 아니면 400 invalid_seconds', () => {
  assert.deepEqual(VALIDATORS.caps(sprint, { won: true, seconds: 40.04 }), { value: 40, seconds: 40, won: true });
  assert.deepEqual(VALIDATORS.caps(sprint, { won: true, seconds: 1 }), { value: 1, seconds: 1, won: true });
  assert.equal(VALIDATORS.caps(sprint, { won: true, seconds: 86_400 }).value, 86_400);
  for (const seconds of [0, 0.99, 86_401, -1, Number.NaN, '40', null, undefined]) {
    assert.throws(() => VALIDATORS.caps(sprint, { won: true, seconds }), thrown(400, 'invalid_seconds'), String(seconds));
  }
  // 못 깬 판은 기록이 없고 시간도 보지 않는다
  assert.deepEqual(VALIDATORS.caps(sprint, { won: false, seconds: -1 }), { value: null, seconds: null, won: false });
  assert.deepEqual(VALIDATORS.caps(sprint, {}), { value: null, seconds: null, won: false });
  assert.deepEqual(VALIDATORS.caps(sprint, { won: 'yes', seconds: 40 }), { value: null, seconds: null, won: false });
});

// ── 검증기 고르기 ───────────────────────────────────────────────

test('검증기는 이름으로 고르고, 모르는 이름은 없는 것이다 (객체에 딸린 이름에 속지 않는다)', () => {
  assert.equal(findValidator('caps'), VALIDATORS.caps);
  assert.equal(findValidator('minesweeper'), VALIDATORS.minesweeper);
  for (const name of ['tetris', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(findValidator(name), null, name);
});

test('순위표를 만들 때 검증기 설정을 본다: minesweeper는 { safe, mines, par }, caps는 설정이 없다', () => {
  assert.deepEqual(checkValidatorParams('minesweeper', { safe: 70, mines: 10, par: 180 }), { safe: 70, mines: 10, par: 180 });
  assert.equal(checkValidatorParams('caps', null), null);
  assert.equal(checkValidatorParams('caps', undefined), null);
  for (const params of [null, {}, { safe: 70, mines: 10 }, { safe: 70, mines: 10, par: 180, extra: 1 }, { safe: -1, mines: 10, par: 180 }, { safe: 70, mines: 10, par: '180' }]) {
    assert.throws(() => checkValidatorParams('minesweeper', params), thrown(400, 'invalid_validator_params'), JSON.stringify(params));
  }
  assert.throws(() => checkValidatorParams('caps', { safe: 70 }), thrown(400, 'invalid_validator_params'));
  assert.throws(() => checkValidatorParams('tetris', null), thrown(400, 'unknown_validator'));
});
