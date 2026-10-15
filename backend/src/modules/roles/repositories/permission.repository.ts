import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { PERMISSION_STATUS } from '../contracts/index.js';
import { PermissionEntity } from '../entities/permission.entity.js';

@Injectable()
export class PermissionRepository extends BaseTypeOrmRepository<PermissionEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(PermissionEntity, dataSource, transactionManager);
  }

  /** Lấy toàn bộ danh mục quyền đang hoạt động */
  public async findAll(): Promise<PermissionEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách quyền theo mảng ID số nguyên */
  public async findByIds(ids: readonly number[]): Promise<PermissionEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In([...ids]) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách quyền theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<PermissionEntity[]> {
    if (codes.length === 0) return [];
    const normalized = codes.map((c) => c.trim().toLowerCase()).filter(Boolean);
    if (normalized.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { code: In(normalized) },
        order: { id: 'ASC' },
      }),
    );
  }

  /**
   * Đảm bảo toàn bộ mã quyền trong `codes` đều tồn tại trong bảng `permissions` và trả về thực thể kèm `id` số nguyên.
   */
  public async ensurePermissionsByCodes(codes: readonly string[]): Promise<PermissionEntity[]> {
    const normalized = [...new Set(codes.map((c) => c.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) return [];

    const existing = await this.repository.find({
      where: { code: In(normalized) },
      order: { id: 'ASC' },
    });
    const byCode = new Map(existing.map((p) => [p.code, p]));
    const results: PermissionEntity[] = [...existing];

    for (const code of normalized) {
      if (!byCode.has(code)) {
        const moduleName = code.includes('.') ? code.split('.')[0]! : 'core';
        const created = await this.saveEntity({
          code,
          name: code,
          module: moduleName,
          description: `Permission ${code}`,
          status: PERMISSION_STATUS.ACTIVE,
        });
        results.push(created);
        byCode.set(code, created);
      }
    }

    return results;
  }

  /** Alias cho `ensurePermissionsByCodes` */
  public async ensureByCodes(codes: readonly string[]): Promise<PermissionEntity[]> {
    return this.ensurePermissionsByCodes(codes);
  }
}
