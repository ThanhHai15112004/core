import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddUserMembershipDatesTempManagerAndHistory (2026-10-26)
 * Triển khai toàn diện Mục 9.2 — Thành viên, chức vụ và người quản lý:
 * 1. Bổ sung `temporary_manager_id`, `temporary_manager_from`, `temporary_manager_until` vào bảng `users` (Mục 9.2.5).
 * 2. Bổ sung `start_date`, `end_date` vào bảng `user_organization_units` (Mục 9.2.1).
 * 3. Tạo bảng `user_organization_histories` lưu lịch sử membership khi gán/chuyển đơn vị (Mục 9.2.6).
 */
export class AddUserMembershipDatesTempManagerAndHistory1761800000000 implements MigrationInterface {
  public readonly name = 'AddUserMembershipDatesTempManagerAndHistory1761800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    if (isPostgres) {
      await queryRunner.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_manager_id INT NULL',
      );
      await queryRunner.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_manager_from TIMESTAMP NULL',
      );
      await queryRunner.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_manager_until TIMESTAMP NULL',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_users_temporary_manager_id ON users (temporary_manager_id)',
      );

      await queryRunner.query(
        'ALTER TABLE user_organization_units ADD COLUMN IF NOT EXISTS start_date TIMESTAMP NULL',
      );
      await queryRunner.query(
        'ALTER TABLE user_organization_units ADD COLUMN IF NOT EXISTS end_date TIMESTAMP NULL',
      );
    } else {
      const hasTempMgrId = await queryRunner.hasColumn('users', 'temporary_manager_id');
      if (!hasTempMgrId) {
        await queryRunner.query('ALTER TABLE users ADD COLUMN temporary_manager_id INT NULL');
        await queryRunner.query(
          'CREATE INDEX idx_users_temporary_manager_id ON users (temporary_manager_id)',
        );
      }

      const hasTempMgrFrom = await queryRunner.hasColumn('users', 'temporary_manager_from');
      if (!hasTempMgrFrom) {
        await queryRunner.query(
          'ALTER TABLE users ADD COLUMN temporary_manager_from TIMESTAMP NULL',
        );
      }

      const hasTempMgrUntil = await queryRunner.hasColumn('users', 'temporary_manager_until');
      if (!hasTempMgrUntil) {
        await queryRunner.query(
          'ALTER TABLE users ADD COLUMN temporary_manager_until TIMESTAMP NULL',
        );
      }

      const hasStartDate = await queryRunner.hasColumn('user_organization_units', 'start_date');
      if (!hasStartDate) {
        await queryRunner.query(
          'ALTER TABLE user_organization_units ADD COLUMN start_date TIMESTAMP NULL',
        );
      }

      const hasEndDate = await queryRunner.hasColumn('user_organization_units', 'end_date');
      if (!hasEndDate) {
        await queryRunner.query(
          'ALTER TABLE user_organization_units ADD COLUMN end_date TIMESTAMP NULL',
        );
      }
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_organization_histories (
        id ${pkDef},
        user_id INT NOT NULL,
        organization_unit_id INT NOT NULL,
        from_organization_unit_id INT NULL,
        action_type VARCHAR(32) NOT NULL DEFAULT 'ASSIGN',
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        position_title VARCHAR(128) NULL,
        start_date TIMESTAMP NULL,
        end_date TIMESTAMP NULL,
        reason VARCHAR(255) NULL,
        changed_by INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    if (isPostgres) {
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_user_org_histories_user_id ON user_organization_histories (user_id)',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_user_org_histories_org_unit_id ON user_organization_histories (organization_unit_id)',
      );
    } else {
      await queryRunner
        .query(
          'CREATE INDEX idx_user_org_histories_user_id ON user_organization_histories (user_id)',
        )
        .catch(() => undefined);
      await queryRunner
        .query(
          'CREATE INDEX idx_user_org_histories_org_unit_id ON user_organization_histories (organization_unit_id)',
        )
        .catch(() => undefined);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    await queryRunner.query('DROP TABLE IF EXISTS user_organization_histories');

    if (isPostgres) {
      await queryRunner.query('ALTER TABLE user_organization_units DROP COLUMN IF EXISTS end_date');
      await queryRunner.query(
        'ALTER TABLE user_organization_units DROP COLUMN IF EXISTS start_date',
      );
      await queryRunner.query('DROP INDEX IF EXISTS idx_users_temporary_manager_id');
      await queryRunner.query('ALTER TABLE users DROP COLUMN IF EXISTS temporary_manager_until');
      await queryRunner.query('ALTER TABLE users DROP COLUMN IF EXISTS temporary_manager_from');
      await queryRunner.query('ALTER TABLE users DROP COLUMN IF EXISTS temporary_manager_id');
    } else {
      if (await queryRunner.hasColumn('user_organization_units', 'end_date')) {
        await queryRunner.query('ALTER TABLE user_organization_units DROP COLUMN end_date');
      }
      if (await queryRunner.hasColumn('user_organization_units', 'start_date')) {
        await queryRunner.query('ALTER TABLE user_organization_units DROP COLUMN start_date');
      }
      if (await queryRunner.hasColumn('users', 'temporary_manager_until')) {
        await queryRunner.query('ALTER TABLE users DROP COLUMN temporary_manager_until');
      }
      if (await queryRunner.hasColumn('users', 'temporary_manager_from')) {
        await queryRunner.query('ALTER TABLE users DROP COLUMN temporary_manager_from');
      }
      if (await queryRunner.hasColumn('users', 'temporary_manager_id')) {
        await queryRunner.query('ALTER TABLE users DROP COLUMN temporary_manager_id');
      }
    }
  }
}
