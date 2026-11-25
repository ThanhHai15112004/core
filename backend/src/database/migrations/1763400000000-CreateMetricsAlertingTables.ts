import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateMetricsAlertingTables (2026-11-25)
 * Triển khai Mục 12.3 — Metrics và Cảnh báo (`metrics-ops`):
 * 1. `alert_rules`: Cấu hình rule cảnh báo theo metricKey, scope, ngưỡng, thời gian duy trì (`for_seconds`), cooldown và severity.
 * 2. `alert_events`: Lịch sử sự kiện cảnh báo (`FIRING` | `ACKNOWLEDGED` | `RESOLVED`), fingerprint chống trùng lặp & trạng thái gửi theo severity.
 */
export class CreateMetricsAlertingTables1763400000000 implements MigrationInterface {
  public readonly name = 'CreateMetricsAlertingTables1763400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';
    const numType = isPostgres ? 'DOUBLE PRECISION' : 'DOUBLE';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id ${pkDef},
        code VARCHAR(80) NOT NULL,
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        metric_key VARCHAR(64) NOT NULL,
        scope_json TEXT NULL,
        operator VARCHAR(8) NOT NULL DEFAULT 'gt',
        threshold ${numType} NOT NULL,
        window_seconds INT NOT NULL DEFAULT 300,
        for_seconds INT NOT NULL DEFAULT 0,
        cooldown_seconds INT NOT NULL DEFAULT 300,
        severity VARCHAR(16) NOT NULL DEFAULT 'WARNING',
        channels_json TEXT NULL,
        webhook_url VARCHAR(500) NULL,
        notify_targets_json TEXT NULL,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        last_evaluated_at TIMESTAMP NULL,
        last_triggered_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alert_events (
        id ${pkDef},
        rule_id BIGINT NOT NULL,
        rule_code VARCHAR(80) NOT NULL,
        rule_name VARCHAR(160) NOT NULL,
        fingerprint VARCHAR(191) NOT NULL,
        severity VARCHAR(16) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'FIRING',
        metric_key VARCHAR(64) NOT NULL,
        metric_value ${numType} NOT NULL,
        threshold ${numType} NOT NULL,
        operator VARCHAR(8) NOT NULL,
        labels_json TEXT NULL,
        summary VARCHAR(500) NOT NULL,
        fired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_notified_at TIMESTAMP NULL,
        acknowledged_at TIMESTAMP NULL,
        acknowledged_by BIGINT NULL,
        acknowledge_note VARCHAR(500) NULL,
        resolved_at TIMESTAMP NULL,
        resolved_by BIGINT NULL,
        delivery_status_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_alert_rules_code ON alert_rules (code)',
      'CREATE INDEX IDX_alert_rules_enabled_metric ON alert_rules (is_enabled, metric_key, deleted_at)',
      'CREATE INDEX IDX_alert_events_fingerprint_status ON alert_events (fingerprint, status, deleted_at)',
      'CREATE INDEX IDX_alert_events_status_severity ON alert_events (status, severity, fired_at)',
      'CREATE INDEX IDX_alert_events_rule ON alert_events (rule_id, fired_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS alert_events');
    await queryRunner.query('DROP TABLE IF EXISTS alert_rules');
  }
}
