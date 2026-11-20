import { useCallback, useEffect, useState } from 'react';
import { ArcadeIcon } from '../components/ArcadeIcon';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { API_BASE } from '../game/api';
import { SUPPORT_EMAIL } from '../game/appInfo';
import { haptic, setHapticEnabled } from '../game/haptic';
import { itemForSku, paymentsAvailable } from '../game/iap';
import { useSave } from '../game/save-context';
import { playSfx, setSoundEnabled } from '../game/sfx';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import { platform } from '../platform';
import '../styles/arcade.css';
import '../styles/game-dialog.css';
import './Settings.css';

function useBackEvent(handler: () => void) {
  useEffect(() => {
    return platform.onBack(handler);
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
  const [eraseOpen, setEraseOpen] = useState(false);
  const closeErase = useCallback(() => setEraseOpen(false), []);
  // 확인 창이 열려 있으면 뒤로가기는 창만 닫는다
  useBackEvent(eraseOpen ? closeErase : onExit);

  return (
    <main className="settings ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <div className="ab-head">
        <button type="button" className="ab-icon-btn" aria-label="홈으로" onClick={onExit}>
          <ChevronLeft size={22} />
        </button>
        <h1 className="ab-plate">
          <span className="ab-stripe ab-stripe--pink">설정</span>
        </h1>
      </div>

      <section className="settings-group" aria-labelledby="settings-sound">
        <h2 id="settings-sound" className="settings-group-title">
          소리와 진동
        </h2>
        <ToggleRow
          label="효과음"
          description="공이 튀거나 칸을 열 때 소리를 내요"
          checked={save.settings.sound}
          onChange={(sound) => {
            updateSettings({ sound });
            // 저장값은 다음 렌더에 반영되니, 켤 때 바로 들려주려면 먼저 켠다
            if (sound) {
              setSoundEnabled(true);
              playSfx('coin');
            }
          }}
        />
        <ToggleRow
          label="진동"
          description={
            platform.id === 'toss'
              ? '게임 중에 짧은 진동으로 알려 줘요. 토스 앱과 휴대폰 설정에서도 진동이 켜져 있어야 해요'
              : '게임 중에 짧은 진동으로 알려 줘요. 휴대폰 설정에서도 진동이 켜져 있어야 해요'
          }
          checked={save.settings.haptic}
          onChange={(on) => {
            updateSettings({ haptic: on });
            if (on) {
              setHapticEnabled(true);
              haptic('basicMedium', 0);
            }
          }}
        />
      </section>

      {paymentsAvailable && (
        <section className="settings-group" aria-labelledby="settings-purchase">
          <h2 id="settings-purchase" className="settings-group-title">
            구매
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
      )}

      <section className="settings-group" aria-labelledby="settings-help">
        <h2 id="settings-help" className="settings-group-title">
          도움말
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
            데이터 저장 안내
          </p>
          {serverStatus === 'off' ? (
            <ul className="settings-info-list">
              <li>코인, 기록, 코인으로 산 아이템은 이 기기에만 저장돼요.</li>
              <li>{platform.id === 'toss' ? '토스 앱' : '앱'}을 지우거나 기기를 바꾸면 이 데이터는 사라져요.</li>
              {paymentsAvailable && <li>유료 아이템은 토스 구매 내역으로 다시 받을 수 있어요.</li>}
            </ul>
          ) : (
            <ul className="settings-info-list">
              <li>코인, 기록, 코인으로 산 아이템은 서버에 저장돼서 기기를 바꿔도 이어져요.</li>
              <li>연결이 끊겨도 이 기기에 먼저 저장했다가, 다시 연결되면 서버에 보내요.</li>
              {paymentsAvailable && <li>유료 아이템은 토스 구매 내역으로 다시 받을 수 있어요.</li>}
            </ul>
          )}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-records">
        <h2 id="settings-records" className="settings-group-title">
          내 기록
        </h2>
        <button type="button" className="settings-row is-link is-danger" onClick={() => setEraseOpen(true)}>
          <span className="settings-row-text">
            <span className="settings-row-label">내 기록 지우기</span>
            <span className="settings-row-desc">
              {API_BASE ? '서버와 이 기기에 저장된 코인, 기록, 아이템을 모두 지워요' : '이 기기에 저장된 코인, 기록, 아이템을 모두 지워요'}
            </span>
          </span>
          <span className="settings-chevron">
            <ChevronRight size={20} />
          </span>
        </button>
      </section>

      <button type="button" className="ab-btn ab-btn--ghost ab-btn--block settings-home-button" onClick={onExit}>
        홈으로
      </button>

      {eraseOpen && <EraseDialog onClose={closeErase} />}
    </main>
  );
}

/* ───────────── 내 기록 지우기 ───────────── */

type EraseState = 'confirm' | 'erasing' | 'error' | 'done';

function EraseDialog({ onClose }: { onClose: () => void }) {
  const { eraseRecords } = useSave();
  const [state, setState] = useState<EraseState>('confirm');
  const busy = state === 'erasing' || state === 'done';

  const erase = async () => {
    setState('erasing');
    const ok = await eraseRecords();
    if (!ok) {
      setState('error');
      return;
    }
    setState('done');
    // 처음 상태로 다시 시작한다 (유료 아이템은 다시 열 때 토스 구매 내역으로 받는다)
    window.setTimeout(() => {
      // 다시 불러온 뒤 설정 화면의 스크롤 위치가 홈에 남지 않게 맨 위에서 시작한다
      history.scrollRestoration = 'manual';
      window.scrollTo(0, 0);
      window.location.reload();
    }, 900);
  };

  return (
    <div className="settings-overlay" onClick={busy ? undefined : onClose}>
      <section
        className="game-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="erase-title"
        aria-describedby="erase-body"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="erase-title" className="dialog-title">
          {state === 'done' ? '기록을 지웠어요' : '기록을 모두 지울까요?'}
        </h2>
        {state === 'done' ? (
          <p id="erase-body" className="dialog-body">
            처음 화면으로 돌아가요.
          </p>
        ) : (
          <div id="erase-body" className="dialog-body settings-erase-body">
            <p>코인, 점수, 깬 단계, 코인으로 산 아이템이 모두 사라지고 열린 게임도 다시 잠겨요.</p>
            {API_BASE && <p>순위표에서도 내 기록이 빠져요.</p>}
            {paymentsAvailable && <p>유료 아이템은 토스 구매 내역으로 다시 받을 수 있어요.</p>}
            <p className="settings-erase-warn">지운 기록은 되돌릴 수 없어요.</p>
          </div>
        )}
        {state === 'error' && (
          <p className="dialog-error settings-erase-error" role="alert">
            지금은 지울 수 없어요. 인터넷 연결을 확인하고 다시 시도해 주세요.
          </p>
        )}
        {state !== 'done' && (
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button type="button" className="btn btn-secondary settings-erase-button" onClick={erase} disabled={busy}>
              {state === 'erasing' ? '지우는 중이에요' : state === 'error' ? '다시 시도' : '기록 지우기'}
            </button>
          </div>
        )}
      </section>
    </div>
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
    return platform.payments?.canReadHistory() ?? false;
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
      if (!platform.payments) throw new Error('payments_unavailable');
      const res = await platform.payments.historyPage(key);
      setState({ kind: 'ready', orders: [...prev, ...res.orders], nextKey: res.nextKey });
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
      <div className="ab-head">
        <button type="button" className="ab-icon-btn" aria-label="설정으로" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1 className="ab-plate">
          <span className="ab-stripe ab-stripe--pink">구매 내역</span>
        </h1>
      </div>

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
            <ArcadeIcon name="receipt" size={48} />
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
