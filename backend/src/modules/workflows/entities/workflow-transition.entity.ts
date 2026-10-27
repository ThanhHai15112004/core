import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('workflow_transitions')
@Index(['workflowDefinitionId', 'fromStateCode'])
export class WorkflowTransitionEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'workflow_definition_id', type: 'int' })
  public workflowDefinitionId!: number;

  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 128 })
  public name!: string;

  @Column({ name: 'from_state_code', type: 'varchar', length: 64 })
  public fromStateCode!: string;

  @Column({ name: 'to_state_code', type: 'varchar', length: 64 })
  public toStateCode!: string;

  @Column({ name: 'conditions_json', type: 'text', nullable: true })
  public conditionsJson?: string | null;

  @Column({ name: 'actions_json', type: 'text', nullable: true })
  public actionsJson?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 1 })
  public sortOrder!: number;
}
