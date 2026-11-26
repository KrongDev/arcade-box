import { randomBytes } from 'node:crypto';
import { findSession, routes } from '../../src/account/index.ts';
import { loadConfig, type Config } from '../../src/shared/config.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import type { Handler } from '../helpers/http.ts';

export const TTL_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 앱이 만드는 것과 같은 모양의 기기 비밀값: 256비트 난수를 base64url로 적은 43자 */
export function deviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

export const testConfig: Config = loadConfig({ DATABASE_URL: 'postgres://unused' });

/** account의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function accountHandler(db: Db, clock: Clock, deps: Partial<Parameters<typeof routes>[0]> = {}): Handler {
  return createHandler(routes({ db, config: testConfig, ...deps } as Parameters<typeof routes>[0]), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
