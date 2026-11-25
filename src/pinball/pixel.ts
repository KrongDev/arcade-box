import { PixelPainter, lowCanvas as makeLowCanvas } from '../arcade/pixel';
import { TABLE_H, VIEW_H, VIEW_W } from './table';

export { mix, PIXEL_FONT, type Pt } from '../arcade/pixel';

/**
 * 핀볼 판 픽셀 — 한 칸 = 판 좌표 P. 그리기 도구는 게임 공용(arcade/pixel)을 쓴다.
 * 낮은 해상도 캔버스는 화면에 보이는 범위(LOW_W × LOW_H)만큼이고,
 * 바뀌지 않는 그림은 판 전체 높이(FULL_H)로 미리 그려 두었다가 보이는 만큼 잘라 쓴다.
 */
export const P = 3;
export const LOW_W = Math.ceil(VIEW_W / P);
export const LOW_H = Math.ceil(VIEW_H / P);
export const FULL_H = Math.ceil(TABLE_H / P);

export class Pix extends PixelPainter {
  constructor(ctx: CanvasRenderingContext2D) {
    super(ctx, P);
  }
}

/** 낮은 해상도 캔버스 하나 (칸 수 기준. 안 주면 보이는 범위 크기) */
export function lowCanvas(width = LOW_W, height = LOW_H): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  return makeLowCanvas(width, height);
}
