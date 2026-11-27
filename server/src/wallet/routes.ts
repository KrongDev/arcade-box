import type { Db } from '../shared/db/index.ts';
import type { Route } from '../shared/http/index.ts';
import { parseLedgerPage } from './rules.ts';
import { listLedger } from './service.ts';

export interface WalletDeps {
  db: Db;
}

export function routes(deps: WalletDeps): Route[] {
  const { db } = deps;
  return [
    {
      // 내 코인 기록, 최신부터 쪽 단위로 (스펙 5.10). 누구의 기록인지는 세션에서만 정한다
      method: 'GET',
      path: '/v2/me/ledger',
      auth: 'required',
      async handle(ctx) {
        return listLedger(db, ctx.session!.userId, parseLedgerPage(ctx.query));
      },
    },
  ];
}
