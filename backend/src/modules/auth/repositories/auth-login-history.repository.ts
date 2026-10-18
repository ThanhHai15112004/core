import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthLoginHistoryEntity } from '../entities/auth-login-history.entity.js';
import type { AuthEventStatusCode, AuthEventTypeCode } from '../contracts/index.js';

@Injectable()
export class AuthLoginHistoryRepository extends BaseTypeOrmRepository<AuthLoginHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthLoginHistoryEntity, dataSource, transactionManager);
  }

  /** Ghi một bản ghi lịch sử sự kiện đăng nhập/đăng xuất/phiên */
  public async recordEvent(input: {
    userId?: number | null;
    sessionId?: number | null;
    identifier?: string | null;
    eventType: AuthEventTypeCode;
    status: AuthEventStatusCode;
    ipAddress?: string | null;
    userAgent?: string | null;
    deviceName?: string | null;
    reason?: string | null;
  }): Promise<AuthLoginHistoryEntity> {
    return this.saveEntity({
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      identifier: input.identifier ?? null,
      eventType: input.eventType,
      status: input.status,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceName: input.deviceName ?? null,
      reason: input.reason ?? null,
    });
  }

  /** Lấy danh sách lịch sử đăng nhập/đăng xuất của một người dùng */
  public async findByUserId(userId: number, limit = 50): Promise<AuthLoginHistoryEntity[]> {
    return this.repository.find({
      where: { userId: Number(userId) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: Math.max(1, Math.min(200, limit)),
    });
  }
}
