import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  SETTING_ITEM_STATUS,
  SETTING_VALUE_TYPE,
  type SettingItemStatusCode,
  type SettingValueTypeCode,
} from '@packages/kernel/index.js';

@Entity('system_settings')
export class SystemSettingEntity extends TypeOrmBaseEntity {
  /** Khóa cấu hình duy nhất: `<group>.<feature>.<name>` (vd: `security.password.min_length` — Mục 5.1.1 & 5.1.2) */
  @Index({ unique: true })
  @Column({ name: 'setting_key', type: 'varchar', length: 150 })
  public settingKey!: string;

  /** ID nhóm cấu hình tham chiếu `setting_groups.id` (Mục 5.1.1 — chuẩn hóa lưu số nguyên `int`) */
  @Index()
  @Column({ name: 'group_id', type: 'int' })
  public groupId!: number;

  /** Module sở hữu cấu hình (vd: `auth`, `users`, `settings` — Mục 5.1.2) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  public module!: string;

  /** Namespace riêng của module (vd: `auth.password`, `system.email`, `system.file` — Mục 5.1.2) */
  @Index()
  @Column({ type: 'varchar', length: 120 })
  public namespace!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  /** Kiểu dữ liệu: 1 = TEXT, 2 = NUMBER, 3 = BOOLEAN, 4 = JSON (Mục 5.1.3) */
  @Column({ name: 'value_type', type: 'int', default: SETTING_VALUE_TYPE.TEXT })
  public valueType!: SettingValueTypeCode;

  /** Giá trị mặc định gốc từ Manifest (dạng chuỗi serialized) */
  @Column({ name: 'default_value', type: 'text' })
  public defaultValue!: string;

  /** Giá trị toàn cục hiện hành (đã mã hóa nếu `isEncrypted = true`) */
  @Column({ name: 'global_value', type: 'text' })
  public globalValue!: string;

  /** Quy tắc kiểm tra dữ liệu bổ sung (`min`, `max`, `integerOnly`, `pattern`...) dưới dạng JSON */
  @Column({ name: 'validation_rules_json', type: 'text', nullable: true })
  public validationRulesJson?: string | null;

  /** Cờ đánh dấu cấu hình nhạy cảm cần mã hóa và che `'••••••••'` khi trả ra ngoài (Mục 5.1.6) */
  @Column({ name: 'is_sensitive', type: 'boolean', default: false })
  public isSensitive!: boolean;

  /** Cờ đánh dấu `global_value` hiện đang được mã hóa bởi `FieldEncryptionService` */
  @Column({ name: 'is_encrypted', type: 'boolean', default: false })
  public isEncrypted!: boolean;

  /** Cho phép ghi đè cấu hình theo từng đơn vị tổ chức (`organization_unit_id`) khi dự án cần (Mục 5.1.5) */
  @Column({ name: 'allow_unit_override', type: 'boolean', default: true })
  public allowUnitOverride!: boolean;

  /** Cấu hình cốt lõi của hệ thống (không được phép xóa định nghĩa) */
  @Column({ name: 'is_system', type: 'boolean', default: true })
  public isSystem!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  public sortOrder!: number;

  @Index()
  @Column({ type: 'int', default: SETTING_ITEM_STATUS.ACTIVE })
  public status!: SettingItemStatusCode;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  public updatedBy?: number | null;
}
