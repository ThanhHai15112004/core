#!/usr/bin/env bash
# ==============================================================================
# Phase 15.3 — Safe Rollback Script với Anti-Loop Guard
#
# Khôi phục bản phát hành ổn định trước đó (`previous`) khi health check / smoke
# test lỗi hoặc khi vận hành kích hoạt rollback thủ công.
# Tự động chặn vòng lặp rollback qua `state-manager.mjs` (`MAX_ROLLBACK_ATTEMPTS`).
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_NAME="${DEPLOY_ENV:-production}"
TARGET="${DEPLOY_TARGET:-compose}"
STRATEGY="${DEPLOY_STRATEGY:-rolling}"
STATE_FILE="${DEPLOY_STATE_FILE:-.deploy/${ENV_NAME}-state.json}"
BASE_URL="${DEPLOY_BASE_URL:-http://127.0.0.1}"
K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
REASON="${ROLLBACK_REASON:-Manual or health-check triggered rollback}"
MAX_ROLLBACKS="${MAX_ROLLBACK_ATTEMPTS:-2}"
UPSTREAM_FILE="${NGINX_UPSTREAM_FILE:-docker/nginx/upstreams/backend.conf}"
DRY_RUN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --strategy) STRATEGY="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --namespace) K8S_NAMESPACE="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --max-rollbacks) MAX_ROLLBACKS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

echo "🔄 [rollback] Kiểm tra điều kiện an toàn rollback (env=${ENV_NAME}, max=${MAX_ROLLBACKS})..."
if ! node scripts/deploy/state-manager.mjs can-rollback \
  --state "$STATE_FILE" \
  --env "$ENV_NAME" \
  --max-rollbacks "$MAX_ROLLBACKS"; then
  echo "🛑 [rollback] Bị chặn bởi Anti-Loop Guard hoặc không có bản trước đó. Dừng để tránh lặp vô hạn!" >&2
  exit 2
fi

if [ "$DRY_RUN" = true ]; then
  echo "ℹ️  [rollback] DRY-RUN: Sẽ khôi phục previous release cho env=${ENV_NAME} (target=${TARGET}, strategy=${STRATEGY})."
  exit 0
fi

PREV_JSON="$(node scripts/deploy/state-manager.mjs begin-rollback \
  --state "$STATE_FILE" \
  --env "$ENV_NAME" \
  --max-rollbacks "$MAX_ROLLBACKS" \
  --reason "$REASON")"

PREV_BACKEND="$(printf '%s' "$PREV_JSON" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.backendImage || '');")"
PREV_FRONTEND="$(printf '%s' "$PREV_JSON" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.frontendImage || '');")"
PREV_NGINX="$(printf '%s' "$PREV_JSON" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.nginxImage || '');")"
PREV_VERSION="$(printf '%s' "$PREV_JSON" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.version || '');")"
PREV_COMMIT="$(printf '%s' "$PREV_JSON" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.commitSha || '');")"
PREV_SLOT="$(printf '%s' "$PREV_JSON" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.slot || 'blue');")"

echo "⏪ [rollback] Đang khôi phục phiên bản ổn định: version=${PREV_VERSION} (${PREV_COMMIT:0:7}), slot=${PREV_SLOT}"

ROLLBACK_OK=true

if [ "$TARGET" = "k8s" ]; then
  if [ "$STRATEGY" = "blue-green" ]; then
    kubectl -n "$K8S_NAMESPACE" patch service core-api \
      -p "{\"spec\":{\"selector\":{\"app.kubernetes.io/name\":\"core-api\",\"slot\":\"${PREV_SLOT}\"}}}" || ROLLBACK_OK=false
  elif [ "$STRATEGY" = "canary" ]; then
    kubectl -n "$K8S_NAMESPACE" scale deployment/core-api-canary --replicas=0 || true
    kubectl -n "$K8S_NAMESPACE" annotate ingress core-api-canary \
      nginx.ingress.kubernetes.io/canary-weight="0" --overwrite || true
  else
    kubectl -n "$K8S_NAMESPACE" rollout undo deployment/core-api || ROLLBACK_OK=false
    kubectl -n "$K8S_NAMESPACE" rollout undo deployment/core-worker || true
    kubectl -n "$K8S_NAMESPACE" rollout undo deployment/core-scheduler || true
    kubectl -n "$K8S_NAMESPACE" rollout status deployment/core-api --timeout=180s || ROLLBACK_OK=false
  fi
else
  export BACKEND_IMAGE="$PREV_BACKEND"
  export FRONTEND_IMAGE="$PREV_FRONTEND"
  export NGINX_IMAGE="$PREV_NGINX"
  export APP_VERSION="$PREV_VERSION"
  export APP_GIT_COMMIT="$PREV_COMMIT"
  export APP_DEPLOY_STRATEGY="rollback"
  export APP_DEPLOY_SLOT="$PREV_SLOT"

  if [ "$STRATEGY" = "blue-green" ]; then
    cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend-${PREV_SLOT}:3005;
    keepalive 32;
}
EOF
    docker compose -f docker-compose.deploy.yml -f docker-compose.bluegreen.yml --profile "$PREV_SLOT" up -d "backend-${PREV_SLOT}" || ROLLBACK_OK=false
    docker exec "${NGINX_CONTAINER_NAME:-core-nginx-prod}" sh -c "nginx -t && nginx -s reload" || ROLLBACK_OK=false
  elif [ "$STRATEGY" = "canary" ]; then
    cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend:3005;
    keepalive 32;
}
EOF
    docker exec "${NGINX_CONTAINER_NAME:-core-nginx-prod}" sh -c "nginx -t && nginx -s reload" || ROLLBACK_OK=false
    docker compose -f docker-compose.deploy.yml -f docker-compose.bluegreen.yml --profile canary stop backend-canary || true
  else
    docker compose -f docker-compose.deploy.yml up -d --no-build backend worker scheduler frontend nginx || ROLLBACK_OK=false
  fi
fi

# Kiểm chứng health sau rollback (KHÔNG gọi lại rollback nếu lỗi -> chống lặp tuyệt đối)
if [ "$ROLLBACK_OK" = true ]; then
  if ! node scripts/deploy/smoke-test.mjs \
    --base-url "$BASE_URL" \
    --wait-timeout-ms 45000 \
    --skip-frontend; then
    ROLLBACK_OK=false
  fi
fi

if [ "$ROLLBACK_OK" = true ]; then
  node scripts/deploy/state-manager.mjs finish-rollback \
    --state "$STATE_FILE" \
    --env "$ENV_NAME" \
    --succeeded true
  echo "✅ [rollback] Khôi phục thành công về version=${PREV_VERSION} (${PREV_COMMIT:0:7})."
  exit 0
else
  node scripts/deploy/state-manager.mjs finish-rollback \
    --state "$STATE_FILE" \
    --env "$ENV_NAME" \
    --succeeded false \
    --error "Post-rollback health check failed"
  echo "❌ [rollback] Khôi phục thất bại! Dừng tự động rollback để tránh vòng lặp — cần xử lý sự cố thủ công." >&2
  exit 1
fi
