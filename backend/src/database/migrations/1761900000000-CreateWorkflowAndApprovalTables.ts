import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateWorkflowAndApprovalTables (2026-10-27)
 * Triển khai toàn diện Mục 9.3 (Quy trình xử lý — Workflow) & Mục 9.4 (Phê duyệt — Approval):
 * 1. `workflow_definitions`: Định nghĩa quy trình (tên, mã, phiên bản, SLA mặc định).
 * 2. `workflow_states`: Các trạng thái của quy trình (DRAFT, PENDING, APPROVED, REJECTED, CANCELLED...).
 * 3. `workflow_transitions`: Các bước chuyển trạng thái kèm điều kiện (`conditions_json`) và hành động (`actions_json`).
 * 4. `workflow_instances`: Khởi tạo quy trình cho một bản ghi nghiệp vụ (`entity_type`, `entity_id`), theo dõi thời hạn SLA & quá hạn.
 * 5. `workflow_approval_steps`: Các bước phê duyệt nhiều cấp / ủy quyền gắn với instance.
 * 6. `workflow_histories`: Lịch sử toàn bộ quy trình (ai chuyển trạng thái, từ đâu sang đâu, khi nào, lý do, hành động đã kích hoạt).
 */
export class CreateWorkflowAndApprovalTables1761900000000 implements MigrationInterface {
  public readonly name = 'CreateWorkflowAndApprovalTables1761900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id ${pkDef},
        code VARCHAR(64) NOT NULL,
        version INT NOT NULL DEFAULT 1,
        name VARCHAR(180) NOT NULL,
        description TEXT NULL,
        target_entity_type VARCHAR(64) NOT NULL DEFAULT 'general',
        default_sla_hours INT NOT NULL DEFAULT 24,
        warning_before_minutes INT NOT NULL DEFAULT 120,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        status INT NOT NULL DEFAULT 1,
        created_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_states (
        id ${pkDef},
        workflow_definition_id INT NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(128) NOT NULL,
        state_type VARCHAR(32) NOT NULL DEFAULT 'INTERMEDIATE',
        badge_tone VARCHAR(32) NOT NULL DEFAULT 'info',
        sla_hours INT NULL,
        approval_config_json TEXT NULL,
        sort_order INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_transitions (
        id ${pkDef},
        workflow_definition_id INT NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(128) NOT NULL,
        from_state_code VARCHAR(64) NOT NULL,
        to_state_code VARCHAR(64) NOT NULL,
        conditions_json TEXT NULL,
        actions_json TEXT NULL,
        sort_order INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_instances (
        id ${pkDef},
        workflow_definition_id INT NOT NULL,
        workflow_code VARCHAR(64) NOT NULL,
        workflow_version INT NOT NULL DEFAULT 1,
        entity_type VARCHAR(64) NOT NULL,
        entity_id VARCHAR(128) NOT NULL,
        title VARCHAR(255) NOT NULL,
        current_state_code VARCHAR(64) NOT NULL,
        status INT NOT NULL DEFAULT 1,
        initiator_user_id INT NULL,
        organization_unit_id INT NULL,
        current_step_order INT NOT NULL DEFAULT 1,
        due_at TIMESTAMP NULL,
        warning_sent_at TIMESTAMP NULL,
        overdue_notified_at TIMESTAMP NULL,
        is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
        context_data_json TEXT NULL,
        cancel_reason VARCHAR(500) NULL,
        cancelled_by_user_id INT NULL,
        completed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_approval_steps (
        id ${pkDef},
        workflow_instance_id INT NOT NULL,
        state_code VARCHAR(64) NOT NULL,
        step_order INT NOT NULL DEFAULT 1,
        approval_mode VARCHAR(32) NOT NULL DEFAULT 'SINGLE',
        approver_user_id INT NULL,
        delegated_from_user_id INT NULL,
        approver_role_code VARCHAR(64) NULL,
        decision VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        comment TEXT NULL,
        decided_at TIMESTAMP NULL,
        decided_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_histories (
        id ${pkDef},
        workflow_instance_id INT NOT NULL,
        transition_code VARCHAR(64) NULL,
        action_type VARCHAR(32) NOT NULL DEFAULT 'TRANSITION',
        from_state_code VARCHAR(64) NULL,
        to_state_code VARCHAR(64) NOT NULL,
        actor_user_id INT NULL,
        reason TEXT NULL,
        triggered_actions_json TEXT NULL,
        metadata_json TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX idx_wf_def_code_version ON workflow_definitions (code, version)',
      'CREATE INDEX idx_wf_def_status ON workflow_definitions (status)',
      'CREATE UNIQUE INDEX idx_wf_states_def_code ON workflow_states (workflow_definition_id, code)',
      'CREATE INDEX idx_wf_trans_def_from ON workflow_transitions (workflow_definition_id, from_state_code)',
      'CREATE INDEX idx_wf_inst_entity ON workflow_instances (entity_type, entity_id)',
      'CREATE INDEX idx_wf_inst_status_due ON workflow_instances (status, due_at)',
      'CREATE INDEX idx_wf_inst_org_unit ON workflow_instances (organization_unit_id)',
      'CREATE INDEX idx_wf_approval_inst_step ON workflow_approval_steps (workflow_instance_id, step_order)',
      'CREATE INDEX idx_wf_approval_approver ON workflow_approval_steps (approver_user_id, decision)',
      'CREATE INDEX idx_wf_hist_instance ON workflow_histories (workflow_instance_id, created_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS workflow_histories');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_approval_steps');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_instances');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_transitions');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_states');
    await queryRunner.query('DROP TABLE IF EXISTS workflow_definitions');
  }
}
