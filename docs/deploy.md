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
| `VITE_REWARDED_AD_GROUP_ID` | (선택) 콘솔에서 발급한 보상형 광고 그룹 ID. 없으면 테스트 광고 ID로 빌드해요 |

`VITE_`로 시작하는 값은 빌드된 앱 안에 그대로 들어가요. 앱을 받은 사람은 볼 수 있는 값이라 진짜 비밀은 아니지만, 저장소에 남기지 않으려고 secret으로 둬요.

### 서버 배포에 쓰는 secret

| Secret | 내용 |
|---|---|
| `DEPLOY_HOST` | 서버 주소 |
| `DEPLOY_USER` | SSH 사용자 (docker를 실행할 수 있어야 해요) |
| `DEPLOY_SSH_KEY` | 배포용 SSH 개인 키 (이 용도로만 새로 만든 키를 권해요) |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -H <서버 주소>` 결과 — 접속한 서버가 진짜인지 확인하는 데 써요 |
| `DEPLOY_PORT` | (선택) SSH 포트, 기본 22 |
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
- 서버는 8080 포트(http)로 떠요. 미니앱은 https 주소만 쓰니 앞단에 TLS를 붙이는 리버스 프록시(Caddy, Nginx 등)를 두세요.

## 워크플로

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `CI` | push·PR마다 | 미니앱 lint·타입 검사·빌드, 서버 타입 검사·테스트. secret을 쓰지 않아요 |
| `미니앱 배포` | 직접 실행 (Actions → Run workflow, main만) | secret으로 릴리즈 빌드를 만들어 `ait deploy`로 콘솔에 올려요. 올린 뒤 테스트·검수 요청은 콘솔에서 해요 |
| `서버 배포` | 직접 실행 (main만) | 서버 이미지를 GHCR에 올리고, SSH로 서버에 `.env`와 인증서를 쓴 뒤 `docker compose`로 다시 띄워요 |
