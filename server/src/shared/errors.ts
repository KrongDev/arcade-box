import { DrizzleQueryError } from 'drizzle-orm/errors';

/**
 * 규칙을 어겨서 거절하는 오류. HTTP에서는 `{ error: { code, message, ...detail } }`로 나가고,
 * 명령줄에서는 메시지만 보여 준다. 메시지는 사용자와 운영자가 읽는 글이라 해요체로 쓴다.
 */
export class RuleError extends Error {
  status: number;
  code: string;
  detail?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'RuleError';
    this.status = status;
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }

  /** 글로 바꾸면 코드가 함께 보인다 (로그와 테스트에서 어떤 거절인지 알아보려고) */
  override toString(): string {
    return `RuleError(${this.status} ${this.code}): ${this.message}`;
  }
}

/**
 * 모르는 오류를 로그에 남길 때 쓰는 한 줄. 요청에서 온 값(토큰, 영수증, 사용자 ID)이 로그에 남지 않게 한다.
 *
 * Drizzle은 쿼리가 실패하면 메시지를 `Failed query: <SQL> params: <넣은 값들>`로 만든다. 그 메시지는 버리고
 * 속에 든 PostgreSQL 오류의 코드와 메시지만 남긴다. 코드가 22로 시작하는 것(값이 타입에 맞지 않음)은
 * PostgreSQL 메시지에도 그 값이 들어가서(`invalid input syntax for type integer: "…"`) 코드만 남긴다.
 */
export function safeMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (!(err instanceof DrizzleQueryError)) return err.message;
  const cause: (Error & { code?: unknown }) | undefined = err.cause;
  if (!cause) return 'DB 쿼리 실패';
  const code = typeof cause.code === 'string' ? cause.code : '';
  if (/^22[0-9A-Z]{3}$/.test(code)) return `DB 오류 ${code} (메시지에 넣은 값이 들어가는 종류라 코드만 남겨요)`;
  return `DB 오류${code ? ` ${code}` : ''}${cause.message ? `: ${cause.message}` : ''}`;
}
