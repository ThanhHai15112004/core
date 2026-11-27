#!/usr/bin/env bash
# ==============================================================================
# Phase 15.4 — Safe Database Migration Runner
#
# Thực thi chuỗi kiểm tra và triển khai Migration an toàn:
#   1. Preflight Check (Syntax, Dependency, Checksum, Expand-and-Contract, Lock Risk)
#   2. Safe Deploy (Approval Gate + Conditional Backup Gate + Dual Lock + lock_timeout)
#   3. Post-Migration Verification (Schema, Data, Application Health)
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_NAME="${DEPLOY_ENV:-staging}"
RELEASE_VERSION="${APP_VERSION:-1.0.0}"
GIT_COMMIT="${APP_GIT_COMMIT:-}"
APPROVED_BY="${DB_APPROVED_BY:-}"
APPROVAL_TICKET="${DB_APPROVAL_TICKET:-}"
ACTOR="${DB_DEPLOY_ACTOR:-ci-deploy}"
LOCK_TIMEOUT_MS="${DB_MIGRATION_LOCK_TIMEOUT_MS:-5000}"
HEALTH_URL="${DB_POST_CHECK_HEALTH_URL:-}"
TARGET="${DB_MIGRATE_TARGET:-host}"
CONTAINER_NAME="${DB_MIGRATE_CONTAINER:-core-backend-prod}"
K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
K8S_DEPLOYMENT="${DB_MIGRATE_K8S_DEPLOYMENT:-deployment/core-api}"
AUTO_BACKUP=false
ALLOW_BREAKING=false
SKIP_BACKUP_CHECK=false
STRICT_PREFLIGHT=false
DRY_RUN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --release) RELEASE_VERSION="$2"; shift 2 ;;
    --commit) GIT_COMMIT="$2"; shift 2 ;;
    --approved-by) APPROVED_BY="$2"; shift 2 ;;
    --ticket) APPROVAL_TICKET="$2"; shift 2 ;;
    --actor) ACTOR="$2"; shift 2 ;;
    --lock-timeout-ms) LOCK_TIMEOUT_MS="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --container) CONTAINER_NAME="$2"; shift 2 ;;
    --namespace) K8S_NAMESPACE="$2"; shift 2 ;;
    --auto-backup) AUTO_BACKUP=true; shift ;;
    --allow-breaking) ALLOW_BREAKING=true; shift ;;
    --skip-backup-check) SKIP_BACKUP_CHECK=true; shift ;;
    --strict) STRICT_PREFLIGHT=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$TARGET" in
  host|compose|k8s) ;;
  *) echo "✗ Invalid target: $TARGET (expected host | compose | k8s)" >&2; exit 1 ;;
esac

mkdir -p reports

run_cli() {
  case "$TARGET" in
    host)
      NODE_ENV="$ENV_NAME" npm --prefix backend run cli -- "$@"
      ;;
    compose)
      docker exec -e "NODE_ENV=${ENV_NAME}" "$CONTAINER_NAME" node dist/apps/cli/main.js "$@"
      ;;
    k8s)
      kubectl -n "$K8S_NAMESPACE" exec "$K8S_DEPLOYMENT" -- env "NODE_ENV=${ENV_NAME}" node dist/apps/cli/main.js "$@"
      ;;
  esac
}

echo "🔎 [db-migrate] 1/3 Preflight check (env=${ENV_NAME}, target=${TARGET})..."
PREFLIGHT_ARGS=(migration:preflight --json)
if [ "$STRICT_PREFLIGHT" = true ]; then
  PREFLIGHT_ARGS+=(--strict)
fi
if [ "$DRY_RUN" = true ] && [ "$TARGET" = "host" ] && [ "${DB_ENABLED:-true}" = "false" ]; then
  PREFLIGHT_ARGS+=(--offline)
fi

PREFLIGHT_OUT="reports/db-preflight-${ENV_NAME}.json"
run_cli "${PREFLIGHT_ARGS[@]}" > "$PREFLIGHT_OUT"
echo "  ✓ Preflight passed -> ${PREFLIGHT_OUT}"

DEPLOY_ARGS=(
  migration:deploy
  "--release=${RELEASE_VERSION}"
  "--actor=${ACTOR}"
  "--lock-timeout-ms=${LOCK_TIMEOUT_MS}"
  --json
)
if [ -n "$GIT_COMMIT" ]; then
  DEPLOY_ARGS+=("--commit=${GIT_COMMIT}")
fi
if [ -n "$APPROVED_BY" ]; then
  DEPLOY_ARGS+=("--approved-by=${APPROVED_BY}")
fi
if [ -n "$APPROVAL_TICKET" ]; then
  DEPLOY_ARGS+=("--ticket=${APPROVAL_TICKET}")
fi
if [ "$AUTO_BACKUP" = true ]; then
  DEPLOY_ARGS+=(--auto-backup)
fi
if [ "$ALLOW_BREAKING" = true ]; then
  DEPLOY_ARGS+=(--allow-breaking)
fi
if [ "$SKIP_BACKUP_CHECK" = true ]; then
  DEPLOY_ARGS+=(--skip-backup-check)
fi
if [ "$STRICT_PREFLIGHT" = true ]; then
  DEPLOY_ARGS+=(--strict)
fi
if [ -n "$HEALTH_URL" ]; then
  DEPLOY_ARGS+=("--health-url=${HEALTH_URL}")
fi
if [ "$DRY_RUN" = true ]; then
  DEPLOY_ARGS+=(--dry-run)
fi

if [ "$DRY_RUN" = true ] && [ "${DB_ENABLED:-true}" = "false" ]; then
  echo "ℹ️  [db-migrate] DRY-RUN (DB_ENABLED=false): bỏ qua bước thực thi trực tiếp lên DB."
  exit 0
fi

echo "🛡️  [db-migrate] 2/3 Safe Migration Deploy (Dual Lock + Backup Gate + Rollout History)..."
DEPLOY_OUT="reports/db-migration-deploy-${ENV_NAME}.json"
run_cli "${DEPLOY_ARGS[@]}" > "$DEPLOY_OUT"
echo "  ✓ Migration deploy recorded -> ${DEPLOY_OUT}"

if [ "$DRY_RUN" = false ]; then
  echo "🧪 [db-migrate] 3/3 Post-Migration Verification..."
  VERIFY_ARGS=(migration:verify --json)
  if [ -n "$HEALTH_URL" ]; then
    VERIFY_ARGS+=("--health-url=${HEALTH_URL}")
  fi
  run_cli "${VERIFY_ARGS[@]}" > "reports/db-post-check-${ENV_NAME}.json"
  echo "  ✓ Post-migration verification passed."
fi
