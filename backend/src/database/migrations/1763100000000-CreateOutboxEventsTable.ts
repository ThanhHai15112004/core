import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateOutboxEventsTable (2026-11-25)
 * Triển khai Phase 11.2 — Transactional Outbox (`outbox`):
 * Bảng tập trung `outbox_events` lưu Domain Event trong cùng transaction nghiệp vụ,
 * hỗ trợ lease lock đa Worker, retry giới hạn có backoff, Dead Letter điều tra,
 * theo dõi độ trễ/tồn đọng, phát lại có quyền + audit và dọn bản ghi cũ theo retention policy.
 */
export class CreateOutboxEventsTable1763100000000 implements MigrationInterface {
  public readonly name = 'CreateOutboxEventsTable1763100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id ${pkDef},
        event_id VARCHAR(120) NOT NULL,
        event_type VARCHAR(160) NOT NULL,
        dot_name VARCHAR(160) NOT NULL,
        event_version INT NOT NULL DEFAULT 1,
        source_module VARCHAR(80) NOT NULL,
        aggregate_type VARCHAR(120) NULL,
        aggregate_id VARCHAR(160) NULL,
        partition_key VARCHAR(200) NULL,
        destination_queue VARCHAR(120) NOT NULL DEFAULT 'system.events',
        destination_topic VARCHAR(160) NOT NULL DEFAULT 'outbox.domain_event',
        payload_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        headers_json TEXT NULL,
        request_id VARCHAR(120) NULL,
        correlation_id VARCHAR(120) NULL,
        causation_id VARCHAR(120) NULL,
        actor_id VARCHAR(120) NULL,
        occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status SMALLINT NOT NULL DEFAULT 1,
        attempt_count INT NOT NULL DEFAULT 0,
        max_retries INT NOT NULL DEFAULT 5,
        next_attempt_at TIMESTAMP NULL,
        locked_by VARCHAR(160) NULL,
        locked_until TIMESTAMP NULL,
        last_attempted_at TIMESTAMP NULL,
        published_at TIMESTAMP NULL,
        last_error_code VARCHAR(80) NULL,
        last_error_message VARCHAR(1000) NULL,
        dead_lettered_at TIMESTAMP NULL,
        dead_letter_reason VARCHAR(500) NULL,
        replay_count INT NOT NULL DEFAULT 0,
        last_replayed_at TIMESTAMP NULL,
        last_replayed_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_outbox_events_event_id ON outbox_events (event_id)',
      'CREATE INDEX IDX_outbox_events_dispatch ON outbox_events (status, next_attempt_at, id)',
      'CREATE INDEX IDX_outbox_events_lease ON outbox_events (status, locked_until)',
      'CREATE INDEX IDX_outbox_events_source_type ON outbox_events (source_module, event_type, created_at)',
      'CREATE INDEX IDX_outbox_events_correlation ON outbox_events (correlation_id)',
      'CREATE INDEX IDX_outbox_events_published_at ON outbox_events (status, published_at)',
      'CREATE INDEX IDX_outbox_events_dead_lettered_at ON outbox_events (status, dead_lettered_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS outbox_events');
  }
}
