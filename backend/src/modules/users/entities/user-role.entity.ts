import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('user_roles')
@Index(['userId', 'roleId'], { unique: true })
export class UserRoleEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  public userId!: string;

  @Index()
  @Column({ name: 'role_id', type: 'uuid' })
  public roleId!: string;

  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  public assignedBy?: string | null;
}
