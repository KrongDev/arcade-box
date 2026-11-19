# 배포와 비밀값 관리

## 로컬 개발

```bash
npm install
(cd server && docker compose -f docker-compose.dev.yml up -d --build)   # 가짜 파트너로 도는 로컬 서버
npm run dev                                                             # http://localhost:5173
```

서버가 꺼져 있어도 앱은 기기 저장만으로 동작해요. 서버 자세한 내용은 [`server/README.md`](../server/README.md)를 보세요.

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
| `TOSS_MTLS_CERT` | 앱인토스 콘솔 mTLS 인증서 zip 안의 인증서(`*_public.crt`) 내용 전체 |
| `TOSS_MTLS_KEY` | 같은 zip 안의 개인 키(`*_private.key`) 내용 전체 |

`gh` CLI로 등록하는 예:

```bash
gh secret set AIT_API_KEY                                   # 붙여 넣기 프롬프트가 떠요
gh secret set TOSS_MTLS_CERT < /안전한/경로/xxx_public.crt
gh secret set TOSS_MTLS_KEY  < /안전한/경로/xxx_private.key
openssl rand -hex 32 | gh secret set POSTGRES_PASSWORD
```

- 배포 워크플로는 `production` 환경으로 돌아요. **Settings → Environments → production**에서 승인자를 지정하면 배포 전에 승인을 받게 할 수 있어요.
- DB는 처음 배포할 때의 `POSTGRES_PASSWORD`로 만들어져요. 나중에 secret만 바꿔서는 DB 비밀번호가 바뀌지 않아요.
- 바깥에서는 Caddy(80·443)로만 들어와요. 서버 8080 포트는 VM 안(127.0.0.1)에서만 열려요.

## 워크플로

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `CI` | push·PR마다 | 미니앱 lint·타입 검사·빌드, 서버 타입 검사·테스트. secret을 쓰지 않아요 |
| `미니앱 배포` | 직접 실행 (Actions → Run workflow, main만) | secret으로 릴리즈 빌드를 만들어 `ait deploy`로 콘솔에 올려요. 올린 뒤 테스트·검수 요청은 콘솔에서 해요. 광고는 `ads`로 골라요(아래) |
| `서버 배포` | 직접 실행 (main만) | 서버 이미지를 GHCR에 올리고, SSH로 서버에 `.env`와 인증서를 쓴 뒤 `docker compose`로 다시 띄워요 |

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
| 나가기 | 80·443 — 토스 API, 인증서 발급, 이미지 받기, 보안 업데이트 | 그 밖의 모든 포트 |

- 배포는 GitHub Actions가 GCP 키 파일 없이 Workload Identity로 인증하고 IAP 터널로 접속해요. 이 저장소의 `main` 브랜치에서 실행될 때만 인증돼요.
- VM에는 GCP 서비스 계정을 붙이지 않아요. VM이 뚫려도 GCP 프로젝트로 넘어갈 수 없어요. Shielded VM(보안 부팅·무결성 검사)을 켜요.
- SSH는 키 로그인만 받고 비밀번호·root 로그인은 꺼요. 보안 업데이트는 자동으로 설치돼요.
- 컨테이너는 Caddy만 바깥(80·443)에 열려요. 서버 8080은 VM 안(127.0.0.1)에서만, DB는 컨테이너 네트워크 안에서만 닿아요.

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

프록시 없이(DNS only) 쓰려면 1번에서 프록시를 끄고 2~4번을 건너뛰어요. 그러면 Caddy가 Let's Encrypt 인증서를 직접 받아요.

### 4. secret 등록하고 배포

위 표의 secret을 등록해요. `DEPLOY_USER`는 `deploy`예요.

1. Actions → `서버 배포` → Run workflow. 마지막 단계가 `https://<도메인>/healthz` 응답까지 확인해요.
2. `VITE_API_BASE`를 `https://<도메인>`으로 등록하고 Actions → `미니앱 배포`를 실행해요.
