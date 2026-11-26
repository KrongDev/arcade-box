/**
 * 서버 v2의 환경 변수 설정. v1의 `src/config.ts`와는 다른 파일이다.
 * 오류 메시지에는 변수 이름만 적고 값은 적지 않는다 (DATABASE_URL에 비밀번호가 들어 있다).
 */
/**
 * DB 연결 풀의 시간 제한 (밀리초). 잠긴 행을 기다리는 요청이나 멈춘 트랜잭션이 연결을 붙잡고 끝없이 매달리지 않게 한다.
 * 끄는 값(0)은 받지 않는다.
 */
export interface DbTimeouts {
  /** 풀에서 연결을 얻기까지(연결이 모두 쓰이는 중이면 빌 때까지, 새 연결이면 DB에 붙을 때까지) 기다리는 시간 */
  connectMs: number;
  /** 쿼리 하나가 끝나기까지 기다리는 시간 (PostgreSQL `statement_timeout`). 잠긴 행을 기다리는 시간도 여기에 든다 */
  statementMs: number;
  /** 트랜잭션을 열어 둔 채 다음 쿼리 없이 쉬는 시간 (PostgreSQL `idle_in_transaction_session_timeout`). 넘으면 DB가 연결을 끊고 잠금이 풀린다 */
  idleInTxMs: number;
}

/**
 * 기본값. 보통의 요청은 쿼리 하나가 몇 밀리초라 넉넉하고, 같은 지갑의 요청이 줄을 서도 앞의 것이 10초 안에 끝나거나 끊긴다.
 * HTTP 요청 하나를 받는 시간 제한(30초, `index.ts`)보다 짧다.
 */
export const DB_TIMEOUT_DEFAULTS: DbTimeouts = { connectMs: 5_000, statementMs: 10_000, idleInTxMs: 10_000 };

/** 시간 제한으로 받는 가장 큰 값: 10분 */
const DB_TIMEOUT_MAX_MS = 600_000;

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
  /** DB 연결 풀의 시간 제한 */
  dbTimeouts: DbTimeouts;
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
    dbTimeouts: {
      connectMs: wholeNumber(env.DB_CONNECT_TIMEOUT_MS, 'DB_CONNECT_TIMEOUT_MS', DB_TIMEOUT_DEFAULTS.connectMs, DB_TIMEOUT_MAX_MS),
      statementMs: wholeNumber(env.DB_STATEMENT_TIMEOUT_MS, 'DB_STATEMENT_TIMEOUT_MS', DB_TIMEOUT_DEFAULTS.statementMs, DB_TIMEOUT_MAX_MS),
      idleInTxMs: wholeNumber(env.DB_IDLE_IN_TX_TIMEOUT_MS, 'DB_IDLE_IN_TX_TIMEOUT_MS', DB_TIMEOUT_DEFAULTS.idleInTxMs, DB_TIMEOUT_MAX_MS),
    },
  };
}
