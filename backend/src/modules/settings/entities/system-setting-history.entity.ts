import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  SETTING_ENVIRONMENT,
  SETTING_VALUE_TYPE,
  type SettingEnvironmentCode,
  type SettingValueTypeCode,
} from '@packages/kernel/index.js';

@Entity('system_setting_histories')
export class SystemSettingHistoryEntity extends TypeOrmBaseEntity {
  /** ID cấu hình được thay đổi tham chiếu `system_settings.id` (Mục 5.1.7 — chuẩn hóa lưu `int`) */
  @Index()
  @Column({ name: 'setting_id', type: 'int' })
  public settingId!: number;

  /** Mã số nguyên môi trường áp dụng (`1 = ALL`, `2 = DEVELOPMENT`, `3 = STAGING`, `4 = PRODUCTION`, `5 = TEST`) */
  @Index()
  @Column({ type: 'int', default: SETTING_ENVIRONMENT.ALL })
  public environment!: SettingEnvironmentCode;

  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  @Column({ name: 'value_type', type: 'int', default: SETTING_VALUE_TYPE.TEXT })
  public valueType!: SettingValueTypeCode;

  /** Giá trị cũ trước khi thay đổi (đã che `'••••••••'` nếu là cấu hình nhạy cảm) */
  @Column({ name: 'old_value', type: 'text', nullable: true })
  public oldValue?: string | null;

  /** Giá trị mới sau khi thay đổi (đã che `'••••••••'` nếu là cấu hình nhạy cảm) */
  @Column({ name: 'new_value', type: 'text' })
  public newValue!: string;

  /** ID người dùng thực hiện thay đổi (Mục 5.1.7) */
  @Index()
  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  public actorUserId?: number | null;

  @Column({ name: 'actor_identifier', type: 'varchar', length: 150, nullable: true })
  public actorIdentifier?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason?: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  public userAgent?: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  public requestId?: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  public correlationId?: string | null;
}
