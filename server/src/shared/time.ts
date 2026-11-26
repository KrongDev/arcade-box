/** 지금 시각을 주는 함수. 서버는 진짜 시계를, 테스트는 가짜 시계를 넣는다 */
export type Clock = () => Date;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 날짜 (UTC+9, YYYY-MM-DD). 한국은 서머타임이 없어서 9시간을 더하면 된다 */
export function kstDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `now`가 든 한국 날짜가 시작하는 순간 (그날 00:00:00 KST). 그날은 여기부터 24시간이다 */
export function kstDayStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}
