import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import {
  SEQUENCE_DATE_FORMAT,
  SEQUENCE_RESET_POLICY,
  SEQUENCE_STATUS,
  type SequenceDateFormatCode,
  type SequenceResetPolicyCode,
  type SequenceStatusCode,
} from '@packages/kernel/index.js';

@Entity('sequence_rules')
export class SequenceRuleEntity extends TypeOrmBaseEntity {
  /** Khóa quy tắc sinh mã duy nhất: `<module>.<sequence_name>` (vd: `orders.sales_order` — Mục 5.5.1) */
  @Index({ unique: true })
  @Column({ name: 'sequence_key', type: 'varchar', length: 150 })
  public sequenceKey!: string;

  /** Module sở hữu quy tắc sinh mã (vd: `orders`, `users`, `settings`) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  public module!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  /** Tiền tố theo loại nghiệp vụ (vd: `ORD`, `INV`, `EMP` — Mục 5.5.2) */
  @Column({ type: 'varchar', length: 32, default: '' })
  public prefix!: string;

  /** Hậu tố theo loại nghiệp vụ (vd: `VN`, `VIP` — Mục 5.5.2) */
  @Column({ type: 'varchar', length: 32, default: '' })
  public suffix!: string;

  /** Ký tự phân cách giữa các phần (`-`, `/`, `_`, `''`) */
  @Column({ name: 'separator_char', type: 'varchar', length: 8, default: '-' })
  public separator!: string;

  /** Định dạng chèn ngày/tháng/năm vào mã (`0=NONE..6=YYMMDD` — Mục 5.5.3) */
  @Column({ name: 'date_format', type: 'int', default: SEQUENCE_DATE_FORMAT.YYYY })
  public dateFormat!: SequenceDateFormatCode;

  /** Mẫu biểu thức tùy chỉnh (`{PREFIX}-{UNIT}-{DATE}-{SEQ}{SUFFIX}`) */
  @Column({ name: 'template_pattern', type: 'varchar', length: 255, nullable: true })
  public templatePattern?: string | null;

  /** Độ dài chữ số phần thứ tự (`1..12`, mặc định `6` -> `000001`) */
  @Column({ name: 'padding_length', type: 'int', default: 6 })
  public paddingLength!: number;

  /** Giá trị bắt đầu khi khởi tạo hoặc khi sang kỳ reset mới */
  @Column({ name: 'start_value', type: 'bigint', default: 1 })
  public startValue!: number;

  /** Bước nhảy mỗi lần cấp mã */
  @Column({ type: 'int', default: 1 })
  public step!: number;

  /** Chính sách reset số thứ tự theo kỳ: `1=NEVER`, `2=YEARLY`, `3=MONTHLY`, `4=DAILY` (Mục 5.5.5) */
  @Column({ name: 'reset_policy', type: 'int', default: SEQUENCE_RESET_POLICY.YEARLY })
  public resetPolicy!: SequenceResetPolicyCode;

  /** Cờ sinh mã và tách bộ đếm riêng theo đơn vị tổ chức (Mục 5.5.6) */
  @Column({ name: 'scope_by_unit', type: 'boolean', default: false })
  public scopeByUnit!: boolean;

  /** Múi giờ chuẩn IANA phục vụ tính ngày/tháng/năm và chuyển kỳ reset */
  @Column({ type: 'varchar', length: 64, default: 'Asia/Ho_Chi_Minh' })
  public timezone!: string;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  public isSystem!: boolean;

  @Index()
  @Column({ type: 'int', default: SEQUENCE_STATUS.ACTIVE })
  public status!: SequenceStatusCode;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  public updatedBy?: number | null;
}
