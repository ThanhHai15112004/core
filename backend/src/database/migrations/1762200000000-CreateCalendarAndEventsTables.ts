import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateCalendarAndEventsTables (2026-11-03)
 * Triển khai toàn diện Mục 9.7 — Lịch và sự kiện (Calendar & Event):
 * 1. `calendar_events`: Sự kiện có thời gian bắt đầu/kết thúc, lặp lại (DAILY/WEEKLY/MONTHLY), tài nguyên, chủ sở hữu, đơn vị và liên kết Google/Microsoft Calendar.
 * 2. `calendar_event_participants`: Người tham gia sự kiện (Người dùng `USER` hoặc Đơn vị `ORGANIZATION_UNIT`), phân quyền chỉnh sửa và phản hồi RSVP.
 * 3. `calendar_event_reminders`: Hàng đợi/lịch nhắc sự kiện qua Notification và Scheduler.
 * 4. `calendar_event_histories`: Lịch sử thay đổi sự kiện bất biến, ghi rõ nguồn thay đổi (`WEB_UI`, `API`, `SCHEDULER`, `GOOGLE_SYNC`, `MICROSOFT_SYNC`, `SYSTEM`).
 */
export class CreateCalendarAndEventsTables1762200000000 implements MigrationInterface {
  public readonly name = 'CreateCalendarAndEventsTables1762200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id ${pkDef},
        code VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        event_type VARCHAR(64) NOT NULL DEFAULT 'MEETING',
        status INT NOT NULL DEFAULT 1,
        visibility VARCHAR(32) NOT NULL DEFAULT 'PUBLIC',
        start_at TIMESTAMP NOT NULL,
        end_at TIMESTAMP NOT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
        location VARCHAR(255) NULL,
        meeting_url VARCHAR(500) NULL,
        resource_code VARCHAR(64) NULL,
        resource_name VARCHAR(180) NULL,
        owner_user_id INT NOT NULL,
        organization_unit_id INT NULL,
        recurrence_rule_json TEXT NULL,
        reminders_json TEXT NULL,
        external_bindings_json TEXT NULL,
        metadata_json TEXT NULL,
        cancel_reason VARCHAR(500) NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS calendar_event_participants (
        id ${pkDef},
        calendar_event_id INT NOT NULL,
        participant_type VARCHAR(32) NOT NULL DEFAULT 'USER',
        user_id INT NULL,
        organization_unit_id INT NULL,
        participant_role VARCHAR(32) NOT NULL DEFAULT 'ATTENDEE',
        can_edit BOOLEAN NOT NULL DEFAULT FALSE,
        rsvp_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        response_note VARCHAR(500) NULL,
        responded_at TIMESTAMP NULL,
        added_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS calendar_event_reminders (
        id ${pkDef},
        calendar_event_id INT NOT NULL,
        occurrence_start_at TIMESTAMP NOT NULL,
        minutes_before INT NOT NULL DEFAULT 15,
        remind_at TIMESTAMP NOT NULL,
        channels_json TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        notification_id INT NULL,
        recipient_count INT NOT NULL DEFAULT 0,
        sent_at TIMESTAMP NULL,
        error_message VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS calendar_event_histories (
        id ${pkDef},
        calendar_event_id INT NOT NULL,
        action_type VARCHAR(64) NOT NULL DEFAULT 'UPDATED',
        change_source VARCHAR(32) NOT NULL DEFAULT 'WEB_UI',
        actor_user_id INT NULL,
        changed_fields_json TEXT NULL,
        before_snapshot_json TEXT NULL,
        after_snapshot_json TEXT NULL,
        reason VARCHAR(500) NULL,
        metadata_json TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX idx_cal_events_code ON calendar_events (code)',
      'CREATE INDEX idx_cal_events_time_range ON calendar_events (start_at, end_at, status)',
      'CREATE INDEX idx_cal_events_owner ON calendar_events (owner_user_id, status)',
      'CREATE INDEX idx_cal_events_org_unit ON calendar_events (organization_unit_id, status)',
      'CREATE INDEX idx_cal_events_resource ON calendar_events (resource_code, start_at, end_at)',
      'CREATE INDEX idx_cal_part_event ON calendar_event_participants (calendar_event_id)',
      'CREATE INDEX idx_cal_part_user ON calendar_event_participants (user_id, rsvp_status)',
      'CREATE INDEX idx_cal_part_org ON calendar_event_participants (organization_unit_id)',
      'CREATE INDEX idx_cal_rem_status_time ON calendar_event_reminders (status, remind_at)',
      'CREATE INDEX idx_cal_rem_event ON calendar_event_reminders (calendar_event_id)',
      'CREATE INDEX idx_cal_hist_event_time ON calendar_event_histories (calendar_event_id, created_at)',
      'CREATE INDEX idx_cal_hist_source ON calendar_event_histories (change_source)',
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
    await queryRunner.query('DROP TABLE IF EXISTS calendar_event_histories');
    await queryRunner.query('DROP TABLE IF EXISTS calendar_event_reminders');
    await queryRunner.query('DROP TABLE IF EXISTS calendar_event_participants');
    await queryRunner.query('DROP TABLE IF EXISTS calendar_events');
  }
}
