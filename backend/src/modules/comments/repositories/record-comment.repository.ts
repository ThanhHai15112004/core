import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { RecordCommentEntity } from '../entities/record-comment.entity.js';

export interface CreateRecordCommentData {
  readonly entityType: string;
  readonly entityId: string;
  readonly workflowInstanceId?: number | null | undefined;
  readonly parentCommentId?: number | null | undefined;
  readonly content: string;
  readonly isInternal?: boolean | undefined;
  readonly authorUserId: number;
  readonly mentionedUserIdsJson?: string | null | undefined;
  readonly attachmentFileIdsJson?: string | null | undefined;
}

@Injectable()
export class RecordCommentRepository extends BaseTypeOrmRepository<RecordCommentEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(RecordCommentEntity, dataSource, transactionManager);
  }

  public async findByRecordOrInstance(params: {
    readonly entityType?: string | undefined;
    readonly entityId?: string | undefined;
    readonly workflowInstanceId?: number | undefined;
  }): Promise<RecordCommentEntity[]> {
    return this.executeReadOnly((repo) => {
      const qb = repo.createQueryBuilder('c').orderBy('c.createdAt', 'ASC').addOrderBy('c.id', 'ASC');

      if (params.entityType) {
        qb.andWhere('c.entityType = :entityType', {
          entityType: params.entityType.trim().toLowerCase(),
        });
      }
      if (params.entityId) {
        qb.andWhere('c.entityId = :entityId', {
          entityId: String(params.entityId).trim(),
        });
      }
      if (params.workflowInstanceId !== undefined) {
        qb.andWhere('c.workflowInstanceId = :workflowInstanceId', {
          workflowInstanceId: Number(params.workflowInstanceId),
        });
      }
      return qb.getMany();
    });
  }

  public async createComment(data: CreateRecordCommentData): Promise<RecordCommentEntity> {
    const entity = this.repository.create({
      entityType: data.entityType.trim().toLowerCase(),
      entityId: String(data.entityId).trim(),
      workflowInstanceId: data.workflowInstanceId ?? null,
      parentCommentId: data.parentCommentId ?? null,
      content: data.content,
      isInternal: Boolean(data.isInternal),
      authorUserId: Number(data.authorUserId),
      mentionedUserIdsJson: data.mentionedUserIdsJson ?? '[]',
      attachmentFileIdsJson: data.attachmentFileIdsJson ?? '[]',
      isEdited: false,
      isDeleted: false,
      deletedByUserId: null,
    });
    return this.repository.save(entity);
  }
}
