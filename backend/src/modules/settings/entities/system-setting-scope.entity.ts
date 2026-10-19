import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { SETTING_ENVIRONMENT, type SettingEnvironmentCode } from '@packages/kernel/index.js';

@Entity('system_setting_scopes')
@Index('idx_system_setting_scopes_lookup', ['settingId', 'environment', 'organizationUnitId'])
export class SystemSettingScopeEntity extends TypeOrmBaseEntity {
  /** ID định nghĩa cấu hình tham chiếu `system_settings.id` (chuẩn hóa lưu số nguyên `int`) */
  @Index()
  @Column({ name: 'setting_id', type: 'int' })
  public settingId!: number;

  /** Mã số nguyên môi trường áp dụng (`1 = ALL`, `2 = DEVELOPMENT`, `3 = STAGING`, `4 = PRODUCTION`, `5 = TEST` — Mục 5.1.4) */
  @Index()
  @Column({ type: 'int', default: SETTING_ENVIRONMENT.ALL })
  public environment!: SettingEnvironmentCode;

  /** ID đơn vị tổ chức áp dụng (`NULL` nếu áp dụng toàn hệ thống theo môi trường — Mục 5.1.5) */
  @Index()
  @Column({ name: 'organization_unit_id', type: 'int', nullable: true })
  public organizationUnitId?: number | null;

  /** Giá trị cấu hình ở phạm vi này (đã mã hóa nếu `isEncrypted = true`) */
  @Column({ name: 'setting_value', type: 'text' })
  public settingValue!: string;

  @Column({ name: 'is_encrypted', type: 'boolean', default: false })
  public isEncrypted!: boolean;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  public updatedBy?: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason?: string | null;
}
