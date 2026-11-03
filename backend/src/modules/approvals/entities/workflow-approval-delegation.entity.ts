import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('workflow_approval_delegations')
@Index(['fromUserId', 'isActive'])
@Index(['toUserId', 'isActive'])
export class WorkflowApprovalDelegationEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'from_user_id', type: 'int' })
  public fromUserId!: number;

  @Index()
  @Column({ name: 'to_user_id', type: 'int' })
  public toUserId!: number;

  @Column({ name: 'effective_from', type: 'timestamp' })
  public effectiveFrom!: Date;

  @Column({ name: 'effective_until', type: 'timestamp' })
  public effectiveUntil!: Date;

  @Column({ name: 'workflow_codes_json', type: 'text', nullable: true })
  public workflowCodesJson?: string | null;

  @Column({ name: 'entity_types_json', type: 'text', nullable: true })
  public entityTypesJson?: string | null;

  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason?: string | null;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  public isActive!: boolean;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  public createdByUserId?: number | null;
}
