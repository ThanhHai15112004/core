import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ScimGroupMemberEntity } from '../entities/scim-group-member.entity.js';

@Injectable()
export class ScimGroupMemberRepository extends BaseTypeOrmRepository<ScimGroupMemberEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ScimGroupMemberEntity, dataSource as DataSource, transactionManager);
  }

  public async findByGroupId(scimGroupId: number): Promise<ScimGroupMemberEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { scimGroupId },
      order: { userId: 'ASC' },
    });
  }

  public async findByGroupIds(scimGroupIds: readonly number[]): Promise<ScimGroupMemberEntity[]> {
    if (!this.dataSource?.isInitialized || scimGroupIds.length === 0) return [];
    return this.repository.find({
      where: { scimGroupId: In([...scimGroupIds]) },
      order: { userId: 'ASC' },
    });
  }

  public async findByClientAndUserId(
    clientId: number,
    userId: number,
  ): Promise<ScimGroupMemberEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { clientId, userId },
      order: { scimGroupId: 'ASC' },
    });
  }

  public async findByClient(clientId: number): Promise<ScimGroupMemberEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { clientId },
      order: { scimGroupId: 'ASC', userId: 'ASC' },
    });
  }

  public async replaceGroupMembers(
    clientId: number,
    scimGroupId: number,
    userIds: readonly number[],
  ): Promise<number[]> {
    if (!this.dataSource?.isInitialized) return [];
    const normalized = Array.from(
      new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)),
    ).sort((a, b) => a - b);

    await this.repository.delete({ scimGroupId });
    if (normalized.length > 0) {
      const entities = normalized.map((userId) =>
        this.repository.create({
          clientId,
          scimGroupId,
          userId,
        }),
      );
      await this.repository.save(entities);
    }
    return normalized;
  }

  public async removeUserFromClientGroups(clientId: number, userId: number): Promise<number[]> {
    if (!this.dataSource?.isInitialized) return [];
    const existing = await this.findByClientAndUserId(clientId, userId);
    if (existing.length === 0) return [];
    const affectedGroupIds = existing.map((m) => m.scimGroupId);
    await this.repository.delete({ clientId, userId });
    return affectedGroupIds;
  }

  public async deleteByGroupId(scimGroupId: number): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.repository.delete({ scimGroupId });
  }
}
