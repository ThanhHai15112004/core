#!/bin/sh
set -e

# RUNTIME: api | worker | scheduler (mặc định api)
RUNTIME="${RUNTIME:-api}"

# Đảm bảo dependencies đã có trong anonymous volume
if [ ! -d "/app/backend/node_modules/@nestjs" ]; then
  echo "📦 [Core Backend] Đang cài đặt dependencies..."
  npm install
fi

if [ "$RUNTIME" = "api" ]; then
  echo "🚀 [Core Backend] API runtime (:3005) — build + watch"
  # Chạy làm PID 1 để nhận trực tiếp SIGTERM/SIGINT
  exec npm run dev:api
fi

# Worker/Scheduler dùng chung thư mục dist do container API build (bind mount),
# chỉ tự khởi động lại khi dist thay đổi — tránh nhiều container cùng xoá/ghi dist.
ENTRY="dist/apps/$RUNTIME/main.js"
echo "⏳ [Core Backend] $RUNTIME runtime: chờ $ENTRY ..."
until [ -f "$ENTRY" ]; do sleep 2; done
echo "🚀 [Core Backend] $RUNTIME runtime started"
exec node --watch-path=dist "$ENTRY"
