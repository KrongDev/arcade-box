import pg from 'pg';
import { createState, normalizeState, type UserState } from './domain.ts';
import type { LeaderboardRow, Mutation, Store } from './store.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS user_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS records (
  board TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value DOUBLE PRECISION NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board, user_id)
);
CREATE INDEX IF NOT EXISTS records_board_value_idx ON records (board, value);
CREATE TABLE IF NOT EXISTS runs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board TEXT NOT NULL,
  value DOUBLE PRECISION,
  coins INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  /** 테이블이 없으면 만든다. DB가 막 뜬 직후일 수 있어 몇 번 다시 시도한다 */
  async migrate(retries = 20): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        await this.pool.query(SCHEMA);
        return;
      } catch (err) {
        if (i >= retries) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async upsertUser(anonKey: string): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO users (anon_key) VALUES ($1)
       ON CONFLICT (anon_key) DO UPDATE SET anon_key = EXCLUDED.anon_key
       RETURNING id`,
      [anonKey],
    );
    return res.rows[0].id;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
    // 만료된 세션 정리 (가볍게, 로그인할 때마다)
    await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
  }

  async sessionUser(tokenHash: string, now: Date): Promise<string | null> {
    const res = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2',
      [tokenHash, now],
    );
    return res.rows[0]?.user_id ?? null;
  }

  async readState(userId: string): Promise<UserState> {
    const res = await this.pool.query<{ state: unknown }>('SELECT state FROM user_state WHERE user_id = $1', [userId]);
    return res.rows[0] ? normalizeState(res.rows[0].state) : createState();
  }

  async mutate<T>(userId: string, fn: (state: UserState) => Mutation<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO user_state (user_id, state) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
        [userId, JSON.stringify(createState())],
      );
      const cur = await client.query<{ state: unknown }>('SELECT state FROM user_state WHERE user_id = $1 FOR UPDATE', [userId]);
      const m = fn(normalizeState(cur.rows[0]?.state));
      await client.query('UPDATE user_state SET state = $2, updated_at = now() WHERE user_id = $1', [userId, JSON.stringify(m.state)]);
      for (const r of m.records ?? []) {
        await client.query(
          `INSERT INTO records (board, user_id, value) VALUES ($1, $2, $3)
           ON CONFLICT (board, user_id) DO UPDATE SET value = EXCLUDED.value, achieved_at = now()`,
          [r.board, userId, r.value],
        );
      }
      if (m.run) {
        await client.query('INSERT INTO runs (user_id, board, value, coins) VALUES ($1, $2, $3, $4)', [
          userId,
          m.run.board,
          m.run.value,
          m.run.coins,
        ]);
      }
      await client.query('COMMIT');
      return m.result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async top(board: string, order: 'higher' | 'lower', limit: number): Promise<LeaderboardRow[]> {
    const dir = order === 'higher' ? 'DESC' : 'ASC';
    const res = await this.pool.query<{ user_id: string; value: number; rank: string }>(
      `SELECT user_id, value, RANK() OVER (ORDER BY value ${dir}) AS rank
       FROM records WHERE board = $1 ORDER BY value ${dir}, achieved_at ASC LIMIT $2`,
      [board, limit],
    );
    return res.rows.map((r) => ({ userId: r.user_id, value: Number(r.value), rank: Number(r.rank) }));
  }

  async rankOf(board: string, order: 'higher' | 'lower', userId: string): Promise<LeaderboardRow | null> {
    const cmp = order === 'higher' ? '>' : '<';
    const res = await this.pool.query<{ value: number; better: string }>(
      `SELECT r.value, (SELECT COUNT(*) FROM records o WHERE o.board = r.board AND o.value ${cmp} r.value) AS better
       FROM records r WHERE r.board = $1 AND r.user_id = $2`,
      [board, userId],
    );
    const row = res.rows[0];
    return row ? { userId, value: Number(row.value), rank: Number(row.better) + 1 } : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
