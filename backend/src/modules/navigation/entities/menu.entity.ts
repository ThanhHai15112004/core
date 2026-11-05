import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

/**
 * Thực thể ánh xạ bảng `menus` (1 bảng duy nhất chuẩn KISS — Mục 5.6):
 * Quản lý cây điều hướng đa cấp (`parent`, `level`, `num_order`), bật/tắt (`status`),
 * khóa phân quyền (`key`), vị trí (`position`), loại hiển thị (`type`),
 * đường dẫn Frontend (`link`) và API Backend (`link_api`).
 */
@Entity('menus')
@Index('idx_menus_parent_order', ['parent', 'status', 'numOrder'])
@Index('idx_menus_position', ['position', 'status', 'level', 'numOrder'])
export class MenuEntity extends TypeOrmBaseEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  public code!: string;

  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  /** `1 = ACTIVE (Bật)`, `0 = INACTIVE (Tắt)` */
  @Column({ type: 'int', default: 1 })
  public status!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public link?: string | null;

  @Column({ name: 'link_api', type: 'varchar', length: 255, nullable: true })
  public linkApi?: string | null;

  /** `1 = GROUP`, `2 = ITEM`, `3 = EXTERNAL`, `4 = ACTION` */
  @Column({ type: 'int', default: 1 })
  public type!: number;

  /** ID của menu cha trong bảng `menus` (`null` nếu là menu gốc cấp 1) */
  @Column({ type: 'int', nullable: true })
  public parent?: number | null;

  /** Cấp độ sâu trên cây: `1 = gốc`, `2 = con`, `3 = cháu...` */
  @Column({ type: 'int', default: 1 })
  public level!: number;

  /** Permission key dùng để phân quyền ẩn/hiện tự động theo vai trò (vd: `users.read`, `roles.read`) */
  @Column({ name: 'key', type: 'varchar', length: 150, nullable: true })
  public key?: string | null;

  @Column({ name: 'num_order', type: 'int', default: 0 })
  public numOrder!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public icon?: string | null;

  /** Vị trí hiển thị: `'SIDEBAR'`, `'TOPBAR'`, `'FOOTER'`, `'SYSTEM_CONSOLE'` */
  @Column({ type: 'varchar', length: 32, default: 'SIDEBAR' })
  public position!: string;
}
