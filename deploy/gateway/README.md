# Load Balancer & API Gateway Deployment Guide (Phase 13.5)

Bộ cấu hình mẫu vendor-neutral giúp vận hành Core API phía sau **Nginx**, **HAProxy**, **Cloud Load Balancer (AWS ALB/NLB, GCP, Azure)** hoặc **API Gateway (Kong, APISIX, Envoy)**.

## 1. Bất biến cấu hình (Configuration Invariants)

1. **Chống lỗi 502 Keep-Alive Race**:
   - `API_KEEP_ALIVE_TIMEOUT_MS` (`65000`) **phải lớn hơn** `LB_KEEP_ALIVE_TIMEOUT_MS` (`60000`).
   - `API_HEADERS_TIMEOUT_MS` (`70000`) **phải lớn hơn** `API_KEEP_ALIVE_TIMEOUT_MS` (`65000`).
2. **Timeout đọc/gửi không cắt ngang API**:
   - `LB_READ_TIMEOUT_MS` (`60000`) và `LB_SEND_TIMEOUT_MS` (`60000`) **phải ≥** `API_REQUEST_TIMEOUT_MS` (`30000`).
3. **Kích thước request đồng nhất**:
   - `GATEWAY_MAX_BODY_SIZE_BYTES` (`33554432` = 32MB) == `API_MAX_BODY_SIZE_BYTES` (`33554432` = 32MB) == `client_max_body_size 32M`.
   - `API_JSON_BODY_LIMIT_BYTES` (`16777216` = 16MB, có thể siết xuống 2MB ở production nếu không nhận JSON lớn) ≤ `API_MAX_BODY_SIZE_BYTES`.
4. **Health Check Probes**:
   - Readiness: `GET` hoặc `HEAD /api/v1/health/ready` (trả `200` / `503`, `Cache-Control: no-store`).
   - Liveness: `GET` hoặc `HEAD /api/v1/health/live`.
5. **IP thật & Chống giả mạo X-Forwarded-For**:
   - Chỉ tin header `X-Forwarded-For` / `Forwarded` / `X-Real-IP` khi kết nối gốc xuất phát từ `PROXY_TRUSTED_CIDRS` (`PROXY_TRUST_MODE=private` hoặc `cidr`).
   - Tuyệt đối không đặt `0.0.0.0/0` hay `*`.

## 2. Phân tầng Rate Limit (Tránh chồng chéo)

- **Development (`RATE_LIMIT_LAYER_MODE=backend-only`)**: Backend kiểm tra cả 3 chiều `IP + User + Route API`.
- **Production (`RATE_LIMIT_LAYER_MODE=edge-ip-backend-business`)**:
  - Gateway/LB chịu trách nhiệm chống DDoS / IP burst và gắn header `X-RateLimit-Source: gateway`.
  - Backend bỏ qua lớp đếm IP chung (trừ các route nhạy cảm như `/auth/login`, `/auth/otp`, `/auth/forgot-password`) và tập trung áp giới hạn theo `User` + `Route API` đồng bộ qua Redis.

## 3. Tách Microservice không đổi API Contract

- Mọi URL đều giữ nguyên cấu trúc `/api/v1/<module>/*` (`stripPrefix: false`).
- Tham chiếu bảng ánh xạ tại [gateway-routing.yaml](./gateway-routing.yaml) hoặc endpoint `GET /api/v1/ops/traffic/gateway`.
- Khi tách một domain (vd. `identity` hoặc `files`) sang service riêng, chỉ cần trỏ upstream tương ứng ở Gateway/Nginx/HAProxy bằng `GATEWAY_SERVICE_ROUTING_OVERRIDES=identity=http://identity-svc:3010` mà không sửa client.
