import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: EnhanceNotificationTemplatesPhase96 (2026-11-03)
 * Triển khai toàn diện Mục 9.6 — Mẫu nội dung (Template):
 * 1. Mở rộng bảng `notification_templates`: bổ sung `template_type`, `document_format`, `version`, `published_version`, `status`, `published_at`, `published_by_user_id`.
 * 2. Tạo bảng `notification_template_versions`: lưu đa phiên bản mẫu (`DRAFT`, `PUBLISHED`, `ARCHIVED`) để không sửa trực tiếp bản đang dùng, hỗ trợ phát hành (`Publish`) và quay lại phiên bản cũ (`Rollback`) có Audit.
 * 3. Tạo bảng `notification_template_usages`: theo dõi các module/tính năng đang sử dụng mẫu để chặn xóa nhầm.
 */
export class EnhanceNotificationTemplatesPhase961762100000000 implements MigrationInterface {
  public readonly name = 'EnhanceNotificationTemplatesPhase961762100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    if (isPostgres) {
      await queryRunner.query(
        "ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(32) NOT NULL DEFAULT 'NOTIFICATION'",
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS document_format VARCHAR(32) NULL',
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1',
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS published_version INT NOT NULL DEFAULT 1',
      );
      await queryRunner.query(
        "ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'PUBLISHED'",
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS published_at TIMESTAMP NULL',
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS published_by_user_id INT NULL',
      );
    } else {
      if (!(await queryRunner.hasColumn('notification_templates', 'template_type'))) {
        await queryRunner.query(
          "ALTER TABLE notification_templates ADD COLUMN template_type VARCHAR(32) NOT NULL DEFAULT 'NOTIFICATION'",
        );
      }
      if (!(await queryRunner.hasColumn('notification_templates', 'document_format'))) {
        await queryRunner.query(
          'ALTER TABLE notification_templates ADD COLUMN document_format VARCHAR(32) NULL',
        );
      }
      if (!(await queryRunner.hasColumn('notification_templates', 'version'))) {
        await queryRunner.query(
          'ALTER TABLE notification_templates ADD COLUMN version INT NOT NULL DEFAULT 1',
        );
      }
      if (!(await queryRunner.hasColumn('notification_templates', 'published_version'))) {
        await queryRunner.query(
          'ALTER TABLE notification_templates ADD COLUMN published_version INT NOT NULL DEFAULT 1',
        );
      }
      if (!(await queryRunner.hasColumn('notification_templates', 'status'))) {
        await queryRunner.query(
          "ALTER TABLE notification_templates ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'PUBLISHED'",
        );
      }
      if (!(await queryRunner.hasColumn('notification_templates', 'published_at'))) {
        await queryRunner.query(
          'ALTER TABLE notification_templates ADD COLUMN published_at TIMESTAMP NULL',
        );
      }
      if (!(await queryRunner.hasColumn('notification_templates', 'published_by_user_id'))) {
        await queryRunner.query(
          'ALTER TABLE notification_templates ADD COLUMN published_by_user_id INT NULL',
        );
      }
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_template_versions (
        id ${pkDef},
        template_id INT NOT NULL,
        code VARCHAR(100) NOT NULL,
        channel INT NOT NULL DEFAULT 2,
        locale VARCHAR(16) NOT NULL DEFAULT 'vi',
        version INT NOT NULL DEFAULT 1,
        status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
        name VARCHAR(200) NOT NULL,
        template_type VARCHAR(32) NOT NULL DEFAULT 'NOTIFICATION',
        document_format VARCHAR(32) NULL,
        subject_template VARCHAR(500) NULL,
        body_template TEXT NOT NULL,
        html_template TEXT NULL,
        variables_json TEXT NULL,
        change_note VARCHAR(500) NULL,
        created_by_user_id INT NULL,
        published_at TIMESTAMP NULL,
        published_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_template_usages (
        id ${pkDef},
        template_code VARCHAR(100) NOT NULL,
        channel INT NULL,
        module_name VARCHAR(64) NOT NULL,
        feature_code VARCHAR(100) NOT NULL,
        entity_type VARCHAR(64) NULL,
        entity_id VARCHAR(100) NULL,
        description VARCHAR(255) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    if (isPostgres) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_tpl_versions_tpl_ver ON notification_template_versions (template_id, version)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_notification_tpl_versions_code_ch_loc ON notification_template_versions (code, channel, locale)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_notification_tpl_usages_code ON notification_template_usages (template_code)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_notification_tpl_usages_module ON notification_template_usages (module_name)',
      );
      await queryRunner.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_tpl_usages_code_mod_feat ON notification_template_usages (template_code, module_name, feature_code)',
      );
    } else {
      await queryRunner
        .query(
          'CREATE UNIQUE INDEX uq_notification_tpl_versions_tpl_ver ON notification_template_versions (template_id, version)',
        )
        .catch(() => undefined);
      await queryRunner
        .query(
          'CREATE INDEX idx_notification_tpl_versions_code_ch_loc ON notification_template_versions (code, channel, locale)',
        )
        .catch(() => undefined);
      await queryRunner
        .query(
          'CREATE INDEX idx_notification_tpl_usages_code ON notification_template_usages (template_code)',
        )
        .catch(() => undefined);
      await queryRunner
        .query(
          'CREATE INDEX idx_notification_tpl_usages_module ON notification_template_usages (module_name)',
        )
        .catch(() => undefined);
      await queryRunner
        .query(
          'CREATE UNIQUE INDEX uq_notification_tpl_usages_code_mod_feat ON notification_template_usages (template_code, module_name, feature_code)',
        )
        .catch(() => undefined);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    await queryRunner.query('DROP TABLE IF EXISTS notification_template_usages');
    await queryRunner.query('DROP TABLE IF EXISTS notification_template_versions');

    if (isPostgres) {
      await queryRunner.query(
        'ALTER TABLE notification_templates DROP COLUMN IF EXISTS published_by_user_id',
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates DROP COLUMN IF EXISTS published_at',
      );
      await queryRunner.query('ALTER TABLE notification_templates DROP COLUMN IF EXISTS status');
      await queryRunner.query(
        'ALTER TABLE notification_templates DROP COLUMN IF EXISTS published_version',
      );
      await queryRunner.query('ALTER TABLE notification_templates DROP COLUMN IF EXISTS version');
      await queryRunner.query(
        'ALTER TABLE notification_templates DROP COLUMN IF EXISTS document_format',
      );
      await queryRunner.query(
        'ALTER TABLE notification_templates DROP COLUMN IF EXISTS template_type',
      );
    } else {
      for (const col of [
        'published_by_user_id',
        'published_at',
        'status',
        'published_version',
        'version',
        'document_format',
        'template_type',
      ]) {
        if (await queryRunner.hasColumn('notification_templates', col)) {
          await queryRunner.query(`ALTER TABLE notification_templates DROP COLUMN ${col}`);
        }
      }
    }
  }
}
