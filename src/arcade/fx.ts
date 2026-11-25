import { PIXEL_FONT, withAlpha, type PixelPainter } from './pixel';

/**
 * 타격 연출 기본기 — 파편 알갱이·고리·점수 팝업·큰 글씨 알림·화면 흔들림·번쩍임.
 * 게임 규칙과는 무관하다. 게임마다 이 클래스를 이어받아 엔진 이벤트를 연출로 바꾼다.
 * '동작 줄이기' 설정이면 흔들림·번쩍임을 끄고 파편을 줄인다.
 */

export interface Particle {
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

export class ArcadeFx {
  protected readonly reduced: boolean;
  /** 한 칸이 게임 좌표로 몇 단위인지 (그릴 때 칸에 맞춘다) */
  protected readonly cell: number;
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private banner: Banner | null = null;
  private shake = 0;
  private flash = 0;
  private flashColor = '#ffffff';

  constructor(reducedMotion: boolean, cell: number) {
    this.reduced = reducedMotion;
    this.cell = cell;
  }

  update(dt: number): void {
    const t = Math.min(dt, 1 / 20);
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

  /** 맨 위에 그리는 것(낮은 해상도): 파편 알갱이·고리, 화면 번쩍임 */
  drawOver(pix: PixelPainter): void {
    const P = this.cell;
    const ctx = pix.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'flame') {
        const color = a > 0.66 ? '#ffe066' : a > 0.33 ? '#ff922b' : '#f03e3e';
        const size = Math.max(1, Math.round((p.size * (0.4 + a * 0.6)) / P));
        pix.cells(p.x / P - size / 2, p.y / P - size / 2, size, size, withAlpha(color, Math.min(1, a * 1.4)));
        continue;
      }
      if (p.kind === 'ring') {
        pix.ring(p.x, p.y, p.size * (1 - a) + 4, 1, withAlpha(p.color, a * 0.9));
      } else if (p.kind === 'star') {
        // 십자 모양 반짝이
        const cx = p.x / P;
        const cy = p.y / P;
        const c = withAlpha(p.color, a);
        pix.cells(cx, cy - 1, 1, 3, c);
        pix.cells(cx - 1, cy, 3, 1, c);
      } else {
        const size = Math.max(1, Math.round((p.size * (0.5 + a * 0.5)) / P));
        pix.cells(p.x / P, p.y / P, size, size, withAlpha(p.color, a));
      }
    }
    ctx.restore();

    if (this.flash > 0 && !this.reduced) {
      // 번쩍임은 캔버스 전체에 — 판을 밀어서 그리는 게임(핀볼)에서도 화면을 다 덮게 변환을 잠깐 푼다
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = withAlpha(this.flashColor, this.flash * 0.22);
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  }

  /**
   * 글자(원래 해상도, 픽셀 글꼴): 점수 팝업과 큰 알림.
   * offsetY는 화면이 세로로 움직인 만큼이다 — 팝업은 게임 좌표에 붙어 있어서 그만큼 옮겨 그리고, 큰 알림은 늘 화면 가운데다.
   */
  drawText(ctx: CanvasRenderingContext2D, width: number, height: number, offsetY = 0): void {
    const P = this.cell;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const a = Math.min(1, p.life / p.max / 0.5);
      ctx.font = `700 ${p.size}px ${PIXEL_FONT}`;
      const y = Math.round((p.y - offsetY) / P) * P;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * a})`;
      ctx.fillText(p.text, p.x + 2, y + 2);
      ctx.fillStyle = withAlpha(p.color, a);
      ctx.fillText(p.text, p.x, y);
    }

    if (this.banner) {
      const b = this.banner;
      const age = b.max - b.life;
      const appear = this.reduced ? 1 : Math.min(1, age / 0.18);
      const a = Math.min(1, b.life / 0.35);
      // 픽셀답게 부드럽게 커지지 않고 두 단계로 튀어나온다
      const scale = this.reduced || appear >= 1 ? 1 : appear > 0.5 ? 1.12 : 0.8;
      const cy = height * 0.4; // 아래쪽 안내 문구와 겹치지 않게
      const h = b.sub ? 90 : 66;
      const half = Math.min(156, width / 2 - 8);
      ctx.save();
      ctx.translate(width / 2, cy);
      ctx.scale(scale, scale);
      ctx.globalAlpha = a;
      // 검은 판 + 색 테두리(네모난 모서리)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(-half, -42, half * 2, h);
      ctx.fillStyle = b.color;
      ctx.fillRect(-half, -42, half * 2, 3);
      ctx.fillRect(-half, -42 + h - 3, half * 2, 3);
      ctx.fillRect(-half, -42, 3, h);
      ctx.fillRect(half - 3, -42, 3, h);
      ctx.font = `700 33px ${PIXEL_FONT}`;
      ctx.fillStyle = '#8e1f22';
      ctx.fillText(b.text, 3, -7);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, -10);
      if (b.sub) {
        ctx.font = `700 16px ${PIXEL_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.sub, 0, 28);
      }
      ctx.restore();
    }
  }

  /** 파편 터뜨리기. 방향(dirX, dirY)을 주면 그쪽으로 부채꼴로 튄다 */
  protected burst(x: number, y: number, count: number, colors: string[], speed: number, dirX = 0, dirY = 0): void {
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

  protected push(p: Particle): void {
    if (this.particles.length < MAX_PARTICLES) this.particles.push(p);
  }

  /** 불꽃 알갱이: 위로 피어오르며 노랑 → 주황 → 빨강으로 꺼진다 */
  protected flames(x: number, y: number, count: number, spread: number): void {
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

  protected ring(x: number, y: number, color: string, size: number): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size, color, kind: 'ring' });
  }

  protected popup(x: number, y: number, text: string, color: string, size = 15): void {
    this.popups.push({ x, y, text, life: 0.9, max: 0.9, color, size });
    if (this.popups.length > 14) this.popups.shift();
  }

  protected show(text: string, sub: string | null, color: string): void {
    this.banner = { text, sub, life: 1.6, max: 1.6, color };
  }

  protected kick(amount: number): void {
    this.shake = Math.min(14, Math.max(this.shake, amount * 2));
  }

  protected screenFlash(color: string): void {
    this.flash = 1;
    this.flashColor = color;
  }
}
