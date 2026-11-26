#!/usr/bin/env bash
# 운영자 컴퓨터에서 서버(VM)의 명령줄 도구를 부른다. 서버 컨테이너 안에서 `node src/cli.ts <명령…>`을 실행한다.
#
#   server/scripts/admin.sh <명령…>
#   server/scripts/admin.sh upload <파일…>      묶음·아이콘 파일을 서버 컨테이너의 /tmp/upload/로 올린다
#
#   예) server/scripts/admin.sh product list
#       server/scripts/admin.sh grant <사용자ID> game.minesweeper --reason "문의 #12 보상"
#       server/scripts/admin.sh upload ./minesweeper-3.zip
#       server/scripts/admin.sh game add-version minesweeper 3 --file /tmp/upload/minesweeper-3.zip \
#         --signature <base64> --min-shell-api 1 --reason "3판"
#
# 접속 정보는 환경 변수로만 받는다 (이 파일에 적지 않는다). 값은 docs/deploy.md의 배포 secret과 같다.
#   DEPLOY_HOST      서버 주소. IAP 터널로 붙을 때는 VM 이름
#   DEPLOY_USER      SSH 사용자 (docker를 실행할 수 있어야 한다. setup-vm.sh가 만든 사용자는 deploy)
#   DEPLOY_PORT      (선택) SSH 포트, 기본 22
#   GCP_PROJECT_ID   (GCP VM일 때) 있으면 공개 SSH 대신 구글 IAP 터널로 접속한다. 먼저 `gcloud auth login`을 해 둔다
#   GCP_ZONE         (선택) VM의 영역, 기본 us-west1-b
#   ADMIN_SSH_KEY    (선택) SSH 개인 키 파일의 경로. 없으면 ssh가 평소 쓰는 키(에이전트)를 쓴다
#   ADMIN_ACTOR      (선택) 운영 기록(admin_actions)에 남는 "누가". 없으면 이 컴퓨터의 사용자 이름
#   ADMIN_REMOTE_DIR (선택) 서버에서 docker-compose.yml이 있는 폴더, 기본 arcade-box (홈 기준)
#   ADMIN_DRY_RUN    1이면 접속하지 않고 무엇을 실행할지만 보여 준다
#
# 서버가 진짜인지는 ssh가 known_hosts로 확인한다 (StrictHostKeyChecking을 끄지 않는다).
# 처음이라면 setup-gcp.sh가 출력한 DEPLOY_KNOWN_HOSTS 한 줄을 ~/.ssh/known_hosts에 더해 둔다.
set -euo pipefail

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  echo
  echo "환경 변수: DEPLOY_HOST, DEPLOY_USER (꼭), DEPLOY_PORT, GCP_PROJECT_ID, GCP_ZONE, ADMIN_SSH_KEY, ADMIN_ACTOR, ADMIN_REMOTE_DIR, ADMIN_DRY_RUN"
}

die() {
  echo "admin.sh: $*" >&2
  exit 1
}

# 서버의 셸이 다시 읽어도 한 덩어리로 남게 작은따옴표로 감싼다 (빈칸·따옴표·한글·$가 든 까닭도 그대로 간다)
quote() {
  local s=$1 q="'" esc="'\\''"
  printf "'%s'" "${s//$q/$esc}"
}

if [ "$#" -eq 0 ]; then
  usage >&2
  exit 2
fi
case "$1" in
  -h | --help | help)
    usage
    exit 0
    ;;
esac

[ -n "${DEPLOY_HOST:-}" ] || die "DEPLOY_HOST가 없어요 (서버 주소, IAP로 붙을 때는 VM 이름)"
[ -n "${DEPLOY_USER:-}" ] || die "DEPLOY_USER가 없어요 (SSH 사용자)"
# ssh 옵션으로 읽히지 않게 모양을 본다
case "$DEPLOY_HOST" in -* | *[!A-Za-z0-9._:-]*) die "DEPLOY_HOST에는 주소나 VM 이름만 넣어 주세요" ;; esac
case "$DEPLOY_USER" in -* | *[!A-Za-z0-9._-]*) die "DEPLOY_USER에는 사용자 이름만 넣어 주세요" ;; esac
port=${DEPLOY_PORT:-22}
case "$port" in *[!0-9]* | "") die "DEPLOY_PORT는 숫자여야 해요" ;; esac

actor=${ADMIN_ACTOR:-$(id -un)}
[ -n "$actor" ] || die "누가 실행하는지 알 수 없어요. ADMIN_ACTOR를 정해 주세요"
remote_dir=${ADMIN_REMOTE_DIR:-arcade-box}

ssh_opts=(-o StrictHostKeyChecking=yes -p "$port")
if [ -n "${ADMIN_SSH_KEY:-}" ]; then
  [ -f "$ADMIN_SSH_KEY" ] || die "ADMIN_SSH_KEY가 가리키는 파일이 없어요"
  ssh_opts+=(-i "$ADMIN_SSH_KEY" -o IdentitiesOnly=yes)
fi
if [ -n "${GCP_PROJECT_ID:-}" ]; then
  zone=${GCP_ZONE:-us-west1-b}
  case "$GCP_PROJECT_ID" in *[!A-Za-z0-9:._-]*) die "GCP_PROJECT_ID의 모양이 이상해요" ;; esac
  case "$zone" in *[!A-Za-z0-9-]*) die "GCP_ZONE의 모양이 이상해요" ;; esac
  command -v gcloud >/dev/null 2>&1 || die "IAP 터널로 붙으려면 gcloud가 있어야 해요 (GCP_PROJECT_ID를 비우면 바로 SSH로 붙어요)"
  # 공개 SSH 없이 구글 IAP 터널로 접속한다. known_hosts는 VM 이름으로 맞춘다 (배포 워크플로와 같은 방식)
  ssh_opts+=(
    -o "HostKeyAlias=$DEPLOY_HOST"
    -o "ProxyCommand=gcloud compute start-iap-tunnel %h 22 --listen-on-stdin --project=$GCP_PROJECT_ID --zone=$zone --verbosity=warning"
  )
fi
target="$DEPLOY_USER@$DEPLOY_HOST"

# 서버에서 한 줄을 실행한다. 둘째 인자가 있으면 그 파일을 표준 입력으로 넘긴다
run_remote() {
  local tty=$1 remote=$2 input=${3:-}
  if [ "${ADMIN_DRY_RUN:-}" = 1 ]; then
    echo "접속: ssh $tty ${ssh_opts[*]} $target"
    echo "서버에서: $remote"
    [ -z "$input" ] || echo "표준 입력: $input"
    return 0
  fi
  # 서버에서 실행할 줄은 여기서 다 만들어 넘긴다 (인자는 quote로 감쌌다). 그래서 이 컴퓨터에서 펼쳐지는 것이 맞다
  # shellcheck disable=SC2029
  if [ -n "$input" ]; then
    ssh "$tty" "${ssh_opts[@]}" "$target" "$remote" <"$input"
  else
    ssh "$tty" "${ssh_opts[@]}" "$target" "$remote"
  fi
}

compose="cd -- $(quote "$remote_dir") && docker compose exec"

if [ "$1" = upload ]; then
  shift
  [ "$#" -gt 0 ] || die "올릴 파일을 적어 주세요: admin.sh upload <파일…>"
  for file in "$@"; do
    [ -f "$file" ] || die "파일이 없어요: $file"
    name=$(basename -- "$file")
    case "$name" in
      .* | *[!A-Za-z0-9._-]*) die "파일 이름은 영문·숫자·.·_·-만 써 주세요: $name" ;;
    esac
    # 이름은 위에서 모양을 확인했다. 컨테이너 안의 /tmp/upload/에 서버를 돌리는 사용자(node)의 파일로 쓴다
    inner="umask 077; mkdir -p /tmp/upload && cat > /tmp/upload/$name"
    run_remote -T "$compose -T server sh -c $(quote "$inner")" "$file"
    if [ "${ADMIN_DRY_RUN:-}" != 1 ]; then
      echo "올렸어요: /tmp/upload/$name (서버 컨테이너 안의 경로예요. --file이나 --icon에 이 경로를 적어요. 컨테이너를 다시 만들면 사라져요)"
    fi
  done
  exit 0
fi

args=""
for arg in "$@"; do
  args="$args $(quote "$arg")"
done

# 터미널에서 부르면 확인 질문(y/N)에 답할 수 있게 tty를 붙인다. 스크립트나 파이프에서 부르면 붙이지 않는다 (--yes가 필요하다)
if [ -t 0 ] && [ -t 1 ]; then
  run_remote -t "$compose -e ADMIN_ACTOR=$(quote "$actor") server node src/cli.ts$args"
else
  run_remote -T "$compose -T -e ADMIN_ACTOR=$(quote "$actor") server node src/cli.ts$args"
fi
