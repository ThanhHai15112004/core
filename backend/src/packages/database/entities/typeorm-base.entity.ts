import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
  getMetadataArgsStorage,
} from 'typeorm';

/** Ký hiệu nhận diện thực thể ORM để ngăn trả trực tiếp ra tầng HTTP API Response */
export const ORM_ENTITY_WATERMARK = Symbol.for('core:orm_entity');

/**
 * Thực thể cơ sở của TypeORM cho toàn bộ các module nghiệp vụ.
 * Tích hợp sẵn khóa chính UUID, mốc thời gian tạo/cập nhật và xóa mềm (Soft Delete).
 */
export abstract class TypeOrmBaseEntity {
  public readonly [ORM_ENTITY_WATERMARK] = true as const;

  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @CreateDateColumn({ name: 'created_at' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  public updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  public deletedAt?: Date | null;
}

/**
 * Thực thể cơ sở tích hợp Optimistic Locking (`@VersionColumn`) dành cho dữ liệu nhạy cảm
 * (ví dụ: số dư tài khoản, tồn kho, đơn hàng, trạng thái thanh toán/ghi danh).
 */
export abstract class VersionedTypeOrmEntity extends TypeOrmBaseEntity {
  @VersionColumn({ default: 1 })
  public version!: number;
}

/**
 * Hợp đồng chuẩn cho lớp Mapper chuyển đổi từ ORM Entity sang Response DTO.
 * Mọi Controller/Service trả dữ liệu ra API phải đi qua Mapper để không lộ cấu trúc DB.
 */
export interface EntityMapperContract<TEntity, TResponse> {
  toResponse(entity: TEntity): TResponse;
  toResponseList(entities: TEntity[]): TResponse[];
}

/**
 * Kiểm tra một giá trị bất kỳ có phải là instance của ORM Entity (TypeORM `@Entity()` hoặc `TypeOrmBaseEntity`) hay không.
 */
export function isOrmEntityInstance(value: unknown): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    return false;
  }

  if (ORM_ENTITY_WATERMARK in value) {
    return true;
  }

  const ctor = (value as { constructor?: unknown }).constructor;
  if (typeof ctor !== 'function' || ctor === Object) {
    return false;
  }

  if ((ctor as unknown as Record<symbol, unknown>)[ORM_ENTITY_WATERMARK] === true) {
    return true;
  }

  const registeredTables = getMetadataArgsStorage().tables;
  return registeredTables.some((table) => table.target === ctor);
}
