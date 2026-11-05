import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import { JOB_PRIORITIES, QUEUES } from '@packages/messaging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { type AttachFileUsageInput, FILE_STATUS, getFileStatusName } from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type { FileRecordEntity } from '../entities/file-record.entity.js';
import { DAY_MS } from '../enum/files.enum.js';
import type {
  AttachFileUsageRequest,
  CleanupUnusedFilesRequest,
  QuarantineFileRequest,
  UpdateFileMetadataRequest,
} from '../requests/files.requests.js';
import type {
  CleanupUnusedFilesResponse,
  FileIntegrityVerificationResponse,
  FileRecordResponse,
  FileUsageItemResponse,
} from '../responses/files.response.js';
import {
  type FilesServiceContext,
  assertCanAccessFolder,
  assertCanManageFile,
  assertCanViewFile,
  canDownloadFile,
} from './file-access-control.helper.js';
import { openStorageStream } from './file-delivery-stream.helper.js';
import { computeSha256Hex } from './file-storage.helper.js';

/** Đồng bộ số lượng liên kết sử dụng (`usageCount`) trên thực thể `files` */
export async function syncFileUsageCount(
  ctx: FilesServiceContext,
  fileId: number,
): Promise<number> {
  const count = await ctx.usagesRepo.countByFileId(fileId);
  const file = await ctx.filesRepo.findById(fileId);
  if (file && Number(file.usageCount) !== count) {
    await ctx.filesRepo.saveEntity({
      ...file,
      usageCount: count,
    });
  }
  return count;
}

/** Chặn xóa hoặc đưa vào thùng rác nếu tệp vẫn còn liên kết sử dụng (`usageCount > 0` — Mục 6.1.8) */
export async function assertNoActiveUsages(
  ctx: FilesServiceContext,
  fileId: number,
): Promise<void> {
  const count = await syncFileUsageCount(ctx, fileId);
  if (count > 0) {
    throw new ConflictAppException('files.error.cannotDeleteReferencedFile', [], { count });
  }
}

/** Xóa ảnh thumbnail trên Storage (nếu có) khi xóa vĩnh viễn file gốc */
export async function deleteThumbnailIfPresent(
  ctx: FilesServiceContext,
  entity: FileRecordEntity,
): Promise<void> {
  if (!entity.metadataJson) return;
  const meta = safeJsonParseObject<Record<string, unknown>>(entity.metadataJson);
  const thumbKey =
    typeof meta?.thumbnailStorageKey === 'string' && meta.thumbnailStorageKey.length > 0
      ? meta.thumbnailStorageKey
      : null;
  if (thumbKey && (await ctx.storage.exists(thumbKey))) {
    await ctx.storage.delete(thumbKey).catch(() => undefined);
  }
}

/** Đổi tên hiển thị, di chuyển thư mục (kiểm tra quyền thư mục đích, giữ nguyên liên kết sử dụng & storage_key — Mục 6.1.4 & 6.2.3) */
export async function updateFileMetadata(
  ctx: FilesServiceContext,
  id: number,
  input: UpdateFileMetadataRequest,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }

  await assertCanManageFile(ctx, entity, actor);

  let folder: FileFolderEntity | null = null;
  let nextFolderId = entity.folderId ?? null;
  if (input.folderId !== undefined) {
    if (input.folderId === null) {
      nextFolderId = null;
    } else {
      folder = await ctx.foldersRepo.findById(input.folderId);
      if (!folder) {
        throw new NotFoundAppException('files.error.folderNotFound');
      }
      await assertCanAccessFolder(ctx, folder, actor);
      nextFolderId = folder.id;
    }
  } else if (entity.folderId) {
    folder = await ctx.foldersRepo.findById(entity.folderId);
  }

  const previousDisplayName = entity.displayName;
  const nextDisplayName =
    input.displayName !== undefined ? input.displayName.trim() : entity.displayName;
  const nextVisibility = input.visibility !== undefined ? input.visibility : entity.visibility;
  const nextMetadataJson =
    input.metadata !== undefined
      ? input.metadata
        ? JSON.stringify(input.metadata)
        : null
      : (entity.metadataJson ?? null);

  const saved = await ctx.filesRepo.saveEntity({
    ...entity,
    displayName: nextDisplayName,
    folderId: nextFolderId,
    visibility: nextVisibility,
    metadataJson: nextMetadataJson,
  });

  await ctx.recordAudit(
    actor,
    'file.rename_or_update',
    'file',
    String(saved.id),
    {
      displayName: previousDisplayName,
      folderId: entity.folderId ?? null,
      visibility: entity.visibility,
      storageKey: entity.storageKey,
    },
    {
      displayName: saved.displayName,
      folderId: saved.folderId ?? null,
      visibility: saved.visibility,
      storageKey: saved.storageKey,
    },
  );

  const [uploaderMap, usages, permissions, downloadable] = await Promise.all([
    ctx.loadUploaderSummaries(saved.uploadedByUserId ? [saved.uploadedByUserId] : []),
    ctx.usagesRepo.findByFileId(saved.id),
    ctx.permissionsRepo ? ctx.permissionsRepo.findByFileId(saved.id) : Promise.resolve([]),
    canDownloadFile(ctx, saved, actor),
  ]);

  return ctx.toFileRecordResponse(saved, {
    folderName: folder?.name ?? null,
    uploadedByUser: saved.uploadedByUserId
      ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
      : null,
    usages: usages.map((u) => ctx.mapper.toUsageResponse(u)),
    permissions: permissions.map((p) => ctx.mapper.toPermissionResponse(p)),
    canDownload: downloadable,
  });
}

/**
 * Đưa file vào thùng rác (Soft Trash có thời gian chờ trước khi xóa vĩnh viễn — Mục 6.1.5).
 * Chặn ngay nếu file vẫn đang được sử dụng bởi bất kỳ chức năng nào (`usageCount > 0`).
 */
export async function moveFileToTrash(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.TRASHED) {
    throw new ConflictAppException('files.error.alreadyInTrash');
  }

  await assertCanManageFile(ctx, entity, actor);
  await assertNoActiveUsages(ctx, entity.id);

  const retentionDays = ctx.validationService.getTrashRetentionDays(
    entity.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor),
  );
  const now = new Date();
  const purgeAfterAt = new Date(now.getTime() + retentionDays * DAY_MS);

  const saved = await ctx.filesRepo.saveEntity({
    ...entity,
    status: FILE_STATUS.TRASHED,
    trashedAt: now,
    trashedByUserId: actor?.id ?? null,
    purgeAfterAt,
  });

  await ctx.recordAudit(
    actor,
    'file.trash',
    'file',
    String(saved.id),
    { status: FILE_STATUS.ACTIVE },
    {
      status: FILE_STATUS.TRASHED,
      trashedAt: now.toISOString(),
      purgeAfterAt: purgeAfterAt.toISOString(),
    },
  );

  return ctx.toFileRecordResponse(saved);
}

/** Khôi phục file từ thùng rác (Chỉ khi file chưa bị xóa vĩnh viễn khỏi Storage — Mục 6.1.6) */
export async function restoreFileFromTrash(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.PURGED) {
    throw new ConflictAppException('files.error.alreadyPurged');
  }
  if (entity.status !== FILE_STATUS.TRASHED) {
    throw new BadRequestAppException('files.error.notInTrash');
  }

  await assertCanManageFile(ctx, entity, actor);

  const existsInStorage = await ctx.storage.exists(entity.storageKey);
  if (!existsInStorage) {
    await ctx.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.MISSING,
    });
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }

  const saved = await ctx.filesRepo.saveEntity({
    ...entity,
    status: FILE_STATUS.ACTIVE,
    trashedAt: null,
    trashedByUserId: null,
    purgeAfterAt: null,
  });

  await ctx.recordAudit(
    actor,
    'file.restore',
    'file',
    String(saved.id),
    { status: FILE_STATUS.TRASHED },
    { status: FILE_STATUS.ACTIVE },
  );

  return ctx.toFileRecordResponse(saved);
}

/** Xóa vĩnh viễn một file khỏi Storage và đánh dấu PURGED (Chặn nếu còn liên kết dữ liệu — Mục 6.1.5 & 6.1.8) */
export async function purgeFilePermanently(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<{ purged: true; id: number; storageKey: string }> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }

  await assertCanManageFile(ctx, entity, actor);
  await assertNoActiveUsages(ctx, entity.id);

  const existsInStorage = await ctx.storage.exists(entity.storageKey);
  if (existsInStorage) {
    await ctx.storage.delete(entity.storageKey);
  }
  await deleteThumbnailIfPresent(ctx, entity);

  await ctx.filesRepo.saveEntity({
    ...entity,
    status: FILE_STATUS.PURGED,
  });
  await ctx.filesRepo.softDeleteById(entity.id);

  await ctx.recordAudit(
    actor,
    'file.purge',
    'file',
    String(entity.id),
    {
      displayName: entity.displayName,
      storageKey: entity.storageKey,
      status: entity.status,
    },
    { status: FILE_STATUS.PURGED },
  );

  return {
    purged: true,
    id: entity.id,
    storageKey: entity.storageKey,
  };
}

/** Tự động dọn dẹp các file trong thùng rác đã hết thời gian chờ (`purge_after_at <= now`) */
export async function purgeExpiredTrashedFiles(
  ctx: FilesServiceContext,
  actor?: UserIdentity,
  options?: { readonly skipQueuePublish?: boolean },
): Promise<{ purgedCount: number; purgedIds: number[] }> {
  const expired = await ctx.filesRepo.findExpiredTrashedFiles(new Date());
  const purgedIds: number[] = [];

  for (const file of expired) {
    const usageCount = await ctx.usagesRepo.countByFileId(file.id);
    if (usageCount > 0) continue;

    const existsInStorage = await ctx.storage.exists(file.storageKey);
    if (existsInStorage) {
      await ctx.storage.delete(file.storageKey).catch(() => undefined);
    }
    await deleteThumbnailIfPresent(ctx, file);

    await ctx.filesRepo.saveEntity({
      ...file,
      status: FILE_STATUS.PURGED,
    });
    await ctx.filesRepo.softDeleteById(file.id);
    purgedIds.push(file.id);
  }

  if (purgedIds.length > 0) {
    await ctx.recordAudit(actor, 'file.purge_expired', 'file', 'batch', null, {
      purgedCount: purgedIds.length,
      purgedIds,
    });
    if (!options?.skipQueuePublish && ctx.messagePublisher) {
      await ctx.messagePublisher
        .publish(
          'files.trash_cleanup',
          {
            operation: 'trash_cleanup' as const,
            executeInWorker: false as const,
            totalItems: purgedIds.length,
            fileIds: purgedIds,
          },
          QUEUES.SYSTEM_HEAVY,
          {
            priority: JOB_PRIORITIES.LOW,
            index: {
              operation: 'trash_cleanup',
              purgedCount: purgedIds.length,
            },
          },
        )
        .catch(() => null);
    }
  }

  return {
    purgedCount: purgedIds.length,
    purgedIds,
  };
}

/**
 * Duyệt và công bố file từ khu vực chờ (`PENDING_SCAN = 5` hoặc `QUARANTINED = 6`) sang hoạt động (`ACTIVE = 1` — Mục 6.3.3).
 * Thực hiện quét lại mã độc trên nội dung vật lý trước khi cho phép công bố.
 */
export async function publishStagedFileRecord(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanManageFile(ctx, entity, actor);

  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    await ctx.filesRepo.saveEntity({ ...entity, status: FILE_STATUS.MISSING });
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }

  if (typeof ctx.storage.download === 'function') {
    const physicalBuf = await ctx.storage.download(entity.storageKey);
    const scanRes = ctx.validationService.scanForMalware(
      physicalBuf,
      entity.extension,
      entity.organizationUnitId ?? null,
    );
    if (!scanRes.clean) {
      const meta = entity.metadataJson
        ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
        : {};
      await ctx.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.QUARANTINED,
        metadataJson: JSON.stringify({
          ...meta,
          scanStatus: 'INFECTED',
          threatName: scanRes.threatName,
          scannedAt: scanRes.scannedAt,
        }),
      });
      throw new BadRequestAppException('files.error.malwareDetected', [], {
        threatName: scanRes.threatName ?? 'SUSPICIOUS_PAYLOAD',
      });
    }
  }

  const prevStatus = entity.status;
  const prevMeta = entity.metadataJson
    ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
    : {};
  const nextMeta: Record<string, unknown> = {
    ...prevMeta,
    scanStatus: 'CLEAN',
    threatName: null,
    publishedAt: new Date().toISOString(),
    publishedByUserId: actor?.id ?? null,
  };

  const saved = await ctx.filesRepo.saveEntity({
    ...entity,
    status: FILE_STATUS.ACTIVE,
    metadataJson: JSON.stringify(nextMeta),
  });

  await ctx.recordAudit(
    actor,
    'file.publish',
    'file',
    String(saved.id),
    { status: prevStatus },
    { status: FILE_STATUS.ACTIVE, scanStatus: 'CLEAN' },
  );

  return ctx.getById(saved.id, actor);
}

/**
 * Đưa file vào khu vực cách ly (`QUARANTINED = 6` — Mục 6.3.3) khi phát hiện nghi ngờ mã độc hoặc vi phạm.
 * File bị cách ly sẽ bị khóa tải xuống và phát trực tiếp.
 */
export async function quarantineFileRecord(
  ctx: FilesServiceContext,
  id: number,
  input?: QuarantineFileRequest | string,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanManageFile(ctx, entity, actor);

  const prevStatus = entity.status;
  const prevMeta = entity.metadataJson
    ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
    : {};
  const rawReason = typeof input === 'string' ? input : input?.reason;
  const reason = rawReason?.trim() || 'QUARANTINED_BY_ADMIN';
  const nextMeta: Record<string, unknown> = {
    ...prevMeta,
    scanStatus: 'INFECTED',
    threatName: reason,
    quarantinedAt: new Date().toISOString(),
    quarantinedByUserId: actor?.id ?? null,
  };

  const saved = await ctx.filesRepo.saveEntity({
    ...entity,
    status: FILE_STATUS.QUARANTINED,
    metadataJson: JSON.stringify(nextMeta),
  });

  await ctx.recordAudit(
    actor,
    'file.quarantine',
    'file',
    String(saved.id),
    { status: prevStatus },
    { status: FILE_STATUS.QUARANTINED, reason },
  );

  return ctx.getById(saved.id, actor);
}

/**
 * Kiểm tra tính toàn vẹn của file bằng mã băm SHA-256 và phát hiện file trùng lặp (Mục 6.3.4):
 * - Đọc lại nội dung vật lý từ Storage, tính lại SHA-256 và so khớp với `entity.checksumSha256`.
 * - Nếu nội dung vật lý đã bị thay đổi ngoài đĩa (`intact = false`), tự động gắn cờ cảnh báo.
 * - Trả về danh sách các file khác có cùng mã băm SHA-256 (`duplicateFileIds`).
 */
export async function verifyFileIntegrityChecksum(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<FileIntegrityVerificationResponse> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanViewFile(ctx, entity, actor);

  const verifiedAt = new Date().toISOString();
  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    const updated = await ctx.filesRepo.saveEntity({
      ...entity,
      status: FILE_STATUS.MISSING,
    });
    return {
      fileId: updated.id,
      expectedChecksumSha256: updated.checksumSha256,
      actualChecksumSha256: null,
      intact: false,
      status: updated.status,
      statusName: getFileStatusName(updated.status),
      duplicateFileIds: [],
      verifiedAt,
    };
  }

  let actualChecksumSha256: string | null = null;
  if (typeof ctx.storage.download === 'function') {
    const buf = await ctx.storage.download(entity.storageKey);
    actualChecksumSha256 = computeSha256Hex(buf);
  } else {
    const objStream = await openStorageStream(ctx.storage, entity.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of objStream.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    actualChecksumSha256 = computeSha256Hex(Buffer.concat(chunks));
  }

  const intact = actualChecksumSha256 === entity.checksumSha256;
  const sameHashList =
    typeof ctx.filesRepo.findByChecksumSha256 === 'function'
      ? await ctx.filesRepo.findByChecksumSha256(
          entity.checksumSha256,
          entity.organizationUnitId ?? null,
        )
      : (await ctx.filesRepo.findAllForStats()).filter(
          (f) => f.checksumSha256 === entity.checksumSha256,
        );
  const duplicateFileIds = sameHashList.filter((f) => f.id !== entity.id).map((f) => f.id);

  const prevMeta = entity.metadataJson
    ? (safeJsonParseObject<Record<string, unknown>>(entity.metadataJson) ?? {})
    : {};
  const updatedEntity = await ctx.filesRepo.saveEntity({
    ...entity,
    status: intact ? entity.status : FILE_STATUS.QUARANTINED,
    metadataJson: JSON.stringify({
      ...prevMeta,
      integrityVerifiedAt: verifiedAt,
      integrityIntact: intact,
      ...(!intact ? { scanStatus: 'INFECTED', threatName: 'CHECKSUM_TAMPERED' } : {}),
    }),
  });

  await ctx.recordAudit(actor, 'file.verify_integrity', 'file', String(entity.id), null, {
    intact,
    expectedChecksumSha256: entity.checksumSha256,
    actualChecksumSha256,
    duplicateFileIds,
  });

  return {
    fileId: updatedEntity.id,
    expectedChecksumSha256: updatedEntity.checksumSha256,
    actualChecksumSha256,
    intact,
    status: updatedEntity.status,
    statusName: getFileStatusName(updatedEntity.status),
    duplicateFileIds,
    verifiedAt,
  };
}

/**
 * Dọn dẹp các file không còn được sử dụng (`usageCount = 0`) sau khi đã qua thời gian an toàn (Mục 6.3.7).
 * Chỉ tác động lên những file có `usageCount = 0` và `createdAt <= now - retentionDays`.
 * Hỗ trợ 2 chế độ: `'trash'` (đưa vào thùng rác chờ xóa) hoặc `'purge'` (xóa vĩnh viễn).
 */
export async function cleanupUnusedFileRecords(
  ctx: FilesServiceContext,
  input?: CleanupUnusedFilesRequest,
  actor?: UserIdentity,
): Promise<CleanupUnusedFilesResponse> {
  const orgId = input?.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor);
  const configuredDays = ctx.validationService.getUnusedRetentionDays(orgId);
  const retentionDays =
    input?.olderThanDays !== undefined && input.olderThanDays >= 0
      ? input.olderThanDays
      : configuredDays;
  const action = input?.action === 'purge' ? 'purge' : 'trash';

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - retentionDays * DAY_MS);

  const candidates =
    typeof ctx.filesRepo.findUnusedFilesOlderThan === 'function'
      ? await ctx.filesRepo.findUnusedFilesOlderThan(cutoffDate, orgId)
      : (await ctx.filesRepo.findAllForStats()).filter(
          (f) =>
            f.status === FILE_STATUS.ACTIVE &&
            (Number(f.usageCount) || 0) === 0 &&
            f.createdAt.getTime() <= cutoffDate.getTime() &&
            (!orgId || f.organizationUnitId === orgId),
        );

  const cleanedIds: number[] = [];
  const trashRetentionDays = ctx.validationService.getTrashRetentionDays(orgId);
  const purgeAfterAt = new Date(now.getTime() + trashRetentionDays * DAY_MS);

  for (const file of candidates) {
    const liveUsageCount = await ctx.usagesRepo.countByFileId(file.id);
    if (liveUsageCount > 0) {
      await syncFileUsageCount(ctx, file.id);
      continue;
    }

    if (action === 'purge') {
      const existsInStorage = await ctx.storage.exists(file.storageKey);
      if (existsInStorage) {
        await ctx.storage.delete(file.storageKey).catch(() => undefined);
      }
      await deleteThumbnailIfPresent(ctx, file);
      await ctx.filesRepo.saveEntity({
        ...file,
        status: FILE_STATUS.PURGED,
      });
      await ctx.filesRepo.softDeleteById(file.id);
    } else {
      await ctx.filesRepo.saveEntity({
        ...file,
        status: FILE_STATUS.TRASHED,
        trashedAt: now,
        trashedByUserId: actor?.id ?? null,
        purgeAfterAt,
      });
    }
    cleanedIds.push(file.id);
  }

  if (cleanedIds.length > 0) {
    await ctx.recordAudit(actor, 'file.cleanup_unused', 'file', 'batch', null, {
      retentionDays,
      action,
      cleanedCount: cleanedIds.length,
      cleanedIds,
    });
  }

  return {
    retentionDays,
    action,
    cleanedCount: cleanedIds.length,
    cleanedIds,
  };
}

/** Lấy danh sách các chức năng/bản ghi đang sử dụng một file (Mục 6.1.8) */
export async function listFileUsages(
  ctx: FilesServiceContext,
  fileId: number,
  actor?: UserIdentity,
): Promise<FileUsageItemResponse[]> {
  const entity = await ctx.filesRepo.findById(fileId);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  await assertCanViewFile(ctx, entity, actor);

  const usages = await ctx.usagesRepo.findByFileId(fileId);
  return usages.map((u) => ctx.mapper.toUsageResponse(u));
}

/** Gắn liên kết sử dụng file (`IFilesPublicService.attachUsage` — Mục 6.1.8) */
export async function attachFileUsageRecord(
  ctx: FilesServiceContext,
  input: AttachFileUsageInput,
): Promise<void> {
  const file = await ctx.filesRepo.findById(input.fileId);
  if (!file || file.status !== FILE_STATUS.ACTIVE) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }

  const target = {
    fileId: input.fileId,
    moduleName: input.moduleName.trim(),
    entityType: input.entityType.trim(),
    entityId: String(input.entityId).trim(),
    fieldName: (input.fieldName ?? 'default').trim(),
  };

  const existing = await ctx.usagesRepo.findByTarget(target);
  if (!existing) {
    await ctx.usagesRepo.saveEntity({
      ...target,
      note: input.note ?? null,
      createdByUserId: input.actorId ?? null,
    });
  } else if (input.note !== undefined && existing.note !== input.note) {
    await ctx.usagesRepo.saveEntity({
      ...existing,
      note: input.note ?? null,
    });
  }

  await syncFileUsageCount(ctx, input.fileId);
}

/** Gắn liên kết sử dụng file từ API Controller */
export async function attachFileUsageFromRequest(
  ctx: FilesServiceContext,
  fileId: number,
  input: AttachFileUsageRequest,
  actor?: UserIdentity,
): Promise<FileUsageItemResponse> {
  await attachFileUsageRecord(ctx, {
    fileId,
    moduleName: input.moduleName,
    entityType: input.entityType,
    entityId: input.entityId,
    fieldName: input.fieldName ?? 'default',
    note: input.note ?? null,
    actorId: actor?.id ?? null,
  });
  const saved = await ctx.usagesRepo.findByTarget({
    fileId,
    moduleName: input.moduleName.trim(),
    entityType: input.entityType.trim(),
    entityId: String(input.entityId).trim(),
    fieldName: (input.fieldName ?? 'default').trim(),
  });
  if (!saved) {
    throw new NotFoundAppException('files.error.usageNotFound');
  }
  return ctx.mapper.toUsageResponse(saved);
}

/** Gỡ một liên kết sử dụng file theo ID bản ghi `file_usages` */
export async function removeFileUsageById(
  ctx: FilesServiceContext,
  fileId: number,
  usageId: number,
  actor?: UserIdentity,
): Promise<{ removed: true; usageId: number; usageCount: number }> {
  const file = await ctx.filesRepo.findById(fileId);
  if (!file) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }

  const usage = await ctx.usagesRepo.findById(usageId);
  if (!usage || usage.fileId !== fileId) {
    throw new NotFoundAppException('files.error.usageNotFound');
  }

  await ctx.usagesRepo.softDeleteById(usage.id);
  const nextCount = await syncFileUsageCount(ctx, fileId);

  await ctx.recordAudit(
    actor,
    'file.usage_detach',
    'file',
    String(fileId),
    {
      moduleName: usage.moduleName,
      entityType: usage.entityType,
      entityId: usage.entityId,
    },
    { usageCount: nextCount },
  );

  return { removed: true, usageId, usageCount: nextCount };
}

/** Gỡ liên kết sử dụng file theo target (`IFilesPublicService.detachUsage`) */
export async function detachFileUsageRecord(
  ctx: FilesServiceContext,
  params: {
    readonly fileId: number;
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
  },
): Promise<void> {
  const existing = await ctx.usagesRepo.findByTarget({
    fileId: params.fileId,
    moduleName: params.moduleName.trim(),
    entityType: params.entityType.trim(),
    entityId: String(params.entityId).trim(),
    fieldName: (params.fieldName ?? 'default').trim(),
  });
  if (existing) {
    await ctx.usagesRepo.softDeleteById(existing.id);
    await syncFileUsageCount(ctx, params.fileId);
  }
}

/** Đồng bộ danh sách liên kết sử dụng file của một thực thể nghiệp vụ (`IFilesPublicService.syncEntityFileUsages`) */
export async function syncEntityFileUsageRecords(
  ctx: FilesServiceContext,
  params: {
    readonly moduleName: string;
    readonly entityType: string;
    readonly entityId: string | number;
    readonly fieldName?: string;
    readonly fileIds: readonly number[];
    readonly note?: string | null;
    readonly actorId?: number | null;
  },
): Promise<void> {
  const entityIdStr = String(params.entityId).trim();
  const fieldName = (params.fieldName ?? 'default').trim();
  const desiredFileIds = new Set(params.fileIds);

  const currentUsages = await ctx.usagesRepo.findByEntity({
    moduleName: params.moduleName.trim(),
    entityType: params.entityType.trim(),
    entityId: entityIdStr,
    fieldName,
  });

  for (const usage of currentUsages) {
    if (!desiredFileIds.has(usage.fileId)) {
      await ctx.usagesRepo.softDeleteById(usage.id);
      await syncFileUsageCount(ctx, usage.fileId);
    }
  }

  for (const fileId of desiredFileIds) {
    await attachFileUsageRecord(ctx, {
      fileId,
      moduleName: params.moduleName,
      entityType: params.entityType,
      entityId: entityIdStr,
      fieldName,
      note: params.note ?? null,
      actorId: params.actorId ?? null,
    });
  }
}
