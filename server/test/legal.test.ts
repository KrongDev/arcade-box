import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.ts';
import { LEGAL_SOURCES } from '../src/legal.ts';
import { renderInline, renderLegalPage, renderMarkdown } from '../src/legal-markdown.ts';
import { MemoryStore } from '../src/store-memory.ts';

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
  before(async () => {
    const handler = createApp({
      store: new MemoryStore(),
      partner: { exchangeAnonCode: async () => ({ ok: false, kind: 'invalid_code', errorCode: null }) },
      allowedOrigins: [],
      sessionTtlDays: 30,
    });
    server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

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

  it('HEAD도 받고, 없는 경로는 그대로 404', async () => {
    const head = await fetch(base + '/privacy', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await fetch(base + '/privacy.html')).status, 404);
  });
});
