import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { I18N_ITEM_STATUS, type I18nItemStatusCode } from '@packages/i18n/index.js';

@Entity('i18n_timezones')
export class I18nTimezoneEntity extends TypeOrmBaseEntity {
  /** Mã múi giờ chuẩn IANA (vd: `Asia/Ho_Chi_Minh`, `UTC`, `Asia/Tokyo`, `America/New_York` — Mục 5.3.4 & 5.3.5) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  /** Tên hiển thị mặc định của khung giờ */
  @Column({ type: 'varchar', length: 150 })
  public name!: string;

  /** Nhãn đa ngôn ngữ JSON (`{ "vi": "...", "en": "..." }`) */
  @Column({ name: 'labels_json', type: 'text', nullable: true })
  public labelsJson?: string | null;

  /** Độ lệch chuẩn so với UTC (vd: `+07:00`, `+00:00`, `+09:00`, `-05:00`) */
  @Column({ name: 'utc_offset', type: 'varchar', length: 16, default: '+07:00' })
  public utcOffset!: string;

  /** Số phút lệch so với UTC (vd: `420` cho `+07:00`, `0` cho `UTC`, `540` cho `+09:00`) */
  @Column({ name: 'utc_offset_minutes', type: 'int', default: 420 })
  public utcOffsetMinutes!: number;

  /** Khu vực địa lý (vd: `Asia`, `UTC`, `Europe`, `America`) */
  @Index()
  @Column({ type: 'varchar', length: 64, default: 'Asia' })
  public region!: string;

  /** Múi giờ mặc định của hệ thống (Mục 5.3.4 & 5.3.5) */
  @Index()
  @Column({ name: 'is_default', type: 'boolean', default: false })
  public isDefault!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 1 })
  public sortOrder!: number;

  @Index()
  @Column({ type: 'int', default: I18N_ITEM_STATUS.ACTIVE })
  public status!: I18nItemStatusCode;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  public updatedBy?: number | null;
}
