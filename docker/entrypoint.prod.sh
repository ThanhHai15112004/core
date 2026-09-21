#!/bin/sh
set -e

echo "🚀 [Core App] Khởi động Container môi trường Production..."

# Chạy backend Fastify
exec node /app/backend/dist/apps/api/main.js
