import { join } from 'node:path';
import { canPlayGame } from '../entitlement/index.ts';
import { getGame, getVersion, isGameId } from '../game/index.ts';
import type { Config } from '../shared/config.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { file, type Route } from '../shared/http/index.ts';
import { gameLocked, parseLimit } from './rules.ts';
import { leaderboard, submitRun } from './service.ts';

export interface PlayDeps {
  db: Db;
  config: Config;
}

const notFound = () => new RuleError(404, 'not_found', '없는 묶음이에요');

/** 주소에 온 버전: 0 없이 시작하는 자연수만 (`abc`, `1.5`, `-1`, `../1`, `01`, `1e0`은 버전이 아니다) */
const VERSION = /^[1-9][0-9]{0,9}$/;

export function routes(deps: PlayDeps): Route[] {
  const { db, config } = deps;
  return [
    {
      // 판 결과 (스펙 5.9). 누구의 판인지는 세션에서만 정하고, 판의 시각은 요청을 받은 시각이다.
      // 판 사이가 3초라 정상적인 앱은 분당 20번을 넘지 못한다. 다시 보내는 것까지 넉넉히 60번을 받는다
      method: 'POST',
      path: '/v2/me/runs',
      auth: 'required',
      limit: { by: 'user', perMinute: 60 },
      async handle(ctx) {
        return submitRun(db, ctx.session!.userId, await ctx.json(), ctx.now);
      },
    },
    {
      // 순위표 (표 K16). 로그인하지 않아도 보이고, 토큰이 틀리면 로그인하지 않은 것으로 본다
      method: 'GET',
      path: '/v2/leaderboards/:boardId',
      auth: 'optional',
      async handle(ctx) {
        return leaderboard(db, ctx.params.boardId, parseLimit(ctx.query), ctx.session?.userId ?? null);
      },
    },
    {
      // 묶음 받기 (스펙 5.8). 세션이 있어야 하고 그 게임을 할 수 있어야 한다. 디스크의 파일을 그대로 흘려보낸다
      method: 'GET',
      path: '/v2/games/:id/versions/:version/bundle',
      auth: 'required',
      limit: { by: 'user', perMinute: 30 },
      async handle(ctx) {
        const { id, version } = ctx.params;
        // 모양이 틀린 게임 ID와 버전은 DB도 디스크도 보지 않고 404다 (Review Focus 4)
        if (!isGameId(id) || !VERSION.test(version)) throw notFound();
        // 없는 게임과 live가 아닌 게임은 404, 있는데 가지지 않은 게임은 403이다.
        // 가졌는지를 버전보다 먼저 본다: 가지지 않은 사람에게 어떤 버전이 있는지 알려 주지 않는다
        if ((await getGame(db, id))?.status !== 'live') throw notFound();
        if (!(await canPlayGame(db, ctx.session!.userId, id))) throw gameLocked();
        // live 버전만 준다. 올리기만 한(uploaded) 버전과 거둬들인(withdrawn) 버전은 없는 것이다
        const found = await getVersion(db, id, Number(version));
        if (found?.status !== 'live') throw notFound();
        // 경로는 서버가 등록할 때 만든 것(`bundles/<게임>/<버전>.zip`)이고 주소에서 온 글자가 들어가지 않는다.
        // 로그인한 사람에게만 주는 파일이라 중간(프록시, CDN)에서 캐시하지 않게 한다
        return file(join(config.dataDir, found.bundlePath), 'application/zip', 'private, no-store');
      },
    },
  ];
}
