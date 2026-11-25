import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateIdempotencyRecordsTable (2026-11-25)
 * Triển khai Phase 11.3 — Chống xử lý trùng (Idempotency):
 * Bảng tập trung `idempotency_records` lưu khóa chống trùng cho cả 4 luồng
 * (`API` / `JOB` / `WEBHOOK` / `EVENT`), hỗ trợ kiểm tra payload fingerprint,
 * khóa chống race condition (`locked_until`), lưu phản hồi replay, TTL theo luồng
 * và thống kê tỷ lệ trùng / phát hiện client gửi lặp.
 */
export class CreateIdempotencyRecordsTable1763200000000 implements MigrationInterface {
  public readonly name = 'CreateIdempotencyRecordsTable1763200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS idempotency_records (
        id ${pkDef},
        scope VARCHAR(32) NOT NULL,
        scope_target VARCHAR(200) NOT NULL,
        idempotency_key VARCHAR(200) NOT NULL,
        request_fingerprint VARCHAR(128) NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        response_status_code INT NULL,
        response_body_json TEXT NULL,
        response_headers_json TEXT NULL,
        lock_owner VARCHAR(160) NULL,
        locked_until TIMESTAMP NULL,
        client_identifier VARCHAR(160) NULL,
        correlation_id VARCHAR(120) NULL,
        duplicate_hits INT NOT NULL DEFAULT 0,
        conflict_hits INT NOT NULL DEFAULT 0,
        last_duplicate_at TIMESTAMP NULL,
        last_conflict_at TIMESTAMP NULL,
        last_error_code VARCHAR(80) NULL,
        last_error_message VARCHAR(1000) NULL,
        completed_at TIMESTAMP NULL,
        expires_at TIMESTAMP NOT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_idempotency_records_scope_key ON idempotency_records (scope, scope_target, idempotency_key)',
      'CREATE INDEX IDX_idempotency_records_expires ON idempotency_records (expires_at)',
      'CREATE INDEX IDX_idempotency_records_scope_created ON idempotency_records (scope, created_at)',
      'CREATE INDEX IDX_idempotency_records_client_dup ON idempotency_records (client_identifier, last_duplicate_at)',
      'CREATE INDEX IDX_idempotency_records_status_lease ON idempotency_records (status, locked_until)',
      'CREATE INDEX IDX_idempotency_records_correlation ON idempotency_records (correlation_id)',
    ];

    for (const sql of indexes) {
      if (isPostgres) {
        await queryRunner.query(
          sql
            .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
            .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
        );
      } else {
        await queryRunner.query(sql).catch(() => undefined);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS idempotency_records');
  }
}
