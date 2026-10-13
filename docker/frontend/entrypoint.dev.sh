#!/bin/sh
set -e

echo "🎨 [Core Frontend] Khởi động Frontend React Vite Server (:5175)..."

# Đảm bảo dependencies đã có và tự động đồng bộ khi package.json thay đổi
PKG_HASH_FILE="/app/frontend/node_modules/.package_json_hash"
CURRENT_HASH=$(md5sum /app/frontend/package.json 2>/dev/null | cut -d' ' -f1 || echo "")
SAVED_HASH=$(cat "$PKG_HASH_FILE" 2>/dev/null || echo "")

if [ ! -d "/app/frontend/node_modules/vite" ] || [ "$CURRENT_HASH" != "$SAVED_HASH" ]; then
  echo "📦 [Core Frontend] Đang cài đặt/cập nhật dependencies..."
  npm install
  echo "$CURRENT_HASH" > "$PKG_HASH_FILE"
fi

# Chạy Frontend React Vite Server làm PID 1 (nhận trực tiếp tín hiệu SIGTERM/SIGINT)
NODE_OPTIONS="--max-old-space-size=512" exec npm run dev
