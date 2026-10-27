import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { WORKFLOW_STATE_TYPE, type WorkflowStateType } from '../enum/workflows.enum.js';

@Entity('workflow_states')
@Index(['workflowDefinitionId', 'code'], { unique: true })
export class WorkflowStateEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'workflow_definition_id', type: 'int' })
  public workflowDefinitionId!: number;

  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 128 })
  public name!: string;

  /** INITIAL | INTERMEDIATE | FINAL_APPROVED | FINAL_REJECTED | CANCELLED */
  @Column({
    name: 'state_type',
    type: 'varchar',
    length: 32,
    default: WORKFLOW_STATE_TYPE.INTERMEDIATE,
  })
  public stateType!: WorkflowStateType;

  @Column({ name: 'badge_tone', type: 'varchar', length: 32, default: 'info' })
  public badgeTone!: string;

  @Column({ name: 'sla_hours', type: 'int', nullable: true })
  public slaHours?: number | null;

  @Column({ name: 'approval_config_json', type: 'text', nullable: true })
  public approvalConfigJson?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 1 })
  public sortOrder!: number;
}
