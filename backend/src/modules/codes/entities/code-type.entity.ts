import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { CODE_ITEM_STATUS, type CodeItemStatusCode } from '@packages/kernel/index.js';

@Entity('code_types')
export class CodeTypeEntity extends TypeOrmBaseEntity {
  /** Mã định danh nhóm danh mục có namespace: `<module>.<type_code>` (vd: `organizations.unit_type`) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  public code!: string;

  /** Phân hệ sở hữu (vd: `organizations`, `users`, `roles`, `auth`) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  public module!: string;

  /** Tên hiển thị mặc định của nhóm danh mục */
  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  /** Danh mục hệ thống cốt lõi (không được xóa nhóm danh mục) */
  @Column({ name: 'is_system', type: 'boolean', default: true })
  public isSystem!: boolean;

  /** Cho phép Admin tạo thêm giá trị động mới trên UI hay khóa cứng theo manifest */
  @Column({ name: 'allow_custom_values', type: 'boolean', default: true })
  public allowCustomValues!: boolean;

  /** Trạng thái: 1 = ACTIVE, 2 = INACTIVE */
  @Index()
  @Column({ type: 'int', default: CODE_ITEM_STATUS.ACTIVE })
  public status!: CodeItemStatusCode;
}
