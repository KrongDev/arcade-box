# 배포와 비밀값 관리

> **⚠️ 서버 v2는 앱이 `/v2`를 부르게 바뀐 뒤에 배포해요.**
> 지금 저장소의 서버는 v2예요 (`/v2`만 받아요). 지금 나가 있는 앱은 `/v1`을 불러서, **앱이 `/v2`를 부르게 바뀌기 전에(2번 작업) `서버 배포` 워크플로를 실행하면 앱이 부르는 `/v1`이 모두 사라져요.**
> 운영 서버 배포는 사용자가 하라고 할 때만 해요.

## 로컬 개발

```bash
npm install
(cd server && docker compose -f docker-compose.dev.yml up -d --build)   # 로컬 서버 v2 (개발용 가짜 로그인)
npm run dev                                                             # http://localhost:5173
```

서버가 꺼져 있어도 앱은 기기 저장만으로 동작해요. 앱은 아직 `/v1`을 불러서 로컬 서버 v2와는 이어지지 않아요 (2번 작업에서 바뀌어요). 포트를 바꿔 띄우는 법과 서버의 자세한 내용은 [`server/README.md`](../server/README.md)를 보세요.

## 비밀값 관리

저장소에는 비밀값을 넣지 않아요. 아래 값은 GitHub 저장소의 **Settings → Secrets and variables → Actions**에 등록하면 배포 워크플로가 채워 써요. `.env`, `.env.production`, `*.local`, 인증서·키 파일(`*.crt`, `*.key`, `*.pem`)은 `.gitignore`로 막혀 있어요.

### 미니앱 배포에 쓰는 secret

| Secret | 내용 |
|---|---|
| `AIT_API_KEY` | 앱인토스 콘솔 → 워크스페이스 → 왼쪽 메뉴 '키'에서 발급한 API 키 |
| `VITE_API_BASE` | 운영 게임 서버 주소 (https만) |
| `VITE_REWARDED_AD_GROUP_ID` | 콘솔에서 발급한 보상형 광고 그룹 ID. `ads=real`로 배포할 때만 들어가요 |

`VITE_`로 시작하는 값은 빌드된 앱 안에 그대로 들어가요. 앱을 받은 사람은 볼 수 있는 값이라 진짜 비밀은 아니지만, 저장소에 남기지 않으려고 secret으로 둬요.

### 서버 배포에 쓰는 secret

| Secret | 내용 |
|---|---|
| `DEPLOY_HOST` | 서버 주소 |
| `DEPLOY_USER` | SSH 사용자 (docker를 실행할 수 있어야 해요) |
| `DEPLOY_SSH_KEY` | 배포용 SSH 개인 키 (이 용도로만 새로 만든 키를 권해요) |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -H <서버 주소>` 결과 — 접속한 서버가 진짜인지 확인하는 데 써요 |
| `DEPLOY_PORT` | (선택) SSH 포트, 기본 22 |
| `GCP_PROJECT_ID`, `GCP_ZONE`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT` | (GCP VM일 때) `setup-gcp.sh`가 출력하는 값. 있으면 공개 SSH 대신 IAP 터널로 접속해요 |
| `SERVER_DOMAIN` | 서버 도메인 이름만 (예: `arcade-api.geonbox.com`) |
| `CF_ORIGIN_CERT`, `CF_ORIGIN_KEY` | (Cloudflare 프록시를 켤 때) Cloudflare Origin 인증서와 개인 키. 없으면 Caddy가 Let's Encrypt로 직접 발급해요 |
| `POSTGRES_PASSWORD` | DB 비밀번호 — 영문·숫자·`-`·`_`만 (예: `openssl rand -hex 32`) |

### 서버 배포에 쓰는 variable (비밀값이 아닌 설정)

같은 화면의 **Variables** 탭에 등록해요. 앱에도 그대로 들어가는 값이라 비밀이 아니에요.

| Variable | 내용 |
|---|---|
| `GOOGLE_CLIENT_IDS` | 구글 로그인에서 받아들이는 우리 앱의 클라이언트 ID. 여러 개면 쉼표로 이어요 (빈칸 없이). 없으면 구글 계정 연결이 모두 거절돼요 |
| `BUNDLE_PUBLIC_KEY` | 게임 묶음 서명을 확인하는 Ed25519 **공개 키**의 base64 한 줄. 공개 키라 비밀값이 아니에요. 없으면 게임 묶음을 올릴 수 없어요 |
| `ALLOWED_ORIGINS` | (선택) 앱의 origin을 쉼표로. 비우면 `https://localhost,capacitor://localhost` (안드로이드와 아이폰 앱) |

**묶음 서명의 개인 키는 운영자 컴퓨터에만 있어요.** 저장소, GitHub(secret·variable), CI, 서버 어디에도 두지 않아요. 서버가 뚫려도 서명 없는 게임 코드는 앱이 받지 않게 하려는 거예요.

`gh` CLI로 등록하는 예:

```bash
gh secret set AIT_API_KEY                                   # 붙여 넣기 프롬프트가 떠요
openssl rand -hex 32 | gh secret set POSTGRES_PASSWORD
gh variable set GOOGLE_CLIENT_IDS --body "<클라이언트 ID>"
gh variable set BUNDLE_PUBLIC_KEY --body "<공개 키 base64>"
```

토스 연결을 걷어 내서 `TOSS_MTLS_CERT`, `TOSS_MTLS_KEY` secret은 더 쓰지 않아요. 토스 미니앱을 접는 것이 확정되면 이 두 secret과, 예전 배포가 서버에 써 둔 `~/arcade-box/mtls/`를 지워요 (배포 워크플로는 이 폴더를 만들지도 지우지도 않아요).

- 배포 워크플로는 `production` 환경으로 돌아요. **Settings → Environments → production**에서 승인자를 지정하면 배포 전에 승인을 받게 할 수 있어요.
- DB는 처음 배포할 때의 `POSTGRES_PASSWORD`로 만들어져요. 나중에 secret만 바꿔서는 DB 비밀번호가 바뀌지 않아요.
- 바깥에서는 Caddy(80·443)로만 들어와요. 서버 8080 포트는 VM 안(127.0.0.1)에서만 열려요.

## 워크플로

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `CI` | push·PR마다 | 미니앱 lint·타입 검사·빌드, 서버 타입 검사·테스트, PostgreSQL 컨테이너를 붙인 서버 동시 요청 테스트. secret을 쓰지 않아요 |
| `미니앱 배포` | 직접 실행 (Actions → Run workflow, main만) | secret으로 릴리즈 빌드를 만들어 `ait deploy`로 콘솔에 올려요. 올린 뒤 테스트·검수 요청은 콘솔에서 해요. 광고는 `ads`로 골라요(아래) |
| `서버 배포` | 직접 실행 (main만) | 서버 이미지를 GHCR에 올리고, SSH로 서버에 `.env`(와 Cloudflare Origin 인증서)를 쓴 뒤 `docker compose`로 다시 띄워요. **앱이 `/v2`를 부르기 전에는 실행하지 않아요** |

#### 미니앱 배포의 광고(`ads`)

광고 문서에 "개발 단계에서는 반드시 테스트용 광고 ID를 사용해요. 실제 광고 ID로 테스트하면 정책 위반으로 간주해 불이익을 받을 수 있어요"라고 돼 있어요. 그래서 배포를 두 갈래로 나눴어요.

| `ads` | 광고 ID | 언제 |
|---|---|---|
| `test` (기본) | 테스트 광고 ID(`ait-ad-test-rewarded-id`) | 폰에서 테스트할 번들 |
| `real` | `VITE_REWARDED_AD_GROUP_ID` | 검수에 낼 번들만. 이 번들로는 광고를 테스트하지 않아요 |

콘솔 버전 내역의 메모 앞에 `[테스트 광고]`·`[실제 광고]`가 붙어서 어느 번들인지 구분돼요. 검수 요청은 `[실제 광고]` 번들로 해요.

```bash
gh workflow run deploy-miniapp.yml --ref main -f ads=test -f memo="폰 테스트"
gh workflow run deploy-miniapp.yml --ref main -f ads=real -f memo="검수용"
```

## GCP 무료 VM에 띄우기

Compute Engine 무료 등급(e2-micro 1대)에 서버·DB·Caddy를 함께 올려요. `server/deploy/setup-gcp.sh` 하나로 잠근 VM을 만들고 배포 준비까지 해요.

무료 조건: 리전 `us-west1`·`us-central1`·`us-east1`, 표준 영구 디스크 30GB 이하, 나가는 트래픽 월 1GB. 스냅샷 백업은 유료예요. 결제 계정에 예산 알림을 꼭 걸어 두세요.

### 보안 구성

| 구분 | 허용 | 막는 것 |
|---|---|---|
| 들어오기 | 80·443 (전체) — 앱 사용자 접속, HTTPS 인증서 발급 | SSH 공개 접속, RDP, ICMP (GCP 기본 규칙 삭제) |
| 들어오기 | 22 (구글 IAP 대역 `35.235.240.0/20`만) — 구글 계정 인증을 거친 접속 | |
| 나가기 | 80·443 — 구글 로그인 공개 키 받기, 인증서 발급, 이미지 받기, 보안 업데이트 | 그 밖의 모든 포트 |

- 배포는 GitHub Actions가 GCP 키 파일 없이 Workload Identity로 인증하고 IAP 터널로 접속해요. 이 저장소의 `main` 브랜치에서 실행될 때만 인증돼요.
- VM에는 GCP 서비스 계정을 붙이지 않아요. VM이 뚫려도 GCP 프로젝트로 넘어갈 수 없어요. Shielded VM(보안 부팅·무결성 검사)을 켜요.
- SSH는 키 로그인만 받고 비밀번호·root 로그인은 꺼요. 보안 업데이트는 자동으로 설치돼요.
- 컨테이너는 Caddy만 바깥(80·443)에 열려요. 서버 8080은 VM 안(127.0.0.1)에서만, DB는 컨테이너 네트워크 안에서만 닿아요.
- 관리 기능은 HTTP로 열려 있지 않아요. 운영자는 SSH(IAP)로 들어가 서버 컨테이너 안의 명령줄 도구를 실행해요 (아래 '운영 도구').

### 1. 배포 키 만들기 (내 컴퓨터)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/arcade-box-deploy -N "" -C arcade-box-deploy
gh secret set DEPLOY_SSH_KEY < ~/.ssh/arcade-box-deploy
cat ~/.ssh/arcade-box-deploy.pub        # 공개 키 — 아래 명령에 넣어요
```

### 2. VM 만들기 (GCP 콘솔 오른쪽 위 Cloud Shell)

```bash
curl -fsSL https://raw.githubusercontent.com/KrongDev/arcade-box/main/server/deploy/setup-gcp.sh -o setup-gcp.sh
bash setup-gcp.sh "<공개 키 한 줄>"
```

마지막에 `VM_IP`, `DEPLOY_HOST`, `GCP_*`, `DEPLOY_KNOWN_HOSTS` 값이 출력돼요. 비밀값이 아니니 그대로 secret으로 등록하면 돼요.

외부 IP는 VM을 '중지 → 시작'하면 바뀔 수 있어요(재부팅은 그대로). 바뀌면 Cloudflare A 레코드의 IP만 새로 바꿔 주세요.

### 3. 도메인 연결 (Cloudflare 프록시)

서버 앞에 Cloudflare 프록시를 둬요. 서버 IP가 숨겨지고 DDoS 공격을 Cloudflare가 막아 줘요.

1. Cloudflare DNS에 A 레코드를 만들어요. 이름 `arcade-api`, 값 `VM_IP`, 프록시 **켜기**(주황 구름).
2. **SSL/TLS → Overview**에서 암호화 모드를 **Full (strict)**로 바꿔요. Flexible로 두면 요청이 무한히 리다이렉트돼요.
3. **SSL/TLS → Origin Server → Create Certificate**를 기본값으로 만들고, Origin Certificate와 Private Key를 파일로 저장해 `CF_ORIGIN_CERT`, `CF_ORIGIN_KEY` secret으로 등록해요. 개인 키는 이 화면에서 한 번만 보여요.
   ```bash
   # 화면의 값을 복사한 뒤 붙여 넣기 (macOS)
   pbpaste > ~/안전한/경로/origin.pem   # Origin Certificate
   pbpaste > ~/안전한/경로/origin.key   # Private Key
   chmod 600 ~/안전한/경로/origin.*
   gh secret set CF_ORIGIN_CERT < ~/안전한/경로/origin.pem
   gh secret set CF_ORIGIN_KEY  < ~/안전한/경로/origin.key
   ```
4. Cloud Shell에서 VM의 80·443을 Cloudflare IP 대역에서만 받게 좁혀요. Cloudflare를 건너뛴 직접 접속이 막혀요.
   ```bash
   gcloud compute firewall-rules update arcade-allow-web \
     --source-ranges="$(curl -fsSL https://www.cloudflare.com/ips-v4 | paste -sd, -)"
   ```
   Cloudflare가 대역을 바꾸면(드물어요) 같은 명령을 다시 실행해요.
5. **`/v2/` 응답을 캐시하는 규칙(Cache Rules, Page Rules의 Cache Everything)을 만들지 않아요.** Cloudflare는 기본으로 JSON을 캐시하지 않으니 그대로 두면 돼요. `/v2/catalog`의 `cache-control: public, max-age=60`은 앱이 쓰는 값이에요. 앞단이 캐시하면 한 origin에 맞춰 붙인 CORS 허용 헤더가 다른 origin의 앱에도 가서(안드로이드와 아이폰은 origin이 달라요) 그 앱이 목록을 읽지 못해요.

#### 요청한 쪽의 IP (`CLIENT_IP_HEADER`)

서버는 로그인·구매 같은 요청의 수를 IP별로 세요. 운영은 Cloudflare → Caddy → 서버 순서라, 서버가 보는 소켓 주소는 늘 Caddy예요. 그래서 운영 compose는 `CLIENT_IP_HEADER: cf-connecting-ip`를 줘요: Cloudflare가 요청마다 채워 주는, 진짜 요청한 쪽의 IP가 담긴 헤더예요 (`X-Forwarded-For`는 믿지 않아요).

- **서버가 Cloudflare를 거친 요청만 받게 해 두세요** (위 4번의 방화벽). Cloudflare를 건너뛰고 서버 IP로 바로 들어오는 요청은 이 헤더를 지어낼 수 있어서, IP별 요청 수 제한을 피해 갈 수 있어요.
- 프록시 없이(DNS only) 쓰면 이 헤더가 오지 않아요. 그러면 모든 요청이 Caddy의 주소 하나로 세어져서 IP별 제한이 사용자 전체에 한꺼번에 걸려요. v2는 Cloudflare 프록시를 켜고 쓰는 것을 기준으로 해요.

프록시 없이(DNS only) 쓰려면 1번에서 프록시를 끄고 2~5번을 건너뛰어요. 그러면 Caddy가 Let's Encrypt 인증서를 직접 받아요. 다만 위에 적은 대로 IP별 요청 수 제한이 제대로 걸리지 않아요.

### 4. secret 등록하고 배포

위 표의 secret과 variable을 등록해요. `DEPLOY_USER`는 `deploy`예요.

**먼저 확인해요: 앱이 `/v2`를 부르나요?** 아니면 여기서 멈춰요 (맨 위의 경고).

1. Actions → `서버 배포` → Run workflow. 마지막 단계가 `https://<도메인>/healthz` 응답까지 확인해요. 서버는 뜰 때 테이블을 만들어요 (스키마 `app`. v1의 `public` 테이블은 건드리지 않아요).
2. **새 DB라면 그다음에 처음 자료를 넣어요.** 순서가 중요해요: 서버를 먼저 한 번 띄워 테이블을 만든 뒤에 `seed`를 돌려요.
   ```bash
   server/scripts/admin.sh seed --reason "처음 자료"
   ```
   이미 있는 게임·순위표·상품은 건드리지 않아서 두 번 돌려도 돼요.
3. 게임 묶음을 올리고 내보내요 ([`server/README.md`](../server/README.md)의 '게임 묶음 올리기').

게임 묶음과 아이콘은 VM의 docker 볼륨 `data`에 있어요. DB(`pgdata`)와 함께 지켜야 하는 자료예요.

## 운영 도구

운영자는 자기 컴퓨터에서 `server/scripts/admin.sh`로 서버의 명령줄 도구를 불러요. 스크립트는 SSH로 VM에 들어가 `docker compose exec -e ADMIN_ACTOR=… server node src/cli.ts <명령…>`을 실행해요. 접속 정보는 환경 변수로만 받고 (스크립트와 저장소에 적지 않아요), 배포 워크플로와 같은 두 방식으로 붙어요.

| 환경 변수 | 내용 |
|---|---|
| `DEPLOY_HOST` | 서버 주소. IAP로 붙을 때는 VM 이름 (secret `DEPLOY_HOST`와 같은 값) |
| `DEPLOY_USER` | SSH 사용자 (`deploy`) |
| `DEPLOY_PORT` | (선택) SSH 포트, 기본 22 |
| `GCP_PROJECT_ID`, `GCP_ZONE` | (GCP VM일 때) 있으면 공개 SSH 대신 IAP 터널로 접속해요. `gcloud auth login`을 먼저 해 둬요 |
| `ADMIN_SSH_KEY` | (선택) SSH 개인 키 파일의 경로 (예: 아래 '1. 배포 키 만들기'에서 만든 `~/.ssh/arcade-box-deploy`). 없으면 ssh가 평소 쓰는 키를 써요 |
| `ADMIN_ACTOR` | (선택) 운영 기록에 남는 "누가". 없으면 이 컴퓨터의 사용자 이름 |
| `ADMIN_DRY_RUN` | `1`이면 접속하지 않고 무엇을 실행할지만 보여 줘요 |

```bash
# GCP VM (IAP 터널)
export DEPLOY_HOST=<VM 이름> DEPLOY_USER=deploy GCP_PROJECT_ID=<프로젝트 ID> GCP_ZONE=us-west1-b
# 바로 SSH로 닿는 서버라면 GCP_* 없이 DEPLOY_HOST=<서버 주소>

server/scripts/admin.sh product list
server/scripts/admin.sh user show <사용자 ID>
server/scripts/admin.sh grant <사용자 ID> game.minesweeper --reason "문의 #12 보상"
server/scripts/admin.sh wallet verify
```

- 서버가 진짜인지는 ssh가 `known_hosts`로 확인해요. 처음이라면 `setup-gcp.sh`가 출력한 `DEPLOY_KNOWN_HOSTS` 한 줄을 `~/.ssh/known_hosts`에 더해 둬요.
- 바꾸는 명령은 `--reason`이 꼭 있어야 하고, 실행 전에 요약을 보여 주고 확인을 받아요. 누가·무엇을·왜 했는지 `admin_actions`에 남아요.
- 명령의 목록과 게임 묶음을 올리는 순서는 [`server/README.md`](../server/README.md)에 있어요. v1 테이블을 지우는 SQL도 거기에 있어요 (사용자가 정한 때에만 실행해요).

## 미니앱(토스) 배포

`VITE_API_BASE`를 `https://<도메인>`으로 등록하고 Actions → `미니앱 배포`를 실행해요. 토스 미니앱은 v1 서버(`/v1`)를 쓰던 앱이에요: 서버를 v2로 바꾼 뒤에는 서버에 연결되지 않아요.
