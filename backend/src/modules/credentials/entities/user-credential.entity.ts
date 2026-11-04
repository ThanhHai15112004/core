import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

@Entity('user_credentials')
export class UserCredentialEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  public passwordHash!: string;

  @Column({ name: 'password_changed_at', type: 'timestamp', nullable: true })
  public passwordChangedAt?: Date | null;

  @Column({ name: 'password_history_hashes_json', type: 'text', nullable: true })
  public passwordHistoryHashesJson?: string | null;
}
