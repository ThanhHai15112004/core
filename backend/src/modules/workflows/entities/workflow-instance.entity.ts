import { Column, Entity, Index } from 'typeorm';
import { VersionedTypeOrmEntity } from '@packages/database/index.js';
import {
  WORKFLOW_INSTANCE_STATUS,
  type WorkflowInstanceStatusCode,
} from '../enum/workflows.enum.js';

@Entity('workflow_instances')
@Index(['entityType', 'entityId'])
@Index(['status', 'dueAt'])
export class WorkflowInstanceEntity extends VersionedTypeOrmEntity {
  @Index()
  @Column({ name: 'workflow_definition_id', type: 'int' })
  public workflowDefinitionId!: number;

  @Index()
  @Column({ name: 'workflow_code', type: 'varchar', length: 64 })
  public workflowCode!: string;

  @Column({ name: 'workflow_version', type: 'int', default: 1 })
  public workflowVersion!: number;

  @Column({ name: 'entity_type', type: 'varchar', length: 64 })
  public entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 128 })
  public entityId!: string;

  @Column({ type: 'varchar', length: 255 })
  public title!: string;

  @Column({ name: 'current_state_code', type: 'varchar', length: 64 })
  public currentStateCode!: string;

  /** 1 = RUNNING, 2 = COMPLETED, 3 = REJECTED, 4 = CANCELLED, 5 = EXPIRED */
  @Index()
  @Column({ type: 'int', default: WORKFLOW_INSTANCE_STATUS.RUNNING })
  public status!: WorkflowInstanceStatusCode;

  @Index()
  @Column({ name: 'initiator_user_id', type: 'int', nullable: true })
  public initiatorUserId?: number | null;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ name: 'current_step_order', type: 'int', default: 1 })
  public currentStepOrder!: number;

  @Column({ name: 'due_at', type: 'timestamp', nullable: true })
  public dueAt?: Date | null;

  @Column({ name: 'warning_sent_at', type: 'timestamp', nullable: true })
  public warningSentAt?: Date | null;

  @Column({ name: 'overdue_notified_at', type: 'timestamp', nullable: true })
  public overdueNotifiedAt?: Date | null;

  @Column({ name: 'is_overdue', type: 'boolean', default: false })
  public isOverdue!: boolean;

  @Column({ name: 'context_data_json', type: 'text', nullable: true })
  public contextDataJson?: string | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 500, nullable: true })
  public cancelReason?: string | null;

  @Column({ name: 'cancelled_by_user_id', type: 'int', nullable: true })
  public cancelledByUserId?: number | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  public completedAt?: Date | null;
}
