import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { sha256Hex } from '../../src/shared/crypto.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler, file, json, type Ctx, type Route, type Session } from '../../src/shared/http/index.ts';
import { fakeClock } from '../helpers/clock.ts';
import { call } from '../helpers/http.ts';

const ALLOWED = 'https://localhost';
const EVIL = 'https://evil.example.com';
const TOKEN = 'a'.repeat(43);
const EXPIRED_TOKEN = 'b'.repeat(43);
const USER: Session = { userId: '11111111-1111-4111-8111-111111111111', identityId: 7 };
const SESSION_ENDS = new Date('2026-12-26T00:00:00Z');

const dir = mkdtempSync(join(tmpdir(), 'arcade-http-'));
const ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
writeFileSync(join(dir, 'icon.png'), ICON);
after(() => rmSync(dir, { recursive: true, force: true }));

/** 테스트용 처리기. 경로마다 불린 횟수를 `hits`에 센다 */
function make(extra: { clientIpHeader?: string | null; withFallback?: boolean } = {}) {
  const clock = fakeClock('2026-11-26T03:00:00Z');
  const hits: Record<string, number> = {};
  const seen: Ctx[] = [];
  const route = (r: Omit<Route, 'handle'> & { handle?: Route['handle'] }): Route => ({
    ...r,
    handle: async (ctx) => {
      hits[r.path] = (hits[r.path] ?? 0) + 1;
      seen.push(ctx);
      return r.handle ? r.handle(ctx) : { ok: true };
    },
  });
  const routes: Route[] = [
    route({ method: 'GET', path: '/v2/open', auth: 'none', handle: async () => ({ hello: '세계' }) }),
    route({ method: 'GET', path: '/v2/me', auth: 'required', handle: async (ctx) => ({ session: ctx.session }) }),
    route({ method: 'GET', path: '/v2/maybe', auth: 'optional', handle: async (ctx) => ({ session: ctx.session }) }),
    route({ method: 'GET', path: '/v2/games/:id/versions/:version', auth: 'none', handle: async (ctx) => ({ params: ctx.params, q: ctx.query.get('q') }) }),
    route({ method: 'POST', path: '/v2/echo', auth: 'none', handle: async (ctx) => ({ got: await ctx.json() }) }),
    route({
      method: 'POST',
      path: '/v2/rule',
      auth: 'none',
      handle: async () => {
        throw new RuleError(409, 'x', '이미 있어요', { a: 1 });
      },
    }),
    route({
      method: 'POST',
      path: '/v2/boom',
      auth: 'none',
      handle: async () => {
        throw new Error('DB 비밀번호는 hunter2');
      },
    }),
    route({ method: 'POST', path: '/v2/limited', auth: 'none', limit: { by: 'ip', perMinute: 2 }, handle: async (ctx) => ({ ip: ctx.ip }) }),
    route({ method: 'POST', path: '/v2/limited-user', auth: 'required', limit: { by: 'user', perMinute: 1 } }),
    route({ method: 'GET', path: '/v2/icon', auth: 'none', handle: async () => file(join(dir, 'icon.png'), 'image/png', 'public, max-age=31536000, immutable') }),
    route({ method: 'GET', path: '/v2/gone', auth: 'none', handle: async () => file(join(dir, 'nope.png'), 'image/png') }),
    route({ method: 'GET', path: '/v2/cached', auth: 'none', handle: async () => json({ games: [] }, 'public, max-age=60') }),
    route({ method: 'POST', path: '/v2/nothing', auth: 'none', handle: async () => undefined }),
  ];
  const fallbackHits: string[] = [];
  const handler = createHandler(routes, {
    allowedOrigins: [ALLOWED, 'capacitor://localhost'],
    now: clock,
    clientIpHeader: extra.clientIpHeader,
    findSession: async (tokenHash, now) => {
      if (tokenHash === sha256Hex(TOKEN)) return USER;
      if (tokenHash === sha256Hex(EXPIRED_TOKEN)) return now < SESSION_ENDS ? { userId: '22222222-2222-4222-8222-222222222222', identityId: 8 } : null;
      return null;
    },
    fallback:
      extra.withFallback === false
        ? undefined
        : (req: IncomingMessage, res: ServerResponse) => {
            fallbackHits.push(`${req.method} ${req.url}`);
            if (req.url !== '/terms') return false;
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(req.method === 'HEAD' ? undefined : '<h1>약관</h1>');
            return true;
          },
  });
  return { handler, hits, seen, clock, fallbackHits };
}

function errorOf(body: unknown): { code: string; message: string } & Record<string, unknown> {
  return (body as { error: { code: string; message: string } }).error;
}

test('없는 경로는 404 not_found', async () => {
  const { handler } = make();
  for (const [method, path] of [
    ['GET', '/v2/nowhere'],
    ['POST', '/v2/open'], // 경로는 있지만 메서드가 다르다
    ['GET', '/v2/open/'],
    ['GET', '/v2/games/pinball/versions'],
  ]) {
    const r = await call(handler, method, path);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(errorOf(r.body).code, 'not_found');
    assert.match(errorOf(r.body).message, /요$/);
  }
});

test('이상하게 생긴 요청 주소도 500이 아니라 4xx로 답한다', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { handler, hits } = make();
  for (const path of ['//', '///', '//evil.example.com/v2/open', '/v2//open', '/%', '/v2/open%00', '/v2/open/../open', '/v2/games/%2e%2e/versions/1/..']) {
    const r = await call(handler, 'GET', path);
    assert.equal(r.status, 404, path);
    assert.equal(errorOf(r.body).code, 'not_found', path);
  }
  assert.deepEqual(hits, {});
  // 물음표 뒤가 깨져 있어도 경로는 찾는다
  assert.equal((await call(handler, 'GET', '/v2/open?x=%E0%A4%A&&=&y')).status, 200);
  assert.equal((await call(handler, 'GET', '/v2/open?')).status, 200);
  assert.equal(logged.mock.callCount(), 0);
});

test('본문을 다 보내기 전에 끊긴 요청은 조용히 끝난다 (500으로 기록하지 않는다)', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { handler, hits } = make();
  let handled = () => {};
  const settled = new Promise<void>((resolve) => {
    handled = resolve;
  });
  const server = http.createServer((req, res) => void handler(req, res).then(handled));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const socket = net.connect((server.address() as AddressInfo).port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('POST /v2/echo HTTP/1.1\r\nhost: localhost\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{"a":');
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();
    await settled;
    assert.equal(hits['/v2/echo'], 1);
    assert.equal(logged.mock.callCount(), 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('로그인이 필요한 경로에 토큰이 없거나 틀리면 401 unauthorized', async () => {
  const { handler, hits, clock } = make();
  const tries: Array<{ why: string; token?: string; headers?: Record<string, string> }> = [
    { why: '토큰 없음' },
    { why: '모르는 토큰', token: 'c'.repeat(43) },
    { why: '너무 짧은 토큰', token: 'short' },
    { why: 'base64url이 아닌 글자', token: `${'a'.repeat(42)}!` },
    { why: 'Bearer가 아님', headers: { authorization: `Basic ${TOKEN}` } },
  ];
  for (const t of tries) {
    const r = await call(handler, 'GET', '/v2/me', { token: t.token, headers: t.headers });
    assert.equal(r.status, 401, t.why);
    assert.equal(errorOf(r.body).code, 'unauthorized', t.why);
  }
  assert.equal(hits['/v2/me'], undefined);

  const ok = await call(handler, 'GET', '/v2/me', { token: TOKEN });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { session: USER });

  // 세션이 살아 있는지는 요청을 받은 시각으로 묻는다
  assert.equal((await call(handler, 'GET', '/v2/me', { token: EXPIRED_TOKEN })).status, 200);
  clock.set(SESSION_ENDS.toISOString());
  assert.equal((await call(handler, 'GET', '/v2/me', { token: EXPIRED_TOKEN })).status, 401);
});

test('auth가 optional이면 토큰이 없어도 처리기가 불리고 session은 null이다', async () => {
  const { handler, hits } = make();
  const r = await call(handler, 'GET', '/v2/maybe');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { session: null });
  assert.equal(hits['/v2/maybe'], 1);

  const withToken = await call(handler, 'GET', '/v2/maybe', { token: TOKEN });
  assert.deepEqual(withToken.body, { session: USER });
});

test('auth가 none이면 토큰을 보내도 세션을 찾지 않는다', async () => {
  const { handler, seen } = make();
  await call(handler, 'GET', '/v2/open', { token: TOKEN });
  assert.equal(seen[0].session, null);
  assert.equal(seen[0].tokenHash, null);
});

test('로그인한 요청의 ctx에는 토큰의 해시가 들어 있다 (원문은 없다)', async () => {
  const { handler, seen } = make();
  await call(handler, 'GET', '/v2/me', { token: TOKEN });
  assert.equal(seen[0].tokenHash, sha256Hex(TOKEN));
  assert.ok(!JSON.stringify(seen[0]).includes(TOKEN));
});

test('경로 변수(:id, :version)를 읽는다', async () => {
  const { handler, seen } = make();
  const r = await call(handler, 'GET', '/v2/games/pinball/versions/12?q=%ED%95%9C');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { params: { id: 'pinball', version: '12' }, q: '한' });
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].path, '/v2/games/pinball/versions/12');
  assert.equal(seen[0].now.toISOString(), '2026-11-26T03:00:00.000Z');

  // %로 적은 글자는 풀어서 준다. 그래서 처리기는 받은 값을 그대로 검사하면 된다
  const encoded = await call(handler, 'GET', '/v2/games/..%2F..%2Fetc/versions/1');
  assert.deepEqual((encoded.body as { params: unknown }).params, { id: '../../etc', version: '1' });
  // 풀 수 없는 %는 없는 경로로 본다
  assert.equal((await call(handler, 'GET', '/v2/games/%E0%A4%A/versions/1')).status, 404);
});

test('처리기가 돌려준 객체는 200 JSON으로 나간다', async () => {
  const { handler } = make();
  const r = await call(handler, 'GET', '/v2/open');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { hello: '세계' });
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(Number(r.headers['content-length']), r.raw.length);
  // 따로 정하지 않은 JSON 응답은 중간에서 보관하지 않게 한다
  assert.equal(r.headers['cache-control'], 'no-store');

  const nothing = await call(handler, 'POST', '/v2/nothing');
  assert.equal(nothing.status, 200);
  assert.deepEqual(nothing.body, {});
});

test('json()으로 답하면 cache-control을 정할 수 있다', async () => {
  const { handler } = make();
  const r = await call(handler, 'GET', '/v2/cached');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { games: [] });
  assert.equal(r.headers['cache-control'], 'public, max-age=60');
});

test('처리기가 RuleError(409, "x", "…", { a: 1 })를 던지면 409 { error: { code: "x", message, a: 1 } }', async () => {
  const { handler } = make();
  const r = await call(handler, 'POST', '/v2/rule');
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: { code: 'x', message: '이미 있어요', a: 1 } });
});

test('모르는 오류는 500 internal이고 오류 내용을 내보내지 않는다', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { handler } = make();
  const r = await call(handler, 'POST', '/v2/boom');
  assert.equal(r.status, 500);
  assert.equal(errorOf(r.body).code, 'internal');
  assert.ok(!r.raw.toString('utf8').includes('hunter2'));
  assert.deepEqual(Object.keys(r.body as object), ['error']);
  assert.deepEqual(Object.keys(errorOf(r.body)).sort(), ['code', 'message']);
  // 로그에는 메시지만 남는다 (스택도, 요청 내용도 없다)
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments, ['[server] unexpected error:', 'DB 비밀번호는 hunter2']);
});

test('본문이 64KB를 넘으면 413 body_too_large', async () => {
  const { handler, hits } = make();
  const limit = 64 * 1024;
  const exact = `{"a":"${'x'.repeat(limit - 8)}"}`;
  assert.equal(Buffer.byteLength(exact), limit);
  assert.equal((await call(handler, 'POST', '/v2/echo', { body: exact })).status, 200);

  const tooBig = `{"a":"${'x'.repeat(limit - 7)}"}`;
  const r = await call(handler, 'POST', '/v2/echo', { body: tooBig });
  assert.equal(r.status, 413);
  assert.equal(errorOf(r.body).code, 'body_too_large');

  // 길이를 알리지 않고 흘려보내도 같다
  const chunked = await call(handler, 'POST', '/v2/echo', { body: tooBig, headers: { 'transfer-encoding': 'chunked' } });
  assert.equal(chunked.status, 413);
  assert.equal(errorOf(chunked.body).code, 'body_too_large');
  assert.equal(hits['/v2/echo'], 3);
});

test('깨진 JSON은 400 invalid_json', async () => {
  const { handler } = make();
  for (const body of ['{"a":', 'not json', '{"a":1}}']) {
    const r = await call(handler, 'POST', '/v2/echo', { body });
    assert.equal(r.status, 400, body);
    assert.equal(errorOf(r.body).code, 'invalid_json', body);
  }
  const ok = await call(handler, 'POST', '/v2/echo', { body: { a: [1, '둘'] } });
  assert.deepEqual(ok.body, { got: { a: [1, '둘'] } });
});

test('허용한 origin에만 access-control-allow-origin을 준다', async () => {
  const { handler } = make();
  for (const origin of [ALLOWED, 'capacitor://localhost']) {
    const r = await call(handler, 'GET', '/v2/open', { origin });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], origin);
    assert.equal(r.headers.vary, 'origin');
  }
  const evil = await call(handler, 'GET', '/v2/open', { origin: EVIL });
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
  // 오류로 끝나는 응답에도 붙는다 (앱이 오류 내용을 읽을 수 있어야 한다)
  const notFound = await call(handler, 'GET', '/v2/nowhere', { origin: ALLOWED });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers['access-control-allow-origin'], ALLOWED);
});

test('허용하지 않은 origin의 요청은 403 origin_not_allowed이고 처리기가 불리지 않는다', async () => {
  const { handler, hits } = make();
  for (const [method, path] of [
    ['GET', '/v2/open'],
    ['POST', '/v2/echo'],
    ['OPTIONS', '/v2/echo'],
    ['GET', '/v2/nowhere'],
  ]) {
    const r = await call(handler, method, path, { origin: EVIL, body: method === 'POST' ? { a: 1 } : undefined });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(errorOf(r.body).code, 'origin_not_allowed');
  }
  // 허용한 origin과 앞부분만 같은 것도 안 된다
  assert.equal((await call(handler, 'GET', '/v2/open', { origin: `${ALLOWED}.evil.example.com` })).status, 403);
  assert.deepEqual(hits, {});
});

test('Origin 헤더가 없는 요청은 통과한다', async () => {
  const { handler } = make();
  const r = await call(handler, 'GET', '/v2/open');
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('GET·HEAD는 origin 검사보다 먼저 fallback에 물어본다: 허용하지 않은 origin이어도 fallback이 답한 것은 그대로 나간다', async () => {
  const { handler, fallbackHits } = make();
  const page = await call(handler, 'GET', '/terms', { origin: EVIL });
  assert.equal(page.status, 200);
  assert.equal(page.raw.toString('utf8'), '<h1>약관</h1>');
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  // 공개 페이지에는 CORS 허용 헤더를 붙이지 않는다 (다른 사이트의 스크립트가 읽어 갈 수 없다)
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  assert.equal((await call(handler, 'GET', '/terms', { origin: ALLOWED })).headers['access-control-allow-origin'], undefined);

  const head = await call(handler, 'HEAD', '/terms', { origin: EVIL });
  assert.equal(head.status, 200);
  assert.equal(head.raw.length, 0);

  // fallback이 답하지 않은 것은 평소 순서대로 간다: origin 검사 → 경로 표
  assert.equal((await call(handler, 'GET', '/v2/open', { origin: EVIL })).status, 403);
  assert.equal((await call(handler, 'GET', '/v2/open')).status, 200);
  // GET·HEAD가 아니면 fallback에 묻지 않는다
  assert.equal((await call(handler, 'POST', '/terms', { origin: EVIL })).status, 403);
  assert.equal((await call(handler, 'POST', '/terms')).status, 404);
  assert.deepEqual(fallbackHits, ['GET /terms', 'GET /terms', 'HEAD /terms', 'GET /v2/open', 'GET /v2/open']);
});

test('fallback이 없어도 돈다', async () => {
  const { handler } = make({ withFallback: false });
  assert.equal((await call(handler, 'GET', '/v2/open')).status, 200);
  assert.equal((await call(handler, 'GET', '/terms')).status, 404);
});

test('OPTIONS는 204이고 허용 헤더·메서드와 max-age 600이 붙는다', async () => {
  const { handler, hits } = make();
  const r = await call(handler, 'OPTIONS', '/v2/echo', {
    origin: ALLOWED,
    headers: { 'access-control-request-method': 'DELETE', 'access-control-request-headers': 'authorization' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.raw.length, 0);
  assert.equal(r.headers['access-control-allow-origin'], ALLOWED);
  assert.equal(r.headers['access-control-allow-headers'], 'authorization, content-type');
  assert.equal(r.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
  assert.equal(r.headers['access-control-max-age'], '600');
  assert.deepEqual(hits, {});
  // Origin이 없는 OPTIONS도 204다 (v1과 같다)
  assert.equal((await call(handler, 'OPTIONS', '/v2/nowhere')).status, 204);
});

test('본문이 비어 있으면 json()이 {}를 준다', async () => {
  const { handler } = make();
  const r = await call(handler, 'POST', '/v2/echo');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { got: {} });
});

test('auth가 optional인 경로에 틀린 토큰을 보내면 로그인하지 않은 것으로 본다', async () => {
  const { handler } = make();
  for (const token of ['c'.repeat(43), 'short']) {
    const r = await call(handler, 'GET', '/v2/maybe', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { session: null });
  }
});

test('분당 한도를 넘으면 429 rate_limited, 1분 뒤에는 다시 된다', async () => {
  const { handler, hits, clock } = make();
  const hit = (ip: string) => call(handler, 'POST', '/v2/limited', { ip });
  assert.equal((await hit('203.0.113.1')).status, 200);
  clock.advance(30_000);
  assert.equal((await hit('203.0.113.1')).status, 200);
  const third = await hit('203.0.113.1');
  assert.equal(third.status, 429);
  assert.equal(errorOf(third.body).code, 'rate_limited');
  assert.equal(hits['/v2/limited'], 2);
  // 다른 IP는 따로 센다
  assert.equal((await hit('203.0.113.2')).status, 200);
  // 첫 요청에서 1분이 되기 직전까지는 막히고, 1분이 되면 다시 된다
  clock.advance(29_999);
  assert.equal((await hit('203.0.113.1')).status, 429);
  clock.advance(1);
  assert.equal((await hit('203.0.113.1')).status, 200);
});

test('사용자 기준 한도는 같은 IP여도 사용자마다 따로 센다', async () => {
  const { handler } = make();
  const hit = (token: string) => call(handler, 'POST', '/v2/limited-user', { token, ip: '203.0.113.9' });
  assert.equal((await hit(TOKEN)).status, 200);
  assert.equal((await hit(TOKEN)).status, 429);
  assert.equal((await hit(EXPIRED_TOKEN)).status, 200);
});

test('요청 IP: 설정이 없으면 그 헤더를 보내도 무시한다', async () => {
  const { handler, seen } = make();
  const hit = (claimed: string) => call(handler, 'POST', '/v2/limited', { ip: '198.51.100.7', headers: { 'cf-connecting-ip': claimed, 'x-forwarded-for': claimed } });
  assert.equal((await hit('203.0.113.1')).status, 200);
  assert.equal((await hit('203.0.113.2')).status, 200);
  assert.equal((await hit('203.0.113.3')).status, 429);
  assert.deepEqual(seen.map((c) => c.ip), ['198.51.100.7', '198.51.100.7']);
});

test('요청 IP: 설정이 있으면 헤더의 IP로 한도를 센다', async () => {
  const { handler, seen } = make({ clientIpHeader: 'cf-connecting-ip' });
  // 소켓 주소는 모두 같다 (앞단 프록시의 것)
  const hit = (real: string) => call(handler, 'POST', '/v2/limited', { ip: '172.18.0.3', headers: { 'cf-connecting-ip': real } });
  assert.equal((await hit('203.0.113.1')).status, 200);
  assert.equal((await hit('203.0.113.1')).status, 200);
  assert.equal((await hit('203.0.113.1')).status, 429);
  assert.equal((await hit('2001:db8::1')).status, 200);
  assert.deepEqual(seen.map((c) => c.ip), ['203.0.113.1', '203.0.113.1', '2001:db8::1']);
});

test('요청 IP: 헤더 값이 IP가 아니면 소켓 주소로 센다', async () => {
  const { handler, seen } = make({ clientIpHeader: 'cf-connecting-ip' });
  const hit = (value?: string) => call(handler, 'POST', '/v2/limited', { ip: '172.18.0.3', headers: value === undefined ? {} : { 'cf-connecting-ip': value } });
  assert.equal((await hit('not-an-ip')).status, 200);
  assert.equal((await hit('203.0.113.1, 203.0.113.2')).status, 200);
  assert.equal((await hit('999.1.1.1')).status, 429);
  // 헤더가 없어도 소켓 주소다
  assert.equal((await hit()).status, 429);
  assert.deepEqual(seen.map((c) => c.ip), ['172.18.0.3', '172.18.0.3']);
});

test('file()로 답하면 파일 내용과 content-type, cache-control이 나간다', async () => {
  const { handler } = make();
  const r = await call(handler, 'GET', '/v2/icon', { origin: ALLOWED });
  assert.equal(r.status, 200);
  assert.deepEqual(r.raw, ICON);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(r.headers['content-length'], String(ICON.length));
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['access-control-allow-origin'], ALLOWED);
});

test('file()이 가리키는 파일이 없으면 404 not_found', async () => {
  const { handler } = make();
  const r = await call(handler, 'GET', '/v2/gone');
  assert.equal(r.status, 404);
  assert.equal(errorOf(r.body).code, 'not_found');
});
