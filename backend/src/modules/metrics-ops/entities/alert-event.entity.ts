import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  AlertEventStatus,
  AlertMetricKey,
  AlertOperator,
  AlertSeverity,
} from '../enum/metrics-ops.enum.js';
import {
  metricsBigintTransformer,
  metricsNullableBigintTransformer,
} from '../helpers/metrics-bigint.helper.js';

@Entity({ name: 'alert_events' })
@Index('IDX_alert_events_fingerprint_status', ['fingerprint', 'status', 'deletedAt'])
@Index('IDX_alert_events_status_severity', ['status', 'severity', 'firedAt'])
@Index('IDX_alert_events_rule', ['ruleId', 'firedAt'])
export class AlertEventEntity extends VersionedTypeOrmEntity {
  @Column({
    name: 'rule_id',
    type: 'bigint',
    transformer: metricsBigintTransformer,
  })
  public ruleId!: number;

  @Column({ name: 'rule_code', type: 'varchar', length: 80 })
  public ruleCode!: string;

  @Column({ name: 'rule_name', type: 'varchar', length: 160 })
  public ruleName!: string;

  @Column({ type: 'varchar', length: 191 })
  public fingerprint!: string;

  @Column({ type: 'varchar', length: 16 })
  public severity!: AlertSeverity;

  @Column({ type: 'varchar', length: 20, default: 'FIRING' })
  public status!: AlertEventStatus;

  @Column({ name: 'metric_key', type: 'varchar', length: 64 })
  public metricKey!: AlertMetricKey;

  @Column({ name: 'metric_value', type: 'double precision' })
  public metricValue!: number;

  @Column({ type: 'double precision' })
  public threshold!: number;

  @Column({ type: 'varchar', length: 8 })
  public operator!: AlertOperator;

  @Column({ name: 'labels_json', type: 'text', nullable: true })
  public labelsJson!: string | null;

  @Column({ type: 'varchar', length: 500 })
  public summary!: string;

  @Column({ name: 'fired_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public firedAt!: Date;

  @Column({ name: 'last_evaluated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public lastEvaluatedAt!: Date;

  @Column({ name: 'last_notified_at', type: 'timestamp', nullable: true })
  public lastNotifiedAt!: Date | null;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true })
  public acknowledgedAt!: Date | null;

  @Column({
    name: 'acknowledged_by',
    type: 'bigint',
    nullable: true,
    transformer: metricsNullableBigintTransformer,
  })
  public acknowledgedBy!: number | null;

  @Column({ name: 'acknowledge_note', type: 'varchar', length: 500, nullable: true })
  public acknowledgeNote!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  public resolvedAt!: Date | null;

  @Column({
    name: 'resolved_by',
    type: 'bigint',
    nullable: true,
    transformer: metricsNullableBigintTransformer,
  })
  public resolvedBy!: number | null;

  @Column({ name: 'delivery_status_json', type: 'text', nullable: true })
  public deliveryStatusJson!: string | null;
}
