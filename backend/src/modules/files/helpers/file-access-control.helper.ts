import { ForbiddenAppException, NotFoundAppException } from '@packages/kernel/index.js';
import type { BaseMessagePublisherProvider } from '@packages/messaging/index.js';
import {
  DATA_SCOPE,
  type DataScopeService,
  type TokenService,
  type UserIdentity,
} from '@packages/security/index.js';
import type { StorageContract } from '@packages/storage/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  FILE_PERMISSION_SUBJECT,
  FILE_STATUS,
  FILE_VISIBILITY,
  type FilePermissionSubjectCode,
  parseFilePermissionSubjectType,
} from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FilePermissionEntity } from '../entities/file-permission.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import type { ChunkedUploadSessionManager } from './chunked-upload-session.helper.js';
import type { FilesMapper } from '../mappers/files.mapper.js';
import type { FileFoldersRepository } from '../repositories/file-folders.repository.js';
import type { FilePermissionsRepository } from '../repositories/file-permissions.repository.js';
import type { FileUsagesRepository } from '../repositories/file-usages.repository.js';
import type { FileScopeConstraint, FilesRepository } from '../repositories/files.repository.js';
import type { GrantFilePermissionRequest } from '../requests/files.requests.js';
import type {
  FilePermissionItemResponse,
  FileRecordResponse,
  FileUploaderSummary,
  FileUsageItemResponse,
} from '../responses/files.response.js';
import type { FileValidationService } from '../services/file-validation.service.js';

export interface FilesServiceContext {
  readonly filesRepo: FilesRepository;
  readonly foldersRepo: FileFoldersRepository;
  readonly usagesRepo: FileUsagesRepository;
  readonly permissionsRepo?: FilePermissionsRepository | null | undefined;
  readonly mapper: FilesMapper;
  readonly validationService: FileValidationService;
  readonly storage: StorageContract;
  readonly chunkSessionManager: ChunkedUploadSessionManager;
  readonly dataScopeService?: DataScopeService | null | undefined;
  readonly usersPublicService?: IUsersPublicService | null | undefined;
  readonly orgsPublicService?: IOrganizationsPublicService | null | undefined;
  readonly tokenService?: TokenService | null | undefined;
  readonly messagePublisher?: BaseMessagePublisherProvider | null | undefined;
  resolvePrimaryOrgId(actor?: UserIdentity): number | null;
  generateEntityCode(
    sequenceKey: 'files.file_code' | 'files.folder_code',
    orgId?: number | null,
  ): Promise<string>;
  toFileRecordResponse(
    entity: FileRecordEntity,
    options?: {
      folderName?: string | null;
      uploadedByUser?: FileUploaderSummary | null;
      usages?: readonly FileUsageItemResponse[];
      permissions?: readonly FilePermissionItemResponse[];
      canDownload?: boolean;
    },
  ): Promise<FileRecordResponse>;
  loadUploaderSummaries(userIds: readonly number[]): Promise<Map<number, FileUploaderSummary>>;
  getById(id: number, actor?: UserIdentity): Promise<FileRecordResponse>;
  recordAudit(
    actor: UserIdentity | undefined,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: Record<string, unknown> | null,
    afterData: Record<string, unknown> | null,
  ): Promise<void>;
}

/** Phân giải ràng buộc phạm vi dữ liệu (`DataScope`) kết hợp quyền tường minh trong `file_permissions` */
export async function resolveFileScopeConstraint(
  ctx: FilesServiceContext,
  actor?: UserIdentity,
): Promise<FileScopeConstraint> {
  if (!actor || !ctx.dataScopeService) {
    return { unrestricted: true };
  }
  const resolvedFilter = await ctx.dataScopeService.resolveScopeFilter(actor, 'files', 'read');
  if (resolvedFilter.isUnrestricted || resolvedFilter.effectiveScope === DATA_SCOPE.ALL) {
    return { unrestricted: true };
  }
  const rootOrgIds = actor.organizationUnitIds ?? [];
  let allowedOrgUnitIds: number[] =
    resolvedFilter.allowedOrganizationUnitIds.length > 0
      ? [...resolvedFilter.allowedOrganizationUnitIds]
      : [...rootOrgIds];
  if (
    resolvedFilter.effectiveScope === DATA_SCOPE.ORG_UNIT &&
    rootOrgIds.length > 0 &&
    ctx.orgsPublicService?.resolveDescendantUnitIds
  ) {
    allowedOrgUnitIds = await ctx.orgsPublicService.resolveDescendantUnitIds(rootOrgIds);
  }

  let explicitAllowedFileIds: number[] = [];
  if (ctx.permissionsRepo) {
    const matchedPerms = await ctx.permissionsRepo.findActiveForActor({
      userId: actor.id,
      roles: actor.roles ?? [],
      orgUnitIds: allowedOrgUnitIds.length > 0 ? allowedOrgUnitIds : rootOrgIds,
    });
    explicitAllowedFileIds = [
      ...new Set(matchedPerms.filter((p) => p.canView || p.canDownload).map((p) => p.fileId)),
    ];
  }

  return {
    unrestricted: false,
    allowedOrgUnitIds,
    selfUserId: actor.id,
    explicitAllowedFileIds,
  };
}

/** Kiểm tra thư mục có nằm trong phạm vi dữ liệu được phép truy cập của người dùng hay không */
export function isFolderAccessibleInScope(
  folder: FileFolderEntity,
  scope: FileScopeConstraint,
): boolean {
  if (scope.unrestricted) return true;
  if (!folder.organizationUnitId && !folder.createdByUserId) return true;
  if (folder.createdByUserId && folder.createdByUserId === scope.selfUserId) return true;
  if (folder.organizationUnitId && scope.allowedOrgUnitIds?.includes(folder.organizationUnitId)) {
    return true;
  }
  return false;
}

/** Đảm bảo người dùng có quyền truy cập vào thư mục chỉ định */
export async function assertCanAccessFolder(
  ctx: FilesServiceContext,
  folder: FileFolderEntity,
  actor?: UserIdentity,
): Promise<void> {
  if (!actor || !ctx.dataScopeService) return;
  const scope = await resolveFileScopeConstraint(ctx, actor);
  if (!isFolderAccessibleInScope(folder, scope)) {
    throw new ForbiddenAppException('files.error.folderAccessDenied');
  }
}

/** Tìm các bản ghi phân quyền đang hiệu lực khớp với `actor` trên một `fileId` */
export async function findMatchingActivePermissions(
  ctx: FilesServiceContext,
  fileId: number,
  actor: UserIdentity,
  allowedOrgUnitIds: readonly number[],
): Promise<FilePermissionEntity[]> {
  if (!ctx.permissionsRepo) return [];
  const orgIds =
    allowedOrgUnitIds.length > 0 ? allowedOrgUnitIds : (actor.organizationUnitIds ?? []);
  return ctx.permissionsRepo.findActiveForActor({
    fileId,
    userId: actor.id,
    roles: actor.roles ?? [],
    orgUnitIds: orgIds,
  });
}

/**
 * Kiểm tra quyền XEM thông tin file (Mục 6.2):
 * Hỗ trợ phân quyền theo Người dùng, Vai trò hoặc Đơn vị trong bảng `file_permissions` + `visibility` + `DataScope`.
 */
export async function assertCanViewFile(
  ctx: FilesServiceContext,
  entity: FileRecordEntity,
  actor?: UserIdentity,
): Promise<void> {
  if (entity.visibility === FILE_VISIBILITY.PUBLIC) {
    return;
  }
  if (!actor) {
    return;
  }
  if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
    return;
  }

  const scope = await resolveFileScopeConstraint(ctx, actor);
  if (scope.unrestricted) {
    return;
  }

  const matchedPerms = await findMatchingActivePermissions(
    ctx,
    entity.id,
    actor,
    scope.allowedOrgUnitIds ?? [],
  );
  if (matchedPerms.length > 0) {
    if (matchedPerms.some((p) => p.canView || p.canDownload)) {
      return;
    }
    throw new ForbiddenAppException('files.error.accessDeniedScope');
  }

  if (entity.visibility === FILE_VISIBILITY.INTERNAL) {
    return;
  }
  if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
    return;
  }
  throw new ForbiddenAppException('files.error.accessDeniedScope');
}

/**
 * Kiểm tra quyền TẢI XUỐNG / STREAM file (Mục 6.2 — Có thể khác quyền xem thông tin):
 * - Nếu người dùng có bản ghi phân quyền trong `file_permissions`:
 *   + Có ít nhất 1 quyền `canDownload = true` -> Cho phép tải.
 *   + Chỉ có quyền `canView = true` nhưng tất cả quyền khớp đều `canDownload = false` -> CHẶN TẢI (`downloadPermissionDenied`),
 *     dù người dùng vẫn xem được thông tin chi tiết của file.
 */
export async function assertCanDownloadFile(
  ctx: FilesServiceContext,
  entity: FileRecordEntity,
  actor?: UserIdentity,
): Promise<void> {
  if (!actor) {
    return;
  }
  if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
    return;
  }

  const scope = await resolveFileScopeConstraint(ctx, actor);
  if (scope.unrestricted) {
    return;
  }

  const matchedPerms = await findMatchingActivePermissions(
    ctx,
    entity.id,
    actor,
    scope.allowedOrgUnitIds ?? [],
  );
  if (matchedPerms.length > 0) {
    if (matchedPerms.some((p) => p.canDownload)) {
      return;
    }
    if (matchedPerms.some((p) => p.canView)) {
      throw new ForbiddenAppException('files.error.downloadPermissionDenied');
    }
    throw new ForbiddenAppException('files.error.accessDeniedScope');
  }

  if (
    entity.visibility === FILE_VISIBILITY.PUBLIC ||
    entity.visibility === FILE_VISIBILITY.INTERNAL
  ) {
    return;
  }
  if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
    return;
  }
  throw new ForbiddenAppException('files.error.accessDeniedScope');
}

/** Trả về boolean kiểm tra người dùng hiện tại có được phép tải file hay không */
export async function canDownloadFile(
  ctx: FilesServiceContext,
  entity: FileRecordEntity,
  actor?: UserIdentity,
): Promise<boolean> {
  try {
    await assertCanDownloadFile(ctx, entity, actor);
    return true;
  } catch {
    return false;
  }
}

/** Kiểm tra quyền quản lý file (sửa metadata, chuyển thư mục, cấp quyền, xóa) */
export async function assertCanManageFile(
  ctx: FilesServiceContext,
  entity: FileRecordEntity,
  actor?: UserIdentity,
): Promise<void> {
  if (!actor || !ctx.dataScopeService) {
    return;
  }
  if (entity.uploadedByUserId && entity.uploadedByUserId === actor.id) {
    return;
  }
  const scope = await resolveFileScopeConstraint(ctx, actor);
  if (scope.unrestricted) {
    return;
  }
  if (entity.organizationUnitId && scope.allowedOrgUnitIds?.includes(entity.organizationUnitId)) {
    return;
  }
  throw new ForbiddenAppException('files.error.accessDeniedScope');
}

/** Xem danh sách phân quyền chi tiết (User / Role / Đơn vị) của một file (Mục 6.2) */
export async function listFilePermissions(
  ctx: FilesServiceContext,
  fileId: number,
  actor?: UserIdentity,
): Promise<FilePermissionItemResponse[]> {
  const entity = await ctx.filesRepo.findById(fileId);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanViewFile(ctx, entity, actor);

  if (!ctx.permissionsRepo) return [];
  const list = await ctx.permissionsRepo.findByFileId(fileId);
  return list.map((p) => ctx.mapper.toPermissionResponse(p));
}

/**
 * Cấp hoặc cập nhật quyền Xem (`canView`) / Tải (`canDownload`) cho Người dùng, Vai trò hoặc Đơn vị (Mục 6.2).
 * Nếu `canDownload = true` thì tự động bật `canView = true`.
 */
export async function grantFilePermission(
  ctx: FilesServiceContext,
  fileId: number,
  input: GrantFilePermissionRequest,
  actor?: UserIdentity,
): Promise<FilePermissionItemResponse> {
  const entity = await ctx.filesRepo.findById(fileId);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanManageFile(ctx, entity, actor);

  if (!ctx.permissionsRepo) {
    throw new NotFoundAppException('files.error.permissionNotFound');
  }

  const subjectType: FilePermissionSubjectCode = parseFilePermissionSubjectType(input.subjectType);
  const rawSubjectId = String(input.subjectId).trim();
  const subjectId =
    subjectType === FILE_PERMISSION_SUBJECT.ROLE ? rawSubjectId.toLowerCase() : rawSubjectId;

  const canDownload = Boolean(input.canDownload);
  const canView = canDownload ? true : (input.canView ?? true);
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsedDate = new Date(input.expiresAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      expiresAt = parsedDate;
    }
  }

  const existing = await ctx.permissionsRepo.findByTarget({
    fileId,
    subjectType,
    subjectId,
  });

  const saved = await ctx.permissionsRepo.saveEntity({
    ...(existing ?? {}),
    fileId,
    subjectType,
    subjectId,
    canView,
    canDownload,
    expiresAt,
    note: input.note !== undefined ? input.note : (existing?.note ?? null),
    grantedByUserId: actor?.id ?? existing?.grantedByUserId ?? null,
  });

  await ctx.recordAudit(
    actor,
    'file.permission_grant',
    'file',
    String(fileId),
    existing
      ? {
          subjectType: existing.subjectType,
          subjectId: existing.subjectId,
          canView: existing.canView,
          canDownload: existing.canDownload,
        }
      : null,
    {
      subjectType: saved.subjectType,
      subjectId: saved.subjectId,
      canView: saved.canView,
      canDownload: saved.canDownload,
      expiresAt: saved.expiresAt ? saved.expiresAt.toISOString() : null,
    },
  );

  return ctx.mapper.toPermissionResponse(saved);
}

/** Thu hồi một bản ghi phân quyền truy cập file (Mục 6.2) */
export async function revokeFilePermission(
  ctx: FilesServiceContext,
  fileId: number,
  permissionId: number,
  actor?: UserIdentity,
): Promise<{ revoked: true; permissionId: number }> {
  const entity = await ctx.filesRepo.findById(fileId);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanManageFile(ctx, entity, actor);

  if (!ctx.permissionsRepo) {
    throw new NotFoundAppException('files.error.permissionNotFound');
  }

  const found = await ctx.permissionsRepo.findById(permissionId);
  if (!found || found.fileId !== fileId) {
    throw new NotFoundAppException('files.error.permissionNotFound');
  }

  await ctx.permissionsRepo.softDeleteById(found.id);

  await ctx.recordAudit(
    actor,
    'file.permission_revoke',
    'file',
    String(fileId),
    {
      permissionId: found.id,
      subjectType: found.subjectType,
      subjectId: found.subjectId,
      canView: found.canView,
      canDownload: found.canDownload,
    },
    null,
  );

  return { revoked: true, permissionId };
}
