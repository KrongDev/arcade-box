/**
 * 서버 v2의 환경 변수 설정. v1의 `src/config.ts`와는 다른 파일이다.
 * 오류 메시지에는 변수 이름만 적고 값은 적지 않는다 (DATABASE_URL에 비밀번호가 들어 있다).
 */
export interface Config {
  /** 듣는 주소. 컨테이너 안에서는 0.0.0.0, 컨테이너 밖에서 직접 띄울 때는 127.0.0.1 */
  host: string;
  port: number;
  production: boolean;
  databaseUrl: string;
  /** CORS 허용 origin — 정확한 값만 */
  allowedOrigins: string[];
  sessionTtlDays: number;
  /** 구글 ID 토큰의 대상(aud)으로 받아들이는 우리 앱 ID */
  googleClientIds: string[];
  /** 게임 묶음의 서명을 확인하는 Ed25519 공개 키 (base64). 비밀값이 아니다 */
  bundlePublicKey: string | null;
  /** 게임 묶음과 아이콘을 두는 디렉토리 */
  dataDir: string;
  /** 개발용 가짜 로그인. 운영에서는 켤 수 없다 */
  devAuth: boolean;
  /**
   * 요청한 쪽의 IP를 담아 주는 헤더 이름 (소문자). 없으면 소켓 주소를 쓴다.
   * 앞단 프록시가 꼭 채워 주는 헤더일 때만 정한다 (운영: Cloudflare의 `cf-connecting-ip`).
   */
  clientIpHeader: string | null;
}

/** 쉼표로 나눈 목록. 비어 있으면(변수가 없거나 빈 글자열이면) 기본값이다 */
function list(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function wholeNumber(value: string | undefined, name: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > max) throw new Error(`${name}는 1~${max}의 정수여야 해요`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL이 필요해요');

  const devAuth = env.AUTH_DEV === '1';
  if (production && devAuth) throw new Error('운영 환경에서는 AUTH_DEV를 켤 수 없어요 (개발용 가짜 로그인 금지)');

  let clientIpHeader: string | null = null;
  if (env.CLIENT_IP_HEADER) {
    if (!/^[A-Za-z0-9-]+$/.test(env.CLIENT_IP_HEADER)) throw new Error('CLIENT_IP_HEADER는 헤더 이름이어야 해요 (영문, 숫자, -)');
    clientIpHeader = env.CLIENT_IP_HEADER.toLowerCase();
  }

  return {
    host: env.HOST || '0.0.0.0',
    port: wholeNumber(env.PORT, 'PORT', 8080, 65535),
    production,
    databaseUrl,
    allowedOrigins: list(env.ALLOWED_ORIGINS, ['https://localhost', 'capacitor://localhost']),
    sessionTtlDays: wholeNumber(env.SESSION_TTL_DAYS, 'SESSION_TTL_DAYS', 30, 3650),
    googleClientIds: list(env.GOOGLE_CLIENT_IDS, []),
    bundlePublicKey: env.BUNDLE_PUBLIC_KEY || null,
    dataDir: env.DATA_DIR || './data',
    devAuth,
    clientIpHeader,
  };
}
