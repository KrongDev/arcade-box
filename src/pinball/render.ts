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
  fx.drawBackground(ctx);
  drawInserts(ctx, engine, theme, t);
  drawWalls(ctx, engine, theme, fx.wallGlow());
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
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = blink ? theme.bumperFlash : theme.bumper;
    ctx.fillText('잠금', SAUCER.x, SAUCER.y + 62);
  }

  // 보너스 배율 ×2 ~ ×5
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 12px ${FONT}`;
  for (let m = 2; m <= MAX_MULTIPLIER; m++) {
    const x = 128 + (m - 2) * 33;
    const y = 400;
    const lit = engine.multiplier >= m;
    if (lit) {
      solidCircle(ctx, x, y, 13, theme.coin, mix(theme.coin, '#000000', 0.25), 2.5);
      ctx.fillStyle = theme.table;
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
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

function drawWalls(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, glow: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (dy: number) => {
    ctx.beginPath();
    for (const w of WALLS) {
      if (w.oneWay) continue; // 발사대 바닥은 플런저로 따로 그린다
      ctx.moveTo(w.ax, w.ay + dy);
      ctx.lineTo(w.bx, w.by + dy);
    }
    if (engine.gateClosed) {
      ctx.moveTo(GATE.ax, GATE.ay + dy);
      ctx.lineTo(GATE.bx, GATE.by + dy);
    }
  };
  // 레일 두께: 아래쪽 진한 띠
  ctx.strokeStyle = mix(theme.wall, theme.table, 0.55);
  ctx.lineWidth = 5;
  path(3);
  ctx.stroke();
  ctx.strokeStyle = theme.wall;
  if (glow > 0) {
    ctx.shadowColor = theme.wall;
    ctx.shadowBlur = 10 * glow;
  }
  path(0);
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
      ctx.fill();
      if (l.flash > 0) {
        ctx.strokeStyle = withAlpha(theme.coin, l.flash * 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(l.x, l.y, 11 + l.flash * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
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
    ctx.fillStyle = mix(theme.bumper, '#000000', 0.3);
    ctx.beginPath();
    ctx.roundRect(tg.x - 4, tg.y1 + 2, 8, tg.y2 - tg.y1 + 2, 3);
    ctx.fill();
    ctx.fillStyle = theme.bumper;
    ctx.beginPath();
    ctx.roundRect(tg.x - 4, tg.y1 - 1, 8, tg.y2 - tg.y1, 3);
    ctx.fill();
    ctx.fillStyle = theme.bumperFlash;
    ctx.beginPath();
    ctx.roundRect(tg.x - 1.5, tg.y1 + 3, 3, tg.y2 - tg.y1 - 8, 1.5);
    ctx.fill();
  }
}

function drawSaucer(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, t: number): void {
  const { x, y, r } = SAUCER;
  const pulse = engine.lockLit ? 0.5 + 0.5 * Math.sin(t * 8) : 0;
  ctx.fillStyle = mix(theme.table, '#000000', 0.55);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mix(theme.table, '#000000', 0.25);
  ctx.beginPath();
  ctx.arc(x, y + r * 0.35, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  const ring = engine.saucerFlash > 0 ? theme.bumperFlash : engine.lockLit ? theme.bumper : theme.wall;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3 + pulse * 2.5 + engine.saucerFlash * 3;
  ctx.beginPath();
  ctx.arc(x, y, r + 1, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSlings(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme): void {
  for (const s of engine.slings) {
    // 몸통: 판보다 밝게 채우고 테두리에 빛을 둔다
    const tri = (dy: number) => {
      ctx.beginPath();
      ctx.moveTo(s.top.x, s.top.y + dy);
      ctx.lineTo(s.corner.x, s.corner.y + dy);
      ctx.lineTo(s.tip.x, s.tip.y + dy);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.fillStyle = ctx.strokeStyle = mix(theme.wall, theme.table, 0.6);
    tri(4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = mix(theme.table, theme.wall, 0.3 + s.flash * 0.35);
    ctx.strokeStyle = theme.wall;
    tri(0);
    ctx.fill();
    ctx.stroke();

    // 차는 면의 고무줄 — 맞으면 바깥으로 튀어나왔다 돌아온다
    const bulge = s.flash * 7;
    const mx = (s.top.x + s.tip.x) / 2 + s.nx * bulge;
    const my = (s.top.y + s.tip.y) / 2 + s.ny * bulge;
    ctx.strokeStyle = s.flash > 0 ? theme.bumperFlash : theme.flipper;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.tip.x, s.tip.y);
    ctx.quadraticCurveTo(mx, my, s.top.x, s.top.y);
    ctx.stroke();

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
    const pop = b.flash * 0.16;
    const r = b.r * (1 + pop);
    const lift = 5 - b.flash * 3; // 맞으면 뚜껑이 눌렸다가 올라온다
    // 판에 닿는 그림자
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + lift + 2, b.r + 3, b.r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    // 바깥 고무 링
    solidCircle(ctx, b.x, b.y, r + 3, theme.bumperRing, mix(theme.bumperRing, '#000000', 0.35), lift);
    // 뚜껑
    const cap = b.flash > 0 ? mix(theme.bumper, theme.bumperFlash, b.flash) : theme.bumper;
    solidCircle(ctx, b.x, b.y - 1, r - 2, cap, mix(theme.bumper, '#000000', 0.3), 3);
    // 가운데 고리
    ctx.strokeStyle = withAlpha(theme.bumperFlash, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y - 2, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 두 톤 원: 아래로 depth만큼 진한 색을 깔고 그 위에 면 색 */
function solidCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, face: string, side: string, depth: number): void {
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.arc(x, y + depth, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
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
    ctx.fillStyle = engine.charge >= 1 ? theme.bumper : theme.coin;
    ctx.fillRect(x, bottom - h, 4, h);
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
    // 동전 두께(아래 띠)와 안쪽 테는 같은 진한 금색 — coinRing은 밝은 색이라 띠로 쓰면 뜬다
    const edge = mix(theme.coin, '#000000', 0.25);
    solidCircle(ctx, 0, 0, r, theme.coin, edge, 2.5);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -0.5, r * 0.58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 플리퍼: 축 쪽이 두껍고 끝으로 갈수록 가는 모양. 아래 진한 띠가 두께다 */
function drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper, theme: TableTheme): void {
  const tip = flipperTip(f);
  const ang = Math.atan2(tip.y - f.py, tip.x - f.px);
  const r1 = 9;
  const r2 = 5;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const shape = (dy: number) => {
    ctx.beginPath();
    ctx.moveTo(f.px + nx * r1, f.py + dy + ny * r1);
    ctx.lineTo(tip.x + nx * r2, tip.y + dy + ny * r2);
    ctx.arc(tip.x, tip.y + dy, r2, ang + Math.PI / 2, ang - Math.PI / 2, true);
    ctx.lineTo(f.px - nx * r1, f.py + dy - ny * r1);
    ctx.arc(f.px, f.py + dy, r1, ang - Math.PI / 2, ang + Math.PI / 2, true);
    ctx.closePath();
  };
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  shape(7);
  ctx.fill();
  ctx.fillStyle = mix(theme.flipper, theme.plunger, 0.55);
  shape(3.5);
  ctx.fill();
  ctx.fillStyle = f.pressed ? mix(theme.flipper, '#ffffff', 0.2) : theme.flipper;
  shape(0);
  ctx.fill();
  // 고무 테
  ctx.strokeStyle = theme.bumper;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 축
  solidCircle(ctx, f.px, f.py - 1, 3.2, theme.plunger, mix(theme.plunger, '#000000', 0.35), 1.5);
}

function drawBall(ctx: CanvasRenderingContext2D, p: Point, theme: TableTheme, held: boolean): void {
  const { x, y } = p;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 5, BALL_R, BALL_R * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = held ? 0.85 : 1;
  // 그늘(진한 색) 위에 면 색을 왼쪽 위로 비껴 덮어 오른쪽 아래에 초승달 그늘을 남긴다
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = theme.ballDark;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = mix(theme.ballLight, theme.ballDark, 0.3);
  ctx.beginPath();
  ctx.arc(x - 1.6, y - 2, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.ballLight;
  ctx.beginPath();
  ctx.ellipse(x - 3, y - 3.4, 2.6, 1.8, -0.6, 0, Math.PI * 2);
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
