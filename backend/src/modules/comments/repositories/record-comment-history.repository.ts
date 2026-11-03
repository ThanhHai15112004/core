import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { RecordCommentHistoryEntity } from '../entities/record-comment-history.entity.js';

export interface CreateRecordCommentHistoryData {
  readonly commentId: number;
  readonly previousContent: string;
  readonly previousAttachmentFileIdsJson?: string | null | undefined;
  readonly editedByUserId: number;
  readonly editReason?: string | null | undefined;
  readonly editedAt?: Date | undefined;
}

@Injectable()
export class RecordCommentHistoryRepository extends BaseTypeOrmRepository<RecordCommentHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(RecordCommentHistoryEntity, dataSource, transactionManager);
  }

  public async findByCommentIds(
    commentIds: readonly number[],
  ): Promise<RecordCommentHistoryEntity[]> {
    if (commentIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { commentId: In([...new Set(commentIds.map(Number))]) },
        order: { editedAt: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async createHistory(
    data: CreateRecordCommentHistoryData,
  ): Promise<RecordCommentHistoryEntity> {
    const entity = this.repository.create({
      commentId: Number(data.commentId),
      previousContent: data.previousContent,
      previousAttachmentFileIdsJson: data.previousAttachmentFileIdsJson ?? '[]',
      editedByUserId: Number(data.editedByUserId),
      editReason: data.editReason ?? null,
      editedAt: data.editedAt ?? new Date(),
    });
    return this.repository.save(entity);
  }
}
