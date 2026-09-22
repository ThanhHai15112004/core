# Migrations

TypeORM migrations của Core (`*.ts` khi chạy từ source, `*.js` sau khi build).
Trạng thái applied/pending hiển thị ở System Console → Database → Migrations; bảng lưu lịch sử là
`DB_MIGRATIONS_TABLE` (mặc định `core_migrations`). Chạy từ Console chỉ khi `OPS_DATABASE_MIGRATIONS_ENABLED=true`.
