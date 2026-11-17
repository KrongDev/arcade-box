import type { BallLook, PinballTableLook } from '../game/catalog';
import {
  BALL_R,
  BALL_SAVE_TIME,
  GATE,
  LANE_X,
  MAX_MULTIPLIER,
  PLUNGER_TOP,
  PULL_DISTANCE,
  RIGHT_X,
  SAUCER,
  TABLE_H,
  TABLE_W,
  WALLS,
  flipperTip,
  type Flipper,
  type PinballEngine,
  type Point,
} from './engine';
import { withAlpha, type PinballFx } from './fx';

/** 판·공 색은 상점 카탈로그(장착한 코스튬)에서 온다 */
export type TableTheme = PinballTableLook & BallLook;

const SPRING_BOTTOM = TABLE_H - 2;
const GAUGE_HEIGHT = 150;
const FONT = '-apple-system, system-ui, sans-serif';

export function drawTable(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, fx: PinballFx): void {
  const t = engine.time;
  ctx.fillStyle = theme.page;
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);

  const shake = fx.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawFloor(ctx, theme);
  drawInserts(ctx, engine, theme, t);
  drawWalls(ctx, engine, theme);
  drawLanes(ctx, engine, theme);
  drawTargets(ctx, engine, theme);
  drawSaucer(ctx, engine, theme, t);
  drawSlings(ctx, engine, theme);
  drawBumpers(ctx, engine, theme);
  drawPlunger(ctx, engine, theme);
  drawCoins(ctx, engine, theme);
  for (const f of engine.flippers) drawFlipper(ctx, f, theme);

  fx.drawUnder(ctx, theme, BALL_R);
  for (const b of engine.balls) drawBall(ctx, b, theme, b.held > 0);
  const plunger = engine.plungerBall();
  if (plunger) drawBall(ctx, plunger, theme, false);

  fx.drawOver(ctx, TABLE_W, TABLE_H);
  ctx.restore();
}

/** 판 바닥: 은은한 빛, 격자 무늬, 범퍼 주변 원 장식 */
function drawFloor(ctx: CanvasRenderingContext2D, theme: TableTheme): void {
  const bg = ctx.createRadialGradient(TABLE_W / 2, TABLE_H * 0.32, 30, TABLE_W / 2, TABLE_H * 0.42, TABLE_H * 0.78);
  bg.addColorStop(0, theme.tableGlow);
  bg.addColorStop(1, theme.table);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);

  // 비스듬한 격자
  ctx.save();
  ctx.strokeStyle = withAlpha(theme.wall, 0.05);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -TABLE_H; i < TABLE_W; i += 28) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + TABLE_H, TABLE_H);
    ctx.moveTo(i + TABLE_H, 0);
    ctx.lineTo(i, TABLE_H);
  }
  ctx.stroke();

  // 범퍼 무대 원
  ctx.strokeStyle = withAlpha(theme.wall, 0.12);
  ctx.lineWidth = 2;
  for (const r of [92, 70]) {
    ctx.beginPath();
    ctx.arc(185, 200, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 바닥 표시등: 레인·타깃·구멍을 가리키는 화살표, 보너스 배율, 공 살리기 */
function drawInserts(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, t: number): void {
  const blink = Math.sin(t * 10) > 0;

  // 레인 아래 화살표 (위를 가리킴)
  engine.lanes.forEach((l) => arrow(ctx, l.x, 104, -Math.PI / 2, 9, l.lit ? theme.coin : null, theme));
  // 타깃 오른쪽 화살표 (왼쪽을 가리킴)
  engine.targets.forEach((tg) => arrow(ctx, 52, (tg.y1 + tg.y2) / 2, Math.PI, 8, tg.down ? theme.coin : null, theme));
  // 구멍 아래 화살표: 잠금 불이 켜지면 깜박인다
  arrow(ctx, SAUCER.x, SAUCER.y + 40, -Math.PI / 2, 11, engine.lockLit && blink ? theme.bumper : null, theme);
  if (engine.lockLit) {
    ctx.font = `800 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = blink ? theme.bumperFlash : theme.bumper;
    ctx.fillText('잠금', SAUCER.x, SAUCER.y + 62);
  }

  // 보너스 배율 ×2 ~ ×5
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 12px ${FONT}`;
  for (let m = 2; m <= MAX_MULTIPLIER; m++) {
    const x = 128 + (m - 2) * 33;
    const y = 400;
    const lit = engine.multiplier >= m;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    if (lit) {
      ctx.fillStyle = theme.coin;
      ctx.shadowColor = theme.coin;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.table;
    } else {
      ctx.fillStyle = withAlpha(theme.wall, 0.1);
      ctx.fill();
      ctx.strokeStyle = withAlpha(theme.wall, 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = withAlpha(theme.wall, 0.6);
    }
    ctx.fillText(`×${m}`, x, y + 0.5);
  }

  // 공 살리기 방패 (플리퍼 사이)
  const saving = engine.saveTimer > 0 && !engine.saveUsed;
  const on = saving && (engine.saveTimer > BALL_SAVE_TIME - 2 || blink);
  shield(ctx, 180, 668, on ? theme.wall : null, theme);
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, litColor: string | null, theme: TableTheme): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.75);
  ctx.lineTo(-size * 0.7, size * 0.75);
  ctx.closePath();
  if (litColor) {
    ctx.fillStyle = litColor;
    ctx.shadowColor = litColor;
    ctx.shadowBlur = 12;
    ctx.fill();
  } else {
    ctx.fillStyle = withAlpha(theme.wall, 0.12);
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.wall, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function shield(ctx: CanvasRenderingContext2D, x: number, y: number, litColor: string | null, theme: TableTheme): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(10, -7);
  ctx.quadraticCurveTo(9, 6, 0, 12);
  ctx.quadraticCurveTo(-9, 6, -10, -7);
  ctx.closePath();
  if (litColor) {
    ctx.fillStyle = litColor;
    ctx.shadowColor = litColor;
    ctx.shadowBlur = 14;
    ctx.fill();
  } else {
    ctx.fillStyle = withAlpha(theme.wall, 0.1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(theme.wall, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawWalls(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.wall;
  ctx.shadowColor = theme.wall;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 4;
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
}

function drawLanes(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  for (const l of engine.lanes) {
    const glow = l.lit ? 1 : l.flash;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 7 + l.flash * 2, 0, Math.PI * 2);
    if (glow > 0) {
      ctx.fillStyle = l.lit ? theme.coin : withAlpha(theme.coin, glow);
      ctx.shadowColor = theme.coin;
      ctx.shadowBlur = 10 + l.flash * 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = withAlpha(theme.coin, 0.45);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawTargets(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  for (const tg of engine.targets) {
    if (tg.down) {
      ctx.strokeStyle = withAlpha(theme.wall, 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tg.x - 4, tg.y1 + 2);
      ctx.lineTo(tg.x - 4, tg.y2 - 2);
      ctx.stroke();
      continue;
    }
    const grad = ctx.createLinearGradient(tg.x - 4, 0, tg.x + 4, 0);
    grad.addColorStop(0, theme.bumperRing);
    grad.addColorStop(1, theme.bumper);
    ctx.fillStyle = grad;
    ctx.shadowColor = theme.bumper;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(tg.x - 4, tg.y1 - 1, 8, tg.y2 - tg.y1 + 2, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawSaucer(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, t: number): void {
  const { x, y, r } = SAUCER;
  const pulse = engine.lockLit ? 0.5 + 0.5 * Math.sin(t * 8) : 0;
  const hole = ctx.createRadialGradient(x, y, 2, x, y, r);
  hole.addColorStop(0, '#000000');
  hole.addColorStop(1, withAlpha(theme.table, 1));
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const ring = engine.saucerFlash > 0 ? theme.bumperFlash : engine.lockLit ? theme.bumper : theme.wall;
  ctx.strokeStyle = ring;
  ctx.shadowColor = ring;
  ctx.shadowBlur = 8 + pulse * 14 + engine.saucerFlash * 16;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSlings(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  for (const s of engine.slings) {
    // 몸통: 판보다 밝게 채우고 테두리에 빛을 둔다
    const body = ctx.createLinearGradient(s.corner.x, s.corner.y, s.top.x + s.nx * 20, s.top.y + s.ny * 20);
    body.addColorStop(0, withAlpha(theme.wall, 0.18));
    body.addColorStop(1, withAlpha(theme.wall, 0.45 + s.flash * 0.4));
    ctx.fillStyle = body;
    ctx.strokeStyle = theme.wall;
    ctx.shadowColor = theme.wall;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.top.x, s.top.y);
    ctx.lineTo(s.corner.x, s.corner.y);
    ctx.lineTo(s.tip.x, s.tip.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 차는 면의 고무줄 — 맞으면 바깥으로 튀어나왔다 돌아온다
    const bulge = s.flash * 7;
    const mx = (s.top.x + s.tip.x) / 2 + s.nx * bulge;
    const my = (s.top.y + s.tip.y) / 2 + s.ny * bulge;
    ctx.strokeStyle = s.flash > 0 ? theme.bumperFlash : theme.flipper;
    ctx.shadowColor = s.flash > 0 ? theme.bumper : theme.wall;
    ctx.shadowBlur = 8 + s.flash * 20;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.tip.x, s.tip.y);
    ctx.quadraticCurveTo(mx, my, s.top.x, s.top.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 꼭짓점 기둥
    for (const p of [s.top, s.corner, s.tip]) {
      ctx.fillStyle = theme.flipper;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.bumper;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBumpers(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  for (const b of engine.bumpers) {
    const scale = 1 + b.flash * 0.16;
    const r = b.r * scale;
    // 받침 그림자
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(b.x + 2, b.y + 4, b.r + 3, 0, Math.PI * 2);
    ctx.fill();
    // 바깥 링
    ctx.strokeStyle = theme.bumperRing;
    ctx.shadowColor = theme.bumper;
    ctx.shadowBlur = 10 + b.flash * 22;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 뚜껑
    const cap = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, 2, b.x, b.y, r);
    cap.addColorStop(0, b.flash > 0 ? theme.bumperFlash : mix(theme.bumper, theme.bumperFlash, 0.45));
    cap.addColorStop(1, b.flash > 0 ? mix(theme.bumper, theme.bumperFlash, b.flash) : theme.bumper);
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r - 1, 0, Math.PI * 2);
    ctx.fill();
    // 가운데 별
    star(ctx, b.x, b.y, r * 0.42, withAlpha(theme.bumperFlash, 0.85));
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** 발사대: 당긴 만큼 판(플런저 머리)이 내려가고 스프링이 눌린다. 당기는 중에는 힘 게이지가 찬다 */
function drawPlunger(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  const pull = engine.plungerLoaded ? engine.charge * PULL_DISTANCE : 0;
  const headY = PLUNGER_TOP + pull;
  const left = LANE_X + 5;
  const right = RIGHT_X - 5;

  const coils = 7;
  const top = headY + 6;
  const step = (SPRING_BOTTOM - top) / coils;
  ctx.strokeStyle = theme.plunger;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo((left + right) / 2, top);
  for (let i = 0; i < coils; i++) ctx.lineTo(i % 2 === 0 ? left + 2 : right - 2, top + step * (i + 0.5));
  ctx.lineTo((left + right) / 2, SPRING_BOTTOM);
  ctx.stroke();

  ctx.fillStyle = theme.flipper;
  ctx.beginPath();
  ctx.roundRect(left, headY, right - left, 6, 3);
  ctx.fill();

  if (engine.charging) {
    const x = LANE_X + 4;
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

function drawCoins(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  for (const c of engine.coins) {
    const pop = Math.min(1, c.age * 4);
    const bob = Math.sin(c.age * 3) * 2;
    const r = c.r * pop;
    // 동전이 빙글 도는 느낌: 가로 폭이 줄었다 늘어난다
    const spin = 0.55 + 0.45 * Math.abs(Math.cos(c.age * 2.4));
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    ctx.scale(spin, 1);
    ctx.fillStyle = theme.coin;
    ctx.shadowColor = theme.coin;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = theme.coinRing;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 플리퍼: 축 쪽이 두껍고 끝으로 갈수록 가는 모양 */
function drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper, theme: TableTheme): void {
  const tip = flipperTip(f);
  const ang = Math.atan2(tip.y - f.py, tip.x - f.px);
  const r1 = 9;
  const r2 = 5;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(f.px + 2, f.py + 4, r1, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(f.px + nx * r1, f.py + ny * r1);
  ctx.lineTo(tip.x + nx * r2, tip.y + ny * r2);
  ctx.arc(tip.x, tip.y, r2, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.lineTo(f.px - nx * r1, f.py - ny * r1);
  ctx.arc(f.px, f.py, r1, ang - Math.PI / 2, ang + Math.PI / 2, true);
  ctx.closePath();
  const grad = ctx.createLinearGradient(f.px - nx * r1, f.py - ny * r1, f.px + nx * r1, f.py + ny * r1);
  grad.addColorStop(0, theme.flipper);
  grad.addColorStop(1, mix(theme.flipper, theme.plunger, 0.35));
  ctx.fillStyle = grad;
  ctx.shadowColor = f.pressed ? theme.wall : 'transparent';
  ctx.shadowBlur = f.pressed ? 14 : 0;
  ctx.fill();
  ctx.shadowBlur = 0;
  // 고무 테
  ctx.strokeStyle = theme.bumper;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 축
  ctx.fillStyle = theme.plunger;
  ctx.beginPath();
  ctx.arc(f.px, f.py, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, p: Point, theme: TableTheme, held: boolean): void {
  const { x, y } = p;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 5, BALL_R, BALL_R * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, BALL_R);
  grad.addColorStop(0, theme.ballLight);
  grad.addColorStop(0.55, mix(theme.ballLight, theme.ballDark, 0.45));
  grad.addColorStop(1, theme.ballDark);
  ctx.fillStyle = grad;
  ctx.globalAlpha = held ? 0.85 : 1;
  ctx.beginPath();
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // 반짝임
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(x - 3, y - 3.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}
