import type { Config } from '../shared/config.ts';
import type { Db } from '../shared/db/index.ts';
import type { Route } from '../shared/http/index.ts';
import { obj } from '../shared/validate.ts';
import { deleteAccount, type DeletionPolicy } from './deletion.ts';
import { issueNonce, linkIdentity, logout, resolveLink, type Summarize } from './link.ts';
import { registerOrLoginGuest, updateSettings } from './service.ts';
import type { IdTokenVerifier } from './verify.ts';

/**
 * `verify`, `summarize`, `policy`는 서버를 조립하는 쪽이 넣어 준다:
 * - `verify`: ID 토큰 확인기 (운영은 `googleVerifier`, `config.devAuth`일 때만 `devVerifier`)
 * - `summarize`: 연결 충돌 때 보여 줄 코인과 게임 수 (wallet, entitlement)
 * - `policy`: 계정을 지울 때 다른 도메인이 할 일 (order, reward, play, entitlement, wallet)
 */
export interface AccountDeps {
  db: Db;
  config: Config;
  verify: IdTokenVerifier;
  summarize: Summarize;
  policy: DeletionPolicy;
}

/** 로그인과 연결은 사용자당 분당 10번 (스펙 5.10: 로그인에는 요청 수 제한을 둔다) */
const AUTH_LIMIT = { by: 'user', perMinute: 10 } as const;

export function routes(deps: AccountDeps): Route[] {
  const { db, config, verify, summarize, policy } = deps;
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
      // 계정 연결에 쓸 일회용 값. 앱이 구글 로그인에 넣는다
      method: 'POST',
      path: '/v2/auth/nonce',
      auth: 'required',
      limit: AUTH_LIMIT,
      async handle(ctx) {
        return { nonce: await issueNonce(db, ctx.session!.userId, ctx.now) };
      },
    },
    {
      method: 'POST',
      path: '/v2/auth/link',
      auth: 'required',
      limit: AUTH_LIMIT,
      async handle(ctx) {
        return linkIdentity(db, ctx.session!, await ctx.json(), verify, ctx.now, summarize);
      },
    },
    {
      // link가 409 link_conflict로 끝난 뒤, 같은 토큰으로 "그 계정의 기록 쓰기"
      method: 'POST',
      path: '/v2/auth/link/resolve',
      auth: 'required',
      limit: AUTH_LIMIT,
      async handle(ctx) {
        const result = await resolveLink(db, ctx.session!, await ctx.json(), verify, ctx.now, config.sessionTtlDays, policy);
        return { userId: result.userId, token: result.token, expiresAt: result.expiresAt.toISOString() };
      },
    },
    {
      method: 'POST',
      path: '/v2/auth/logout',
      auth: 'required',
      async handle(ctx) {
        await logout(db, ctx.session!, ctx.tokenHash!);
        return { loggedOut: true };
      },
    },
    {
      // 계정 삭제 (v1의 "내 기록 지우기"). 다시 들어오면 새 손님이다
      method: 'DELETE',
      path: '/v2/me',
      auth: 'required',
      async handle(ctx) {
        await deleteAccount(db, ctx.session!.userId, policy);
        return { deleted: true };
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
