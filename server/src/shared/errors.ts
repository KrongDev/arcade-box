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
