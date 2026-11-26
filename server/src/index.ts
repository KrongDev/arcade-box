/**
 * 서버 시작 (스펙 5.14): 설정을 읽고, DB에 붙어 마이그레이션을 적용하고, 도메인의 경로를 모아 띄운다.
 * SIGTERM·SIGINT를 받으면 새 연결을 받지 않고, 하던 요청을 마친 뒤 DB 연결을 닫고 끝난다.
 */
import http from 'node:http';
import { devVerifier, googleVerifier } from './account/index.ts';
import { buildServer } from './server.ts';
import { loadConfig } from './shared/config.ts';
import { connectPg } from './shared/db/index.ts';

/** 요청 머리글을 다 받기까지 기다리는 시간. 머리글을 조금씩 흘려보내며 연결을 붙잡는 요청을 끊는다 */
const HEADERS_TIMEOUT_MS = 10_000;
/** 요청 하나(머리글 + 본문, 본문은 64KB까지)를 다 받기까지 기다리는 시간 */
const REQUEST_TIMEOUT_MS = 30_000;
/** 끄라는 신호를 받은 뒤 하던 요청(묶음 내려받기 등)을 기다리는 시간. 넘으면 연결을 끊고 끝낸다 */
const SHUTDOWN_GRACE_MS = 10_000;

const config = loadConfig();
const pg = connectPg(config.databaseUrl);
await pg.migrate();

const verify = config.devAuth ? devVerifier() : googleVerifier(config.googleClientIds);
const handler = buildServer({ db: pg.db, config, now: () => new Date(), verify });

const server = http.createServer({ headersTimeout: HEADERS_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS }, (req, res) => {
  void handler(req, res);
});
server.listen(config.port, config.host, () => {
  // 주소·키·DB 주소는 적지 않는다
  console.log(`[server] listening on :${config.port} (${config.production ? 'production' : 'development'}), origins=${config.allowedOrigins.length}`);
});

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
  force.unref();
  server.close(() => {
    void pg.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
