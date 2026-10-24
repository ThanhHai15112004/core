import { createHash, randomUUID, type Hash } from 'node:crypto';
import { BadRequestAppException, NotFoundAppException } from '@packages/kernel/index.js';
import type { BaseStorageProvider } from '@packages/storage/index.js';
import type { FileCategoryCode, FileVisibilityCode } from '../contracts/index.js';
import {
  DEFAULT_CHUNK_SESSION_TTL_MS,
  DEFAULT_MAX_UPLOAD_CHUNK_SIZE_BYTES,
  DEFAULT_UPLOAD_CHUNK_SIZE_BYTES,
  LARGE_FILE_CHUNK_THRESHOLD_BYTES,
  LARGE_FILE_UPLOAD_CHUNK_SIZE_BYTES,
} from '../enum/files.enum.js';
import type { InitChunkedUploadRequest } from '../requests/files.requests.js';
import type { MalwareScanResult } from '../types/files.types.js';
import { decodeUploadBuffer } from './file-security-scanner.helper.js';

export interface ActiveChunkedUploadSession {
  readonly uploadId: string;
  readonly tempStorageKey: string;
  readonly originalName: string;
  readonly displayName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly category: FileCategoryCode;
  readonly totalBytes: number;
  readonly chunkSizeBytes: number;
  readonly totalChunks: number;
  readonly folderId: number | null;
  readonly folderName: string | null;
  readonly visibility?: FileVisibilityCode | undefined;
  readonly organizationUnitId: number | null;
  readonly actorUserId: number | null;
  readonly moduleName?: string | undefined;
  readonly stageForScan?: boolean | undefined;
  readonly quarantineOnThreat?: boolean | undefined;
  readonly rejectDuplicate?: boolean | undefined;
  readonly reuseDuplicate?: boolean | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
  readonly sha256Hash: Hash;
  readonly fallbackBuffers: Buffer[];
  expectedChunkIndex: number;
  receivedBytes: number;
  malwareScan: MalwareScanResult;
  imageDimensions: { readonly width: number; readonly height: number } | null;
  expiresAtMs: number;
}

/**
 * Quản lý các phiên tải lên theo mảnh (Chunked Upload Sessions).
 * Ghi nối tiếp từng mảnh xuống đĩa qua `storage.appendChunk` và cộng dồn mã băm SHA-256 dạng streaming
 * để RAM luôn giữ ở mức vài MB ngay cả khi tải tệp 2GB–5GB+.
 */
export class ChunkedUploadSessionManager {
  private readonly sessions = new Map<string, ActiveChunkedUploadSession>();

  public async cleanupExpired(storage: BaseStorageProvider, nowMs = Date.now()): Promise<void> {
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAtMs <= nowMs) {
        this.sessions.delete(id);
        if (typeof storage.abortChunkedUpload === 'function') {
          await storage.abortChunkedUpload(session.tempStorageKey).catch(() => undefined);
        }
      }
    }
  }

  public createSession(params: {
    storagePrefix: string;
    input: InitChunkedUploadRequest;
    originalName: string;
    displayName: string;
    extension: string;
    mimeType: string;
    category: FileCategoryCode;
    folderId: number | null;
    folderName: string | null;
    organizationUnitId: number | null;
    actorUserId: number | null;
  }): ActiveChunkedUploadSession {
    const uploadId = randomUUID();
    const chunkSizeBytes =
      params.input.sizeBytes >= LARGE_FILE_CHUNK_THRESHOLD_BYTES
        ? LARGE_FILE_UPLOAD_CHUNK_SIZE_BYTES
        : DEFAULT_UPLOAD_CHUNK_SIZE_BYTES;
    const totalChunks = Math.max(1, Math.ceil(params.input.sizeBytes / chunkSizeBytes));
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const tempStorageKey = `${params.storagePrefix}/${yyyy}/${mm}/${dd}/.tmp-chunk-${uploadId}.${params.extension}`;

    const session: ActiveChunkedUploadSession = {
      uploadId,
      tempStorageKey,
      originalName: params.originalName,
      displayName: params.displayName,
      extension: params.extension,
      mimeType: params.mimeType,
      category: params.category,
      totalBytes: params.input.sizeBytes,
      chunkSizeBytes,
      totalChunks,
      folderId: params.folderId,
      folderName: params.folderName,
      visibility: params.input.visibility,
      organizationUnitId: params.organizationUnitId,
      actorUserId: params.actorUserId,
      moduleName: params.input.moduleName,
      stageForScan: params.input.stageForScan,
      quarantineOnThreat: params.input.quarantineOnThreat,
      rejectDuplicate: params.input.rejectDuplicate,
      reuseDuplicate: params.input.reuseDuplicate,
      metadata: params.input.metadata,
      sha256Hash: createHash('sha256'),
      fallbackBuffers: [],
      expectedChunkIndex: 0,
      receivedBytes: 0,
      malwareScan: {
        clean: true,
        threatName: null,
        scannedAt: now.toISOString(),
      },
      imageDimensions: null,
      expiresAtMs: now.getTime() + DEFAULT_CHUNK_SESSION_TTL_MS,
    };

    this.sessions.set(uploadId, session);
    return session;
  }

  public getActiveSession(
    uploadId: string,
    actorUserId?: number | null,
  ): ActiveChunkedUploadSession {
    const session = this.sessions.get(uploadId);
    if (!session || session.expiresAtMs <= Date.now()) {
      this.sessions.delete(uploadId);
      throw new NotFoundAppException('files.error.uploadSessionNotFound');
    }
    if (
      session.actorUserId !== null &&
      actorUserId !== undefined &&
      actorUserId !== null &&
      session.actorUserId !== actorUserId
    ) {
      throw new NotFoundAppException('files.error.uploadSessionNotFound');
    }
    return session;
  }

  public decodeChunkPayload(
    input: { contentBase64?: string | undefined; chunkBuffer?: Buffer | undefined },
    fileName: string,
  ): Buffer {
    const buf = Buffer.isBuffer(input.chunkBuffer)
      ? input.chunkBuffer
      : decodeUploadBuffer({ fileName, contentBase64: input.contentBase64 });
    if (buf.length === 0) {
      throw new BadRequestAppException('files.error.emptyUpload');
    }
    if (buf.length > DEFAULT_MAX_UPLOAD_CHUNK_SIZE_BYTES) {
      throw new BadRequestAppException('files.error.chunkTooLarge', [], {
        maxChunkBytes: DEFAULT_MAX_UPLOAD_CHUNK_SIZE_BYTES,
      });
    }
    return buf;
  }

  public async appendChunkToStorage(
    session: ActiveChunkedUploadSession,
    chunkIndex: number,
    chunkBuffer: Buffer,
    storage: BaseStorageProvider,
  ): Promise<number> {
    // Hỗ trợ Idempotent Retry: nếu trình duyệt gửi lại đúng mảnh vừa ghi thành công trước đó do đứt mạng tạm thời
    if (session.expectedChunkIndex > 0 && chunkIndex === session.expectedChunkIndex - 1) {
      session.expiresAtMs = Date.now() + DEFAULT_CHUNK_SESSION_TTL_MS;
      return session.receivedBytes;
    }

    if (chunkIndex !== session.expectedChunkIndex) {
      throw new BadRequestAppException('files.error.invalidChunkIndex', [], {
        expectedChunkIndex: session.expectedChunkIndex,
        receivedChunkIndex: chunkIndex,
      });
    }

    const nextReceivedBytes = session.receivedBytes + chunkBuffer.length;
    if (nextReceivedBytes > session.totalBytes) {
      await this.abortSession(session.uploadId, storage);
      throw new BadRequestAppException('files.error.chunkSizeExceedsDeclaredTotal', [], {
        declaredBytes: session.totalBytes,
        receivedBytes: nextReceivedBytes,
      });
    }

    session.sha256Hash.update(chunkBuffer);

    if (typeof storage.appendChunk === 'function') {
      await storage.appendChunk(session.tempStorageKey, chunkBuffer);
    } else {
      session.fallbackBuffers.push(chunkBuffer);
    }

    session.expectedChunkIndex += 1;
    session.receivedBytes = nextReceivedBytes;
    session.expiresAtMs = Date.now() + DEFAULT_CHUNK_SESSION_TTL_MS;

    return session.receivedBytes;
  }

  public async finalizeToStorageKey(
    session: ActiveChunkedUploadSession,
    targetStorageKey: string,
    storage: BaseStorageProvider,
  ): Promise<void> {
    this.sessions.delete(session.uploadId);
    if (
      typeof storage.finalizeChunkedUpload === 'function' &&
      session.fallbackBuffers.length === 0
    ) {
      await storage.finalizeChunkedUpload(
        session.tempStorageKey,
        targetStorageKey,
        session.mimeType,
      );
      return;
    }
    const combined = Buffer.concat(session.fallbackBuffers);
    session.fallbackBuffers.length = 0;
    await storage.upload(targetStorageKey, combined, session.mimeType);
  }

  public async abortSession(uploadId: string, storage: BaseStorageProvider): Promise<void> {
    const session = this.sessions.get(uploadId);
    if (!session) return;
    this.sessions.delete(uploadId);
    session.fallbackBuffers.length = 0;
    if (typeof storage.abortChunkedUpload === 'function') {
      await storage.abortChunkedUpload(session.tempStorageKey).catch(() => undefined);
    }
  }
}
