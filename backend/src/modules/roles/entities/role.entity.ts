import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  ROLE_STATUS,
  type RoleStatusCode,
} from '../contracts/index.js';

@Entity('roles')
export class RoleEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  @Column({ type: 'varchar', length: 150 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  /** Phạm vi dữ liệu (Mục 4.3): 1 = ALL, 2 = ORG_UNIT, 3 = SUBORDINATES, 4 = SELF */
  @Index()
  @Column({ name: 'data_scope', type: 'int', default: DATA_SCOPE.SELF })
  public dataScope!: DataScopeCode;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE */
  @Index()
  @Column({ type: 'int', default: ROLE_STATUS.ACTIVE })
  public status!: RoleStatusCode;
}
