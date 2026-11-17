import { Storage } from '@apps-in-toss/web-framework';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_BASE, ApiError, api as serverApi, initApi, type RunReport, type ServerSnapshot } from './api';
import { AD_REWARDS_PER_DAY, AD_REWARD_COINS, ATTENDANCE_COINS, GAMES, type GameId } from './registry';
import { setHapticEnabled } from './haptic';
import { loadSave, persistSave, resolveUserKey, todayKey, type SaveData, type Settings } from './save';
import { setSoundEnabled } from './sfx';
import { getItem, slotKey } from './catalog';
import { isOwned } from './equipped';
import { fetchPaidOrders, recoverPendingOrders } from './iap';
import { SaveContext, type BuyResult, type ClearResult, type SaveApi, type ScoreResult } from './save-context';
import { SyncEngine, type SyncOp, type SyncStatus } from './sync';

const GAME_ID_SET = new Set<string>(GAMES.map((g) => g.id));

/** 서버 스냅샷을 기기 저장 형식에 덮어쓴다. 유료 아이템 기록·식별키처럼 기기에만 있는 값은 그대로 둔다 */
function applySnapshot(cur: SaveData, snap: ServerSnapshot): SaveData {
  const today = todayKey();
  return {
    ...cur,
    coins: { ...snap.coins },
    best: { ...snap.best },
    bestTime: { ...snap.bestTime },
    bestScore: { ...snap.bestScore },
    cleared: [...snap.cleared],
    unlocked: snap.unlocked.filter((g): g is GameId => GAME_ID_SET.has(g)),
    owned: [...snap.owned],
    equipped: { ...snap.equipped },
    settings: { ...snap.settings },
    lastAttendance: snap.attendanceClaimedToday ? today : cur.lastAttendance === today ? null : cur.lastAttendance,
    adRewards: { date: today, count: AD_REWARDS_PER_DAY - snap.adRewardsLeft },
  };
}

async function loadQueue(key: string): Promise<SyncOp[]> {
  try {
    const raw = await Storage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SyncOp[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(key: string, queue: SyncOp[]): Promise<void> {
  try {
    await Storage.setItem(key, JSON.stringify(queue));
  } catch {
    // 저장 실패 시 다음 실행에서 큐가 비어 있을 수 있다 — 서버 스냅샷이 다시 맞춘다
  }
}

export function SaveProvider({ children }: { children: ReactNode }) {
  const [save, setSave] = useState<SaveData | null>(null);
  const [serverStatus, setServerStatus] = useState<SyncStatus>('off');
  const latest = useRef<SaveData | null>(null);
  const syncRef = useRef<SyncEngine | null>(null);
  const enqueue = useCallback((op: SyncOp) => syncRef.current?.enqueue(op), []);

  useEffect(() => {
    let alive = true;
    // 게임용 사용자 식별키를 먼저 확인해 저장하고, 그 사용자의 저장 데이터를 연다
    void resolveUserKey().then(loadSave).then((saved) => {
      if (!alive) return;
      let loaded = saved;
      // 개발 서버 전용: 주소 뒤에 ?unlock=all 을 붙이면 모든 게임·난이도를 열어 둔다
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('unlock') === 'all') {
        loaded = {
          ...saved,
          unlocked: GAMES.map((g) => g.id),
          cleared: Array.from(new Set([...saved.cleared, 'minesweeper.easy', 'minesweeper.normal'])),
        };
      }
      latest.current = loaded;
      setSave(loaded);
      // 확인한 사용자 식별키를 바로 저장해 둔다 (게임 출시 체크리스트: 식별자 확인·저장 후 시작)
      persistSave(loaded);

      // 서버 주소가 있으면 뒤에서 로그인하고 동기화한다. 실패해도 기기 저장만으로 계속한다
      if (!API_BASE) return;
      const queueKey = `arcade-box.queue.${loaded.userKey ?? 'anon'}`;
      void initApi(loaded.userKey).then(() => {
        if (!alive) return;
        const engine = new SyncEngine({
          api: serverApi,
          isRetryable: (err) => err instanceof ApiError && err.retryable,
          isTooFast: (err) => err instanceof ApiError && err.code === 'too_fast',
          loadQueue: () => loadQueue(queueKey),
          saveQueue: (q) => saveQueue(queueKey, q),
          localSave: () => latest.current,
          onSnapshot: (snap) => {
            const cur = latest.current;
            if (!cur) return;
            const next = applySnapshot(cur, snap);
            latest.current = next;
            setSave(next);
            persistSave(next);
          },
          onStatus: setServerStatus,
          schedule: (fn, ms) => window.setTimeout(fn, ms),
        });
        syncRef.current = engine;
        void engine.start();
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  // 앱이 다시 보이면 밀린 변경을 보낸다
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void syncRef.current?.kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const commit = useCallback((next: SaveData) => {
    latest.current = next;
    setSave(next);
    persistSave(next);
  }, []);

  const addCoins = useCallback(
    (gameId: GameId, amount: number) => {
      const cur = latest.current;
      if (!cur || amount <= 0) return;
      commit({ ...cur, coins: { ...cur.coins, [gameId]: (cur.coins[gameId] ?? 0) + amount } });
    },
    [commit],
  );

  const recordScore = useCallback(
    (gameId: GameId, score: number): ScoreResult => {
      const cur = latest.current;
      if (!cur) return { isBest: false, best: score, newlyUnlocked: [] };
      const prevBest = cur.best[gameId] ?? 0;
      const best = Math.max(prevBest, score);
      const newlyUnlocked = GAMES.filter(
        (g) =>
          g.unlock !== null &&
          g.unlock.gameId === gameId &&
          best >= g.unlock.score &&
          !cur.unlocked.includes(g.id),
      ).map((g) => g.id);
      commit({
        ...cur,
        best: { ...cur.best, [gameId]: best },
        unlocked: [...cur.unlocked, ...newlyUnlocked],
      });
      return { isBest: score > prevBest && score > 0, best, newlyUnlocked };
    },
    [commit],
  );

  const recordClear = useCallback(
    (stageKey: string, seconds: number): ClearResult => {
      const cur = latest.current;
      if (!cur) return { isBest: false, best: seconds, firstClear: false };
      const prev = cur.bestTime[stageKey];
      const best = prev === undefined ? seconds : Math.min(prev, seconds);
      const firstClear = !cur.cleared.includes(stageKey);
      commit({
        ...cur,
        cleared: firstClear ? [...cur.cleared, stageKey] : cur.cleared,
        bestTime: { ...cur.bestTime, [stageKey]: best },
      });
      return { isBest: prev === undefined || seconds < prev, best, firstClear };
    },
    [commit],
  );

  const recordStageScore = useCallback(
    (stageKey: string, score: number) => {
      const cur = latest.current;
      if (!cur) return { isBest: false, best: score };
      const prev = cur.bestScore[stageKey] ?? 0;
      if (score > prev) commit({ ...cur, bestScore: { ...cur.bestScore, [stageKey]: score } });
      return { isBest: score > prev && score > 0, best: Math.max(prev, score) };
    },
    [commit],
  );

  const buyItem = useCallback(
    (itemId: string): BuyResult => {
      const cur = latest.current;
      const item = getItem(itemId);
      if (!cur || !item || item.price.type !== 'coin') return 'unavailable';
      if (isOwned(cur, item)) return 'owned';
      const balance = cur.coins[item.game] ?? 0;
      if (balance < item.price.amount) return 'insufficient';
      commit({
        ...cur,
        coins: { ...cur.coins, [item.game]: balance - item.price.amount },
        owned: [...cur.owned, item.id],
        equipped: { ...cur.equipped, [slotKey(item.game, item.slot)]: item.id },
      });
      enqueue({ kind: 'buy', itemId: item.id });
      return 'ok';
    },
    [commit, enqueue],
  );

  const equipItem = useCallback(
    (itemId: string) => {
      const cur = latest.current;
      const item = getItem(itemId);
      if (!cur || !item || !isOwned(cur, item)) return;
      commit({ ...cur, equipped: { ...cur.equipped, [slotKey(item.game, item.slot)]: item.id } });
      enqueue({ kind: 'equip', itemId: item.id });
    },
    [commit, enqueue],
  );

  const grantPaidOrder = useCallback(
    (orderId: string, itemId: string): boolean => {
      const cur = latest.current;
      const item = getItem(itemId);
      if (!cur || !item || item.price.type !== 'paid') return false;
      if (cur.paidOrders[orderId]) return true; // 이미 지급한 주문
      commit({
        ...cur,
        paidOrders: { ...cur.paidOrders, [orderId]: { itemId, refunded: false } },
        equipped: { ...cur.equipped, [slotKey(item.game, item.slot)]: item.id },
      });
      // 유료 아이템 소유는 토스 구매 내역이 정본이고, 서버에는 장착 상태만 맞춘다
      enqueue({ kind: 'equip', itemId: item.id });
      return true;
    },
    [commit, enqueue],
  );

  // 앱을 열 때 한 번: 지급 못 한 주문을 마저 지급하고, 토스 구매 내역으로 유료 아이템을 맞춘다
  // (기기 변경·데이터 삭제 후 복원, 환불된 주문 회수)
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!save || syncedRef.current) return;
    syncedRef.current = true;
    void (async () => {
      await recoverPendingOrders((orderId, itemId) => grantPaidOrder(orderId, itemId));
      const orders = await fetchPaidOrders();
      const cur = latest.current;
      if (!orders || !cur) return;
      const paidOrders = { ...cur.paidOrders };
      let changed = false;
      for (const o of orders) {
        const prev = paidOrders[o.orderId];
        if (!prev || prev.refunded !== o.refunded) {
          paidOrders[o.orderId] = { itemId: o.itemId, refunded: o.refunded };
          changed = true;
        }
      }
      if (changed) commit({ ...cur, paidOrders });
    })();
  }, [save, commit, grantPaidOrder]);

  const claimAdReward = useCallback(
    (gameId: GameId): boolean => {
      const cur = latest.current;
      if (!cur) return false;
      const today = todayKey();
      const used = cur.adRewards.date === today ? cur.adRewards.count : 0;
      if (used >= AD_REWARDS_PER_DAY) return false;
      commit({
        ...cur,
        adRewards: { date: today, count: used + 1 },
        coins: { ...cur.coins, [gameId]: (cur.coins[gameId] ?? 0) + AD_REWARD_COINS },
      });
      enqueue({ kind: 'adReward', gameId });
      return true;
    },
    [commit, enqueue],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const cur = latest.current;
      if (!cur) return;
      commit({ ...cur, settings: { ...cur.settings, ...patch } });
      enqueue({ kind: 'settings', patch });
    },
    [commit, enqueue],
  );

  // 설정을 효과음·진동 모듈에 반영한다
  useEffect(() => {
    if (!save) return;
    setSoundEnabled(save.settings.sound);
    setHapticEnabled(save.settings.haptic);
  }, [save]);

  const claimAttendance = useCallback(
    (gameId: GameId) => {
      const cur = latest.current;
      if (!cur || cur.lastAttendance === todayKey()) return;
      commit({
        ...cur,
        lastAttendance: todayKey(),
        coins: { ...cur.coins, [gameId]: (cur.coins[gameId] ?? 0) + ATTENDANCE_COINS },
      });
      enqueue({ kind: 'attendance', gameId });
    },
    [commit, enqueue],
  );

  /** 한 판 결과를 서버에 보낸다 (기기 반영은 addCoins·recordScore·recordClear가 이미 했다) */
  const submitRun = useCallback((report: RunReport) => enqueue({ kind: 'run', report }), [enqueue]);

  const api = useMemo<SaveApi | null>(
    () =>
      save
        ? {
            save,
            addCoins,
            recordScore,
            recordClear,
            recordStageScore,
            buyItem,
            equipItem,
            grantPaidOrder,
            updateSettings,
            adRewardsLeft:
              AD_REWARDS_PER_DAY - (save.adRewards.date === todayKey() ? save.adRewards.count : 0),
            claimAdReward,
            canClaimAttendance: save.lastAttendance !== todayKey(),
            claimAttendance,
            submitRun,
            serverStatus,
          }
        : null,
    [
      save,
      addCoins,
      recordScore,
      recordClear,
      recordStageScore,
      buyItem,
      equipItem,
      grantPaidOrder,
      claimAdReward,
      updateSettings,
      claimAttendance,
      submitRun,
      serverStatus,
    ],
  );

  if (!api) return <div className="canvas" aria-busy="true" />;
  return <SaveContext.Provider value={api}>{children}</SaveContext.Provider>;
}
