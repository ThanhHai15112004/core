import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateCustomFieldsAndMetadataTables (2026-11-03)
 * Triển khai toàn diện Mục 9.8 — Trường tùy chỉnh và Metadata (Custom Fields & Metadata):
 * 1. `custom_field_definitions`: Cấu hình trường tùy chỉnh theo loại đối tượng (`entity_code`), kiểu dữ liệu (`TEXT`, `NUMBER`, `DATE`, `BOOLEAN`, `SELECT`), bắt buộc & validation, quyền xem/sửa từng trường, hiển thị API và cờ đánh index (`is_indexed`).
 * 2. `custom_field_options`: Danh sách lựa chọn cho trường `SELECT` có thứ tự (`sort_order`) và trạng thái (`status`).
 * 3. `custom_field_values`: Giá trị trường tùy chỉnh gắn với từng bản ghi (`entity_code` + `record_id`), có cột đánh index theo kiểu dữ liệu và mã hóa `AES-256-GCM` cho trường nhạy cảm (`encrypted_value`).
 * 4. `custom_field_histories`: Lịch sử thay đổi cấu hình trường bất biến (bao gồm ghi nhận chặn đổi `data_type` tùy tiện).
 */
export class CreateCustomFieldsAndMetadataTables1762300000000 implements MigrationInterface {
  public readonly name = 'CreateCustomFieldsAndMetadataTables1762300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS custom_field_definitions (
        id ${pkDef},
        entity_code VARCHAR(120) NOT NULL,
        field_key VARCHAR(100) NOT NULL,
        module VARCHAR(80) NOT NULL DEFAULT 'custom',
        name VARCHAR(180) NOT NULL,
        description VARCHAR(500) NULL,
        data_type VARCHAR(32) NOT NULL DEFAULT 'TEXT',
        default_value_json TEXT NULL,
        validation_rules_json TEXT NULL,
        code_type_code VARCHAR(120) NULL,
        is_required BOOLEAN NOT NULL DEFAULT FALSE,
        is_indexed BOOLEAN NOT NULL DEFAULT FALSE,
        show_in_api BOOLEAN NOT NULL DEFAULT TRUE,
        show_in_list BOOLEAN NOT NULL DEFAULT TRUE,
        show_in_detail BOOLEAN NOT NULL DEFAULT TRUE,
        is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        view_permission VARCHAR(120) NULL,
        edit_permission VARCHAR(120) NULL,
        allowed_view_roles_json TEXT NULL,
        allowed_edit_roles_json TEXT NULL,
        sort_order INT NOT NULL DEFAULT 1,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        status SMALLINT NOT NULL DEFAULT 1,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS custom_field_options (
        id ${pkDef},
        field_id BIGINT NOT NULL,
        option_code VARCHAR(120) NOT NULL,
        option_label VARCHAR(200) NOT NULL,
        labels_json TEXT NULL,
        color VARCHAR(40) NULL,
        sort_order INT NOT NULL DEFAULT 1,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        status SMALLINT NOT NULL DEFAULT 1,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS custom_field_values (
        id ${pkDef},
        entity_code VARCHAR(120) NOT NULL,
        record_id VARCHAR(120) NOT NULL,
        field_id BIGINT NOT NULL,
        field_key VARCHAR(100) NOT NULL,
        data_type VARCHAR(32) NOT NULL DEFAULT 'TEXT',
        value_text VARCHAR(500) NULL,
        value_number DECIMAL(18, 4) NULL,
        value_date VARCHAR(40) NULL,
        value_boolean BOOLEAN NULL,
        option_code VARCHAR(120) NULL,
        option_label VARCHAR(200) NULL,
        value_json TEXT NULL,
        encrypted_value TEXT NULL,
        updated_by_user_id BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS custom_field_histories (
        id ${pkDef},
        field_id BIGINT NOT NULL,
        entity_code VARCHAR(120) NOT NULL,
        field_key VARCHAR(100) NOT NULL,
        action_type VARCHAR(60) NOT NULL DEFAULT 'UPDATED',
        changed_fields_json TEXT NULL,
        before_snapshot_json TEXT NULL,
        after_snapshot_json TEXT NULL,
        reason VARCHAR(500) NULL,
        actor_user_id BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_custom_field_definitions_entity_field_key ON custom_field_definitions (entity_code, field_key)',
      'CREATE INDEX IDX_custom_field_definitions_entity_status ON custom_field_definitions (entity_code, status, sort_order)',
      'CREATE UNIQUE INDEX UQ_custom_field_options_field_code ON custom_field_options (field_id, option_code)',
      'CREATE INDEX IDX_custom_field_options_field_sort ON custom_field_options (field_id, status, sort_order)',
      'CREATE UNIQUE INDEX UQ_custom_field_values_entity_record_field ON custom_field_values (entity_code, record_id, field_key)',
      'CREATE INDEX IDX_custom_field_values_entity_record ON custom_field_values (entity_code, record_id)',
      'CREATE INDEX IDX_custom_field_values_indexed_text ON custom_field_values (entity_code, field_key, value_text)',
      'CREATE INDEX IDX_custom_field_values_indexed_number ON custom_field_values (entity_code, field_key, value_number)',
      'CREATE INDEX IDX_custom_field_values_indexed_date ON custom_field_values (entity_code, field_key, value_date)',
      'CREATE INDEX IDX_custom_field_values_indexed_boolean ON custom_field_values (entity_code, field_key, value_boolean)',
      'CREATE INDEX IDX_custom_field_values_indexed_option ON custom_field_values (entity_code, field_key, option_code)',
      'CREATE INDEX IDX_custom_field_histories_field_created ON custom_field_histories (field_id, created_at)',
      'CREATE INDEX IDX_custom_field_histories_entity_field ON custom_field_histories (entity_code, field_key, created_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS custom_field_histories');
    await queryRunner.query('DROP TABLE IF EXISTS custom_field_values');
    await queryRunner.query('DROP TABLE IF EXISTS custom_field_options');
    await queryRunner.query('DROP TABLE IF EXISTS custom_field_definitions');
  }
}
