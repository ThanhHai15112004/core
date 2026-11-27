#!/usr/bin/env bash
# ==============================================================================
# Phase 15.3 — Build-Once Deploy Orchestrator (Rolling | Blue-Green | Canary)
#
# Triển khai từ `release-manifest.json` đã build sẵn (không build lại image),
# chạy post-deploy smoke test (health, version/SHA, login, chức năng chính) và
# tự động rollback có giới hạn chống lặp khi kiểm tra thất bại.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_NAME="${DEPLOY_ENV:-staging}"
MANIFEST_PATH="${RELEASE_MANIFEST:-reports/release-manifest.json}"
STRATEGY="${DEPLOY_STRATEGY:-rolling}"
TARGET="${DEPLOY_TARGET:-compose}"
BASE_URL="${DEPLOY_BASE_URL:-http://127.0.0.1}"
STATE_FILE="${DEPLOY_STATE_FILE:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
CANARY_STEPS_STR="${CANARY_STEPS:-10 50 100}"
CANARY_SOAK_SEC="${CANARY_SOAK_SEC:-30}"
MAX_ROLLBACKS="${MAX_ROLLBACK_ATTEMPTS:-2}"
UPSTREAM_FILE="${NGINX_UPSTREAM_FILE:-docker/nginx/upstreams/backend.conf}"
AUTO_ROLLBACK=true
DRY_RUN=false
REQUIRE_DIGEST=false
RUN_MIGRATIONS=false
DB_APPROVED_BY="${DB_APPROVED_BY:-}"
DB_APPROVAL_TICKET="${DB_APPROVAL_TICKET:-}"
DB_AUTO_BACKUP=false
DB_LOCK_TIMEOUT_MS="${DB_MIGRATION_LOCK_TIMEOUT_MS:-5000}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --manifest) MANIFEST_PATH="$2"; shift 2 ;;
    --strategy) STRATEGY="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --namespace) K8S_NAMESPACE="$2"; shift 2 ;;
    --no-auto-rollback) AUTO_ROLLBACK=false; shift ;;
    --require-digest) REQUIRE_DIGEST=true; shift ;;
    --run-migrations) RUN_MIGRATIONS=true; shift ;;
    --db-approved-by) DB_APPROVED_BY="$2"; shift 2 ;;
    --db-approval-ticket) DB_APPROVAL_TICKET="$2"; shift 2 ;;
    --db-auto-backup) DB_AUTO_BACKUP=true; shift ;;
    --db-lock-timeout-ms) DB_LOCK_TIMEOUT_MS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$STATE_FILE" ]; then
  STATE_FILE=".deploy/${ENV_NAME}-state.json"
fi

if [ "$ENV_NAME" = "production" ]; then
  REQUIRE_DIGEST=true
fi

case "$STRATEGY" in
  rolling|blue-green|canary) ;;
  *) echo "✗ Invalid strategy: $STRATEGY (expected rolling | blue-green | canary)" >&2; exit 1 ;;
esac

case "$TARGET" in
  compose|k8s) ;;
  *) echo "✗ Invalid target: $TARGET (expected compose | k8s)" >&2; exit 1 ;;
esac

# 1. Xác thực & nạp biến môi trường từ release-manifest.json (Build-Once)
MANIFEST_FLAGS=()
if [ "$REQUIRE_DIGEST" = true ]; then
  MANIFEST_FLAGS+=(--require-digest)
fi

echo "📦 [deploy] Xác thực release manifest: ${MANIFEST_PATH} (env=${ENV_NAME}, strategy=${STRATEGY}, target=${TARGET})"
node scripts/deploy/release-manifest.mjs --validate "$MANIFEST_PATH" "${MANIFEST_FLAGS[@]}"
eval "$(node scripts/deploy/release-manifest.mjs --to-env "$MANIFEST_PATH" "${MANIFEST_FLAGS[@]}")"

export NODE_ENV="$ENV_NAME"
export APP_DEPLOY_STRATEGY="$STRATEGY"
DEPLOY_SLOT="default"

if [ "$STRATEGY" = "blue-green" ]; then
  DEPLOY_SLOT="$(node scripts/deploy/state-manager.mjs next-slot --state "$STATE_FILE" --env "$ENV_NAME")"
fi
export APP_DEPLOY_SLOT="$DEPLOY_SLOT"

echo "🚀 [deploy] Kế hoạch triển khai:"
echo "  • Environment : ${ENV_NAME}"
echo "  • Version     : ${APP_VERSION} (commit ${APP_GIT_COMMIT:0:7})"
echo "  • Strategy    : ${STRATEGY} (slot=${DEPLOY_SLOT}, target=${TARGET})"
echo "  • Backend     : ${BACKEND_IMAGE}"
echo "  • Frontend    : ${FRONTEND_IMAGE}"
echo "  • Nginx       : ${NGINX_IMAGE}"

if [ "$DRY_RUN" = true ]; then
  echo "✅ [deploy] DRY-RUN hoàn tất — không tác động tới hạ tầng."
  exit 0
fi

trigger_auto_rollback() {
  local reason="$1"
  if [ "$AUTO_ROLLBACK" != true ]; then
    echo "⚠️  [deploy] Auto-rollback bị tắt (--no-auto-rollback). Lý do lỗi: ${reason}" >&2
    return 1
  fi
  echo "⚠️  [deploy] Triển khai lỗi (${reason}) -> kích hoạt Auto-Rollback..." >&2
  bash scripts/deploy/rollback.sh \
    --env "$ENV_NAME" \
    --target "$TARGET" \
    --strategy "$STRATEGY" \
    --state-file "$STATE_FILE" \
    --base-url "$BASE_URL" \
    --namespace "$K8S_NAMESPACE" \
    --max-rollbacks "$MAX_ROLLBACKS" \
    --reason "$reason" || true
  return 1
}

run_smoke() {
  local report_path="reports/deploy-smoke-${ENV_NAME}.json"
  local extra_flags=()
  if [ -n "${SMOKE_AUTH_IDENTIFIER:-}" ] && [ -n "${SMOKE_AUTH_PASSWORD:-}" ]; then
    extra_flags+=(--require-auth)
  fi
  node scripts/deploy/smoke-test.mjs \
    --base-url "$BASE_URL" \
    --expected-commit "$APP_GIT_COMMIT" \
    --expected-version "$APP_VERSION" \
    --report "$report_path" \
    "${extra_flags[@]}"
}

# 1b. Safe Database Migration (Expand Phase trước khi rollout phiên bản mới)
if [ "$RUN_MIGRATIONS" = true ]; then
  MIGRATE_FLAGS=(
    --env "$ENV_NAME"
    --release "$APP_VERSION"
    --commit "$APP_GIT_COMMIT"
    --target "$TARGET"
    --namespace "$K8S_NAMESPACE"
    --lock-timeout-ms "$DB_LOCK_TIMEOUT_MS"
  )
  if [ -n "$DB_APPROVED_BY" ]; then
    MIGRATE_FLAGS+=(--approved-by "$DB_APPROVED_BY")
  fi
  if [ -n "$DB_APPROVAL_TICKET" ]; then
    MIGRATE_FLAGS+=(--ticket "$DB_APPROVAL_TICKET")
  fi
  if [ "$DB_AUTO_BACKUP" = true ]; then
    MIGRATE_FLAGS+=(--auto-backup)
  fi
  if [ "$DRY_RUN" = true ]; then
    MIGRATE_FLAGS+=(--dry-run)
  fi
  bash scripts/deploy/migrate-db.sh "${MIGRATE_FLAGS[@]}"
fi

# 2. Thực thi triển khai theo Target & Strategy (không build lại image)
if [ "$TARGET" = "k8s" ]; then
  case "$STRATEGY" in
    rolling)
      kubectl -n "$K8S_NAMESPACE" set image deployment/core-api api="$BACKEND_IMAGE"
      kubectl -n "$K8S_NAMESPACE" set image deployment/core-worker worker="$BACKEND_IMAGE"
      kubectl -n "$K8S_NAMESPACE" set image deployment/core-scheduler scheduler="$BACKEND_IMAGE"
      if ! kubectl -n "$K8S_NAMESPACE" rollout status deployment/core-api --timeout=180s; then
        trigger_auto_rollback "Kubernetes rolling rollout failed for core-api"
        exit 1
      fi
      ;;
    blue-green)
      kubectl -n "$K8S_NAMESPACE" set image "deployment/core-api-${DEPLOY_SLOT}" api="$BACKEND_IMAGE"
      if ! kubectl -n "$K8S_NAMESPACE" rollout status "deployment/core-api-${DEPLOY_SLOT}" --timeout=180s; then
        trigger_auto_rollback "Kubernetes blue-green slot ${DEPLOY_SLOT} failed readiness"
        exit 1
      fi
      kubectl -n "$K8S_NAMESPACE" patch service core-api \
        -p "{\"spec\":{\"selector\":{\"app.kubernetes.io/name\":\"core-api\",\"slot\":\"${DEPLOY_SLOT}\"}}}"
      ;;
    canary)
      kubectl -n "$K8S_NAMESPACE" set image deployment/core-api-canary api="$BACKEND_IMAGE"
      kubectl -n "$K8S_NAMESPACE" scale deployment/core-api-canary --replicas=1
      if ! kubectl -n "$K8S_NAMESPACE" rollout status deployment/core-api-canary --timeout=180s; then
        trigger_auto_rollback "Kubernetes canary pod failed readiness"
        exit 1
      fi
      for weight in $CANARY_STEPS_STR; do
        echo "🐤 [canary] Chuyển ${weight}% traffic sang phiên bản mới..."
        kubectl -n "$K8S_NAMESPACE" annotate ingress core-api-canary \
          nginx.ingress.kubernetes.io/canary-weight="${weight}" --overwrite
        sleep "$CANARY_SOAK_SEC"
        if ! node scripts/deploy/smoke-test.mjs --base-url "$BASE_URL" --wait-timeout-ms 30000 --skip-frontend; then
          trigger_auto_rollback "Canary health check failed at ${weight}%"
          exit 1
        fi
      done
      kubectl -n "$K8S_NAMESPACE" set image deployment/core-api api="$BACKEND_IMAGE"
      kubectl -n "$K8S_NAMESPACE" rollout status deployment/core-api --timeout=180s
      kubectl -n "$K8S_NAMESPACE" scale deployment/core-api-canary --replicas=0
      kubectl -n "$K8S_NAMESPACE" annotate ingress core-api-canary \
        nginx.ingress.kubernetes.io/canary-weight="0" --overwrite
      ;;
  esac
else
  # Docker Compose Target
  docker compose -f docker-compose.deploy.yml pull backend frontend nginx

  case "$STRATEGY" in
    rolling)
      cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend:3005;
    keepalive 32;
}
EOF
      docker compose -f docker-compose.deploy.yml up -d --no-build --wait backend
      docker compose -f docker-compose.deploy.yml up -d --no-build worker scheduler frontend nginx
      ;;
    blue-green)
      export BACKEND_BLUE_IMAGE="$BACKEND_IMAGE"
      export BACKEND_GREEN_IMAGE="$BACKEND_IMAGE"
      if ! docker compose -f docker-compose.deploy.yml -f docker-compose.bluegreen.yml \
        --profile "$DEPLOY_SLOT" up -d --no-build --wait "backend-${DEPLOY_SLOT}"; then
        trigger_auto_rollback "Blue-Green slot ${DEPLOY_SLOT} failed container healthcheck"
        exit 1
      fi
      cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend-${DEPLOY_SLOT}:3005;
    keepalive 32;
}
EOF
      docker compose -f docker-compose.deploy.yml up -d --no-build worker scheduler frontend nginx
      docker exec "${NGINX_CONTAINER_NAME:-core-nginx-prod}" sh -c "nginx -t && nginx -s reload"
      ;;
    canary)
      export BACKEND_CANARY_IMAGE="$BACKEND_IMAGE"
      if ! docker compose -f docker-compose.deploy.yml -f docker-compose.bluegreen.yml \
        --profile canary up -d --no-build --wait backend-canary; then
        trigger_auto_rollback "Canary container failed readiness"
        exit 1
      fi
      for weight in $CANARY_STEPS_STR; do
        stable_weight=$((100 - weight))
        echo "🐤 [canary] Cấu hình Nginx weight: stable=${stable_weight}%, canary=${weight}%..."
        if [ "$stable_weight" -le 0 ]; then
          cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend-canary:3005;
    keepalive 32;
}
EOF
        else
          cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend:3005 weight=${stable_weight};
    server backend-canary:3005 weight=${weight};
    keepalive 32;
}
EOF
        fi
        docker exec "${NGINX_CONTAINER_NAME:-core-nginx-prod}" sh -c "nginx -t && nginx -s reload"
        sleep "$CANARY_SOAK_SEC"
        if ! node scripts/deploy/smoke-test.mjs --base-url "$BASE_URL" --wait-timeout-ms 30000 --skip-frontend; then
          trigger_auto_rollback "Canary smoke check failed at ${weight}%"
          exit 1
        fi
      done
      # Promote canary -> stable backend & clean up canary container
      docker compose -f docker-compose.deploy.yml up -d --no-build --wait backend
      cat > "$UPSTREAM_FILE" <<EOF
upstream backend_upstream {
    server backend:3005;
    keepalive 32;
}
EOF
      docker compose -f docker-compose.deploy.yml up -d --no-build worker scheduler frontend nginx
      docker exec "${NGINX_CONTAINER_NAME:-core-nginx-prod}" sh -c "nginx -t && nginx -s reload"
      docker compose -f docker-compose.deploy.yml -f docker-compose.bluegreen.yml --profile canary stop backend-canary || true
      ;;
  esac
fi

# 3. Post-Deploy Smoke Test (Health, Version/Commit SHA, Frontend, Login & Core APIs)
echo "🧪 [deploy] Chạy Post-Deploy Smoke Test..."
if ! run_smoke; then
  trigger_auto_rollback "Post-deploy smoke test failed for ${APP_VERSION} (${APP_GIT_COMMIT:0:7})"
  exit 1
fi

# 4. Ghi nhận release thành công vào state (đẩy bản cũ thành previous, reset bộ đếm rollback)
node scripts/deploy/state-manager.mjs record-success \
  --state "$STATE_FILE" \
  --env "$ENV_NAME" \
  --version "$APP_VERSION" \
  --commit "$APP_GIT_COMMIT" \
  --backend-image "$BACKEND_IMAGE" \
  --frontend-image "$FRONTEND_IMAGE" \
  --nginx-image "$NGINX_IMAGE" \
  --strategy "$STRATEGY" \
  --slot "$DEPLOY_SLOT"

echo "✅ [deploy] Triển khai ${ENV_NAME} hoàn tất: version=${APP_VERSION}, sha=${APP_GIT_COMMIT:0:7}, strategy=${STRATEGY}"
