import { graniteEvent } from '@apps-in-toss/web-framework';
import { useEffect, useRef, useState } from 'react';
import { ItemPreview } from '../components/ItemPreview';
import { CATALOG, SLOT_NAMES, slotsOf, type ShopItem } from '../game/catalog';
import { isEquipped, isOwned } from '../game/equipped';
import { haptic } from '../game/haptic';
import { useRewardedAd } from '../game/ads';
import { canPurchase, fetchDisplayPrices, purchase, skuOf } from '../game/iap';
import { playSfx, setSfxSuspended } from '../game/sfx';
import { AD_REWARD_COINS, GAMES, getGame, type GameId } from '../game/registry';
import { Coin } from '../components/gameIcons';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import '../styles/game-dialog.css';
import './Shop.css';

type Tab = 'coin' | 'paid';

export default function Shop({ onExit }: { onExit: () => void }) {
  const { save, buyItem, equipItem, grantPaidOrder, adRewardsLeft, claimAdReward, serverStatus } = useSave();
  const ad = useRewardedAd();
  const insets = useSafeArea();

  const games = GAMES.filter((g) => save.unlocked.includes(g.id) && g.playable);
  const [game, setGame] = useState<GameId>(games[0]?.id ?? 'pinball');
  const [tab, setTab] = useState<Tab>('coin');
  const [confirming, setConfirming] = useState<ShopItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const purchaseCleanup = useRef<(() => void) | null>(null);

  const balance = save.coins[game] ?? 0;
  const gameName = getGame(game).name;

  useEffect(() => {
    try {
      return graniteEvent.addEventListener('backEvent', {
        onEvent: () => (confirming ? setConfirming(null) : onExit()),
        onError: () => undefined,
      });
    } catch {
      return undefined;
    }
  }, [confirming, onExit]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // 콘솔에 등록한 표시 가격을 불러온다
  useEffect(() => {
    let alive = true;
    void fetchDisplayPrices().then((p) => alive && setPrices(p));
    return () => {
      alive = false;
    };
  }, []);

  // 화면을 떠나면 진행 중인 결제 리소스를 정리한다
  useEffect(
    () => () => {
      purchaseCleanup.current?.();
      setSfxSuspended(false);
    },
    [],
  );

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), message.length > 24 ? 3200 : 1800);
  };

  const buyPaid = (item: ShopItem) => {
    if (purchasingId) return;
    setPurchasingId(item.id);
    setSfxSuspended(true);
    purchaseCleanup.current = purchase(
      item,
      (orderId) => grantPaidOrder(orderId, item.id),
      (outcome) => {
        purchaseCleanup.current = null;
        setPurchasingId(null);
        setSfxSuspended(false);
        if (outcome.kind === 'success') {
          haptic('success', 0);
          playSfx('buy');
          showToast(`${item.name}을 장착했어요`);
        } else if (outcome.kind === 'pending') {
          showToast('결제 승인을 기다리고 있어요. 승인되면 앱을 다시 열 때 받을 수 있어요');
        } else if (outcome.kind === 'error') {
          showToast(outcome.message);
        }
      },
    );
  };

  const confirmBuy = () => {
    if (!confirming) return;
    const item = confirming;
    setConfirming(null);
    const result = buyItem(item.id);
    if (result === 'ok') {
      haptic('success', 0);
      playSfx('buy');
      showToast(`${item.name}을 장착했어요`);
    } else if (result === 'insufficient') {
      showToast('코인이 부족해요');
    }
  };

  const equip = (item: ShopItem) => {
    equipItem(item.id);
    haptic('tap', 0);
    showToast(`${item.name}을 장착했어요`);
  };

  const watchAd = () => {
    if (ad.status === 'failed') {
      ad.reload();
      return;
    }
    const target = game;
    let granted = false;
    ad.show(
      () => {
        granted = claimAdReward(target);
      },
      (result) => {
        if (result === 'rewarded' && granted) {
          haptic('success', 0);
          playSfx('coin');
          showToast(`${getGame(target).name} 코인 ${AD_REWARD_COINS}개를 받았어요`);
        } else if (result === 'closed-early') {
          showToast('광고를 끝까지 보면 코인을 받을 수 있어요');
        } else if (result === 'failed') {
          showToast('광고를 보여 주지 못했어요. 잠시 뒤 다시 시도해 주세요');
        }
      },
    );
  };

  const adButtonLabel =
    adRewardsLeft <= 0
      ? '내일 다시'
      : ad.status === 'ready'
        ? '광고 보기'
        : ad.status === 'showing'
          ? '보는 중'
          : ad.status === 'failed'
            ? '다시 불러오기'
            : '준비 중';
  const adButtonDisabled = adRewardsLeft <= 0 || (ad.status !== 'ready' && ad.status !== 'failed');

  const inTab = (item: ShopItem) => (tab === 'paid' ? item.price.type === 'paid' : item.price.type !== 'paid');

  return (
    <main className="shop" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <header className="shop-header">
        <h1 className="shop-title">
          <span className="tf">🛍️</span> 상점
        </h1>
        <p className="shop-subtitle">게임에서 모은 코인으로 판과 공을 꾸며요</p>
      </header>

      {games.length > 1 && (
        <div className="shop-segment" role="tablist" aria-label="게임 선택">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === game}
              className={g.id === game ? 'shop-segment-button is-active' : 'shop-segment-button'}
              onClick={() => setGame(g.id)}
            >
              <span className="tf">{g.emoji}</span> {g.name}
            </button>
          ))}
        </div>
      )}

      <section className="shop-balance" aria-label={`${gameName} 코인`}>
        <p className="shop-balance-amount">
          <Coin /> {balance.toLocaleString()}
        </p>
        <p className="shop-balance-desc">{gameName} 코인은 {gameName} 아이템에만 쓸 수 있어요</p>
      </section>

      {ad.status !== 'unsupported' && (
        <section className="shop-ad" aria-label="광고 보고 코인 받기">
          <div className="shop-ad-text">
            <p className="shop-ad-title">
              <span className="tf">📺</span> 광고 보고 코인 {AD_REWARD_COINS}개 받기
            </p>
            <p className="shop-ad-desc">
              {adRewardsLeft > 0
                ? `광고를 끝까지 보면 ${gameName} 코인을 받아요. 오늘 ${adRewardsLeft}번 남았어요`
                : '오늘 받을 수 있는 광고 보상을 다 받았어요'}
            </p>
          </div>
          <button type="button" className="shop-ad-button" disabled={adButtonDisabled} onClick={watchAd}>
            {adButtonLabel}
          </button>
        </section>
      )}

      <div className="shop-tabs" role="tablist" aria-label="아이템 종류">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'coin'}
          className={tab === 'coin' ? 'shop-tab is-active' : 'shop-tab'}
          onClick={() => setTab('coin')}
        >
          코인 아이템
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'paid'}
          className={tab === 'paid' ? 'shop-tab is-active' : 'shop-tab'}
          onClick={() => setTab('paid')}
        >
          유료 아이템
        </button>
      </div>

      {tab === 'paid' && (
        <p className="shop-notice">
          산 유료 아이템은 토스 구매 내역에 남아서, 기기를 바꾸거나 앱을 다시 설치해도 다시 받을 수 있어요.
        </p>
      )}

      {slotsOf(game).map((slot) => {
        const items = CATALOG.filter((i) => i.game === game && i.slot === slot && inTab(i));
        if (items.length === 0) return null;
        return (
          <section key={slot} className="shop-section" aria-label={SLOT_NAMES[slot]}>
            <h2 className="shop-section-title">{SLOT_NAMES[slot]}</h2>
            <ul className="shop-grid">
              {items.map((item) => (
                <li key={item.id} className="shop-item">
                  <ItemPreview item={item} />
                  <p className="shop-item-name">{item.name}</p>
                  <ItemAction
                    item={item}
                    balance={balance}
                    displayPrice={prices[skuOf(item) ?? '']}
                    purchasing={purchasingId === item.id}
                    busy={purchasingId !== null}
                    onBuy={setConfirming}
                    onBuyPaid={buyPaid}
                    onEquip={equip}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="shop-footnote">
        {serverStatus === 'off'
          ? '코인과 코인 아이템은 이 기기에만 저장돼요.'
          : '코인과 코인 아이템은 서버에 저장돼서 기기를 바꿔도 이어져요.'}
      </p>

      <button type="button" className="shop-home-button" onClick={onExit}>
        홈으로
      </button>

      {toast && (
        <div className="shop-toast" role="status" style={{ bottom: insets.bottom + 34 }}>
          {toast}
        </div>
      )}

      {confirming && confirming.price.type === 'coin' && (
        <div className="game-overlay shop-overlay" onClick={() => setConfirming(null)}>
          <section
            className="game-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shop-confirm-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="shop-confirm-preview">
              <ItemPreview item={confirming} />
            </div>
            <h2 id="shop-confirm-title" className="dialog-title">
              {confirming.name}을 살까요?
            </h2>
            <p className="dialog-body">
              {gameName} 코인 {confirming.price.amount.toLocaleString()}개를 써요. 사면 바로 장착돼요.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={confirmBuy}>
                사기
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)}>
                취소
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ItemAction({
  item,
  balance,
  displayPrice,
  purchasing,
  busy,
  onBuy,
  onBuyPaid,
  onEquip,
}: {
  item: ShopItem;
  balance: number;
  displayPrice: string | undefined;
  purchasing: boolean;
  busy: boolean;
  onBuy: (item: ShopItem) => void;
  onBuyPaid: (item: ShopItem) => void;
  onEquip: (item: ShopItem) => void;
}) {
  const { save } = useSave();

  if (isEquipped(save, item)) {
    return <p className="shop-item-state">장착 중</p>;
  }
  if (isOwned(save, item)) {
    return (
      <button type="button" className="shop-item-button is-secondary" onClick={() => onEquip(item)}>
        장착하기
      </button>
    );
  }
  if (item.price.type === 'paid') {
    const price = displayPrice ?? `${item.price.krw.toLocaleString()}원`;
    if (!skuOf(item)) {
      return (
        <>
          <p className="shop-item-price">{price}</p>
          <button type="button" className="shop-item-button" disabled>
            판매 준비 중
          </button>
        </>
      );
    }
    if (!canPurchase()) {
      return (
        <>
          <p className="shop-item-price">{price}</p>
          <button type="button" className="shop-item-button" disabled>
            앱 업데이트 필요
          </button>
        </>
      );
    }
    return (
      <button type="button" className="shop-item-button" disabled={busy} onClick={() => onBuyPaid(item)}>
        {purchasing ? '결제 중이에요' : price}
      </button>
    );
  }
  if (item.price.type === 'coin') {
    const lack = item.price.amount - balance;
    return (
      <>
        <button type="button" className="shop-item-button" disabled={lack > 0} onClick={() => onBuy(item)}>
          <Coin /> {item.price.amount.toLocaleString()}
        </button>
        {lack > 0 && <p className="shop-item-lack">{lack.toLocaleString()}코인 더 모아야 해요</p>}
      </>
    );
  }
  return null;
}
