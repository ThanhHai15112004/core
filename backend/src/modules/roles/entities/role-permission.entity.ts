import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('role_permissions')
@Index(['roleId', 'permissionId'], { unique: true })
export class RolePermissionEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'role_id', type: 'int' })
  public roleId!: number;

  @Index()
  @Column({ name: 'permission_id', type: 'int' })
  public permissionId!: number;
}
