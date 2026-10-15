import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthMfaConfigEntity } from '../entities/auth-mfa-config.entity.js';

@Injectable()
export class AuthMfaConfigRepository extends BaseTypeOrmRepository<AuthMfaConfigEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthMfaConfigEntity, dataSource, transactionManager);
  }

  /** Tìm cấu hình MFA của người dùng theo userId */
  public async findByUserId(userId: string): Promise<AuthMfaConfigEntity | null> {
    return this.repository.findOne({
      where: { userId },
    });
  }
}
