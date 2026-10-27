import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  WORKFLOW_HISTORY_ACTION_TYPE,
  type WorkflowHistoryActionType,
} from '../enum/workflows.enum.js';

@Entity('workflow_histories')
@Index(['workflowInstanceId', 'createdAt'])
export class WorkflowHistoryEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'workflow_instance_id', type: 'int' })
  public workflowInstanceId!: number;

  @Column({ name: 'transition_code', type: 'varchar', length: 64, nullable: true })
  public transitionCode?: string | null;

  /** START | TRANSITION | APPROVE | REJECT | RETURN | DELEGATE | CANCEL | TERMINATE | SLA_WARNING | SLA_OVERDUE */
  @Column({
    name: 'action_type',
    type: 'varchar',
    length: 32,
    default: WORKFLOW_HISTORY_ACTION_TYPE.TRANSITION,
  })
  public actionType!: WorkflowHistoryActionType;

  @Column({ name: 'from_state_code', type: 'varchar', length: 64, nullable: true })
  public fromStateCode?: string | null;

  @Column({ name: 'to_state_code', type: 'varchar', length: 64 })
  public toStateCode!: string;

  @Index()
  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  public actorUserId?: number | null;

  @Column({ type: 'text', nullable: true })
  public reason?: string | null;

  @Column({ name: 'triggered_actions_json', type: 'text', nullable: true })
  public triggeredActionsJson?: string | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;
}
