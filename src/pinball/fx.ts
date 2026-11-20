import { ArcadeFx } from '../arcade/fx';
import { withAlpha } from '../arcade/pixel';
import type { Effect } from '../game/catalog';
import type { Ball, PinballEvent } from './engine';
import { P, type Pix } from './pixel';
import type { TableTheme } from './render';

export { withAlpha } from '../arcade/pixel';

/**
 * 핀볼 타격 연출 — 엔진 이벤트를 받아 파편·점수 팝업·화면 흔들림·큰 글씨 알림·공 꼬리를 그린다.
 * 파편·팝업·알림·흔들림 같은 기본기는 게임 공용(arcade/fx)이고, 여기에는 핀볼 이벤트와 장착 아이템 이펙트만 있다.
 */

const TRAIL_LENGTH = 9;

export class PinballFx extends ArcadeFx {
  private trails = new Map<number, { x: number; y: number }[]>();
  /** 장착 아이템 이펙트 (공 꼬리·부딪힘·판 배경) */
  private skin: Effect = {};
  private stars: { x: number; y: number; r: number; ph: number }[] = [];
  private shooting: { x: number; y: number; life: number } | null = null;
  private shootingTimer = 3;
  private neon = 0;
  private clock = 0;

  constructor(reducedMotion = false) {
    super(reducedMotion, P);
  }

  setSkin(effect: Effect): void {
    this.skin = effect;
    this.stars = [];
    if (effect.table === 'stars') {
      for (let i = 0; i < 46; i++) {
        this.stars.push({ x: 14 + Math.random() * 330, y: 14 + Math.random() * 640, r: 0.6 + Math.random() * 1.3, ph: Math.random() * Math.PI * 2 });
      }
    }
  }

  /** 네온 판: 벽 빛 세기 (평소엔 숨 쉬듯, 맞으면 번쩍) */
  wallGlow(): number {
    if (this.skin.table !== 'neon') return 0; // 번지는 빛은 네온 판에만
    return 1.2 + 0.5 * Math.sin(this.clock * 2.4) + this.neon * 1.6;
  }

  handle(ev: PinballEvent, theme: TableTheme): void {
    switch (ev.type) {
      case 'bumper':
        this.burst(ev.x, ev.y, 12, [theme.bumperFlash, theme.bumper], 260);
        this.ring(ev.x, ev.y, theme.bumperRing, 34);
        this.popup(ev.x, ev.y - 26, `+${ev.points.toLocaleString()}`, theme.bumperFlash);
        this.kick(2.5);
        break;
      case 'sling':
        this.burst(ev.x, ev.y, 10, [theme.wall, theme.flipper], 240, ev.nx, ev.ny);
        this.popup(ev.x + ev.nx * 18, ev.y - 18, `+${ev.points.toLocaleString()}`, theme.wall);
        this.kick(3.5);
        break;
      case 'target':
        this.burst(ev.x + 6, ev.y, 10, [theme.coin, theme.coinRing], 220, 1, 0);
        this.popup(ev.x + 30, ev.y, `+${ev.points.toLocaleString()}`, theme.coin);
        this.kick(2);
        break;
      case 'bank':
        this.show('타깃 완성!', '오른쪽 구멍에 넣으면 멀티볼', theme.coin);
        this.screenFlash(theme.coin);
        this.kick(5);
        break;
      case 'rollover':
        this.burst(ev.x, ev.y, 6, [theme.coin, theme.coinRing], 140);
        this.popup(ev.x, ev.y + 22, `+${ev.points.toLocaleString()}`, theme.coinRing);
        break;
      case 'lanes':
        for (const x of [135, 185, 235]) this.ring(x, 66, theme.coin, 30);
        this.show(`보너스 ×${ev.multiplier}`, `+${ev.points.toLocaleString()}`, theme.coin);
        this.kick(3);
        break;
      case 'saucer':
        if (ev.jackpot) {
          this.burst(ev.x, ev.y, 40, [theme.coin, theme.bumperFlash, theme.bumper], 420);
          this.ring(ev.x, ev.y, theme.coin, 90);
          this.show('잭팟!', `+${ev.points.toLocaleString()}`, theme.coin);
          this.screenFlash(theme.coin);
          this.kick(8);
        } else {
          this.burst(ev.x, ev.y, 14, [theme.bumper, theme.bumperFlash], 220);
          this.popup(ev.x - 10, ev.y - 26, `+${ev.points.toLocaleString()}`, theme.bumperFlash);
          this.kick(3);
        }
        break;
      case 'multiball':
        this.show('멀티볼!', '점수 2배', theme.bumper);
        this.screenFlash(theme.bumper);
        this.kick(7);
        break;
      case 'ballSaved':
        this.show('공을 살렸어요', '한 번 더 쏘세요', theme.wall);
        break;
      case 'combo':
        this.popup(180, 360, `콤보 ${ev.count}  +${ev.points.toLocaleString()}`, theme.bumperFlash, 20);
        break;
      case 'coin':
        this.burst(ev.x, ev.y, 10, [theme.coin, theme.coinRing], 200);
        this.ring(ev.x, ev.y, theme.coin, 26);
        if (ev.coins > 0) this.popup(ev.x, ev.y - 20, `코인 +${ev.coins}`, theme.coin);
        break;
      case 'milestone':
        this.show(`${ev.score.toLocaleString()}점 달성`, ev.coins > 0 ? `코인 +${ev.coins}` : null, theme.coin);
        this.screenFlash(theme.coin);
        break;
      case 'drain':
        this.kick(4);
        if (ev.ballsLeft > 0) this.show('공을 잃었어요', `남은 공 ${ev.ballsLeft}개`, theme.bumper);
        break;
      case 'launch':
        this.kick(ev.auto ? 1.5 : 1 + ev.power * 3);
        break;
      default:
        break;
    }
  }

  /** 장착한 공·판 이펙트 — 부딪힐 때 */
  handleSkin(ev: PinballEvent): boolean {
    if (ev.type !== 'bumper' && ev.type !== 'sling' && ev.type !== 'target' && ev.type !== 'saucer') return false;
    const { x, y } = ev;
    if (this.skin.table === 'neon') this.neon = 1;
    if (this.skin.hit === 'fire') {
      this.flames(x, y, 14, 140);
    }
    if (this.skin.hit === 'boom') {
      this.burst(x, y, 20, ['#ffffff', '#a5d8ff', '#4dabf7'], 420);
      this.ring(x, y, '#74c0fc', 64);
      this.ring(x, y, '#ffffff', 36);
      this.kick(6);
      if (!this.reduced) this.screenFlash('#74c0fc');
      return true;
    }
    return false;
  }

  /** 공 위치를 기록해 꼬리를 만든다 */
  trackBalls(balls: Ball[]): void {
    const alive = new Set<number>();
    for (const b of balls) {
      alive.add(b.id);
      const trail = this.trails.get(b.id) ?? [];
      trail.push({ x: b.x, y: b.y });
      if (trail.length > TRAIL_LENGTH) trail.shift();
      this.trails.set(b.id, trail);
      if (b.held > 0) continue;
      const moving = Math.hypot(b.vx, b.vy) > 60;
      if (this.skin.trail === 'fire' && moving) this.flames(b.x, b.y, this.reduced ? 1 : 2, 30);
      if (this.skin.trail === 'sparkle' && moving && Math.random() < (this.reduced ? 0.2 : 0.6)) {
        this.push({ x: b.x + (Math.random() - 0.5) * 8, y: b.y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.55, max: 0.55, size: 1.5 + Math.random() * 2, color: Math.random() < 0.5 ? '#ffffff' : '#ffe066', kind: 'star' });
      }
      if (this.skin.trail === 'lightning' && moving && Math.random() < (this.reduced ? 0.1 : 0.35)) {
        this.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220, life: 0.2, max: 0.2, size: 1.5, color: '#a5d8ff', kind: 'spark' });
      }
    }
    for (const id of [...this.trails.keys()]) if (!alive.has(id)) this.trails.delete(id);
  }

  update(dt: number): void {
    const t = Math.min(dt, 1 / 20);
    this.clock += t;
    this.neon = Math.max(0, this.neon - t * 3);
    if (this.skin.table === 'stars' && !this.reduced) {
      this.shootingTimer -= t;
      if (this.shootingTimer <= 0) {
        this.shootingTimer = 3 + Math.random() * 4;
        this.shooting = { x: 20 + Math.random() * 200, y: 20 + Math.random() * 120, life: 0.9 };
      }
      if (this.shooting) {
        this.shooting.x += 260 * t;
        this.shooting.y += 150 * t;
        this.shooting.life -= t;
        if (this.shooting.life <= 0) this.shooting = null;
      }
    }
    super.update(dt);
  }

  /** 판 바탕 위, 장치 아래에 그리는 것: 은하수 판의 별과 별똥별(한 칸짜리 점) */
  drawBackground(pix: Pix): void {
    if (this.skin.table !== 'stars') return;
    for (const st of this.stars) {
      const a = this.reduced ? 0.6 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.clock * 2 + st.ph));
      const size = st.r > 1.3 ? 2 : 1;
      pix.cells(st.x / P, st.y / P, size, size, `rgba(255, 255, 255, ${a})`);
    }
    if (this.shooting) {
      const s = this.shooting;
      const life = Math.min(1, s.life * 1.5);
      for (let i = 0; i < 14; i++) {
        const k = i / 14;
        pix.cells((s.x - 60 * (1 - k)) / P, (s.y - 35 * (1 - k)) / P, 1, 1, `rgba(255, 255, 255, ${life * k})`);
      }
    }
  }

  /** 공 아래에 그리는 것: 꼬리 */
  drawUnder(pix: Pix, theme: TableTheme, radius: number): void {
    if (this.skin.trail === 'lightning') {
      for (const trail of this.trails.values()) {
        if (trail.length < 3) continue;
        const zig = trail.map((p, i) => {
          const j = i === trail.length - 1 ? 0 : (Math.random() - 0.5) * 9;
          return { x: p.x + j, y: p.y - j };
        });
        pix.polyline(zig.map((p) => ({ x: p.x + P, y: p.y + P })), 1, '#1c7ed6');
        pix.polyline(zig, 1, '#a5d8ff');
      }
      return;
    }
    for (const trail of this.trails.values()) {
      for (let i = 0; i < trail.length - 1; i++) {
        const a = (i + 1) / trail.length;
        pix.disc(trail[i].x, trail[i].y, radius * (0.45 + a * 0.45), withAlpha(theme.ballLight, a * 0.28));
      }
    }
  }
}
