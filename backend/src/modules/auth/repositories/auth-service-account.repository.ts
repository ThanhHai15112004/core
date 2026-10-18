import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { AuthServiceAccountEntity } from '../entities/auth-service-account.entity.js';

@Injectable()
export class AuthServiceAccountRepository extends BaseTypeOrmRepository<AuthServiceAccountEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(AuthServiceAccountEntity, dataSource, transactionManager);
  }

  public async findByCode(code: string): Promise<AuthServiceAccountEntity | null> {
    return this.repository.findOne({
      where: { code: code.trim().toUpperCase() },
    });
  }

  public async findAllOrdered(): Promise<AuthServiceAccountEntity[]> {
    return this.repository.find({
      order: { id: 'ASC' },
    });
  }
}
