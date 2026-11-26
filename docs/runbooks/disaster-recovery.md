# Runbook: Disaster Recovery (Section 13.7)

Tài liệu chuẩn vận hành **Disaster Recovery (DR)** cho Core Framework. Tính năng này được thiết kế theo cơ chế **Opt-in (`DR_ENABLED=false` mặc định)** — chỉ kích hoạt cho các dự án có yêu cầu mô hình DC chính và DR dự phòng.

---

## 1. Xác định RPO & RTO (Mục tiêu phục hồi)

| Chỉ số | Ý nghĩa | Mặc định Core | Biến môi trường |
|---|---|---|---|
| **RPO** (Recovery Point Objective) | Mức mất dữ liệu tối đa chấp nhận được | `900s` (15 phút) | `DR_RPO_TARGET_SECONDS` |
| **RTO** (Recovery Time Objective) | Thời gian tối đa để khôi phục hệ thống | `1800s` (30 phút) | `DR_RTO_TARGET_SECONDS` |
| **Drill Interval** | Chu kỳ diễn tập DR định kỳ | `30 ngày` | `DR_DRILL_INTERVAL_DAYS` |

---

## 2. Mô hình DC chính & DR dự phòng (`DR_TOPOLOGY_MODE`)

1. **`BACKUP_RESTORE`**: Lưu backup mã hóa (Mục 13.6) sang site DR; dựng lại khi có thảm họa.
2. **`PILOT_LIGHT`**: DB Standby tối thiểu chạy tại DR; runtime API/Worker bật khi Failover.
3. **`WARM_STANDBY`** *(Mặc định)*: DC chính phục vụ traffic; DB & Storage tại DR đồng bộ liên tục theo RPO.
4. **`HOT_STANDBY`**: Hai site chạy song song gần thời gian thực.

Cấu hình mẫu hạ tầng tham khảo: [docker-compose.dr.yml](../../docker/dr/docker-compose.dr.yml).

---

## 3. Đồng bộ Database và Storage sang DR

- **Lịch tự động:** BullMQ Scheduler (`dr.sync.tick`, mặc định `*/15 * * * *`) tự động bỏ qua khi `DR_ENABLED=false` và `dr_profiles.is_enabled=false`.
- **Chạy thủ công / Kiểm tra RPO ngay:**
  ```bash
  npm --prefix backend run cli -- dr:status
  npm --prefix backend run cli -- dr:sync --scope=FULL
  ```
- Hệ thống đo `actualRpoSeconds` từ replication lag (`DatabaseRoutingService`), TCP/DB standby (`DR_DB_HOST`) hoặc tuổi bản sao lưu DB mới nhất (`backup-ops`), đồng thời đồng bộ delta Object Storage sang kho DR và phát cảnh báo `P1` nếu vượt RPO.

---

## 4. Kịch bản Failover (Chuyển sang DR)

> **Chốt an toàn:** `DR_LIVE_SWITCH_ENABLED` mặc định là `false`. Để diễn tập không ảnh hưởng production, luôn dùng `--mode=SIMULATED`.

1. Khởi tạo phiên Failover kèm lý do:
   ```bash
   npm --prefix backend run cli -- dr:failover --mode=SIMULATED --reason="Su co mat ket noi DC chinh"
   ```
   *(Nếu chạy `LIVE`, cần bật `DR_LIVE_SWITCH_ENABLED=true` và truyền `--confirm=FAILOVER`.)*
2. Thực hiện & tick từng bước trong Checklist (bắt buộc chống split-brain):
   - Xác nhận sự cố DC chính (`confirm_primary_outage`).
   - Chặn ghi vào DC chính (`freeze_primary_writes`).
   - Kiểm tra checkpoint / nạp backup DB tại DR (`verify_dr_db_checkpoint`).
   - Promote DB tại DR thành Read-Write (`promote_dr_database`).
   - Xác nhận đồng bộ Object Storage tại DR (`verify_dr_storage_sync`).
   - Chuyển DNS / Load Balancer sang DR (`switch_traffic_to_dr` hoặc qua `DR_SWITCH_WEBHOOK_URL`).
   - Kiểm tra `/health/ready` (`verify_dr_health_smoke`).
3. Hoàn tất phiên chuyển đổi qua System Console (`/system-console/dr` → tab **Failover / Failback**) để ghi nhận `actualRtoSeconds` và đánh giá `rtoMet`.

---

## 5. Kịch bản Failback (Chuyển về hệ thống chính an toàn)

1. Hệ thống chặn Failback `LIVE` nếu `activeSite` chưa ở `DR` (chống chuyển ngược nhầm gây split-brain).
2. Khởi tạo phiên Failback:
   ```bash
   npm --prefix backend run cli -- dr:failback --mode=SIMULATED --reason="DC chinh da phuc hoi va dong bo nguoc xong"
   ```
3. Thực hiện đầy đủ checklist Failback: xác nhận DC chính ổn định → đồng bộ ngược DR → DC chính → đóng ghi trên DR (maintenance window) → xác nhận lag = 0 → promote lại DC chính → đồng bộ ngược Storage → chuyển DNS/LB về DC chính → chạy đối soát → mở lại chiều đồng bộ DC chính → DR.

---

## 6. Đối soát dữ liệu sau khi chuyển hệ thống

```bash
npm --prefix backend run cli -- dr:reconcile --scope=FULL
```

- Kiểm tra trùng khóa duy nhất và số lượng trên các bảng trọng yếu (`DR_RECONCILE_TABLES`), đồng thời so sánh manifest Object Storage giữa Primary và DR để phát hiện `MISSING_ON_TARGET`, `EXTRA_ON_TARGET`, `DUPLICATE_KEY`, `SIZE_MISMATCH`.

---

## 7. Tổ chức kiểm tra DR định kỳ (DR Drill)

```bash
npm --prefix backend run cli -- dr:drill --type=MANUAL_SIMULATION --scenario="Dien tap DR hang thang"
```

- Tự động chạy vòng lặp: kiểm tra sync (RPO) → mô phỏng Failover checklist (RTO) → đối soát dữ liệu → chấm `PASSED` / `FAILED` theo mục tiêu RPO/RTO và cập nhật `nextDrillDueAt`.
