import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthPasswordResetEntity } from '../entities/auth-password-reset.entity.js';

@Injectable()
export class AuthPasswordResetRepository extends BaseTypeOrmRepository<AuthPasswordResetEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthPasswordResetEntity, dataSource, transactionManager);
  }

  /** Tìm yêu cầu đặt lại mật khẩu theo mã băm token */
  public async findByTokenHash(tokenHash: string): Promise<AuthPasswordResetEntity | null> {
    return this.repository.findOne({
      where: { tokenHash },
    });
  }
}
