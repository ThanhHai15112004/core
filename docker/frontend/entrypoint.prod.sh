#!/bin/sh
set -eu

TARGET_DIR="${FRONTEND_DIST_DIR:-/var/www/frontend}"
SOURCE_DIR="/app/dist"

echo "📦 [Core Frontend] Đồng bộ bundle tĩnh sang ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"
cp -rf "${SOURCE_DIR}"/* "${TARGET_DIR}/"

# Escape ký tự đặc biệt JSON bằng POSIX sh/sed để không cần cài jq/node trong Alpine
json_escape() {
  printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

API_BASE_URL="$(json_escape "${RUNTIME_API_BASE_URL:-${VITE_API_BASE_URL:-/api/v1}}")"
APP_NAME_VAL="$(json_escape "${RUNTIME_APP_NAME:-${APP_NAME:-Core Framework}}")"
APP_ENV_VAL="$(json_escape "${RUNTIME_APP_ENV:-${NODE_ENV:-production}}")"
APP_VERSION_VAL="$(json_escape "${APP_VERSION:-1.0.0}")"
APP_COMMIT_VAL="$(json_escape "${APP_GIT_COMMIT:-}")"
APP_BUILD_TIME_VAL="$(json_escape "${APP_BUILD_TIME:-}")"
API_TIMEOUT_VAL="${RUNTIME_API_TIMEOUT_MS:-${VITE_API_TIMEOUT_MS:-15000}}"
UPLOAD_TIMEOUT_VAL="${RUNTIME_UPLOAD_TIMEOUT_MS:-${VITE_UPLOAD_TIMEOUT_MS:-300000}}"

# Đảm bảo giá trị timeout là số dương hợp lệ
case "${API_TIMEOUT_VAL}" in
  ''|*[!0-9]*) API_TIMEOUT_VAL="15000" ;;
esac
case "${UPLOAD_TIMEOUT_VAL}" in
  ''|*[!0-9]*) UPLOAD_TIMEOUT_VAL="300000" ;;
esac

# Tạo runtime config (Build-once, deploy-anywhere: không cần rebuild giữa Staging & Production)
cat > "${TARGET_DIR}/env-config.js" <<EOF
window.__CORE_RUNTIME_CONFIG__ = Object.freeze({
  appName: "${APP_NAME_VAL}",
  version: "${APP_VERSION_VAL}",
  environment: "${APP_ENV_VAL}",
  commit: "${APP_COMMIT_VAL}",
  buildTime: "${APP_BUILD_TIME_VAL}",
  apiBaseUrl: "${API_BASE_URL}",
  apiTimeoutMs: ${API_TIMEOUT_VAL},
  uploadTimeoutMs: ${UPLOAD_TIMEOUT_VAL}
});
EOF

echo "✅ [Core Frontend] Đồng bộ hoàn tất (env=${APP_ENV_VAL}, version=${APP_VERSION_VAL}, api=${API_BASE_URL})."

if [ "${FRONTEND_SYNC_ONCE:-false}" = "true" ]; then
  exit 0
fi

exec tail -f /dev/null
