import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kstDate } from '../../src/shared/time.ts';

test('한국 날짜는 UTC 15시에 바뀐다', () => {
  assert.equal(kstDate(new Date('2026-11-25T14:59:59Z')), '2026-11-25');
  assert.equal(kstDate(new Date('2026-11-25T15:00:00Z')), '2026-11-26');
});

test('한국 날짜는 달과 해가 바뀌는 순간에도 맞다', () => {
  assert.equal(kstDate(new Date('2026-12-31T14:59:59.999Z')), '2026-12-31');
  assert.equal(kstDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.equal(kstDate(new Date('2028-02-28T15:00:00Z')), '2028-02-29');
  assert.equal(kstDate(new Date('2026-03-08T16:00:00Z')), '2026-03-09');
});
