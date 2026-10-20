import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddUserPreferencesLocaleAndTimezone (2026-10-20)
 * Bổ sung cột tùy chọn cá nhân cho Mục 5.3 — Đa ngôn ngữ và múi giờ:
 * - user_profiles.preferred_locale (VARCHAR(16) NOT NULL DEFAULT 'vi')
 * - user_profiles.preferred_timezone (VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh')
 */
export class AddUserPreferencesLocaleAndTimezone1761080000000 implements MigrationInterface {
  public readonly name = 'AddUserPreferencesLocaleAndTimezone1761080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(16) NOT NULL DEFAULT 'vi'",
      );
      await queryRunner.query(
        "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'",
      );
    } else {
      const hasPreferredLocale = await queryRunner.hasColumn('user_profiles', 'preferred_locale');
      if (!hasPreferredLocale) {
        await queryRunner.query(
          "ALTER TABLE user_profiles ADD COLUMN preferred_locale VARCHAR(16) NOT NULL DEFAULT 'vi'",
        );
      }

      const hasPreferredTimezone = await queryRunner.hasColumn(
        'user_profiles',
        'preferred_timezone',
      );
      if (!hasPreferredTimezone) {
        await queryRunner.query(
          "ALTER TABLE user_profiles ADD COLUMN preferred_timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'",
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    if (isPostgres) {
      await queryRunner.query('ALTER TABLE user_profiles DROP COLUMN IF EXISTS preferred_timezone');
      await queryRunner.query('ALTER TABLE user_profiles DROP COLUMN IF EXISTS preferred_locale');
    } else {
      const hasPreferredTimezone = await queryRunner.hasColumn(
        'user_profiles',
        'preferred_timezone',
      );
      if (hasPreferredTimezone) {
        await queryRunner.query('ALTER TABLE user_profiles DROP COLUMN preferred_timezone');
      }
      const hasPreferredLocale = await queryRunner.hasColumn('user_profiles', 'preferred_locale');
      if (hasPreferredLocale) {
        await queryRunner.query('ALTER TABLE user_profiles DROP COLUMN preferred_locale');
      }
    }
  }
}
