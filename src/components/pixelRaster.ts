/**
 * 칸 그림 도구 — w×h칸에 색을 찍고, 같은 색 칸을 SVG path 하나로 묶는다.
 * 홈 오락기 화면 그림(GameArt)과 상점 미리보기(ItemPreview)가 함께 쓴다.
 * 칸 좌표는 정수 칸 단위다. 원·선은 칸 중심으로 판정해 가장자리가 계단처럼 보인다.
 */
export class Raster {
  readonly w: number;
  readonly h: number;
  private readonly px: (string | null)[][];

  constructor(w: number, h: number, bg: string | null = null) {
    this.w = w;
    this.h = h;
    this.px = Array.from({ length: h }, () => Array<string | null>(w).fill(bg));
  }

  put(x: number, y: number, c: string): void {
    const i = Math.round(x);
    const j = Math.round(y);
    if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.px[j][i] = c;
  }

  get(x: number, y: number): string | null {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y][x] : null;
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.put(i, j, c);
  }

  disc(cx: number, cy: number, r: number, c: string): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.put(x, y, c);
  }

  ring(cx: number, cy: number, r: number, c: string): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r - 1) this.put(x, y, c);
      }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string, t = 1): void {
    const n = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) this.rect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), t, t, c);
  }

  /** 칸 지도(글자 한 칸 = 한 색, '.'은 빈칸)를 (x, y)에 찍는다 */
  stamp(map: string[], x: number, y: number, color: (ch: string) => string | undefined): void {
    map.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch === '.') return;
        const c = color(ch);
        if (c) this.put(x + i, y + j, c);
      }),
    );
  }

  /** 같은 색 칸을 path 하나로 */
  paths(): [string, string][] {
    const by = new Map<string, string>();
    this.px.forEach((row, y) =>
      row.forEach((c, x) => {
        if (c) by.set(c, (by.get(c) ?? '') + `M${x} ${y}h1v1h-1z`);
      }),
    );
    return [...by.entries()];
  }
}
