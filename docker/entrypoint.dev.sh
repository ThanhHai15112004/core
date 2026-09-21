#!/bin/sh
set -e

echo "🚀 [Core App] Khởi động Container môi trường Development (BE Fastify :3005 + FE Vite :5175)..."

# Đảm bảo dependencies đã có trong anonymous volume
if [ ! -d "/app/backend/node_modules/@nestjs" ]; then
  echo "📦 [Core App] Đang cài đặt dependencies cho Backend..."
  npm --prefix /app/backend install
fi

if [ ! -d "/app/frontend/node_modules/vite" ]; then
  echo "📦 [Core App] Đang cài đặt dependencies cho Frontend..."
  npm --prefix /app/frontend install
fi

# Khởi động Backend Fastify API (port 3005)
echo "⚡ [Core App] Bật Backend API Server (port 3005)..."
npm --prefix /app/backend run dev:api &
BACKEND_PID=$!

# Khởi động Frontend React Vite (port 5175)
echo "🎨 [Core App] Bật Frontend Vite Server (port 5175)..."
npm --prefix /app/frontend run dev &
FRONTEND_PID=$!

# Quản lý tắt an toàn
cleanup() {
  echo "🛑 [Core App] Đang dừng Backend (PID: $BACKEND_PID) và Frontend (PID: $FRONTEND_PID)..."
  kill -TERM "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM

# Đợi các tiến trình
wait -n "$BACKEND_PID" "$FRONTEND_PID"
