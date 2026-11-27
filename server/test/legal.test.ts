import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { devVerifier } from '../src/account/index.ts';
import { LEGAL_SOURCES } from '../src/legal.ts';
import { renderInline, renderLegalPage, renderMarkdown } from '../src/legal-markdown.ts';
import { buildServer } from '../src/server.ts';
import { testConfig } from './account/helpers.ts';
import { testDb } from './helpers/db.ts';

describe('약관 문서 → HTML', () => {
  it('서버가 내보내는 HTML이 docs/의 원본 문서와 같다 (문서를 고치면 npm run legal)', () => {
    for (const page of LEGAL_SOURCES) {
      const markdown = readFileSync(new URL(`../scripts/${page.doc}`, import.meta.url), 'utf8');
      const saved = readFileSync(new URL(`../src/legal/${page.file}`, import.meta.url), 'utf8');
      assert.equal(saved, renderLegalPage(markdown, page.path), `${page.file}가 원본과 다르다. server에서 npm run legal을 돌리세요`);
    }
  });

  it('제목·목록·표·굵게를 바꾸고, 문서 사이 링크는 서버 주소로 바꾼다', () => {
    const html = renderMarkdown('# 제목\n\n## 1. 절\n\n- 하나\n- **둘**\n\n1. 첫째\n2. 둘째\n\n| 가 | 나 |\n|---|---|\n| A<br>B | C |\n\n[방침](privacy-policy.md)을 보세요.');
    assert.match(html, /<h1>제목<\/h1>/);
    assert.match(html, /<h2>1\. 절<\/h2>/);
    assert.match(html, /<ul><li>하나<\/li><li><strong>둘<\/strong><\/li><\/ul>/);
    assert.match(html, /<ol><li>첫째<\/li><li>둘째<\/li><\/ol>/);
    assert.match(html, /<th>가<\/th><th>나<\/th>/);
    assert.match(html, /<td>A<br>B<\/td>/);
    assert.match(html, /<a href="\/privacy">방침<\/a>을 보세요/);
  });

  it('HTML을 이스케이프하고, 맨 주소와 이메일은 링크로 만든다', () => {
    assert.equal(renderInline('<script>x</script> & "y"'), '&lt;script&gt;x&lt;/script&gt; &amp; &quot;y&quot;');
    assert.equal(renderInline('https://a.example/p 참고'), '<a href="https://a.example/p">https://a.example/p</a> 참고');
    assert.equal(renderInline('이메일: me@example.com'), '이메일: <a href="mailto:me@example.com">me@example.com</a>');
  });
});

describe('약관 페이지 경로', () => {
  let base = '';
  let server: http.Server;
  let closeDb: () => Promise<void>;
  before(async () => {
    // v2 서버 전체를 띄운다. 허용 origin은 비워 둔다 (공개 페이지는 origin과 상관없이 나와야 한다)
    const { db, close } = await testDb();
    closeDb = close;
    const handler = buildServer({ db, config: { ...testConfig, allowedOrigins: [] }, now: () => new Date(), verify: devVerifier() });
    server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await closeDb();
  });

  it('GET /privacy · /terms는 HTML 페이지를 외부 리소스 차단 헤더와 함께 준다', async () => {
    for (const [path, title] of [
      ['/privacy', '아케이드박스 개인정보처리방침'],
      ['/terms', '아케이드박스 이용약관'],
    ]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html; charset=utf-8/);
      assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
      // Cloudflare가 이메일을 스크립트로 감추지 않게 (CSP가 그 스크립트를 막는다)
      assert.match(res.headers.get('cache-control') ?? '', /no-transform/);
      assert.match(await res.text(), new RegExp(`<title>${title}</title>`));
    }
  });

  it('테스터 모집 페이지(/test)는 그룹 가입·테스터 참여·설치 링크와 공유 미리보기 이미지를 준다', async () => {
    for (const path of ['/test', '/test/']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /<title>테스터 모집 · 아케이드박스<\/title>/);
      assert.match(html, /https:\/\/groups\.google\.com\/g\/arcadebox-testers/);
      assert.match(html, /https:\/\/play\.google\.com\/apps\/testing\/com\.geonbox\.arcadebox/);
      assert.match(html, /https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.geonbox\.arcadebox/);
      assert.match(html, /og:image" content="https:\/\/arcade-api\.geonbox\.com\/test\/og\.png"/);
      // 의견 보내기: 메일 앱(mailto)과 Gmail 작성 화면 모두 받는 사람이 채워진다
      assert.match(html, /href="mailto:leegeondev@gmail\.com\?subject=/);
      assert.match(html, /href="https:\/\/mail\.google\.com\/mail\/\?view=cm&amp;fs=1&amp;to=leegeondev@gmail\.com&amp;su=/);
    }
    // 브라우저는 같은 서버의 글꼴도 Origin을 붙여 요청한다 — 공개 페이지 자원은 origin과 상관없이 준다
    const font = await fetch(base + '/test/galmuri11-bold.woff2', { headers: { origin: 'https://arcade-api.geonbox.com' } });
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.match(font.headers.get('content-security-policy') ?? '', /font-src 'self'/);
    for (const path of ['/test/icon.png', '/test/og.png', '/test/game-pinball.png', '/test/game-minesweeper.png', '/test/game-breakout.png']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]); // 'PNG'
    }
  });

  it('탭 아이콘(파비콘)을 주고, 모든 공개 페이지가 그 아이콘을 가리킨다', async () => {
    for (const path of ['/favicon.ico', '/favicon-32.png', '/favicon-64.png', '/apple-touch-icon.png']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('content-type'), 'image/png');
    }
    for (const path of ['/test', '/privacy', '/terms']) {
      const html = await (await fetch(base + path)).text();
      assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32\.png">/, path);
      assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, path);
    }
  });

  it('공개 페이지의 헤더는 v1과 같다: CSP·nosniff·no-referrer·no-transform, GET과 HEAD, 허용하지 않은 origin에서도 (표 K2)', async () => {
    const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    for (const [path, type, maxAge] of [
      ['/privacy', 'text/html; charset=utf-8', 600],
      ['/terms', 'text/html; charset=utf-8', 600],
      ['/test', 'text/html; charset=utf-8', 600],
      ['/test/og.png', 'image/png', 86400],
      ['/favicon.ico', 'image/png', 604800],
      ['/test/galmuri11-bold.woff2', 'font/woff2', 604800],
    ] as const) {
      const get = await fetch(base + path, { headers: { origin: 'https://evil.example' } });
      const head = await fetch(base + path, { method: 'HEAD', headers: { origin: 'https://evil.example' } });
      const body = new Uint8Array(await get.arrayBuffer());
      for (const res of [get, head]) {
        assert.equal(res.status, 200, path);
        assert.equal(res.headers.get('content-type'), type, path);
        assert.equal(res.headers.get('cache-control'), `public, max-age=${maxAge}, no-transform`, path);
        assert.equal(res.headers.get('content-security-policy'), csp, path);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
        assert.equal(res.headers.get('content-length'), String(body.length), path);
        // CORS 허용 헤더는 붙지 않는다 (다른 사이트의 스크립트가 읽어 가지 못한다)
        assert.equal(res.headers.get('access-control-allow-origin'), null, path);
      }
      assert.equal((await head.arrayBuffer()).byteLength, 0, path);
    }
  });

  it('HEAD도 받고, 없는 경로는 그대로 404', async () => {
    const head = await fetch(base + '/privacy', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await fetch(base + '/privacy.html')).status, 404);
  });
});
