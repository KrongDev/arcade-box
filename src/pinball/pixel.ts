import { mixHex } from '../game/color';
import { TABLE_H, TABLE_W } from './engine';

/**
 * 픽셀 그리기 — 핀볼 판을 낮은 해상도(한 칸 = 판 좌표 P)로 칸 단위로 칠한다.
 * 모든 도형을 정수 칸의 fillRect로만 그려서 가장자리 흐림(안티에일리어싱)이 생기지 않는다.
 * 입력 좌표는 판 좌표(엔진과 같은 단위)이고, 안에서 칸 좌표로 바꾼다.
 */
export const P = 3;
export const LOW_W = Math.ceil(TABLE_W / P);
export const LOW_H = Math.ceil(TABLE_H / P);

export interface Pt {
  x: number;
  y: number;
}

export class Pix {
  readonly ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  private span(x0: number, x1: number, y: number) {
    if (x1 > x0) this.ctx.fillRect(x0, y, x1 - x0, 1);
  }

  /** 판 좌표 사각형 */
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    const x0 = Math.round(x / P);
    const y0 = Math.round(y / P);
    this.ctx.fillRect(x0, y0, Math.max(1, Math.round((x + w) / P) - x0), Math.max(1, Math.round((y + h) / P) - y0));
  }

  /** 칸 좌표 사각형(칸 단위로 직접) */
  cells(cx: number, cy: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(cx), Math.round(cy), w, h);
  }

  /** 꽉 찬 원 */
  disc(x: number, y: number, r: number, color: string): void {
    this.ellipse(x, y, r, r, color);
  }

  /** 꽉 찬 타원(동전이 도는 모양) */
  ellipse(x: number, y: number, rx: number, ry: number, color: string): void {
    const cx = x / P;
    const cy = y / P;
    const ax = Math.max(0.5, rx / P);
    const ay = Math.max(0.5, ry / P);
    this.ctx.fillStyle = color;
    for (let j = Math.floor(cy - ay); j <= Math.ceil(cy + ay); j++) {
      const dy = (j + 0.5 - cy) / ay;
      if (Math.abs(dy) > 1) continue;
      const half = ax * Math.sqrt(1 - dy * dy);
      this.span(Math.round(cx - half), Math.round(cx + half), j);
    }
  }

  /** 고리(두께는 칸 수) */
  ring(x: number, y: number, r: number, thickness: number, color: string): void {
    const cx = x / P;
    const cy = y / P;
    const ro = r / P;
    const ri = Math.max(0, ro - thickness);
    this.ctx.fillStyle = color;
    for (let j = Math.floor(cy - ro); j <= Math.ceil(cy + ro); j++) {
      for (let i = Math.floor(cx - ro); i <= Math.ceil(cx + ro); i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
        if (d <= ro && d > ri) this.ctx.fillRect(i, j, 1, 1);
      }
    }
  }

  /** 두께 있는 선(두께는 칸 수). 네모 붓으로 찍어 간다 */
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
    const ax = x0 / P;
    const ay = y0 / P;
    const bx = x1 / P;
    const by = y1 / P;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    const off = width / 2;
    this.ctx.fillStyle = color;
    for (let i = 0; i <= n; i++) {
      const px = ax + ((bx - ax) * i) / n;
      const py = ay + ((by - ay) * i) / n;
      this.ctx.fillRect(Math.round(px - off), Math.round(py - off), width, width);
    }
  }

  /** 꺾인 선 */
  polyline(points: Pt[], width: number, color: string): void {
    for (let i = 0; i < points.length - 1; i++) this.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, width, color);
  }

  /** 꽉 찬 다각형(가로줄마다 경계를 찾아 채운다) */
  poly(points: Pt[], color: string): void {
    const pts = points.map((p) => ({ x: p.x / P, y: p.y / P }));
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    this.ctx.fillStyle = color;
    const xs: number[] = [];
    for (let j = Math.floor(minY); j <= Math.ceil(maxY); j++) {
      const yc = j + 0.5;
      xs.length = 0;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) xs.push(a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) this.span(Math.round(xs[k]), Math.round(xs[k + 1]), j);
    }
  }
}

/** 낮은 해상도 캔버스 하나 */
export function lowCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = LOW_W;
  canvas.height = LOW_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return { canvas, ctx };
}

/** 두 색 섞기(#rrggbb) */
export const mix = mixHex;

/** 캔버스 글자용 픽셀 글꼴 */
export const PIXEL_FONT = "Galmuri11, -apple-system, system-ui, sans-serif";
