import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  PAYMENT_ENVIRONMENT,
  PAYMENT_PROVIDER_STATUS,
  type PaymentDriverCode,
  type PaymentEnvironment,
  type PaymentProviderStatusCode,
} from '../enum/payments.enum.js';
import { nullableBigintNumberTransformer } from '../helpers/payment-bigint.helper.js';

@Entity({ name: 'payment_providers' })
@Index('UQ_pay_providers_code', ['providerCode'], { unique: true })
@Index('IDX_pay_providers_enabled', ['isEnabled', 'status', 'deletedAt'])
export class PaymentProviderEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'driver_code', type: 'varchar', length: 32 })
  public driverCode!: PaymentDriverCode;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  public displayName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ type: 'smallint', default: PAYMENT_PROVIDER_STATUS.INACTIVE })
  public status!: PaymentProviderStatusCode;

  @Column({ name: 'is_enabled', type: 'boolean', default: false })
  public isEnabled!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  public isDefault!: boolean;

  @Column({ type: 'varchar', length: 16, default: PAYMENT_ENVIRONMENT.SANDBOX })
  public environment!: PaymentEnvironment;

  @Column({ name: 'supports_partial_refund', type: 'boolean', default: true })
  public supportsPartialRefund!: boolean;

  @Column({ name: 'allowed_currencies_json', type: 'text', nullable: true })
  public allowedCurrenciesJson!: string | null;

  @Column({ name: 'config_json', type: 'text', nullable: true })
  public configJson!: string | null;

  @Column({ name: 'secrets_encrypted', type: 'text', nullable: true })
  public secretsEncrypted!: string | null;

  @Column({ name: 'secret_hint', type: 'varchar', length: 32, nullable: true })
  public secretHint!: string | null;

  @Column({ name: 'last_success_at', type: 'timestamp', nullable: true })
  public lastSuccessAt!: Date | null;

  @Column({ name: 'last_error_at', type: 'timestamp', nullable: true })
  public lastErrorAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public createdBy!: number | null;

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public updatedBy!: number | null;
}
