# arcade-box 서버

Node 24 + PostgreSQL. 게임 진행(코인·기록·잠금 해제·코인 아이템)을 서버에 저장하고, 게임별 리더보드와 서버 시간 기준 일일 제한(출석·광고 보상)을 맡는다.

사용자 식별은 **익명 식별키 인증 코드 교환**이다. 클라이언트가 `User.createAnonymousKeyAuthCode()`로 받은 일회용 코드를 `POST /v1/auth/exchange`로 보내면, 서버가 mTLS 인증서로 파트너 API에 교환해 `anonKey`를 받고 세션 토큰을 준다. 클라이언트가 보낸 식별키를 그대로 믿는 경로는 없다.

## 로컬 개발 (인증서 없이)

```bash
docker compose -f docker-compose.dev.yml up -d --build
curl http://localhost:8080/healthz
```

- `mock-partner`가 교환 API만 흉내 낸다. devtools mock의 `mock-anon-code-...` 코드를 받으면 `mock-anon-hash-xyz789`를 돌려준다(코드는 한 번만 쓸 수 있다).
- CORS는 미니앱 origin 두 개와 `http://localhost:5173`(개발 compose에서만)을 허용한다.

## 운영

1. 앱인토스 콘솔 > 개발 > mTLS 인증서에서 인증서를 발급받는다.
2. zip을 **저장소 밖** 디렉터리에 풀고 권한을 700으로 둔다.
3. `.env.example`을 `.env`로 복사해 `POSTGRES_PASSWORD`, `MTLS_DIR`, `MTLS_CERT_FILE`, `MTLS_KEY_FILE`을 채운다.
4. `docker compose up -d --build`

GitHub Actions로 배포하려면 루트 README의 '비밀값 관리'에 있는 secret을 등록하고 `서버 배포` 워크플로를 실행한다. 비밀번호와 인증서는 저장소가 아니라 secret에서 서버로 바로 써진다.

운영 설정(`NODE_ENV=production`)은 https가 아닌 파트너 주소와 개발용 CORS origin을 거부하고 시작하지 않는다.

## 테스트

```bash
npm test          # 앱 전체(메모리 저장소 + 가짜 파트너), 응답 봉투 판정, 요청 형태
npm run typecheck
```

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/v1/auth/exchange` | `{ code }` → `{ token, expiresAt }` |
| GET | `/v1/me` | 진행 상태 스냅샷 |
| POST | `/v1/me/import` | `{ save }` 기기 v1 데이터 1회 가져오기(값마다 상한) |
| POST | `/v1/me/attendance` | `{ gameId }` 출석 50코인, 한국 시간 하루 1회 |
| POST | `/v1/me/ad-reward` | `{ gameId }` 광고 보상 50코인, 하루 3회 |
| POST | `/v1/me/runs` | 판 결과 `{ board, score }` 또는 `{ board, won, seconds }` + `coins` |
| POST | `/v1/me/items/:id/buy` | 코인 아이템 구매(바로 장착) |
| PUT | `/v1/me/equipped` | `{ itemId }` |
| PUT | `/v1/me/settings` | `{ sound?, haptic? }` |
| GET | `/v1/leaderboards/:board` | `pinball`, `minesweeper.easy|normal|hard` 순위 |

인증이 필요한 경로는 `Authorization: Bearer <token>`.

## 알아둘 한계

- 판 결과(점수·시간·코인)는 클라이언트가 보낸다. 서버는 상한·간격·잠금 조건만 확인한다.
- 광고 시청 자체는 서버가 검증할 수 없다. 하루 횟수만 서버 시간으로 막는다.
- 게임 규칙 상수(`src/domain.ts`)는 클라이언트 값과 손으로 맞춘다.
