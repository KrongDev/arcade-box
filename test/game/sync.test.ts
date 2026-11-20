import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ServerSnapshot } from '../../src/game/server-types.ts';
import { SyncEngine, type SyncApi, type SyncOp } from '../../src/game/sync.ts';

const SNAP: ServerSnapshot = {
  coins: {},
  best: {},
  bestTime: {},
  cleared: [],
  unlocked: ['pinball'],
  owned: [],
  equipped: {},
  settings: { sound: true, haptic: true },
  attendanceClaimedToday: false,
  adRewardsLeft: 3,
  imported: true,
  serverDate: '2026-11-20',
};

/** 요청마다 호출 기록을 남기고, 판 기록(run)은 테스트가 끝내 줄 때까지 기다리는 가짜 서버 */
function fakeServer() {
  const calls: string[] = [];
  let releaseRun: (() => void) | null = null;
  const reply = (name: string) => async () => {
    calls.push(name);
    return SNAP;
  };
  const api: SyncApi = {
    me: reply('me'),
    importSave: reply('import'),
    attendance: reply('attendance'),
    adReward: reply('adReward'),
    buy: reply('buy'),
    equip: reply('equip'),
    settings: reply('settings'),
    run: () => {
      calls.push('run');
      return new Promise((r) => {
        releaseRun = () => r(SNAP);
      });
    },
  };
  return { api, calls, releaseRun: () => releaseRun?.() };
}

function engine(api: SyncApi, initial: SyncOp[] = []) {
  const snapshots: ServerSnapshot[] = [];
  const timers: (() => void)[] = [];
  const e = new SyncEngine({
    api,
    isRetryable: () => true,
    isTooFast: () => false,
    loadQueue: async () => [...initial],
    saveQueue: async () => undefined,
    localSave: () => ({}),
    onSnapshot: (s) => snapshots.push(s),
    onStatus: () => undefined,
    schedule: (fn) => timers.push(fn),
  });
  return { e, snapshots, timers };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SyncEngine.stop (내 기록 지우기 전에 동기화 멈추기)', () => {
  it('보내는 중인 요청이 끝날 때까지 기다리고, 그 뒤로는 아무것도 보내지 않는다', async () => {
    const server = fakeServer();
    const { e, snapshots } = engine(server.api, [{ kind: 'run', report: { board: 'pinball', score: 100, coins: 0 } }]);
    void e.start();
    await tick();
    assert.deepEqual(server.calls, ['me', 'run']);

    let stopped = false;
    const stopping = e.stop().then(() => {
      stopped = true;
    });
    await tick();
    assert.equal(stopped, false, '보내는 중인 판 기록이 끝나기 전에는 멈춤이 끝나지 않는다');

    server.releaseRun();
    await stopping;
    assert.equal(stopped, true);

    // 멈춘 뒤 들어온 변경은 보내지 않고, 서버 상태로 기기를 덮어쓰지도 않는다
    const before = snapshots.length;
    e.enqueue({ kind: 'attendance', gameId: 'pinball' });
    await e.kick();
    await tick();
    assert.deepEqual(server.calls, ['me', 'run']);
    assert.equal(snapshots.length, before);
  });

  it('멈춘 뒤에는 예약된 재시도도 아무것도 하지 않는다', async () => {
    const calls: string[] = [];
    const api = fakeServer().api;
    api.me = async () => {
      calls.push('me');
      throw new Error('offline');
    };
    const { e, timers } = engine(api);
    await e.start();
    assert.equal(calls.length, 1);
    assert.equal(timers.length, 1, '연결 실패 후 재시도를 예약한다');
    await e.stop();
    timers[0]();
    await tick();
    assert.equal(calls.length, 1);
  });

  it('resume하면 다시 보낸다 (서버에서 지우기에 실패했을 때)', async () => {
    const server = fakeServer();
    const { e } = engine(server.api);
    await e.start();
    await e.stop();
    e.enqueue({ kind: 'attendance', gameId: 'pinball' });
    await tick();
    assert.equal(server.calls.includes('attendance'), false);
    e.resume();
    await tick();
    await tick();
    assert.equal(server.calls.includes('attendance'), true);
  });
});
