import { Injectable, Optional } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthSessionEntity } from '../entities/auth-session.entity.js';

@Injectable()
export class AuthSessionRepository extends BaseTypeOrmRepository<AuthSessionEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthSessionEntity, dataSource, transactionManager);
  }

  /** Tìm phiên đăng nhập theo mã băm Refresh Token */
  public async findByRefreshTokenHash(hash: string): Promise<AuthSessionEntity | null> {
    return this.repository.findOne({
      where: { refreshTokenHash: hash },
    });
  }

  /** Lấy danh sách các phiên đang hoạt động của một người dùng */
  public async findActiveByUserId(userId: number): Promise<AuthSessionEntity[]> {
    return this.repository.find({
      where: {
        userId: Number(userId),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { lastActiveAt: 'DESC' },
    });
  }

  /** Thu hồi toàn bộ các phiên đang hoạt động của người dùng (trừ phiên hiện tại nếu truyền exceptSessionId) */
  public async revokeAllForUser(
    userId: number,
    reason: string,
    exceptSessionId?: number,
  ): Promise<AuthSessionEntity[]> {
    const activeSessions = await this.findActiveByUserId(userId);
    const toRevoke =
      exceptSessionId !== undefined
        ? activeSessions.filter((s) => Number(s.id) !== Number(exceptSessionId))
        : activeSessions;

    if (toRevoke.length === 0) {
      return [];
    }

    const now = new Date();
    for (const s of toRevoke) {
      s.revokedAt = now;
      s.revokeReason = reason;
    }

    return this.repository.save(toRevoke);
  }

  /** Lấy toàn bộ lịch sử phiên (cả đang hoạt động và đã đăng xuất/thu hồi/hết hạn) của người dùng */
  public async findAllByUserId(userId: number, limit = 50): Promise<AuthSessionEntity[]> {
    return this.repository.find({
      where: { userId: Number(userId) },
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(200, limit)),
    });
  }
}

