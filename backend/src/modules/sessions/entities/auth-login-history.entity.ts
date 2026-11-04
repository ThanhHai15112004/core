import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  type AuthEventStatusCode,
  type AuthEventTypeCode,
} from '../contracts/index.js';

@Entity('auth_login_histories')
export class AuthLoginHistoryEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'int', nullable: true })
  public userId?: number | null;

  @Index()
  @Column({ name: 'session_id', type: 'int', nullable: true })
  public sessionId?: number | null;

  @Column({ name: 'identifier', type: 'varchar', length: 255, nullable: true })
  public identifier?: string | null;

  @Column({ name: 'event_type', type: 'int', default: AUTH_EVENT_TYPE.LOGIN_SUCCESS })
  public eventType!: AuthEventTypeCode;

  @Column({ name: 'status', type: 'int', default: AUTH_EVENT_STATUS.SUCCESS })
  public status!: AuthEventStatusCode;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  public userAgent?: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 128, nullable: true })
  public deviceName?: string | null;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  public reason?: string | null;
}
