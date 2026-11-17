import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { MINIAPP_ORIGINS } from '../src/config.ts';
import { kstDate } from '../src/domain.ts';
import { TossPartnerClient, interpretExchange, type ExchangeResult, type PartnerApi } from '../src/partner.ts';
import { MemoryStore } from '../src/store-memory.ts';

/* ───────── 파트너 API 응답 봉투 판정 ───────── */

describe('interpretExchange', () => {
  it('SUCCESS 봉투에서 success.anonKey를 꺼낸다', () => {
    assert.deepEqual(interpretExchange({ status: 200, body: { resultType: 'SUCCESS', success: { anonKey: 'k1' } } }), {
      ok: true,
      anonKey: 'k1',
    });
  });
  it('HTTP 200 + resultType FAIL(4011)은 실패로 본다', () => {
    const r = interpretExchange({ status: 200, body: { resultType: 'FAIL', error: { errorCode: '4011', reason: 'x' } } });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.kind, 'invalid_code');
  });
  it('errorCode가 숫자로 와도 같게 판정한다', () => {
    const r = interpretExchange({ status: 200, body: { resultType: 'FAIL', error: { errorCode: 4011 } } });
    assert.equal(!r.ok && r.kind, 'invalid_code');
  });
  it('SUCCESS인데 anonKey가 없으면 실패', () => {
    assert.equal(interpretExchange({ status: 200, body: { resultType: 'SUCCESS', success: null } }).ok, false);
  });
  it('HTTP 400·500, OAuth형 error 문자열, 빈 본문은 모두 실패', () => {
    for (const res of [
      { status: 400, body: { resultType: 'FAIL', error: { errorCode: 'INVALID_PARAMETER' } } },
      { status: 500, body: { resultType: 'FAIL', error: { errorCode: '50000' } } },
      { status: 200, body: { error: 'invalid_grant' } },
      { status: 200, body: null },
    ]) {
      assert.equal(interpretExchange(res).ok, false, JSON.stringify(res));
    }
  });
});

/* ───────── 실제 HTTP 클라이언트가 문서대로 요청하는지 ───────── */

describe('TossPartnerClient 요청 형태', () => {
  it('POST /api-partner/v1/apps-in-toss/users/anon-key/exchange 에 {code}를 JSON으로 보낸다', async () => {
    let seen: { method?: string; url?: string; type?: string; body?: string } = {};
    const fake = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen = { method: req.method, url: req.url, type: req.headers['content-type'], body: Buffer.concat(chunks).toString() };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ resultType: 'SUCCESS', success: { anonKey: 'anon-xyz' } }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, r));
    const port = (fake.address() as AddressInfo).port;
    const client = new TossPartnerClient({ baseUrl: `http://127.0.0.1:${port}`, certPath: null, keyPath: null, timeoutMs: 2000 });
    const result = await client.exchangeAnonCode('code-123456');
    fake.close();
    assert.deepEqual(result, { ok: true, anonKey: 'anon-xyz' });
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/api-partner/v1/apps-in-toss/users/anon-key/exchange');
    assert.match(seen.type ?? '', /application\/json/);
    assert.deepEqual(JSON.parse(seen.body ?? ''), { code: 'code-123456' });
  });

  it('https 주소인데 인증서 경로가 없으면 시작하지 않는다', () => {
    assert.throws(() => new TossPartnerClient({ baseUrl: 'https://apps-in-toss-api.toss.im', certPath: null, keyPath: null, timeoutMs: 1000 }));
  });
});

/* ───────── 앱 전체 ───────── */

class FakePartner implements PartnerApi {
  map = new Map<string, ExchangeResult>();
  calls: string[] = [];
  async exchangeAnonCode(code: string): Promise<ExchangeResult> {
    this.calls.push(code);
    return this.map.get(code) ?? { ok: false, kind: 'invalid_code', errorCode: '4011' };
  }
}

let clock = new Date('2026-11-17T03:00:00Z'); // 12:00 KST
const store = new MemoryStore();
const partner = new FakePartner();
let base = '';
let server: http.Server;
const ORIGIN = MINIAPP_ORIGINS[0];

before(async () => {
  const handler = createApp({ store, partner, allowedOrigins: MINIAPP_ORIGINS, sessionTtlDays: 30, now: () => clock });
  server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function call(method: string, path: string, opts: { token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login(code: string, anonKey: string): Promise<string> {
  partner.map.set(code, { ok: true, anonKey });
  const r = await call('POST', '/v1/auth/exchange', { body: { code } });
  assert.equal(r.status, 200);
  return r.body.token as string;
}

const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

describe('인증', () => {
  it('교환 성공이면 세션을 주고, /v1/me가 그 사용자로 동작한다', async () => {
    const token = await login('code-alice-0001', 'anon-alice');
    const me = await call('GET', '/v1/me', { token });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.unlocked, ['pinball']);
    assert.equal(me.body.serverDate, '2026-11-17');
  });
  it('파트너가 FAIL을 주면 로그인을 거부하고 세션을 만들지 않는다', async () => {
    const before = store.sessions.size;
    const r = await call('POST', '/v1/auth/exchange', { body: { code: 'code-unknown-01' } });
    assert.equal(r.status, 401);
    assert.equal(store.sessions.size, before);
  });
  it('토큰이 없거나 틀리면 401', async () => {
    assert.equal((await call('GET', '/v1/me')).status, 401);
    assert.equal((await call('GET', '/v1/me', { token: 'x'.repeat(43) })).status, 401);
  });
  it('클라이언트가 보낸 식별키를 받는 경로가 없다 (교환만 신원이 된다)', async () => {
    const r = await call('POST', '/v1/auth/exchange', { body: { anonKey: 'anon-alice' } });
    assert.equal(r.status, 400);
  });
});

describe('CORS', () => {
  it('미니앱 origin만 그대로 돌려주고 * 를 쓰지 않는다', async () => {
    const r = await call('GET', '/healthz', { origin: MINIAPP_ORIGINS[1] });
    assert.equal(r.headers.get('access-control-allow-origin'), MINIAPP_ORIGINS[1]);
  });
  it('허용하지 않은 origin은 403', async () => {
    const r = await call('GET', '/healthz', { origin: 'https://evil.example.com' });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
});

describe('일일 보상 (서버 시간, 한국 기준)', () => {
  it('출석은 하루 한 번, 한국 시간 0시가 지나면 다시 받는다', async () => {
    const token = await login('code-bob-00001', 'anon-bob');
    const first = await call('POST', '/v1/me/attendance', { token, body: { gameId: 'pinball' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.coins.pinball, 50);
    assert.equal((await call('POST', '/v1/me/attendance', { token, body: { gameId: 'pinball' } })).status, 409);
    // 2026-11-17 15:30Z = 11-18 00:30 KST
    const saved = clock;
    clock = new Date('2026-11-17T15:30:00Z');
    assert.equal(kstDate(clock), '2026-11-18');
    const next = await call('POST', '/v1/me/attendance', { token, body: { gameId: 'pinball' } });
    assert.equal(next.status, 200);
    assert.equal(next.body.coins.pinball, 100);
    clock = saved;
  });
  it('잠긴 게임으로는 받지 못한다', async () => {
    const token = await login('code-bob-00002', 'anon-bob');
    assert.equal((await call('POST', '/v1/me/ad-reward', { token, body: { gameId: 'minesweeper' } })).status, 403);
  });
  it('광고 보상은 하루 3번', async () => {
    const token = await login('code-carol-001', 'anon-carol');
    for (let i = 0; i < 3; i++) {
      assert.equal((await call('POST', '/v1/me/ad-reward', { token, body: { gameId: 'pinball' } })).status, 200);
    }
    const fourth = await call('POST', '/v1/me/ad-reward', { token, body: { gameId: 'pinball' } });
    assert.equal(fourth.status, 429);
    const me = await call('GET', '/v1/me', { token });
    assert.equal(me.body.coins.pinball, 150);
    assert.equal(me.body.adRewardsLeft, 0);
  });
});

describe('판 기록·잠금 해제·리더보드', () => {
  it('핀볼 3만 점이면 지뢰찾기가 열리고 순위표에 오른다', async () => {
    const token = await login('code-dave-0001', 'anon-dave');
    const r = await call('POST', '/v1/me/runs', { token, body: { board: 'pinball', score: 31000, coins: 45 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.run.newlyUnlocked, ['minesweeper']);
    assert.equal(r.body.run.isBest, true);
    assert.equal(r.body.coins.pinball, 45);
    const lb = await call('GET', '/v1/leaderboards/pinball', { token });
    assert.equal(lb.body.me.rank, 1);
    assert.equal(lb.body.entries[0].me, true);
    assert.match(lb.body.entries[0].player, /^플레이어 [0-9A-F]{4}$/);
  });
  it('너무 빠른 연속 제출, 상한을 넘는 코인, 잘못된 점수는 거부', async () => {
    const token = await login('code-dave-0002', 'anon-dave');
    advance(5000);
    assert.equal((await call('POST', '/v1/me/runs', { token, body: { board: 'pinball', score: 100, coins: 0 } })).status, 200);
    assert.equal((await call('POST', '/v1/me/runs', { token, body: { board: 'pinball', score: 100, coins: 0 } })).status, 429);
    advance(5000);
    assert.equal((await call('POST', '/v1/me/runs', { token, body: { board: 'pinball', score: 100, coins: 9999 } })).status, 400);
    assert.equal((await call('POST', '/v1/me/runs', { token, body: { board: 'pinball', score: -5, coins: 0 } })).status, 400);
    assert.equal((await call('POST', '/v1/me/runs', { token, body: { board: 'pinball', score: 1.5, coins: 0 } })).status, 400);
  });
  it('지뢰찾기 중급은 초급을 깨야 열리고, 깬 판은 점수(연 칸·깃발·클리어·시간)로 매긴다', async () => {
    const dave = await login('code-dave-0003', 'anon-dave');
    advance(5000);
    assert.equal(
      (await call('POST', '/v1/me/runs', { token: dave, body: { board: 'minesweeper.normal', won: true, seconds: 80, opened: 180, correctFlags: 0, wrongFlags: 0, coins: 0 } })).status,
      403,
    );
    // 초급 70칸 모두, 깃발 10개 맞음, 40초: 700 + 200 + 700 + (180-40)*10 = 3000
    const win = await call('POST', '/v1/me/runs', {
      token: dave,
      body: { board: 'minesweeper.easy', won: true, seconds: 40, opened: 70, correctFlags: 10, wrongFlags: 0, coins: 25 },
    });
    assert.equal(win.status, 200);
    assert.equal(win.body.run.firstClear, true);
    assert.equal(win.body.run.best, 3000);
    assert.equal(win.body.bestScore['minesweeper.easy'], 3000);
    assert.equal(win.body.bestTime['minesweeper.easy'], 40);

    // 다른 사용자가 더 빨리 깸 → 점수가 더 높아 1등
    const erin = await login('code-erin-0001', 'anon-erin');
    advance(5000);
    await call('POST', '/v1/me/runs', { token: erin, body: { board: 'pinball', score: 30000, coins: 0 } });
    advance(5000);
    await call('POST', '/v1/me/runs', {
      token: erin,
      body: { board: 'minesweeper.easy', won: true, seconds: 30, opened: 70, correctFlags: 10, wrongFlags: 0, coins: 0 },
    });
    const lb = await call('GET', '/v1/leaderboards/minesweeper.easy', { token: dave });
    assert.equal(lb.body.order, 'higher');
    assert.equal(lb.body.entries[0].value, 3100);
    assert.equal(lb.body.me.rank, 2);
  });
  it('못 깬 판도 연 칸·깃발로 점수가 나고 순위에 오른다 (시간 보너스는 없음)', async () => {
    const fay = await login('code-fay-00099', 'anon-fay-ms');
    advance(5000);
    await call('POST', '/v1/me/import', { token: fay, body: { save: { best: { pinball: 30000 } } } });
    // 30칸 열고 깃발 3개 맞음, 1개 틀림: 300 + 60 - 10 = 350
    const lose = await call('POST', '/v1/me/runs', {
      token: fay,
      body: { board: 'minesweeper.easy', won: false, seconds: 12, opened: 30, correctFlags: 3, wrongFlags: 1, coins: 10 },
    });
    assert.equal(lose.status, 200);
    assert.equal(lose.body.run.best, 350);
    assert.equal(lose.body.cleared.includes('minesweeper.easy'), false);
    const lb = await call('GET', '/v1/leaderboards/minesweeper.easy', { token: fay });
    assert.equal(lb.body.me.value, 350);
  });
  it('불가능한 판 기록은 거부한다', async () => {
    const fay = await login('code-fay-00098', 'anon-fay-ms');
    const bad = [
      { won: false, opened: 71, correctFlags: 0, wrongFlags: 0 }, // 안전한 칸보다 많이 염
      { won: false, opened: 10, correctFlags: 11, wrongFlags: 0 }, // 지뢰보다 많은 맞은 깃발
      { won: false, opened: 65, correctFlags: 0, wrongFlags: 6 }, // 닫힌 안전한 칸(5)보다 많은 틀린 깃발
      { won: true, seconds: 30, opened: 69, correctFlags: 0, wrongFlags: 0 }, // 다 안 열었는데 깼다고 함
      { won: false, opened: 70, correctFlags: 0, wrongFlags: 0 }, // 다 열었는데 못 깼다고 함
      { won: false, opened: 1.5, correctFlags: 0, wrongFlags: 0 },
    ];
    for (const b of bad) {
      advance(5000);
      const r = await call('POST', '/v1/me/runs', { token: fay, body: { board: 'minesweeper.easy', coins: 0, ...b } });
      assert.equal(r.status, 400, JSON.stringify(b));
    }
  });
});

describe('상점', () => {
  it('코인이 모자라면 못 사고, 있으면 사서 장착한다', async () => {
    const token = await login('code-fay-00001', 'anon-fay');
    assert.equal((await call('POST', '/v1/me/items/pinball.ball.gold/buy', { token })).status, 409);
    assert.equal((await call('POST', '/v1/me/items/pinball.table.neon/buy', { token })).status, 400); // 유료 아이템
    assert.equal((await call('PUT', '/v1/me/equipped', { token, body: { itemId: 'pinball.ball.gold' } })).status, 403);
    await call('POST', '/v1/me/import', { token, body: { save: { coins: { pinball: 1200 } } } });
    const bought = await call('POST', '/v1/me/items/pinball.ball.gold/buy', { token });
    assert.equal(bought.status, 200);
    assert.equal(bought.body.coins.pinball, 200);
    assert.equal(bought.body.equipped['pinball.ball'], 'pinball.ball.gold');
    assert.equal((await call('POST', '/v1/me/items/pinball.ball.gold/buy', { token })).status, 409);
  });
});

describe('기기 데이터 가져오기', () => {
  it('처음 한 번만, 값마다 상한을 두고 가져온다', async () => {
    const token = await login('code-gus-00001', 'anon-gus');
    const r = await call('POST', '/v1/me/import', {
      token,
      body: {
        save: {
          coins: { pinball: 999999, minesweeper: 30 },
          best: { pinball: 32000 },
          bestTime: { 'minesweeper.easy': 50.04 },
          bestScore: { 'minesweeper.easy': 2600, 'minesweeper.hard': 99999999 },
          cleared: ['minesweeper.easy'],
          owned: ['pinball.table.sunset', 'not.a.real.item'],
          equipped: { 'pinball.table': 'pinball.table.sunset' },
          settings: { sound: false, haptic: 'yes' },
        },
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.coins.pinball, 20000);
    assert.ok(r.body.unlocked.includes('minesweeper'));
    assert.deepEqual(r.body.owned, ['pinball.table.sunset']);
    assert.equal(r.body.settings.sound, true, '잘못된 설정 묶음은 통째로 무시');
    assert.equal(r.body.imported, true);
    assert.equal((await call('POST', '/v1/me/import', { token, body: { save: { coins: { pinball: 5 } } } })).status, 409);
    assert.equal(r.body.bestScore['minesweeper.hard'], 336 * 10 + 80 * 20 + 336 * 10 + 900 * 10, '불가능한 점수는 상한으로');
    const lb = await call('GET', '/v1/leaderboards/minesweeper.easy', { token });
    assert.ok(lb.body.entries.some((e: { me: boolean; value: number }) => e.me && e.value === 2600));
  });
});
