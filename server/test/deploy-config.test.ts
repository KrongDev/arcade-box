import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadConfig } from '../src/shared/config.ts';

/**
 * 요청한 쪽의 IP를 읽는 헤더(`CLIENT_IP_HEADER`)는 **앞단이 꼭 덮어쓰는 헤더**일 때만 믿을 수 있다.
 * 손님이 보낸 값이 그대로 서버에 닿는 헤더를 믿으면, 요청마다 값을 바꿔 IP별 요청 수 제한(손님 등록·로그인)을 피한다.
 *
 * 운영은 배포 방식과 상관없이 Caddy가 직접 채운 `X-Real-IP` 하나만 믿는다 (docs/deploy.md):
 * - 상대가 Cloudflare 대역이면 Caddy가 `CF-Connecting-IP`의 값을 넣는다
 * - 그 밖(프록시 없이 직접 받는 배포, Cloudflare를 건너뛰고 서버로 바로 온 요청)이면 소켓의 상대 주소를 넣는다
 * 설정 파일 셋(Caddyfile, 운영 compose, 배포 워크플로)이 이 짝을 지키는지 글로 확인한다. 실제로 지어낸 헤더가 통하지 않는지는
 * 운영 compose를 띄워서 본다 (자동 테스트 밖, docs/deploy.md의 "배포 뒤에 해 볼 확인").
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const caddyfile = read('Caddyfile');
const compose = read('docker-compose.yml');
const workflow = read('../.github/workflows/deploy-server.yml');

/** 주석을 뺀 Caddyfile */
const caddy = caddyfile
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

test('Caddy는 Cloudflare 대역에서 온 요청에만 CF-Connecting-IP를 믿고, X-Real-IP를 그렇게 정한 주소로 덮어쓴다', () => {
  const servers = /^\{\s*servers \{(?<body>[^}]*)\}\s*\}/s.exec(caddy.trimStart())?.groups?.body;
  assert.ok(servers, '전역 옵션에 servers 블록이 있다');
  const trusted = /trusted_proxies static(?<ranges>[^\n]*)/.exec(servers)?.groups?.ranges.trim().split(/\s+/) ?? [];
  // Cloudflare의 대역만 믿는다: 사설 대역(private_ranges)이나 모든 주소를 믿으면 누구나 헤더를 지어낼 수 있다
  assert.ok(trusted.length >= 20, `믿는 대역 ${trusted.length}개`);
  for (const range of trusted) assert.match(range, /^(\d{1,3}(\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+\/\d{1,3})$/, range);
  for (const known of ['173.245.48.0/20', '104.16.0.0/13', '2400:cb00::/32', '2606:4700::/32']) assert.ok(trusted.includes(known), `${known}이 없다`);
  for (const wide of ['0.0.0.0/0', '::/0', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8']) assert.ok(!trusted.includes(wide), `${wide}을 믿는다`);
  assert.doesNotMatch(servers, /private_ranges/);
  assert.match(servers, /client_ip_headers CF-Connecting-IP\s*$/m);
  // 서버로 넘길 때 X-Real-IP를 덮어쓴다 (손님이 보낸 X-Real-IP는 서버에 닿지 않는다)
  assert.match(caddy, /reverse_proxy server:8080 \{[^}]*\bheader_up X-Real-IP \{client_ip\}[^}]*\}/s);
});

test('운영 compose는 Caddy가 채운 x-real-ip만 믿는다 (Cloudflare의 헤더나 X-Forwarded-For를 서버가 바로 믿지 않는다)', () => {
  const lines = compose.split('\n').filter((line) => /^\s*CLIENT_IP_HEADER:/.test(line));
  assert.deepEqual(
    lines.map((line) => line.trim()),
    ['CLIENT_IP_HEADER: x-real-ip'],
  );
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://unused', CLIENT_IP_HEADER: 'x-real-ip' }).clientIpHeader, 'x-real-ip');
  // 배포 워크플로는 이 값을 배포 방식에 따라 바꾸지 않는다
  assert.doesNotMatch(workflow, /CLIENT_IP_HEADER/);
});

test('배포 워크플로는 variable ALLOW_SERVER_V2_DEPLOY가 yes일 때만, 이미지를 올리기 전에 확인하고 진행한다', () => {
  // 값은 환경 변수로 넘겨 견준다
  assert.match(workflow, /ALLOW_SERVER_V2_DEPLOY: \$\{\{ vars\.ALLOW_SERVER_V2_DEPLOY \}\}/);
  const check = workflow.indexOf('if [ "$ALLOW_SERVER_V2_DEPLOY" != "yes" ]');
  assert.ok(check !== -1, '잠금을 확인하는 줄이 있다');
  assert.match(workflow.slice(check, check + 600), /::error::[^\n]*\/v1[^\n]*\n\s*exit 1/);
  // 첫 작업(이미지)의 첫 단계다: 체크아웃·로그인·빌드보다 앞
  for (const later of ['actions/checkout', 'docker/login-action', 'docker/build-push-action']) {
    assert.ok(check < workflow.indexOf(later), `잠금 확인이 ${later}보다 뒤에 있다`);
  }
  // 배포 작업은 이미지 작업이 끝나야 돈다
  assert.match(workflow, /deploy:\s*\n\s+name: [^\n]*\n\s+needs: image/);
});
