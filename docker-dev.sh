#!/usr/bin/env bash
set -e

COMPOSE_FILES="-p core-framework -f docker-compose.dev.yml"
ENV_FILE=".env.docker.dev"

# Đảm bảo file cấu hình môi trường development tồn tại
check_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f ".env.docker.dev.example" ]; then
      echo "📋 Chưa có [$ENV_FILE], đang khởi tạo từ [.env.docker.dev.example]..."
      cp .env.docker.dev.example "$ENV_FILE"
    else
      echo "❌ Lỗi: Thiếu cả [$ENV_FILE] và [.env.docker.dev.example]."
      exit 1
    fi
  fi
}

SERVICE="${2:-}"

case "$1" in
  up)
    check_env_file
    if [ -n "$SERVICE" ]; then
      echo "🚀 Đang khởi động service [$SERVICE]..."
      docker compose $COMPOSE_FILES up -d --build "$SERVICE"
    else
      echo "🚀 Đang khởi động toàn bộ Core Framework Development (BE Fastify :3005 + FE Vite :5175)..."
      docker compose $COMPOSE_FILES up -d --build backend worker scheduler frontend prometheus
      echo ""
      echo "✅ Các container đã sẵn sàng:"
      echo "   👉 Backend API (core-backend-dev):   http://localhost:3005/api/v1"
      echo "   👉 Frontend UI (core-frontend-dev):  http://localhost:5175"
      echo "   👉 Ops Registry:                     http://localhost:3005/api/v1/ops/packages"
      echo ""
      echo "Xem log với:   ./docker-dev.sh logs [backend|worker|scheduler|frontend]"
      echo "Smoke test:    ./docker-dev.sh smoke"
    fi
    ;;
  build)
    check_env_file
    if [ -n "$SERVICE" ]; then
      echo "🔨 Đang build service [$SERVICE]..."
      docker compose $COMPOSE_FILES build "$SERVICE"
    else
      echo "🔨 Đang build toàn bộ services..."
      docker compose $COMPOSE_FILES build
    fi
    ;;
  down)
    echo "🛑 Đang gỡ bỏ toàn bộ Core App Development Containers..."
    docker compose $COMPOSE_FILES down
    ;;
  stop)
    echo "⏸️ Đang tạm dừng toàn bộ Core App Development Containers..."
    docker compose $COMPOSE_FILES stop backend worker scheduler frontend prometheus
    ;;
  start)
    echo "▶️ Đang tiếp tục chạy toàn bộ Core App Development Containers..."
    docker compose $COMPOSE_FILES start backend worker scheduler frontend prometheus
    ;;
  logs)
    if [ -n "$SERVICE" ]; then
      docker compose $COMPOSE_FILES logs -f "$SERVICE"
    else
      docker compose $COMPOSE_FILES logs -f
    fi
    ;;
  restart)
    if [ -n "$SERVICE" ]; then
      echo "🔄 Đang khởi động lại service [$SERVICE]..."
      docker compose $COMPOSE_FILES restart "$SERVICE"
    else
      echo "🔄 Đang khởi động lại toàn bộ containers..."
      docker compose $COMPOSE_FILES restart
    fi
    ;;
  ps)
    docker compose $COMPOSE_FILES ps
    ;;
  smoke)
    bash ./docker/smoke-test.sh dev
    ;;
  bash)
    TARGET="${SERVICE:-backend}"
    echo "🐚 Đang kết nối bash shell vào container [$TARGET]..."
    docker compose $COMPOSE_FILES exec "$TARGET" bash
    ;;
  config)
    check_env_file
    docker compose $COMPOSE_FILES config
    ;;
  *)
    echo "Cách dùng: ./docker-dev.sh {up|down|build|stop|start|logs|restart|ps|smoke|bash|config} [backend|worker|scheduler|frontend]"
    echo ""
    echo "Ví dụ:"
    echo "  ./docker-dev.sh up                  # Khởi động api, worker, scheduler, frontend, prometheus"
    echo "  ./docker-dev.sh smoke               # Chạy smoke test kiểm tra sức khỏe toàn bộ container"
    echo "  ./docker-dev.sh build               # Build lại toàn bộ images"
    echo "  ./docker-dev.sh build frontend      # Chỉ build image frontend"
    echo "  ./docker-dev.sh up backend          # Chỉ khởi động backend"
    echo "  ./docker-dev.sh logs backend        # Xem log backend"
    echo "  ./docker-dev.sh bash frontend       # Vào shell của frontend"
    exit 1
    ;;
esac
