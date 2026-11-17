#!/usr/bin/env bash
# 새 VM(Ubuntu 24.04)을 게임 서버용으로 한 번 준비한다. root로 실행한다.
#   sudo bash setup-vm.sh "<배포용 SSH 공개 키 한 줄>"
# 하는 일:
#   1) Docker와 Docker Compose v2 설치 (Ubuntu 저장소 패키지)
#   2) 스왑 2GB 추가 — e2-micro는 메모리가 1GB라 여유를 둔다
#   3) 배포 전용 사용자 deploy 생성: docker 그룹, 받은 공개 키로만 SSH 접속
#   4) SSH 잠그기(비밀번호·root 로그인 끔)와 보안 업데이트 자동 설치
# 여러 번 실행해도 이미 된 것은 건너뛴다.
set -euo pipefail

PUBKEY="${1:-}"
DEPLOY_USER=deploy

if [ "$(id -u)" -ne 0 ]; then
  echo "root로 실행해 주세요: sudo bash $0 \"<공개 키>\"" >&2
  exit 1
fi
case "$PUBKEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;;
  *) echo "첫 번째 인자로 배포용 SSH 공개 키(ssh-ed25519 ...) 한 줄을 넘겨 주세요" >&2; exit 1 ;;
esac

echo "[1/4] Docker 설치"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2
fi
systemctl enable --now docker >/dev/null
docker compose version

echo "[2/4] 스왑 2GB"
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi
swapon --show

echo "[3/4] 배포 사용자 $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$PUBKEY" "$AUTH" || echo "$PUBKEY" >> "$AUTH"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
chmod 600 "$AUTH"

echo "[4/4] SSH 잠그기, 보안 업데이트 자동 설치"
# sshd는 같은 설정을 처음 읽은 값으로 정하므로, 다른 설정보다 먼저 읽히도록 01로 둔다
if [ -d /etc/ssh/sshd_config.d ]; then
  cat > /etc/ssh/sshd_config.d/01-arcade-box.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
CONF
  if command -v sshd >/dev/null 2>&1; then
    sshd -t
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi
fi
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades
fi
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo "준비 끝 — GitHub secret DEPLOY_USER에는 '$DEPLOY_USER'를 넣으세요."
