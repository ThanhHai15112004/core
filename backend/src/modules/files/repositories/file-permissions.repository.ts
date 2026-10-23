import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { FILE_PERMISSION_SUBJECT, type FilePermissionSubjectCode } from '../contracts/index.js';
import { FilePermissionEntity } from '../entities/file-permission.entity.js';

@Injectable()
export class FilePermissionsRepository extends BaseTypeOrmRepository<FilePermissionEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(FilePermissionEntity, dataSource, transactionManager);
  }

  /** Tìm danh sách phân quyền của một file */
  public async findByFileId(fileId: number): Promise<FilePermissionEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { fileId },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm bản ghi phân quyền theo cặp khóa duy nhất (fileId + subjectType + subjectId) */
  public async findByTarget(params: {
    readonly fileId: number;
    readonly subjectType: FilePermissionSubjectCode;
    readonly subjectId: string;
  }): Promise<FilePermissionEntity | null> {
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: {
          fileId: params.fileId,
          subjectType: params.subjectType,
          subjectId: params.subjectId,
        },
      }),
    );
  }

  /** Tìm các bản ghi phân quyền còn hiệu lực khớp với người dùng hiện tại trên 1 file (hoặc mọi file) */
  public async findActiveForActor(params: {
    readonly fileId?: number;
    readonly userId?: number | null;
    readonly roles?: readonly string[];
    readonly orgUnitIds?: readonly number[];
    readonly now?: Date;
  }): Promise<FilePermissionEntity[]> {
    const now = params.now ?? new Date();
    const userIdStr =
      typeof params.userId === 'number' && params.userId > 0 ? String(params.userId) : null;
    const roleList = (params.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
    const orgList = (params.orgUnitIds ?? [])
      .filter((id) => Number.isInteger(id) && id > 0)
      .map(String);

    if (!userIdStr && roleList.length === 0 && orgList.length === 0) {
      return [];
    }

    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('fp');
      if (params.fileId !== undefined) {
        qb.andWhere('fp.fileId = :fileId', { fileId: params.fileId });
      }
      qb.andWhere('(fp.expiresAt IS NULL OR fp.expiresAt > :now)', { now });

      const subClauses: string[] = [];
      const queryParams: Record<string, unknown> = {};

      if (userIdStr) {
        subClauses.push('(fp.subjectType = :userType AND fp.subjectId = :userIdStr)');
        queryParams.userType = FILE_PERMISSION_SUBJECT.USER;
        queryParams.userIdStr = userIdStr;
      }
      if (roleList.length > 0) {
        subClauses.push('(fp.subjectType = :roleType AND LOWER(fp.subjectId) IN (:...roleList))');
        queryParams.roleType = FILE_PERMISSION_SUBJECT.ROLE;
        queryParams.roleList = roleList;
      }
      if (orgList.length > 0) {
        subClauses.push('(fp.subjectType = :orgType AND fp.subjectId IN (:...orgList))');
        queryParams.orgType = FILE_PERMISSION_SUBJECT.ORG_UNIT;
        queryParams.orgList = orgList;
      }

      qb.andWhere(`(${subClauses.join(' OR ')})`, queryParams);
      return qb.getMany();
    });
  }

  /** Xóa mềm bản ghi phân quyền theo ID */
  public async softDeleteById(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }
}
