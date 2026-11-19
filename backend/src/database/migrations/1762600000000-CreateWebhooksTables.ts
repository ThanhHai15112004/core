import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateWebhooksTables (2026-11-19)
 * Triển khai Phase 10.2 — Outbound Webhooks (`webhooks`):
 * 1. `webhook_endpoints`: Cấu hình đích nhận webhook, danh sách sự kiện đăng ký, secret ký HMAC (mã hóa AES-256-GCM), retry/threshold và trạng thái tự khóa.
 * 2. `webhook_deliveries`: Nhật ký từng lần phát webhook (gồm payload, trạng thái gửi, số lần thử, nguồn kích hoạt EVENT/MANUAL_REPLAY/TEST, tham chiếu replay).
 * 3. `webhook_delivery_attempts`: Lịch sử chi tiết từng lần thử HTTP (request headers đã redact, HTTP status, response snippet, thời gian xử lý và mã lỗi).
 */
export class CreateWebhooksTables1762600000000 implements MigrationInterface {
  public readonly name = 'CreateWebhooksTables1762600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id ${pkDef},
        name VARCHAR(180) NOT NULL,
        description VARCHAR(500) NULL,
        target_url VARCHAR(1000) NOT NULL,
        events_json TEXT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        signing_secret_encrypted TEXT NOT NULL,
        signing_secret_prefix VARCHAR(32) NOT NULL,
        custom_headers_json TEXT NULL,
        timeout_ms INT NOT NULL DEFAULT 10000,
        max_retries SMALLINT NOT NULL DEFAULT 5,
        failure_threshold SMALLINT NOT NULL DEFAULT 10,
        consecutive_failures INT NOT NULL DEFAULT 0,
        disabled_reason VARCHAR(500) NULL,
        disabled_at TIMESTAMP NULL,
        last_triggered_at TIMESTAMP NULL,
        last_success_at TIMESTAMP NULL,
        last_failure_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id ${pkDef},
        delivery_uid VARCHAR(64) NOT NULL,
        endpoint_id BIGINT NOT NULL,
        event_name VARCHAR(160) NOT NULL,
        event_id VARCHAR(120) NOT NULL,
        payload_json TEXT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        trigger_source VARCHAR(32) NOT NULL DEFAULT 'EVENT',
        replayed_from_delivery_id BIGINT NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 6,
        last_http_status INT NULL,
        last_error_code VARCHAR(80) NULL,
        last_error_message VARCHAR(1000) NULL,
        next_retry_at TIMESTAMP NULL,
        delivered_at TIMESTAMP NULL,
        correlation_id VARCHAR(120) NULL,
        requested_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
        id ${pkDef},
        delivery_id BIGINT NOT NULL,
        endpoint_id BIGINT NOT NULL,
        attempt_number INT NOT NULL DEFAULT 1,
        request_url VARCHAR(1000) NOT NULL,
        request_headers_json TEXT NULL,
        response_status INT NULL,
        response_headers_json TEXT NULL,
        response_body_snippet TEXT NULL,
        duration_ms INT NOT NULL DEFAULT 0,
        is_success BOOLEAN NOT NULL DEFAULT FALSE,
        error_code VARCHAR(80) NULL,
        error_message VARCHAR(1000) NULL,
        attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE INDEX IDX_webhook_endpoints_status ON webhook_endpoints (status, deleted_at)',
      'CREATE INDEX IDX_webhook_endpoints_created ON webhook_endpoints (created_at)',
      'CREATE UNIQUE INDEX UQ_webhook_deliveries_uid ON webhook_deliveries (delivery_uid)',
      'CREATE INDEX IDX_webhook_deliveries_endpoint_status ON webhook_deliveries (endpoint_id, status, created_at)',
      'CREATE INDEX IDX_webhook_deliveries_event_created ON webhook_deliveries (event_name, created_at)',
      'CREATE INDEX IDX_webhook_deliveries_replayed_from ON webhook_deliveries (replayed_from_delivery_id)',
      'CREATE INDEX IDX_webhook_delivery_attempts_delivery_num ON webhook_delivery_attempts (delivery_id, attempt_number)',
      'CREATE INDEX IDX_webhook_delivery_attempts_endpoint_time ON webhook_delivery_attempts (endpoint_id, attempted_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS webhook_delivery_attempts');
    await queryRunner.query('DROP TABLE IF EXISTS webhook_deliveries');
    await queryRunner.query('DROP TABLE IF EXISTS webhook_endpoints');
  }
}
