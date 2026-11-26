import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuleError } from '../../src/shared/errors.ts';
import { bool, idempotencyKey, int, obj, str } from '../../src/shared/validate.ts';

/** 400이고 code가 맞는 RuleError인지 */
function invalid(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof RuleError, `RuleError가 아니에요: ${String(err)}`);
    assert.equal(err.status, 400);
    assert.equal(err.code, code);
    assert.match(err.message, /요$/);
    return true;
  };
}

test('int는 범위 안의 정수만 받는다', () => {
  for (const bad of [NaN, Infinity, 1.5, -1, '3', null]) assert.throws(() => int(bad, 'coins', { min: 0, max: 400 }), /invalid_coins/);
  for (const bad of [401, -Infinity, undefined, true, [3], {}, 2 ** 53]) assert.throws(() => int(bad, 'coins', { min: 0, max: 400 }), invalid('invalid_coins'));
  assert.equal(int(0, 'coins', { min: 0, max: 400 }), 0);
  assert.equal(int(400, 'coins', { min: 0, max: 400 }), 400);
  assert.equal(int(-3, 'delta', { min: -5, max: 5 }), -3);
});

test('str은 길이와 모양이 맞는 글자열만 받는다', () => {
  assert.equal(str('pinball', 'id', { min: 2, max: 32 }), 'pinball');
  assert.equal(str('pin-ball', 'id', { min: 2, max: 32, pattern: /^[a-z][a-z0-9-]+$/ }), 'pin-ball');
  for (const bad of ['p', 'x'.repeat(33), 7, null, undefined, ['pinball'], {}]) assert.throws(() => str(bad, 'id', { min: 2, max: 32 }), invalid('invalid_id'));
  assert.throws(() => str('Pinball', 'id', { min: 2, max: 32, pattern: /^[a-z][a-z0-9-]+$/ }), invalid('invalid_id'));
  assert.equal(str('', 'note', { min: 0, max: 10 }), '');
});

test('str은 제어 문자가 든 글자열을 받지 않는다 (NUL은 PostgreSQL text에 넣을 수 없다)', () => {
  for (const bad of ['a\u0000b', '\u0000', 'a\nb', 'a\r\nb', '\tx', 'x\u001f', 'x\u007f', '\u001b[31m빨강']) {
    assert.throws(() => str(bad, 'board_id', { min: 1, max: 64 }), invalid('invalid_board_id'), JSON.stringify(bad));
  }
  // pattern이 받아 주더라도 안 된다
  assert.throws(() => str('a\u0000b', 'id', { min: 1, max: 64, pattern: /^[\s\S]+$/ }), invalid('invalid_id'));
  for (const ok of ['한 글', 'a b', 'émoji 🎮', '줄 없는 긴 설명. 쉼표, 마침표!']) assert.equal(str(ok, 'name', { min: 1, max: 64 }), ok);
});

test('bool은 참/거짓만 받는다', () => {
  assert.equal(bool(true, 'sound'), true);
  assert.equal(bool(false, 'sound'), false);
  for (const bad of [0, 1, 'true', null, undefined, {}]) assert.throws(() => bool(bad, 'sound'), invalid('invalid_sound'));
});

test('obj는 배열과 null이 아닌 객체만 받는다', () => {
  assert.deepEqual(obj({ a: 1 }, 'body'), { a: 1 });
  for (const bad of [null, undefined, [], [1], 'x', 3, true]) assert.throws(() => obj(bad, 'body'), invalid('invalid_body'));
});

test('idempotencyKey는 없으면 null, 있으면 8~64자의 영문·숫자·_·-만 받는다', () => {
  assert.equal(idempotencyKey(undefined), null);
  assert.equal(idempotencyKey(null), null);
  for (const bad of ['short', 'a'.repeat(65), 'has space!', 12345678]) assert.throws(() => idempotencyKey(bad));
  for (const bad of ['', '1234567', '한글로쓴키12345678', 'abcd/efgh', true, {}]) assert.throws(() => idempotencyKey(bad), invalid('invalid_idempotency_key'));
  for (const ok of ['12345678', 'a'.repeat(64), 'run_2026-11-26_AbC', '3f2a9c1e-7b4d-4e8a-9c1e-7b4d4e8a9c1e']) assert.equal(idempotencyKey(ok), ok);
});
