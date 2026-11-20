/**
 * 2D 충돌 판정 — 공(원)과 사각형. 게임 규칙이 없는 순수 기하 함수라 어느 게임이든 쓴다.
 * 좌표계는 화면과 같다(오른쪽이 +x, 아래가 +y).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Contact {
  /** 사각형 바깥을 향하는 단위 법선 — 공을 이 방향으로 밀어내면 빠져나온다 */
  nx: number;
  ny: number;
  /** 겹친 깊이 */
  depth: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 공(중심 cx·cy, 반지름 r)이 사각형과 겹치면 접촉 정보를, 아니면 null을 준다 */
export function circleRect(cx: number, cy: number, r: number, rect: Rect): Contact | null {
  const qx = clamp(cx, rect.x, rect.x + rect.w);
  const qy = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - qx;
  const dy = cy - qy;
  if (dx !== 0 || dy !== 0) {
    const d = Math.hypot(dx, dy);
    if (d >= r) return null;
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // 중심이 사각형 안: 가장 가까운 면으로 밀어낸다
  const left = cx - rect.x;
  const right = rect.x + rect.w - cx;
  const top = cy - rect.y;
  const bottom = rect.y + rect.h - cy;
  const min = Math.min(left, right, top, bottom);
  if (min === top) return { nx: 0, ny: -1, depth: top + r };
  if (min === bottom) return { nx: 0, ny: 1, depth: bottom + r };
  if (min === left) return { nx: -1, ny: 0, depth: left + r };
  return { nx: 1, ny: 0, depth: right + r };
}

/** 법선(nx, ny)에 부딪힌 속도를 반사한다. 이미 멀어지는 속도면 그대로 둔다 */
export function reflect(vx: number, vy: number, nx: number, ny: number): { vx: number; vy: number } {
  const dot = vx * nx + vy * ny;
  if (dot >= 0) return { vx, vy };
  return { vx: vx - 2 * dot * nx, vy: vy - 2 * dot * ny };
}
