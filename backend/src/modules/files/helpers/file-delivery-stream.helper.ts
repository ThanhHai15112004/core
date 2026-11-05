import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { ObjectStream, StorageContract } from '@packages/storage/index.js';
import { FILE_STATUS, FILE_VISIBILITY } from '../contracts/index.js';
import { FALLBACK_TEMP_LINK_SECRET } from '../enum/files.enum.js';
import type { CreateTemporaryDownloadLinkRequest } from '../requests/files.requests.js';
import type {
  FileRecordResponse,
  TemporaryDownloadLinkResponse,
} from '../responses/files.response.js';
import type { ResolvedByteRange, TemporaryDownloadTokenPayload } from '../types/files.types.js';
import {
  type FilesServiceContext,
  assertCanDownloadFile,
  assertCanViewFile,
} from './file-access-control.helper.js';
import {
  buildSafeDownloadFileName,
  parseByteRangeHeader,
  signTemporaryDownloadToken,
  verifyTemporaryDownloadToken,
} from './file-storage.helper.js';

/** Mở luồng dữ liệu qua Storage Adapter Contract (`StorageContract.stream`) */
export async function openStorageStream(
  storage: StorageContract,
  key: string,
  range?: { start: number; end: number },
): Promise<ObjectStream> {
  return storage.stream(key, range);
}

/** Giải quyết khóa bí mật để ký và xác thực đường dẫn tải tạm thời */
export async function resolveTemporaryLinkSigningSecret(ctx: FilesServiceContext): Promise<string> {
  if (ctx.tokenService) {
    const accessSecret = await ctx.tokenService.getAccessSecret().catch(() => '');
    if (accessSecret) return accessSecret;
  }
  return FALLBACK_TEMP_LINK_SECRET;
}

/** Chuẩn bị luồng tải file xuống (kiểm tra quyền tải file & chặn nếu đang chờ quét/cách ly — Mục 6.1 & 6.2) */
export async function prepareFileDownload(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<{
  stream: ObjectStream;
  file: FileRecordResponse;
  downloadFileName: string;
}> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.alreadyPurged');
  }
  if (entity.status === FILE_STATUS.TRASHED) {
    throw new BadRequestAppException('files.error.inTrashCannotDownload');
  }
  if (entity.status === FILE_STATUS.PENDING_SCAN) {
    throw new ForbiddenAppException('files.error.filePendingScan');
  }
  if (entity.status === FILE_STATUS.QUARANTINED) {
    throw new ForbiddenAppException('files.error.fileInQuarantine');
  }

  await assertCanDownloadFile(ctx, entity, actor);

  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    if (entity.status !== FILE_STATUS.MISSING) {
      await ctx.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
    }
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }

  const stream = await openStorageStream(ctx.storage, entity.storageKey);
  const downloadFileName = buildSafeDownloadFileName(entity.displayName, entity.extension);

  await ctx.recordAudit(actor, 'file.download', 'file', String(entity.id), null, {
    displayName: entity.displayName,
    sizeBytes: Number(entity.sizeBytes),
  });

  return {
    stream,
    file: await ctx.toFileRecordResponse(entity),
    downloadFileName,
  };
}

/**
 * Chuẩn bị luồng phát trực tiếp (Inline / Video & Audio Byte-Range Streaming `206 Partial Content`).
 * Kiểm tra quyền tải/phát (`assertCanDownloadFile`) trước khi mở stream.
 */
export async function prepareFileStream(
  ctx: FilesServiceContext,
  id: number,
  rangeHeader?: string,
  actor?: UserIdentity,
): Promise<{
  stream: ObjectStream;
  file: FileRecordResponse;
  byteRange: ResolvedByteRange | null;
}> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.TRASHED) {
    throw new BadRequestAppException('files.error.inTrashCannotDownload');
  }
  if (entity.status === FILE_STATUS.PENDING_SCAN) {
    throw new ForbiddenAppException('files.error.filePendingScan');
  }
  if (entity.status === FILE_STATUS.QUARANTINED) {
    throw new ForbiddenAppException('files.error.fileInQuarantine');
  }

  await assertCanDownloadFile(ctx, entity, actor);

  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    if (entity.status !== FILE_STATUS.MISSING) {
      await ctx.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
    }
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }

  const totalSize = Number(entity.sizeBytes) || 0;
  let byteRange: ResolvedByteRange | null = null;

  if (rangeHeader && totalSize > 0 && rangeHeader.startsWith('bytes=')) {
    byteRange = parseByteRangeHeader(rangeHeader, totalSize);
  }

  const stream = byteRange
    ? await openStorageStream(ctx.storage, entity.storageKey, {
        start: byteRange.start,
        end: byteRange.end,
      })
    : await openStorageStream(ctx.storage, entity.storageKey);

  return {
    stream,
    file: await ctx.toFileRecordResponse(entity),
    byteRange,
  };
}

/**
 * Chuẩn bị luồng truy cập công khai hoặc điều hướng CDN (Mục 6.4.7).
 * CHỈ cho phép các file có `visibility = PUBLIC (3)` và `status = ACTIVE (1)`.
 * Nếu file là `PRIVATE` hoặc `INTERNAL`, từ chối ngay với `ForbiddenAppException`.
 */
export async function preparePublicFileAccess(
  ctx: FilesServiceContext,
  id: number,
): Promise<{
  redirectUrl: string | null;
  stream: ObjectStream | null;
  file: FileRecordResponse;
  downloadFileName: string;
}> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.visibility !== FILE_VISIBILITY.PUBLIC) {
    throw new ForbiddenAppException('files.error.publicAccessDenied');
  }
  if (entity.status === FILE_STATUS.TRASHED) {
    throw new BadRequestAppException('files.error.inTrashCannotDownload');
  }
  if (entity.status === FILE_STATUS.PENDING_SCAN) {
    throw new ForbiddenAppException('files.error.filePendingScan');
  }
  if (entity.status === FILE_STATUS.QUARANTINED) {
    throw new ForbiddenAppException('files.error.fileInQuarantine');
  }

  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    if (entity.status !== FILE_STATUS.MISSING) {
      await ctx.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
    }
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }

  const fileResponse = await ctx.toFileRecordResponse(entity);
  const downloadFileName = buildSafeDownloadFileName(entity.displayName, entity.extension);

  if (fileResponse.publicUrl && /^https?:\/\//i.test(fileResponse.publicUrl)) {
    return {
      redirectUrl: fileResponse.publicUrl,
      stream: null,
      file: fileResponse,
      downloadFileName,
    };
  }

  const stream = await openStorageStream(ctx.storage, entity.storageKey);
  return {
    redirectUrl: null,
    stream,
    file: fileResponse,
    downloadFileName,
  };
}

/**
 * Chuẩn bị luồng ảnh thu nhỏ (Thumbnail — Mục 6.3.5) để hiển thị nhanh trên giao diện.
 * Nếu tệp có `thumbnailStorageKey` trên Storage thì trả về stream của ảnh thumbnail,
 * nếu không có thì fallback trả về stream của ảnh gốc.
 */
export async function prepareFileThumbnail(
  ctx: FilesServiceContext,
  id: number,
  actor?: UserIdentity,
): Promise<{
  stream: ObjectStream;
  mimeType: string;
  file: FileRecordResponse;
}> {
  const entity = await ctx.filesRepo.findById(id);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.QUARANTINED) {
    throw new ForbiddenAppException('files.error.fileInQuarantine');
  }

  await assertCanViewFile(ctx, entity, actor);

  const meta = entity.metadataJson
    ? safeJsonParseObject<Record<string, unknown>>(entity.metadataJson)
    : null;
  const thumbKey =
    typeof meta?.thumbnailStorageKey === 'string' && meta.thumbnailStorageKey.length > 0
      ? meta.thumbnailStorageKey
      : null;
  const thumbMime =
    typeof meta?.thumbnailMimeType === 'string' && meta.thumbnailMimeType.length > 0
      ? meta.thumbnailMimeType
      : entity.mimeType;

  if (thumbKey && (await ctx.storage.exists(thumbKey))) {
    const stream = await openStorageStream(ctx.storage, thumbKey);
    return {
      stream,
      mimeType: thumbMime,
      file: ctx.mapper.toFileResponse(entity),
    };
  }

  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }
  const stream = await openStorageStream(ctx.storage, entity.storageKey);
  return {
    stream,
    mimeType: entity.mimeType,
    file: ctx.mapper.toFileResponse(entity),
  };
}

/**
 * Tạo đường dẫn tải file tạm thời tự hết hạn (Signed Temporary Download Link — Mục 6.2.6).
 * Kiểm tra người tạo phải có quyền tải file (`assertCanDownloadFile`), sau đó ký HMAC-SHA256.
 */
export async function createSignedTemporaryDownloadLink(
  ctx: FilesServiceContext,
  fileId: number,
  input?: CreateTemporaryDownloadLinkRequest,
  actor?: UserIdentity,
): Promise<TemporaryDownloadLinkResponse> {
  const entity = await ctx.filesRepo.findById(fileId);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.TRASHED) {
    throw new BadRequestAppException('files.error.inTrashCannotDownload');
  }
  if (entity.status === FILE_STATUS.PENDING_SCAN) {
    throw new ForbiddenAppException('files.error.filePendingScan');
  }
  if (entity.status === FILE_STATUS.QUARANTINED) {
    throw new ForbiddenAppException('files.error.fileInQuarantine');
  }

  await assertCanDownloadFile(ctx, entity, actor);

  const orgId = entity.organizationUnitId ?? ctx.resolvePrimaryOrgId(actor);
  const defaultTtlSec = ctx.validationService.getTempLinkDefaultTtlSec(orgId);
  const maxTtlSec = ctx.validationService.getTempLinkMaxTtlSec(orgId);

  const requestedTtl = input?.expiresInSeconds ?? defaultTtlSec;
  if (requestedTtl > maxTtlSec) {
    throw new BadRequestAppException('files.error.temporaryLinkTtlExceeded', [], {
      maxSeconds: maxTtlSec,
    });
  }

  const expiresInSeconds = Math.max(1, Math.trunc(requestedTtl));
  const disposition = input?.disposition === 'inline' ? 'inline' : 'attachment';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + expiresInSeconds;

  const payload: TemporaryDownloadTokenPayload = {
    typ: 'file_temp_dl',
    fid: entity.id,
    exp: expSeconds,
    disp: disposition,
    uid: actor?.id ?? null,
  };

  const secret = await resolveTemporaryLinkSigningSecret(ctx);
  const token = signTemporaryDownloadToken(payload, secret);
  const expiresAt = new Date(expSeconds * 1000).toISOString();
  const downloadUrl = `/api/v1/files/temporary-download/${token}`;

  await ctx.recordAudit(actor, 'file.temporary_link_create', 'file', String(entity.id), null, {
    expiresInSeconds,
    expiresAt,
    disposition,
  });

  return {
    fileId: entity.id,
    token,
    expiresInSeconds,
    expiresAt,
    disposition,
    downloadUrl,
  };
}

/**
 * Giải mã và xác thực đường dẫn tải tạm thời (`GET /api/v1/files/temporary-download/:token`).
 * Tự động từ chối nếu chữ ký không khớp hoặc đã quá thời hạn `exp`.
 */
export async function prepareSignedTemporaryDownload(
  ctx: FilesServiceContext,
  token: string,
): Promise<{
  stream: ObjectStream;
  file: FileRecordResponse;
  downloadFileName: string;
  disposition: 'attachment' | 'inline';
}> {
  const secret = await resolveTemporaryLinkSigningSecret(ctx);
  const payload = verifyTemporaryDownloadToken(token, secret);
  if (!payload) {
    throw new ForbiddenAppException('files.error.temporaryLinkExpiredOrInvalid');
  }

  const entity = await ctx.filesRepo.findById(payload.fid);
  if (!entity || entity.status === FILE_STATUS.PURGED) {
    throw new NotFoundAppException('files.error.fileNotFound');
  }
  if (entity.status === FILE_STATUS.TRASHED) {
    throw new BadRequestAppException('files.error.inTrashCannotDownload');
  }

  const exists = await ctx.storage.exists(entity.storageKey);
  if (!exists) {
    if (entity.status !== FILE_STATUS.MISSING) {
      await ctx.filesRepo.saveEntity({
        ...entity,
        status: FILE_STATUS.MISSING,
      });
    }
    throw new NotFoundAppException('files.error.storageObjectMissing');
  }

  const stream = await openStorageStream(ctx.storage, entity.storageKey);
  const downloadFileName = buildSafeDownloadFileName(entity.displayName, entity.extension);

  await ctx.recordAudit(
    undefined,
    'file.temporary_link_download',
    'file',
    String(entity.id),
    null,
    {
      displayName: entity.displayName,
      issuedByUserId: payload.uid,
    },
  );

  return {
    stream,
    file: await ctx.toFileRecordResponse(entity),
    downloadFileName,
    disposition: payload.disp,
  };
}
