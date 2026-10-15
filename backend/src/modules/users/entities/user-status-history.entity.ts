import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import type { UserStatusCode } from '../contracts/index.js';

@Entity('user_status_histories')
export class UserStatusHistoryEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  /** Trạng thái trước khi đổi: 1 = ACTIVE, 2 = INACTIVE, 3 = LOCKED, 4 = ARCHIVED (null khi khởi tạo) */
  @Column({ name: 'from_status', type: 'int', nullable: true })
  public fromStatus?: UserStatusCode | null;

  /** Trạng thái mới: 1 = ACTIVE, 2 = INACTIVE, 3 = LOCKED, 4 = ARCHIVED */
  @Column({ name: 'to_status', type: 'int' })
  public toStatus!: UserStatusCode;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public reason?: string | null;

  @Column({ name: 'changed_by', type: 'int', nullable: true })
  public changedBy?: number | null;
}
