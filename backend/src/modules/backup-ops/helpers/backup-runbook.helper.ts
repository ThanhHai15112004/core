import type { BackupRunbookView } from '../types/backup-ops.types.js';

/** Tạo nội dung Runbook hướng dẫn khôi phục chuẩn cho Database, File/Storage, Secrets và Config. */
export function buildBackupRunbook(): BackupRunbookView {
  return {
    version: '1.0.0',
    updatedAt: '2026-11-26',
    docPath: 'docs/runbooks/backup-and-restore.md',
    sections: [
      {
        id: 'database',
        title: '1. Khôi phục Database (MySQL / PostgreSQL)',
        summary:
          'Giải mã bản backup `.cbkp` (AES-256-GCM + gzip), kiểm tra SHA-256 và nạp lại vào instance sạch trước khi chuyển traffic.',
        steps: [
          'Bật chế độ bảo trì / tạm dừng Worker & Scheduler (`docker compose stop worker scheduler`) để tránh ghi dữ liệu trong lúc khôi phục.',
          'Xác định bản backup đạt Verify Drill (`verifyStatus = PASSED`) qua System Console hoặc API `GET /api/v1/ops/backups/records`.',
          'Chạy Verify Drill vào DB cô lập trước khi chạm môi trường chính (`npm --prefix backend run cli -- backup:verify --id=<ID>`).',
          'Thực hiện khôi phục qua CLI hoặc giải mã thủ công bằng `BACKUP_ENCRYPTION_KEY`, nạp dump vào DB đích và chạy `migration:check`.',
          'Ghi nhận lịch sử thao tác Restore (người thực hiện + lý do) qua Console hoặc `backup:restore`.',
        ],
        commands: [
          'npm --prefix backend run cli -- backup:verify --id=<RECORD_ID>',
          'npm --prefix backend run cli -- backup:restore --id=<RECORD_ID> --target=production --reason="Khoi phuc su co DB" --execute --confirm=RESTORE',
          'npm --prefix backend run cli -- migration:check',
        ],
        warnings: [
          'Cấm chạy Restore trực tiếp đè lên Primary khi chưa kiểm tra SHA-256 và Restore Drill thành công.',
          'Luôn giữ `BACKUP_RESTORE_EXECUTION_ENABLED=false` ở trạng thái thường trực; chỉ bật tạm thời trong cửa sổ bảo trì nếu chạy live restore.',
        ],
      },
      {
        id: 'storage',
        title: '2. Khôi phục File & Object Storage (S3 / MinIO / Local)',
        summary:
          'Ưu tiên khôi phục theo Object Version (`versionId`) khi Bucket Versioning đang bật; fallback sang giải nén snapshot `.cbkp` khi mất cả bucket.',
        steps: [
          'Kiểm tra trạng thái Bucket Versioning (`GET /api/v1/ops/backups/storage/versioning`). Nếu bị xóa nhầm object đơn lẻ, khôi phục trực tiếp từ `ListObjectVersions` / xóa DeleteMarker.',
          'Nếu hư hỏng diện rộng: tải bản `STORAGE` snapshot mới nhất (`backups/storage/.../*.cbkp`), xác thực SHA-256 và giải mã.',
          'Giải nén các tệp từ archive `core-storage-snapshot-v1` về bucket/thư mục đích tương ứng với `storageKey`.',
          'Kiểm tra đối chiếu bảng `files` và `file_usages` với object thực tế trên storage.',
        ],
        commands: [
          'npm --prefix backend run cli -- backup:storage-versioning',
          'npm --prefix backend run cli -- backup:storage-versioning --enable',
          'npm --prefix backend run cli -- backup:run --type=STORAGE',
        ],
        warnings: [
          'Bucket Versioning chỉ bảo vệ được file mới ghi/sửa/xóa sau thời điểm bật — luôn bật sẵn ngay khi khởi tạo môi trường.',
        ],
      },
      {
        id: 'secrets',
        title: '3. Khôi phục Secrets & Khóa mã hóa',
        summary:
          'Khôi phục tập trung các biến mật ngoài Git (.env, KMS/Vault, khóa mã hóa backup và field encryption) theo đúng thứ tự phụ thuộc.',
        steps: [
          'Lấy lại bộ secrets từ trình quản lý bí mật (Vault / Cloud Secret Manager / két lưu trữ ngoại tuyến): `BACKUP_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DB_PASSWORD`, `REDIS_PASSWORD`, `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`.',
          'Kiểm tra `JWT_ACCESS_SECRET` vì `FieldEncryptionService` dẫn xuất khóa giải mã trường nhạy cảm trong DB từ secret này — sai khóa sẽ không giải mã được cột nhạy cảm.',
          'Nếu nghi ngờ lộ secret: xoay vòng (rotate) khóa mới sau khi hệ thống đã lên ổn định và thu hồi toàn bộ phiên đăng nhập (`auth_sessions`).',
        ],
        commands: [
          'npm --prefix backend run cli -- doctor',
          'curl -fsS http://127.0.0.1:3005/api/v1/ops/secrets',
        ],
        warnings: [
          'Tuyệt đối không lưu `BACKUP_ENCRYPTION_KEY` chung thư mục/bucket với file backup đã mã hóa.',
        ],
      },
      {
        id: 'config',
        title: '4. Khôi phục Config & Hạ tầng Runtime',
        summary:
          'Khôi phục cấu hình tĩnh (Docker, Nginx, Prometheus) từ Git tag phát hành và cấu hình động (`system_settings`, `feature_flags`, `navigation`) trong DB.',
        steps: [
          'Checkout đúng tag/commit phát hành ổn định cho `docker-compose.prod.yml`, `docker/nginx/`, `docker/prometheus/`, `backend/project.manifest.json`.',
          'Khôi phục tệp `.env` chuẩn môi trường (kiểm tra `NODE_ENV`, `DB_HOST`, `REDIS_HOST`, `STORAGE_DRIVER`, `TRUSTED_PROXIES`).',
          'Sau khi DB lên, chạy `seed:run --scope=master` để đảm bảo permissions, menus và default policies đồng bộ.',
          'Khởi động lại theo thứ tự: DB & Redis → MinIO → API → Worker → Scheduler → Nginx.',
        ],
        commands: [
          'npm --prefix backend run cli -- seed:run --scope=master',
          'npm --prefix backend run cli -- arch:check',
        ],
        warnings: [
          'Kiểm tra lại `DB_SYNCHRONIZE=false` trên môi trường staging/production trước khi khởi động API.',
        ],
      },
    ],
    postRestoreChecklist: [
      'Kiểm tra `GET /api/v1/health` trả về `status: ok` cho DB, Redis, Storage.',
      'Chạy `npm --prefix backend run cli -- migration:check` xác nhận không thiếu migration.',
      'Kiểm tra dữ liệu nghiệp vụ trọng yếu (users, roles, files mới nhất) và đăng nhập thử.',
      'Khởi động lại Worker & Scheduler rồi kiểm tra nhịp heartbeat trên `/system-console/runtimes`.',
      'Xác nhận bản ghi `backup_restore_histories` và `audit_logs` đã lưu đủ người thực hiện và lý do.',
    ],
  };
}
