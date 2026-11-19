import { Injectable, Optional } from '@nestjs/common';
import { DataSource, Not } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FederatedIdentityEntity } from '../entities/federated-identity.entity.js';

@Injectable()
export class FederatedIdentityRepository extends BaseTypeOrmRepository<FederatedIdentityEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(FederatedIdentityEntity, dataSource as DataSource, transactionManager);
  }

  public async findByIdAndUserId(
    id: number,
    userId: number,
  ): Promise<FederatedIdentityEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { id: Number(id), userId: Number(userId) },
    });
  }

  public async findByProviderSubject(
    providerCode: string,
    issuerUrl: string,
    providerSubject: string,
  ): Promise<FederatedIdentityEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerCode: providerCode.trim().toLowerCase(),
        issuerUrl: issuerUrl.trim(),
        providerSubject: providerSubject.trim(),
      },
    });
  }

  public async findByUserId(userId: number): Promise<FederatedIdentityEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { userId: Number(userId) },
      order: { linkedAt: 'DESC', id: 'DESC' },
    });
  }

  public async countByUserIdExcluding(userId: number, excludeId: number): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    return this.repository.count({
      where: {
        userId: Number(userId),
        id: Not(Number(excludeId)),
      },
    });
  }

  public async hardDeleteById(id: number): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.repository.delete({ id: Number(id) });
  }
}
