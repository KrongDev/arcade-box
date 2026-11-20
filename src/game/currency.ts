import type { CSSProperties } from 'react';
import type { GameId } from './registry';

/**
 * 게임별 코인 색 — 코인은 게임마다 따로 쓰므로(핀볼 코인은 핀볼 아이템에만) 색으로도 구분한다.
 * face/light/side는 픽셀 동전의 면·밝은 테·어두운 테, ink는 밝은 판 위 코인 숫자 글자색(대비 4.5:1 이상),
 * lcd는 검은 액정 위 숫자색, soft/edge는 밝은 카드 바탕과 테두리다. 새 게임을 더하면 여기에 한 줄을 더한다.
 */
export interface CurrencyColor {
  face: string;
  light: string;
  side: string;
  lcd: string;
  ink: string;
  soft: string;
  edge: string;
}

export const CURRENCY: Record<GameId, CurrencyColor> = {
  pinball: { face: '#ffd93d', light: '#fff3a8', side: '#c98a00', lcd: '#ffd93d', ink: '#8f5a00', soft: '#fff3d6', edge: '#f5c96a' },
  minesweeper: { face: '#3ccfa4', light: '#a8f0dc', side: '#14896a', lcd: '#5fe0bc', ink: '#0b6e50', soft: '#dcf6ec', edge: '#9fe3cc' },
  breakout: { face: '#ff8a5c', light: '#ffd0bb', side: '#c4502a', lcd: '#ff9d75', ink: '#a33c16', soft: '#ffe8de', edge: '#ffb898' },
};

/** 화면 CSS가 쓰는 코인 색 변수(--cur-*) */
export function currencyVars(game: GameId): CSSProperties {
  const c = CURRENCY[game];
  return {
    '--cur-face': c.face,
    '--cur-side': c.side,
    '--cur-lcd': c.lcd,
    '--cur-ink': c.ink,
    '--cur-soft': c.soft,
    '--cur-edge': c.edge,
  } as CSSProperties;
}
