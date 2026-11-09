import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { UserOrganizationHistoryActionType } from '../contracts/index.js';

@Entity({ name: 'user_organization_histories' })
export class UserOrganizationHistoryEntity extends TypeOrmBaseEntity {
  @Index('idx_user_org_histories_user_id')
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Index('idx_user_org_histories_org_id')
  @Column({ name: 'organization_unit_id', type: 'int' })
  public organizationUnitId!: number;

  @Column({ name: 'from_organization_unit_id', type: 'int', nullable: true })
  public fromOrganizationUnitId!: number | null;

  @Index('idx_user_org_histories_action_type')
  @Column({ name: 'action_type', type: 'varchar', length: 32, default: 'ASSIGN' })
  public actionType!: UserOrganizationHistoryActionType;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  public isPrimary!: boolean;

  @Column({ name: 'position_title', type: 'varchar', length: 128, nullable: true })
  public positionTitle!: string | null;

  @Column({ name: 'start_date', type: 'timestamptz', nullable: true })
  public startDate!: Date | null;

  @Column({ name: 'end_date', type: 'timestamptz', nullable: true })
  public endDate!: Date | null;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  public reason!: string | null;

  @Column({ name: 'changed_by', type: 'int', nullable: true })
  public changedBy!: number | null;
}
