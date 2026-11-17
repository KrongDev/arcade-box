#!/usr/bin/env bash
# GCP Cloud Shell에서 한 번 실행한다. 게임 서버용 무료 VM을 잠근 상태로 만들고 배포 준비까지 한다.
#   bash setup-gcp.sh "<배포용 SSH 공개 키 한 줄>"
#
# 만드는 것
#   방화벽  들어오기: 80·443은 전체, SSH(22)는 구글 IAP 대역(35.235.240.0/20)에서만. 기본 SSH·RDP·ICMP 규칙은 지운다
#           나가기:   80·443만 허용, 나머지는 차단
#   VM      e2-micro · us-west1 · 표준 디스크 30GB(무료 등급). GCP 권한(서비스 계정) 없음, Shielded VM
#   배포    GitHub Actions가 키 파일 없이 IAP로 접속하도록 서비스 계정 + Workload Identity(main 브랜치만)
# 여러 번 실행해도 이미 있는 것은 건너뛴다. 마지막에 GitHub secret에 넣을 값을 출력한다(비밀값 아님).
set -euo pipefail

PUBKEY="${1:-}"
ZONE="${ZONE:-us-west1-b}"
VM="${VM:-arcade-box}"
REPO="${REPO:-KrongDev/arcade-box}"
TAG=arcade-box
SA_NAME=github-deploy
POOL=github
PROVIDER_ID=arcade-box
IAP_RANGE=35.235.240.0/20

die() { echo "오류: $*" >&2; exit 1; }
case "$PUBKEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;;
  *) die "첫 번째 인자로 배포용 SSH 공개 키(ssh-ed25519 ...) 한 줄을 넘겨 주세요" ;;
esac
PROJECT_ID="$(gcloud config get-value project 2>/dev/null)"
[ -n "$PROJECT_ID" ] || die "프로젝트가 선택되지 않았어요: gcloud config set project <프로젝트 ID>"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

echo "[1/6] API 켜기 (Compute Engine, IAP, Workload Identity)"
gcloud services enable compute.googleapis.com iap.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "[2/6] 방화벽"
for rule in default-allow-ssh default-allow-rdp default-allow-icmp allow-web; do
  if gcloud compute firewall-rules describe "$rule" >/dev/null 2>&1; then
    gcloud compute firewall-rules delete "$rule" --quiet
  fi
done
rule() {
  local name="$1"; shift
  gcloud compute firewall-rules describe "$name" >/dev/null 2>&1 || gcloud compute firewall-rules create "$name" --network=default --target-tags="$TAG" "$@"
}
rule arcade-allow-web        --direction=INGRESS --action=ALLOW --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0
rule arcade-allow-ssh-iap    --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges="$IAP_RANGE"
rule arcade-allow-egress-web --direction=EGRESS  --action=ALLOW --rules=tcp:80,tcp:443 --destination-ranges=0.0.0.0/0 --priority=1000
rule arcade-deny-egress      --direction=EGRESS  --action=DENY  --rules=all --destination-ranges=0.0.0.0/0 --priority=65000

echo "[3/6] VM"
if gcloud compute instances describe "$VM" --zone="$ZONE" >/dev/null 2>&1; then
  echo "이미 있는 VM을 써요. 방화벽 태그만 붙여요"
  gcloud compute instances add-tags "$VM" --zone="$ZONE" --tags="$TAG"
  SA_ON_VM="$(gcloud compute instances describe "$VM" --zone="$ZONE" --format='value(serviceAccounts[0].email)')"
  if [ -n "$SA_ON_VM" ]; then
    echo "주의: 이 VM에는 GCP 서비스 계정($SA_ON_VM)이 붙어 있어요. 지우고 다시 실행하면 권한 없는 VM으로 만들어요:"
    echo "  gcloud compute instances delete $VM --zone=$ZONE"
  fi
else
  gcloud compute instances create "$VM" --zone="$ZONE" --machine-type=e2-micro \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB --boot-disk-type=pd-standard --tags="$TAG" \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --no-service-account --no-scopes
fi
IP="$(gcloud compute instances describe "$VM" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

echo "[4/6] VM 준비 (IAP로 접속: Docker, 스왑, 배포 사용자, SSH 잠그기)"
SSH=(gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --strict-host-key-checking=no)
for i in $(seq 1 30); do
  if "${SSH[@]}" --command true >/dev/null 2>&1; then break; fi
  [ "$i" = 30 ] && die "VM에 IAP로 접속하지 못했어요. 잠시 뒤 다시 실행해 주세요"
  echo "  VM이 켜지기를 기다리는 중... ($i)"
  sleep 10
done
"${SSH[@]}" --command "curl -fsSL https://raw.githubusercontent.com/$REPO/main/server/deploy/setup-vm.sh | sudo bash -s -- '$PUBKEY'"
HOSTKEY="$("${SSH[@]}" --command 'cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub' 2>/dev/null | tr -d '\r')"

echo "[5/6] GitHub Actions 접속 권한 (서비스 계정 + Workload Identity)"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deploy ($REPO)"
for role in roles/iap.tunnelResourceAccessor roles/compute.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet >/dev/null
done
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" --location=global --workload-identity-pool="$POOL" \
    --display-name="$REPO main" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  --quiet >/dev/null
PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER_ID"

echo "[6/6] 끝"
cat <<EOF

==== 아래 내용을 그대로 복사해서 알려 주세요 (비밀값이 아니에요) ====
VM_IP=$IP
DEPLOY_HOST=$VM
GCP_PROJECT_ID=$PROJECT_ID
GCP_ZONE=$ZONE
GCP_WORKLOAD_IDENTITY_PROVIDER=$PROVIDER
GCP_SERVICE_ACCOUNT=$SA
DEPLOY_KNOWN_HOSTS=$VM $HOSTKEY
=====================================================================
EOF
