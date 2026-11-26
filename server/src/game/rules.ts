import { RuleError } from '../shared/errors.ts';

/** 게임의 상태 (스펙 5.2). 상품의 상태와 낱말이 겹치지만 따로 바뀌는 다른 것이다 (스펙 5.15) */
export const GAME_STATUSES = ['draft', 'live', 'retired'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** 게임 버전의 상태: 올리기만 함 → 내보냄 → 문제가 있어 거둬들임 */
export const VERSION_STATUSES = ['uploaded', 'live', 'withdrawn'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** 게임 ID: 영문 소문자로 시작하는 소문자·숫자·`-` 2~32자. 묶음 경로(`bundles/<게임>/`)에 들어가므로 이 모양만 받는다 */
export const GAME_ID = /^[a-z][a-z0-9-]{1,31}$/;
/** 버전과 min_shell_api: PostgreSQL integer에 들어가는 양의 정수 */
export const INT_MAX = 2_147_483_647;

export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 1000;
export const SORT_MAX = 1_000_000;

const invalid = (name: string, message: string) => new RuleError(400, `invalid_${name}`, message);

export function isGameId(v: unknown): v is string {
  return typeof v === 'string' && GAME_ID.test(v);
}

export function checkGameId(v: unknown): string {
  if (!isGameId(v)) throw invalid('game_id', '게임 ID는 영문 소문자로 시작하는 소문자·숫자·- 2~32자예요 (예: pinball)');
  return v;
}

export function isVersion(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= INT_MAX;
}

export function checkVersion(v: unknown): number {
  if (!isVersion(v)) throw invalid('version', `버전은 1~${INT_MAX}의 정수예요`);
  return v;
}

export function checkMinShellApi(v: unknown): number {
  if (!isVersion(v)) throw invalid('min_shell_api', `min_shell_api는 1~${INT_MAX}의 정수예요`);
  return v;
}

/** 이름: 한 줄, 1~60자. 제어 문자(줄바꿈·탭 포함)는 받지 않는다 */
export function checkName(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(v)) {
    throw invalid('name', `이름은 한 줄로 1~${NAME_MAX}자예요`);
  }
  return v;
}

/**
 * 설명: 0~1000자. 여러 줄일 수 있어서 줄바꿈(LF, `\n`)만 받고 그 밖의 제어 문자(CR, 탭, NUL, ESC …)는 받지 않는다.
 * 명령줄에서는 셸이 넘겨 준 진짜 줄바꿈이 들어온다 (예: zsh·bash의 `$'첫 줄\n둘째 줄'`). `\n`이라는 두 글자를 풀어 주지는 않는다.
 * (상품의 설명도 같은 규칙이지만, 게임과 상품은 따로 바뀌는 것이라 같은 함수를 나눠 쓰지 않는다 — 스펙 5.15)
 */
export function checkDescription(v: unknown): string {
  if (typeof v !== 'string' || v.length > DESCRIPTION_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) {
    throw invalid('description', `설명은 ${DESCRIPTION_MAX}자까지이고, 줄바꿈 말고 다른 제어 문자는 넣을 수 없어요`);
  }
  return v;
}

export function checkSortOrder(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > SORT_MAX) throw invalid('sort_order', `순서는 0~${SORT_MAX}의 정수예요`);
  return v;
}

export function checkGameStatus(v: unknown): GameStatus {
  if (!(GAME_STATUSES as readonly unknown[]).includes(v)) throw invalid('status', `게임 상태는 ${GAME_STATUSES.join(', ')} 가운데 하나예요`);
  return v as GameStatus;
}

/** 서명: base64(또는 base64url) 글. 길이만 본다 — 맞는지는 서명 확인이 본다 */
export function checkSignature(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9+/_=-]{1,200}$/.test(v)) throw invalid('signature', '서명은 base64 글이에요');
  return v;
}

export const NOTES_MAX = 1000;

export function checkNotes(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > NOTES_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) {
    throw invalid('notes', `메모는 ${NOTES_MAX}자까지이고, 줄바꿈 말고 다른 제어 문자는 넣을 수 없어요`);
  }
  return v;
}

/**
 * 묶음 서명이 덮는 글 (스펙 5.8). 앱 쪽 서명 도구(2번 작업)가 같은 글에 서명하므로 한 글자도 바꾸지 않는다:
 * `arcade-box-bundle` · 게임 ID · 버전 · sha256(소문자 16진수) · 크기(바이트) · min_shell_api를 한 줄씩, 끝에도 줄바꿈.
 */
export function manifestText(m: { gameId: string; version: number; sha256: string; sizeBytes: number; minShellApi: number }): string {
  return 'arcade-box-bundle\n' + m.gameId + '\n' + m.version + '\n' + m.sha256 + '\n' + m.sizeBytes + '\n' + m.minShellApi + '\n';
}

/** 묶음 파일이 놓이는 곳 (dataDir 기준). 게임 ID와 버전은 모양을 확인한 값이어야 한다 */
export function bundleRelPath(gameId: string, version: number): string {
  return `bundles/${gameId}/${version}.zip`;
}
