/**
 * 로컬 개발 전용 가짜 파트너 API — 익명 식별키 인증 코드 교환만 흉내 낸다.
 * docker-compose.dev.yml에서만 뜬다. 운영 설정은 https가 아닌 파트너 주소를 거부한다.
 *
 * devtools mock의 User.createAnonymousKeyAuthCode()는 "mock-anon-code-..." 코드를 주고,
 * User.getAnonymousKey()는 "mock-anon-hash-xyz789"를 준다. 여기서도 같은 키로 바꿔 줘서
 * 브라우저 개발 흐름의 사용자와 서버 사용자가 같아진다.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 9090);
const MOCK_ANON_KEY = process.env.MOCK_ANON_KEY ?? 'mock-anon-hash-xyz789';
const used = new Set<string>();

http
  .createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/api-partner/v1/apps-in-toss/users/anon-key/exchange') {
      return reply(404, { resultType: 'FAIL', error: { errorCode: 'NOT_FOUND', reason: 'mock' } });
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let code = '';
      try {
        code = String(JSON.parse(Buffer.concat(chunks).toString()).code ?? '');
      } catch {
        return reply(400, { resultType: 'FAIL', error: { errorCode: 'INVALID_PARAMETER', reason: 'invalid json' } });
      }
      // 실제 API처럼 코드는 한 번만 쓸 수 있다
      if (!code.startsWith('mock-anon-code-') || used.has(code)) {
        return reply(200, { resultType: 'FAIL', error: { errorCode: '4011', reason: '익명 사용자 인증 코드가 유효하지 않아요.' } });
      }
      used.add(code);
      reply(200, { resultType: 'SUCCESS', success: { anonKey: MOCK_ANON_KEY } });
    });
  })
  .listen(PORT, () => console.log(`[mock-partner] listening on :${PORT}`));
