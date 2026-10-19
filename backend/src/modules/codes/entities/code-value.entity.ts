import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { CODE_ITEM_STATUS, type CodeItemStatusCode } from '@packages/kernel/index.js';

@Entity('code_values')
@Index('uq_code_values_type_numeric', ['typeCode', 'numericCode'], { unique: true })
@Index('uq_code_values_type_code', ['typeCode', 'code'], { unique: true })
export class CodeValueEntity extends TypeOrmBaseEntity {
  /** Tham chiếu mềm tới `code_types.code` (vd: `organizations.unit_type`) */
  @Index()
  @Column({ name: 'type_code', type: 'varchar', length: 100 })
  public typeCode!: string;

  /** Mã số nguyên lưu trữ trong các bảng nghiệp vụ (1, 2, 3, 4, 5...) */
  @Column({ name: 'numeric_code', type: 'int' })
  public numericCode!: number;

  /** Mã chuỗi định danh của giá trị (vd: `HEADQUARTERS`, `CAMPUS`, `ACTIVE`) */
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  /** Mã hành vi nền tảng (Hybrid Anchor) mà bản ghi này kế thừa (vd: `LOCKED`, `DEPARTMENT`) */
  @Column({ name: 'behavior_code', type: 'varchar', length: 64, nullable: true })
  public behaviorCode?: string | null;

  /** Tên hiển thị mặc định */
  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  /** Bản dịch đa ngôn ngữ Zero-JOIN dạng JSON: `{"vi": "...", "en": "..."}` */
  @Column({ name: 'labels_json', type: 'text', nullable: true })
  public labelsJson?: string | null;

  /** Mảng từ đồng nghĩa / từ khóa import CSV dạng JSON: `["khóa", "bị khóa", "locked"]` */
  @Column({ name: 'aliases_json', type: 'text', nullable: true })
  public aliasesJson?: string | null;

  /** Màu sắc badge UI (vd: `emerald`, `amber`, `rose`, `#10B981`) */
  @Column({ type: 'varchar', length: 32, nullable: true })
  public color?: string | null;

  /** Tên icon UI */
  @Column({ type: 'varchar', length: 64, nullable: true })
  public icon?: string | null;

  /** Thứ tự sắp xếp hiển thị trên Dropdown/Table */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  public sortOrder!: number;

  /** Giá trị mặc định khi tạo mới bản ghi nghiệp vụ */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  public isDefault!: boolean;

  /** Giá trị neo hệ thống (`true` = không được phép xóa hoặc đổi `numeric_code`/`code`) */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  /** Cấu hình mở rộng dạng JSON (vd: `{"canHaveChildren": true}`) */
  @Column({ name: 'metadata_json', type: 'text', nullable: true })
  public metadataJson?: string | null;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE */
  @Index()
  @Column({ type: 'int', default: CODE_ITEM_STATUS.ACTIVE })
  public status!: CodeItemStatusCode;
}
