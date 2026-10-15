import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { RoleStatus } from '../contracts/index.js';

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

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'ACTIVE' })
  public status!: RoleStatus;
}
