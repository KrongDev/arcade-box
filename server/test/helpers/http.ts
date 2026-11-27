import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface CallOptions {
  /** 세션 토큰. `Authorization: Bearer <token>`으로 보낸다 */
  token?: string;
  /** 글자열·Buffer는 그대로, 그 밖은 JSON으로 바꿔 보낸다 */
  body?: unknown;
  origin?: string;
  /** 요청이 온 소켓 주소를 이 값으로 바꾼다 (요청 수 제한 테스트용). 없으면 127.0.0.1 */
  ip?: string;
  /** 더 붙일 헤더 */
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  /** JSON이면 풀어낸 값, 아니면 null */
  body: unknown;
  headers: Record<string, string>;
  raw: Buffer;
}

/**
 * 처리기를 진짜 HTTP로 한 번 부른다. 부를 때마다 이 컴퓨터(127.0.0.1)의 빈 포트에 서버를 띄웠다가 닫는다.
 */
export async function call(handler: Handler, method: string, path: string, opts: CallOptions = {}): Promise<CallResult> {
  const server = http.createServer((req, res) => {
    if (opts.ip !== undefined) Object.defineProperty(req.socket, 'remoteAddress', { value: opts.ip, configurable: true });
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
    if (opts.origin !== undefined) headers.origin = opts.origin;
    let payload: Buffer | null = null;
    if (opts.body !== undefined) {
      if (typeof opts.body === 'string' || Buffer.isBuffer(opts.body)) {
        payload = Buffer.from(opts.body);
      } else {
        payload = Buffer.from(JSON.stringify(opts.body));
        headers['content-type'] ??= 'application/json';
      }
    }
    return await new Promise<CallResult>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: (server.address() as AddressInfo).port, method, path, headers, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const out: Record<string, string> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (value !== undefined) out[name] = Array.isArray(value) ? value.join(', ') : value;
            }
            let body: unknown = null;
            if ((out['content-type'] ?? '').startsWith('application/json')) {
              try {
                body = JSON.parse(raw.toString('utf8'));
              } catch {
                body = null;
              }
            }
            resolve({ status: res.statusCode ?? 0, body, headers: out, raw });
          });
        },
      );
      req.on('error', reject);
      req.end(payload ?? undefined);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
