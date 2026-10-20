import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { FEATURE_FLAG_STATUS, type FeatureFlagStatusCode } from '@packages/kernel/index.js';

@Entity('feature_flags')
export class FeatureFlagEntity extends TypeOrmBaseEntity {
  /** Khóa Feature Flag duy nhất: `<module>.<feature>` (vd: `users.bulk_import` — Mục 5.2.1) */
  @Index({ unique: true })
  @Column({ name: 'flag_key', type: 'varchar', length: 150 })
  public flagKey!: string;

  /** Module sở hữu tính năng, phải nằm trong `enabledModules` của hệ thống (Mục 5.2.2) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  public module!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  /** Mô tả rõ ràng mục đích và phạm vi áp dụng của Feature Flag (Mục 5.2.1) */
  @Column({ type: 'text' })
  public description!: string;

  /** Trạng thái bật/tắt chức năng đã cài (Mục 5.2.2) */
  @Index()
  @Column({ name: 'is_enabled', type: 'boolean', default: false })
  public isEnabled!: boolean;

  /** Tỷ lệ phần trăm người dùng được rollout dần: 0..100 (Mục 5.2.6) */
  @Column({ name: 'rollout_percentage', type: 'int', default: 100 })
  public rolloutPercentage!: number;

  /** Danh sách ID người dùng được bật thử nghiệm dưới dạng JSON array (Mục 5.2.3) */
  @Column({ name: 'target_user_ids_json', type: 'text' })
  public targetUserIdsJson!: string;

  /** Danh sách mã vai trò (`role.code`) được phép sử dụng dưới dạng JSON array (Mục 5.2.4) */
  @Column({ name: 'target_roles_json', type: 'text' })
  public targetRolesJson!: string;

  /** Danh sách ID đơn vị tổ chức/chi nhánh được áp dụng dưới dạng JSON array (Mục 5.2.5) */
  @Column({ name: 'target_org_unit_ids_json', type: 'text' })
  public targetOrgUnitIdsJson!: string;

  /** Thời điểm bắt đầu có hiệu lực (Mục 5.2.7) */
  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  public startsAt?: Date | null;

  /** Thời điểm kết thúc thử nghiệm — tự động đóng tính năng khi quá hạn (Mục 5.2.7) */
  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  public endsAt?: Date | null;

  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;

  /** Cờ cốt lõi khai báo từ `module.manifest.json` (không được xóa định nghĩa) */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Index()
  @Column({ type: 'int', default: FEATURE_FLAG_STATUS.ACTIVE })
  public status!: FeatureFlagStatusCode;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  public updatedBy?: number | null;
}
