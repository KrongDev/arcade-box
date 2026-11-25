/**
 * 정해진 길 — 레일이나 킥백처럼 공이 물리 대신 정해진 선을 따라 움직이는 곳에 쓴다.
 * 점을 이은 꺾은선을 부드럽게 만들고, 지나온 거리(s)로 위치와 방향을 구한다.
 */

interface Point {
  x: number;
  y: number;
}

export interface Track {
  points: Point[];
  /** 각 점까지의 누적 거리 (points와 같은 길이) */
  cum: number[];
  length: number;
}

/** 모서리를 깎아 부드럽게 만든 길. smoothing은 깎는 횟수이고, 양 끝점은 그대로 둔다 */
export function makeTrack(points: Point[], smoothing = 2): Track {
  let pts = points;
  for (let k = 0; k < smoothing; k++) {
    const next: Point[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { points: pts, cum, length: cum[cum.length - 1] };
}

/** 길을 따라 s만큼 간 곳의 위치와 진행 방향(단위 벡터). s는 0~length로 자른다 */
export function trackAt(track: Track, s: number): { x: number; y: number; tx: number; ty: number } {
  const { points, cum, length } = track;
  const d = Math.max(0, Math.min(length, s));
  // d가 들어 있는 구간 (길이가 0인 구간은 건너뛴다)
  let i = 1;
  while (i < points.length - 1 && (cum[i] < d || cum[i] === cum[i - 1])) i++;
  const a = points[i - 1];
  const b = points[i];
  const seg = cum[i] - cum[i - 1];
  const k = seg > 0 ? (d - cum[i - 1]) / seg : 0;
  const tx = seg > 0 ? (b.x - a.x) / seg : 0;
  const ty = seg > 0 ? (b.y - a.y) / seg : 1;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tx, ty };
}
