import { Injectable, Optional } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import {
  AuthVerificationCodeEntity,
  type VerificationChannelCode,
  type VerificationPurposeCode,
} from '../entities/auth-verification-code.entity.js';

@Injectable()
export class AuthVerificationCodeRepository extends BaseTypeOrmRepository<AuthVerificationCodeEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthVerificationCodeEntity, dataSource, transactionManager);
  }

  /** Tìm bản ghi xác minh chưa dùng mới nhất của một người dùng theo kênh và mục đích */
  public async findLatestUnverified(
    userId: number,
    channel: VerificationChannelCode,
    purpose: VerificationPurposeCode,
  ): Promise<AuthVerificationCodeEntity | null> {
    return this.repository.findOne({
      where: {
        userId: Number(userId),
        channel,
        purpose,
        verifiedAt: IsNull(),
      },
      order: { id: 'DESC' },
    });
  }

  /** Tìm bản ghi xác minh theo mã băm SHA-256 (dành cho link token xác minh Email) */
  public async findByCodeHash(
    codeHash: string,
    channel: VerificationChannelCode,
  ): Promise<AuthVerificationCodeEntity | null> {
    return this.repository.findOne({
      where: {
        codeHash,
        channel,
        verifiedAt: IsNull(),
      },
      order: { id: 'DESC' },
    });
  }
}

