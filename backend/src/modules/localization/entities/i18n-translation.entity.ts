import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { I18N_ITEM_STATUS, type I18nItemStatusCode } from '@packages/i18n/index.js';

@Entity('i18n_translations')
@Index(['locale', 'translationKey'], { unique: true })
export class I18nTranslationEntity extends TypeOrmBaseEntity {
  /** Mã ngôn ngữ của bản dịch (vd: `vi`, `en`, `ja` — Mục 5.3.3) */
  @Index()
  @Column({ type: 'varchar', length: 16 })
  public locale!: string;

  /** Phân nhóm / module của khóa dịch (vd: `common`, `auth`, `users`, `roles`, `settings`) */
  @Index()
  @Column({ type: 'varchar', length: 64, default: 'common' })
  public namespace!: string;

  /** Khóa thông báo / nhãn dịch (vd: `NOT_FOUND`, `users.notFound`, `auth.invalidCredentials`) */
  @Index()
  @Column({ name: 'translation_key', type: 'varchar', length: 191 })
  public translationKey!: string;

  /** Nội dung thông báo đã dịch theo ngôn ngữ (hỗ trợ `{param}` / `{{param}}`) */
  @Column({ name: 'translation_value', type: 'text' })
  public translationValue!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public description?: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  public isSystem!: boolean;

  @Index()
  @Column({ type: 'int', default: I18N_ITEM_STATUS.ACTIVE })
  public status!: I18nItemStatusCode;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  public updatedBy?: number | null;
}
