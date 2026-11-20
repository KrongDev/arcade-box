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
      assert.match(await res.text(), new RegExp(`<title>${title}</title>`));
    }
  });

  it('HEAD도 받고, 없는 경로는 그대로 404', async () => {
    const head = await fetch(base + '/privacy', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await fetch(base + '/privacy.html')).status, 404);
  });
});
