import { ArcadeFx } from '../arcade/fx';
import { withAlpha, type PixelPainter } from '../arcade/pixel';
import { CURRENCY } from '../game/currency';
import type { Ball, BreakoutEvent } from './engine';
import { BALL_R, FIELD_W, POWER_TIME } from './rules';
import type { PowerKind } from './stages';
import type { BreakoutTheme } from './render';

/**
 * 벽돌깨기 타격 연출 — 엔진 이벤트를 파편·점수 팝업·흔들림·큰 글씨 알림으로 바꾸고, 공 꼬리를 그린다.
 * 연출 기본기는 게임 공용(arcade/fx)이다.
 */

const TRAIL_LENGTH = 7;
const COIN = CURRENCY.breakout;

/** 아이템을 받았을 때 알림 문구와 색 */
export const POWER_INFO: Record<PowerKind, { title: string; sub: string; color: string }> = {
  wide: { title: '넓은 패들!', sub: `${POWER_TIME.wide}초 동안 패들이 넓어져요`, color: '#22b8f0' },
  multi: { title: '멀티볼!', sub: '공이 늘어나요', color: '#ff6fae' },
  slow: { title: '느린 공', sub: `${POWER_TIME.slow}초 동안 공이 느려져요`, color: '#3fbf5a' },
};

export class BreakoutFx extends ArcadeFx {
  private trails = new Map<number, { x: number; y: number }[]>();

  handle(ev: BreakoutEvent, theme: BreakoutTheme): void {
    switch (ev.type) {
      case 'brickBreak': {
        const color = brickColor(theme, ev.row, ev.kind === 'tough');
        this.burst(ev.x, ev.y, 10, [color, '#ffffff'], 220);
        this.popup(ev.x, ev.y - 14, `+${ev.points.toLocaleString()}`, color);
        if (ev.special === 'coin') this.ring(ev.x, ev.y, COIN.face, 22);
        this.kick(1.2);
        break;
      }
      case 'brickHit':
        this.burst(ev.x, ev.y, 5, [theme.bricks.tough, '#ffffff'], 160);
        this.kick(0.8);
        break;
      case 'paddle':
        this.ring(ev.x, ev.y, theme.paddle.light, 16);
        break;
      case 'chain':
        this.popup(FIELD_W / 2, 330, `연속 ×${ev.multiplier}`, '#ffe14d', 22);
        break;
      case 'coin':
        this.burst(ev.x, ev.y, 10, [COIN.face, COIN.light], 200);
        if (ev.coins > 0) this.popup(ev.x, ev.y - 22, `코인 +${ev.coins}`, COIN.lcd);
        break;
      case 'power': {
        const info = POWER_INFO[ev.kind];
        this.burst(ev.x, ev.y, 14, [info.color, '#ffffff'], 260);
        this.show(info.title, info.sub, info.color);
        break;
      }
      case 'ballLost':
        this.kick(2);
        break;
      case 'lifeLost':
        this.kick(4);
        this.screenFlash('#ff4d5a');
        this.show('공을 놓쳤어요', `남은 공 ${ev.livesLeft}개`, '#ff5c86');
        break;
      case 'stageClear':
        this.show(`스테이지 ${ev.stage} 클리어!`, `보너스 +${ev.bonus.toLocaleString()}`, '#ffe14d');
        this.screenFlash('#ffe14d');
        this.kick(5);
        break;
      case 'gameOver':
        this.kick(4);
        break;
      case 'launch':
        this.kick(1);
        break;
      case 'wall':
        break;
    }
  }

  /** 공 위치를 기록해 꼬리를 만든다 */
  trackBalls(balls: readonly Ball[]): void {
    const alive = new Set<number>();
    for (const b of balls) {
      alive.add(b.id);
      const trail = this.trails.get(b.id) ?? [];
      trail.push({ x: b.x, y: b.y });
      if (trail.length > TRAIL_LENGTH) trail.shift();
      this.trails.set(b.id, trail);
    }
    for (const id of [...this.trails.keys()]) if (!alive.has(id)) this.trails.delete(id);
  }

  /** 공 아래에 그리는 것: 꼬리 */
  drawUnder(pix: PixelPainter, theme: BreakoutTheme): void {
    for (const trail of this.trails.values()) {
      for (let i = 0; i < trail.length - 1; i++) {
        const a = (i + 1) / trail.length;
        pix.disc(trail[i].x, trail[i].y, BALL_R * (0.4 + a * 0.5), withAlpha(theme.paddle.ballLight, a * 0.25));
      }
    }
  }
}

/** 줄마다 바뀌는 벽돌 색. 단단한 벽돌은 따로 */
export function brickColor(theme: BreakoutTheme, row: number, tough: boolean): string {
  return tough ? theme.bricks.tough : theme.bricks.rows[row % theme.bricks.rows.length];
}
