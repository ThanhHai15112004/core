#!/bin/sh
set -e

echo "🚀 [Core Backend] Khởi động Backend Fastify API Server (:3005)..."

# Đảm bảo dependencies đã có trong anonymous volume
if [ ! -d "/app/backend/node_modules/@nestjs" ]; then
  echo "📦 [Core Backend] Đang cài đặt dependencies..."
  npm install
fi

# Chạy Backend Fastify API Server làm PID 1 (nhận trực tiếp tín hiệu SIGTERM/SIGINT)
exec npm run dev:api
