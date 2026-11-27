import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { sha256Hex } from '../crypto.ts';
import { RuleError, safeMessage } from '../errors.ts';
import type { Clock } from '../time.ts';
import { hasControlChars } from '../validate.ts';
import { createRateLimiter } from './rate-limit.ts';

/** 로그인한 사용자와, 어느 로그인 수단(기기)으로 들어왔는지 */
export interface Session {
  userId: string;
  identityId: number;
}

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  /** 경로의 `:이름` 자리에 온 값 (%로 적은 글자는 풀어서 준다) */
  params: Record<string, string>;
  session: Session | null;
  /** 세션 토큰의 SHA-256. 로그아웃처럼 "이 세션"을 가리켜야 할 때 쓴다. 세션이 없으면 null */
  tokenHash: string | null;
  ip: string;
  /** 이 요청을 받은 시각 */
  now: Date;
  /** 요청 본문을 JSON으로 읽는다. 비어 있으면 `{}` */
  json(): Promise<unknown>;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 예: `/v2/games/:id/versions/:version/bundle` */
  path: string;
  /** none: 세션을 보지 않는다 · optional: 있으면 쓰고 틀리면 없는 것으로 본다 · required: 없거나 틀리면 401 */
  auth: 'none' | 'optional' | 'required';
  /**
   * 분당 요청 수 제한. `ip`는 세션을 찾아보기 전에 센다. `user`는 로그인한 사용자별로 세고,
   * 로그인하지 못한 요청(401로 끝나는 것 포함)은 IP로 센다
   */
  limit?: { by: 'ip' | 'user'; perMinute: number };
  /** 돌려준 값은 200 JSON으로 나간다. 파일이나 캐시 헤더가 필요하면 `file()`, `json()`을 돌려준다 */
  handle(ctx: Ctx): Promise<unknown>;
}

const REPLY = Symbol('reply');

interface FileReply {
  [REPLY]: 'file';
  path: string;
  contentType: string;
  cacheControl?: string;
}

interface JsonReply {
  [REPLY]: 'json';
  body: unknown;
  cacheControl: string;
}

/** 파일로 답하기 (게임 묶음, 아이콘). 파일을 메모리에 올리지 않고 흘려보낸다 */
export function file(path: string, contentType: string, cacheControl?: string): FileReply {
  return { [REPLY]: 'file', path, contentType, cacheControl };
}

/** cache-control을 정해서 JSON으로 답하기. 정하지 않은 JSON 응답은 `no-store`로 나간다 */
export function json(body: unknown, cacheControl: string): JsonReply {
  return { [REPLY]: 'json', body, cacheControl };
}

function replyKind(value: unknown): 'file' | 'json' | null {
  if (typeof value !== 'object' || value === null) return null;
  return (value as { [REPLY]?: 'file' | 'json' })[REPLY] ?? null;
}

const MAX_BODY = 64 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown, cacheControl = 'no-store') {
  const text = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': cacheControl,
  });
  res.end(text);
}

function sendError(res: ServerResponse, err: RuleError) {
  // 본문을 다 읽지 않고 거절했으면 이 연결은 다시 쓰지 않는다
  if (err.status === 413) res.setHeader('connection', 'close');
  sendJson(res, err.status, { error: { ...err.detail, code: err.code, message: err.message } });
}

async function sendFile(res: ServerResponse, reply: FileReply, headOnly: boolean) {
  let size: number;
  try {
    const info = await stat(reply.path);
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch {
    throw new RuleError(404, 'not_found', '없는 파일이에요');
  }
  const headers: Record<string, string | number> = {
    'content-type': reply.contentType,
    'content-length': size,
    'x-content-type-options': 'nosniff',
  };
  if (reply.cacheControl) headers['cache-control'] = reply.cacheControl;
  res.writeHead(200, headers);
  if (headOnly) {
    res.end();
    return;
  }
  await pipeline(createReadStream(reply.path), res);
}

/** 본문을 상한까지만 읽는다. 넘으면 나머지는 버리고 413으로 끝낸다 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  const tooLarge = () => new RuleError(413, 'body_too_large', '요청이 너무 커요');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return Promise.reject(tooLarge());
  const aborted = () => new RuleError(400, 'request_aborted', '요청이 중간에 끊겼어요');
  if (req.destroyed) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        done();
        reject(tooLarge());
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = () => {
      done();
      resolve(Buffer.concat(chunks));
    };
    // 보내는 쪽이 중간에 끊었다. 답을 받을 곳이 없으니 조용히 끝낸다 (서버 잘못이 아니라 500으로 기록하지 않는다)
    const onAbort = () => {
      done();
      reject(aborted());
    };
    const done = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onAbort);
      req.off('close', onAbort);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onAbort);
    req.on('close', onAbort);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new RuleError(400, 'invalid_json', 'JSON 형식이 아니에요');
  }
}

interface Compiled {
  route: Route;
  /** 경로를 `/`로 자른 조각. `:`으로 시작하면 변수 */
  segments: string[];
}

function matchPath(segments: string[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.startsWith(':')) {
      if (seg !== parts[i]) return null;
      continue;
    }
    if (parts[i] === '') return null;
    let value: string;
    try {
      value = decodeURIComponent(parts[i]);
    } catch {
      return null; // 풀 수 없는 %
    }
    // 풀었더니 제어 문자(NUL, 줄바꿈 …)가 나오면 없는 경로로 본다. DB에 넣으면 오류가 나는 값이 처리기까지 가지 않게
    if (hasControlChars(value)) return null;
    params[seg.slice(1)] = value;
  }
  return params;
}

export interface HandlerOptions {
  /** CORS 허용 origin — 정확히 같은 값만 */
  allowedOrigins: string[];
  now: Clock;
  /** 세션 토큰의 해시로 세션을 찾는다. 없거나 끝났으면 null */
  findSession(tokenHash: string, now: Date): Promise<Session | null>;
  /**
   * 경로 표보다 먼저 묻는 곳 (GET·HEAD만). 공개 페이지(약관 등)를 여기서 답한다.
   * 답했으면 참을 돌려준다. origin을 따지지 않고 CORS 허용 헤더도 붙지 않는다.
   */
  fallback?(req: IncomingMessage, res: ServerResponse): boolean;
  /**
   * 요청한 쪽의 IP가 담긴 헤더 이름 (`Config.clientIpHeader`). 없으면 소켓 주소를 쓴다.
   * 헤더가 없거나 값이 IP가 아니면 소켓 주소로 돌아간다.
   */
  clientIpHeader?: string | null;
}

/**
 * 경로 표를 받아 HTTP 요청을 처리하는 함수를 만든다. 순서는 v1과 같다:
 * GET·HEAD이면 먼저 fallback → CORS → OPTIONS 204 → 경로 표 → 404 (주소는 있는데 메서드가 다르면 405).
 * 경로를 찾은 뒤에는 IP 기준 한도 → 로그인 확인 → 사용자 기준 한도 → 처리기 순서다.
 * HEAD는 같은 주소의 GET 경로가 답하고 본문만 뺀다.
 */
export function createHandler(routes: Route[], opts: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const allowed = new Set(opts.allowedOrigins);
  const table: Compiled[] = routes.map((route) => ({ route, segments: route.path.split('/') }));
  const limiter = createRateLimiter();
  const ipHeader = opts.clientIpHeader ? opts.clientIpHeader.toLowerCase() : null;

  function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
    // Origin에 따라 허용 헤더가 달라진다는 것은 Origin이 없는 응답에도 알린다.
    // 그러지 않으면 중간 캐시가 Origin 없이 받은 응답(허용 헤더 없음)을 앱에 줄 수 있다
    res.setHeader('vary', 'origin');
    const origin = req.headers.origin;
    if (!origin) return true; // 같은 출처·서버 간 호출
    if (!allowed.has(origin)) return false;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-max-age', '600');
    return true;
  }

  function clientIp(req: IncomingMessage): string {
    if (ipHeader) {
      const raw = req.headers[ipHeader];
      const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
      if (value && isIP(value) !== 0) return value;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  /** 세션 토큰: 20자 이상의 base64url. 서버는 그 해시로만 세션을 찾는다 */
  async function readSession(req: IncomingMessage, now: Date): Promise<{ session: Session; tokenHash: string } | null> {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!m) return null;
    const tokenHash = sha256Hex(m[1]);
    const session = await opts.findSession(tokenHash, now);
    return session ? { session, tokenHash } : null;
  }

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    if ((method === 'GET' || method === 'HEAD') && opts.fallback?.(req, res)) return;

    if (!applyCors(req, res)) {
      // 허용하지 않은 origin — 처리기를 부르지 않고 본문도 내주지 않는다
      throw new RuleError(403, 'origin_not_allowed', '허용하지 않은 곳에서 온 요청이에요');
    }
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 주소는 `/경로?물음`만 받는다. URL로 풀지 않고 그대로 자른다 (`//`나 `..`을 고쳐 읽지 않으니 경로 표와 글자 그대로 견준다)
    const target = req.url ?? '/';
    const cut = target.indexOf('?');
    const path = cut === -1 ? target : target.slice(0, cut);
    const query = new URLSearchParams(cut === -1 ? '' : target.slice(cut + 1));
    const parts = path.split('/');
    const headOnly = method === 'HEAD';
    const wanted = headOnly ? 'GET' : method;
    let found: { route: Route; params: Record<string, string> } | null = null;
    const others = new Set<string>();
    for (const entry of table) {
      const params = matchPath(entry.segments, parts);
      if (!params) continue;
      if (entry.route.method === wanted) {
        found = { route: entry.route, params };
        break;
      }
      others.add(entry.route.method);
    }
    if (!found) {
      if (others.size === 0) throw new RuleError(404, 'not_found', '없는 경로예요');
      res.setHeader('allow', ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].filter((m) => others.has(m === 'HEAD' ? 'GET' : m)).join(', '));
      throw new RuleError(405, 'method_not_allowed', '이 주소에서는 쓸 수 없는 메서드예요');
    }
    const { route, params } = found;

    const now = opts.now();
    const ip = clientIp(req);
    const limit = route.limit;
    const checkLimit = (who: string) => {
      if (limit && !limiter.allow(`${route.method} ${route.path} ${who}`, limit.perMinute, now.getTime())) {
        throw new RuleError(429, 'rate_limited', '요청이 너무 잦아요. 잠시 뒤 다시 시도해 주세요');
      }
    };
    // IP 기준 한도는 세션을 찾아보기(DB 조회) 전에 센다
    if (limit?.by === 'ip') checkLimit(`ip:${ip}`);
    const login = route.auth === 'none' ? null : await readSession(req, now);
    // 사용자 기준 한도: 로그인하지 못한 요청은 IP로 센다. 틀린 토큰을 계속 보내는 쪽도 한도에 걸린다
    if (limit?.by === 'user') checkLimit(login ? `user:${login.session.userId}` : `ip:${ip}`);
    if (route.auth === 'required' && !login) throw new RuleError(401, 'unauthorized', '로그인이 필요해요');

    let body: Promise<unknown> | null = null;
    const readOnce = () => {
      if (!body) {
        body = readJson(req);
        // 처리기가 불러 놓고 기다리지 않아도 "받는 곳 없는 거절"로 프로세스가 죽지 않게 한다. 기다리는 쪽은 오류를 그대로 받는다
        body.catch(() => {});
      }
      return body;
    };
    const result = await route.handle({
      method,
      path,
      query,
      params,
      session: login?.session ?? null,
      tokenHash: login?.tokenHash ?? null,
      ip,
      now,
      json: readOnce,
    });

    const kind = replyKind(result);
    if (kind === 'file') return sendFile(res, result as FileReply, headOnly);
    if (kind === 'json') return sendJson(res, 200, (result as JsonReply).body, (result as JsonReply).cacheControl);
    sendJson(res, 200, result);
  }

  return async function handler(req, res) {
    try {
      await dispatch(req, res);
    } catch (err) {
      try {
        if (res.headersSent) {
          // 답을 내보내는 중에 난 오류 (파일을 읽다 끊김 등). 고쳐 보낼 수 없으니 연결을 끊는다
          res.destroy();
          return;
        }
        if (err instanceof RuleError) return sendError(res, err);
        // 모르는 오류: 내용을 내보내지 않는다. 로그에는 메시지만, 그것도 쿼리에 넣은 값은 빼고 남긴다
        console.error('[server] unexpected error:', safeMessage(err));
        sendError(res, new RuleError(500, 'internal', '잠시 뒤 다시 시도해 주세요'));
      } catch {
        // 오류를 알리다가 또 실패했다. 이 함수는 던지지 않는다 (부르는 쪽이 기다리지 않는다)
        res.destroy();
      }
    }
  };
}
