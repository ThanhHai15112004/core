FROM nginx:1.27-alpine

ARG APP_VERSION="1.0.0"
ARG APP_GIT_COMMIT=""
ARG APP_BUILD_TIME=""
ARG APP_SOURCE_URL=""

LABEL org.opencontainers.image.title="core-nginx" \
      org.opencontainers.image.description="Core Framework Nginx Edge Reverse Proxy (Rolling / Blue-Green / Canary)" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_GIT_COMMIT}" \
      org.opencontainers.image.created="${APP_BUILD_TIME}" \
      org.opencontainers.image.source="${APP_SOURCE_URL}"

RUN apk add --no-cache curl

# Xóa các cấu hình mặc định ban đầu
RUN rm -rf /etc/nginx/conf.d/* && mkdir -p /etc/nginx/upstreams

# Nạp các tệp cấu hình chuyên dụng & upstream mặc định (có thể mount ghi đè cho Blue-Green / Canary)
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/upstreams/backend.conf /etc/nginx/upstreams/backend.conf
COPY docker/nginx/conf.d/app.conf /etc/nginx/conf.d/app.conf
COPY docker/nginx/conf.d/ssl.conf.template /etc/nginx/conf.d/ssl.conf.template

EXPOSE 80 443

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1/api/v1/health >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
