import type { Db } from '../shared/db/index.ts';
import type { Route } from '../shared/http/index.ts';
import { claimAdReward, claimAttendance } from './service.ts';

export interface RewardDeps {
  db: Db;
}

/**
 * 보상 받기 (스펙 5.10). 누가 받는지는 세션에서만 정하고, 날짜는 요청을 받은 시각의 한국 날짜다.
 * 본문은 읽지 않는다: v1은 받을 게임을 골랐지만 v2는 통일 지갑으로 받는다 (표 D3).
 */
export function routes(deps: RewardDeps): Route[] {
  const { db } = deps;
  return [
    {
      method: 'POST',
      path: '/v2/me/attendance',
      auth: 'required',
      async handle(ctx) {
        return claimAttendance(db, ctx.session!.userId, ctx.now);
      },
    },
    {
      method: 'POST',
      path: '/v2/me/ad-reward',
      auth: 'required',
      async handle(ctx) {
        return claimAdReward(db, ctx.session!.userId, ctx.now);
      },
    },
  ];
}
