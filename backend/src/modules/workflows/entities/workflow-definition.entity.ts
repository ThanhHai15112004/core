import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  WORKFLOW_DEFINITION_STATUS,
  type WorkflowDefinitionStatusCode,
} from '../enum/workflows.enum.js';

@Entity('workflow_definitions')
@Index(['code', 'version'], { unique: true })
export class WorkflowDefinitionEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'int', default: 1 })
  public version!: number;

  @Column({ type: 'varchar', length: 180 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Index()
  @Column({ name: 'target_entity_type', type: 'varchar', length: 64, default: 'general' })
  public targetEntityType!: string;

  @Column({ name: 'default_sla_hours', type: 'int', default: 24 })
  public defaultSlaHours!: number;

  @Column({ name: 'warning_before_minutes', type: 'int', default: 120 })
  public warningBeforeMinutes!: number;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  /** 1 = ACTIVE, 2 = INACTIVE, 3 = DRAFT, 4 = ARCHIVED */
  @Index()
  @Column({ type: 'int', default: WORKFLOW_DEFINITION_STATUS.ACTIVE })
  public status!: WorkflowDefinitionStatusCode;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  public createdByUserId?: number | null;
}
