import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { iconUrl, routes, storeIcon } from '../../src/asset/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import { testConfig } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { call, type Handler } from '../helpers/http.ts';

const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

/** PNG 머리글자(8바이트) 뒤에 아무 바이트나 붙인 파일. 내용을 바꾸려면 `fill`을 다르게 준다 */
function png(size: number, fill = 7): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, fill)]);
}

/** WebP: `RIFF` · 크기 4바이트 · `WEBP` · 나머지 */
function webp(size: number): Buffer {
  const head = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  return Buffer.concat([head, Buffer.alloc(size - head.length, 3)]);
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** 테스트마다 쓰는 임시 디렉토리: 올릴 파일을 두는 곳과 서버의 dataDir. 저장소 안에는 아무것도 남기지 않는다 */
async function dirs(): Promise<{ src: string; dataDir: string; close(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'arcade-asset-'));
  const src = join(root, 'src');
  const dataDir = join(root, 'data');
  await mkdir(src);
  await mkdir(dataDir);
  return { src, dataDir, close: () => rm(root, { recursive: true, force: true }) };
}

function handler(dataDir: string): Handler {
  return createHandler(routes({ config: { ...testConfig, dataDir } }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: fakeClock('2026-11-26T03:00:00Z'),
    findSession: async () => null,
  });
}

test('PNG를 올리면 내용의 SHA-256이 이름이 되고, 같은 파일을 또 올리면 같은 이름이다', async () => {
  const d = await dirs();
  try {
    const bytes = png(1000);
    // 확장자를 믿지 않는다: 이름이 .bin이어도 머리글자가 PNG면 png다
    const path = join(d.src, 'icon.bin');
    await writeFile(path, bytes);

    const name = await storeIcon(d.dataDir, path);
    assert.equal(name, `${sha256(bytes)}.png`);
    assert.deepEqual(await readFile(join(d.dataDir, 'assets', name)), bytes);
    assert.equal(await storeIcon(d.dataDir, path), name);
    assert.deepEqual(await readdir(join(d.dataDir, 'assets')), [name], '같은 파일은 하나만 남는다 (임시 파일도 남지 않는다)');

    const w = webp(500);
    await writeFile(join(d.src, 'icon.png'), w);
    assert.equal(await storeIcon(d.dataDir, join(d.src, 'icon.png')), `${sha256(w)}.webp`, '이름이 .png여도 머리글자가 WebP면 webp다');

    // 딱 204,800바이트는 된다
    const edge = png(204_800, 9);
    await writeFile(join(d.src, 'edge.png'), edge);
    assert.equal(await storeIcon(d.dataDir, join(d.src, 'edge.png')), `${sha256(edge)}.png`);

    assert.equal(iconUrl(name), `/v2/assets/${name}`);
    assert.equal(iconUrl(null), null);
  } finally {
    await d.close();
  }
});

test('확장자만 png인 글 파일은 400 icon_type', async () => {
  const d = await dirs();
  try {
    const cases: Array<[string, Buffer]> = [
      ['text.png', Buffer.from('hello, this is not an image\n')],
      ['svg.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['gif.png', Buffer.from('GIF89a\x01\x00\x01\x00')],
      ['riff-wave.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(20)])],
      ['short.png', Buffer.from([0x89, 0x50, 0x4e])],
      ['empty.png', Buffer.alloc(0)],
    ];
    for (const [file, bytes] of cases) {
      await writeFile(join(d.src, file), bytes);
      await assert.rejects(storeIcon(d.dataDir, join(d.src, file)), rule(400, 'icon_type'), file);
    }
    await assert.rejects(storeIcon(d.dataDir, join(d.src, 'none.png')), rule(400, 'icon_not_found'), '없는 파일');
    await assert.rejects(storeIcon(d.dataDir, d.src), rule(400, 'icon_not_found'), '디렉토리');
    assert.deepEqual(await readdir(d.dataDir), [], '거절하면 저장하지 않는다');
  } finally {
    await d.close();
  }
});

test('204,801바이트 파일은 400 icon_too_large', async () => {
  const d = await dirs();
  try {
    await writeFile(join(d.src, 'big.png'), png(204_801));
    await assert.rejects(storeIcon(d.dataDir, join(d.src, 'big.png')), rule(400, 'icon_too_large'));
    assert.deepEqual(await readdir(d.dataDir), [], '거절하면 저장하지 않는다');
  } finally {
    await d.close();
  }
});

test('올린 아이콘을 GET으로 받으면 내용이 같고 content-type과 오래 캐시하는 헤더가 있다', async () => {
  const d = await dirs();
  try {
    const bytes = png(3000);
    await writeFile(join(d.src, 'a.png'), bytes);
    const name = await storeIcon(d.dataDir, join(d.src, 'a.png'));
    const w = webp(700);
    await writeFile(join(d.src, 'b.webp'), w);
    const wname = await storeIcon(d.dataDir, join(d.src, 'b.webp'));

    const h = handler(d.dataDir);
    const res = await call(h, 'GET', iconUrl(name)!);
    assert.equal(res.status, 200);
    assert.deepEqual(res.raw, bytes);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');

    const wres = await call(h, 'GET', iconUrl(wname)!);
    assert.equal(wres.status, 200);
    assert.deepEqual(wres.raw, w);
    assert.equal(wres.headers['content-type'], 'image/webp');

    // 로그인 없이 받는다. 틀린 토큰을 보내도 그대로 준다
    assert.equal((await call(h, 'GET', iconUrl(name)!, { token: 'x'.repeat(43) })).status, 200);
    // 모양은 맞지만 올린 적 없는 이름
    const missing = await call(h, 'GET', `/v2/assets/${'0'.repeat(64)}.png`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: { code: 'not_found', message: '없는 파일이에요' } });
  } finally {
    await d.close();
  }
});

for (const name of ['../config.ts', '..%2F..%2Fetc%2Fpasswd', 'a.png', `${'a'.repeat(64)}.svg`]) {
  test(`${name}: 404이고 파일을 내주지 않는다`, async () => {
    const d = await dirs();
    try {
      // 이름이 가리킬 수 있는 곳마다 진짜 파일을 둔다. 그래도 내주지 않아야 한다
      const secret = Buffer.from('SECRET-CONTENT-123');
      await mkdir(join(d.dataDir, 'assets'), { recursive: true });
      await writeFile(join(d.dataDir, 'config.ts'), secret);
      await writeFile(join(d.dataDir, 'assets', 'a.png'), secret);
      await writeFile(join(d.dataDir, 'assets', `${'a'.repeat(64)}.svg`), secret);

      const res = await call(handler(d.dataDir), 'GET', `/v2/assets/${name}`);
      assert.equal(res.status, 404);
      assert.equal((res.body as { error: { code: string } }).error.code, 'not_found');
      assert.ok(!res.raw.includes(secret), '파일 내용이 나가지 않는다');
      assert.ok(!res.raw.toString('utf8').includes('root:'), '/etc/passwd도 나가지 않는다');
    } finally {
      await d.close();
    }
  });
}
