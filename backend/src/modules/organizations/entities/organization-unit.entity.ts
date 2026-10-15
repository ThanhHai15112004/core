import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { OrganizationUnitStatus, OrganizationUnitType } from '../contracts/index.js';

@Entity('organization_units')
export class OrganizationUnitEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'BRANCH' })
  public type!: OrganizationUnitType;

  @Index()
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  public parentId?: string | null;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'ACTIVE' })
  public status!: OrganizationUnitStatus;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;
}
