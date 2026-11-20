import { readFileSync } from 'node:fs';

/**
 * 서버가 보여 주는 약관 페이지. 원본은 저장소의 docs/*.md이고, scripts/build-legal.ts가 만든
 * src/legal/*.html을 그대로 내보낸다 (서버 이미지에는 server/만 들어가서 docs/를 읽을 수 없다).
 */
export const LEGAL_SOURCES = [
  { path: '/privacy', file: 'privacy.html', doc: '../../docs/privacy-policy.md' },
  { path: '/terms', file: 'terms.html', doc: '../../docs/terms.md' },
] as const;

export type LegalPath = (typeof LEGAL_SOURCES)[number]['path'];

export function loadLegalPages(): Map<string, string> {
  return new Map(LEGAL_SOURCES.map((p) => [p.path, readFileSync(new URL(`./legal/${p.file}`, import.meta.url), 'utf8')]));
}
