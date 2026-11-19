import { Injectable, Optional } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FederatedAuthTransactionEntity } from '../entities/federated-auth-transaction.entity.js';

@Injectable()
export class FederatedAuthTransactionRepository extends BaseTypeOrmRepository<FederatedAuthTransactionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(FederatedAuthTransactionEntity, dataSource as DataSource, transactionManager);
  }

  public async findByStateHash(stateHash: string): Promise<FederatedAuthTransactionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { stateHash: stateHash.trim() },
    });
  }

  /**
   * Đánh dấu giao dịch đã sử dụng theo cơ chế atomic (`WHERE id = :id AND consumed_at IS NULL`)
   * để đảm bảo tuyệt đối single-use ngay cả khi nhận 2 callback song song (chống replay/race condition).
   */
  public async consumeAtomically(id: number, consumedAt: Date = new Date()): Promise<boolean> {
    if (!this.dataSource?.isInitialized) return false;
    const result = await this.repository
      .createQueryBuilder()
      .update(FederatedAuthTransactionEntity)
      .set({ consumedAt })
      .where('id = :id AND consumed_at IS NULL', { id: Number(id) })
      .execute();
    return Boolean(result.affected && result.affected > 0);
  }

  public async purgeExpired(before: Date): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    const res = await this.repository.delete({
      expiresAt: LessThan(before),
    });
    return Number(res.affected ?? 0);
  }
}
