import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 안드로이드 앱(Capacitor) 설정. 웹 빌드(`vite build --mode android`)의 결과 dist-android/를 앱에 넣는다.
 * appId는 스토어에 한 번 올리면 바꿀 수 없다.
 */
const config: CapacitorConfig = {
  appId: 'com.geonbox.arcadebox',
  appName: '아케이드박스',
  webDir: 'dist-android',
  android: {
    // 출시 빌드에서는 WebView 디버깅을 끈다
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      // 화면 끝까지 그리고(viewport-fit=cover), 시스템 바 높이는 env(safe-area-inset-*)로 받는다
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
