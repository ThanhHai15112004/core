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
  "scripts/ci/validate-configs.sh"
)

for script in "${SHELL_SCRIPTS[@]}"; do
  if [ -f "$script" ]; then
    bash -n "$script"
    echo "  ✓ $script: OK"
  fi
done

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
else
  echo "ℹ️  [validate-configs] Bỏ qua bước kiểm tra Docker Compose (môi trường hiện tại không cài docker compose)."
fi

echo "✓ [validate-configs] Hoàn tất kiểm tra cấu hình hạ tầng."

