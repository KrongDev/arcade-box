/**
 * 서버 조립 (스펙 5.14). 도메인마다 내놓는 경로를 모아 HTTP 처리기 하나로 만든다.
 *
 * 아래 단 도메인이 위 단의 일을 시켜야 할 때(계정을 지울 때 지갑·보유·주문도 지우기, 연결 충돌 때 코인과 게임 수 보여 주기)
 * 도메인끼리 서로 가져오지 않고 여기서 그 함수를 넣어 준다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { devVerifier, findSession, googleVerifier, routes as accountRoutes, type DeletionPolicy, type IdTokenVerifier, type Summarize } from './account/index.ts';
import { routes as assetRoutes } from './asset/index.ts';
import { countOwnedGames, purgeUser as purgeEntitlements, routes as entitlementRoutes } from './entitlement/index.ts';
import { hasMoneyOrders, purgeUser as purgeOrders, routes as orderRoutes } from './order/index.ts';
import { purgeUser as purgePlay, routes as playRoutes } from './play/index.ts';
import { purgeUser as purgeRewards, routes as rewardRoutes } from './reward/index.ts';
import type { Config } from './shared/config.ts';
import type { Db } from './shared/db/index.ts';
import { createHandler, type Route } from './shared/http/index.ts';
import type { Clock } from './shared/time.ts';
import { loadStaticPages, type StaticAsset } from './static-pages.ts';
import { routes as viewRoutes } from './view/index.ts';
import { getBalance, purgeUser as purgeWallet, routes as walletRoutes } from './wallet/index.ts';

export interface ServerDeps {
  db: Db;
  config: Config;
  now: Clock;
  /** ID 토큰 확인기. 서버를 띄울 때는 `chooseVerifier(config)`, 테스트는 가짜를 넣는다 */
  verify: IdTokenVerifier;
}

/**
 * 설정에 맞는 ID 토큰 확인기. 개발용 확인기(서명을 보지 않는다)는 `config.devAuth`일 때만 고른다.
 * 그 밖에는 언제나 구글 공개 키로 확인한다 (`NODE_ENV`가 빠진 채 띄워도 마찬가지다).
 */
export function chooseVerifier(config: Config): IdTokenVerifier {
  return config.devAuth ? devVerifier() : googleVerifier(config.googleClientIds);
}

/** 연결 충돌 때 양쪽에 보여 줄 요약: 통일 지갑의 잔액과 가진 게임 수 (스펙 5.4) */
export const summarize: Summarize = async (q, userId) => ({
  coins: await getBalance(q, userId),
  games: await countOwnedGames(q, userId),
});

/**
 * 계정을 지울 때 다른 도메인이 할 일 (스펙 5.4). 현금 주문이 있으면 사용자 행을 `deleted`로 남긴다.
 * 지우는 순서는 외래 키를 거는 쪽부터: 주문(코인 기록·보유를 가리킴) → 보상·판(코인 기록을 가리킴) → 보유·장착 → 지갑과 코인 기록.
 */
export const deletionPolicy: DeletionPolicy = {
  mustKeepUserRow: hasMoneyOrders,
  purge: [purgeOrders, purgeRewards, purgePlay, purgeEntitlements, purgeWallet],
};

/** 살아 있는지 (표 K1). 로드밸런서·배포 확인이 부른다 */
const healthz: Route = {
  method: 'GET',
  path: '/healthz',
  auth: 'none',
  handle: async () => ({ ok: true }),
};

/**
 * 공개 페이지(약관·테스터 모집): 같은 서버의 이미지 말고는 외부 리소스를 막고(CSP), 다른 사이트의 iframe에 들어가지 않게 한다.
 * no-transform — 앞단 Cloudflare가 이메일을 스크립트로 감추는 변환(Email Obfuscation)을 하지 않게 한다.
 * 헤더는 v1(`app.ts`의 `sendStatic`)과 같다 (표 K2).
 */
function sendPage(res: ServerResponse, page: StaticAsset, headOnly: boolean) {
  res.writeHead(200, {
    'content-type': page.type,
    'content-length': page.body.length,
    'cache-control': `public, max-age=${page.maxAge}, no-transform`,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(headOnly ? undefined : page.body);
}

/**
 * GET·HEAD에서 경로 표보다 먼저 불린다 (`createHandler`의 `fallback`). 공개 페이지는 origin을 따지지 않고 준다:
 * 브라우저는 같은 서버의 글꼴도 Origin 헤더를 붙여 요청해서, CORS 검사를 먼저 하면 403이 난다.
 * (CORS 허용 헤더는 붙이지 않으니 다른 사이트의 스크립트가 읽어 갈 수는 없다)
 */
function pageFallback(pages: Map<string, StaticAsset>) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const target = req.url ?? '/';
    const cut = target.indexOf('?');
    const page = pages.get(cut === -1 ? target : target.slice(0, cut));
    if (!page) return false;
    sendPage(res, page, req.method === 'HEAD');
    return true;
  };
}

/** 모든 도메인의 경로를 모은 HTTP 처리기 */
export function buildServer(deps: ServerDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { db, config, now, verify } = deps;
  const routes: Route[] = [
    healthz,
    ...accountRoutes({ db, config, verify, summarize, policy: deletionPolicy }),
    ...walletRoutes({ db }),
    ...assetRoutes({ config }),
    ...entitlementRoutes({ db }),
    ...playRoutes({ db, config }),
    ...rewardRoutes({ db }),
    ...orderRoutes({ db }),
    ...viewRoutes({ db }),
  ];
  return createHandler(routes, {
    allowedOrigins: config.allowedOrigins,
    now,
    findSession: (tokenHash, at) => findSession(db, tokenHash, at),
    clientIpHeader: config.clientIpHeader,
    fallback: pageFallback(loadStaticPages()),
  });
}
