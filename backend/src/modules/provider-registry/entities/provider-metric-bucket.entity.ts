import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { ProviderTypeName } from '@packages/kernel/index.js';
import { bigintNumberTransformer } from '../helpers/provider-bigint.helper.js';

@Entity({ name: 'provider_metric_buckets' })
@Index('UQ_pr_metric_provider_bucket', ['providerId', 'bucketStart'], { unique: true })
@Index('IDX_pr_metric_type_bucket', ['providerType', 'bucketStart'])
export class ProviderMetricBucketEntity extends TypeOrmBaseEntity {
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

  @Column({ name: 'bucket_start', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public bucketStart!: Date;

  @Column({ name: 'total_count', type: 'int', default: 0 })
  public totalCount!: number;

  @Column({ name: 'success_count', type: 'int', default: 0 })
  public successCount!: number;

  @Column({ name: 'error_count', type: 'int', default: 0 })
  public errorCount!: number;

  @Column({
    name: 'total_latency_ms',
    type: 'bigint',
    default: 0,
    transformer: bigintNumberTransformer,
  })
  public totalLatencyMs!: number;

  @Column({ name: 'min_latency_ms', type: 'int', nullable: true })
  public minLatencyMs!: number | null;

  @Column({ name: 'max_latency_ms', type: 'int', nullable: true })
  public maxLatencyMs!: number | null;

  @Column({ name: 'p95_latency_ms', type: 'int', nullable: true })
  public p95LatencyMs!: number | null;

  @Column({ name: 'latency_samples_json', type: 'text', nullable: true })
  public latencySamplesJson!: string | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  public lastErrorCode!: string | null;

  @Column({ name: 'last_observed_at', type: 'timestamp', nullable: true })
  public lastObservedAt!: Date | null;
}
