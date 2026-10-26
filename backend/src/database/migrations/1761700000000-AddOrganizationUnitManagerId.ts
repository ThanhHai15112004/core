import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddOrganizationUnitManagerId (2026-10-26)
 * Bổ sung cột người phụ trách đơn vị (`manager_id INT NULL`) cho bảng `organization_units` (Mục 9.1).
 */
export class AddOrganizationUnitManagerId1761700000000 implements MigrationInterface {
  public readonly name = 'AddOrganizationUnitManagerId1761700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        'ALTER TABLE organization_units ADD COLUMN IF NOT EXISTS manager_id INT NULL',
      );
      await queryRunner.query(
        'CREATE INDEX IF NOT EXISTS idx_organization_units_manager_id ON organization_units (manager_id)',
      );
    } else {
      const hasManagerId = await queryRunner.hasColumn('organization_units', 'manager_id');
      if (!hasManagerId) {
        await queryRunner.query('ALTER TABLE organization_units ADD COLUMN manager_id INT NULL');
        await queryRunner.query(
          'CREATE INDEX idx_organization_units_manager_id ON organization_units (manager_id)',
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    if (isPostgres) {
      await queryRunner.query('DROP INDEX IF EXISTS idx_organization_units_manager_id');
      await queryRunner.query('ALTER TABLE organization_units DROP COLUMN IF EXISTS manager_id');
    } else {
      const hasManagerId = await queryRunner.hasColumn('organization_units', 'manager_id');
      if (hasManagerId) {
        await queryRunner.query('ALTER TABLE organization_units DROP COLUMN manager_id');
      }
    }
  }
}
