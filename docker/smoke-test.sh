#!/usr/bin/env bash
# ==============================================================================
# Smoke Test sau khi khởi động môi trường Docker (Dev & Prod)
# Kiểm tra trạng thái container (healthy) và phản hồi HTTP của các runtime
# ==============================================================================
set -euo pipefail

MODE="${1:-dev}"
TIMEOUT_SEC="${SMOKE_TIMEOUT_SEC:-90}"
INTERVAL_SEC=3

PASS_COUNT=0
FAIL_COUNT=0

log_pass() {
  echo "  ✅ [PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

log_fail() {
  echo "  ❌ [FAIL] $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

wait_for_container_healthy() {
  local container="$1"
  local elapsed=0

  if ! docker inspect "$container" >/dev/null 2>&1; then
    log_fail "Container [$container] chưa tồn tại (hãy chạy './docker-${MODE}.sh up' trước)"
    return 1
  fi

  while [ "$elapsed" -lt "$TIMEOUT_SEC" ]; do
    local state
    local health
    state=$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo "none")

    if [ "$state" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "none" ]; }; then
      log_pass "Container [$container] đang chạy ($state / $health)"
      return 0
    fi

    sleep "$INTERVAL_SEC"
    elapsed=$((elapsed + INTERVAL_SEC))
  done

  local final_state
  final_state=$(docker inspect --format '{{.State.Status}} ({{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}})' "$container" 2>/dev/null || echo "unknown")
  log_fail "Container [$container] chưa đạt healthy sau ${TIMEOUT_SEC}s (trạng thái: ${final_state})"
  return 1
}

echo "=============================================================================="
echo "🧪 BẮT ĐẦU SMOKE TEST MÔI TRƯỜNG DOCKER [${MODE^^}] (Timeout: ${TIMEOUT_SEC}s)"
echo "=============================================================================="

if [ "$MODE" = "prod" ]; then
  CONTAINERS=(
    "core-backend-prod"
    "core-worker-prod"
    "core-scheduler-prod"
    "core-prometheus-prod"
    "core-nginx-prod"
  )
else
  CONTAINERS=(
    "core-backend-dev"
    "core-worker-dev"
    "core-scheduler-dev"
    "core-frontend-dev"
    "core-prometheus-dev"
  )
fi

echo ""
echo "1️⃣  Kiểm tra trạng thái Container & Healthcheck..."
for c in "${CONTAINERS[@]}"; do
  wait_for_container_healthy "$c" || true
done

echo ""
echo "2️⃣  Kiểm tra phản hồi HTTP & Endpoints của từng Runtime..."

if [ "$MODE" = "prod" ]; then
  # 1. Nginx Reverse Proxy -> Backend Health
  if HEALTH_BODY=$(curl -fsS --max-time 5 "http://127.0.0.1/api/v1/health" 2>/dev/null) && echo "$HEALTH_BODY" | grep -q '"success":true'; then
    log_pass "Nginx -> Backend Health (GET http://127.0.0.1/api/v1/health) trả về 200 & envelope hợp lệ"
  else
    log_fail "Nginx -> Backend Health (GET http://127.0.0.1/api/v1/health) không phản hồi hợp lệ"
  fi

  # 2. Nginx -> Frontend SPA
  if curl -fsS --max-time 5 "http://127.0.0.1/" >/dev/null 2>&1; then
    log_pass "Nginx -> Frontend SPA (GET http://127.0.0.1/) trả về 200 OK"
  else
    log_fail "Nginx -> Frontend SPA (GET http://127.0.0.1/) thất bại"
  fi

  # 3. Backend internal metrics
  if docker exec core-backend-prod wget -qO- "http://127.0.0.1:3005/api/v1/metrics" 2>/dev/null | grep -q "process_cpu"; then
    log_pass "Backend Metrics nội bộ (core-backend-prod :3005/api/v1/metrics) hoạt động"
  else
    log_fail "Backend Metrics nội bộ (core-backend-prod :3005/api/v1/metrics) thất bại"
  fi

  # 4. Worker internal metrics
  if docker exec core-worker-prod wget -qO- "http://127.0.0.1:9101/metrics" 2>/dev/null | grep -q "process_cpu"; then
    log_pass "Worker Metrics nội bộ (core-worker-prod :9101/metrics) hoạt động"
  else
    log_fail "Worker Metrics nội bộ (core-worker-prod :9101/metrics) thất bại"
  fi

  # 5. Scheduler internal metrics
  if docker exec core-scheduler-prod wget -qO- "http://127.0.0.1:9102/metrics" 2>/dev/null | grep -q "process_cpu"; then
    log_pass "Scheduler Metrics nội bộ (core-scheduler-prod :9102/metrics) hoạt động"
  else
    log_fail "Scheduler Metrics nội bộ (core-scheduler-prod :9102/metrics) thất bại"
  fi

  # 6. Prometheus internal health
  if docker exec core-prometheus-prod wget -qO- "http://127.0.0.1:9090/-/healthy" >/dev/null 2>&1; then
    log_pass "Prometheus Server nội bộ (core-prometheus-prod :9090/-/healthy) hoạt động"
  else
    log_fail "Prometheus Server nội bộ (core-prometheus-prod :9090/-/healthy) thất bại"
  fi
else
  # 1. Backend API Health
  if HEALTH_BODY=$(curl -fsS --max-time 5 "http://127.0.0.1:3005/api/v1/health" 2>/dev/null) && echo "$HEALTH_BODY" | grep -q '"success":true'; then
    log_pass "Backend API Health (GET http://localhost:3005/api/v1/health) trả về 200 & envelope hợp lệ"
  else
    log_fail "Backend API Health (GET http://localhost:3005/api/v1/health) không phản hồi hợp lệ"
  fi

  # 2. Backend API Prometheus Metrics
  if curl -fsS --max-time 5 "http://127.0.0.1:3005/api/v1/metrics" 2>/dev/null | grep -q "process_cpu"; then
    log_pass "Backend API Metrics (GET http://localhost:3005/api/v1/metrics) hoạt động"
  else
    log_fail "Backend API Metrics (GET http://localhost:3005/api/v1/metrics) thất bại"
  fi

  # 3. Worker Runtime Metrics (:9101)
  if docker exec core-worker-dev curl -fsS --max-time 5 "http://127.0.0.1:9101/metrics" 2>/dev/null | grep -q "process_cpu"; then
    log_pass "Worker Runtime Metrics (core-worker-dev :9101/metrics) hoạt động"
  else
    log_fail "Worker Runtime Metrics (core-worker-dev :9101/metrics) thất bại"
  fi

  # 4. Scheduler Runtime Metrics (:9102)
  if docker exec core-scheduler-dev curl -fsS --max-time 5 "http://127.0.0.1:9102/metrics" 2>/dev/null | grep -q "process_cpu"; then
    log_pass "Scheduler Runtime Metrics (core-scheduler-dev :9102/metrics) hoạt động"
  else
    log_fail "Scheduler Runtime Metrics (core-scheduler-dev :9102/metrics) thất bại"
  fi

  # 5. Frontend Vite Server (:5175)
  if curl -fsS --max-time 5 "http://127.0.0.1:5175" >/dev/null 2>&1; then
    log_pass "Frontend Vite Dev Server (GET http://localhost:5175) trả về 200 OK"
  else
    log_fail "Frontend Vite Dev Server (GET http://localhost:5175) thất bại"
  fi

  # 6. Prometheus Server (:9090)
  if curl -fsS --max-time 5 "http://127.0.0.1:9090/-/healthy" >/dev/null 2>&1; then
    log_pass "Prometheus Server (GET http://localhost:9090/-/healthy) trả về 200 OK"
  else
    log_fail "Prometheus Server (GET http://localhost:9090/-/healthy) thất bại"
  fi
fi

echo ""
echo "=============================================================================="
echo "📊 KẾT QUẢ SMOKE TEST: ${PASS_COUNT} PASSED | ${FAIL_COUNT} FAILED"
echo "=============================================================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
