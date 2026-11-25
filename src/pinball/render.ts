import type { BallLook, PinballTableLook } from '../game/catalog';
import { flipperTip, type Ball, type Flipper, type PinballEngine } from './engine';
import { withAlpha, type PinballFx } from './fx';
import { FULL_H, LOW_H, LOW_W, P, PIXEL_FONT, Pix, lowCanvas, mix, type Pt } from './pixel';
import { BALL_R, BALL_SAVE_TIME, MAX_MULTIPLIER } from './rules';
import { GATE, KICKBACK, LANE_X, MULT_INSERTS, PLUNGER_TOP, PULL_DISTANCE, RIGHT_X, SAUCER, SAVE_INSERT, TABLE_H, VIEW_H, VIEW_W, WALLS, type Point } from './table';

/**
 * 핀볼 판 그리기 — 픽셀 그림체.
 * 판과 장치는 낮은 해상도 캔버스(한 칸 = 판 좌표 3)에 칸 단위로 칠하고, 흐림 없이 키워서 화면에 올린다.
 * 점수 팝업·큰 알림·배율 글자만 원래 해상도에서 픽셀 글꼴로 쓴다(작은 칸으로는 읽히지 않아서).
 * 판·공 색은 상점 카탈로그(장착한 코스튬)에서 온다.
 *
 * 판이 화면보다 길어서 화면에는 cameraY부터 VIEW_H만큼만 보인다. 낮은 해상도 캔버스는 보이는 범위 크기이고,
 * 판 좌표로 그리는 것들은 세로로 cameraY만큼 밀어서 그린다. cameraY는 3의 배수여야 한다(snapCamera).
 */
export type TableTheme = PinballTableLook & BallLook;

const SPRING_BOTTOM = TABLE_H - 2;
const GAUGE_HEIGHT = 150;
/** 정해진 길 위의 공은 떠 있는 것처럼 그림자를 이만큼 더 멀리 떨어뜨린다 */
const RIDE_LIFT = 6;

let low: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pix: Pix } | null = null;
/** 바뀌지 않는 바닥·벽은 한 번만 그려 둔다(판 색이 바뀌면 다시) */
let base: { canvas: HTMLCanvasElement; key: string } | null = null;

export function drawTable(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, fx: PinballFx, cameraY: number): void {
  if (!low) {
    const c = lowCanvas();
    low = { ...c, pix: new Pix(c.ctx) };
  }
  const key = Object.values(theme).join('|');
  if (!base || base.key !== key) base = { canvas: drawBase(theme), key };

  const t = engine.time;
  const l = low.ctx;
  const pix = low.pix;
  const camCells = Math.round(cameraY / P);
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'source-over';
  l.drawImage(base.canvas, 0, -camCells);
  // 여기부터는 판 좌표로 그린다
  l.setTransform(1, 0, 0, 1, 0, -camCells);

  fx.drawBackground(pix);
  drawInserts(pix, engine, theme, t);
  drawWallsLive(pix, engine, theme, fx.wallGlow());
  drawLanes(pix, engine, theme);
  drawTargets(pix, engine, theme);
  drawStandups(pix, engine, theme);
  drawKickback(pix, engine, theme);
  drawSaucer(pix, engine, theme, t);
  drawSlings(pix, engine, theme);
  drawBumpers(pix, engine, theme);
  drawPlunger(pix, engine, theme);
  drawCoins(pix, engine, theme);
  for (const f of engine.flippers) drawFlipper(pix, f, theme);
  fx.drawUnder(pix, theme, BALL_R);
  for (const b of engine.balls) drawBall(pix, b, theme, b.ride ? RIDE_LIFT : 0);
  const plunger = engine.plungerBall();
  if (plunger) drawBall(pix, plunger, theme);
  fx.drawOver(pix);
  l.setTransform(1, 0, 0, 1, 0, 0);
  drawOffscreenBalls(pix, engine, theme, cameraY);

  // 화면에 올리기: 칸을 흐림 없이 키운다
  ctx.fillStyle = theme.page;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const shake = fx.shakeOffset();
  ctx.save();
  ctx.translate(Math.round(shake.x / P) * P, Math.round(shake.y / P) * P);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low.canvas, 0, 0, LOW_W * P, LOW_H * P);
  ctx.save();
  ctx.translate(0, -cameraY);
  drawLabels(ctx, engine, theme, t);
  ctx.restore();
  fx.drawText(ctx, VIEW_W, VIEW_H, cameraY);
  ctx.restore();
}

/** 화면 밖(위나 아래)에 있는 공은 그쪽 가장자리에 작은 화살표로 알려 준다 — 멀티볼에서 다른 공이 어디 있는지 */
function drawOffscreenBalls(pix: Pix, engine: PinballEngine, theme: TableTheme, cameraY: number): void {
  for (const b of engine.balls) {
    const above = b.y < cameraY - BALL_R;
    const below = b.y > cameraY + VIEW_H + BALL_R;
    if (!above && !below) continue;
    const cx = Math.round(b.x / P);
    const dir = above ? 1 : -1;
    const tip = above ? 1 : LOW_H - 2;
    // 가장자리를 가리키는 세모 (끝 한 칸, 그 뒤로 세 칸, 다섯 칸) + 어두운 테
    for (let row = 0; row < 3; row++) pix.cells(cx - row - 1, tip + dir * row, row * 2 + 3, 1, 'rgba(0, 0, 0, 0.55)');
    for (let row = 0; row < 3; row++) pix.cells(cx - row, tip + dir * row, row * 2 + 1, 1, row === 0 ? theme.ballLight : mix(theme.ballLight, theme.ballDark, 0.35));
  }
}

/** 바닥(계단처럼 밝아지는 가운데 빛, 점 무늬, 범퍼 무대 원)과 벽 */
function drawBase(theme: TableTheme): HTMLCanvasElement {
  const { canvas, ctx } = lowCanvas(LOW_W, FULL_H);
  const pix = new Pix(ctx);
  ctx.fillStyle = theme.table;
  ctx.fillRect(0, 0, LOW_W, FULL_H);
  // 빛은 위쪽(범퍼 둘레)과 아래쪽(플리퍼 위) 두 곳. 옅은 것부터 칠해서 진한 것이 위에 오게 한다
  const glows: [number, number, number, number][] = [
    [200, 250, 300, 0.35],
    [200, 900, 330, 0.35],
    [205, 230, 210, 0.7],
    [200, 880, 240, 0.7],
    [215, 215, 130, 1],
    [195, 860, 150, 1],
  ];
  for (const [x, y, r, k] of glows) pix.disc(x, y, r, mix(theme.table, theme.tableGlow, k));
  const dot = mix(theme.table, theme.wall, 0.14);
  for (let y = 4; y < FULL_H; y += 8) for (let x = (y / 8) % 2 ? 2 : 6; x < LOW_W; x += 8) pix.cells(x, y, 1, 1, dot);
  const stage = mix(theme.tableGlow, theme.wall, 0.22);
  pix.ring(215, 250, 104, 1, stage);
  pix.ring(215, 250, 80, 1, stage);
  wallLines(pix, theme, false);
  return canvas;
}

/** 벽: 아래로 한 칸 진한 띠(두께) + 벽 색 두 칸 */
function wallLines(pix: Pix, theme: TableTheme, gate: boolean): void {
  const under = mix(theme.wall, theme.table, 0.55);
  const walls = gate ? [GATE] : WALLS.filter((w) => !w.oneWay); // 발사대 바닥은 플런저로 따로 그린다
  for (const w of walls) pix.line(w.ax, w.ay + P, w.bx, w.by + P, 2, under);
  for (const w of walls) pix.line(w.ax, w.ay, w.bx, w.by, 2, theme.wall);
}

/** 네온 판의 벽 빛, 닫힌 문 */
function drawWallsLive(pix: Pix, engine: PinballEngine, theme: TableTheme, glow: number): void {
  if (glow > 0) {
    const halo = withAlpha(theme.wall, Math.min(0.35, 0.12 * glow));
    for (const w of WALLS) if (!w.oneWay) pix.line(w.ax, w.ay, w.bx, w.by, 5, halo);
    for (const w of WALLS) if (!w.oneWay) pix.line(w.ax, w.ay, w.bx, w.by, 2, theme.wall);
  }
  if (engine.gateClosed) wallLines(pix, theme, true);
}

/** 바닥 표시등: 레인·타깃·구멍을 가리키는 화살표, 보너스 배율 원, 공 살리기 방패 */
function drawInserts(pix: Pix, engine: PinballEngine, theme: TableTheme, t: number): void {
  const blink = Math.sin(t * 10) > 0;
  const off = mix(theme.tableGlow, theme.wall, 0.25);
  engine.lanes.forEach((l) => arrow(pix, l.x, l.y + 38, -Math.PI / 2, 9, l.lit ? theme.coin : off));
  engine.targets.forEach((tg) => arrow(pix, tg.x + 28, (tg.y1 + tg.y2) / 2, Math.PI, 8, tg.down ? theme.coin : off));
  arrow(pix, SAUCER.x, SAUCER.y + 40, -Math.PI / 2, 11, engine.lockLit && blink ? theme.bumper : off);
  engine.standups.forEach((tg) => arrow(pix, tg.x - 26, (tg.y1 + tg.y2) / 2, 0, 8, tg.lit ? theme.coin : off));

  for (let m = 2; m <= MAX_MULTIPLIER; m++) {
    const { x, y } = MULT_INSERTS[m - 2];
    if (engine.multiplier >= m) {
      pix.disc(x, y + P, 13, mix(theme.coin, '#000000', 0.25));
      pix.disc(x, y, 13, theme.coin);
    } else {
      pix.disc(x, y, 13, mix(theme.table, theme.wall, 0.1));
      pix.ring(x, y, 13, 1, mix(theme.table, theme.wall, 0.35));
    }
  }

  const saving = engine.saveTimer > 0 && !engine.saveUsed;
  const on = saving && (engine.saveTimer > BALL_SAVE_TIME - 2 || blink);
  shield(pix, SAVE_INSERT.x, SAVE_INSERT.y, on ? theme.wall : off);
}

function arrow(pix: Pix, x: number, y: number, angle: number, size: number, color: string): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts: [number, number][] = [
    [size, 0],
    [-size * 0.7, -size * 0.75],
    [-size * 0.7, size * 0.75],
  ];
  pix.poly(
    pts.map(([px, py]) => ({ x: x + px * c - py * s, y: y + px * s + py * c })),
    color,
  );
}

function shield(pix: Pix, x: number, y: number, color: string): void {
  pix.poly(
    [
      { x: x - 10, y: y - 9 },
      { x, y: y - 12 },
      { x: x + 10, y: y - 9 },
      { x: x + 9, y: y + 3 },
      { x, y: y + 12 },
      { x: x - 9, y: y + 3 },
    ],
    color,
  );
}

/** 작은 칸으로는 읽히지 않는 글자(배율·잠금)는 원래 해상도에서 픽셀 글꼴로 */
function drawLabels(ctx: CanvasRenderingContext2D, engine: PinballEngine, theme: TableTheme, t: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 12px ${PIXEL_FONT}`;
  for (let m = 2; m <= MAX_MULTIPLIER; m++) {
    const { x, y } = MULT_INSERTS[m - 2];
    ctx.fillStyle = engine.multiplier >= m ? theme.table : withAlpha(theme.wall, 0.7);
    ctx.fillText(`×${m}`, x, y + 1);
  }
  if (engine.lockLit) {
    ctx.font = `700 13px ${PIXEL_FONT}`;
    ctx.fillStyle = Math.sin(t * 10) > 0 ? theme.bumperFlash : theme.bumper;
    ctx.fillText('잠금', SAUCER.x, SAUCER.y + 62);
  }
}

function drawLanes(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  for (const l of engine.lanes) {
    if (l.lit || l.flash > 0) {
      const r = 7 + l.flash * 2;
      pix.disc(l.x, l.y, r, l.flash > 0 ? mix(theme.coin, '#ffffff', l.flash * 0.5) : theme.coin);
      if (l.flash > 0) pix.ring(l.x, l.y, 11 + l.flash * 6, 1, withAlpha(theme.coin, l.flash * 0.7));
    } else {
      pix.ring(l.x, l.y, 7, 1, mix(theme.table, theme.coin, 0.45));
    }
  }
}

function drawTargets(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  for (const tg of engine.targets) {
    if (tg.down) {
      pix.line(tg.x - 4, tg.y1 + 2, tg.x - 4, tg.y2 - 2, 1, mix(theme.table, theme.wall, 0.35));
      continue;
    }
    pix.rect(tg.x - 4, tg.y1 + 2, 8, tg.y2 - tg.y1, mix(theme.bumper, '#000000', 0.3));
    pix.rect(tg.x - 4, tg.y1 - 1, 8, tg.y2 - tg.y1, theme.bumper);
    pix.rect(tg.x - 1, tg.y1 + 3, 3, tg.y2 - tg.y1 - 8, theme.bumperFlash);
  }
}

/** 오른쪽 타깃: 벽에 붙은 노란 막대. 켜지면 밝아진다 */
function drawStandups(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  for (const tg of engine.standups) {
    const h = tg.y2 - tg.y1;
    const face = tg.lit ? mix(theme.coin, theme.coinRing, tg.flash) : mix(theme.coin, theme.table, 0.55);
    pix.rect(tg.x - 3, tg.y1 + 2, 7, h, mix(theme.coin, '#000000', tg.lit ? 0.4 : 0.6));
    pix.rect(tg.x - 3, tg.y1 - 1, 7, h, face);
    if (tg.lit) pix.rect(tg.x - 1, tg.y1 + 4, 3, h - 10, theme.coinRing);
  }
}

/** 킥백: 왼쪽 바깥 길 바닥의 스프링 달린 머리. 켜져 있으면 밝고 위로 화살표가 보인다 */
function drawKickback(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  const { x, y } = KICKBACK.head;
  const lit = engine.kickbackLit;
  const kicking = engine.balls.some((b) => b.ride?.track === 'kick');
  const color = lit || kicking ? theme.coin : mix(theme.table, theme.wall, 0.35);
  const spring: Pt[] = [{ x, y: y + 6 }];
  for (let i = 0; i < 5; i++) spring.push({ x: i % 2 ? x + 7 : x - 7, y: y + 12 + i * 8 });
  pix.polyline(spring, 1, theme.plunger);
  // 차는 순간에는 머리가 위로 튀어 오른다
  pix.rect(x - 9, y - (kicking ? 14 : 0), 18, 6, color);
  arrow(pix, x, y - 18, -Math.PI / 2, 8, lit ? theme.coin : mix(theme.tableGlow, theme.wall, 0.25));
}

function drawSaucer(pix: Pix, engine: PinballEngine, theme: TableTheme, t: number): void {
  const { x, y, r } = SAUCER;
  const pulse = engine.lockLit ? 0.5 + 0.5 * Math.sin(t * 8) : 0;
  pix.disc(x, y, r, mix(theme.table, '#000000', 0.55));
  pix.disc(x, y + r * 0.35, r * 0.62, mix(theme.table, '#000000', 0.25));
  const ring = engine.saucerFlash > 0 ? theme.bumperFlash : engine.lockLit ? theme.bumper : theme.wall;
  pix.ring(x, y, r + 2, pulse > 0.5 || engine.saucerFlash > 0 ? 2 : 1, ring);
}

function drawSlings(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  for (const s of engine.slings) {
    const tri = (dy: number): Pt[] => [
      { x: s.top.x, y: s.top.y + dy },
      { x: s.corner.x, y: s.corner.y + dy },
      { x: s.tip.x, y: s.tip.y + dy },
    ];
    pix.poly(tri(4), mix(theme.wall, theme.table, 0.6));
    pix.poly(tri(0), mix(theme.table, theme.wall, 0.3 + s.flash * 0.35));
    const edge = tri(0);
    pix.polyline([...edge, edge[0]], 1, theme.wall);

    // 차는 면의 고무줄 — 맞으면 바깥으로 튀어나왔다 돌아온다
    const bulge = s.flash * 7;
    const mx = (s.top.x + s.tip.x) / 2 + s.nx * bulge;
    const my = (s.top.y + s.tip.y) / 2 + s.ny * bulge;
    const band: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      band.push({
        x: (1 - k) ** 2 * s.tip.x + 2 * (1 - k) * k * mx + k * k * s.top.x,
        y: (1 - k) ** 2 * s.tip.y + 2 * (1 - k) * k * my + k * k * s.top.y,
      });
    }
    pix.polyline(band, 2, s.flash > 0 ? theme.bumperFlash : theme.flipper);

    for (const p of [s.top, s.corner, s.tip]) {
      pix.disc(p.x, p.y, 4.5, theme.flipper);
      pix.rect(p.x - 1, p.y - 1, 2, 2, theme.bumper);
    }
  }
}

/** 범퍼: 버섯 모양 — 고무 링(옆면 + 면) 위에 뚜껑(옆면 + 면), 가운데 고리 */
function drawBumpers(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  for (const b of engine.bumpers) {
    const r = b.r * (1 + b.flash * 0.16);
    const lift = 6 - b.flash * 3; // 맞으면 뚜껑이 눌렸다가 올라온다
    pix.ellipse(b.x, b.y + lift + 3, b.r + 3, b.r * 0.9, 'rgba(0, 0, 0, 0.3)');
    pix.disc(b.x, b.y + lift, r + 3, mix(theme.bumperRing, '#000000', 0.35));
    pix.disc(b.x, b.y, r + 3, theme.bumperRing);
    pix.disc(b.x, b.y + 2, r - 3, mix(theme.bumper, '#000000', 0.3));
    pix.disc(b.x, b.y - 1, r - 3, b.flash > 0 ? mix(theme.bumper, theme.bumperFlash, b.flash) : theme.bumper);
    pix.ring(b.x, b.y - 2, r * 0.45, 1, theme.bumperFlash);
  }
}

/** 발사대: 당긴 만큼 판(플런저 머리)이 내려가고 스프링이 눌린다. 당기는 중에는 힘 게이지가 찬다 */
function drawPlunger(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  const pull = engine.plungerLoaded ? engine.charge * PULL_DISTANCE : 0;
  const headY = PLUNGER_TOP + pull;
  const left = LANE_X + 5;
  const right = RIGHT_X - 5;

  const coils = 7;
  const top = headY + 6;
  const step = (SPRING_BOTTOM - top) / coils;
  const spring: Pt[] = [{ x: (left + right) / 2, y: top }];
  for (let i = 0; i < coils; i++) spring.push({ x: i % 2 === 0 ? left + 3 : right - 3, y: top + step * (i + 0.5) });
  spring.push({ x: (left + right) / 2, y: SPRING_BOTTOM });
  pix.polyline(spring, 1, theme.plunger);
  pix.rect(left, headY, right - left, 6, theme.flipper);

  if (engine.charging) {
    const x = LANE_X + 3;
    const bottom = PLUNGER_TOP - 14;
    const h = GAUGE_HEIGHT * engine.charge;
    pix.rect(x, bottom - GAUGE_HEIGHT, 6, GAUGE_HEIGHT, 'rgba(255, 255, 255, 0.12)');
    // 게이지는 칸 단위로 끊어 찬다
    const cells = Math.floor(h / 9);
    for (let i = 0; i < cells; i++) pix.rect(x, bottom - (i + 1) * 9 + 2, 6, 6, engine.charge >= 1 ? theme.bumper : theme.coin);
  }
}

function drawCoins(pix: Pix, engine: PinballEngine, theme: TableTheme): void {
  const edge = mix(theme.coin, '#000000', 0.25);
  for (const c of engine.coins) {
    const pop = Math.min(1, c.age * 4);
    const bob = Math.round(Math.sin(c.age * 3) * 1.4) * P * 0.5;
    const r = c.r * pop;
    // 동전이 빙글 도는 느낌: 가로 폭이 줄었다 늘어난다
    const spin = 0.4 + 0.6 * Math.abs(Math.cos(c.age * 2.4));
    const y = c.y + bob;
    pix.ellipse(c.x, y + P, r * spin, r, edge);
    pix.ellipse(c.x, y, r * spin, r, theme.coin);
    if (spin > 0.6) pix.rect(c.x - 1, y - r * 0.5, 2, r, edge);
  }
}

/** 플리퍼: 축 쪽이 두껍고 끝으로 갈수록 가는 모양. 아래 진한 띠가 두께다 */
function drawFlipper(pix: Pix, f: Flipper, theme: TableTheme): void {
  const tip = flipperTip(f);
  const ang = Math.atan2(tip.y - f.py, tip.x - f.px);
  const r1 = 9;
  const r2 = 5;
  const shape = (dy: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = ang + Math.PI / 2 + (Math.PI * i) / 6;
      pts.push({ x: f.px + Math.cos(a) * r1, y: f.py + dy + Math.sin(a) * r1 });
    }
    for (let i = 0; i <= 6; i++) {
      const a = ang - Math.PI / 2 + (Math.PI * i) / 6;
      pts.push({ x: tip.x + Math.cos(a) * r2, y: tip.y + dy + Math.sin(a) * r2 });
    }
    return pts;
  };
  pix.poly(shape(7), 'rgba(0, 0, 0, 0.25)');
  pix.poly(shape(3.5), mix(theme.flipper, theme.plunger, 0.55));
  const face = shape(0);
  pix.poly(face, f.pressed ? mix(theme.flipper, '#ffffff', 0.25) : theme.flipper);
  pix.polyline([...face, face[0]], 1, theme.bumper);
  pix.rect(f.px - 3, f.py - 3, 6, 6, theme.plunger);
}

function drawBall(pix: Pix, p: Point | Ball, theme: TableTheme, lift = 0): void {
  const { x, y } = p;
  pix.ellipse(x + 2 + lift * 0.5, y + 5 + lift, BALL_R, BALL_R * 0.75, 'rgba(0, 0, 0, 0.3)');
  pix.disc(x, y, BALL_R, theme.ballDark);
  pix.disc(x - 1.5, y - 1.5, BALL_R - 1.5, mix(theme.ballLight, theme.ballDark, 0.3));
  pix.rect(x - 5, y - 5, 3, 3, theme.ballLight);
}
