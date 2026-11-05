import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import { JOB_PRIORITIES, QUEUES } from '@packages/messaging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { FILE_STATUS } from '../contracts/index.js';
import type { FileFolderEntity } from '../entities/file-folder.entity.js';
import type {
  CompleteChunkedUploadRequest,
  InitChunkedUploadRequest,
  UploadBatchFilesRequest,
  UploadChunkPartRequest,
  UploadSingleFileRequest,
} from '../requests/files.requests.js';
import type {
  ChunkedUploadInitResponse,
  ChunkedUploadPartResponse,
  FileRecordResponse,
} from '../responses/files.response.js';
import { type FilesServiceContext, assertCanAccessFolder } from './file-access-control.helper.js';
import {
  buildImmutableStorageKey,
  buildThumbnailStorageKey,
  computeSha256Hex,
} from './file-storage.helper.js';

const HEAVY_MEDIA_QUEUE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB

/** Giải quyết tên driver lưu trữ hiện hành qua Storage Adapter Contract (`StorageContract.driverName`) */
export function resolveStorageDriverName(ctx: FilesServiceContext): string {
  return ctx.storage.driverName;
}

/**
 * Kiểm tra hạn mức dung lượng lưu trữ (Mục 6.2.7):
 * 1. Theo đơn vị / hệ thống (`file.storage.quota_mb`).
 * 2. Theo người dùng (`file.storage.user_quota_mb`).
 */
export async function assertStorageQuotaWithinLimit(
  ctx: FilesServiceContext,
  incomingSizeBytes: number,
  organizationUnitId?: number | null,
  userId?: number | null,
): Promise<void> {
  const orgQuotaMb = ctx.validationService.getStorageQuotaMb(organizationUnitId);
  if (orgQuotaMb > 0) {
    const maxOrgQuotaBytes = orgQuotaMb * 1024 * 1024;
    const usedOrgBytes =
      typeof ctx.filesRepo.sumActiveBytesByOrgUnit === 'function'
        ? await ctx.filesRepo.sumActiveBytesByOrgUnit(organizationUnitId)
        : (await ctx.filesRepo.findAllForStats())
            .filter(
              (f) =>
                f.status === FILE_STATUS.ACTIVE &&
                (!organizationUnitId || f.organizationUnitId === organizationUnitId),
            )
            .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0);

    if (usedOrgBytes + incomingSizeBytes > maxOrgQuotaBytes) {
      throw new BadRequestAppException('files.error.storageQuotaExceeded', [], {
        quotaMb: orgQuotaMb,
      });
    }
  }

  const userQuotaMb = ctx.validationService.getUserStorageQuotaMb(organizationUnitId);
  if (userQuotaMb > 0 && typeof userId === 'number' && userId > 0) {
    const maxUserQuotaBytes = userQuotaMb * 1024 * 1024;
    const usedUserBytes =
      typeof ctx.filesRepo.sumActiveBytesByUser === 'function'
        ? await ctx.filesRepo.sumActiveBytesByUser(userId)
        : (await ctx.filesRepo.findAllForStats())
            .filter((f) => f.status === FILE_STATUS.ACTIVE && f.uploadedByUserId === userId)
            .reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0);

    if (usedUserBytes + incomingSizeBytes > maxUserQuotaBytes) {
      throw new BadRequestAppException('files.error.userStorageQuotaExceeded', [], {
        quotaMb: userQuotaMb,
      });
    }
  }
}

/**
 * Tải một file lên hệ thống (Mục 6.1, 6.2 & 6.3):
 * - Kiểm tra định dạng (extension, MIME, Magic Bytes) và giới hạn dung lượng theo Loại file & Module.
 * - Quét mã độc, hỗ trợ đưa vào khu vực chờ (`PENDING_SCAN = 5`) hoặc cách ly (`QUARANTINED = 6`).
 * - Tính checksum SHA-256 và xử lý file trùng lặp theo chính sách (`ALLOW` | `REJECT` | `REUSE`).
 * - Tự động Resize, tối ưu dung lượng ảnh và tạo ảnh thu nhỏ (`thumbnail`) hiển thị nhanh.
 */
export async function uploadSingleFile(
  ctx: FilesServiceContext,
  input: UploadSingleFileRequest,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const orgId = input.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor);

  let folder: FileFolderEntity | null = null;
  if (input.folderId !== undefined && input.folderId !== null) {
    folder = await ctx.foldersRepo.findById(input.folderId);
    if (!folder) {
      throw new NotFoundAppException('files.error.folderNotFound');
    }
    await assertCanAccessFolder(ctx, folder, actor);
  }

  const validated = ctx.validationService.validateUploadInput(input, orgId);
  await assertStorageQuotaWithinLimit(ctx, validated.sizeBytes, orgId, actor?.id ?? null);
  const checksumSha256 = computeSha256Hex(validated.buffer);

  const duplicateMatches =
    typeof ctx.filesRepo.findByChecksumSha256 === 'function'
      ? await ctx.filesRepo.findByChecksumSha256(checksumSha256, orgId)
      : (await ctx.filesRepo.findAllForStats()).filter(
          (f) => f.checksumSha256 === checksumSha256 && f.status === FILE_STATUS.ACTIVE,
        );
  const existingDuplicate = duplicateMatches[0] ?? null;
  const duplicatePolicy = input.rejectDuplicate
    ? 'REJECT'
    : input.reuseDuplicate
      ? 'REUSE'
      : ctx.validationService.getDuplicatePolicy(orgId);

  if (existingDuplicate) {
    if (duplicatePolicy === 'REJECT') {
      throw new ConflictAppException('files.error.duplicateFileDetected', [], {
        duplicateFileId: existingDuplicate.id,
      });
    }
    if (duplicatePolicy === 'REUSE') {
      return ctx.getById(existingDuplicate.id, actor);
    }
  }

  const storagePrefix = ctx.validationService.getStorageKeyPrefix();
  const storageKey = buildImmutableStorageKey(storagePrefix, validated.extension);
  await ctx.storage.upload(storageKey, validated.buffer, validated.mimeType);

  let thumbnailStorageKey: string | null = null;
  if (validated.thumbnail) {
    thumbnailStorageKey = buildThumbnailStorageKey(storagePrefix, validated.thumbnail.extension);
    await ctx.storage.upload(
      thumbnailStorageKey,
      validated.thumbnail.buffer,
      validated.thumbnail.mimeType,
    );
  }

  const shouldStage =
    Boolean(input.stageForScan) || ctx.validationService.shouldStageBeforePublish(orgId);
  const initialStatus = !validated.malwareScan.clean
    ? FILE_STATUS.QUARANTINED
    : shouldStage
      ? FILE_STATUS.PENDING_SCAN
      : FILE_STATUS.ACTIVE;

  const scanStatus = !validated.malwareScan.clean
    ? 'INFECTED'
    : initialStatus === FILE_STATUS.PENDING_SCAN
      ? 'PENDING'
      : 'CLEAN';

  const enrichedMeta: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    ...(input.moduleName ? { moduleName: input.moduleName.trim().toLowerCase() } : {}),
    scanStatus,
    scannedAt: validated.malwareScan.scannedAt,
    ...(validated.malwareScan.threatName ? { threatName: validated.malwareScan.threatName } : {}),
    ...(existingDuplicate ? { duplicateOfFileId: existingDuplicate.id } : {}),
    ...(validated.imageDimensions ? { imageDimensions: validated.imageDimensions } : {}),
    ...(validated.optimizedSavedBytes > 0
      ? {
          originalSizeBytes: validated.originalSizeBytes,
          optimizedSavedBytes: validated.optimizedSavedBytes,
        }
      : {}),
    ...(thumbnailStorageKey
      ? {
          thumbnailStorageKey,
          thumbnailMimeType: validated.thumbnail?.mimeType ?? 'image/png',
          thumbnailWidth: validated.thumbnail?.width ?? null,
          thumbnailHeight: validated.thumbnail?.height ?? null,
        }
      : {}),
  };

  const code = await ctx.generateEntityCode('files.file_code', orgId);
  const defaultVisibility = ctx.validationService.getDefaultVisibility(orgId);
  const saved = await ctx.filesRepo.saveEntity({
    code,
    folderId: folder ? folder.id : null,
    displayName: validated.displayName,
    originalName: validated.originalName,
    storageDriver: resolveStorageDriverName(ctx),
    storageKey,
    mimeType: validated.mimeType,
    extension: validated.extension,
    category: validated.category,
    sizeBytes: validated.sizeBytes,
    checksumSha256,
    visibility: input.visibility ?? defaultVisibility,
    status: initialStatus,
    uploadedByUserId: actor?.id ?? null,
    organizationUnitId: orgId,
    usageCount: 0,
    trashedAt: null,
    trashedByUserId: null,
    purgeAfterAt: null,
    metadataJson: Object.keys(enrichedMeta).length > 0 ? JSON.stringify(enrichedMeta) : null,
  });

  await ctx.recordAudit(actor, 'file.upload', 'file', String(saved.id), null, {
    code: saved.code,
    displayName: saved.displayName,
    originalName: saved.originalName,
    mimeType: saved.mimeType,
    sizeBytes: Number(saved.sizeBytes),
    storageKey: saved.storageKey,
    status: saved.status,
    scanStatus,
  });

  if (
    ctx.messagePublisher &&
    (saved.status === FILE_STATUS.PENDING_SCAN ||
      Number(saved.sizeBytes) >= HEAVY_MEDIA_QUEUE_THRESHOLD_BYTES)
  ) {
    await ctx.messagePublisher
      .publish(
        'files.media_process',
        {
          operation: 'media_process' as const,
          fileId: saved.id,
          storageKey: saved.storageKey,
          mimeType: saved.mimeType,
          extension: saved.extension,
          totalItems: 1,
        },
        QUEUES.SYSTEM_HEAVY,
        {
          priority: JOB_PRIORITIES.LOW,
          index: {
            operation: 'media_process',
            fileId: saved.id,
            extension: saved.extension,
          },
        },
      )
      .catch(() => null);
  }

  const uploaderMap = await ctx.loadUploaderSummaries(
    saved.uploadedByUserId ? [saved.uploadedByUserId] : [],
  );

  return ctx.toFileRecordResponse(saved, {
    folderName: folder?.name ?? null,
    uploadedByUser: saved.uploadedByUserId
      ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
      : null,
    usages: [],
    permissions: [],
    canDownload: saved.status === FILE_STATUS.ACTIVE,
  });
}

/** Tải nhiều file lên hệ thống cùng lúc (Mục 6.1) */
export async function uploadBatchFiles(
  ctx: FilesServiceContext,
  input: UploadBatchFilesRequest,
  actor?: UserIdentity,
): Promise<{ items: FileRecordResponse[]; count: number }> {
  if (!input.files || input.files.length === 0) {
    throw new BadRequestAppException('files.error.batchEmpty');
  }

  const orgId = input.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor);
  const maxBatchFiles = ctx.validationService.getMaxBatchFiles(orgId);
  if (input.files.length > maxBatchFiles) {
    throw new BadRequestAppException('files.error.batchTooLarge', [], {
      maxFiles: maxBatchFiles,
    });
  }

  const items: FileRecordResponse[] = [];
  for (const fileItem of input.files) {
    const mergedItem: UploadSingleFileRequest = {
      ...fileItem,
      folderId: fileItem.folderId !== undefined ? fileItem.folderId : input.folderId,
      visibility: fileItem.visibility !== undefined ? fileItem.visibility : input.visibility,
      organizationUnitId:
        fileItem.organizationUnitId !== undefined
          ? fileItem.organizationUnitId
          : input.organizationUnitId,
      moduleName: fileItem.moduleName !== undefined ? fileItem.moduleName : input.moduleName,
      stageForScan:
        fileItem.stageForScan !== undefined ? fileItem.stageForScan : input.stageForScan,
      quarantineOnThreat:
        fileItem.quarantineOnThreat !== undefined
          ? fileItem.quarantineOnThreat
          : input.quarantineOnThreat,
      rejectDuplicate:
        fileItem.rejectDuplicate !== undefined ? fileItem.rejectDuplicate : input.rejectDuplicate,
      reuseDuplicate:
        fileItem.reuseDuplicate !== undefined ? fileItem.reuseDuplicate : input.reuseDuplicate,
      optimizeImage:
        fileItem.optimizeImage !== undefined ? fileItem.optimizeImage : input.optimizeImage,
      generateThumbnail:
        fileItem.generateThumbnail !== undefined
          ? fileItem.generateThumbnail
          : input.generateThumbnail,
    };
    const uploaded = await uploadSingleFile(ctx, mergedItem, actor);
    items.push(uploaded);
  }

  return { items, count: items.length };
}

/**
 * Khởi tạo phiên tải lên theo mảnh (Chunked Upload Init):
 * Kiểm tra trước định dạng, hạn mức dung lượng và Quota lưu trữ trước khi nhận dữ liệu.
 */
export async function initChunkedFileUpload(
  ctx: FilesServiceContext,
  input: InitChunkedUploadRequest,
  actor?: UserIdentity,
): Promise<ChunkedUploadInitResponse> {
  await ctx.chunkSessionManager.cleanupExpired(ctx.storage);
  const orgId = input.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor);

  let folder: FileFolderEntity | null = null;
  if (input.folderId !== undefined && input.folderId !== null) {
    folder = await ctx.foldersRepo.findById(input.folderId);
    if (!folder) {
      throw new NotFoundAppException('files.error.folderNotFound');
    }
    await assertCanAccessFolder(ctx, folder, actor);
  }

  const validated = ctx.validationService.validateChunkedInitInput(input, orgId);
  await assertStorageQuotaWithinLimit(ctx, validated.sizeBytes, orgId, actor?.id ?? null);

  const session = ctx.chunkSessionManager.createSession({
    storagePrefix: ctx.validationService.getStorageKeyPrefix(),
    input,
    originalName: validated.originalName,
    displayName: validated.displayName,
    extension: validated.extension,
    mimeType: validated.mimeType,
    category: validated.category,
    folderId: folder ? folder.id : null,
    folderName: folder ? folder.name : null,
    organizationUnitId: orgId,
    actorUserId: actor?.id ?? null,
  });

  return {
    uploadId: session.uploadId,
    chunkSizeBytes: session.chunkSizeBytes,
    totalChunks: session.totalChunks,
    expiresAt: new Date(session.expiresAtMs).toISOString(),
  };
}

/**
 * Ghi nối tiếp một mảnh dữ liệu (chunk) vào tệp tạm trên đĩa và cập nhật mã băm SHA-256 streaming.
 * Ở mảnh đầu tiên (`chunkIndex === 0`), kiểm tra ngay Magic Bytes và quét mã độc.
 */
export async function uploadFileChunkPart(
  ctx: FilesServiceContext,
  uploadId: string,
  input: UploadChunkPartRequest,
  actor?: UserIdentity,
): Promise<ChunkedUploadPartResponse> {
  const session = ctx.chunkSessionManager.getActiveSession(uploadId, actor?.id ?? null);
  const chunkBuffer = ctx.chunkSessionManager.decodeChunkPayload(input, session.originalName);

  if (input.chunkIndex === 0) {
    try {
      session.malwareScan = ctx.validationService.validateFirstChunkBuffer(
        chunkBuffer,
        session.extension,
        {
          organizationUnitId: session.organizationUnitId,
          quarantineOnThreat: session.quarantineOnThreat,
          stageForScan: session.stageForScan,
        },
      );
      session.imageDimensions = ctx.validationService.extractImageDimensions(
        chunkBuffer,
        session.extension,
      );
    } catch (err) {
      await ctx.chunkSessionManager.abortSession(uploadId, ctx.storage);
      throw err;
    }
  }

  const receivedBytes = await ctx.chunkSessionManager.appendChunkToStorage(
    session,
    input.chunkIndex,
    chunkBuffer,
    ctx.storage,
  );
  const progressPercent = Math.min(
    100,
    Math.round((receivedBytes / Math.max(1, session.totalBytes)) * 100),
  );

  return {
    uploadId: session.uploadId,
    chunkIndex: input.chunkIndex,
    receivedBytes,
    totalBytes: session.totalBytes,
    progressPercent,
  };
}

/**
 * Hoàn tất phiên tải lên theo mảnh (Chunked Upload Complete):
 * Đối chiếu tổng số byte đã nhận, chốt mã băm SHA-256 toàn file, kiểm tra trùng lặp,
 * đổi tên nguyên tử tệp tạm sang `storageKey` chính thức và lưu bản ghi DB.
 */
export async function completeChunkedFileUpload(
  ctx: FilesServiceContext,
  uploadId: string,
  input?: CompleteChunkedUploadRequest,
  actor?: UserIdentity,
): Promise<FileRecordResponse> {
  const session = ctx.chunkSessionManager.getActiveSession(uploadId, actor?.id ?? null);

  if (
    session.receivedBytes !== session.totalBytes ||
    session.expectedChunkIndex < session.totalChunks
  ) {
    await ctx.chunkSessionManager.abortSession(uploadId, ctx.storage);
    throw new BadRequestAppException('files.error.incompleteChunkedUpload', [], {
      expectedBytes: session.totalBytes,
      receivedBytes: session.receivedBytes,
    });
  }

  const checksumSha256 = session.sha256Hash.digest('hex');
  const orgId = session.organizationUnitId;

  const duplicateMatches =
    typeof ctx.filesRepo.findByChecksumSha256 === 'function'
      ? await ctx.filesRepo.findByChecksumSha256(checksumSha256, orgId)
      : (await ctx.filesRepo.findAllForStats()).filter(
          (f) => f.checksumSha256 === checksumSha256 && f.status === FILE_STATUS.ACTIVE,
        );
  const existingDuplicate = duplicateMatches[0] ?? null;
  const duplicatePolicy = session.rejectDuplicate
    ? 'REJECT'
    : session.reuseDuplicate
      ? 'REUSE'
      : ctx.validationService.getDuplicatePolicy(orgId);

  if (existingDuplicate) {
    if (duplicatePolicy === 'REJECT') {
      await ctx.chunkSessionManager.abortSession(uploadId, ctx.storage);
      throw new ConflictAppException('files.error.duplicateFileDetected', [], {
        duplicateFileId: existingDuplicate.id,
      });
    }
    if (duplicatePolicy === 'REUSE') {
      await ctx.chunkSessionManager.abortSession(uploadId, ctx.storage);
      return ctx.getById(existingDuplicate.id, actor);
    }
  }

  const storagePrefix = ctx.validationService.getStorageKeyPrefix();
  const storageKey = buildImmutableStorageKey(storagePrefix, session.extension);
  await ctx.chunkSessionManager.finalizeToStorageKey(session, storageKey, ctx.storage);

  const shouldStage =
    Boolean(session.stageForScan) || ctx.validationService.shouldStageBeforePublish(orgId);
  const initialStatus = !session.malwareScan.clean
    ? FILE_STATUS.QUARANTINED
    : shouldStage
      ? FILE_STATUS.PENDING_SCAN
      : FILE_STATUS.ACTIVE;

  const scanStatus = !session.malwareScan.clean
    ? 'INFECTED'
    : initialStatus === FILE_STATUS.PENDING_SCAN
      ? 'PENDING'
      : 'CLEAN';

  const enrichedMeta: Record<string, unknown> = {
    ...(session.metadata ?? {}),
    ...(input?.metadata ?? {}),
    ...(session.moduleName ? { moduleName: session.moduleName.trim().toLowerCase() } : {}),
    chunkedUpload: true,
    totalChunks: session.totalChunks,
    scanStatus,
    scannedAt: session.malwareScan.scannedAt,
    ...(session.malwareScan.threatName ? { threatName: session.malwareScan.threatName } : {}),
    ...(existingDuplicate ? { duplicateOfFileId: existingDuplicate.id } : {}),
    ...(session.imageDimensions ? { imageDimensions: session.imageDimensions } : {}),
  };

  const code = await ctx.generateEntityCode('files.file_code', orgId);
  const defaultVisibility = ctx.validationService.getDefaultVisibility(orgId);
  const saved = await ctx.filesRepo.saveEntity({
    code,
    folderId: session.folderId,
    displayName: session.displayName,
    originalName: session.originalName,
    storageDriver: resolveStorageDriverName(ctx),
    storageKey,
    mimeType: session.mimeType,
    extension: session.extension,
    category: session.category,
    sizeBytes: session.totalBytes,
    checksumSha256,
    visibility: session.visibility ?? defaultVisibility,
    status: initialStatus,
    uploadedByUserId: actor?.id ?? session.actorUserId ?? null,
    organizationUnitId: orgId,
    usageCount: 0,
    trashedAt: null,
    trashedByUserId: null,
    purgeAfterAt: null,
    metadataJson: Object.keys(enrichedMeta).length > 0 ? JSON.stringify(enrichedMeta) : null,
  });

  await ctx.recordAudit(actor, 'file.upload_chunked', 'file', String(saved.id), null, {
    code: saved.code,
    displayName: saved.displayName,
    originalName: saved.originalName,
    mimeType: saved.mimeType,
    sizeBytes: Number(saved.sizeBytes),
    storageKey: saved.storageKey,
    status: saved.status,
    scanStatus,
    totalChunks: session.totalChunks,
  });

  if (ctx.messagePublisher) {
    await ctx.messagePublisher
      .publish(
        'files.media_process',
        {
          operation: 'media_process' as const,
          fileId: saved.id,
          storageKey: saved.storageKey,
          mimeType: saved.mimeType,
          extension: saved.extension,
          totalItems: 1,
        },
        QUEUES.SYSTEM_HEAVY,
        {
          priority: JOB_PRIORITIES.LOW,
          index: {
            operation: 'media_process',
            fileId: saved.id,
            extension: saved.extension,
            chunkedUpload: 'true',
          },
        },
      )
      .catch(() => null);
  }

  const uploaderMap = await ctx.loadUploaderSummaries(
    saved.uploadedByUserId ? [saved.uploadedByUserId] : [],
  );

  return ctx.toFileRecordResponse(saved, {
    folderName: session.folderName,
    uploadedByUser: saved.uploadedByUserId
      ? (uploaderMap.get(saved.uploadedByUserId) ?? null)
      : null,
    usages: [],
    permissions: [],
    canDownload: saved.status === FILE_STATUS.ACTIVE,
  });
}
