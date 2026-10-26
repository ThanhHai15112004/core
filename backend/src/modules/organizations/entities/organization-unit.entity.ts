import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  ORG_UNIT_STATUS,
  ORG_UNIT_TYPE,
  type OrganizationUnitStatusCode,
  type OrganizationUnitTypeCode,
} from '../contracts/index.js';

@Entity('organization_units')
export class OrganizationUnitEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  /** Loại đơn vị: 1 = HEADQUARTERS, 2 = BRANCH, 3 = DEPARTMENT, 4 = TEAM */
  @Index()
  @Column({ type: 'int', default: ORG_UNIT_TYPE.BRANCH })
  public type!: OrganizationUnitTypeCode;

  @Index()
  @Column({ name: 'parent_id', type: 'int', nullable: true })
  public parentId?: number | null;

  /** ID người phụ trách / quản lý đơn vị (tham chiếu logic tới users.id) */
  @Index()
  @Column({ name: 'manager_id', type: 'int', nullable: true })
  public managerId?: number | null;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE, 3 = ARCHIVED */
  @Index()
  @Column({ type: 'int', default: ORG_UNIT_STATUS.ACTIVE })
  public status!: OrganizationUnitStatusCode;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;
}
