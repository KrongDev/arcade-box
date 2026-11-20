import { PixelPainter, lowCanvas as makeLowCanvas } from '../arcade/pixel';
import { TABLE_H, TABLE_W } from './engine';

export { mix, PIXEL_FONT, type Pt } from '../arcade/pixel';

/**
 * 핀볼 판 픽셀 — 한 칸 = 판 좌표 P. 그리기 도구는 게임 공용(arcade/pixel)을 쓴다.
 */
export const P = 3;
export const LOW_W = Math.ceil(TABLE_W / P);
export const LOW_H = Math.ceil(TABLE_H / P);

export class Pix extends PixelPainter {
  constructor(ctx: CanvasRenderingContext2D) {
    super(ctx, P);
  }
}

/** 핀볼 판 크기의 낮은 해상도 캔버스 하나 */
export function lowCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  return makeLowCanvas(LOW_W, LOW_H);
}
