import type { Db } from '../shared/db/index.ts';
import { json, type Route } from '../shared/http/index.ts';
import { catalog, me } from './service.ts';

export interface ViewDeps {
  db: Db;
}

/** 목록은 누구에게나 같아서 앞단과 앱이 60초 동안 들고 있어도 된다 (스펙 5.8) */
const CATALOG_CACHE = 'public, max-age=60';

export function routes(deps: ViewDeps): Route[] {
  const { db } = deps;
  return [
    {
      // 게임, 상품, 가격, 지금 버전. 로그인 없이 받는다 (토큰을 보내도 보지 않는다)
      method: 'GET',
      path: '/v2/catalog',
      auth: 'none',
      handle: async (ctx) => json(await catalog(db, ctx.now), CATALOG_CACHE),
    },
    {
      // 내 상태. 사용자마다 다르니 캐시하지 않는다 (정하지 않은 JSON 응답은 no-store)
      method: 'GET',
      path: '/v2/me',
      auth: 'required',
      handle: (ctx) => me(db, ctx.session!.userId, ctx.now),
    },
  ];
}
