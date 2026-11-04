import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthApiClientEntity } from '../entities/auth-api-client.entity.js';

@Injectable()
export class AuthApiClientRepository extends BaseTypeOrmRepository<AuthApiClientEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthApiClientEntity, dataSource, transactionManager);
  }

  public async findByClientId(clientId: string): Promise<AuthApiClientEntity | null> {
    return this.repository.findOne({
      where: { clientId: clientId.trim() },
    });
  }

  public async findByServiceAccountId(serviceAccountId: number): Promise<AuthApiClientEntity[]> {
    return this.repository.find({
      where: { serviceAccountId: Number(serviceAccountId) },
      order: { id: 'ASC' },
    });
  }

  public async findAllOrdered(): Promise<AuthApiClientEntity[]> {
    return this.repository.find({
      order: { id: 'ASC' },
    });
  }
}
