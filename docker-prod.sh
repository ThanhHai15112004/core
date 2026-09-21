#!/usr/bin/env bash
# ==============================================================================
# Script Quản Trị Hệ Thống Production (Core Framework 1-Click Deploy)
# ==============================================================================
set -e

COMPOSE_FILE="-f docker-compose.prod.yml"
ENV_FILE=".env.docker.prod"

# Kiểm tra file cấu hình môi trường production
check_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  [Cảnh báo] Chưa tìm thấy tệp cấu hình [$ENV_FILE]!"
    if [ -f ".env.docker.prod.example" ]; then
      echo "📋 Đang sao chép từ [.env.docker.prod.example] -> [$ENV_FILE]..."
      cp .env.docker.prod.example "$ENV_FILE"
      echo "👉 Hãy cập nhật các thông số mật khẩu, domain trong [$ENV_FILE] rồi chạy lại lệnh!"
      exit 1
    else
      echo "❌ Lỗi: Thiếu cả file mẫu [.env.docker.prod.example]."
      exit 1
    fi
  fi
}

SERVICE="${2:-}"

case "$1" in
  up)
    check_env_file
    echo "🚀 Đang khởi động toàn bộ Core Framework Production Stack..."
    docker compose $COMPOSE_FILE up -d --build
    echo ""
    echo "✅ Toàn bộ hệ thống Production đã sẵn sàng:"
    echo "   👉 Nginx Reverse Proxy: Cổng 80 (HTTP) & 443 (HTTPS)"
    echo "   👉 Backend Fastify API: Nội bộ Docker (Backend :3005)"
    echo "   👉 Frontend React SPA:  Được Nginx phục vụ trực tiếp"
    echo ""
    echo "Kiểm tra log với: ./docker-prod.sh logs"
    ;;

  down)
    echo "🛑 Đang dừng toàn bộ Core Framework Production Stack..."
    docker compose $COMPOSE_FILE down
    ;;

  restart)
    if [ -n "$SERVICE" ]; then
      echo "🔄 Đang khởi động lại service [$SERVICE]..."
      docker compose $COMPOSE_FILE restart "$SERVICE"
    else
      echo "🔄 Đang khởi động lại toàn bộ Production Stack..."
      docker compose $COMPOSE_FILE restart
    fi
    ;;

  logs)
    if [ -n "$SERVICE" ]; then
      docker compose $COMPOSE_FILE logs -f "$SERVICE"
    else
      docker compose $COMPOSE_FILE logs -f
    fi
    ;;

  status|ps)
    echo "📊 [Trạng thái Containers]"
    docker compose $COMPOSE_FILE ps
    echo ""
    echo "📈 [Mức tiêu thụ tài nguyên RAM/CPU]"
    docker stats --no-stream $(docker compose $COMPOSE_FILE ps -q) 2>/dev/null || true
    ;;

  ssl-init)
    check_env_file
    source "$ENV_FILE"

    if [ -z "$DOMAIN_NAME" ] || [ "$DOMAIN_NAME" = "yourdomain.com" ]; then
      echo "❌ Lỗi: Hãy cấu hình DOMAIN_NAME thật trong [$ENV_FILE] trước khi cấp SSL!"
      exit 1
    fi

    if [ -z "$CERTBOT_EMAIL" ] || [ "$CERTBOT_EMAIL" = "admin@yourdomain.com" ]; then
      echo "❌ Lỗi: Hãy cấu hình CERTBOT_EMAIL thật trong [$ENV_FILE] trước khi cấp SSL!"
      exit 1
    fi

    echo "🔐 Bắt đầu quy trình cấp phát chứng chỉ SSL Let's Encrypt cho domain: $DOMAIN_NAME..."

    # 1. Đảm bảo Nginx đang chạy để phục vụ ACME-challenge
    echo "⚡ [Bước 1/3] Đảm bảo Nginx đang hoạt động..."
    docker compose $COMPOSE_FILE up -d nginx

    # 2. Chạy Certbot để xin cấp chứng chỉ
    echo "📜 [Bước 2/3] Yêu cầu chứng chỉ từ Let's Encrypt CA..."
    docker compose $COMPOSE_FILE run --rm certbot certonly \
      --webroot \
      --webroot-path=/var/www/certbot \
      --email "$CERTBOT_EMAIL" \
      --agree-tos \
      --no-eff-email \
      -d "$DOMAIN_NAME"

    # 3. Kích hoạt cấu hình SSL trong Nginx
    echo "⚙️  [Bước 3/3] Kích hoạt cấu hình HTTPS trong Nginx..."
    docker compose $COMPOSE_FILE exec nginx sh -c "
      export DOMAIN_NAME='$DOMAIN_NAME'
      sed 's/\${DOMAIN_NAME}/$DOMAIN_NAME/g' /etc/nginx/conf.d/ssl.conf.template > /etc/nginx/conf.d/app.conf
      nginx -s reload
    "

    echo ""
    echo "🎉 CHÚC MỪNG! Chứng chỉ SSL đã được kích hoạt thành công cho https://$DOMAIN_NAME"
    ;;

  config)
    check_env_file
    docker compose $COMPOSE_FILE config
    ;;

  *)
    echo "Cách dùng: ./docker-prod.sh {up|down|restart|logs|status|ssl-init|config} [service]"
    echo ""
    echo "Ví dụ trên VPS:"
    echo "  ./docker-prod.sh up                # Build & Chạy toàn bộ hệ thống"
    echo "  ./docker-prod.sh ssl-init          # Cấp chứng chỉ SSL HTTPS miễn phí"
    echo "  ./docker-prod.sh status            # Xem trạng thái và RAM/CPU"
    echo "  ./docker-prod.sh logs nginx        # Xem log riêng của Nginx"
    exit 1
    ;;
esac
