import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthSecuritySettingEntity } from '../entities/auth-security-setting.entity.js';

@Injectable()
export class AuthSecuritySettingRepository extends BaseTypeOrmRepository<AuthSecuritySettingEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthSecuritySettingEntity, dataSource, transactionManager);
  }

  /** Tìm bản ghi cấu hình bảo mật theo scopeKey (mặc định GLOBAL) */
  public async findByScopeKey(scopeKey = 'GLOBAL'): Promise<AuthSecuritySettingEntity | null> {
    return this.repository.findOne({
      where: { scopeKey },
    });
  }
}
