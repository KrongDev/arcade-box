import { IAP, graniteEvent } from '@apps-in-toss/web-framework';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from '../components/icons';
import { SUPPORT_EMAIL } from '../game/appInfo';
import { haptic } from '../game/haptic';
import { itemForSku } from '../game/iap';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import '../styles/arcade.css';
import './Settings.css';

function useBackEvent(handler: () => void) {
  useEffect(() => {
    try {
      return graniteEvent.addEventListener('backEvent', { onEvent: handler, onError: () => undefined });
    } catch {
      return undefined;
    }
  }, [handler]);
}

export default function Settings({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<'main' | 'purchases'>('main');
  const backToMain = useCallback(() => setView('main'), []);
  return view === 'purchases' ? <PurchaseHistory onBack={backToMain} /> : <SettingsMain onExit={onExit} onOpenPurchases={() => setView('purchases')} />;
}

/* ───────────── 설정 ───────────── */

const SYNC_LABEL = {
  off: '이 기기에만 저장',
  connecting: '서버에 연결하는 중',
  online: '서버와 맞춰져 있어요',
  offline: '서버에 연결되지 않았어요 · 연결되면 이어서 저장해요',
} as const;

function SettingsMain({ onExit, onOpenPurchases }: { onExit: () => void; onOpenPurchases: () => void }) {
  const { save, updateSettings, serverStatus } = useSave();
  const insets = useSafeArea();
  useBackEvent(onExit);

  return (
    <main className="settings ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <h1 className="settings-title">설정</h1>

      <section className="settings-group" aria-labelledby="settings-sound">
        <h2 id="settings-sound" className="settings-group-title">
          <span className="tf">🔊</span> 소리와 진동
        </h2>
        <ToggleRow
          label="효과음"
          description="공이 튀거나 칸을 열 때 소리를 내요"
          checked={save.settings.sound}
          onChange={(sound) => updateSettings({ sound })}
        />
        <ToggleRow
          label="진동"
          description="게임 중에 짧은 진동으로 알려 줘요"
          checked={save.settings.haptic}
          onChange={(on) => {
            updateSettings({ haptic: on });
            if (on) haptic('tap', 0);
          }}
        />
      </section>

      <section className="settings-group" aria-labelledby="settings-purchase">
        <h2 id="settings-purchase" className="settings-group-title">
          <span className="tf">🧾</span> 구매
        </h2>
        <button type="button" className="settings-row is-link" onClick={onOpenPurchases}>
          <span className="settings-row-text">
            <span className="settings-row-label">구매 내역</span>
            <span className="settings-row-desc">유료 아이템 결제와 환불 내역을 볼 수 있어요</span>
          </span>
          <span className="settings-chevron">
            <ChevronRight size={20} />
          </span>
        </button>
      </section>

      <section className="settings-group" aria-labelledby="settings-help">
        <h2 id="settings-help" className="settings-group-title">
          <span className="tf">💬</span> 도움말
        </h2>
        {SUPPORT_EMAIL && (
          <div className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">고객 문의</span>
              <span className="settings-row-desc settings-selectable">{SUPPORT_EMAIL}</span>
            </span>
          </div>
        )}
        <div className="settings-row">
          <span className="settings-row-text">
            <span className="settings-row-label">기록 저장</span>
            <span className="settings-row-desc">{SYNC_LABEL[serverStatus]}</span>
          </span>
        </div>
        <div className="settings-info">
          <p className="settings-info-title">
            <span className="tf">💾</span> 데이터 저장 안내
          </p>
          {serverStatus === 'off' ? (
            <ul className="settings-info-list">
              <li>코인, 기록, 코인으로 산 아이템은 이 기기에만 저장돼요.</li>
              <li>토스 앱을 지우거나 기기를 바꾸면 이 데이터는 사라져요.</li>
              <li>유료 아이템은 토스 구매 내역으로 다시 받을 수 있어요.</li>
            </ul>
          ) : (
            <ul className="settings-info-list">
              <li>코인, 기록, 코인으로 산 아이템은 서버에 저장돼서 기기를 바꿔도 이어져요.</li>
              <li>연결이 끊겨도 이 기기에 먼저 저장했다가, 다시 연결되면 서버에 보내요.</li>
              <li>유료 아이템은 토스 구매 내역으로 다시 받을 수 있어요.</li>
            </ul>
          )}
        </div>
      </section>

      <button type="button" className="ab-btn ab-btn--ghost ab-btn--block settings-home-button" onClick={onExit}>
        홈으로
      </button>
    </main>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="settings-row is-link" onClick={() => onChange(!checked)}>
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        <span className="settings-row-desc">{description}</span>
      </span>
      <span className={checked ? 'settings-switch is-on' : 'settings-switch'} aria-hidden="true">
        <span className="settings-switch-knob" />
      </span>
    </button>
  );
}

/* ───────────── 구매 내역 ───────────── */

type Order = { orderId: string; sku: string; status: 'COMPLETED' | 'REFUNDED'; date: string };

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; orders: Order[]; nextKey: string | null }
  | { kind: 'error'; message: string };

function itemNameForSku(sku: string): string {
  return itemForSku(sku)?.name ?? sku;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const UNSUPPORTED_MESSAGE = '토스 앱을 최신 버전으로 업데이트하면 구매 내역을 볼 수 있어요.';
const LOAD_ERROR_MESSAGE = '구매 내역을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';

function historySupported(): boolean {
  try {
    return IAP.getCompletedOrRefundedOrders.isSupported();
  } catch {
    return false;
  }
}

function PurchaseHistory({ onBack }: { onBack: () => void }) {
  const insets = useSafeArea();
  const [supported] = useState(historySupported);
  const [state, setState] = useState<LoadState>(() =>
    supported ? { kind: 'loading' } : { kind: 'error', message: UNSUPPORTED_MESSAGE },
  );
  const [loadingMore, setLoadingMore] = useState(false);
  useBackEvent(onBack);

  const load = useCallback(async (key: string | null, prev: Order[]) => {
    try {
      const res = await IAP.getCompletedOrRefundedOrders(key ? { key } : undefined);
      setState({ kind: 'ready', orders: [...prev, ...res.orders], nextKey: res.hasNext ? (res.nextKey ?? null) : null });
    } catch {
      setState({ kind: 'error', message: LOAD_ERROR_MESSAGE });
    }
  }, []);

  useEffect(() => {
    if (supported) void load(null, []);
  }, [load, supported]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.nextKey) return;
    setLoadingMore(true);
    await load(state.nextKey, state.orders);
    setLoadingMore(false);
  };

  const retry = () => {
    if (!supported) return;
    setState({ kind: 'loading' });
    void load(null, []);
  };

  return (
    <main className="settings ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <h1 className="settings-title">구매 내역</h1>

      {state.kind === 'loading' && <p className="settings-empty">불러오는 중이에요</p>}

      {state.kind === 'error' && (
        <div className="settings-empty-box">
          <p className="settings-empty">{state.message}</p>
          {supported && (
            <button type="button" className="ab-btn ab-btn--sm ab-btn--ghost settings-secondary-button" onClick={retry}>
              다시 불러오기
            </button>
          )}
        </div>
      )}

      {state.kind === 'ready' && state.orders.length === 0 && (
        <div className="settings-empty-box">
          <p className="settings-empty-emoji">
            <span className="tf">🧾</span>
          </p>
          <p className="settings-empty">아직 구매한 유료 아이템이 없어요</p>
        </div>
      )}

      {state.kind === 'ready' && state.orders.length > 0 && (
        <>
          <ul className="purchase-list">
            {state.orders.map((o) => (
              <li key={o.orderId} className="purchase-row">
                <span className="settings-row-text">
                  <span className="settings-row-label">{itemNameForSku(o.sku)}</span>
                  <span className="settings-row-desc">{formatDate(o.date)}</span>
                </span>
                <span className={o.status === 'REFUNDED' ? 'purchase-status is-refunded' : 'purchase-status'}>
                  {o.status === 'REFUNDED' ? '환불됨' : '구매 완료'}
                </span>
              </li>
            ))}
          </ul>
          {state.nextKey && (
            <button type="button" className="ab-btn ab-btn--sm ab-btn--ghost settings-secondary-button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '불러오는 중이에요' : '더 보기'}
            </button>
          )}
        </>
      )}

      <button type="button" className="ab-btn ab-btn--ghost ab-btn--block settings-home-button" onClick={onBack}>
        설정으로
      </button>
    </main>
  );
}
