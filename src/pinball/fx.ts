import type { Effect } from '../game/catalog';
import type { Ball, PinballEvent } from './engine';
import type { TableTheme } from './render';

/**
 * 타격 연출 — 엔진 이벤트를 받아 파편·점수 팝업·화면 흔들림·큰 글씨 알림·공 꼬리를 그린다.
 * 게임 규칙과는 무관하고, '동작 줄이기' 설정이면 흔들림·번쩍임을 끄고 파편을 줄인다.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'spark' | 'ring' | 'star' | 'flame';
}

interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Banner {
  text: string;
  sub: string | null;
  life: number;
  max: number;
  color: string;
}

const MAX_PARTICLES = 260;
const TRAIL_LENGTH = 9;

export class PinballFx {
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private banner: Banner | null = null;
  private shake = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private trails = new Map<number, { x: number; y: number }[]>();
  private readonly reduced: boolean;
  /** 장착 아이템 이펙트 (공 꼬리·부딪힘·판 배경) */
  private skin: Effect = {};
  private stars: { x: number; y: number; r: number; ph: number }[] = [];
  private shooting: { x: number; y: number; life: number } | null = null;
  private shootingTimer = 3;
  private neon = 0;
  private clock = 0;

  constructor(reducedMotion = false) {
    this.reduced = reducedMotion;
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
    if (this.skin.table !== 'neon') return 1;
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
    for (const p of this.particles) {
      p.life -= t;
      p.x += p.vx * t;
      p.y += p.vy * t;
      if (p.kind === 'spark' || p.kind === 'star') {
        p.vx *= 1 - 3 * t;
        p.vy = p.vy * (1 - 3 * t) + 260 * t;
      } else if (p.kind === 'flame') {
        p.vx *= 1 - 2 * t;
        p.vy -= 90 * t;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.life -= t;
      p.y -= 38 * t;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    if (this.banner) {
      this.banner.life -= t;
      if (this.banner.life <= 0) this.banner = null;
    }
    this.shake = Math.max(0, this.shake - t * 40);
    this.flash = Math.max(0, this.flash - t * 2.5);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.reduced || this.shake <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * this.shake, y: (Math.random() - 0.5) * this.shake };
  }

  /** 판 바탕 위, 장치 아래에 그리는 것: 은하수 판의 별과 별똥별 */
  drawBackground(ctx: CanvasRenderingContext2D): void {
    if (this.skin.table !== 'stars') return;
    for (const st of this.stars) {
      const a = this.reduced ? 0.6 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.clock * 2 + st.ph));
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.shooting) {
      const s = this.shooting;
      const g = ctx.createLinearGradient(s.x - 60, s.y - 35, s.x, s.y);
      g.addColorStop(0, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, `rgba(255, 255, 255, ${Math.min(1, s.life * 1.5)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - 60, s.y - 35);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
  }

  /** 공 아래에 그리는 것: 꼬리 */
  drawUnder(ctx: CanvasRenderingContext2D, theme: TableTheme, radius: number): void {
    if (this.skin.trail === 'lightning') {
      for (const trail of this.trails.values()) {
        if (trail.length < 3) continue;
        ctx.save();
        ctx.strokeStyle = '#a5d8ff';
        ctx.shadowColor = '#4dabf7';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        trail.forEach((p, i) => {
          const j = i === trail.length - 1 ? 0 : (Math.random() - 0.5) * 9;
          if (i === 0) ctx.moveTo(p.x + j, p.y - j);
          else ctx.lineTo(p.x + j, p.y - j);
        });
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    for (const trail of this.trails.values()) {
      for (let i = 0; i < trail.length - 1; i++) {
        const a = (i + 1) / trail.length;
        ctx.fillStyle = withAlpha(theme.ballLight, a * 0.28);
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, radius * (0.45 + a * 0.45), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 맨 위에 그리는 것: 파편·팝업·화면 번쩍임·큰 글씨 */
  drawOver(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'flame') {
        const color = a > 0.66 ? '#ffe066' : a > 0.33 ? '#ff922b' : '#f03e3e';
        ctx.fillStyle = withAlpha(color, Math.min(1, a * 1.4));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (p.kind === 'ring') {
        const r = p.size * (1 - a) + 4;
        ctx.strokeStyle = withAlpha(p.color, a * 0.9);
        ctx.lineWidth = 3 * a + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = withAlpha(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const a = Math.min(1, p.life / p.max / 0.5);
      ctx.font = `700 ${p.size}px -apple-system, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.55 * a})`;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = withAlpha(p.color, a);
      ctx.fillText(p.text, p.x, p.y);
    }

    if (this.flash > 0 && !this.reduced) {
      ctx.fillStyle = withAlpha(this.flashColor, this.flash * 0.22);
      ctx.fillRect(0, 0, width, height);
    }

    if (this.banner) {
      const b = this.banner;
      const age = b.max - b.life;
      const appear = this.reduced ? 1 : Math.min(1, age / 0.18);
      const a = Math.min(1, b.life / 0.35);
      const scale = this.reduced ? 1 : 0.7 + 0.3 * easeOutBack(appear);
      const cy = height * 0.4; // 아래쪽 발사 안내 문구와 겹치지 않게
      ctx.save();
      ctx.translate(width / 2, cy);
      ctx.scale(scale, scale);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      roundRect(ctx, -150, -40, 300, b.sub ? 86 : 64, 20);
      ctx.fill();
      ctx.font = '700 34px -apple-system, system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.strokeText(b.text, 0, -10);
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, -10);
      ctx.shadowBlur = 0;
      if (b.sub) {
        ctx.font = '700 17px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.sub, 0, 26);
      }
      ctx.restore();
    }
  }

  private burst(x: number, y: number, count: number, colors: string[], speed: number, dirX = 0, dirY = 0): void {
    const n = this.reduced ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      let ang = Math.random() * Math.PI * 2;
      if (dirX !== 0 || dirY !== 0) ang = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      const life = 0.35 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        life,
        max: life,
        size: 1.5 + Math.random() * 2.5,
        color: colors[i % colors.length],
        kind: i % 4 === 0 ? 'star' : 'spark',
      });
    }
  }

  private push(p: Particle): void {
    if (this.particles.length < MAX_PARTICLES) this.particles.push(p);
  }

  /** 불꽃 알갱이: 위로 피어오르며 노랑 → 주황 → 빨강으로 꺼진다 */
  private flames(x: number, y: number, count: number, spread: number): void {
    for (let i = 0; i < count; i++) {
      const life = 0.3 + Math.random() * 0.3;
      this.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * spread,
        vy: -20 - Math.random() * spread * 0.6,
        life,
        max: life,
        size: 3 + Math.random() * 4,
        color: '#ff922b',
        kind: 'flame',
      });
    }
  }

  private ring(x: number, y: number, color: string, size: number): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size, color, kind: 'ring' });
  }

  private popup(x: number, y: number, text: string, color: string, size = 15): void {
    this.popups.push({ x, y, text, life: 0.9, max: 0.9, color, size });
    if (this.popups.length > 14) this.popups.shift();
  }

  private show(text: string, sub: string | null, color: string): void {
    this.banner = { text, sub, life: 1.6, max: 1.6, color };
  }

  private kick(amount: number): void {
    this.shake = Math.min(14, Math.max(this.shake, amount * 2));
  }

  private screenFlash(color: string): void {
    this.flash = 1;
    this.flashColor = color;
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** '#rrggbb' → 'rgba(r, g, b, a)' */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${Math.max(0, Math.min(1, a))})`;
}
