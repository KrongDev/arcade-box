# 아케이드박스 서버 v2 설계

2026-11-26 · 상태: 사용자 승인 (2026-11-26). 구현 계획은 `docs/superpowers/plans/2026-11-26-server-v2.md` · 세 작업 가운데 1번

## 1. 왜 만드나

아케이드박스를 "게임 30개를 코인으로 사서 받는 모음 앱"으로 바꿔요. 사용자가 말한 불편은 이거예요: 지금은 게임이 앱 안에 들어 있어서, 게임을 추가·수정·삭제할 때마다 스토어에 배포하고 심사를 받아야 해요.

바뀌는 모습은 이래요.

- 게임은 하나씩 웹 묶음으로 서버에 올려요. 앱은 실행할 때 목록을 받아 새 게임을 보여 주고, 받은 게임은 새 버전으로 갱신해요.
- 게임은 코인으로 사요 (지금은 점수 미션으로 열려요). 코인은 한 종류예요 (지금은 게임마다 따로예요).
- 안드로이드와 아이폰에 내요. 토스 미니앱은 내지 않아요.
- 1차는 코인을 게임과 광고로 벌기만 해요. 2차에 돈으로도 팔 생각이 있어요.

일이 커서 셋으로 나눠요. 이 문서는 1번이에요.

1. **서버** (이 문서): 계정, 코인, 상품, 보유, 결제 기록, 게임 목록
2. **앱 구조**: 게임 묶음 만들기와 불러오기, 사면 받기, 자동 갱신, 통일 코인, 로그인 화면
3. **스토어 연결**: 구글·애플 결제와 영수증 확인, 광고(애드몹), 아이폰 출시. 애드몹 가입과 결제 정보 입력은 사용자가 끝냈어요(2026-11-26). 앱 등록부터는 앱을 다 만든 뒤에 해요.

## 2. 목표와 범위

### 목표

- 설치하면 로그인 없이 손님 계정으로 바로 시작하고, 구글 계정을 연결하면 폰을 바꿔도 이어져요. 애플 로그인은 같은 틀에 3번 작업에서 붙여요 (아래 "하지 않는 것").
- 코인 지갑은 사용자마다 하나이고, 코인이 변한 일은 하나도 빠짐없이 기록에 남아요.
- 상품(게임, 꾸미기 아이템, 2차의 코인 묶음)을 코드 수정이나 서버 배포 없이 추가해요. 무료·코인·현금 가격을 붙일 수 있고, 운영자가 사용자에게 직접 지급할 수 있어요.
- 결제 기록(주문과 그 상태가 바뀐 내역)을 보관해요.
- 게임 목록과 버전별 묶음 파일을 서버가 내려 줘요. 새 버전을 내보내고, 문제가 있으면 이전 버전으로 되돌려요.
- 운영자는 명령줄 도구로 상품 추가, 지급, 게임 내보내기를 해요.
- TypeScript, ORM(Drizzle), Node.js, PostgreSQL로 만들어요.
- 코드는 도메인별 디렉토리로 나누고, 공통으로 뽑는 것은 "우연히 닮은 것"이 아니라 "확실히 같은 것"만 뽑아요 (5.14, 5.15). 이 기준은 2번·3번 작업의 화면 컴포넌트에도 똑같이 적용해요.

### 하지 않는 것

- 구글·애플 결제의 영수증 확인과 환불 알림 처리 (3번 작업). 이번에는 테이블과 주문 흐름의 자리만 만들어요.
- 앱 화면, 게임 묶음을 만들고 불러오는 코드 (2번 작업).
- 애플 로그인 (3번 작업, 아이폰 출시와 함께). 애플은 계정을 지울 때 애플 쪽 토큰도 회수하라고 해요. 그러려면 서버에 애플 키를 두고 토큰을 저장해야 하는데, 아이폰 앱이 나오기 전에는 쓸 사람이 없어요. 이번에는 로그인 수단을 갈아 끼울 수 있는 틀과 구글만 만들어요.
- 스토어 등록에 필요한 계정 삭제 안내 웹 페이지 (3번 작업).
- 예전 기기 저장 가져오기 (5.13).
- 관리자 웹 화면.
- 코인 판매 (2차).
- 토스 미니앱 지원. v1 API와 토스 연결 코드는 이번에 걷어 내요 (5.13).
- 게임 가격과 보상 숫자를 확정하는 일. 숫자는 자료로 들어가고 운영자가 정해요.

### 이렇게 되면 실패

- 지갑 잔액이 코인 기록의 합과 어긋나요.
- 상품 이름이나 가격을 고쳤더니 지난 결제 기록의 내용이 바뀌어요. 계정을 지웠더니 법으로 보관해야 하는 결제 기록까지 사라져요.
- 관리 기능이 인터넷에 열려 있어요.
- 서버가 뚫리면 사용자 기기에 임의의 코드가 내려가요.
- 새 게임을 추가하는데 서버 코드를 고쳐 배포해야 해요.

## 3. 지켜야 할 조건

- **서버 한 대.** GCP e2-micro(메모리 1GB)에 서버·PostgreSQL 17·Caddy를 docker compose로 함께 띄워요. 바깥에서는 Caddy(80·443)로만 들어오고, 나가는 통신도 80·443뿐이에요. 새 포트를 열지 않아요.
- **빌드 단계가 없어요.** Node 24가 TypeScript를 바로 실행해요. 그래서 지울 수 있는 문법만 써요: `enum`, 데코레이터, 생성자 매개변수 속성을 쓰지 않아요.
- **비밀값은 저장소에 넣지 않아요.** 인증서와 키의 내용을 읽거나 출력하지 않아요.
- **스토어 규정.**
  - 구글 플레이: 앱 밖에서 받는 실행 코드는 금지지만 웹뷰의 자바스크립트는 예외예요. 계정을 만들 수 있는 앱은 앱 안의 삭제 경로와 웹 링크로 계정 삭제를 받아야 해요.
  - 애플: 구글 로그인을 쓰면 애플 로그인도 함께 제공해야 해요(4.8). 계정을 만들 수 있으면 앱 안에서 지울 수 있어야 해요(5.1.1).
- **법.** 전자상거래법 시행령 6조: 대금결제와 재화 공급 기록은 5년 보관해요.
- **개인정보.** 필요한 것만 받아요. 구글·애플이 주는 사용자 고유값만 저장하고 이메일과 이름은 저장하지 않아요.
- **테스트.** `node --test`로 돌고, 바깥 서비스(구글, 애플, 진짜 DB) 없이 돌아야 해요.

## 4. 검토한 방법

| 정할 것 | 고른 것 | 다른 방법과 버린 까닭 | 누가 정함 |
|---|---|---|---|
| 계정 | 손님으로 시작 + 구글·애플 로그인 연결 | 기기별 게임 계정(Play 게임즈, 게임센터): 안드로이드와 아이폰 사이가 이어지지 않고 방식이 둘이에요 | 사용자 |
| 관리 방법 | 명령줄 도구 | 관리자 웹 화면: 로그인·권한·화면까지 만들어야 하고 바깥에 여는 문이 늘어요 | 사용자 |
| ORM | Drizzle 0.45 (안정판) | TypeORM: 데코레이터가 빌드 없는 실행에서 돌지 않아요. Prisma: 따로 쓰는 스키마 언어와 코드 생성 단계가 생겨요. Drizzle 1.0: 아직 출시 후보예요 | 나 |
| 코인 저장 | 기록(원장) + 잔액 | 잔액만: 왜 그 잔액인지 설명할 수 없고, 2차에 코인을 팔 때 환불과 문의에 답할 근거가 없어요 | 나 |
| 구매 기록 | 코인 구매와 현금 구매를 같은 주문 테이블에 | 현금 구매만 주문으로: "무엇을 언제 얼마에 샀나"를 두 곳에서 찾아야 해요 | 나 |
| 게임 묶음 보관 | 서버 디스크, 로그인한 사용자에게 서버가 직접 내려 줌 | 바깥 저장소(R2, GCS): 묶음이 수십~수백 KB라 필요 없고 관리할 곳이 늘어요. 공개 파일: 사지 않은 게임도 받을 수 있어요 | 나 |
| 테이블 자리 | 새 PostgreSQL 스키마 `app` | v1 테이블을 고쳐 쓰기: 한 덩어리 문서(`user_state`)를 행으로 풀어야 하는데, 토스를 내지 않아 옮길 사용자가 없어요 | 나 |

## 5. 설계

### 5.1 한눈에

```text
앱(2번 작업)  ──HTTPS──▶  Caddy ──▶ 서버(Node)  ──▶ PostgreSQL (스키마 app)
                                        │
                                        ├── 게임 묶음 파일 (디스크, docker 볼륨)
                                        └── 구글·애플 공개 키 받아 오기 (443, 로그인 확인용)

운영자 ──SSH──▶ VM ──▶ 서버 컨테이너 안의 명령줄 도구 ──▶ PostgreSQL
```

- 서버는 지금처럼 Node 기본 `http`로 받고, 웹 프레임워크를 넣지 않아요.
- 규칙(코인, 구매, 판 결과 검증)은 DB와 무관한 순수 함수로 두고, 저장은 Drizzle이 맡아요. 다만 지금처럼 `domain.ts` 한 파일에 모으지 않고 도메인별 디렉토리로 나눠요 (5.14).

### 5.2 테이블

모두 스키마 `app`에 둬요. `→`는 외래 키, `?`는 비어 있을 수 있는 열이에요. 시간은 전부 `timestamptz`예요.

**계정**

| 테이블 | 열 | 제약 |
|---|---|---|
| `users` | `id` uuid PK · `status` ('active', 'deleted') · `created_at` · `deleted_at`? | |
| `user_identities` | `id` bigint PK · `user_id` → users · `provider` ('guest', 'google', 'apple') · `subject` · `created_at` · `last_used_at` | UNIQUE(provider, subject) · UNIQUE(user_id, provider) WHERE provider <> 'guest' |
| `sessions` | `token_hash` PK · `user_id` → users · `identity_id` → user_identities (어느 기기 수단으로 들어왔는지) · `expires_at` · `created_at` | INDEX(expires_at) |
| `auth_nonces` | `nonce_hash` PK · `expires_at` | 한 번 쓰면 지워요 |
| `user_settings` | `user_id` PK → users · `sound_on` · `haptic_on` · `updated_at` | |

**코인**

| 테이블 | 열 | 제약 |
|---|---|---|
| `wallets` | `user_id` PK → users · `balance` bigint · `updated_at` | CHECK(0 ≤ balance ≤ 9,000,000,000,000,000) |
| `coin_ledger` | `id` bigint PK · `user_id` → users · `delta` bigint · `balance_after` bigint · `reason` · `admin_action_id`? → admin_actions · `idempotency_key`? · `created_at` | CHECK(delta ≠ 0, balance_after ≥ 0) · UNIQUE(user_id, idempotency_key) · INDEX(user_id, id) |

`reason`은 'run'(판 결과), 'attendance', 'ad_reward', 'purchase', 'refund', 'grant'(운영자 지급), 'adjust'(운영자 조정) 가운데 하나예요. 코인 기록이 왜 생겼는지는 그 일을 한 쪽이 가리켜요: 판은 `runs.ledger_id`, 보상은 `reward_claims.ledger_id`, 구매와 환불은 `order_events.ledger_id`로 자기 코인 기록을 가리키고, 운영자 지급·조정만 코인 기록이 `admin_action_id`를 가져요. 외래 키가 늘 위 도메인에서 아래 도메인으로 향하게 하려는 거예요 (5.14).

**게임**

| 테이블 | 열 | 제약 |
|---|---|---|
| `games` | `id` text PK (예: 'pinball') · `name` · `description` · `icon_path`? · `status` ('draft', 'live', 'retired') · `sort_order` · `live_version_id`? → game_versions · `created_at` · `updated_at` | |
| `game_versions` | `id` bigint PK · `game_id` → games · `version` int · `status` ('uploaded', 'live', 'withdrawn') · `bundle_path` · `size_bytes` · `sha256` · `signature` · `min_shell_api` int · `notes`? · `created_at` · `published_at`? | UNIQUE(game_id, version) |
| `boards` | `id` text PK (예: 'minesweeper.easy') · `game_id` → games · `label` · `ordering` ('higher', 'lower') · `min_value` · `max_value` · `max_coins_per_run` int · `requires_board_id`? → boards · `validator` (기본 'caps') · `validator_params` jsonb? · `sort_order` | |
| `board_records` | `board_id` → boards · `user_id` → users · `best_value`? · `best_at`? · `best_seconds`? · `cleared_at`? · `play_count` int | PK(board_id, user_id) · INDEX(board_id, best_value) |
| `runs` | `id` bigint PK · `user_id` → users · `board_id` → boards · `value`? · `seconds`? · `won`? · `coins` int · `ledger_id`? → coin_ledger · `game_version`? int · `idempotency_key`? · `created_at` | CHECK(coins ≥ 0) · UNIQUE(user_id, idempotency_key) |

**상품과 보유**

| 테이블 | 열 | 제약 |
|---|---|---|
| `products` | `id` text PK (예: 'game.minesweeper', 'pinball.table.neon') · `kind` ('game', 'item', 'coin_pack') · `name` · `description` · `icon_path`? · `game_id`? → games · `slot`? · `access` ('everyone', 'purchase') · `status` ('draft', 'on_sale', 'hidden', 'retired') · `consumable` bool · `grant_coins`? bigint · `sort_order` · `created_at` · `updated_at` | 종류별 CHECK (아래) · UNIQUE(game_id) WHERE kind = 'game' |
| `product_prices` | `id` bigint PK · `product_id` → products · `currency` ('COIN', 'KRW') · `amount` bigint · `active` bool · `created_at` | CHECK(amount ≥ 0) · UNIQUE(product_id, currency) WHERE active |
| `store_skus` | `id` bigint PK · `product_id` → products · `store` ('google_play', 'app_store') · `sku` | UNIQUE(store, sku) · UNIQUE(product_id, store) |
| `entitlements` | `id` bigint PK · `user_id` → users · `product_id` → products · `source` ('coin_purchase', 'store_purchase', 'grant') · `admin_action_id`? → admin_actions · `granted_at` · `revoked_at`? · `revoke_reason`? ('refund', 'admin') | UNIQUE(user_id, product_id) WHERE revoked_at IS NULL |
| `equipped_items` | `user_id` → users · `game_id` → games · `slot` · `product_id` → products · `updated_at` | PK(user_id, game_id, slot) |

상품의 종류별 규칙이에요.

- `game`: `game_id`가 꼭 있고, 게임 하나에 상품은 하나예요. 이 상품을 가지면 그 게임을 할 수 있어요.
- `item`: `game_id`와 `slot`이 꼭 있어요 (예: 핀볼의 'table'). 서버는 `slot`의 뜻을 모르고, "한 게임의 한 자리에는 하나만 장착"만 지켜요.
- `coin_pack` (2차): `consumable`이 참이고 `grant_coins`가 0보다 커요. 사면 보유가 아니라 코인 기록이 생겨요.

`access`는 누가 가질 수 있는지예요.

- `everyone`: 모든 사용자가 가진 것으로 봐요. 보유 행을 만들지 않아요. 처음부터 열려 있는 게임과 기본 아이템이 여기예요.
- `purchase`: 보유 행이 있어야 해요. 켜진 가격이 있으면 살 수 있고, 가격이 없으면 운영자 지급으로만 얻어요.

가격을 바꿀 때는 옛 행의 `active`를 끄고 새 행을 넣어요. 그래서 `product_prices`에 가격이 바뀐 내역이 남아요.

**결제**

| 테이블 | 열 | 제약 |
|---|---|---|
| `orders` | `id` uuid PK · `user_id` → users · `product_id` → products · `payment_method` ('coin', 'google_play', 'app_store') · `status` ('pending', 'completed', 'refunded', 'canceled', 'failed') · 구매 당시 값: `product_name`, `product_kind`, `price_amount` bigint, `price_currency` · 스토어 값: `store_sku`?, `store_order_id`?, `store_purchase_token`?, `store_environment`?, `raw_receipt` jsonb? · `entitlement_id`? → entitlements (이 주문으로 생긴 보유) · `idempotency_key`? · `created_at` · `completed_at`? · `refunded_at`? | UNIQUE(payment_method, store_order_id) · UNIQUE(user_id, idempotency_key) · INDEX(user_id, created_at) |
| `order_events` | `id` bigint PK · `order_id` → orders · `type` · `from_status`? · `to_status`? · `actor` ('user', 'system', 'store', 'admin') · `detail` jsonb? · `ledger_id`? → coin_ledger · `admin_action_id`? → admin_actions · `created_at` | INDEX(order_id, id) |

- 주문 하나는 상품 하나예요. 코인으로 산 것도 주문이에요 (`payment_method = 'coin'`).
- `order_events.type`은 'created', 'verified', 'completed', 'granted', 'refunded', 'revoked', 'canceled', 'failed', 'note' 가운데 하나예요. 행을 고치거나 지우지 않고 쌓기만 해요. 이게 사용자가 말한 결제 history예요.

**그 밖**

| 테이블 | 열 | 제약 |
|---|---|---|
| `reward_claims` | `id` bigint PK · `user_id` → users · `kind` ('attendance', 'ad_reward') · `claim_date` date (한국 날짜) · `seq` int · `ledger_id`? → coin_ledger · `idempotency_key`? · `created_at` | UNIQUE(user_id, kind, claim_date, seq) · UNIQUE(user_id, idempotency_key) |
| `app_config` | `key` PK · `value` jsonb · `updated_at` | |
| `admin_actions` | `id` bigint PK · `actor` · `action` · `target_user_id`? uuid · `target_ref`? · `params` jsonb · `reason` · `created_at` | 외래 키를 걸지 않아요 (사용자가 지워져도 기록은 남아요) |

`app_config`에는 운영자가 조정하는 숫자를 둬요: 출석 코인, 광고 보상 코인, 하루 광고 보상 횟수. 처음 값은 지금과 같아요 (50, 50, 3). 하루에 판으로 벌 수 있는 코인의 상한(`run_coins_per_day`, 처음 값 1,500)도 여기 둬요.

### 5.3 정규화와, 일부러 중복하는 곳

**정규화한 것.** v1은 사용자 상태를 문서 하나(`user_state`)에 넣었어요. 코인은 객체, 가진 아이템과 깬 단계는 배열이었어요. v2는 사실 하나를 행 하나로 풀어요.

- 가진 것은 `entitlements`의 행, 장착은 `equipped_items`의 행, 단계 기록은 `board_records`의 행이에요.
- 가격은 상품에서 떼어 냈어요. 화폐가 여러 가지일 수 있고 바뀐 내역을 남겨야 해서요.
- 스토어 상품 코드는 스토어마다 달라서 `store_skus`로 떼어 냈어요.
- 로그인 수단은 사용자에서 떼어 냈어요. 한 사용자가 기기 여러 대(손님 수단)와 구글, 애플을 함께 가질 수 있어서요.
- jsonb는 서버가 뜻을 해석하지 않는 덩어리에만 써요: 스토어 영수증 원문, 운영 명령의 인자, 검증기 설정, 설정값.

**일부러 중복한 것.** 아래 다섯 곳뿐이고, 저마다 쓰는 함수가 하나로 정해져 있어요. 다른 코드는 이 열을 쓰지 않아요.

| 중복한 값 | 원래 사실 | 왜 중복하나 | 어떻게 맞추나 |
|---|---|---|---|
| `wallets.balance`, `coin_ledger.balance_after` | 코인 기록 `delta`의 합 | 잔액을 볼 때마다 합계를 내지 않으려고. 기록마다 그때의 잔액을 남겨 문의에 답하려고 | 지갑 행을 잠그고(`FOR UPDATE`) 기록 추가와 잔액 갱신을 한 트랜잭션으로. 명령줄 `wallet verify`가 다시 계산해 견줘요 |
| `orders`의 상품 이름·종류·가격 | 구매 시점의 `products`, `product_prices` | 상품을 고치거나 지워도 지난 기록이 바뀌지 않게 | 주문을 만들 때 한 번 베끼고 다시 고치지 않아요 |
| `orders.status` | 마지막 `order_events` | 상태별로 빨리 찾으려고 | 상태를 바꾸는 함수가 사건 추가와 상태 갱신을 한 트랜잭션으로 |
| `games.live_version_id` | `game_versions.status` | 목록을 내려 줄 때 조인 없이 지금 버전을 찾고, 되돌리기를 한 줄 갱신으로 하려고 | 내보내기·되돌리기 명령이 한 트랜잭션으로 |
| `board_records` | `runs`의 집계 | 순위표와 내 최고 기록을 빨리 읽으려고 | 판 결과를 저장하는 트랜잭션 안에서 함께 갱신 |

### 5.4 계정과 로그인

로그인 수단은 두 가지 종류예요. **기기 수단**(provider 'guest')은 기기 한 대를 가리키고, **계정 수단**(구글, 나중에 애플)은 사람을 가리켜요. 한 사용자에 기기 수단은 여러 개, 계정 수단은 종류마다 하나 붙어요.

- **손님.** 앱이 처음 켜질 때 256비트 난수(기기 비밀값)를 만들어 기기에 저장하고 `POST /v2/auth/guest`로 보내요. 서버는 그 해시가 기기 수단으로 있으면 그 수단이 붙은 사용자의 세션을 주고, 없으면 새 사용자와 기기 수단을 만들어요. 앱을 지우면 비밀값이 사라져서 새 손님이 돼요.
- **연결.** 앱이 서버에서 일회용 값(nonce)을 받아 구글 로그인에 넣고, 받은 ID 토큰을 `POST /v2/auth/link`로 보내요. 서버는 토큰의 서명(구글 공개 키), 발급자, 대상(우리 앱 ID), 만료, nonce를 확인해요. 통과하면 토큰의 사용자 고유값(`sub`)을 계정 수단으로 지금 사용자에게 붙여요.
- **이미 있는 계정일 때.** 그 구글 계정이 다른 사용자에게 붙어 있는 경우예요 (앱을 지웠다 다시 깔았거나 새 폰).
  - 지금 사용자가 손님뿐이면 (계정 수단이 없으면): 409 `link_conflict`와 양쪽 요약(코인, 가진 게임 수)을 돌려줘요. 앱이 물어본 뒤 같은 토큰으로 `POST /v2/auth/link/resolve`를 보내면 (충돌로 끝난 연결은 nonce를 쓰지 않은 것으로 둬요), **이 기기의 기기 수단을 그 계정으로 옮기고** 손님 사용자와 그 데이터를 지운 다음 그 계정의 세션을 줘요. 합치지 않아요. 손님을 여러 번 만들어 코인을 모으는 일을 막으려는 거예요. 사용자가 취소하면 아무것도 바뀌지 않아요.
  - 지금 사용자에게 이미 계정 수단이 있으면: `linked_elsewhere`로 거절해요. 진짜 계정 둘을 합치지 않아요.
- **세션이 끝난 뒤.** 세션은 지금처럼 256비트 난수 토큰이고 서버에는 해시만 저장해요. 기본 30일이에요. 끝나면 앱이 기기 비밀값으로 `POST /v2/auth/guest`를 다시 불러요. 기기 수단이 계정에 붙어 있으니 사용자가 다시 로그인하지 않아도 같은 계정으로 들어가요.
- **로그아웃.** `POST /v2/auth/logout`. 계정 수단이 있는 사용자만 할 수 있어요. 세션을 끝내고 이 기기의 기기 수단을 계정에서 떼어 지워요. 앱은 새 기기 비밀값으로 새 손님이 돼요. 손님뿐인 사용자는 로그아웃하면 데이터를 잃으므로 거절해요.
- **계정 삭제.** `DELETE /v2/me`. 현금 주문(구글·애플 결제)이 없는 사용자는 모든 행을 지워요. 현금 주문이 있으면 사용자 행을 '삭제됨'으로만 남기고, 로그인 수단·세션·설정·지갑·코인 기록·보유·장착·기록·판·보상·코인 주문을 지워요. 이렇게 남겨 둔, 계정을 지운 사용자의 현금 주문과 그 사건은 결제가 끝나거나 환불된 지 5년 뒤 명령줄 `orders purge-expired`로 지워요 (주문이 하나도 남지 않으면 '삭제됨'으로 남긴 사용자 행도 함께요). 이 보관 기간은 계정을 지운 뒤에 남겨 둔 기록의 것이에요: 계정을 지우지 않은 사용자의 주문 내역은 5년이 지나도 그대로 둬요.
- **기기 비밀값은 계정 열쇠예요.** 앱은 이 값을 앱 전용 저장소에 두고 바깥으로 내보내지 않아요 (아이폰은 키체인, 2번 작업).
- **개발용 로그인.** 로컬에서만 켜지는 가짜 계정 수단을 둬요. 운영 환경에서 켜져 있으면 서버가 뜨지 않아요 (지금의 가짜 파트너 금지와 같은 방식).
- **애플을 붙일 때 (3번 작업).** 같은 연결 흐름에 애플 토큰 확인을 더해요. 계정 삭제 때 애플 토큰을 회수해야 해서, 연결할 때 앱이 애플 인증 코드도 보내고 서버가 토큰을 받아 저장해요. `user_identities`에 그 열을 그때 더해요.

### 5.5 코인

- 코인이 변하는 길은 하나의 함수예요: 지갑 잠금 → 잔액 확인 → 기록 추가 → 잔액 갱신. 잔액이 모자라면 `insufficient_coins`로 거절하고 아무것도 쓰지 않아요.
- 앱이 같은 요청을 다시 보내도 두 번 반영되지 않게 요청마다 `idempotency_key`를 받아요. 같은 키가 오면 처음 결과를 그대로 돌려줘요.
- 코인이 생기는 곳: 판 결과, 출석, 광고 보상, 운영자 지급, 환불. 줄어드는 곳: 구매, 운영자 조정.
- 2차에 코인을 팔 때는 `coin_pack` 상품의 주문이 완료되면 `grant_coins`만큼 기록을 추가해요. 산 코인과 번 코인을 나눠 셀지는 2차에 정하고, 그때 열을 더해요 (지금 있는 코인은 모두 번 코인이라 옮기기 쉬워요).

### 5.6 상품, 구매, 지급

**코인으로 사기** `POST /v2/shop/purchase` `{ productId, idempotencyKey }`. 한 트랜잭션으로:

1. 상품이 `on_sale`이고 `access = 'purchase'`인지, 켜진 COIN 가격이 있는지 봐요. 게임 상품과 게임에 딸린 아이템은 그 게임이 `live`일 때만 팔아요 (할 수 없는 게임과, 목록에 보이지 않는 그 게임의 아이템에 코인을 받지 않아요). 아니면 `not_for_sale`이에요. 이미 산 사람의 보유는 게임을 내려도 그대로예요.
2. 이미 가졌으면 `already_owned`.
3. 지갑을 잠그고 잔액을 봐요.
4. 주문(완료, 구매 당시 이름·가격), 주문 사건(created, completed, granted), 코인 기록(−가격), 보유를 넣어요.
5. 새 잔액과 보유를 돌려줘요. 게임 상품이면 받을 버전 정보도 함께요: 답의 `game`이 `{ id, liveVersion: { version, sizeBytes, sha256, signature, minShellApi } | null }`이고, 게임 상품이 아니면 `game`은 null이에요. 앱이 목록을 다시 받지 않고 바로 묶음을 받게 하려는 거예요. 같은 키로 다시 보낸 구매에는 그때가 아니라 지금의 live 버전을 줘요 (지금 받을 것을 알려 주는 값이라서요).

**운영자 지급.** 명령줄 `grant`가 `admin_actions`와 보유(`source = 'grant'`)를 넣어요. 가격이 없는 상품(이벤트 보상 같은 것)도 이렇게 줘요.

**회수.** 환불이나 운영자 판단으로 보유의 `revoked_at`을 채워요. 행을 지우지 않아요. 회수된 아이템을 장착하고 있었으면 장착도 풀어요.

**가진 것의 기준.** 사거나 지급받은 보유(회수되지 않은 행)는 상품의 `status`와 상관없이 가진 것이에요. `everyone` 상품은 `on_sale`일 때만 누구나 가진 것이에요 (초안·숨김·판매 종료인 `everyone` 상품은 저절로 가진 것이 아니에요). 장착도 이 기준으로 가진 것만 돼요.

**게임을 할 수 있나.** 게임이 `live`이고 그 게임 상품을 위 기준으로 가졌으면 돼요. 판 결과 제출과 묶음 내려받기가 이걸 확인해요.

### 5.7 결제 기록

- 이번 작업에서 실제로 생기는 주문은 코인 주문뿐이에요.
- 현금 주문의 흐름은 자리만 잡아 둬요: 앱이 스토어에서 결제 → 서버에 영수증을 보냄 → 주문 `pending` → 스토어에 확인(3번 작업) → `completed`와 지급 → 나중에 환불 알림이 오면 `refunded`와 회수. `store_order_id`가 같으면 같은 주문이라, 같은 영수증을 두 번 보내도 한 번만 지급돼요.
- 운영자는 명령줄로 주문을 찾고(`order list`, `order show`) 코인 주문을 환불할 수 있어요 (`order refund`: 코인을 돌려주고 보유를 회수).

### 5.8 게임 목록과 묶음

- **올리기.** 운영자가 자기 컴퓨터에서 게임 묶음(zip)을 만들고 서명해요 (만드는 도구는 2번 작업). 묶음과 서명을 VM에 올리고 명령줄 `game add-version`을 실행하면, 서버가 크기·SHA-256·서명을 확인한 뒤 `game_versions`에 'uploaded'로 넣어요.
- **서명.** Ed25519예요. 서명하는 내용은 `게임 ID, 버전, sha256, 크기, min_shell_api`를 정해진 순서로 이은 글이에요. 개인 키는 운영자 컴퓨터에만 있고 (저장소, CI, 서버에 두지 않아요) 공개 키는 서버 설정과 앱에 들어가요. 서버가 뚫려도 서명 없는 코드는 앱이 거부해요 (앱 쪽 확인은 2번 작업).
- **내보내기.** `game publish <게임> <버전>`이 그 버전을 'live'로 바꾸고 `games.live_version_id`를 옮겨요.
- **되돌리기.** `game rollback <게임>`이 직전 live 버전으로 포인터를 되돌리고 문제 버전을 'withdrawn'으로 바꿔요. 앱은 다음 실행 때 목록의 버전이 자기 것과 다르면 (더 낮아도) 그 버전을 받아요.
- **목록.** `GET /v2/catalog`가 live 게임마다 이름, 설명, 아이콘, 상품과 가격, 순위표, 지금 버전(번호, 크기, sha256, 서명, min_shell_api)을 내려 줘요. 로그인 없이 볼 수 있고 60초 캐시를 허용해요.
- **받기.** `GET /v2/games/:id/versions/:version/bundle`. 세션이 있어야 하고 그 게임을 할 수 있는 사용자여야 해요. 서버가 디스크의 파일을 그대로 흘려보내요.
- **아이콘.** 아직 받지 않은 게임도 목록에 그림이 있어야 해서, 게임과 상품의 아이콘은 묶음 밖에 따로 둬요. 명령줄(`game update --icon`, `product update --icon`)로 올리면 서버가 종류(png, webp)와 크기(200KB 이하)를 확인하고 내용의 SHA-256을 이름으로 묶음 볼륨에 저장해요. `GET /v2/assets/:name`이 로그인 없이 내려 주고, 이름이 내용에 따라 바뀌므로 오래 캐시해요. 목록에는 그 주소가 들어가요.
- `min_shell_api`는 묶음이 요구하는 앱(껍데기) 쪽 약속의 버전이에요. 앱은 자기 버전보다 높은 묶음을 받지 않아요. 약속의 내용은 2번 작업에서 정해요.

### 5.9 판 결과, 순위표, 출석, 광고 보상

- **판 결과** `POST /v2/me/runs`. v1의 규칙을 이어 가요: 그 게임을 할 수 있는지, 앞 단계를 깼는지(`requires_board_id`), 직전 판에서 3초가 지났는지, 코인이 순위표의 판당 상한 안인지, 값이 `min_value`~`max_value` 안인지 봐요. 통과하면 판 저장, 기록 갱신, 코인 기록을 한 트랜잭션으로 해요.
- **하루 상한.** 하루에 판으로 벌 수 있는 코인은 `app_config`의 `run_coins_per_day`까지예요 (처음 값 1,500, 0이면 없음). 상한에 걸리면 판과 기록은 반영하고 코인만 남은 만큼 넣어요.
- **검증기.** `boards.validator`가 'caps'면 위 범위만 봐요. 새 게임은 이것으로 서버 배포 없이 추가돼요. 'minesweeper'는 v1처럼 연 칸·깃발 수가 말이 되는지 보고 점수를 서버가 다시 계산해요 (판 크기는 `validator_params`). 새 검증기 종류가 필요할 때만 서버 코드를 고쳐요.
- **순위표** `GET /v2/leaderboards/:boardId`. 위쪽 N명과 내 순위예요. 이름은 지금처럼 사용자 ID로 만든 가명("플레이어 3F2A")이에요.
- **출석·광고 보상.** 한국 날짜 기준 하루 한도를 `reward_claims`의 유일 제약으로 막아요. 코인과 횟수는 `app_config`에서 읽어요. 받은 코인은 통일 지갑으로 가요 (v1은 게임을 골라 받았어요).

### 5.10 API

모두 JSON이고, 로그인이 필요한 곳은 `Authorization: Bearer <세션 토큰>`이에요. 오류는 `{ "error": { "code", "message" } }` 모양이에요.

| 경로 | 하는 일 | 로그인 |
|---|---|---|
| `GET /healthz` | 살아 있는지 (지금과 같은 경로) | 아니오 |
| `GET /v2/catalog` | 게임, 상품, 가격, 지금 버전 | 아니오 |
| `GET /v2/leaderboards/:boardId` | 순위표 | 선택 |
| `POST /v2/auth/guest` | 손님 등록·재로그인 | 아니오 |
| `POST /v2/auth/nonce` | 로그인용 일회용 값 | 예 |
| `POST /v2/auth/link`, `POST /v2/auth/link/resolve` | 구글 연결, 충돌 정리 (애플은 3번 작업) | 예 |
| `POST /v2/auth/logout` | 로그아웃 (이 기기를 계정에서 떼기) | 예 |
| `GET /v2/me` | 잔액, 가진 것, 장착, 설정, 보상 상태, 순위표별 내 기록, 연결된 수단 | 예 |
| `DELETE /v2/me` | 계정 삭제 | 예 |
| `PUT /v2/me/settings`, `PUT /v2/me/equipped` | 설정, 장착 (가진 것만 장착돼요) | 예 |
| `POST /v2/me/runs` | 판 결과 | 예 |
| `POST /v2/me/attendance`, `POST /v2/me/ad-reward` | 보상 받기 | 예 |
| `GET /v2/me/ledger`, `GET /v2/me/orders` | 내 코인 기록, 내 구매 기록 (쪽 단위) | 예 |
| `POST /v2/shop/purchase` | 코인으로 사기 | 예 |
| `GET /v2/games/:id/versions/:version/bundle` | 묶음 받기 | 예 |
| `GET /v2/assets/:name` | 게임·상품 아이콘 | 아니오 |

- 주요 오류 코드: `unauthorized`, `token_invalid`, `link_conflict`, `linked_elsewhere`, `not_found`, `not_for_sale`, `already_owned`, `insufficient_coins`, `game_locked`, `stage_locked`, `too_fast`, `daily_limit`, `already_claimed`, `rate_limited`, `invalid_*`.
- 허용 origin은 설정으로 받아요. 앱이 Capacitor라 `https://localhost`(안드로이드)와 `capacitor://localhost`(아이폰)가 기본이에요. 토스 origin은 뺍니다.
- 요청 수 제한을 IP와 사용자 기준으로 둬요 (로그인, 구매, 판 결과, 묶음 받기). 서버가 한 대라 메모리 안에서 세요.

### 5.11 운영 도구

서버 컨테이너 안에서 `node src/cli.ts <명령>`으로 실행해요. 운영자는 자기 컴퓨터에서 SSH로 VM에 들어가 실행하고, 이를 감싼 스크립트(`server/scripts/admin.sh`)를 둬요. HTTP로 여는 관리 기능은 없어요.

| 묶음 | 명령 |
|---|---|
| 상품 | `product add`, `product update`, `product list`, `product show`, `price set`, `sku set` |
| 사용자 | `user find`, `user show` (잔액, 가진 것, 최근 코인 기록과 주문) |
| 지급 | `grant <사용자> <상품>`, `revoke <사용자> <상품>`, `coins adjust <사용자> <증감>` |
| 게임 | `game add`, `game update`, `game list`, `board add`, `board update`, `game add-version`, `game publish`, `game rollback` |
| 주문 | `order list`, `order show`, `order refund`, `orders purge-expired` |
| 설정·점검 | `config get`, `config set`, `wallet verify` |

- 무언가를 바꾸는 명령은 `--reason`이 꼭 있어야 하고, 바꾸기 전에 요약을 보여 주고 확인을 받아요 (`--yes`로 건너뜀). 모두 `admin_actions`에 남아요.
- 사용자는 사용자 ID로 가리켜요. 앱 설정 화면이 이 ID를 "사용자 번호"로 보여 줘서(2번 작업) 문의할 때 알려 줄 수 있어요.

### 5.12 보안

- 새 포트도, 관리용 HTTP도 없어요. DB는 컨테이너 네트워크 안에서만 닿아요.
- 세션 토큰과 기기 비밀값은 256비트 난수이고 서버에는 SHA-256 해시만 있어요.
- ID 토큰 확인은 엄격하게 해요: 허용한 서명 방식만, 발급자·대상·만료·nonce 모두 확인. 공개 키는 받아서 잠깐 캐시해요.
- 코인과 보유를 바꾸는 일은 모두 트랜잭션과 행 잠금 안에서 해요.
- 로그에 토큰, 영수증 원문, 기기 비밀값을 남기지 않아요.
- 게임 묶음은 서명이 맞아야 등록되고, 개인 키는 운영자 컴퓨터 밖으로 나가지 않아요.

### 5.13 v1에서 넘어가기

- v2는 새 스키마 `app`에 만들고, v1 테이블(`public`)은 건드리지 않아요.
- v1 API(`/v1/...`), 토스 인증 코드 교환, mTLS 설정, 가짜 파트너(`mock-partner`)는 이번에 지워요. 배포 워크플로에서 토스 인증서 secret을 쓰는 단계도 지워요.
- v1 테이블을 지우는 일은 이 작업에서 하지 않아요. 되돌릴 수 없는 일이라 사용자가 정한 때에 문서에 적어 둔 명령으로 해요. 개인정보처리방침은 "서비스를 끝내면 지체 없이 파기"라고 적고 있어서, 토스 미니앱을 접는 것이 확정되면 지워야 해요.
- 예전 기기 저장은 가져오지 않아요. v1 안드로이드 앱은 서버에 연결한 적이 없어서 서버는 테스터와 다른 사람을 가릴 수 없어요. 가져오기를 열어 두면 지어낸 저장으로 누구나 코인 6만 개와 게임을 얻을 수 있고, 손님 계정은 얼마든지 만들 수 있어요. 테스터에게 보상하려면 운영자가 `grant`와 `coins adjust`로 줘요.
- 처음 넣는 자료(seed): 게임 3개, 순위표 5개(v1의 상한 그대로), 게임 상품 3개, v1 아이템 목록. 핀볼과 무료 아이템은 `everyone`이에요. 유료 아이템 8개는 스토어 결제가 붙을 때까지 `hidden`이에요 (운영자 지급은 돼요). 게임 가격은 임시값으로 넣고 출시 전에 운영자가 정해요.

### 5.14 코드 구조

디렉토리는 기술 층(규칙, 저장, HTTP)이 아니라 도메인으로 나눠요. 한 도메인의 디렉토리에 그 도메인의 테이블 정의, 규칙, 저장, HTTP 경로, 명령줄 명령이 함께 있어요.

```text
server/src/
  index.ts          서버 시작: 설정을 읽고 도메인의 경로를 모아 띄워요
  cli.ts            명령줄 시작: 도메인의 명령을 모아 등록해요
  schema.ts         모든 도메인의 테이블을 모은 것 (마이그레이션 도구용)
  account/          사용자, 로그인 수단, 세션, 연결과 충돌, 계정 삭제, 설정
  wallet/           지갑과 코인 기록. 코인이 변하는 유일한 길
  product/          상품, 가격, 스토어 상품 코드
  entitlement/      보유, 지급과 회수, 장착
  order/            주문과 주문 사건, 코인으로 사기, 환불
  game/             게임, 버전과 묶음, 내보내기와 되돌리기
  play/             게임을 하는 일: 묶음 받기, 순위표 정의, 판 결과, 기록, 순위표 조회
  reward/           출석, 광고 보상
  asset/            아이콘 올리기와 내려 주기
  admin/            운영 기록, 운영자가 조정하는 설정값
  view/             여러 도메인을 모아 한 번에 내려 주는 읽기 전용 응답 (/v2/catalog, /v2/me)
  shared/           어느 도메인의 것도 아닌 바탕: 설정, DB 연결과 트랜잭션, HTTP 받기와 오류 응답,
                    요청 수 제한, 명령줄 틀, 시계와 한국 날짜, 난수·해시·서명 확인
server/drizzle/     마이그레이션 SQL
server/test/        src와 같은 이름의 디렉토리
```

도메인 디렉토리 안은 필요한 것만 둬요: `schema.ts`(테이블), `rules.ts`(DB를 모르는 순수 규칙), `repo.ts`(조회와 저장), `service.ts`(트랜잭션 하나로 끝나는 일), `routes.ts`(HTTP), `commands.ts`(명령줄), `index.ts`(다른 도메인에 내보이는 것).

경계 규칙이에요.

- 다른 도메인의 것은 그 도메인의 `index.ts`로만 가져와요. 예외는 하나예요: 테이블의 외래 키를 걸 때는 상대 도메인의 `schema.ts`를 가져올 수 있어요.
- `shared`는 도메인을 가져오지 않아요.
- 도메인끼리는 한 방향으로만 기대요. 아래에서 위로 `admin`·`asset`·`account` → `game`·`wallet` → `product` → `entitlement` → `play`·`reward`·`order` → `view` 순서이고, 위의 것만 아래 것을 가져와요. 테이블의 외래 키도 같은 방향이에요. `view`는 모두를 읽기만 해요. 서로 물고 도는 의존은 없어요.
- 아래 도메인이 위 도메인의 일을 시켜야 할 때는 (계정을 지울 때 지갑·보유·주문도 지우기, 연결 충돌 때 코인과 게임 수 보여 주기) 직접 가져오지 않고, 서버를 조립하는 `index.ts`가 그 함수를 넣어 줘요.
- 이 규칙은 테스트가 지켜요 (소스의 `import`를 훑어 어긴 곳이 있으면 실패).

### 5.15 공통으로 뽑는 기준

비슷해 보이는 코드를 만났을 때, 공통으로 뽑기 전에 아래를 물어요. 셋 다 "예"일 때만 뽑아요.

1. **같은 개념인가.** 운영자나 사용자의 말로 같은 것을 가리키나요? 모양만 닮은 것은 같은 개념이 아니에요.
2. **같은 까닭으로 바뀌나.** 한쪽 규칙이 바뀌면 다른 쪽도 반드시 같이 바뀌어야 하나요? 따로 바뀔 수 있으면 우연히 닮은 거예요.
3. **뽑은 것이 깔끔한가.** 부르는 쪽마다 다른 점을 맞추려고 옵션이나 분기를 넣어야 하면 뽑지 않아요.

덧붙이는 규칙이에요.

- 규칙이 "한 곳이어야 한다"고 정한 것(예: 코인은 반드시 기록을 거친다)은 처음부터 한 곳에 만들어요. 그 밖의 것은 세 번째로 같은 것이 나올 때까지 따로 둬요.
- 뽑은 코드는 그 개념의 주인 도메인에 둬요. 주인이 없는 바탕 기능만 `shared`에 가요. `utils` 같은 잡동사니 디렉토리는 만들지 않아요.

이 설계에 대입한 결과예요.

| 닮은 것 | 판단 | 어떻게 하나 |
|---|---|---|
| 판 결과·출석·광고 보상·구매·환불·지급이 모두 코인을 바꿈 | 확실한 공통 (잔액과 기록이 어긋나면 안 된다는 한 규칙) | `wallet`의 함수 하나만 코인을 바꿔요 |
| 운영 명령이 모두 까닭을 받고, 확인을 묻고, 기록을 남김 | 확실한 공통 (운영자가 바꾼 것은 모두 남긴다는 한 규칙) | `admin`의 틀 하나로 모든 명령을 감싸요 |
| 판 결과·구매·보상 요청이 같은 요청을 두 번 받아도 한 번만 반영 | 확실한 공통 (같은 약속, 같은 방식) | `shared`의 작은 도우미 하나 |
| 게임 아이콘과 상품 아이콘 | 확실한 공통 (종류·크기 확인, 내용으로 이름 짓기, 내려 주기가 같은 규칙) | `asset` 도메인 하나 |
| 세션 확인, 오류 응답 모양, 요청 수 제한, 한국 날짜 | 확실한 공통 (바탕 기능) | `shared` |
| 주문의 상태와 사건, 게임 버전의 상태, 보유의 지급과 회수 | 우연히 닮음. 셋 다 "상태가 바뀐다"지만 바뀌는 까닭과 남기는 것이 달라요 | 공통 "상태 기계"를 만들지 않고 도메인마다 따로 |
| 게임의 상태(draft, live, retired)와 상품의 상태(draft, on_sale, hidden, retired) | 우연히 닮음. 낱말만 겹쳐요 | 타입을 나눠 가져요 |
| 게임과 상품이 둘 다 이름·설명·아이콘·순서를 가짐 | 우연히 닮음. 게임은 내용물이고 상품은 파는 것이라 따로 바뀌어요 | 공통 부모 테이블이나 타입을 만들지 않아요 |
| 구글 로그인 확인과 (3번 작업의) 애플 로그인 확인 | 확실한 공통은 "토큰을 확인해 사용자 고유값을 얻는다"까지. 확인 방법은 달라요 | 수단마다 구현 하나, 같은 모양의 인터페이스 |

### 5.16 테스트

- 규칙 함수는 DB 없이 테스트해요 (지금 `domain` 테스트처럼).
- DB가 필요한 테스트는 프로세스 안에서 도는 PostgreSQL(PGlite)에 마이그레이션을 적용해서 돌려요. Docker가 없어도 돼요.
- 꼭 있어야 하는 테스트:
  - 임의의 순서로 벌기·사기·환불·지급을 섞어도 잔액이 기록의 합과 같고 0 아래로 내려가지 않아요.
  - 같은 `idempotency_key`로 두 번 보내면 한 번만 반영돼요.
  - 상품 이름과 가격을 고쳐도 지난 주문의 내용이 그대로예요.
  - 가지지 않은 게임의 판 결과와 묶음 받기가 거절돼요. 회수하면 다시 거절돼요.
  - 계정 연결: 처음 연결, 이미 있는 계정(충돌)에서 계정 데이터 쓰기와 취소, 양쪽 다 계정 수단이 있으면 거절.
  - 다른 기기에서 계정에 들어간 뒤 세션이 끝나도 기기 비밀값만으로 같은 계정에 다시 들어가요. 로그아웃하면 그 기기 비밀값으로는 못 들어가요.
  - 계정 삭제: 현금 주문이 없으면 전부 사라지고, 있으면 주문과 사건만 남아요.
  - 서명이 틀린 묶음은 등록되지 않아요. 되돌리면 목록의 버전이 이전 것으로 바뀌어요.
  - 잘못된 ID 토큰(서명, 발급자, 대상, 만료, nonce)이 모두 거절돼요. 토큰 확인기는 가짜 키로 바꿔 끼워요.
  - 아이콘: 허용하지 않는 종류와 큰 파일은 거절되고, 이름에 경로를 넣은 요청은 파일을 내주지 않아요.
  - 도메인 경계: 다른 도메인의 `index.ts`가 아닌 파일을 가져오거나(`schema.ts`의 외래 키는 예외), `shared`가 도메인을 가져오면 실패해요.
- 진짜 PostgreSQL에서만 드러나는 것(두 요청이 동시에 같은 지갑을 쓰는 경우)은 CI에서 PostgreSQL 컨테이너에 붙여 돌리는 테스트 한 묶음으로 확인해요.

## 6. 끝났다고 말하려면

- 서버 테스트, 타입 검사, 린트가 통과해요. CI의 PostgreSQL 테스트도 통과해요.
- 로컬 docker compose로 띄워서 아래를 차례로 해 봐요: 손님 등록 → 판 결과로 코인 벌기 → 출석 → 코인으로 게임 사기 → 묶음 받기 → 개발용 로그인으로 연결 → 다른 기기 비밀값으로 같은 계정에 들어가기 → 계정 삭제.
- 명령줄로 해 봐요: 상품 추가, 가격 설정, 지급과 회수, 게임 버전 등록·내보내기·되돌리기, `wallet verify`.
- 운영 서버 배포는 이 작업의 끝이 아니에요. 사용자가 하라고 할 때 해요.

## 7. 만드는 사람이 정할 것

- 도메인 디렉토리 안의 파일을 더 잘게 나눌지와 함수 이름. 디렉토리 구조와 경계 규칙은 5.14를 따라요.
- Drizzle 열 타입의 세부, 인덱스 이름, 마이그레이션 파일 나누기.
- 요청 수 제한의 숫자, 쪽 크기, 캐시 시간.
- 명령줄 인자의 모양과 출력 형식.
- 위에 적지 않은 오류 코드 이름.
- JWT 확인에 쓸 라이브러리 (의존성은 적게).

## 8. 누가 무엇을 정했나

**사용자가 정한 것**
- 게임은 최종 30개이고 코인으로 사요. 코인은 한 종류예요.
- 1차는 코인을 벌기만 하고, 2차에 돈으로도 팔 수 있어요.
- 안드로이드와 아이폰에 내고, 토스 미니앱은 내지 않아요.
- 계정은 구글·애플 로그인으로 연결해요 (안드로이드와 아이폰을 오가도 이어지게).
- 유료·무료 상품을 운영자가 추가하고 사용자에게 지급할 수 있어야 해요. 결제 기록을 관리하는 테이블이 있어야 해요.
- 운영은 명령줄 도구로 해요.
- TypeScript, ORM, Node.js로 만들고, 정규화와 반정규화를 잘해요.
- 디렉토리는 도메인별로 나눠요. 공통으로 쓰는 것은 우연한 공통인지 확실한 공통인지 가려서 재사용할 수 있게 설계해요. 화면 컴포넌트와 서버 로직 모두요.
- 애드몹 앱 등록부터는 앱을 다 만든 뒤에 해요.
- 하루에 판으로 벌 수 있는 코인은 1,500개까지예요 (설정으로 바꿀 수 있어요).

**내가 정한 것** (사용자가 바꿀 수 있어요)
- ORM은 Drizzle 0.45예요.
- 도메인을 11개로 나눈 것과 그 사이의 의존 방향 (5.14), 무엇을 공통으로 보고 무엇을 우연으로 봤는지 (5.15의 표).
- 손님으로 바로 시작하고, 계정은 나중에 연결해요.
- 이미 있는 계정에 연결하면 계정 데이터를 쓰고, 손님 데이터와 합치지 않아요. 계정 수단이 이미 있는 두 계정도 합치지 않아요.
- 한 계정에 기기를 여러 대 붙일 수 있고, 세션이 끝나도 기기가 알아서 다시 들어가요.
- 애플 로그인은 아이폰을 낼 때(3번 작업) 붙여요.
- 이메일과 이름을 저장하지 않아요.
- 코인으로 산 것도 주문으로 남겨요.
- 게임 묶음은 로그인한 사용자에게 서버가 직접 내려 주고, 운영자 컴퓨터의 키로 서명해요. 아이콘은 서버가 따로 내려 줘요.
- 출석·광고 보상 숫자는 설정 테이블에 두고, 새 게임의 검증은 범위 확인(caps)으로 해요.
- 보상 코인 설정이 0이면 코인 기록 없이 받은 것으로만 적어요.
- v1 테이블은 지우지 않고 두고, v1 API와 토스 연결 코드는 지워요.
- 안드로이드 테스터의 예전 기기 저장은 가져오지 않아요 (지어낸 저장으로 코인과 게임을 얻을 수 있어서). 보상은 운영자 지급으로 해요.
- 계정을 지울 때 현금 주문만 5년 남겨요.
- `everyone` 상품은 판매 중(`on_sale`)일 때만 누구나 가진 것으로 보고, 사거나 지급받은 것은 상품 상태와 상관없이 회수 전까지 가진 것으로 봐요 (5.6).
- 구글 로그인의 일회용 값(nonce)은 그것을 받은 사용자에게 묶어요. 요청을 보낸 주소는 설정한 헤더(`CLIENT_IP_HEADER`)에서 읽어요 (운영은 Cloudflare 뒤).
