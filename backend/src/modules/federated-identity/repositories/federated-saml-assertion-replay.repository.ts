import { Injectable, Optional } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FederatedSamlAssertionReplayEntity } from '../entities/federated-saml-assertion-replay.entity.js';

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; errno?: unknown; driverError?: { code?: unknown; errno?: unknown } };
  const code = record.code ?? record.driverError?.code;
  const errno = record.errno ?? record.driverError?.errno;
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    errno === 1062
  );
}

@Injectable()
export class FederatedSamlAssertionReplayRepository extends BaseTypeOrmRepository<FederatedSamlAssertionReplayEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(FederatedSamlAssertionReplayEntity, dataSource as DataSource, transactionManager);
  }

  /**
   * Ghi nhận Assertion ID theo cơ chế atomic chống phát lại (anti-replay).
   * Trả về `true` nếu Assertion chưa từng được dùng (hoặc bản ghi cũ đã hết hạn và được thay thế),
   * trả về `false` nếu Assertion đang còn hiệu lực và đã được tiêu thụ trước đó.
   */
  public async recordAssertionIfUnused(input: {
    readonly providerCode: string;
    readonly assertionIdHash: string;
    readonly issuer?: string | null | undefined;
    readonly expiresAt: Date;
    readonly now?: Date | undefined;
  }): Promise<boolean> {
    if (!this.dataSource?.isInitialized) return true;
    const providerCode = input.providerCode.trim().toLowerCase();
    const assertionIdHash = input.assertionIdHash.trim();
    const now = input.now ?? new Date();

    const existing = await this.repository.findOne({
      where: { providerCode, assertionIdHash },
    });

    if (existing) {
      if (existing.expiresAt.getTime() > now.getTime()) {
        return false;
      }
      const replaced = await this.repository
        .createQueryBuilder()
        .update(FederatedSamlAssertionReplayEntity)
        .set({
          expiresAt: input.expiresAt,
          issuer: input.issuer ?? null,
        })
        .where('id = :id AND expires_at <= :now', { id: Number(existing.id), now })
        .execute();
      return Boolean(replaced.affected && replaced.affected > 0);
    }

    try {
      await this.saveEntity({
        providerCode,
        assertionIdHash,
        issuer: input.issuer ?? null,
        expiresAt: input.expiresAt,
      });
      return true;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return false;
      }
      throw err;
    }
  }

  public async purgeExpired(before: Date = new Date()): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    const res = await this.repository.delete({
      expiresAt: LessThan(before),
    });
    return Number(res.affected ?? 0);
  }
}
