#!/bin/sh
set -e

echo "🎨 [Core Frontend] Khởi động Frontend React Vite Server (:5175)..."

# Đảm bảo dependencies đã có trong anonymous volume
if [ ! -d "/app/frontend/node_modules/vite" ]; then
  echo "📦 [Core Frontend] Đang cài đặt dependencies..."
  npm install
fi

# Chạy Frontend React Vite Server làm PID 1 (nhận trực tiếp tín hiệu SIGTERM/SIGINT)
NODE_OPTIONS="--max-old-space-size=256" exec npm run dev
