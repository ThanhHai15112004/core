import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateInboundWebhooksTables (2026-11-19)
 * Triển khai Phase 10.3 — Inbound Webhooks (`inbound-webhooks`):
 * 1. `inbound_webhook_providers`: Cấu hình từng provider nhận webhook ngoài, thuật toán xác thực (HMAC-SHA256/HMAC-SHA512/STATIC_TOKEN), secret mã hóa AES-256-GCM, header/path trích xuất timestamp/eventId/eventType, danh sách field nhạy cảm.
 * 2. `inbound_webhook_events`: Nhật ký sự kiện nhận vào kèm khóa idempotency `(provider_code, external_event_id)`, hash payload đối soát, headers/payload đã che dữ liệu nhạy cảm và trạng thái xử lý.
 * 3. `inbound_webhook_attempts`: Lịch sử chi tiết từng lần Worker thực thi handler cho một inbound event.
 */
export class CreateInboundWebhooksTables1762700000000 implements MigrationInterface {
  public readonly name = 'CreateInboundWebhooksTables1762700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbound_webhook_providers (
        id ${pkDef},
        provider_code VARCHAR(64) NOT NULL,
        name VARCHAR(180) NOT NULL,
        description VARCHAR(500) NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        auth_type VARCHAR(32) NOT NULL DEFAULT 'HMAC_SHA256',
        signing_secret_encrypted TEXT NOT NULL,
        signing_secret_prefix VARCHAR(32) NOT NULL,
        signature_header VARCHAR(120) NOT NULL DEFAULT 'x-webhook-signature',
        signature_prefix VARCHAR(32) NULL DEFAULT 'v1=',
        signature_format VARCHAR(32) NOT NULL DEFAULT 'TIMESTAMP_DOT_BODY',
        timestamp_header VARCHAR(120) NOT NULL DEFAULT 'x-webhook-timestamp',
        require_timestamp BOOLEAN NOT NULL DEFAULT TRUE,
        tolerance_sec INT NOT NULL DEFAULT 300,
        event_id_header VARCHAR(120) NOT NULL DEFAULT 'x-webhook-id',
        event_id_payload_path VARCHAR(160) NULL DEFAULT 'id',
        event_type_header VARCHAR(120) NOT NULL DEFAULT 'x-webhook-event',
        event_type_payload_path VARCHAR(160) NULL DEFAULT 'type',
        sensitive_fields_json TEXT NULL,
        max_retries SMALLINT NOT NULL DEFAULT 3,
        last_received_at TIMESTAMP NULL,
        last_processed_at TIMESTAMP NULL,
        last_rejected_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbound_webhook_events (
        id ${pkDef},
        event_uid VARCHAR(64) NOT NULL,
        provider_id BIGINT NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        external_event_id VARCHAR(160) NULL,
        event_type VARCHAR(160) NULL,
        event_timestamp TIMESTAMP NULL,
        payload_hash VARCHAR(64) NOT NULL,
        headers_redacted_json TEXT NULL,
        payload_redacted_json TEXT NULL,
        payload_size_bytes INT NOT NULL DEFAULT 0,
        payload_truncated BOOLEAN NOT NULL DEFAULT FALSE,
        source_ip_masked VARCHAR(64) NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        rejection_reason VARCHAR(80) NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 4,
        duplicate_count INT NOT NULL DEFAULT 0,
        last_duplicate_at TIMESTAMP NULL,
        last_handler_name VARCHAR(160) NULL,
        last_error_code VARCHAR(80) NULL,
        last_error_message VARCHAR(1000) NULL,
        received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL,
        correlation_id VARCHAR(120) NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbound_webhook_attempts (
        id ${pkDef},
        event_id BIGINT NOT NULL,
        provider_id BIGINT NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        attempt_number INT NOT NULL DEFAULT 1,
        handler_name VARCHAR(160) NOT NULL,
        is_success BOOLEAN NOT NULL DEFAULT FALSE,
        duration_ms INT NOT NULL DEFAULT 0,
        result_summary_json TEXT NULL,
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
      'CREATE UNIQUE INDEX UQ_inbound_webhook_providers_code ON inbound_webhook_providers (provider_code)',
      'CREATE INDEX IDX_inbound_webhook_providers_status ON inbound_webhook_providers (status, deleted_at)',
      'CREATE UNIQUE INDEX UQ_inbound_webhook_events_uid ON inbound_webhook_events (event_uid)',
      'CREATE UNIQUE INDEX UQ_inbound_webhook_events_idempotency ON inbound_webhook_events (provider_code, external_event_id)',
      'CREATE INDEX IDX_inbound_webhook_events_provider_status ON inbound_webhook_events (provider_code, status, created_at)',
      'CREATE INDEX IDX_inbound_webhook_events_type_created ON inbound_webhook_events (event_type, created_at)',
      'CREATE INDEX IDX_inbound_webhook_events_received ON inbound_webhook_events (received_at)',
      'CREATE INDEX IDX_inbound_webhook_attempts_event_num ON inbound_webhook_attempts (event_id, attempt_number)',
      'CREATE INDEX IDX_inbound_webhook_attempts_provider_time ON inbound_webhook_attempts (provider_code, attempted_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS inbound_webhook_attempts');
    await queryRunner.query('DROP TABLE IF EXISTS inbound_webhook_events');
    await queryRunner.query('DROP TABLE IF EXISTS inbound_webhook_providers');
  }
}
