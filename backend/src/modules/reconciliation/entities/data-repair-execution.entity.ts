import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import type {
  DataRepairExecutionMode,
  DataRepairExecutionStatus,
} from '../enum/reconciliation.enum.js';
import {
  reconBigintTransformer,
  reconNullableBigintTransformer,
} from '../helpers/reconciliation-bigint.helper.js';

/** Nhật ký bất biến (append-only) cho từng lần DRY_RUN / APPLY / COMPENSATE */
@Entity({ name: 'data_repair_executions' })
@Index('IDX_data_repair_exec_req', ['repairRequestId', 'executedAt'])
export class DataRepairExecutionEntity extends VersionedTypeOrmEntity {
  @Column({ name: 'repair_request_id', type: 'bigint', transformer: reconBigintTransformer })
  public repairRequestId!: number;

  @Column({ name: 'repair_code', type: 'varchar', length: 64 })
  public repairCode!: string;

  @Column({ name: 'execution_mode', type: 'varchar', length: 24 })
  public executionMode!: DataRepairExecutionMode;

  @Column({ name: 'execution_status', type: 'varchar', length: 24 })
  public executionStatus!: DataRepairExecutionStatus;

  @Column({ name: 'affected_count', type: 'int', default: 0 })
  public affectedCount!: number;

  @Column({
    name: 'actor_user_id',
    type: 'bigint',
    nullable: true,
    transformer: reconNullableBigintTransformer,
  })
  public actorUserId!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public summary!: string | null;

  @Column({ name: 'before_data_json', type: 'text', nullable: true })
  public beforeDataJson!: string | null;

  @Column({ name: 'after_data_json', type: 'text', nullable: true })
  public afterDataJson!: string | null;

  @Column({ name: 'diff_json', type: 'text', nullable: true })
  public diffJson!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  public errorMessage!: string | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  public durationMs!: number;

  @Column({ name: 'executed_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  public executedAt!: Date;
}
