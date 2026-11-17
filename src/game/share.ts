import { Share } from '@apps-in-toss/web-framework';

/** apps-in-toss.config.ts의 appName과 같아야 한다 */
const APP_NAME = 'arcade-box';

export type ShareResult = 'shared' | 'failed';

/**
 * 토스 앱에서 이 미니앱을 여는 링크를 붙여 공유 시트를 연다.
 * 링크를 만들지 못하면 문구만 공유한다.
 * (intoss:// 링크는 정식 출시 뒤에 열린다. 출시 전에는 콘솔 QR의 테스트 스킴으로 확인한다.)
 */
export async function shareWithLink(text: string): Promise<ShareResult> {
  let link = '';
  try {
    link = await Share.createLink({ path: `intoss://${APP_NAME}` });
  } catch {
    link = '';
  }
  try {
    await Share.sendMessage({ message: link ? `${text}\n${link}` : text });
    return 'shared';
  } catch {
    return 'failed';
  }
}
