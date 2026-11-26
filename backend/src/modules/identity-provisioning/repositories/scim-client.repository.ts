import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SCIM_CLIENT_STATUS } from '../enum/identity-provisioning.enum.js';
import { ScimClientEntity } from '../entities/scim-client.entity.js';

@Injectable()
export class ScimClientRepository extends BaseTypeOrmRepository<ScimClientEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ScimClientEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ScimClientEntity>): ScimClientEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(entity: ScimClientEntity): Promise<ScimClientEntity> {
    return this.repository.softRemove(entity);
  }

  public async findByCode(code: string): Promise<ScimClientEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { code: code.trim().toLowerCase() },
    });
  }

  public async findByTokenHash(tokenHash: string): Promise<ScimClientEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { tokenHash },
    });
  }

  public async findActiveById(id: number): Promise<ScimClientEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { id, status: SCIM_CLIENT_STATUS.ACTIVE },
    });
  }

  public async listAll(): Promise<ScimClientEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async updateLastUsed(clientId: number, ipAddress: string | null): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.repository.update(
      { id: Number(clientId) },
      {
        lastUsedAt: new Date(),
        lastUsedIp: ipAddress,
      },
    );
  }
}
