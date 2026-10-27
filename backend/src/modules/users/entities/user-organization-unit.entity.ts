import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('user_organization_units')
@Index(['userId', 'organizationUnitId'], { unique: true })
export class UserOrganizationUnitEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int' })
  public organizationUnitId!: number;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  public isPrimary!: boolean;

  @Column({ name: 'position_title', type: 'varchar', length: 128, nullable: true })
  public positionTitle?: string | null;

  @Column({ name: 'start_date', type: 'timestamp', nullable: true })
  public startDate?: Date | null;

  @Column({ name: 'end_date', type: 'timestamp', nullable: true })
  public endDate?: Date | null;
}
