import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { I18N_ITEM_STATUS, type I18nItemStatusCode } from '@packages/i18n/index.js';

@Entity('i18n_locales')
export class I18nLocaleEntity extends TypeOrmBaseEntity {
  /** Mã ngôn ngữ chuẩn ISO 639-1 / BCP-47 (vd: `vi`, `en`, `ja`, `ko` — Mục 5.3.1 & 5.3.2) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 16 })
  public code!: string;

  /** Tag BCP-47 đầy đủ dùng cho Intl API (vd: `vi-VN`, `en-US`, `ja-JP`) */
  @Column({ name: 'bcp47_tag', type: 'varchar', length: 32, default: 'vi-VN' })
  public bcp47Tag!: string;

  /** Tên ngôn ngữ tiếng Anh/quốc tế (vd: `Vietnamese`, `English`, `Japanese`) */
  @Column({ type: 'varchar', length: 100 })
  public name!: string;

  /** Tên bản địa hiển thị trên bộ chọn ngôn ngữ (vd: `Tiếng Việt`, `English`, `日本語`) */
  @Column({ name: 'native_name', type: 'varchar', length: 100 })
  public nativeName!: string;

  /** Hướng văn bản: `ltr` hoặc `rtl` */
  @Column({ type: 'varchar', length: 8, default: 'ltr' })
  public direction!: string;

  /** Mẫu định dạng ngày ngắn theo ngôn ngữ (vd: `dd/MM/yyyy` hoặc `MM/dd/yyyy` — Mục 5.3.6) */
  @Column({ name: 'date_format', type: 'varchar', length: 32, default: 'dd/MM/yyyy' })
  public dateFormat!: string;

  /** Mẫu định dạng ngày giờ đầy đủ theo ngôn ngữ (vd: `dd/MM/yyyy HH:mm:ss` — Mục 5.3.6) */
  @Column({
    name: 'datetime_format',
    type: 'varchar',
    length: 64,
    default: 'dd/MM/yyyy HH:mm:ss',
  })
  public datetimeFormat!: string;

  /** Mã tiền tệ mặc định gắn với ngôn ngữ (vd: `VND`, `USD`, `JPY` — Mục 5.3.6) */
  @Column({ name: 'currency_code', type: 'varchar', length: 16, default: 'VND' })
  public currencyCode!: string;

  /** Ký tự phân cách phần thập phân (vd: `,` cho `vi`, `.` cho `en`) */
  @Column({ name: 'number_decimal_separator', type: 'varchar', length: 4, default: ',' })
  public numberDecimalSeparator!: string;

  /** Ký tự phân cách hàng nghìn (vd: `.` cho `vi`, `,` cho `en`) */
  @Column({ name: 'number_group_separator', type: 'varchar', length: 4, default: '.' })
  public numberGroupSeparator!: string;

  /** Ngôn ngữ mặc định của hệ thống (Mục 5.3.1) */
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
