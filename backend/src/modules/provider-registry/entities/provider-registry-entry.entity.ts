import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  ProviderHealthStatusCode,
  ProviderRoleName,
  ProviderStatusCode,
  ProviderTypeName,
} from '@packages/kernel/index.js';
import {
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
} from '../enum/provider-registry.enum.js';
import { nullableBigintNumberTransformer } from '../helpers/provider-bigint.helper.js';

@Entity({ name: 'provider_registry_entries' })
@Index('UQ_pr_entries_type_code', ['providerType', 'providerCode'], { unique: true })
@Index('IDX_pr_entries_type_primary', ['providerType', 'isPrimary', 'status', 'deletedAt'])
@Index('IDX_pr_entries_health', ['providerType', 'healthStatus', 'status', 'deletedAt'])
export class ProviderRegistryEntryEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'provider_type', type: 'varchar', length: 24 })
  public providerType!: ProviderTypeName;

  @Column({ name: 'driver_code', type: 'varchar', length: 64 })
  public driverCode!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  public displayName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'domain_ref_code', type: 'varchar', length: 64, nullable: true })
  public domainRefCode!: string | null;

  @Column({ name: 'http_service_name', type: 'varchar', length: 80, nullable: true })
  public httpServiceName!: string | null;

  @Column({ type: 'varchar', length: 16, default: PROVIDER_ROLE.STANDBY })
  public role!: ProviderRoleName;

  @Column({ type: 'int', default: 100 })
  public priority!: number;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  public isPrimary!: boolean;

  @Column({ name: 'fallback_allowed', type: 'boolean', default: false })
  public fallbackAllowed!: boolean;

  @Column({ type: 'smallint', default: PROVIDER_STATUS.ACTIVE })
  public status!: ProviderStatusCode;

  @Column({ name: 'paused_at', type: 'timestamp', nullable: true })
  public pausedAt!: Date | null;

  @Column({
    name: 'paused_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public pausedBy!: number | null;

  @Column({ name: 'paused_reason', type: 'varchar', length: 500, nullable: true })
  public pausedReason!: string | null;

  @Column({ name: 'secret_ref', type: 'varchar', length: 160, nullable: true })
  public secretRef!: string | null;

  @Column({ name: 'secrets_encrypted', type: 'text', nullable: true })
  public secretsEncrypted!: string | null;

  @Column({ name: 'secret_hint', type: 'varchar', length: 32, nullable: true })
  public secretHint!: string | null;

  @Column({ name: 'config_json', type: 'text', nullable: true })
  public configJson!: string | null;

  @Column({ name: 'health_status', type: 'smallint', default: PROVIDER_HEALTH_STATUS.UNKNOWN })
  public healthStatus!: ProviderHealthStatusCode;

  @Column({ name: 'last_health_check_at', type: 'timestamp', nullable: true })
  public lastHealthCheckAt!: Date | null;

  @Column({ name: 'last_health_latency_ms', type: 'int', nullable: true })
  public lastHealthLatencyMs!: number | null;

  @Column({ name: 'last_health_error_code', type: 'varchar', length: 80, nullable: true })
  public lastHealthErrorCode!: string | null;

  @Column({ name: 'last_health_error_message', type: 'varchar', length: 500, nullable: true })
  public lastHealthErrorMessage!: string | null;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  public consecutiveFailures!: number;

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
