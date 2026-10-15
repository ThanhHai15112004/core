#!/bin/sh
set -e

# RUNTIME: api | worker | scheduler (mặc định api)
RUNTIME="${RUNTIME:-api}"

# Đảm bảo dependencies đã có và tự động đồng bộ khi package.json thay đổi
PKG_HASH_FILE="/app/backend/node_modules/.package_json_hash"
CURRENT_HASH=$(md5sum /app/backend/package.json 2>/dev/null | cut -d' ' -f1 || echo "")
SAVED_HASH=$(cat "$PKG_HASH_FILE" 2>/dev/null || echo "")

if [ ! -d "/app/backend/node_modules/@nestjs" ] || [ "$CURRENT_HASH" != "$SAVED_HASH" ]; then
  echo "📦 [Core Backend] Đang cài đặt/cập nhật dependencies..."
  npm install
  echo "$CURRENT_HASH" > "$PKG_HASH_FILE"
fi

if [ "$RUNTIME" = "api" ]; then
  echo "🚀 [Core Backend] API runtime (:3005) — tsc watch (incremental) + dev-runner"
  # Runner chạy làm PID 1 để nhận trực tiếp SIGTERM/SIGINT; build không xoá dist,
  # sau mỗi build ghi dist/.build-stamp và tự khởi động lại API khi crash.
  exec node scripts/dev-runner.mjs --name api --build --entry dist/apps/api/main.js
fi

# Worker/Scheduler dùng chung thư mục dist do container API build (bind mount),
# chỉ khởi động lại khi API ghi dist/.build-stamp (1 lần/build) — không phản ứng với
# từng file đang ghi dở; tự khởi động lại khi crash.
ENTRY="dist/apps/$RUNTIME/main.js"
echo "🚀 [Core Backend] $RUNTIME runtime — dev-runner (theo dõi dist/.build-stamp)"
exec node scripts/dev-runner.mjs --name "$RUNTIME" --entry "$ENTRY"
