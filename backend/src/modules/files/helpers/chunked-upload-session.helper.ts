import { createHash, randomUUID } from 'node:crypto';
import type { BaseCacheProvider } from '@packages/cache/index.js';
import { BadRequestAppException, NotFoundAppException } from '@packages/kernel/index.js';
import type { StorageContract } from '@packages/storage/index.js';
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
  expectedChunkIndex: number;
  receivedBytes: number;
  malwareScan: MalwareScanResult;
  imageDimensions: { readonly width: number; readonly height: number } | null;
  expiresAtMs: number;
}

const CHUNK_SESSION_CACHE_PREFIX = 'files:chunk-session:';

function partStorageKey(tempPrefix: string, chunkIndex: number): string {
  return `${tempPrefix}.part.${String(chunkIndex).padStart(6, '0')}`;
}

/**
 * Quản lý các phiên tải lên theo mảnh (Chunked Upload Sessions) hoàn toàn **Stateless**:
 * - Metadata phiên (100% JSON-serializable) được lưu trên Shared Cache (`BaseCacheProvider` / Redis) với TTL,
 *   cho phép mỗi chunk đi qua bất kỳ API instance nào mà không cần Sticky Session.
 * - Các mảnh dữ liệu được đẩy thẳng xuống Object Storage (`putChunkPart` / `appendChunk`) và tính SHA-256
 *   streaming lúc `finalizeChunkedParts`.
 * - Hỗ trợ fallback `Map` cục bộ khi chạy unit test cô lập không truyền `cacheProvider`.
 */
export class ChunkedUploadSessionManager {
  private readonly fallbackSessions = new Map<string, ActiveChunkedUploadSession>();

  constructor(private readonly cacheProvider?: BaseCacheProvider | null) {}

  private cacheKey(uploadId: string): string {
    return `${CHUNK_SESSION_CACHE_PREFIX}${uploadId}`;
  }

  private getSessionTtlSec(): number {
    return Math.max(60, Math.ceil(DEFAULT_CHUNK_SESSION_TTL_MS / 1000));
  }

  private async readSession(uploadId: string): Promise<ActiveChunkedUploadSession | null> {
    if (this.cacheProvider) {
      const cached = await this.cacheProvider
        .get<ActiveChunkedUploadSession>(this.cacheKey(uploadId))
        .catch(() => null);
      if (cached) return cached;
    }
    return this.fallbackSessions.get(uploadId) ?? null;
  }

  public async saveSession(session: ActiveChunkedUploadSession): Promise<void> {
    if (this.cacheProvider) {
      await this.cacheProvider.set(
        this.cacheKey(session.uploadId),
        session,
        this.getSessionTtlSec(),
      );
      return;
    }
    this.fallbackSessions.set(session.uploadId, session);
  }

  private async deleteSession(uploadId: string): Promise<void> {
    this.fallbackSessions.delete(uploadId);
    if (this.cacheProvider) {
      await this.cacheProvider.delete(this.cacheKey(uploadId)).catch(() => undefined);
    }
  }

  public async cleanupExpired(storage: StorageContract, nowMs = Date.now()): Promise<void> {
    for (const [id, session] of this.fallbackSessions.entries()) {
      if (session.expiresAtMs <= nowMs) {
        this.fallbackSessions.delete(id);
        await this.cleanupStorageArtifacts(session, storage);
      }
    }
  }

  public async createSession(params: {
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
  }): Promise<ActiveChunkedUploadSession> {
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

    await this.saveSession(session);
    return session;
  }

  public async getActiveSession(
    uploadId: string,
    actorUserId?: number | null,
  ): Promise<ActiveChunkedUploadSession> {
    const session = await this.readSession(uploadId);
    if (!session || session.expiresAtMs <= Date.now()) {
      await this.deleteSession(uploadId);
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
    storage: StorageContract,
  ): Promise<number> {
    // Hỗ trợ Idempotent Retry: nếu trình duyệt gửi lại đúng mảnh vừa ghi thành công trước đó do đứt mạng tạm thời
    if (session.expectedChunkIndex > 0 && chunkIndex === session.expectedChunkIndex - 1) {
      session.expiresAtMs = Date.now() + DEFAULT_CHUNK_SESSION_TTL_MS;
      await this.saveSession(session);
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
      await this.abortSession(session.uploadId, storage, session);
      throw new BadRequestAppException('files.error.chunkSizeExceedsDeclaredTotal', [], {
        declaredBytes: session.totalBytes,
        receivedBytes: nextReceivedBytes,
      });
    }

    if (typeof storage.putChunkPart === 'function') {
      await storage.putChunkPart(session.tempStorageKey, chunkIndex, chunkBuffer);
    } else if (typeof storage.appendChunk === 'function') {
      await storage.appendChunk(session.tempStorageKey, chunkBuffer);
    } else {
      await storage.upload(
        partStorageKey(session.tempStorageKey, chunkIndex),
        chunkBuffer,
        'application/octet-stream',
      );
    }

    session.expectedChunkIndex += 1;
    session.receivedBytes = nextReceivedBytes;
    session.expiresAtMs = Date.now() + DEFAULT_CHUNK_SESSION_TTL_MS;
    await this.saveSession(session);

    return session.receivedBytes;
  }

  public async finalizeToStorageKey(
    session: ActiveChunkedUploadSession,
    targetStorageKey: string,
    storage: StorageContract,
  ): Promise<{ checksumSha256: string; sizeBytes: number }> {
    await this.deleteSession(session.uploadId);

    if (typeof storage.finalizeChunkedParts === 'function') {
      return storage.finalizeChunkedParts(
        session.tempStorageKey,
        session.totalChunks,
        targetStorageKey,
        session.mimeType,
      );
    }

    if (typeof storage.finalizeChunkedUpload === 'function') {
      await storage.finalizeChunkedUpload(
        session.tempStorageKey,
        targetStorageKey,
        session.mimeType,
      );
      return this.computeStorageObjectHash(storage, targetStorageKey);
    }

    const buffers: Buffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const partKey = partStorageKey(session.tempStorageKey, i);
      buffers.push(await storage.download(partKey));
    }
    const combined = Buffer.concat(buffers);
    const checksumSha256 = createHash('sha256').update(combined).digest('hex');
    await storage.upload(targetStorageKey, combined, session.mimeType);
    await Promise.all(
      Array.from({ length: session.totalChunks }, (_, idx) =>
        storage.delete(partStorageKey(session.tempStorageKey, idx)).catch(() => undefined),
      ),
    );
    return { checksumSha256, sizeBytes: combined.length };
  }

  public async abortSession(
    uploadId: string,
    storage: StorageContract,
    knownSession?: ActiveChunkedUploadSession,
  ): Promise<void> {
    const session = knownSession ?? (await this.readSession(uploadId));
    await this.deleteSession(uploadId);
    if (!session) return;
    await this.cleanupStorageArtifacts(session, storage);
  }

  private async cleanupStorageArtifacts(
    session: ActiveChunkedUploadSession,
    storage: StorageContract,
  ): Promise<void> {
    if (typeof storage.abortChunkedParts === 'function') {
      await storage
        .abortChunkedParts(session.tempStorageKey, session.totalChunks)
        .catch(() => undefined);
    } else {
      await Promise.all(
        Array.from({ length: session.totalChunks }, (_, idx) =>
          storage.delete(partStorageKey(session.tempStorageKey, idx)).catch(() => undefined),
        ),
      );
    }
    if (typeof storage.abortChunkedUpload === 'function') {
      await storage.abortChunkedUpload(session.tempStorageKey).catch(() => undefined);
    }
  }

  private async computeStorageObjectHash(
    storage: StorageContract,
    storageKey: string,
  ): Promise<{ checksumSha256: string; sizeBytes: number }> {
    const hash = createHash('sha256');
    let sizeBytes = 0;
    if (typeof storage.stream === 'function') {
      const streamRes = await storage.stream(storageKey);
      for await (const chunk of streamRes.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        sizeBytes += buf.length;
      }
      return { checksumSha256: hash.digest('hex'), sizeBytes };
    }
    const buf = await storage.download(storageKey);
    hash.update(buf);
    return { checksumSha256: hash.digest('hex'), sizeBytes: buf.length };
  }
}
