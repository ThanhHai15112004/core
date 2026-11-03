import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreatePhase9ApprovalsAndCommentsTables (2026-11-03)
 * Chuẩn hóa lưu trữ Database bền vững cho Mục 9.4 (Phê duyệt — Approval Delegation)
 * và Mục 9.5 (Bình luận, ghi chú và tệp đính kèm — Comments & Activity Timeline):
 * 1. `workflow_approval_delegations`: Ủy quyền phê duyệt có thời gian hiệu lực và phạm vi (workflow_codes, entity_types, organization_unit_id).
 * 2. `record_comments`: Bình luận bản ghi, ghi chú nội bộ (`is_internal`), chuỗi trả lời (`parent_comment_id`), nhắc tên (`mentioned_user_ids_json`), đính kèm tệp (`attachment_file_ids_json`).
 * 3. `record_comment_histories`: Lịch sử chỉnh sửa bình luận bất biến (lưu nội dung và tệp đính kèm trước khi sửa).
 */
export class CreatePhase9ApprovalsAndCommentsTables1762400000000 implements MigrationInterface {
  public readonly name = 'CreatePhase9ApprovalsAndCommentsTables1762400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_approval_delegations (
        id ${pkDef},
        from_user_id INT NOT NULL,
        to_user_id INT NOT NULL,
        effective_from TIMESTAMP NOT NULL,
        effective_until TIMESTAMP NOT NULL,
        workflow_codes_json TEXT NULL,
        entity_types_json TEXT NULL,
        organization_unit_id INT NULL,
        reason VARCHAR(500) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS record_comments (
        id ${pkDef},
        entity_type VARCHAR(64) NOT NULL,
        entity_id VARCHAR(128) NOT NULL,
        workflow_instance_id INT NULL,
        parent_comment_id INT NULL,
        content TEXT NOT NULL,
        is_internal BOOLEAN NOT NULL DEFAULT FALSE,
        author_user_id INT NOT NULL,
        mentioned_user_ids_json TEXT NULL,
        attachment_file_ids_json TEXT NULL,
        is_edited BOOLEAN NOT NULL DEFAULT FALSE,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS record_comment_histories (
        id ${pkDef},
        comment_id INT NOT NULL,
        previous_content TEXT NOT NULL,
        previous_attachment_file_ids_json TEXT NULL,
        edited_by_user_id INT NOT NULL,
        edit_reason VARCHAR(500) NULL,
        edited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE INDEX idx_wf_delegation_from_active ON workflow_approval_delegations (from_user_id, is_active)',
      'CREATE INDEX idx_wf_delegation_to_active ON workflow_approval_delegations (to_user_id, is_active)',
      'CREATE INDEX idx_wf_delegation_window ON workflow_approval_delegations (effective_from, effective_until)',
      'CREATE INDEX idx_record_comments_entity ON record_comments (entity_type, entity_id, created_at)',
      'CREATE INDEX idx_record_comments_wf_inst ON record_comments (workflow_instance_id, created_at)',
      'CREATE INDEX idx_record_comments_parent ON record_comments (parent_comment_id)',
      'CREATE INDEX idx_record_comment_hist_comment ON record_comment_histories (comment_id, edited_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS record_comment_histories');
    await queryRunner.query('DROP TABLE IF EXISTS record_comments');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_approval_delegations');
  }
}
