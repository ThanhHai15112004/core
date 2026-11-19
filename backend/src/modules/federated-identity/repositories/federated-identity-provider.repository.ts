import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FEDERATED_PROVIDER_STATUS } from '../enum/federated-identity.enum.js';
import { FederatedIdentityProviderEntity } from '../entities/federated-identity-provider.entity.js';

@Injectable()
export class FederatedIdentityProviderRepository extends BaseTypeOrmRepository<FederatedIdentityProviderEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(FederatedIdentityProviderEntity, dataSource as DataSource, transactionManager);
  }

  public async findByCode(
    providerCode: string,
    withDeleted = false,
  ): Promise<FederatedIdentityProviderEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { providerCode: providerCode.trim().toLowerCase() },
      withDeleted,
    });
  }

  public async listAll(): Promise<FederatedIdentityProviderEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { id: 'ASC' },
    });
  }

  public async findEnabledPublicProviders(): Promise<FederatedIdentityProviderEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    const list = await this.repository.find({
      where: {
        isEnabled: true,
        status: FEDERATED_PROVIDER_STATUS.ACTIVE,
      },
      order: { id: 'ASC' },
    });
    return list.filter((p) => Boolean(p.clientId?.trim()));
  }

  public async updateTelemetry(
    providerId: number,
    payload: {
      readonly lastSuccessAt?: Date | undefined;
      readonly lastErrorAt?: Date | undefined;
      readonly lastErrorCode?: string | null | undefined;
    },
  ): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    const updateData: Partial<FederatedIdentityProviderEntity> = {};
    if (payload.lastSuccessAt !== undefined) updateData.lastSuccessAt = payload.lastSuccessAt;
    if (payload.lastErrorAt !== undefined) updateData.lastErrorAt = payload.lastErrorAt;
    if (payload.lastErrorCode !== undefined) updateData.lastErrorCode = payload.lastErrorCode;
    if (Object.keys(updateData).length === 0) return;
    await this.repository.update({ id: Number(providerId) }, updateData);
  }
}
