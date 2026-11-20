import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BOARDS,
  RuleError,
  applyRun,
  buyItem,
  claimAdReward,
  claimAttendance,
  equipItem,
  getBoard,
  importLocalSave,
  kstDate,
  snapshot,
  updateSettings,
  type UserState,
} from './domain.ts';
import type { PartnerApi } from './partner.ts';
import type { Store } from './store.ts';

export interface AppDeps {
  store: Store;
  partner: PartnerApi;
  allowedOrigins: string[];
  sessionTtlDays: number;
  now?: () => Date;
}

const MAX_BODY = 32 * 1024;

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 순위표에 보여 줄 익명 이름 — 사용자 ID에서 만든 짧은 표시값 (식별키는 내보내지 않는다) */
export function playerLabel(userId: string): string {
  return `플레이어 ${createHash('sha256').update(userId).digest('hex').slice(0, 4).toUpperCase()}`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large', '요청이 너무 커요');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON 형식이 아니에요');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const allowed = new Set(deps.allowedOrigins);

  function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // 같은 출처·서버 간 호출
    if (!allowed.has(origin)) return false;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-max-age', '600');
    return true;
  }

  async function requireUser(req: IncomingMessage): Promise<string> {
    const auth = req.headers.authorization ?? '';
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(auth);
    if (!m) throw new HttpError(401, 'unauthorized', '로그인이 필요해요');
    const userId = await deps.store.sessionUser(hashToken(m[1]), now());
    if (!userId) throw new HttpError(401, 'unauthorized', '로그인이 필요해요');
    return userId;
  }

  async function optionalUser(req: IncomingMessage): Promise<string | null> {
    if (!req.headers.authorization) return null;
    try {
      return await requireUser(req);
    } catch {
      return null;
    }
  }

  /** 상태를 바꾸고 바뀐 스냅샷을 돌려주는 공통 경로 */
  async function change(userId: string, fn: (state: UserState, today: string) => void) {
    const today = kstDate(now());
    return deps.store.mutate(userId, (state) => {
      fn(state, today);
      return { state, result: snapshot(state, today) };
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === '/healthz' && method === 'GET') return send(res, 200, { ok: true });

    // 익명 식별키 인증 코드 → 세션 발급
    if (path === '/v1/auth/exchange' && method === 'POST') {
      const body = (await readJson(req)) as { code?: unknown };
      if (typeof body.code !== 'string' || body.code.length < 8 || body.code.length > 512) {
        throw new HttpError(400, 'invalid_code', '인증 코드가 올바르지 않아요');
      }
      const result = await deps.partner.exchangeAnonCode(body.code);
      if (!result.ok) {
        console.warn(`[auth] exchange failed kind=${result.kind} errorCode=${result.errorCode ?? '-'}`);
        if (result.kind === 'invalid_code') throw new HttpError(401, 'invalid_code', '인증 코드가 만료됐거나 올바르지 않아요');
        if (result.kind === 'rate_limited') throw new HttpError(429, 'rate_limited', '잠시 뒤 다시 시도해 주세요');
        throw new HttpError(502, 'auth_unavailable', '지금은 로그인할 수 없어요');
      }
      const userId = await deps.store.upsertUser(result.anonKey);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now().getTime() + deps.sessionTtlDays * 24 * 60 * 60 * 1000);
      await deps.store.createSession(userId, hashToken(token), expiresAt);
      return send(res, 200, { token, expiresAt: expiresAt.toISOString() });
    }

    if (path === '/v1/me' && method === 'GET') {
      const userId = await requireUser(req);
      const state = await deps.store.readState(userId);
      return send(res, 200, snapshot(state, kstDate(now())));
    }

    // 내 기록 지우기: 이 사용자의 서버 데이터를 모두 지운다. 같은 식별키로 다시 들어오면 새 사용자로 시작한다
    if (path === '/v1/me' && method === 'DELETE') {
      const userId = await requireUser(req);
      await deps.store.deleteUser(userId);
      return send(res, 200, { deleted: true });
    }

    if (path === '/v1/me/import' && method === 'POST') {
      const userId = await requireUser(req);
      const body = (await readJson(req)) as { save?: unknown };
      const iso = now().toISOString();
      const result = await deps.store.mutate(userId, (state) => {
        importLocalSave(state, body.save, iso);
        const today = kstDate(now());
        const records = [];
        // 점수 게임(순위표가 하나)은 게임 ID가 곧 순위표 ID다
        for (const b of BOARDS) {
          const value = state.best[b.gameId];
          if (!b.minesweeper && b.order === 'higher' && value) records.push({ board: b.id, value });
        }
        for (const [board, value] of Object.entries(state.bestScore)) if (value > 0) records.push({ board, value });
        return { state, records, result: snapshot(state, today) };
      });
      return send(res, 200, result);
    }

    if (path === '/v1/me/attendance' && method === 'POST') {
      const userId = await requireUser(req);
      const body = (await readJson(req)) as { gameId?: unknown };
      return send(res, 200, await change(userId, (s, today) => claimAttendance(s, body.gameId, today)));
    }

    if (path === '/v1/me/ad-reward' && method === 'POST') {
      const userId = await requireUser(req);
      const body = (await readJson(req)) as { gameId?: unknown };
      return send(res, 200, await change(userId, (s, today) => claimAdReward(s, body.gameId, today)));
    }

    if (path === '/v1/me/runs' && method === 'POST') {
      const userId = await requireUser(req);
      const body = (await readJson(req)) as Record<string, unknown>;
      const nowMs = now().getTime();
      const today = kstDate(now());
      const result = await deps.store.mutate(userId, (state) => {
        const out = applyRun(
          state,
          {
            board: body.board,
            score: body.score,
            seconds: body.seconds,
            won: body.won,
            opened: body.opened,
            correctFlags: body.correctFlags,
            wrongFlags: body.wrongFlags,
            shields: body.shields,
            coins: body.coins,
          },
          nowMs,
        );
        const best = out.board.minesweeper
          ? (state.bestScore[out.board.id] ?? null)
          : out.board.order === 'higher'
            ? (state.best[out.board.gameId] ?? null)
            : (state.bestTime[out.board.id] ?? null);
        return {
          state,
          records: out.isBest && best !== null ? [{ board: out.board.id, value: best }] : [],
          run: { board: out.board.id, value: out.recordValue, coins: out.coins },
          result: { ...snapshot(state, today), run: { isBest: out.isBest, best, firstClear: out.firstClear, newlyUnlocked: out.newlyUnlocked } },
        };
      });
      return send(res, 200, result);
    }

    const buy = /^\/v1\/me\/items\/([a-z0-9._-]+)\/buy$/.exec(path);
    if (buy && method === 'POST') {
      const userId = await requireUser(req);
      return send(res, 200, await change(userId, (s) => buyItem(s, buy[1])));
    }

    if (path === '/v1/me/equipped' && method === 'PUT') {
      const userId = await requireUser(req);
      const body = (await readJson(req)) as { itemId?: unknown };
      return send(res, 200, await change(userId, (s) => equipItem(s, body.itemId)));
    }

    if (path === '/v1/me/settings' && method === 'PUT') {
      const userId = await requireUser(req);
      const body = await readJson(req);
      return send(res, 200, await change(userId, (s) => updateSettings(s, body)));
    }

    const lb = /^\/v1\/leaderboards\/([a-z0-9._-]+)$/.exec(path);
    if (lb && method === 'GET') {
      const board = getBoard(lb[1]);
      if (!board) throw new HttpError(404, 'unknown_board', '없는 순위표예요');
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
      const userId = await optionalUser(req);
      const top = await deps.store.top(board.id, board.order, limit);
      const mine = userId ? await deps.store.rankOf(board.id, board.order, userId) : null;
      return send(res, 200, {
        board: board.id,
        order: board.order,
        entries: top.map((r) => ({ rank: r.rank, player: playerLabel(r.userId), value: r.value, me: r.userId === userId })),
        me: mine ? { rank: mine.rank, value: mine.value } : null,
      });
    }

    throw new HttpError(404, 'not_found', '없는 경로예요');
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!applyCors(req, res)) {
        // 허용하지 않은 origin — 본문을 내주지 않는다
        return send(res, 403, { error: 'origin_not_allowed' });
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError || err instanceof RuleError) {
        return send(res, err.status, { error: err.code, message: err.message });
      }
      console.error('[server] unexpected error:', (err as Error).message);
      return send(res, 500, { error: 'internal', message: '잠시 뒤 다시 시도해 주세요' });
    }
  };
}
