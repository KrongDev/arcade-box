import type { CSSProperties } from 'react';
import type { GameId } from './registry';

/**
 * 게임별 코인 색 — 코인은 게임마다 따로 쓰므로(핀볼 코인은 핀볼 아이템에만) 색으로도 구분한다.
 * face/side는 동전 그림의 면과 아래 띠, ink는 흰 바탕 위 코인 숫자 글자색(대비 4.5:1 이상),
 * soft/edge는 잔액 카드 바탕과 테두리다. 새 게임을 더하면 여기에 한 줄을 더한다.
 */
export interface CurrencyColor {
  face: string;
  side: string;
  ink: string;
  soft: string;
  edge: string;
}

export const CURRENCY: Record<GameId, CurrencyColor> = {
  pinball: { face: '#ffc53d', side: '#eaa012', ink: '#8f5a00', soft: '#fff3d6', edge: '#f5c96a' },
  minesweeper: { face: '#3ccfa4', side: '#1fa682', ink: '#0b6e50', soft: '#dcf6ec', edge: '#9fe3cc' },
};

/** 화면 CSS가 쓰는 코인 색 변수(--cur-*) */
export function currencyVars(game: GameId): CSSProperties {
  const c = CURRENCY[game];
  return {
    '--cur-face': c.face,
    '--cur-side': c.side,
    '--cur-ink': c.ink,
    '--cur-soft': c.soft,
    '--cur-edge': c.edge,
  } as CSSProperties;
}
