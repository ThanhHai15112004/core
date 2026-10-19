import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddDataScopeAndManagerId (2026-10-19)
 * Bổ sung lược đồ cơ sở dữ liệu cho Mục 4.3 — Phạm vi dữ liệu (Data Scope):
 * - roles.data_scope (INT NOT NULL DEFAULT 4: 1=ALL, 2=ORG_UNIT, 3=SUBORDINATES, 4=SELF)
 * - users.manager_id (INT NULL: ID người quản lý trực tiếp phục vụ phạm vi dữ liệu SUBORDINATES theo cây quản lý)
 */
export class AddDataScopeAndManagerId1760900000000 implements MigrationInterface {
  public readonly name = 'AddDataScopeAndManagerId1760900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        'ALTER TABLE roles ADD COLUMN IF NOT EXISTS data_scope INT NOT NULL DEFAULT 4',
      );
      await queryRunner.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INT NULL');
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users (manager_id)',
      );
    } else {
      const hasDataScope = await queryRunner.hasColumn('roles', 'data_scope');
      if (!hasDataScope) {
        await queryRunner.query('ALTER TABLE roles ADD COLUMN data_scope INT NOT NULL DEFAULT 4');
      }

      const hasManagerId = await queryRunner.hasColumn('users', 'manager_id');
      if (!hasManagerId) {
        await queryRunner.query('ALTER TABLE users ADD COLUMN manager_id INT NULL');
        await queryRunner.query('CREATE INDEX idx_users_manager_id ON users (manager_id)');
      }
    }

    // Đồng bộ giá trị data_scope chuẩn cho các vai trò hệ thống hiện có
    await queryRunner.query(
      `UPDATE roles SET data_scope = 1 WHERE code IN ('super_admin', 'admin', 'admin_iam', 'admin_hr', 'admin_security', 'admin_operations', 'admin_finance', 'admin_support')`,
    );
    await queryRunner.query(`UPDATE roles SET data_scope = 2 WHERE code = 'branch_director'`);
    await queryRunner.query(`UPDATE roles SET data_scope = 3 WHERE code = 'department_manager'`);
    await queryRunner.query(`UPDATE roles SET data_scope = 4 WHERE code = 'staff'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    if (isPostgres) {
      await queryRunner.query('DROP INDEX IF EXISTS idx_users_manager_id');
      await queryRunner.query('ALTER TABLE users DROP COLUMN IF EXISTS manager_id');
      await queryRunner.query('ALTER TABLE roles DROP COLUMN IF EXISTS data_scope');
    } else {
      const hasManagerId = await queryRunner.hasColumn('users', 'manager_id');
      if (hasManagerId) {
        await queryRunner.query('ALTER TABLE users DROP COLUMN manager_id');
      }
      const hasDataScope = await queryRunner.hasColumn('roles', 'data_scope');
      if (hasDataScope) {
        await queryRunner.query('ALTER TABLE roles DROP COLUMN data_scope');
      }
    }
  }
}
