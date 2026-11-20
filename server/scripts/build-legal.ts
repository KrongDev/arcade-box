// docs/의 약관 문서로 서버가 보여 줄 HTML 페이지를 만든다: npm run legal
// 문서를 고치면 이 스크립트를 다시 돌려 src/legal/*.html을 함께 커밋한다 (테스트가 둘이 같은지 확인한다)
import { readFileSync, writeFileSync } from 'node:fs';
import { LEGAL_SOURCES } from '../src/legal.ts';
import { renderLegalPage } from '../src/legal-markdown.ts';

for (const page of LEGAL_SOURCES) {
  const markdown = readFileSync(new URL(page.doc, import.meta.url), 'utf8');
  writeFileSync(new URL(`../src/legal/${page.file}`, import.meta.url), renderLegalPage(markdown, page.path));
  console.log(`[legal] ${page.path} ← docs/${page.doc.split('/').pop()}`);
}
