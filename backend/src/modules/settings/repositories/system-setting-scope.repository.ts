import { Injectable, Optional } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { SettingEnvironmentCode } from '@packages/kernel/index.js';
import { SystemSettingScopeEntity } from '../entities/system-setting-scope.entity.js';

@Injectable()
export class SystemSettingScopeRepository extends BaseTypeOrmRepository<SystemSettingScopeEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SystemSettingScopeEntity, dataSource, transactionManager);
  }

  public async findByScope(
    settingId: number,
    environment: SettingEnvironmentCode,
    organizationUnitId: number | null,
  ): Promise<SystemSettingScopeEntity | null> {
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: {
          settingId: Number(settingId),
          environment,
          organizationUnitId: organizationUnitId === null ? IsNull() : Number(organizationUnitId),
        },
      }),
    );
  }

  public async findBySettingId(settingId: number): Promise<SystemSettingScopeEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { settingId: Number(settingId) },
        order: { id: 'ASC' },
      }),
    );
  }

  public async findAllScopes(): Promise<SystemSettingScopeEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        order: { id: 'ASC' },
      }),
    );
  }

  public async deleteByScope(
    settingId: number,
    environment: SettingEnvironmentCode,
    organizationUnitId: number | null,
  ): Promise<boolean> {
    const existing = await this.findByScope(settingId, environment, organizationUnitId);
    if (!existing) return false;
    await this.repository.remove(existing);
    return true;
  }
}
