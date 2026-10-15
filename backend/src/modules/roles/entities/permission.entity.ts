import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { PERMISSION_STATUS, type PermissionStatusCode } from '../contracts/index.js';

@Entity('permissions')
export class PermissionEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  public code!: string;

  @Column({ type: 'varchar', length: 150 })
  public name!: string;

  @Index()
  @Column({ type: 'varchar', length: 64, default: 'core' })
  public module!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE */
  @Index()
  @Column({ type: 'int', default: PERMISSION_STATUS.ACTIVE })
  public status!: PermissionStatusCode;
}
