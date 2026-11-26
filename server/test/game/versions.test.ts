import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { addVersion, createGame, getVersion, manifestText } from '../../src/game/index.ts';
import { gameVersions } from '../../src/game/schema.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { gameKit, keyPair, rule, sha256Hex, signManifest, type GameKit } from './helpers.ts';

async function withGame(k: GameKit, id = 'pinball') {
  await k.db.transaction((tx) => createGame(tx, { id, name: '핀볼', description: '공을 튕겨요' }));
}

const add = (k: GameKit, input: Parameters<typeof addVersion>[1], env = k.env) => k.db.transaction((tx) => addVersion(tx, input, env));
const versionsOf = (db: Db, gameId: string) => db.select().from(gameVersions).where(eq(gameVersions.gameId, gameId)).orderBy(gameVersions.version);

/** dataDir/bundles 아래에 있는 파일 (게임/파일 이름). 디렉토리가 없으면 빈 배열 */
async function bundleFiles(dataDir: string): Promise<string[]> {
  const out: string[] = [];
  let games: string[];
  try {
    games = await readdir(join(dataDir, 'bundles'));
  } catch {
    return [];
  }
  for (const g of games) for (const f of await readdir(join(dataDir, 'bundles', g))) out.push(`${g}/${f}`);
  return out.sort();
}

test('manifestText는 앱의 서명 도구와 같은 글자열이다', () => {
  assert.equal(manifestText({ gameId: 'pinball', version: 3, sha256: 'ab', sizeBytes: 10, minShellApi: 1 }), 'arcade-box-bundle\npinball\n3\nab\n10\n1\n');
});

test('서명이 맞으면 uploaded로 등록되고 파일이 bundles/pinball/3.zip에 있다', async () => {
  const k = await gameKit();
  try {
    await withGame(k);
    const b = await k.bundle('pinball', 3, { minShellApi: 2 });
    const out = await add(k, { gameId: 'pinball', version: 3, filePath: b.filePath, signature: b.signature, minShellApi: 2, notes: '첫 버전' });
    assert.deepEqual(out, { version: 3, sha256: sha256Hex(b.bytes), sizeBytes: b.bytes.length });

    const rows = await versionsOf(k.db, 'pinball');
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { version: rows[0].version, status: rows[0].status, sha256: rows[0].sha256, sizeBytes: rows[0].sizeBytes, signature: rows[0].signature, minShellApi: rows[0].minShellApi, notes: rows[0].notes, publishedAt: rows[0].publishedAt },
      { version: 3, status: 'uploaded', sha256: out.sha256, sizeBytes: b.bytes.length, signature: b.signature, minShellApi: 2, notes: '첫 버전', publishedAt: null },
    );
    assert.deepEqual(await readFile(join(k.dataDir, 'bundles', 'pinball', '3.zip')), b.bytes);
    assert.deepEqual(await bundleFiles(k.dataDir), ['pinball/3.zip'], '임시 파일이 남지 않는다');
    // 경로는 dataDir 기준으로 적는다 (볼륨을 다른 곳에 붙여도 그대로 쓴다)
    assert.deepEqual(await getVersion(k.db, 'pinball', 3), { status: 'uploaded', bundlePath: 'bundles/pinball/3.zip' });
    assert.equal(await getVersion(k.db, 'pinball', 4), null);
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 31, Number.MAX_SAFE_INTEGER + 2]) assert.equal(await getVersion(k.db, 'pinball', bad), null, String(bad));
    assert.equal(await getVersion(k.db, '../pinball', 3), null);

    // 공개 키를 32바이트 그대로 적어도 된다
    const raw = Buffer.from(k.publicKey, 'base64').subarray(12).toString('base64');
    const b4 = await k.bundle('pinball', 4);
    await add(k, { gameId: 'pinball', version: 4, filePath: b4.filePath, signature: b4.signature, minShellApi: 1 }, { ...k.env, publicKey: raw });
    assert.equal((await getVersion(k.db, 'pinball', 4))?.status, 'uploaded');
  } finally {
    await k.close();
  }
});

test('서명한 뒤 파일을 한 바이트 바꾸면 409 bad_signature이고 등록되지 않는다', async () => {
  const k = await gameKit();
  try {
    await withGame(k);
    const b = await k.bundle('pinball', 3);
    const changed = Buffer.from(b.bytes);
    changed[changed.length - 1] ^= 0x01;
    await writeFile(b.filePath, changed);
    await assert.rejects(add(k, { gameId: 'pinball', version: 3, filePath: b.filePath, signature: b.signature, minShellApi: 1 }), rule(409, 'bad_signature'));
    assert.deepEqual(await versionsOf(k.db, 'pinball'), []);
    assert.deepEqual(await bundleFiles(k.dataDir), [], '그 자리에 파일이 남지 않는다');

    // 한 바이트 덧붙여도 마찬가지다 (크기도 서명 안에 있다)
    await writeFile(b.filePath, Buffer.concat([b.bytes, Buffer.from([0])]));
    await assert.rejects(add(k, { gameId: 'pinball', version: 3, filePath: b.filePath, signature: b.signature, minShellApi: 1 }), rule(409, 'bad_signature'));
    // 원래 파일로 되돌리면 같은 서명으로 등록된다
    await writeFile(b.filePath, b.bytes);
    await add(k, { gameId: 'pinball', version: 3, filePath: b.filePath, signature: b.signature, minShellApi: 1 });
    assert.deepEqual(await bundleFiles(k.dataDir), ['pinball/3.zip']);
  } finally {
    await k.close();
  }
});

test('다른 키로 서명했거나 min_shell_api를 바꿔 냈으면 bad_signature', async () => {
  const k = await gameKit();
  try {
    await withGame(k);
    await withGame(k, 'breakout');
    const b = await k.bundle('pinball', 3, { minShellApi: 1 });
    const sha256 = sha256Hex(b.bytes);
    const other = keyPair();
    const cases: Array<[string, Parameters<typeof addVersion>[1]]> = [
      ['다른 키', { gameId: 'pinball', version: 3, filePath: b.filePath, signature: signManifest(other.privateKey, { gameId: 'pinball', version: 3, sha256, sizeBytes: b.bytes.length, minShellApi: 1 }), minShellApi: 1 }],
      ['min_shell_api', { gameId: 'pinball', version: 3, filePath: b.filePath, signature: b.signature, minShellApi: 2 }],
      ['버전', { gameId: 'pinball', version: 4, filePath: b.filePath, signature: b.signature, minShellApi: 1 }],
      ['게임', { gameId: 'breakout', version: 3, filePath: b.filePath, signature: b.signature, minShellApi: 1 }],
      ['서명 한 글자', { gameId: 'pinball', version: 3, filePath: b.filePath, signature: (b.signature[0] === 'A' ? 'B' : 'A') + b.signature.slice(1), minShellApi: 1 }],
      ['서명이 아닌 글', { gameId: 'pinball', version: 3, filePath: b.filePath, signature: 'not-a-signature', minShellApi: 1 }],
    ];
    for (const [why, input] of cases) await assert.rejects(add(k, input), rule(409, 'bad_signature'), why);
    assert.deepEqual(await versionsOf(k.db, 'pinball'), []);
    assert.deepEqual(await versionsOf(k.db, 'breakout'), []);
    assert.deepEqual(await bundleFiles(k.dataDir), []);
  } finally {
    await k.close();
  }
});

test('공개 키 설정이 없으면 no_public_key', async () => {
  const k = await gameKit();
  try {
    await withGame(k);
    const b = await k.bundle('pinball', 1);
    await assert.rejects(add(k, { gameId: 'pinball', version: 1, filePath: b.filePath, signature: b.signature, minShellApi: 1 }, { ...k.env, publicKey: null }), rule(409, 'no_public_key'));
    assert.deepEqual(await versionsOf(k.db, 'pinball'), []);
    assert.deepEqual(await bundleFiles(k.dataDir), []);
  } finally {
    await k.close();
  }
});

test('이미 있는 버전이나 더 낮은 버전은 version_not_increasing', async () => {
  const k = await gameKit();
  try {
    await withGame(k);
    for (const v of [1, 5]) {
      const b = await k.bundle('pinball', v);
      await add(k, { gameId: 'pinball', version: v, filePath: b.filePath, signature: b.signature, minShellApi: 1 });
    }
    // 5를 회수(withdrawn)해도 5보다 커야 한다
    await k.db.update(gameVersions).set({ status: 'withdrawn' }).where(eq(gameVersions.version, 5));
    const before = await readFile(join(k.dataDir, 'bundles', 'pinball', '5.zip'));
    for (const v of [5, 4, 1]) {
      const b = await k.bundle('pinball', v, { content: `다른 내용 ${v}` });
      await assert.rejects(add(k, { gameId: 'pinball', version: v, filePath: b.filePath, signature: b.signature, minShellApi: 1 }), rule(409, 'version_not_increasing'), String(v));
    }
    assert.deepEqual(await readFile(join(k.dataDir, 'bundles', 'pinball', '5.zip')), before, '이미 있는 묶음 파일을 덮어쓰지 않는다');
    assert.deepEqual((await versionsOf(k.db, 'pinball')).map((r) => r.version), [1, 5]);
    // 다른 게임의 버전과는 상관없다
    await withGame(k, 'breakout');
    const b = await k.bundle('breakout', 1);
    await add(k, { gameId: 'breakout', version: 1, filePath: b.filePath, signature: b.signature, minShellApi: 1 });
  } finally {
    await k.close();
  }
});

test('게임 ID와 버전의 모양이 틀리면 경로를 만들기 전에 거절한다', async () => {
  const k = await gameKit();
  try {
    await withGame(k);
    const b = await k.bundle('pinball', 1);
    const base = { gameId: 'pinball', version: 1, filePath: b.filePath, signature: b.signature, minShellApi: 1 };
    const cases: Array<[Partial<typeof base>, string, number]> = [
      [{ gameId: '../etc' }, 'invalid_game_id', 400],
      [{ gameId: 'Pinball' }, 'invalid_game_id', 400],
      [{ gameId: 'pin/ball' }, 'invalid_game_id', 400],
      [{ gameId: 'nogame' }, 'not_found', 404],
      [{ version: 0 }, 'invalid_version', 400],
      [{ version: 1.5 }, 'invalid_version', 400],
      [{ version: -1 }, 'invalid_version', 400],
      [{ version: Number.NaN }, 'invalid_version', 400],
      [{ version: 2 ** 31 }, 'invalid_version', 400],
      [{ minShellApi: 0 }, 'invalid_min_shell_api', 400],
      [{ filePath: join(k.src, 'none.zip') }, 'bundle_not_found', 400],
      [{ filePath: k.src }, 'bundle_not_found', 400],
    ];
    for (const [patch, code, status] of cases) await assert.rejects(add(k, { ...base, ...patch }), rule(status, code), JSON.stringify(patch));
    assert.deepEqual(await bundleFiles(k.dataDir), []);
    assert.deepEqual(await readdir(k.dataDir), [], 'bundles 디렉토리조차 만들지 않는다');
  } finally {
    await k.close();
  }
});
