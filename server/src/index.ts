import http from 'node:http';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { TossPartnerClient } from './partner.ts';
import { PgStore } from './store-pg.ts';

const config = loadConfig();
const store = new PgStore(config.databaseUrl);
await store.migrate();

const partner = new TossPartnerClient(config.partner);
const handler = createApp({
  store,
  partner,
  allowedOrigins: config.allowedOrigins,
  sessionTtlDays: config.sessionTtlDays,
});

const server = http.createServer((req, res) => {
  void handler(req, res);
});
server.listen(config.port, () => {
  console.log(
    `[server] listening on :${config.port} (${config.production ? 'production' : 'development'}), partner=${new URL(config.partner.baseUrl).host}, origins=${config.allowedOrigins.length}`,
  );
});

const shutdown = () => {
  server.close(() => {
    void store.close().then(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
