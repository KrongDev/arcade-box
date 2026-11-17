/**
 * 환경 변수 설정. 비밀 값(인증서·키)은 파일 경로로만 받는다.
 */

export interface Config {
  port: number;
  production: boolean;
  databaseUrl: string;
  /** CORS 허용 origin — 정확한 값만 */
  allowedOrigins: string[];
  partner: {
    baseUrl: string;
    certPath: string | null;
    keyPath: string | null;
    timeoutMs: number;
  };
  sessionTtlDays: number;
}

const APP_NAME = 'arcade-box';

/**
 * 미니앱 origin — SDK 3.1.0 이상(이 앱은 3.10.0): 서비스 환경과 콘솔 QR 테스트 환경.
 * 근거: 개발자센터 "서버 API 이용하기" CORS 절.
 */
export const MINIAPP_ORIGINS = [`https://${APP_NAME}.apps.tossmini.com`, `https://${APP_NAME}.private-apps.tossmini.com`];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL이 필요해요');

  const baseUrl = env.TOSS_API_BASE ?? 'https://apps-in-toss-api.toss.im';
  if (production && !baseUrl.startsWith('https://')) {
    throw new Error('운영 환경에서는 TOSS_API_BASE가 https여야 해요 (가짜 파트너 금지)');
  }

  // 개발용 추가 origin (예: http://localhost:5173). 운영에서는 받지 않는다
  const extra = (env.CORS_DEV_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (production && extra.length > 0) {
    throw new Error('운영 환경에서는 CORS_DEV_ORIGINS를 쓸 수 없어요');
  }

  return {
    port: Number(env.PORT ?? 8080),
    production,
    databaseUrl,
    allowedOrigins: [...MINIAPP_ORIGINS, ...extra],
    partner: {
      baseUrl,
      certPath: env.TOSS_MTLS_CERT_PATH ?? null,
      keyPath: env.TOSS_MTLS_KEY_PATH ?? null,
      timeoutMs: Number(env.TOSS_API_TIMEOUT_MS ?? 5000),
    },
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
  };
}
