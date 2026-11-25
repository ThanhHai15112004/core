import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type { IncidentSeverity, IncidentSource } from '../enum/incidents-ops.enum.js';
import {
  incidentBigintTransformer,
  incidentNullableBigintTransformer,
} from '../helpers/incident-bigint.helper.js';

@Entity({ name: 'alert_owner_mappings' })
@Index('UQ_alert_owner_mappings_alert_code', ['alertCode'], { unique: true })
@Index('IDX_alert_owner_mappings_owner', ['ownerUserId', 'isEnabled', 'deletedAt'])
export class AlertOwnerMappingEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'alert_code', type: 'varchar', length: 100 })
  public alertCode!: string;

  @Column({ name: 'alert_name', type: 'varchar', length: 160 })
  public alertName!: string;

  @Column({ type: 'varchar', length: 24, default: 'SIEM' })
  public source!: IncidentSource;

  @Column({ name: 'default_severity', type: 'varchar', length: 8, default: 'P2' })
  public defaultSeverity!: IncidentSeverity;

  @Column({
    name: 'owner_user_id',
    type: 'bigint',
    transformer: incidentBigintTransformer,
  })
  public ownerUserId!: number;

  @Column({
    name: 'backup_owner_user_id',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public backupOwnerUserId!: number | null;

  @Column({
    name: 'runbook_id',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public runbookId!: number | null;

  @Column({ name: 'notify_channels_json', type: 'text', nullable: true })
  public notifyChannelsJson!: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public createdBy!: number | null;

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    transformer: incidentNullableBigintTransformer,
  })
  public updatedBy!: number | null;
}
