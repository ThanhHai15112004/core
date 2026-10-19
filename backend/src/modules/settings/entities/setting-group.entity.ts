import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { SETTING_ITEM_STATUS, type SettingItemStatusCode } from '@packages/kernel/index.js';

@Entity('setting_groups')
export class SettingGroupEntity extends TypeOrmBaseEntity {
  /** Mã định danh nhóm cấu hình (vd: `email`, `file`, `security`, `ui`, `system` — Mục 5.1.1) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  public code!: string;

  /** Module sở hữu nhóm cấu hình */
  @Index()
  @Column({ type: 'varchar', length: 64, default: 'settings' })
  public module!: string;

  /** Tên hiển thị của nhóm cấu hình */
  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public icon?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  public sortOrder!: number;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  public isSystem!: boolean;

  @Index()
  @Column({ type: 'int', default: SETTING_ITEM_STATUS.ACTIVE })
  public status!: SettingItemStatusCode;
}
