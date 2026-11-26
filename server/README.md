# arcade-box 서버 (v2)

Node 24 + PostgreSQL 17. 계정, 통일 코인 지갑, 상품과 보유, 주문(결제 기록), 게임 목록과 묶음, 판 결과와 순위표, 출석·광고 보상을 맡아요. 설계는 [`docs/superpowers/specs/2026-11-26-server-v2-design.md`](../docs/superpowers/specs/2026-11-26-server-v2-design.md)에 있어요.

> **⚠️ 앱이 `/v2`를 부르게 바뀌기 전에는 이 서버를 운영에 배포하지 않아요.**
> 이 서버는 `/v2`만 받아요. 지금 나가 있는 앱은 `/v1`을 불러서, 이 서버를 배포하면 앱이 부르는 `/v1`이 모두 사라져요 (404).
> 앱은 세 작업 가운데 2번(앱 구조)에서 `/v2`로 바뀌어요. 그때까지 `서버 배포` 워크플로를 실행하지 않아요.

- 사용자는 로그인 없이 **손님**으로 시작해요. 앱이 만든 기기 비밀값을 `POST /v2/auth/guest`로 보내면 세션 토큰을 받아요. 구글 계정을 연결하면 다른 기기에서도 같은 계정으로 들어가요.
- 코인은 사용자마다 지갑 하나이고, 코인이 변한 일은 빠짐없이 기록(`coin_ledger`)에 남아요.
- 관리 기능은 HTTP로 열지 않아요. 운영자는 서버 컨테이너 안의 **명령줄 도구**로 상품을 추가하고, 지급하고, 게임을 내보내요.
- 테이블은 PostgreSQL 스키마 `app`에 있어요. v1이 쓰던 `public`의 테이블은 읽지도 쓰지도 않아요.

## 로컬 개발

```bash
docker compose -f docker-compose.dev.yml up -d --build      # 서버(8080) + PostgreSQL(5432), 이 컴퓨터에서만 열려요
curl http://localhost:8080/healthz                          # {"ok":true}
```

이 컴퓨터의 5432나 8080을 다른 것이 쓰고 있으면 포트를 바꿔 띄워요.

```bash
DEV_DB_PORT=55432 DEV_SERVER_PORT=58080 docker compose -f docker-compose.dev.yml up -d --build
```

**새 DB에서는 순서가 있어요: 서버를 먼저 한 번 띄운 뒤에 처음 자료를 넣어요.** 테이블은 서버가 뜰 때 만들고(마이그레이션), 명령줄 도구는 테이블을 만들지 않아요.

```bash
docker compose -f docker-compose.dev.yml exec server node src/cli.ts seed --reason "처음 자료" --yes
curl -s http://localhost:8080/v2/catalog                    # 게임 3개가 든 JSON
```

- 개발 compose는 개발용 가짜 로그인(`AUTH_DEV=1`)을 켜요. 구글 대신 `dev:<sub>:<nonce>` 모양의 토큰으로 계정 연결을 해 볼 수 있어요. 운영(`NODE_ENV=production`)에서는 이 값을 켠 채로 서버가 뜨지 않아요.
- 컨테이너 없이 띄우려면: `HOST=127.0.0.1 DATABASE_URL=postgres://pinball:pinball-dev@127.0.0.1:5432/pinball AUTH_DEV=1 npm start`

## 환경 변수

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `DATABASE_URL` | (꼭 있어야 해요) | PostgreSQL 주소 |
| `HOST`, `PORT` | `0.0.0.0`, `8080` | 듣는 주소와 포트. 컨테이너 밖에서 직접 띄울 때는 `HOST=127.0.0.1` |
| `NODE_ENV` | | `production`이면 개발용 로그인을 켤 수 없어요 |
| `ALLOWED_ORIGINS` | `https://localhost,capacitor://localhost` | 앱의 origin (쉼표). 안드로이드와 아이폰 앱의 값이에요 |
| `SESSION_TTL_DAYS` | `30` | 세션이 살아 있는 날 수 |
| `GOOGLE_CLIENT_IDS` | (없음) | 구글 로그인에서 받아들이는 우리 앱의 클라이언트 ID (쉼표). 없으면 구글 연결이 모두 거절돼요 |
| `BUNDLE_PUBLIC_KEY` | (없음) | 게임 묶음 서명을 확인하는 Ed25519 공개 키(base64). 비밀값이 아니에요. 없으면 `game add-version`이 거절돼요 |
| `DATA_DIR` | `./data` | 게임 묶음과 아이콘을 두는 곳. 컨테이너에서는 볼륨 `/data` |
| `CLIENT_IP_HEADER` | (없음) | 요청한 쪽의 IP가 담긴 헤더. 운영은 Cloudflare 뒤라 `cf-connecting-ip`. 없으면 소켓 주소를 써요 |
| `AUTH_DEV` | (꺼짐) | `1`이면 개발용 가짜 로그인 |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | DB 연결을 얻기까지 기다리는 시간 (연결 10개가 모두 쓰이는 중일 때) |
| `DB_STATEMENT_TIMEOUT_MS` | `10000` | 쿼리 하나의 시간. 다른 요청이 잠근 지갑을 기다리는 시간도 여기에 들어요 |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `10000` | 트랜잭션을 연 채 쉬는 시간. 넘으면 DB가 그 연결을 끊고 잠금을 풀어요 |

시간 제한을 넘은 요청은 오류(`500 internal`)로 끝나고 아무것도 남기지 않아요. 앱은 같은 요청 키(`idempotencyKey`)로 다시 보내면 돼요. 명령줄 도구도 같은 제한을 써요: 자료가 많아져 `wallet verify` 같은 점검이 제한에 걸리면 그 명령에만 값을 올려 실행해요 (`docker compose exec -e DB_STATEMENT_TIMEOUT_MS=600000 server node src/cli.ts wallet verify`). 마이그레이션에는 쿼리 시간 제한이 없어요.

## 테스트

```bash
npm test             # 규칙과 저장 (프로세스 안의 PostgreSQL인 PGlite로 돌아요. Docker가 없어도 돼요)
npm run typecheck
```

두 요청이 같은 순간에 같은 지갑을 쓰는 경우처럼 진짜 PostgreSQL에서만 드러나는 것은 따로 돌려요. CI도 PostgreSQL 컨테이너를 붙여 돌려요.

```bash
docker compose -f docker-compose.dev.yml up -d db
DATABASE_URL=postgres://pinball:pinball-dev@127.0.0.1:5432/pinball npm run test:pg
# 포트를 바꿔 띄웠으면(DEV_DB_PORT=55432) 주소의 포트도 바꿔요: ...@127.0.0.1:55432/pinball
```

테스트마다 `arcade_test_…`라는 데이터베이스를 새로 만들고 끝나면 지워요. `DATABASE_URL`의 데이터베이스 자체는 건드리지 않고, 이 컴퓨터(localhost)의 DB에만 붙어요.

## 운영 도구 (명령줄)

서버 컨테이너 안에서 `node src/cli.ts <명령>`으로 실행해요.

```bash
# 로컬
docker compose -f docker-compose.dev.yml exec server node src/cli.ts product list
# 운영 — 내 컴퓨터에서 (접속 정보는 환경 변수, docs/deploy.md)
server/scripts/admin.sh product list
```

| 묶음 | 명령 |
|---|---|
| 상품 | `product add`, `product update`, `product list`, `product show`, `price set`, `price clear`, `sku set` |
| 사용자 | `user find`, `user show` (잔액, 가진 것, 최근 코인 기록과 주문) |
| 지급 | `grant <사용자> <상품>`, `revoke <사용자> <상품>`, `coins adjust <사용자> <증감>` |
| 게임 | `game add`, `game update`, `game list`, `board add`, `board update`, `board list`, `game add-version`, `game publish`, `game rollback` |
| 주문 | `order list`, `order show`, `order refund`, `orders purge-expired` |
| 설정·점검 | `config get`, `config set`, `wallet verify`, `seed` |

- 명령만 적고 실행하면(`node src/cli.ts`) 모든 명령의 쓰는 법이 나와요.
- 무언가를 바꾸는 명령은 `--reason <까닭>`이 꼭 있어야 하고, 바꾸기 전에 요약을 보여 주고 확인을 받아요 (`--yes`로 건너뜀). 모두 `admin_actions`에 누가(`ADMIN_ACTOR`)·무엇을·왜 했는지 남아요.
- 명령이 모르는 flag는 거절해요. `--yse`처럼 오타가 난 채로 실행되는 일이 없어요. 값이 `--`로 시작하면 `--reason=--…`처럼 `=`로 이어 적어요.
- 사용자는 사용자 ID로 가리켜요. 구글 계정으로 찾으려면 `user find --provider google --sub <sub>`.

### 게임 묶음 올리기

1. 운영자 컴퓨터에서 묶음(zip)을 만들고 서명해요 (만드는 도구는 2번 작업). 서명은 Ed25519이고, 아래 여섯 줄(끝에도 줄바꿈)에 해요.
   ```text
   arcade-box-bundle
   <게임 ID>
   <버전>
   <묶음의 sha256, 소문자 16진수>
   <묶음의 크기(바이트)>
   <min_shell_api>
   ```
2. 묶음을 서버 컨테이너에 올려요: `server/scripts/admin.sh upload ./minesweeper-3.zip` → `/tmp/upload/minesweeper-3.zip`
3. `game add-version minesweeper 3 --file /tmp/upload/minesweeper-3.zip --signature <base64> --min-shell-api 1 --reason "…"` — 서버가 크기·sha256·서명을 확인하고 `uploaded`로 넣어요. 서명이 틀리면 등록되지 않아요.
4. `game publish minesweeper 3 --reason "…"` — 그 버전을 내보내요. 문제가 있으면 `game rollback minesweeper --reason "…"`으로 직전 버전으로 되돌려요.

**서명에 쓰는 개인 키는 운영자 컴퓨터에만 둬요.** 저장소, CI, 서버 어디에도 두지 않아요. 서버에는 공개 키(`BUNDLE_PUBLIC_KEY`)만 있어서, 서버가 뚫려도 서명 없는 코드는 앱이 받지 않아요.

## 운영

배포 방법과 secret은 [`docs/deploy.md`](../docs/deploy.md)에 있어요. 꼭 지킬 것만 여기 적어요.

1. **앱이 `/v2`를 부르기 전에는 배포하지 않아요** (맨 위의 경고).
2. **새 DB에서는 서버를 먼저 한 번 띄워 테이블을 만든 뒤에 `seed`를 돌려요.** 테이블이 없는 DB에 명령줄 도구를 부르면 "서버를 먼저 한 번 띄워 주세요"라고 알려 주고 끝나요.
3. **Cloudflare에 `/v2/` 응답을 캐시하는 규칙을 만들지 않아요.** `/v2/catalog`의 `cache-control: public, max-age=60`은 앱이 쓰는 값이에요. 앞단이 캐시하면 한 origin에 맞춰 붙인 CORS 허용 헤더가 다른 origin의 앱에도 가서, 그 앱이 답을 읽지 못해요 (안드로이드와 아이폰은 origin이 달라요).
4. 게임 묶음과 아이콘은 docker 볼륨 `data`(`/data`)에 있어요. DB와 함께 지켜야 하는 자료예요.

### v1 테이블 지우기 — 사용자가 정한 때에만

v2는 v1 테이블(`public`)을 건드리지 않아요. 그래서 v1 테이블과 그 안의 자료(토스 익명 식별키로 만든 사용자, 세션, 진행 상태, 기록)는 v2를 배포한 뒤에도 그대로 남아요. 개인정보처리방침이 "서비스를 끝내면 지체 없이 파기"라고 적고 있으니, **토스 미니앱을 접는 것이 확정되면** 지워요.

되돌릴 수 없는 일이에요. **사용자가 정한 때에만**, 운영 DB에 직접 붙어서 실행해요. 이 저장소의 어떤 코드나 워크플로도 이 SQL을 실행하지 않아요.

```sql
-- v1 테이블만 지운다 (스키마 public). v2의 테이블은 스키마 app에 있어서 영향이 없다.
-- 지우기 전에 확인: SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'app') ORDER BY 1, 2;
BEGIN;
DROP TABLE public.runs, public.records, public.user_state, public.sessions, public.users;
COMMIT;
```

## API

모두 JSON이에요. 로그인이 필요한 곳은 `Authorization: Bearer <세션 토큰>`, 오류는 `{ "error": { "code", "message" } }` 모양이에요.

| 메서드 | 경로 | 하는 일 | 로그인 |
|---|---|---|---|
| GET | `/healthz` | 살아 있는지 | 아니오 |
| GET | `/v2/catalog` | 게임, 상품, 가격, 지금 버전 (60초 캐시) | 아니오 |
| GET | `/v2/leaderboards/:boardId` | 순위표와 내 순위 | 선택 |
| POST | `/v2/auth/guest` | `{ deviceSecret }` 손님 등록·재로그인 | 아니오 |
| POST | `/v2/auth/nonce` | 로그인용 일회용 값 | 예 |
| POST | `/v2/auth/link`, `/v2/auth/link/resolve` | `{ provider, idToken }` 구글 연결, 충돌 정리 | 예 |
| POST | `/v2/auth/logout` | 이 기기를 계정에서 떼기 | 예 |
| GET | `/v2/me` | 잔액, 가진 것, 장착, 설정, 보상 상태, 내 기록, 연결된 수단 | 예 |
| DELETE | `/v2/me` | 계정 삭제 | 예 |
| PUT | `/v2/me/settings`, `/v2/me/equipped` | 설정, 장착 (가진 것만) | 예 |
| POST | `/v2/me/runs` | 판 결과 | 예 |
| POST | `/v2/me/attendance`, `/v2/me/ad-reward` | 출석, 광고 보상 | 예 |
| GET | `/v2/me/ledger`, `/v2/me/orders` | 내 코인 기록, 내 구매 기록 (쪽 단위) | 예 |
| POST | `/v2/shop/purchase` | `{ productId, idempotencyKey }` 코인으로 사기 | 예 |
| GET | `/v2/games/:id/versions/:version/bundle` | 묶음 받기 (그 게임을 가진 사용자만) | 예 |
| GET | `/v2/assets/:name` | 게임·상품 아이콘 | 아니오 |
| GET | `/privacy`, `/terms` | 개인정보처리방침·이용약관 (원본 `docs/*.md` → `npm run legal`로 만든 `src/legal/*.html`) | 아니오 |
| GET | `/test` | 구글 플레이 비공개 테스트 테스터 모집 페이지 (원본 `src/pages/`) | 아니오 |

## 코드 구조

디렉토리는 도메인으로 나눠요: `account`, `wallet`, `product`, `entitlement`, `order`, `game`, `play`, `reward`, `asset`, `admin`, `view`, 그리고 바탕인 `shared`. 다른 도메인의 것은 그 도메인의 `index.ts`로만 가져오고, 의존은 한 방향으로만 가요. 이 규칙은 `test/boundaries.test.ts`가 지켜요.

- `src/index.ts` 서버 시작 · `src/server.ts` 경로 조립 · `src/cli.ts`와 `src/commands.ts` 명령줄 · `src/seed*.ts` 처음 자료
- `drizzle/` 마이그레이션 SQL (`npm run db:generate`로 만들어 커밋해요)
- `test/` 도메인별 테스트 · `test-pg/` 진짜 PostgreSQL에서만 도는 테스트

## 알아둘 한계

- 판 결과(점수·시간·코인)는 앱이 보내요. 서버는 범위, 판 사이 간격(3초), 판당·하루 코인 상한, 그 게임을 가졌는지를 확인해요.
- 광고를 실제로 봤는지는 서버가 알 수 없어요. 하루 횟수만 서버의 한국 시간으로 막아요.
- 앱의 규칙 값(판 크기, 코인 상한, 아이템 목록)과 서버의 처음 자료(`src/seed-data.ts`)가 같은지는 저장소 루트의 `test/parity.test.ts`가 봐요.
- 요청 수 제한은 서버 한 대의 메모리 안에서 세요. 서버를 여러 대로 늘리면 다시 만들어야 해요.
