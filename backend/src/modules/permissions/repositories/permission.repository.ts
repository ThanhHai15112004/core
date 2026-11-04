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

  /**
   * Đồng bộ idempotent danh sách quyền hạn từ các module vào bảng `permissions` (Mục 4.2 — không tạo trùng quyền).
   */
  public async upsertCatalogItems(
    items: readonly {
      code: string;
      name: string;
      module: string;
      description: string | null;
    }[],
  ): Promise<{
    createdCodes: string[];
    updatedCodes: string[];
    unchangedCount: number;
  }> {
    if (items.length === 0) {
      return { createdCodes: [], updatedCodes: [], unchangedCount: 0 };
    }

    const allExisting = await this.findAll();
    const byCode = new Map(allExisting.map((p) => [p.code.trim().toLowerCase(), p]));

    const createdCodes: string[] = [];
    const updatedCodes: string[] = [];
    let unchangedCount = 0;

    for (const item of items) {
      const code = item.code.trim().toLowerCase();
      if (!code) continue;

      const existing = byCode.get(code);
      if (!existing) {
        const created = await this.saveEntity({
          code,
          name: item.name.trim() || code,
          module: item.module.trim() || 'core',
          description: item.description ?? `Permission ${code}`,
          status: PERMISSION_STATUS.ACTIVE,
        });
        byCode.set(code, created);
        createdCodes.push(code);
      } else {
        const nextName = item.name.trim() || existing.name;
        const nextModule = item.module.trim() || existing.module;
        const nextDesc =
          item.description !== undefined ? item.description : (existing.description ?? null);

        const changed =
          existing.name !== nextName ||
          existing.module !== nextModule ||
          (existing.description ?? null) !== nextDesc;

        if (changed) {
          existing.name = nextName;
          existing.module = nextModule;
          existing.description = nextDesc;
          await this.saveEntity(existing);
          updatedCodes.push(code);
        } else {
          unchangedCount++;
        }
      }
    }

    return { createdCodes, updatedCodes, unchangedCount };
  }
}
