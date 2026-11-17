import type { BallLook, PinballTableLook } from '../game/catalog';
import { BALL_R, GATE, PLUNGER_TOP, PULL_DISTANCE, TABLE_H, TABLE_W, WALLS, flipperTip, type PinballEngine } from './engine';

/** 발사 레인 안쪽 (engine의 LANE_X·RIGHT_X와 같은 값) */
const LANE_LEFT = 350;
const LANE_RIGHT = 392;
const SPRING_BOTTOM = TABLE_H - 2;
const GAUGE_HEIGHT = 150;

/** 발사대: 당긴 만큼 판(플런저 머리)이 내려가고 스프링이 눌린다. 당기는 중에는 힘 게이지가 찬다 */
function drawPlunger(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  const pull = engine.ballState === 'ready' ? engine.charge * PULL_DISTANCE : 0;
  const headY = PLUNGER_TOP + pull;
  const left = LANE_LEFT + 5;
  const right = LANE_RIGHT - 5;

  // 스프링: 머리 아래부터 레인 바닥까지 지그재그 — 당길수록 촘촘해진다
  const coils = 7;
  const top = headY + 6;
  const step = (SPRING_BOTTOM - top) / coils;
  ctx.strokeStyle = theme.plunger;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo((left + right) / 2, top);
  for (let i = 0; i < coils; i++) {
    ctx.lineTo(i % 2 === 0 ? left + 2 : right - 2, top + step * (i + 0.5));
  }
  ctx.lineTo((left + right) / 2, SPRING_BOTTOM);
  ctx.stroke();

  // 플런저 머리 (공이 놓이는 판)
  ctx.fillStyle = theme.flipper;
  ctx.beginPath();
  ctx.roundRect(left, headY, right - left, 6, 3);
  ctx.fill();

  // 힘 게이지 — 당기는 중에만, 레인 안쪽 벽을 따라 아래에서 위로 찬다
  if (engine.charging) {
    const x = LANE_LEFT + 4;
    const bottom = PLUNGER_TOP - 14;
    const h = GAUGE_HEIGHT * engine.charge;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(x, bottom - GAUGE_HEIGHT, 4, GAUGE_HEIGHT);
    const grad = ctx.createLinearGradient(0, bottom, 0, bottom - GAUGE_HEIGHT);
    grad.addColorStop(0, theme.coin);
    grad.addColorStop(1, theme.bumper);
    ctx.fillStyle = grad;
    ctx.shadowColor = engine.charge >= 1 ? theme.bumper : theme.coin;
    ctx.shadowBlur = engine.charge >= 1 ? 12 : 6;
    ctx.fillRect(x, bottom - h, 4, h);
    ctx.shadowBlur = 0;
  }
}

/** 판·공 색은 상점 카탈로그(장착한 코스튬)에서 온다 */
export type TableTheme = PinballTableLook & BallLook;

export function drawTable(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  // 판 바닥
  const bg = ctx.createRadialGradient(TABLE_W / 2, TABLE_H * 0.35, 40, TABLE_W / 2, TABLE_H * 0.4, TABLE_H * 0.75);
  bg.addColorStop(0, theme.tableGlow);
  bg.addColorStop(1, theme.table);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);

  // 벽
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.wall;
  ctx.lineWidth = 4;
  ctx.shadowColor = theme.wall;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (const w of WALLS) {
    if (w.oneWay) continue; // 발사대 바닥은 플런저로 따로 그린다
    ctx.moveTo(w.ax, w.ay);
    ctx.lineTo(w.bx, w.by);
  }
  if (engine.gateClosed) {
    ctx.moveTo(GATE.ax, GATE.ay);
    ctx.lineTo(GATE.bx, GATE.by);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawPlunger(ctx, engine, theme);

  // 판 위 동전
  for (const c of engine.coins) {
    const pop = Math.min(1, c.age * 4);
    const bob = Math.sin(c.age * 3) * 2;
    const r = c.r * pop;
    ctx.fillStyle = theme.coin;
    ctx.shadowColor = theme.coin;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = theme.coinRing;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 범퍼
  for (const b of engine.bumpers) {
    ctx.fillStyle = b.flash > 0 ? mix(theme.bumper, theme.bumperFlash, b.flash) : theme.bumper;
    ctx.shadowColor = theme.bumper;
    ctx.shadowBlur = 12 + b.flash * 16;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = theme.bumperRing;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 플리퍼
  ctx.strokeStyle = theme.flipper;
  ctx.lineWidth = 14;
  for (const f of engine.flippers) {
    const tip = flipperTip(f);
    ctx.beginPath();
    ctx.moveTo(f.px, f.py);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }

  // 공
  const { x, y } = engine.ball;
  const ballGrad = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, BALL_R);
  ballGrad.addColorStop(0, theme.ballLight);
  ballGrad.addColorStop(1, theme.ballDark);
  ctx.fillStyle = ballGrad;
  ctx.beginPath();
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
