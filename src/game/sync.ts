import type { RunReport, ServerSnapshot } from './api';

/**
 * 서버 동기화 큐.
 * 모든 변경은 기기에 먼저 반영하고(바로 화면에 보이게) 여기에 쌓아 서버로 차례로 보낸다.
 * 큐는 기기에 저장돼서 앱을 껐다 켜거나 네트워크가 끊겨도 남는다.
 * 큐가 다 비면 서버가 준 마지막 상태(스냅샷)를 기기 상태에 덮어쓴다 — 서버가 정본이다.
 */

export type SyncOp =
  | { kind: 'attendance'; gameId: string }
  | { kind: 'adReward'; gameId: string }
  | { kind: 'run'; report: RunReport }
  | { kind: 'buy'; itemId: string }
  | { kind: 'equip'; itemId: string }
  | { kind: 'settings'; patch: { sound?: boolean; haptic?: boolean } };

export type SyncStatus = 'off' | 'connecting' | 'online' | 'offline';

export interface SyncApi {
  me(): Promise<ServerSnapshot>;
  importSave(save: unknown): Promise<ServerSnapshot>;
  attendance(gameId: string): Promise<ServerSnapshot>;
  adReward(gameId: string): Promise<ServerSnapshot>;
  run(report: RunReport): Promise<ServerSnapshot>;
  buy(itemId: string): Promise<ServerSnapshot>;
  equip(itemId: string): Promise<ServerSnapshot>;
  settings(patch: { sound?: boolean; haptic?: boolean }): Promise<ServerSnapshot>;
}

export interface SyncDeps {
  api: SyncApi;
  /** 나중에 다시 보내면 되는 실패인지 (네트워크·5xx·너무 빠른 요청) */
  isRetryable(err: unknown): boolean;
  /** 서버가 잠시 뒤에 다시 보내라고 한 실패인지 (판 기록 최소 간격) */
  isTooFast(err: unknown): boolean;
  loadQueue(): Promise<SyncOp[]>;
  saveQueue(queue: SyncOp[]): Promise<void>;
  /** 처음 연결할 때 서버로 가져갈 기기 저장 데이터 */
  localSave(): unknown;
  onSnapshot(snapshot: ServerSnapshot): void;
  onStatus(status: SyncStatus): void;
  schedule(fn: () => void, ms: number): void;
}

const RETRY_DELAYS = [3000, 10000, 30000, 60000, 300000];

export class SyncEngine {
  private queue: SyncOp[] = [];
  private connected = false;
  private busy = false;
  private failures = 0;
  private retryScheduled = false;
  private deps: SyncDeps;
  status: SyncStatus = 'off';

  constructor(deps: SyncDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    this.queue = await this.deps.loadQueue();
    this.setStatus('connecting');
    await this.kick();
  }

  enqueue(op: SyncOp): void {
    // 설정은 마지막 값만 의미가 있으니 하나로 합친다
    if (op.kind === 'settings') {
      const prev = this.queue.findIndex((q) => q.kind === 'settings');
      if (prev >= 0) {
        const merged = { ...(this.queue[prev] as Extract<SyncOp, { kind: 'settings' }>).patch, ...op.patch };
        this.queue.splice(prev, 1);
        op = { kind: 'settings', patch: merged };
      }
    }
    this.queue.push(op);
    void this.deps.saveQueue(this.queue);
    void this.kick();
  }

  get pending(): number {
    return this.queue.length;
  }

  /** 지금 보낼 수 있으면 보낸다 (앱이 다시 보일 때 등) */
  async kick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.connected) await this.connect();
      if (this.connected) await this.drain();
    } finally {
      this.busy = false;
    }
  }

  private setStatus(status: SyncStatus) {
    if (this.status === status) return;
    this.status = status;
    this.deps.onStatus(status);
  }

  private retryLater(ms?: number) {
    if (this.retryScheduled) return;
    this.retryScheduled = true;
    const delay = ms ?? RETRY_DELAYS[Math.min(this.failures, RETRY_DELAYS.length - 1)];
    this.failures++;
    this.deps.schedule(() => {
      this.retryScheduled = false;
      void this.kick();
    }, delay);
  }

  private async connect(): Promise<void> {
    try {
      let snap = await this.deps.api.me();
      if (!snap.imported) {
        try {
          snap = await this.deps.api.importSave(this.deps.localSave());
          // 처음 연결: 기기 데이터에는 큐의 변경이 이미 들어 있으니, 같은 변경이 두 번
          // 반영되지 않게 큐를 비운다
          this.queue = [];
          await this.deps.saveQueue(this.queue);
        } catch (err) {
          // 그사이 다른 기기가 먼저 가져갔으면 서버 상태를 그대로 쓴다
          if ((err as { code?: string }).code !== 'already_imported') throw err;
          snap = await this.deps.api.me();
        }
      }
      this.connected = true;
      this.failures = 0;
      this.setStatus('online');
      if (this.queue.length === 0) this.deps.onSnapshot(snap);
    } catch (err) {
      // 서버에 닿지 못했거나 로그인이 안 되면 기기 저장만으로 계속하고 나중에 다시 시도한다
      if (!this.deps.isRetryable(err)) console.warn('[sync] connect failed:', (err as Error).message);
      this.setStatus('offline');
      this.retryLater();
    }
  }

  private async drain(): Promise<void> {
    let last: ServerSnapshot | null = null;
    let refresh = false;
    while (this.queue.length > 0) {
      const op = this.queue[0];
      try {
        last = await this.send(op);
      } catch (err) {
        if (this.deps.isRetryable(err)) {
          this.setStatus(this.deps.isTooFast(err) ? 'online' : 'offline');
          this.retryLater(this.deps.isTooFast(err) ? 3500 : undefined);
          return;
        }
        // 서버가 규칙상 거절한 변경(이미 받음, 코인 부족 등)은 버리고 서버 상태로 되돌린다
        console.warn('[sync] dropped', op.kind, (err as { code?: string }).code ?? (err as Error).message);
        refresh = true;
      }
      this.queue.shift();
      await this.deps.saveQueue(this.queue);
    }
    this.failures = 0;
    this.setStatus('online');
    try {
      const snap = refresh ? await this.deps.api.me() : last;
      if (snap && this.queue.length === 0) this.deps.onSnapshot(snap);
    } catch (err) {
      if (this.deps.isRetryable(err)) this.retryLater();
    }
  }

  private send(op: SyncOp): Promise<ServerSnapshot> {
    const a = this.deps.api;
    switch (op.kind) {
      case 'attendance':
        return a.attendance(op.gameId);
      case 'adReward':
        return a.adReward(op.gameId);
      case 'run':
        return a.run(op.report);
      case 'buy':
        return a.buy(op.itemId);
      case 'equip':
        return a.equip(op.itemId);
      case 'settings':
        return a.settings(op.patch);
    }
  }
}
