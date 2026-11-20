import { readFileSync } from 'node:fs';
import { loadLegalPages } from './legal.ts';

/** 서버가 그대로 내보내는 공개 페이지 하나 (약관·테스터 모집 페이지와 그 이미지) */
export interface StaticAsset {
  type: string;
  body: Buffer;
  /** 브라우저·Cloudflare가 보관해도 되는 시간(초) */
  maxAge: number;
}

const HTML = 'text/html; charset=utf-8';

/** 브라우저 탭 아이콘(파비콘)과 테스터 모집 페이지 (src/pages/) */
const TESTER_FILES = [
  // 탭 아이콘: 30칸 픽셀 로고를 정수 배율로 그려 작은 크기에서도 또렷하다. /favicon.ico는 브라우저가 따로 찾는 기본 주소
  { paths: ['/favicon.ico', '/favicon-32.png'], file: 'favicon-32.png', type: 'image/png', maxAge: 604800 },
  { paths: ['/favicon-64.png'], file: 'favicon-64.png', type: 'image/png', maxAge: 604800 },
  { paths: ['/apple-touch-icon.png'], file: 'apple-touch-icon.png', type: 'image/png', maxAge: 604800 },
  { paths: ['/test', '/test/'], file: 'tester.html', type: HTML, maxAge: 600 },
  { paths: ['/test/icon.png'], file: 'icon.png', type: 'image/png', maxAge: 86400 },
  { paths: ['/test/og.png'], file: 'og.png', type: 'image/png', maxAge: 86400 },
  { paths: ['/test/game-pinball.png'], file: 'game-pinball.png', type: 'image/png', maxAge: 86400 },
  { paths: ['/test/game-minesweeper.png'], file: 'game-minesweeper.png', type: 'image/png', maxAge: 86400 },
  { paths: ['/test/game-breakout.png'], file: 'game-breakout.png', type: 'image/png', maxAge: 86400 },
  // 앱과 같은 픽셀 글꼴 Galmuri(SIL OFL) — 라이선스 전문을 함께 둔다
  { paths: ['/test/galmuri11-bold.woff2'], file: 'galmuri11-bold.woff2', type: 'font/woff2', maxAge: 604800 },
  { paths: ['/test/galmuri-ofl.txt'], file: 'galmuri-ofl.txt', type: 'text/plain; charset=utf-8', maxAge: 86400 },
] as const;

export function loadStaticPages(): Map<string, StaticAsset> {
  const pages = new Map<string, StaticAsset>();
  for (const [path, html] of loadLegalPages()) pages.set(path, { type: HTML, body: Buffer.from(html), maxAge: 600 });
  for (const f of TESTER_FILES) {
    const body = readFileSync(new URL(`./pages/${f.file}`, import.meta.url));
    for (const p of f.paths) pages.set(p, { type: f.type, body, maxAge: f.maxAge });
  }
  return pages;
}
