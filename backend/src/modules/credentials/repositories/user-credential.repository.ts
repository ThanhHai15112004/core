import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { safeJsonParseStringArray } from '@packages/kernel/index.js';
import { UserCredentialEntity } from '../entities/user-credential.entity.js';

@Injectable()
export class UserCredentialRepository extends BaseTypeOrmRepository<UserCredentialEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserCredentialEntity, dataSource, transactionManager);
  }

  public async findByUserId(userId: number): Promise<UserCredentialEntity | null> {
    return this.repository.findOne({ where: { userId: Number(userId) } });
  }

  public async findByUserIds(userIds: readonly number[]): Promise<UserCredentialEntity[]> {
    if (userIds.length === 0) return [];
    const normalizedIds = [...new Set(userIds.map((id) => Number(id)))];
    return this.repository.find({
      where: {
        userId: In(normalizedIds),
      },
    });
  }

  public async upsertPasswordHash(
    userId: number,
    passwordHash: string,
    options?: {
      readonly recordHistory?: boolean;
      readonly maxHistory?: number;
      readonly passwordChangedAt?: Date | null;
    },
  ): Promise<UserCredentialEntity> {
    const uid = Number(userId);
    const existing = await this.findByUserId(uid);
    const changedAt =
      options?.passwordChangedAt !== undefined ? options.passwordChangedAt : new Date();

    let nextHistoryJson = existing?.passwordHistoryHashesJson ?? null;
    if (
      options?.recordHistory !== false &&
      existing?.passwordHash &&
      existing.passwordHash !== passwordHash
    ) {
      const maxHistory = Math.max(1, Math.min(20, options?.maxHistory ?? 10));
      const currentHistory = safeJsonParseStringArray(existing.passwordHistoryHashesJson);
      const nextHistory = [
        existing.passwordHash,
        ...currentHistory.filter((h) => h !== existing.passwordHash),
      ].slice(0, maxHistory);
      nextHistoryJson = JSON.stringify(nextHistory);
    }

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.passwordChangedAt = changedAt;
      existing.passwordHistoryHashesJson = nextHistoryJson;
      return this.saveEntity(existing);
    }

    return this.saveEntity({
      userId: uid,
      passwordHash,
      passwordChangedAt: changedAt,
      passwordHistoryHashesJson: nextHistoryJson,
    });
  }
}
