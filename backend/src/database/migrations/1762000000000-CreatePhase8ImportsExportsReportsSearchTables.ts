import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreatePhase8ImportsExportsReportsSearchTables (2026-10-27)
 * Triển khai lưu trữ Database cho 4 module nền tảng của Phase 8 (thay thế các mảng lưu tạm trên RAM):
 * 1. `import_histories` (Module `imports` — Mục 8.2): Lịch sử Import (file, người thực hiện, ánh xạ cột, chiến lược xử lý trùng, tiến độ & lỗi chi tiết).
 * 2. `export_histories` (Module `exports` — Mục 8.3): Lịch sử Export & file tạm có thời hạn (`download_token`, `expires_at`, bộ lọc, số dòng).
 * 3. `report_schedules` (Module `reports` — Mục 8.4): Lịch gửi báo cáo định kỳ (`DAILY` / `WEEKLY` / `MONTHLY`, tham số, kênh gửi).
 * 4. `report_histories` (Module `reports` — Mục 8.4): Lịch sử thực thi báo cáo (thời gian, người chạy, nguồn dữ liệu `PRIMARY`/`REPLICA`/`CACHE`, kết quả & file tạm).
 * 5. `search_documents` (Module `search` — Mục 8.5): Chỉ mục tìm kiếm Database cho dự án nhỏ & đồng bộ Search Index kèm phạm vi dữ liệu.
 * 6. `search_sync_histories` (Module `search` — Mục 8.5): Lịch sử đồng bộ & tạo lại (`SYNC` / `REBUILD`) Search Index.
 * 7. `search_zero_result_keywords` (Module `search` — Mục 8.5): Thống kê từ khóa tìm kiếm không có kết quả.
 */
export class CreatePhase8ImportsExportsReportsSearchTables1762000000000 implements MigrationInterface {
  public readonly name = 'CreatePhase8ImportsExportsReportsSearchTables1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    // 1. Bảng import_histories (Module imports - 8.2)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS import_histories (
        id ${pkDef},
        profile_code VARCHAR(64) NOT NULL,
        module VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        format VARCHAR(16) NOT NULL DEFAULT 'xlsx',
        duplicate_strategy VARCHAR(16) NOT NULL DEFAULT 'SKIP',
        column_mapping_json TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
        job_id VARCHAR(128) NULL,
        actor_id INT NULL,
        total_rows INT NOT NULL DEFAULT 0,
        processed_rows INT NOT NULL DEFAULT 0,
        created_count INT NOT NULL DEFAULT 0,
        updated_count INT NOT NULL DEFAULT 0,
        skipped_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        errors_json TEXT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_import_histories_module_profile ON import_histories (module, profile_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_import_histories_actor_status ON import_histories (actor_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_import_histories_job_id ON import_histories (job_id)`,
    );

    // 2. Bảng export_histories (Module exports - 8.3)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS export_histories (
        id ${pkDef},
        profile_code VARCHAR(64) NOT NULL,
        module VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        format VARCHAR(16) NOT NULL DEFAULT 'xlsx',
        status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
        job_id VARCHAR(128) NULL,
        actor_id INT NULL,
        filters_json TEXT NULL,
        total_exported INT NOT NULL DEFAULT 0,
        processed_rows INT NOT NULL DEFAULT 0,
        max_rows_applied INT NOT NULL DEFAULT 5000,
        download_token VARCHAR(128) NULL,
        download_url VARCHAR(500) NULL,
        content_type VARCHAR(128) NULL,
        file_size_bytes INT NOT NULL DEFAULT 0,
        file_payload_base64 TEXT NULL,
        expires_at TIMESTAMP NULL,
        is_expired BOOLEAN NOT NULL DEFAULT FALSE,
        notified_at TIMESTAMP NULL,
        error_message TEXT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_export_histories_module_profile ON export_histories (module, profile_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_export_histories_download_token ON export_histories (download_token)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_export_histories_expires_at ON export_histories (is_expired, expires_at)`,
    );

    // 3. Bảng report_schedules (Module reports - 8.4)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS report_schedules (
        id ${pkDef},
        report_code VARCHAR(128) NOT NULL,
        module VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        frequency VARCHAR(32) NOT NULL DEFAULT 'DAILY',
        cron_expression VARCHAR(64) NOT NULL,
        hour INT NOT NULL DEFAULT 8,
        minute INT NOT NULL DEFAULT 0,
        day_of_week INT NULL,
        day_of_month INT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        format VARCHAR(16) NOT NULL DEFAULT 'xlsx',
        parameters_json TEXT NULL,
        channels_json TEXT NULL,
        recipient_emails_json TEXT NULL,
        recipient_user_ids_json TEXT NULL,
        ttl_seconds INT NOT NULL DEFAULT 3600,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        actor_id INT NULL,
        last_run_at TIMESTAMP NULL,
        next_run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_history_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_report_schedules_module_code ON report_schedules (module, report_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_report_schedules_active_due ON report_schedules (is_active, next_run_at)`,
    );

    // 4. Bảng report_histories (Module reports - 8.4)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS report_histories (
        id ${pkDef},
        report_code VARCHAR(128) NOT NULL,
        module VARCHAR(64) NOT NULL,
        report_name VARCHAR(255) NOT NULL,
        actor_id INT NULL,
        job_id VARCHAR(128) NULL,
        schedule_id INT NULL,
        parameters_json TEXT NULL,
        execution_mode VARCHAR(32) NOT NULL DEFAULT 'SYNC',
        data_source_used VARCHAR(32) NOT NULL DEFAULT 'PRIMARY',
        cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
        cache_key VARCHAR(255) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
        format VARCHAR(16) NULL,
        file_name VARCHAR(255) NULL,
        total_records INT NOT NULL DEFAULT 0,
        summary_json TEXT NULL,
        download_token VARCHAR(128) NULL,
        download_url VARCHAR(500) NULL,
        expires_at TIMESTAMP NULL,
        is_expired BOOLEAN NOT NULL DEFAULT FALSE,
        notified_channels_json TEXT NULL,
        recipient_emails_json TEXT NULL,
        recipient_user_ids_json TEXT NULL,
        error_message TEXT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_report_histories_module_code ON report_histories (module, report_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_report_histories_download_token ON report_histories (download_token)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_report_histories_schedule_id ON report_histories (schedule_id)`,
    );

    // 5. Bảng search_documents (Module search - 8.5)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS search_documents (
        id ${pkDef},
        document_key VARCHAR(190) NOT NULL,
        entity_code VARCHAR(128) NOT NULL,
        module VARCHAR(64) NOT NULL,
        entity_type VARCHAR(64) NOT NULL,
        entity_id VARCHAR(128) NOT NULL,
        title VARCHAR(255) NOT NULL,
        subtitle VARCHAR(255) NULL,
        keywords_json TEXT NULL,
        searchable_text TEXT NOT NULL,
        owner_id INT NULL,
        organization_unit_id INT NULL,
        status VARCHAR(32) NULL,
        metadata_json TEXT NULL,
        source_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        indexed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_search_documents_key ON search_documents (document_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_search_documents_module_entity ON search_documents (module, entity_code, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_search_documents_scope ON search_documents (organization_unit_id, owner_id)`,
    );

    // 6. Bảng search_sync_histories (Module search - 8.5)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS search_sync_histories (
        id ${pkDef},
        operation VARCHAR(32) NOT NULL DEFAULT 'SYNC',
        module VARCHAR(64) NOT NULL,
        entity_type VARCHAR(64) NULL,
        entity_code VARCHAR(128) NULL,
        driver_used VARCHAR(32) NOT NULL DEFAULT 'DATABASE',
        execution_mode VARCHAR(32) NOT NULL DEFAULT 'SYNC',
        status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
        indexed_count INT NOT NULL DEFAULT 0,
        removed_count INT NOT NULL DEFAULT 0,
        job_id VARCHAR(128) NULL,
        actor_id INT NULL,
        error_message TEXT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_ms INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_search_sync_histories_module ON search_sync_histories (module, operation)`,
    );

    // 7. Bảng search_zero_result_keywords (Module search - 8.5)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS search_zero_result_keywords (
        id ${pkDef},
        keyword_key VARCHAR(255) NOT NULL,
        keyword VARCHAR(200) NOT NULL,
        normalized_keyword VARCHAR(200) NOT NULL,
        module VARCHAR(64) NULL,
        entity_type VARCHAR(64) NULL,
        search_count INT NOT NULL DEFAULT 1,
        first_searched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_searched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_actor_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_search_zero_result_keyword_key ON search_zero_result_keywords (keyword_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_search_zero_result_count ON search_zero_result_keywords (module, search_count)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS search_zero_result_keywords`);
    await queryRunner.query(`DROP TABLE IF EXISTS search_sync_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS search_documents`);
    await queryRunner.query(`DROP TABLE IF EXISTS report_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS report_schedules`);
    await queryRunner.query(`DROP TABLE IF EXISTS export_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS import_histories`);
  }
}
