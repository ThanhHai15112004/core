import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: SplitUserCredentialsTable (2026-11-04)
 * Tách quyền sở hữu mật khẩu và lịch sử mật khẩu ra khỏi bảng `users` sang bảng `user_credentials`
 * thuộc module `credentials` (Phase 3 — Module Split):
 * 1. Tạo bảng `user_credentials` (`user_id`, `password_hash`, `password_changed_at`, `password_history_hashes_json`).
 * 2. Sao chép dữ liệu mật khẩu hiện có từ `users` sang `user_credentials`.
 * 3. Xóa các cột `password_hash`, `password_changed_at`, `password_history_hashes_json` khỏi bảng `users`.
 */
export class SplitUserCredentialsTable1762500000000 implements MigrationInterface {
  public readonly name = 'SplitUserCredentialsTable1762500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_credentials (
        id ${pkDef},
        user_id INT NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        password_changed_at TIMESTAMP NULL,
        password_history_hashes_json TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const hasPasswordHashCol = await queryRunner.hasColumn('users', 'password_hash');
    if (hasPasswordHashCol) {
      if (isPostgres) {
        await queryRunner.query(`
          INSERT INTO user_credentials (user_id, password_hash, password_changed_at, password_history_hashes_json)
          SELECT id, password_hash, password_changed_at, password_history_hashes_json
          FROM users
          WHERE password_hash IS NOT NULL
          ON CONFLICT (user_id) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            password_changed_at = EXCLUDED.password_changed_at,
            password_history_hashes_json = EXCLUDED.password_history_hashes_json
        `);
        await queryRunner.query(`
          ALTER TABLE users
            DROP COLUMN IF EXISTS password_hash,
            DROP COLUMN IF EXISTS password_changed_at,
            DROP COLUMN IF EXISTS password_history_hashes_json
        `);
      } else {
        await queryRunner.query(`
          INSERT INTO user_credentials (user_id, password_hash, password_changed_at, password_history_hashes_json)
          SELECT id, password_hash, password_changed_at, password_history_hashes_json
          FROM users
          WHERE password_hash IS NOT NULL
          ON DUPLICATE KEY UPDATE
            password_hash = VALUES(password_hash),
            password_changed_at = VALUES(password_changed_at),
            password_history_hashes_json = VALUES(password_history_hashes_json)
        `);
        for (const col of [
          'password_hash',
          'password_changed_at',
          'password_history_hashes_json',
        ]) {
          if (await queryRunner.hasColumn('users', col)) {
            await queryRunner.query(`ALTER TABLE users DROP COLUMN ${col}`);
          }
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL,
          ADD COLUMN IF NOT EXISTS password_history_hashes_json TEXT NULL
      `);
      await queryRunner.query(`
        UPDATE users u
        SET
          password_hash = uc.password_hash,
          password_changed_at = uc.password_changed_at,
          password_history_hashes_json = uc.password_history_hashes_json
        FROM user_credentials uc
        WHERE uc.user_id = u.id
      `);
    } else {
      if (!(await queryRunner.hasColumn('users', 'password_hash'))) {
        await queryRunner.query(
          `ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT ''`,
        );
      }
      if (!(await queryRunner.hasColumn('users', 'password_changed_at'))) {
        await queryRunner.query(`ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL`);
      }
      if (!(await queryRunner.hasColumn('users', 'password_history_hashes_json'))) {
        await queryRunner.query(
          `ALTER TABLE users ADD COLUMN password_history_hashes_json TEXT NULL`,
        );
      }
      await queryRunner.query(`
        UPDATE users u
        INNER JOIN user_credentials uc ON uc.user_id = u.id
        SET
          u.password_hash = uc.password_hash,
          u.password_changed_at = uc.password_changed_at,
          u.password_history_hashes_json = uc.password_history_hashes_json
      `);
    }

    await queryRunner.query('DROP TABLE IF EXISTS user_credentials');
  }
}
