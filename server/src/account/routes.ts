import type { Config } from '../shared/config.ts';
import type { Db } from '../shared/db/index.ts';
import type { Route } from '../shared/http/index.ts';
import { obj } from '../shared/validate.ts';
import { registerOrLoginGuest, updateSettings } from './service.ts';

export interface AccountDeps {
  db: Db;
  config: Config;
}

export function routes(deps: AccountDeps): Route[] {
  const { db, config } = deps;
  return [
    {
      // 손님 등록·재로그인. 세션이 끝난 앱도 기기 비밀값으로 여기를 다시 부른다
      method: 'POST',
      path: '/v2/auth/guest',
      auth: 'none',
      limit: { by: 'ip', perMinute: 10 },
      async handle(ctx) {
        const body = obj(await ctx.json(), 'body');
        const result = await registerOrLoginGuest(db, body.deviceSecret as string, ctx.now, config.sessionTtlDays);
        return { userId: result.userId, token: result.token, expiresAt: result.expiresAt.toISOString(), created: result.created };
      },
    },
    {
      method: 'PUT',
      path: '/v2/me/settings',
      auth: 'required',
      async handle(ctx) {
        return { settings: await updateSettings(db, ctx.session!.userId, await ctx.json()) };
      },
    },
  ];
}
