#!/usr/bin/env bash
# ==============================================================================
# Kiểm tra cú pháp Shell Scripts & Cấu hình Docker Compose (Configuration Gate)
# Dùng chung cho Local, GitHub Actions và GitLab CI
# ==============================================================================
set -euo pipefail

echo "🔍 [validate-configs] 1. Kiểm tra cú pháp các tệp Shell Script (bash -n)..."
SHELL_SCRIPTS=(
  "docker-dev.sh"
  "docker-prod.sh"
  "deploy/setup-vps.sh"
  "docker/smoke-test.sh"
  "docker/entrypoint.prod.sh"
  "docker/backend/entrypoint.dev.sh"
  "docker/frontend/entrypoint.dev.sh"
  "docker/frontend/entrypoint.prod.sh"
  "scripts/ci/validate-configs.sh"
  "scripts/security/scan-docker-images.sh"
  "scripts/deploy/build-release.sh"
  "scripts/deploy/deploy.sh"
  "scripts/deploy/rollback.sh"
)

for script in "${SHELL_SCRIPTS[@]}"; do
  if [ -f "$script" ]; then
    bash -n "$script"
    echo "  ✓ $script: OK"
  fi
done

if command -v node >/dev/null 2>&1; then
  echo "🔍 [validate-configs] 1b. Kiểm tra cú pháp các tệp CI & Security Node scripts (node --check)..."
  CI_NODE_SCRIPTS=(
    "scripts/ci/guard-diff.mjs"
    "scripts/ci/check-lockfiles.mjs"
    "scripts/ci/check-api-changes.mjs"
    "scripts/ci/ci-report.mjs"
    "scripts/ci/collect-ci-findings.mjs"
    "scripts/ci/xlsx-writer.mjs"
    "scripts/security/common.mjs"
    "scripts/security/scan-secrets.mjs"
    "scripts/security/scan-dependencies.mjs"
    "scripts/security/scan-sast.mjs"
    "scripts/security/scan-iac.mjs"
    "scripts/security/check-licenses.mjs"
    "scripts/security/generate-sbom.mjs"
    "scripts/security/run-dast.mjs"
    "scripts/security/run-all.mjs"
    "scripts/deploy/release-manifest.mjs"
    "scripts/deploy/state-manager.mjs"
    "scripts/deploy/smoke-test.mjs"
    "scripts/deploy/prune-registry.mjs"
  )
  for node_script in "${CI_NODE_SCRIPTS[@]}"; do
    if [ -f "$node_script" ]; then
      node --check "$node_script"
      echo "  ✓ $node_script: OK"
    fi
  done
  if [ -f "scripts/security/security-policy.json" ]; then
    node -e "JSON.parse(require('node:fs').readFileSync('scripts/security/security-policy.json','utf8'))"
    echo "  ✓ scripts/security/security-policy.json: OK"
  fi
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "🔍 [validate-configs] 2. Kiểm tra tính hợp lệ của các tệp Docker Compose..."

  CREATED_DEV_ENV=false
  CREATED_PROD_ENV=false

  cleanup_temp_env() {
    if [ "$CREATED_DEV_ENV" = true ] && [ -f ".env.docker.dev" ]; then
      rm -f ".env.docker.dev"
    fi
    if [ "$CREATED_PROD_ENV" = true ] && [ -f ".env.docker.prod" ]; then
      rm -f ".env.docker.prod"
    fi
  }
  trap cleanup_temp_env EXIT

  if [ ! -f ".env.docker.dev" ] && [ -f ".env.docker.dev.example" ]; then
    cp ".env.docker.dev.example" ".env.docker.dev"
    CREATED_DEV_ENV=true
  fi

  if [ ! -f ".env.docker.prod" ] && [ -f ".env.docker.prod.example" ]; then
    cp ".env.docker.prod.example" ".env.docker.prod"
    CREATED_PROD_ENV=true
  fi

  docker compose -f docker-compose.yml config --quiet
  echo "  ✓ docker-compose.yml: OK"

  docker compose -f docker-compose.dev.yml config --quiet
  echo "  ✓ docker-compose.dev.yml: OK"

  docker compose -f docker-compose.prod.yml config --quiet
  echo "  ✓ docker-compose.prod.yml: OK"

  BACKEND_IMAGE=ghcr.io/core/core-backend:1.0.0 \
  FRONTEND_IMAGE=ghcr.io/core/core-frontend:1.0.0 \
  NGINX_IMAGE=ghcr.io/core/core-nginx:1.0.0 \
  docker compose -f docker-compose.deploy.yml config --quiet
  echo "  ✓ docker-compose.deploy.yml: OK"

  BACKEND_IMAGE=ghcr.io/core/core-backend:1.0.0 \
  FRONTEND_IMAGE=ghcr.io/core/core-frontend:1.0.0 \
  NGINX_IMAGE=ghcr.io/core/core-nginx:1.0.0 \
  docker compose -f docker-compose.deploy.yml -f docker-compose.bluegreen.yml --profile blue-green --profile canary config --quiet
  echo "  ✓ docker-compose.bluegreen.yml: OK"
else
  echo "ℹ️  [validate-configs] Bỏ qua bước kiểm tra Docker Compose (môi trường hiện tại không cài docker compose)."
fi

echo "✓ [validate-configs] Hoàn tất kiểm tra cấu hình hạ tầng."

