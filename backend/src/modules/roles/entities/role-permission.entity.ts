import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('role_permissions')
@Index(['roleId', 'permissionCode'], { unique: true })
export class RolePermissionEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'role_id', type: 'uuid' })
  public roleId!: string;

  @Index()
  @Column({ name: 'permission_code', type: 'varchar', length: 128 })
  public permissionCode!: string;
}
