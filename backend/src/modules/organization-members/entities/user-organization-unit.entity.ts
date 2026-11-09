import { Column, Entity, Index, Unique } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity({ name: 'user_organization_units' })
@Unique('uq_user_org_units_user_org', ['userId', 'organizationUnitId'])
export class UserOrganizationUnitEntity extends TypeOrmBaseEntity {
  @Index('idx_user_org_units_user_id')
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Index('idx_user_org_units_org_id')
  @Column({ name: 'organization_unit_id', type: 'int' })
  public organizationUnitId!: number;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  public isPrimary!: boolean;

  @Column({ name: 'position_title', type: 'varchar', length: 128, nullable: true })
  public positionTitle!: string | null;

  @Column({ name: 'start_date', type: 'timestamptz', nullable: true })
  public startDate!: Date | null;

  @Column({ name: 'end_date', type: 'timestamptz', nullable: true })
  public endDate!: Date | null;
}
