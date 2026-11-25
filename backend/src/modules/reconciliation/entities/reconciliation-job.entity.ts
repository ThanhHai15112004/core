import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import { reconNullableBigintTransformer } from '../helpers/reconciliation-bigint.helper.js';

@Entity({ name: 'reconciliation_jobs' })
@Index('UQ_recon_jobs_code', ['jobCode'], { unique: true })
@Index('IDX_recon_jobs_enabled_next', ['isEnabled', 'nextRunAt', 'deletedAt'])
@Index('IDX_recon_jobs_adapter', ['adapterCode', 'targetModule'])
export class ReconciliationJobEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'job_code', type: 'varchar', length: 64 })
  public jobCode!: string;

  @Column({ type: 'varchar', length: 160 })
  public name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public description!: string | null;

  @Column({ name: 'adapter_code', type: 'varchar', length: 64 })
  public adapterCode!: string;

  @Column({ name: 'target_module', type: 'varchar', length: 64 })
  public targetModule!: string;

  @Column({ name: 'schedule_cron', type: 'varchar', length: 64, nullable: true })
  public scheduleCron!: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  public isEnabled!: boolean;

  @Column({
    name: 'default_assignee_user_id',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public defaultAssigneeUserId!: number | null;

  @Column({ name: 'matching_rules_json', type: 'text', nullable: true })
  public matchingRulesJson!: string | null;

  @Column({ name: 'config_json', type: 'text', nullable: true })
  public configJson!: string | null;

  @Column({
    name: 'last_run_id',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public lastRunId!: number | null;

  @Column({ name: 'last_run_at', type: 'timestamp', nullable: true })
  public lastRunAt!: Date | null;

  @Column({ name: 'next_run_at', type: 'timestamp', nullable: true })
  public nextRunAt!: Date | null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public createdBy!: number | null;

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public updatedBy!: number | null;
}
