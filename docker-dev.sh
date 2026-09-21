#!/usr/bin/env bash
set -e

COMPOSE_FILES="-p core-framework -f docker-compose.yml -f docker-compose.dev.yml"

case "$1" in
  up)
    echo "🚀 Đang khởi động Core Framework Development Container (BE Fastify :3005 + FE Vite :5175)..."
    docker compose $COMPOSE_FILES up -d --build
    echo ""
    echo "✅ Container [core-framework-dev] đã sẵn sàng:"
    echo "   👉 Backend API:  http://localhost:3005/api/v1"
    echo "   👉 Frontend UI:  http://localhost:5175"
    echo "   👉 Ops Registry: http://localhost:3005/api/v1/ops/packages"
    echo ""
    echo "Xem log với: ./docker-dev.sh logs"
    ;;
  down)
    echo "🛑 Đang dừng Core App Development Container..."
    docker compose $COMPOSE_FILES down
    ;;
  logs)
    docker compose $COMPOSE_FILES logs -f
    ;;
  restart)
    echo "🔄 Đang khởi động lại Core App Development Container..."
    docker compose $COMPOSE_FILES restart
    ;;
  ps)
    docker compose $COMPOSE_FILES ps
    ;;
  bash)
    docker compose $COMPOSE_FILES exec app bash
    ;;
  config)
    docker compose $COMPOSE_FILES config
    ;;
  *)
    echo "Cách dùng: ./docker-dev.sh {up|down|logs|restart|ps|bash|config}"
    exit 1
    ;;
esac
