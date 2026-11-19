import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreatePaymentsTables (2026-11-19)
 * Triển khai Phase 10.5 — Payment Port (`payments`):
 * 1. `payment_providers`: Cấu hình cổng thanh toán (`sandbox`, `vnpay`, `momo`, `stripe`), secret mã hóa AES-256-GCM và năng lực hoàn tiền một phần.
 * 2. `payment_transactions`: Giao dịch thanh toán chuẩn hóa dùng chung, đơn vị tiền tệ minor units (`BIGINT`) + `currency`, chống tạo trùng bằng `idempotency_key`.
 * 3. `payment_refunds`: Lịch sử hoàn tiền toàn phần/một phần với `idempotency_key` riêng.
 * 4. `payment_callbacks`: Lịch sử callback/IPN đã che dữ liệu nhạy cảm phục vụ kiểm tra chữ ký, chống replay và đối soát.
 * 5. `payment_reconciliations`: Phiên đối soát dữ liệu nội bộ với cổng thanh toán.
 * 6. `payment_reconciliation_items`: Chi tiết từng dòng so sánh 2 chiều Nội bộ vs Provider và trạng thái xử lý sai lệch.
 */
export class CreatePaymentsTables1762900000000 implements MigrationInterface {
  public readonly name = 'CreatePaymentsTables1762900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_providers (
        id ${pkDef},
        provider_code VARCHAR(64) NOT NULL,
        driver_code VARCHAR(32) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        status SMALLINT NOT NULL DEFAULT 2,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        environment VARCHAR(16) NOT NULL DEFAULT 'SANDBOX',
        supports_partial_refund BOOLEAN NOT NULL DEFAULT TRUE,
        allowed_currencies_json TEXT NULL,
        config_json TEXT NULL,
        secrets_encrypted TEXT NULL,
        secret_hint VARCHAR(32) NULL,
        last_success_at TIMESTAMP NULL,
        last_error_at TIMESTAMP NULL,
        last_error_code VARCHAR(80) NULL,
        created_by BIGINT NULL,
        updated_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id ${pkDef},
        payment_code VARCHAR(64) NOT NULL,
        idempotency_key VARCHAR(160) NOT NULL,
        request_fingerprint VARCHAR(64) NOT NULL,
        provider_id BIGINT NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        driver_code VARCHAR(32) NOT NULL,
        provider_transaction_id VARCHAR(180) NULL,
        merchant_order_ref VARCHAR(128) NOT NULL,
        amount BIGINT NOT NULL,
        refunded_amount BIGINT NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        description VARCHAR(500) NULL,
        checkout_url VARCHAR(2000) NULL,
        qr_payload TEXT NULL,
        return_url VARCHAR(1000) NULL,
        cancel_url VARCHAR(1000) NULL,
        customer_json TEXT NULL,
        metadata_json TEXT NULL,
        provider_raw_response_redacted_json TEXT NULL,
        paid_at TIMESTAMP NULL,
        expired_at TIMESTAMP NULL,
        last_callback_at TIMESTAMP NULL,
        failure_code VARCHAR(80) NULL,
        failure_message VARCHAR(500) NULL,
        organization_unit_id BIGINT NULL,
        created_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_refunds (
        id ${pkDef},
        refund_code VARCHAR(64) NOT NULL,
        payment_transaction_id BIGINT NOT NULL,
        payment_code VARCHAR(64) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        idempotency_key VARCHAR(160) NOT NULL,
        request_fingerprint VARCHAR(64) NOT NULL,
        refund_type VARCHAR(16) NOT NULL,
        amount BIGINT NOT NULL,
        currency VARCHAR(8) NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        provider_refund_id VARCHAR(180) NULL,
        reason VARCHAR(500) NULL,
        metadata_json TEXT NULL,
        provider_raw_response_redacted_json TEXT NULL,
        refunded_at TIMESTAMP NULL,
        failure_code VARCHAR(80) NULL,
        failure_message VARCHAR(500) NULL,
        created_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_callbacks (
        id ${pkDef},
        callback_uid VARCHAR(64) NOT NULL,
        provider_id BIGINT NULL,
        provider_code VARCHAR(64) NOT NULL,
        payment_transaction_id BIGINT NULL,
        payment_code VARCHAR(64) NULL,
        provider_event_id VARCHAR(180) NULL,
        provider_transaction_id VARCHAR(180) NULL,
        http_method VARCHAR(10) NOT NULL,
        verification_status SMALLINT NOT NULL,
        signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
        reported_status SMALLINT NULL,
        reported_amount BIGINT NULL,
        reported_currency VARCHAR(8) NULL,
        payload_sha256 VARCHAR(64) NOT NULL,
        headers_redacted_json TEXT NULL,
        payload_redacted_json TEXT NULL,
        rejection_reason VARCHAR(255) NULL,
        source_ip_masked VARCHAR(64) NULL,
        processed_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_reconciliations (
        id ${pkDef},
        reconciliation_code VARCHAR(64) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        source_mode VARCHAR(24) NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        status SMALLINT NOT NULL DEFAULT 2,
        total_internal_count INT NOT NULL DEFAULT 0,
        total_provider_count INT NOT NULL DEFAULT 0,
        matched_count INT NOT NULL DEFAULT 0,
        mismatch_count INT NOT NULL DEFAULT 0,
        missing_at_provider_count INT NOT NULL DEFAULT 0,
        missing_internally_count INT NOT NULL DEFAULT 0,
        internal_total_amount BIGINT NOT NULL DEFAULT 0,
        provider_total_amount BIGINT NOT NULL DEFAULT 0,
        amount_difference BIGINT NOT NULL DEFAULT 0,
        currency VARCHAR(8) NULL,
        summary_json TEXT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        created_by BIGINT NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_reconciliation_items (
        id ${pkDef},
        reconciliation_id BIGINT NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        payment_transaction_id BIGINT NULL,
        payment_code VARCHAR(64) NULL,
        merchant_order_ref VARCHAR(128) NULL,
        provider_transaction_id VARCHAR(180) NULL,
        discrepancy_status SMALLINT NOT NULL,
        resolution_status SMALLINT NOT NULL DEFAULT 1,
        internal_status SMALLINT NULL,
        provider_status SMALLINT NULL,
        internal_amount BIGINT NULL,
        provider_amount BIGINT NULL,
        internal_refunded_amount BIGINT NULL,
        provider_refunded_amount BIGINT NULL,
        currency VARCHAR(8) NULL,
        diff_details_json TEXT NULL,
        resolution_note VARCHAR(500) NULL,
        resolved_by BIGINT NULL,
        resolved_at TIMESTAMP NULL,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      )
    `);

    const indexes = [
      'CREATE UNIQUE INDEX UQ_pay_providers_code ON payment_providers (provider_code)',
      'CREATE INDEX IDX_pay_providers_enabled ON payment_providers (is_enabled, status, deleted_at)',
      'CREATE UNIQUE INDEX UQ_pay_tx_code ON payment_transactions (payment_code)',
      'CREATE UNIQUE INDEX UQ_pay_tx_idempotency ON payment_transactions (idempotency_key)',
      'CREATE INDEX IDX_pay_tx_provider_status_time ON payment_transactions (provider_code, status, created_at)',
      'CREATE INDEX IDX_pay_tx_merchant_ref ON payment_transactions (merchant_order_ref, provider_code)',
      'CREATE INDEX IDX_pay_tx_provider_tx_id ON payment_transactions (provider_code, provider_transaction_id)',
      'CREATE UNIQUE INDEX UQ_pay_refunds_code ON payment_refunds (refund_code)',
      'CREATE UNIQUE INDEX UQ_pay_refunds_idempotency ON payment_refunds (idempotency_key)',
      'CREATE INDEX IDX_pay_refunds_tx ON payment_refunds (payment_transaction_id, status)',
      'CREATE UNIQUE INDEX UQ_pay_callbacks_uid ON payment_callbacks (callback_uid)',
      'CREATE INDEX IDX_pay_callbacks_provider_event ON payment_callbacks (provider_code, provider_event_id)',
      'CREATE INDEX IDX_pay_callbacks_tx_time ON payment_callbacks (payment_transaction_id, created_at)',
      'CREATE INDEX IDX_pay_callbacks_provider_status_time ON payment_callbacks (provider_code, verification_status, created_at)',
      'CREATE UNIQUE INDEX UQ_pay_recon_code ON payment_reconciliations (reconciliation_code)',
      'CREATE INDEX IDX_pay_recon_provider_period ON payment_reconciliations (provider_code, period_start, period_end)',
      'CREATE INDEX IDX_pay_recon_items_run_status ON payment_reconciliation_items (reconciliation_id, discrepancy_status, resolution_status)',
      'CREATE INDEX IDX_pay_recon_items_tx ON payment_reconciliation_items (payment_transaction_id)',
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
    await queryRunner.query('DROP TABLE IF EXISTS payment_reconciliation_items');
    await queryRunner.query('DROP TABLE IF EXISTS payment_reconciliations');
    await queryRunner.query('DROP TABLE IF EXISTS payment_callbacks');
    await queryRunner.query('DROP TABLE IF EXISTS payment_refunds');
    await queryRunner.query('DROP TABLE IF EXISTS payment_transactions');
    await queryRunner.query('DROP TABLE IF EXISTS payment_providers');
  }
}
