import { platform } from '../platform';

export type ShareResult = 'shared' | 'failed';

/** 이 플랫폼에서 공유할 수 있는지 — 없으면 공유 버튼을 숨긴다 */
export const canShare = platform.share !== null;

/** 문구와 앱 링크를 공유한다(토스: 미니앱 링크를 붙여 공유 시트) */
export async function shareWithLink(text: string): Promise<ShareResult> {
  return platform.share ? platform.share(text) : 'failed';
}
