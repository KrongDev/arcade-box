import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'arcade-box',
  permissions: [],
  webBundleDir: 'dist',
  // 게임 앱은 내비게이션 바를 투명 배경으로 둔다 (공식 문서 권장)
  navigationBar: {
    transparentBackground: true,
  },
});
