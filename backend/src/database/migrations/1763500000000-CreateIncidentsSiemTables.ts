import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateIncidentsSiemTables (2026-11-25)
 * Triển khai Mục 12.6 — Quản lý sự cố và SIEM (`incidents-ops`):
 * 1. `incident_severity_policies`: Quy định mức độ sự cố P1, P2, P3, P4 và thời gian phản hồi/xử lý (SLA).
 * 2. `incident_runbooks`: Runbook xử lý sự cố (các bước kiểm tra, giảm ảnh hưởng, xác minh).
 * 3. `alert_owner_mappings`: Người phụ trách từng loại cảnh báo (không để alert không có owner).
 * 4. `incidents`: Lịch sử sự cố (nguyên nhân, cách xử lý, thời gian phục hồi, theo dõi cảnh báo lặp).
 * 5. `incident_postmortems`: Báo cáo sau sự cố (bài học và hành động phòng ngừa).
 * 6. `siem_dispatch_logs`: Nhật ký gửi sự kiện bảo mật & cảnh báo sang SIEM.
 */
export class CreateIncidentsSiemTables1763500000000 implements MigrationInterface {
  public readonly name = 'CreateIncidentsSiemTables1763500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS incident_severity_policies (
        id ${pkDef},
        severity VARCHAR(8) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        response_sla_minutes INT NOT NULL DEFAULT 60,
        resolution_sla_minutes INT NOT NULL DEFAULT 240,
        auto_escalate BOOLEAN NOT NULL DEFAULT TRUE,
        is_system BOOLEAN NOT NULL DEFAULT TRUE,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS incident_runbooks (
        id ${pkDef},
        code VARCHAR(80) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description VARCHAR(500) NULL,
        alert_code VARCHAR(100) NULL,
        default_severity VARCHAR(8) NOT NULL DEFAULT 'P2',
        triage_steps_json TEXT NOT NULL,
        mitigation_steps_json TEXT NOT NULL,
        verification_steps_json TEXT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alert_owner_mappings (
        id ${pkDef},
        alert_code VARCHAR(100) NOT NULL,
        alert_name VARCHAR(160) NOT NULL,
        source VARCHAR(24) NOT NULL DEFAULT 'SIEM',
        default_severity VARCHAR(8) NOT NULL DEFAULT 'P2',
        owner_user_id BIGINT NOT NULL,
        backup_owner_user_id BIGINT NULL,
        runbook_id BIGINT NULL,
        notify_channels_json TEXT NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id ${pkDef},
        incident_code VARCHAR(64) NOT NULL,
        title VARCHAR(240) NOT NULL,
        description TEXT NULL,
        source VARCHAR(24) NOT NULL DEFAULT 'SIEM',
        alert_code VARCHAR(100) NOT NULL,
        fingerprint VARCHAR(191) NOT NULL,
        severity VARCHAR(8) NOT NULL DEFAULT 'P2',
        status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
        owner_user_id BIGINT NOT NULL,
        runbook_id BIGINT NULL,
        occurrence_count INT NOT NULL DEFAULT 1,
        suppressed_count INT NOT NULL DEFAULT 0,
        is_repeated BOOLEAN NOT NULL DEFAULT FALSE,
        first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sla_due_at TIMESTAMP NULL,
        sla_breached BOOLEAN NOT NULL DEFAULT FALSE,
        acknowledged_at TIMESTAMP NULL,
        acknowledged_by BIGINT NULL,
        mitigated_at TIMESTAMP NULL,
        mitigated_by BIGINT NULL,
        resolved_at TIMESTAMP NULL,
        resolved_by BIGINT NULL,
        recovery_seconds INT NULL,
        root_cause TEXT NULL,
        mitigation_summary TEXT NULL,
        resolution_note TEXT NULL,
        metadata_json TEXT NULL,
        timeline_json TEXT NULL,
        siem_delivery_status_json TEXT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS incident_postmortems (
        id ${pkDef},
        incident_id BIGINT NOT NULL,
        incident_code VARCHAR(64) NOT NULL,
        title VARCHAR(240) NOT NULL,
        summary TEXT NOT NULL,
        impact_summary TEXT NULL,
        root_cause_analysis TEXT NOT NULL,
        lessons_learned TEXT NOT NULL,
        preventive_actions_json TEXT NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
        author_id BIGINT NULL,
        published_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS siem_dispatch_logs (
        id ${pkDef},
        event_type VARCHAR(80) NOT NULL,
        alert_code VARCHAR(100) NULL,
        severity VARCHAR(16) NOT NULL,
        driver VARCHAR(32) NOT NULL DEFAULT 'internal_log',
        destination VARCHAR(255) NOT NULL DEFAULT 'internal-siem-logger',
        status VARCHAR(20) NOT NULL DEFAULT 'SENT',
        http_status INT NULL,
        attempt_count INT NOT NULL DEFAULT 1,
        error_message VARCHAR(500) NULL,
        payload_json TEXT NULL,
        incident_id BIGINT NULL,
        actor_user_id BIGINT NULL,
        ip_address VARCHAR(64) NULL,
        dispatched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_incident_severity_policies_severity ON incident_severity_policies (severity)',
      'CREATE UNIQUE INDEX UQ_incident_runbooks_code ON incident_runbooks (code)',
      'CREATE INDEX IDX_incident_runbooks_alert_code ON incident_runbooks (alert_code, is_active, deleted_at)',
      'CREATE UNIQUE INDEX UQ_alert_owner_mappings_alert_code ON alert_owner_mappings (alert_code)',
      'CREATE INDEX IDX_alert_owner_mappings_owner ON alert_owner_mappings (owner_user_id, is_enabled, deleted_at)',
      'CREATE UNIQUE INDEX UQ_incidents_incident_code ON incidents (incident_code)',
      'CREATE INDEX IDX_incidents_fingerprint_status ON incidents (fingerprint, status, deleted_at)',
      'CREATE INDEX IDX_incidents_severity_status ON incidents (severity, status, last_seen_at)',
      'CREATE INDEX IDX_incidents_owner_status ON incidents (owner_user_id, status, deleted_at)',
      'CREATE INDEX IDX_incidents_repeated ON incidents (is_repeated, occurrence_count, last_seen_at)',
      'CREATE UNIQUE INDEX UQ_incident_postmortems_incident ON incident_postmortems (incident_id)',
      'CREATE INDEX IDX_siem_dispatch_logs_status_at ON siem_dispatch_logs (status, dispatched_at)',
      'CREATE INDEX IDX_siem_dispatch_logs_event_type ON siem_dispatch_logs (event_type, dispatched_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS siem_dispatch_logs');
    await queryRunner.query('DROP TABLE IF EXISTS incident_postmortems');
    await queryRunner.query('DROP TABLE IF EXISTS incidents');
    await queryRunner.query('DROP TABLE IF EXISTS alert_owner_mappings');
    await queryRunner.query('DROP TABLE IF EXISTS incident_runbooks');
    await queryRunner.query('DROP TABLE IF EXISTS incident_severity_policies');
  }
}
