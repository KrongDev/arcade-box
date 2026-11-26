import { join } from 'node:path';
import type { Config } from '../shared/config.ts';
import { RuleError } from '../shared/errors.ts';
import { file, type Route } from '../shared/http/index.ts';
import { assetsDir, CONTENT_TYPES, ICON_NAME, type IconType } from './store.ts';

export interface AssetDeps {
  config: Config;
}

/** 이름이 내용의 해시라 내용이 바뀌면 주소도 바뀐다: 오래 캐시해도 된다 */
const CACHE = 'public, max-age=31536000, immutable';

export function routes(deps: AssetDeps): Route[] {
  const dir = assetsDir(deps.config.dataDir);
  return [
    {
      // 게임·상품 아이콘 (스펙 5.8). 로그인 없이 받는다
      method: 'GET',
      path: '/v2/assets/:name',
      auth: 'none',
      async handle(ctx) {
        const name = ctx.params.name;
        // 모양이 맞지 않는 이름(`..`, `/`, 다른 확장자 …)은 디스크를 찾아보지도 않고 404다 (Review Focus 4)
        const m = ICON_NAME.exec(name);
        if (!m) throw new RuleError(404, 'not_found', '없는 파일이에요');
        return file(join(dir, name), CONTENT_TYPES[m[1] as IconType], CACHE);
      },
    },
  ];
}
