import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('user_roles')
@Index(['userId', 'roleId'], { unique: true })
export class UserRoleEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Index()
  @Column({ name: 'role_id', type: 'int' })
  public roleId!: number;

  @Column({ name: 'assigned_by', type: 'int', nullable: true })
  public assignedBy?: number | null;
}
