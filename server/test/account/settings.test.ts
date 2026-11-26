import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSettings, registerOrLoginGuest, updateSettings } from '../../src/account/index.ts';
import { userSettings } from '../../src/account/schema.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { accountHandler, deviceSecret, TTL_DAYS } from './helpers.ts';

const NOW = new Date('2026-11-26T03:00:00Z');

const invalidSettings = (err: unknown) => err instanceof RuleError && err.status === 400 && err.code === 'invalid_settings';

test('설정은 처음에 둘 다 켜져 있고, 보낸 것만 바뀐다', async () => {
  const { db, close } = await testDb();
  try {
    const { userId } = await registerOrLoginGuest(db, deviceSecret(), NOW, TTL_DAYS);
    const other = await registerOrLoginGuest(db, deviceSecret(), NOW, TTL_DAYS);
    assert.deepEqual(await getSettings(db, userId), { sound: true, haptic: true });

    assert.deepEqual(await updateSettings(db, userId, { sound: false }), { sound: false, haptic: true });
    assert.deepEqual(await getSettings(db, userId), { sound: false, haptic: true });
    assert.deepEqual(await updateSettings(db, userId, { haptic: false }), { sound: false, haptic: false });
    assert.deepEqual(await updateSettings(db, userId, { sound: true, haptic: true }), { sound: true, haptic: true });
    // 빈 요청은 아무것도 바꾸지 않는다
    assert.deepEqual(await updateSettings(db, userId, { haptic: false }), { sound: true, haptic: false });
    assert.deepEqual(await updateSettings(db, userId, {}), { sound: true, haptic: false });

    assert.equal((await db.select().from(userSettings)).length, 1);
    assert.deepEqual(await getSettings(db, other.userId), { sound: true, haptic: true }, '다른 사용자의 설정은 그대로다');
  } finally {
    await close();
  }
});

test('설정은 sound·haptic의 참/거짓만 받고, 다른 키나 다른 타입은 400 invalid_settings로 전부 거절한다', async () => {
  const { db, close } = await testDb();
  try {
    const { userId, token } = await registerOrLoginGuest(db, deviceSecret(), NOW, TTL_DAYS);
    await updateSettings(db, userId, { sound: false, haptic: true });

    const bad: unknown[] = [
      { sound: 'true' },
      { sound: 1 },
      { sound: null },
      { haptic: 0 },
      { haptic: [] },
      // 맞는 값과 틀린 값이 섞이면 하나도 반영하지 않는다 (K19)
      { sound: true, haptic: 'no' },
      { sound: true, volume: 3 },
      // 모르는 키: v1은 못 본 척했고 v2는 거절한다
      { vibration: true },
      { sound: true, haptic: false, extra: false },
      { __proto__: null, sound: true, constructor: true },
      null,
      undefined,
      'sound',
      7,
      [],
      [{ sound: true }],
    ];
    for (const patch of bad) {
      await assert.rejects(updateSettings(db, userId, patch), invalidSettings, JSON.stringify(patch));
      assert.deepEqual(await getSettings(db, userId), { sound: false, haptic: true }, `그대로여야 해요: ${JSON.stringify(patch)}`);
    }

    // HTTP로도 같다
    const handler = accountHandler(db, fakeClock(NOW.toISOString()));
    const rejected = await call(handler, 'PUT', '/v2/me/settings', { token, body: { sound: true, theme: 'dark' } });
    assert.equal(rejected.status, 400);
    assert.equal((rejected.body as { error: { code: string } }).error.code, 'invalid_settings');
    assert.equal((await call(handler, 'PUT', '/v2/me/settings', { token, body: [true] })).status, 400);
    assert.deepEqual(await getSettings(db, userId), { sound: false, haptic: true });

    const ok = await call(handler, 'PUT', '/v2/me/settings', { token, body: { sound: true, haptic: false } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { settings: { sound: true, haptic: false } });
    assert.deepEqual(await getSettings(db, userId), { sound: true, haptic: false });
  } finally {
    await close();
  }
});
