import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateFederatedSamlAssertionReplaysTable (2026-11-26)
 * Triển khai Section 14.2 — Enterprise SAML 2.0 SSO (`federated-identity`):
 * - `federated_saml_assertion_replays`: Lưu `assertion_id_hash` theo `(provider_code, assertion_id_hash)`
 *   để chống phát lại (anti-replay) SAML Assertion bền vững trong DB không phụ thuộc Redis.
 */
export class CreateFederatedSamlAssertionReplaysTable1763800000000 implements MigrationInterface {
  public readonly name = 'CreateFederatedSamlAssertionReplaysTable1763800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS federated_saml_assertion_replays (
        id ${pkDef},
        provider_code VARCHAR(64) NOT NULL,
        assertion_id_hash VARCHAR(64) NOT NULL,
        issuer VARCHAR(500) NULL,
        expires_at TIMESTAMP NOT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_fed_saml_replay_provider_assertion ON federated_saml_assertion_replays (provider_code, assertion_id_hash)',
      'CREATE INDEX IDX_fed_saml_replay_expires ON federated_saml_assertion_replays (expires_at)',
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
    await queryRunner.query('DROP TABLE IF EXISTS federated_saml_assertion_replays');
  }
}
