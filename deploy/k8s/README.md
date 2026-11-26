# Kubernetes Autoscaling Templates (HPA v2)

Thư mục này chứa mẫu cấu hình **HorizontalPodAutoscaler (`autoscaling/v2`)** và **Prometheus Adapter rules** cho Core Framework. **Chỉ sử dụng khi dự án triển khai trên Kubernetes** (không ảnh hưởng môi trường Docker Compose hoặc VPS).

## 1. Điều kiện tiên quyết trên cluster Kubernetes
1. **Stateless mode bật đầy đủ (Phase 13.1)**:
   - `STORAGE_DRIVER=s3` (MinIO/S3 dùng chung)
   - `CACHE_DRIVER=redis` (Redis dùng chung)
   - `readinessProbe` trỏ `/api/v1/health/ready`, `livenessProbe` trỏ `/api/v1/health/live`
   - `terminationGracePeriodSeconds: 45` (lớn hơn `RUNTIME_DRAIN_DELAY_MS + RUNTIME_GRACEFUL_TIMEOUT_MS`)
   - Khai báo `resources.requests.cpu` và `resources.requests.memory` trên Deployment (bắt buộc để HPA tính `% Utilization`).
2. **Metrics Server** (cho CPU & Memory utilization).
3. **Prometheus + Prometheus Adapter** (hoặc **KEDA**) để đẩy `http_requests_in_flight` và `core_queue_backlog_total` vào Kubernetes Custom/External Metrics API.

## 2. Danh mục Metrics Core công bố sẵn cho Autoscaler
- **CPU & RAM** (`/api/v1/metrics`, `worker:9101/metrics`, `scheduler:9102/metrics`):
  - `core_runtime_cpu_percent`, `core_runtime_memory_percent`, `core_runtime_memory_rss_bytes`, `core_runtime_memory_limit_bytes`
  - Mặc định `prom-client`: `process_cpu_seconds_total`, `process_resident_memory_bytes`
- **API In-flight Requests** (`/api/v1/metrics`):
  - `http_requests_in_flight`
- **Worker Queue Backlog** (`/api/v1/metrics` & `worker:9101/metrics`):
  - `core_queue_backlog{queue}`, `core_queue_backlog_total`, `core_queue_active_workers{queue}`
- **Database Pool Impact**:
  - `core_db_pool_connections{state="used|idle|waiting|limit"}`, `core_db_sessions`

## 3. Áp dụng lên Kubernetes
```bash
# 1. Nạp Prometheus Adapter rules (hoặc gộp vào Helm values của prometheus-adapter)
kubectl apply -f deploy/k8s/prometheus-adapter-rules.yaml

# 2. Áp dụng HPA cho API và Worker
kubectl apply -f deploy/k8s/hpa-api.yaml
kubectl apply -f deploy/k8s/hpa-worker.yaml

# 3. Kiểm tra trạng thái HPA & custom metrics
kubectl get hpa
kubectl describe hpa core-api-hpa core-worker-hpa
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/default/pods/*/http_requests_in_flight"
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/default/core_queue_backlog_total"
```

> **Mẹo đồng bộ cấu hình động**: bạn có thể xuất trực tiếp YAML khớp với cấu hình `AUTOSCALING_*` / System Settings hiện hành qua API:
> `GET /api/v1/ops/runtimes/autoscaling/hpa?target=api` và `?target=worker`.

## 4. Lưu ý bắt buộc về Database Connection Pool
Công thức kiểm tra trước khi nâng `maxReplicas`:
```text
(api.maxReplicas + worker.maxReplicas) × DB_MAX_CONNECTIONS  <  DB max_connections × 0.8
```
Ví dụ: nếu MySQL `max_connections = 151` và mỗi instance giữ `DB_MAX_CONNECTIONS = 10`, tổng `api.maxReplicas + worker.maxReplicas` nên ≤ 12 (hoặc đặt ProxySQL / PgBouncer phía trước Database).
