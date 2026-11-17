import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

/**
 * 앱인토스 파트너 API 클라이언트.
 * 실제 API는 mTLS 클라이언트 인증서를 실어야 한다 (https.Agent의 cert/key).
 * 인증서·키는 파일 경로로만 다루고 내용은 로그나 응답에 남기지 않는다.
 */

export type ExchangeResult =
  | { ok: true; anonKey: string }
  | { ok: false; kind: 'invalid_code' | 'rate_limited' | 'upstream'; errorCode: string | null };

export interface PartnerApi {
  exchangeAnonCode(code: string): Promise<ExchangeResult>;
}

const EXCHANGE_PATH = '/api-partner/v1/apps-in-toss/users/anon-key/exchange';

interface RawResponse {
  status: number;
  body: unknown;
}

/** 파트너 API 응답 봉투를 판정한다. HTTP 200이어도 resultType이 FAIL일 수 있다 */
export function interpretExchange(res: RawResponse): ExchangeResult {
  const body = (res.body ?? {}) as Record<string, unknown>;
  const success = body.success as Record<string, unknown> | null | undefined;
  if (res.status === 200 && body.resultType === 'SUCCESS' && success && typeof success.anonKey === 'string' && success.anonKey) {
    return { ok: true, anonKey: success.anonKey };
  }
  const error = body.error as Record<string, unknown> | string | undefined;
  const rawCode = error && typeof error === 'object' ? error.errorCode : null;
  // 문서마다 숫자·문자열 표기가 달라 둘 다 받는다
  const errorCode = rawCode === null || rawCode === undefined ? null : String(rawCode);
  if (errorCode === '4011') return { ok: false, kind: 'invalid_code', errorCode };
  if (errorCode === '4095') return { ok: false, kind: 'rate_limited', errorCode };
  return { ok: false, kind: 'upstream', errorCode: errorCode ?? (typeof error === 'string' ? error : `http_${res.status}`) };
}

export interface PartnerConfig {
  baseUrl: string;
  certPath: string | null;
  keyPath: string | null;
  timeoutMs: number;
}

export class TossPartnerClient implements PartnerApi {
  private base: URL;
  private agent: https.Agent | null;
  private timeoutMs: number;

  constructor(config: PartnerConfig) {
    this.base = new URL(config.baseUrl);
    this.timeoutMs = config.timeoutMs;
    if (this.base.protocol === 'https:') {
      if (!config.certPath || !config.keyPath) {
        throw new Error('파트너 API mTLS 인증서 경로(TOSS_MTLS_CERT_PATH, TOSS_MTLS_KEY_PATH)가 없어요');
      }
      this.agent = new https.Agent({
        cert: readFileSync(config.certPath),
        key: readFileSync(config.keyPath),
        keepAlive: true,
      });
    } else {
      // 로컬 개발용 가짜 파트너(mock-partner)만 http를 쓴다. 운영 설정에서는 config가 막는다
      this.agent = null;
    }
  }

  private post(path: string, payload: unknown): Promise<RawResponse> {
    const url = new URL(path, this.base);
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      timeout: this.timeoutMs,
    };
    return new Promise((resolve, reject) => {
      const onResponse = (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      };
      const req = this.agent
        ? https.request(url, { ...options, agent: this.agent }, onResponse)
        : http.request(url, options, onResponse);
      req.on('timeout', () => req.destroy(new Error('partner_timeout')));
      req.on('error', reject);
      req.end(data);
    });
  }

  async exchangeAnonCode(code: string): Promise<ExchangeResult> {
    try {
      const res = await this.post(EXCHANGE_PATH, { code });
      return interpretExchange(res);
    } catch (err) {
      // TLS·연결 오류: 인증서나 바인딩 문제일 수 있다. 원문은 서버 로그에만
      console.error('[partner] exchange request failed:', (err as Error).message);
      return { ok: false, kind: 'upstream', errorCode: 'network' };
    }
  }
}
