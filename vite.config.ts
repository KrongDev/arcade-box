import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

import aitDevtools from "@apps-in-toss/devtools/unplugin";

/**
 * 빌드 모드로 플랫폼을 고른다.
 * - 기본(토스 미니앱): src/platform/toss, 앱인토스 devtools(브라우저에서 토스 SDK 흉내), 결과는 dist/
 * - android(`vite build --mode android`): src/platform/android, 결과는 dist-android/ (Capacitor가 앱에 넣는다)
 * 고른 플랫폼 코드만 번들에 들어간다 — 토스 번들에 Capacitor가, 안드로이드 앱에 토스 SDK가 섞이지 않는다.
 */
export default defineConfig(({ mode }) => {
  const android = mode === 'android'
  return {
    plugins: [...(android ? [edgeToEdgeViewport()] : [aitDevtools.vite()]), react()],
    resolve: {
      alias: {
        '@platform-impl': fileURLToPath(new URL(`./src/platform/${android ? 'android' : 'toss'}/index.ts`, import.meta.url)),
      },
    },
    build: android ? { outDir: 'dist-android', emptyOutDir: true } : undefined,
  }
})

/** 안드로이드 앱은 화면 끝(상태 바·내비게이션 바 아래)까지 그린다. 여백은 env(safe-area-inset-*)로 받는다 */
function edgeToEdgeViewport(): Plugin {
  return {
    name: 'arcade-box-edge-to-edge-viewport',
    transformIndexHtml: (html) => html.replace('user-scalable=no"', 'user-scalable=no, viewport-fit=cover"'),
  }
}
