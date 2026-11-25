import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { AlertMetricKey, AlertOperator, AlertSeverity } from '../enum/metrics-ops.enum.js';
import { metricsNullableBigintTransformer } from '../helpers/metrics-bigint.helper.js';

@Entity({ name: 'alert_rules' })
@Index('UQ_alert_rules_code', ['code'], { unique: true })
@Index('IDX_alert_rules_enabled_metric', ['isEnabled', 'metricKey', 'deletedAt'])
export class AlertRuleEntity extends VersionedTypeOrmEntity {
  @Column({ type: 'varchar', length: 80 })
  public code!: string;

  @Column({ type: 'varchar', length: 160 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ name: 'metric_key', type: 'varchar', length: 64 })
  public metricKey!: AlertMetricKey;

  @Column({ name: 'scope_json', type: 'text', nullable: true })
  public scopeJson!: string | null;

  @Column({ type: 'varchar', length: 8, default: 'gt' })
  public operator!: AlertOperator;

  @Column({ type: 'double precision' })
  public threshold!: number;

  @Column({ name: 'window_seconds', type: 'int', default: 300 })
  public windowSeconds!: number;

  @Column({ name: 'for_seconds', type: 'int', default: 0 })
  public forSeconds!: number;

  @Column({ name: 'cooldown_seconds', type: 'int', default: 300 })
  public cooldownSeconds!: number;

  @Column({ type: 'varchar', length: 16, default: 'WARNING' })
  public severity!: AlertSeverity;

  @Column({ name: 'channels_json', type: 'text', nullable: true })
  public channelsJson!: string | null;

  @Column({ name: 'webhook_url', type: 'varchar', length: 500, nullable: true })
  public webhookUrl!: string | null;

  @Column({ name: 'notify_targets_json', type: 'text', nullable: true })
  public notifyTargetsJson!: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Column({ name: 'last_evaluated_at', type: 'timestamp', nullable: true })
  public lastEvaluatedAt!: Date | null;

  @Column({ name: 'last_triggered_at', type: 'timestamp', nullable: true })
  public lastTriggeredAt!: Date | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: metricsNullableBigintTransformer,
  })
  public createdBy!: number | null;

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    transformer: metricsNullableBigintTransformer,
  })
  public updatedBy!: number | null;
}
