# Runbook: Backup & Restore Operations (Section 13.6)

Tài liệu hướng dẫn chuẩn khi thực hiện sao lưu, kiểm tra diễn tập (Restore Drill) và khôi phục hệ thống Core Framework bao gồm **Database**, **Object Storage / Files**, **Secrets**, và **Config**.

---

## 0. Kiến trúc & Nguyên tắc an toàn

- **Mã hóa bắt buộc**: Các file `.cbkp` được nén (`gzip`) và mã hóa **AES-256-GCM** (HKDF-SHA256 từ `BACKUP_ENCRYPTION_KEY`) kèm header tự mô tả `COREBKP1` và kiểm tra 2 lớp SHA-256 (`artifactSha256` & `plaintextSha256`).
- **Không lưu khóa cùng backup**: `BACKUP_ENCRYPTION_KEY` chỉ lưu trong Secret Manager / `.env` runtime, **tuyệt đối không** đẩy lên cùng bucket/thư mục chứa file backup.
- **Retention an toàn**: Chính sách dọn tự động (`backup:prune`) xóa bản quá `retentionDays` hoặc vượt `maxKeepCount`, nhưng **luôn giữ lại ít nhất 1 bản `SUCCESS` mới nhất** của mỗi policy.
- **Restore Guard**:
  - Tự động Verify Drill luôn chạy vào DB cô lập (`BACKUP_DRILL_DATABASE` hoặc DB tạm `*_drill_*`) và **cấm** trỏ về Primary DB.
  - Khôi phục ghi đè DB chính bị khóa mặc định (`BACKUP_RESTORE_EXECUTION_ENABLED=false`) và mọi thao tác Restore (thủ công hay tự động) **bắt buộc ghi vào `backup_restore_histories` + `audit_logs` kèm người thực hiện và lý do**.

---

## 1. Khôi phục Database (MySQL / PostgreSQL)

### 1.1. Chuẩn bị & Chọn bản Backup đạt chuẩn
1. Dừng Worker & Scheduler để tránh ghi dữ liệu mới trong quá trình khôi phục:
   ```bash
   docker compose -f docker-compose.prod.yml stop worker scheduler
   ```
2. Kiểm tra danh sách bản backup qua System Console (`/system-console/backups`) hoặc API `GET /api/v1/ops/backups/records`, ưu tiên bản có `status = SUCCESS` và `verifyStatus = PASSED`.
3. Chạy xác minh lại bản backup vào môi trường cô lập trước khi restore chính thức:
   ```bash
   npm --prefix backend run cli -- backup:verify --id=<RECORD_ID> --reason="Pre-restore verification"
   ```

### 1.2. Thực thi Restore
- **Cách A — Qua CLI chuẩn** (khi cần chạy live restore trong cửa sổ bảo trì):
  1. Bật tạm `BACKUP_RESTORE_EXECUTION_ENABLED=true` trong phiên bảo trì.
  2. Chạy lệnh restore kèm lý do bắt buộc:
     ```bash
     npm --prefix backend run cli -- backup:restore \
       --id=<RECORD_ID> \
       --scope=DATABASE \
       --target=production \
       --actor="<ten_nguoi_thuc_hien>" \
       --reason="Khoi phuc du lieu sau su co X (Ticket #123)" \
       --execute --confirm=RESTORE
     ```
  3. Tắt lại `BACKUP_RESTORE_EXECUTION_ENABLED=false` ngay sau khi hoàn tất.
- **Cách B — Nạp thủ công vào DB mới / DB dự phòng rồi tráo endpoint**:
  1. Tải artifact `.cbkp` từ Storage, giải mã bằng `BACKUP_ENCRYPTION_KEY` (hoặc export sang DB mới) và nạp qua `mysql` / `psql` / `pg_restore`.
  2. Kiểm tra schema migration:
     ```bash
     npm --prefix backend run cli -- migration:check
     ```
  3. Ghi nhận lịch sử thao tác Restore qua Console (`/system-console/backups` → tab Lịch sử Restore) hoặc CLI:
     ```bash
     npm --prefix backend run cli -- backup:restore \
       --id=<RECORD_ID> --scope=DATABASE --target=production \
       --actor="<ten_nguoi_thuc_hien>" --reason="Manual DB restore from artifact"
     ```

---

## 2. Khôi phục Object Storage & Files người dùng

### 2.1. Khôi phục nhanh nhờ Bucket Versioning (S3 / MinIO)
1. Kiểm tra trạng thái Versioning:
   ```bash
   npm --prefix backend run cli -- backup:storage-versioning
   ```
   *(Nếu chưa bật, chạy `npm --prefix backend run cli -- backup:storage-versioning --enable` hoặc bật trên System Console).*
2. Khi có file bị xóa nhầm hoặc ghi đè:
   - Trên System Console vào mục **Storage → Objects**, chọn object cần xem `versions`, hoặc dùng AWS CLI / MinIO `mc`:
     ```bash
     aws s3api list-object-versions --bucket <BUCKET> --prefix <KEY>
     aws s3api delete-object --bucket <BUCKET> --key <KEY> --version-id <DELETE_MARKER_VERSION_ID>
     ```

### 2.2. Khôi phục từ Storage Snapshot Archive (`.cbkp`)
1. Chọn bản `STORAGE` backup gần nhất (`backups/storage/<YYYY-MM-DD>/<BACKUP_CODE>.cbkp`).
2. Chạy Verify toàn vẹn snapshot:
   ```bash
   npm --prefix backend run cli -- backup:verify --id=<STORAGE_RECORD_ID>
   ```
3. Thực thi restore các object từ snapshot (hoặc chạy CLI với `--scope=STORAGE --execute --confirm=RESTORE`).
4. Đối chiếu số lượng bản ghi trong bảng `files` với các object thực tế trên bucket/thư mục.

---

## 3. Khôi phục Secrets & Khóa mã hóa

Khi mất máy chủ hoặc dựng lại môi trường mới, khôi phục bộ secrets từ Vault / KMS / két ngoại tuyến theo thứ tự:

1. **Khóa giải mã Backup**:
   - `BACKUP_ENCRYPTION_KEY` (bắt buộc đúng khóa lúc tạo bản `.cbkp`).
2. **Khóa bảo mật ứng dụng & DB Encryption-at-Rest**:
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — lưu ý `FieldEncryptionService` dẫn xuất khóa giải mã trường nhạy cảm trong DB từ `JWT_ACCESS_SECRET`, nên phải khôi phục chính xác giá trị cũ để đọc được dữ liệu đã mã hóa trong DB.
3. **Thông tin kết nối hạ tầng**:
   - `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`
   - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
   - `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`
4. **Hậu kiểm sau sự cố nghi lộ secret**:
   - Xoay vòng (rotate) khóa mới, cập nhật biến môi trường và thu hồi toàn bộ phiên đăng nhập (`auth_sessions`) / API clients bị ảnh hưởng.
   - Kiểm tra cấu hình secret đã nạp đủ (giá trị luôn được che dấu):
     ```bash
     npm --prefix backend run cli -- doctor
     ```

---

## 4. Khôi phục Config & Hạ tầng Runtime

1. **Cấu hình tĩnh trong Git**:
   - Checkout đúng tag phát hành tương ứng bản backup DB:
     - `docker-compose.prod.yml`
     - `docker/nginx/nginx.conf`, `docker/nginx/conf.d/app.conf`
     - `docker/prometheus/`
     - `backend/project.manifest.json`
2. **Cấu hình môi trường (`.env`)**:
   - Xác minh `NODE_ENV=production`, `DB_SYNCHRONIZE=false`, `STORAGE_DRIVER=s3`, `CACHE_DRIVER=redis`, `TRUSTED_PROXIES`.
3. **Cấu hình động trong DB (`system_settings`, `feature_flags`, `menus`)**:
   - Đã nằm trong bản backup DB. Sau khi khôi phục DB, chạy seeder master (idempotent) để đảm bảo quyền và menu mới nhất không bị thiếu:
     ```bash
     npm --prefix backend run cli -- seed:run --scope=master
     ```
4. **Thứ tự khởi động lại dịch vụ**:
   1. Database (MySQL/Postgres) & Redis
   2. Object Storage (MinIO/S3)
   3. Backend API (`api`) → kiểm tra `/api/v1/health`
   4. Worker (`worker`) & Scheduler (`scheduler`)
   5. Reverse Proxy (`nginx`) & Frontend

---

## 5. Checklist xác minh sau Restore

- [ ] `GET /api/v1/health` trả `ok` cho cả Database, Redis và Heap.
- [ ] `npm --prefix backend run cli -- migration:check` báo không còn pending migration.
- [ ] `npm --prefix backend run cli -- arch:check` báo passed.
- [ ] Đăng nhập tài khoản quản trị thành công, mở được file mẫu từ Storage.
- [ ] Các runtime (`api`, `worker`, `scheduler`) báo heartbeat xanh trên `/system-console/runtimes`.
- [ ] Bản ghi trong `backup_restore_histories` và `audit_logs` đã có đầy đủ **người thực hiện** và **lý do**.
