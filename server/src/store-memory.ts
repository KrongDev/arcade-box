import { randomUUID } from 'node:crypto';
import { createState, normalizeState, type UserState } from './domain.ts';
import type { LeaderboardRow, Mutation, RunLog, Store } from './store.ts';

/** 테스트용 메모리 저장소 — PgStore와 같은 규약을 따른다 */
export class MemoryStore implements Store {
  users = new Map<string, string>(); // anonKey -> userId
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  states = new Map<string, UserState>();
  records = new Map<string, Map<string, number>>(); // board -> userId -> value
  runs: (RunLog & { userId: string })[] = [];

  async upsertUser(anonKey: string): Promise<string> {
    let id = this.users.get(anonKey);
    if (!id) {
      id = randomUUID();
      this.users.set(anonKey, id);
    }
    return id;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async sessionUser(tokenHash: string, now: Date): Promise<string | null> {
    const s = this.sessions.get(tokenHash);
    return s && s.expiresAt > now ? s.userId : null;
  }

  async readState(userId: string): Promise<UserState> {
    return structuredClone(this.states.get(userId) ?? createState());
  }

  async mutate<T>(userId: string, fn: (state: UserState) => Mutation<T>): Promise<T> {
    const draft = normalizeState(structuredClone(this.states.get(userId) ?? createState()));
    const m = fn(draft);
    this.states.set(userId, structuredClone(m.state));
    for (const r of m.records ?? []) {
      if (!this.records.has(r.board)) this.records.set(r.board, new Map());
      this.records.get(r.board)!.set(userId, r.value);
    }
    if (m.run) this.runs.push({ ...m.run, userId });
    return m.result;
  }

  private ranked(board: string, order: 'higher' | 'lower'): LeaderboardRow[] {
    const rows = [...(this.records.get(board) ?? new Map<string, number>()).entries()].map(([userId, value]) => ({ userId, value }));
    rows.sort((a, b) => (order === 'higher' ? b.value - a.value : a.value - b.value));
    return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => (order === 'higher' ? o.value > r.value : o.value < r.value)).length }));
  }

  async top(board: string, order: 'higher' | 'lower', limit: number): Promise<LeaderboardRow[]> {
    return this.ranked(board, order).slice(0, limit);
  }

  async rankOf(board: string, order: 'higher' | 'lower', userId: string): Promise<LeaderboardRow | null> {
    return this.ranked(board, order).find((r) => r.userId === userId) ?? null;
  }

  async close(): Promise<void> {}
}
