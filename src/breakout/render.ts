import { PixelPainter, lowCanvas, mix, withAlpha } from '../arcade/pixel';
import type { BrickSetLook, PaddleLook } from '../game/catalog';
import { CURRENCY } from '../game/currency';
import type { BreakoutEngine, Drop } from './engine';
import { brickColor, POWER_INFO, type BreakoutFx } from './fx';
import { BALL_R, DROP_SIZE, FIELD_H, FIELD_W } from './rules';
import type { Brick } from './stages';

/**
 * 벽돌깨기 화면 그리기 — 낮은 해상도(한 칸 = 게임 좌표 P)에 칸 단위로 칠한 뒤 흐림 없이 키운다.
 * 엔진 상태를 읽기만 하고 바꾸지 않는다.
 */

export interface BreakoutTheme {
  paddle: PaddleLook;
  bricks: BrickSetLook;
}

export const P = 3;
const LOW_W = Math.ceil(FIELD_W / P);
const LOW_H = Math.ceil(FIELD_H / P);
const COIN = CURRENCY.breakout;

let low: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pix: PixelPainter } | null = null;
/** 바뀌지 않는 바닥·테두리는 한 번만 그려 둔다(벽돌 색이 바뀌면 다시) */
let base: { canvas: HTMLCanvasElement; look: BrickSetLook } | null = null;

export function drawBreakout(ctx: CanvasRenderingContext2D, engine: BreakoutEngine, theme: BreakoutTheme, fx: BreakoutFx): void {
  if (!low) {
    const c = lowCanvas(LOW_W, LOW_H);
    low = { ...c, pix: new PixelPainter(c.ctx, P) };
  }
  if (!base || base.look !== theme.bricks) base = { canvas: drawBase(theme.bricks), look: theme.bricks };

  const pix = low.pix;
  low.ctx.globalCompositeOperation = 'source-over';
  low.ctx.drawImage(base.canvas, 0, 0);

  for (const b of engine.bricks) drawBrick(pix, b, theme);
  for (const d of engine.drops) drawDrop(pix, d, engine.time);
  drawPaddle(pix, engine, theme.paddle);
  if (engine.state === 'ready') drawAim(pix, engine, theme.paddle);
  fx.drawUnder(pix, theme);
  for (const b of engine.balls) drawBall(pix, b.x, b.y, theme.paddle);
  fx.drawOver(pix);

  // 화면에 올리기: 칸을 흐림 없이 키운다
  ctx.fillStyle = theme.bricks.page;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  const shake = fx.shakeOffset();
  ctx.save();
  ctx.translate(Math.round(shake.x / P) * P, Math.round(shake.y / P) * P);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low.canvas, 0, 0, LOW_W * P, LOW_H * P);
  fx.drawText(ctx, FIELD_W, FIELD_H);
  ctx.restore();
}

/** 판 바탕: 점 무늬와 위·옆 테두리(공이 튕기는 벽) */
function drawBase(look: BrickSetLook): HTMLCanvasElement {
  const { canvas, ctx } = lowCanvas(LOW_W, LOW_H);
  const pix = new PixelPainter(ctx, P);
  ctx.fillStyle = look.field;
  ctx.fillRect(0, 0, LOW_W, LOW_H);
  for (let y = 4; y < LOW_H; y += 8) for (let x = (y / 8) % 2 ? 2 : 6; x < LOW_W; x += 8) pix.cells(x, y, 1, 1, look.dot);
  const under = mix(look.frame, look.field, 0.55);
  pix.cells(0, 0, LOW_W, 1, look.frame);
  pix.cells(0, 1, LOW_W, 1, under);
  pix.cells(0, 0, 1, LOW_H, look.frame);
  pix.cells(LOW_W - 1, 0, 1, LOW_H, look.frame);
  return canvas;
}

/** 벽돌: 면 + 윗줄 빛 + 아랫줄 그림자. 단단한 벽돌은 테두리, 금 간 벽돌은 금, 특수 벽돌은 가운데 어두운 홈에 표시 */
function drawBrick(pix: PixelPainter, b: Brick, theme: BreakoutTheme): void {
  const tough = b.kind === 'tough';
  const face = brickColor(theme, b.row, tough);
  const cx = Math.round(b.x / P);
  const cy = Math.round(b.y / P);
  const w = Math.round(b.w / P);
  const h = Math.round(b.h / P);
  pix.cells(cx, cy, w, h, face);
  pix.cells(cx, cy, w, 1, mix(face, '#ffffff', 0.45));
  pix.cells(cx, cy + h - 1, w, 1, mix(face, '#000000', 0.4));
  if (tough) {
    pix.cells(cx, cy, 1, h, mix(face, '#ffffff', 0.25));
    pix.cells(cx + w - 1, cy, 1, h, mix(face, '#000000', 0.25));
    if (b.hp < 2) {
      // 금: 비스듬한 칸 몇 개
      const crack = mix(face, '#000000', 0.55);
      pix.cells(cx + 3, cy + 1, 1, 1, crack);
      pix.cells(cx + 4, cy + 2, 1, 1, crack);
      pix.cells(cx + 6, cy + 1, 1, 1, crack);
      pix.cells(cx + 7, cy + 2, 1, 1, crack);
    }
    return;
  }
  if (!b.special) return;
  // 어두운 홈을 파서 어느 색 줄이든 표시가 또렷하게 보이게 한다
  const mx = cx + Math.floor(w / 2);
  pix.cells(cx + 2, cy + 1, w - 4, h - 2, mix(face, '#000000', 0.45));
  if (b.special === 'coin') {
    pix.cells(mx - 2, cy + 1, 4, h - 2, COIN.side);
    pix.cells(mx - 1, cy + 1, 2, h - 2, COIN.face);
    pix.cells(mx - 1, cy + 1, 1, 1, COIN.light);
  } else {
    const color = POWER_INFO[b.special].color;
    pix.cells(mx - 3, cy + 1, 6, h - 2, color);
    pix.cells(mx - 3, cy + 1, 1, 1, '#ffffff');
  }
}

/** 떨어지는 것: 동전(돌면서 좁아졌다 넓어진다)과 아이템 캡슐 */
function drawDrop(pix: PixelPainter, d: Drop, time: number): void {
  if (d.kind === 'coin') {
    const spin = Math.abs(Math.cos(time * 6 + d.id));
    const rx = Math.max(P, (DROP_SIZE / 2) * spin);
    pix.ellipse(d.x, d.y + 2, rx, DROP_SIZE / 2, COIN.side);
    pix.ellipse(d.x, d.y, rx, DROP_SIZE / 2 - 1, COIN.face);
    if (spin > 0.5) pix.ellipse(d.x - rx * 0.3, d.y - 2, rx * 0.35, 2, COIN.light);
    return;
  }
  const info = POWER_INFO[d.kind];
  const w = DROP_SIZE + 8;
  const h = DROP_SIZE - 4;
  pix.rect(d.x - w / 2, d.y - h / 2 + P, w, h, mix(info.color, '#000000', 0.45));
  pix.rect(d.x - w / 2, d.y - h / 2, w, h, info.color);
  pix.rect(d.x - w / 2 + P, d.y - h / 2, w - 2 * P, P, mix(info.color, '#ffffff', 0.5));
  // 아이템마다 다른 표시: 넓은 패들 ↔, 멀티볼 점 셋, 느린 공 가운데 점 하나
  const ink = '#ffffff';
  if (d.kind === 'wide') {
    pix.rect(d.x - 7, d.y, 14, P, ink);
  } else if (d.kind === 'multi') {
    for (const dx of [-6, 0, 6]) pix.rect(d.x + dx - 1, d.y - 1, P, P, ink);
  } else {
    pix.rect(d.x - 2, d.y - 2, P + 1, P + 1, ink);
  }
}

/** 패들: 윗면 빛 · 몸통 · 아래 그림자, 끝은 한 칸 깎는다. 넓은 패들이면 빛 테 */
function drawPaddle(pix: PixelPainter, engine: BreakoutEngine, look: PaddleLook): void {
  const p = engine.paddle;
  const x0 = Math.round((p.x - p.w / 2) / P);
  const x1 = Math.round((p.x + p.w / 2) / P);
  const y0 = Math.round(p.y / P);
  const h = Math.max(4, Math.round(p.h / P));
  const w = x1 - x0;
  if (engine.powers.wide > 0) {
    const blink = engine.powers.wide < 2 && Math.sin(engine.time * 18) > 0;
    if (!blink) pix.cells(x0 - 1, y0 - 1, w + 2, h + 2, withAlpha(look.light, 0.35));
  }
  pix.cells(x0 + 1, y0, w - 2, 1, look.light);
  pix.cells(x0, y0 + 1, w, h - 2, look.body);
  pix.cells(x0 + 1, y0 + h - 1, w - 2, 1, look.shade);
}

/** 발사 전: 공 위로 점선 안내 */
function drawAim(pix: PixelPainter, engine: BreakoutEngine, look: PaddleLook): void {
  const ball = engine.balls[0];
  if (!ball) return;
  const a = 0.35 + 0.25 * Math.sin(engine.time * 6);
  for (let i = 1; i <= 4; i++) pix.cells(ball.x / P, (ball.y - BALL_R - i * 12) / P, 1, 1, withAlpha(look.ballLight, a));
}

/** 공: 진한 바탕 위에 면 색을 왼쪽 위로 비껴 덮고, 반짝임 */
function drawBall(pix: PixelPainter, x: number, y: number, look: PaddleLook): void {
  pix.disc(x, y, BALL_R + 1, look.ballDark);
  pix.disc(x - 1, y - 1, BALL_R, mix(look.ballLight, look.ballDark, 0.25));
  pix.cells((x - 3) / P, (y - 3) / P, 1, 1, look.ballLight);
}
