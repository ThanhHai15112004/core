import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  type WorkflowApprovalDecision,
  type WorkflowApprovalMode,
} from '../enum/workflows.enum.js';

@Entity('workflow_approval_steps')
@Index(['workflowInstanceId', 'stepOrder'])
export class WorkflowApprovalStepEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'workflow_instance_id', type: 'int' })
  public workflowInstanceId!: number;

  @Column({ name: 'state_code', type: 'varchar', length: 64 })
  public stateCode!: string;

  @Column({ name: 'step_order', type: 'int', default: 1 })
  public stepOrder!: number;

  @Column({
    name: 'approval_mode',
    type: 'varchar',
    length: 32,
    default: WORKFLOW_APPROVAL_MODE.SINGLE,
  })
  public approvalMode!: WorkflowApprovalMode;

  @Index()
  @Column({ name: 'approver_user_id', type: 'int', nullable: true })
  public approverUserId?: number | null;

  @Column({ name: 'delegated_from_user_id', type: 'int', nullable: true })
  public delegatedFromUserId?: number | null;

  @Column({ name: 'approver_role_code', type: 'varchar', length: 64, nullable: true })
  public approverRoleCode?: string | null;

  /** PENDING | APPROVED | REJECTED | RETURNED | SKIPPED */
  @Index()
  @Column({ type: 'varchar', length: 32, default: WORKFLOW_APPROVAL_DECISION.PENDING })
  public decision!: WorkflowApprovalDecision;

  @Column({ type: 'text', nullable: true })
  public comment?: string | null;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true })
  public decidedAt?: Date | null;

  @Column({ name: 'decided_by_user_id', type: 'int', nullable: true })
  public decidedByUserId?: number | null;
}
