import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { ProviderHealthStatusCode, ProviderTypeName } from '@packages/kernel/index.js';
import { PROVIDER_CHECK_SOURCE, type ProviderCheckSource } from '../enum/provider-registry.enum.js';
import {
  bigintNumberTransformer,
  nullableBigintNumberTransformer,
} from '../helpers/provider-bigint.helper.js';

@Entity({ name: 'provider_health_checks' })
@Index('IDX_pr_health_provider_time', ['providerId', 'checkedAt'])
@Index('IDX_pr_health_type_status_time', ['providerType', 'healthStatus', 'checkedAt'])
export class ProviderHealthCheckEntity extends TypeOrmBaseEntity {
  @Column({
    name: 'provider_id',
    type: 'bigint',
    transformer: bigintNumberTransformer,
  })
  public providerId!: number;

  @Column({ name: 'provider_type', type: 'varchar', length: 24 })
  public providerType!: ProviderTypeName;

  @Column({ name: 'provider_code', type: 'varchar', length: 64 })
  public providerCode!: string;

  @Column({ name: 'health_status', type: 'smallint' })
  public healthStatus!: ProviderHealthStatusCode;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  public latencyMs!: number | null;

  @Column({ name: 'http_status', type: 'int', nullable: true })
  public httpStatus!: number | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  public errorCode!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  public errorMessage!: string | null;

  @Column({
    name: 'check_source',
    type: 'varchar',
    length: 24,
    default: PROVIDER_CHECK_SOURCE.MANUAL,
  })
  public checkSource!: ProviderCheckSource | string;

  @Column({ name: 'details_json', type: 'text', nullable: true })
  public detailsJson!: string | null;

  @Column({
    name: 'checked_by',
    type: 'bigint',
    nullable: true,
    transformer: nullableBigintNumberTransformer,
  })
  public checkedBy!: number | null;

  @Column({ name: 'checked_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public checkedAt!: Date;
}
