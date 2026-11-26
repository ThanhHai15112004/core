import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BACKUP_DOMAIN_EVENTS,
  DomainEventBusService,
  defaultDomainEventBus,
} from '@packages/kernel/index.js';
import { BaseStorageProvider, StorageMonitoringService } from '@packages/storage/index.js';
import { sha256Hex } from '../helpers/backup-crypto.helper.js';
import type { StorageVersioningStatusView } from '../types/backup-ops.types.js';

export interface StorageSnapshotResult {
  readonly payload: Buffer;
  readonly objectCount: number;
  readonly totalPlainBytes: number;
  readonly truncated: boolean;
}

interface StorageSnapshotArchive {
  readonly format: 'core-storage-snapshot-v1';
  readonly driver: string;
  readonly createdAt: string;
  readonly entries: Array<{
    readonly key: string;
    readonly size: number;
    readonly sha256: string;
    readonly contentBase64: string;
  }>;
}

/**
 * Dịch vụ sao lưu & bảo vệ Object Storage:
 * - Kiểm tra và bật Bucket Versioning cho S3/MinIO (chống xóa nhầm / ghi đè file người dùng)
 * - Tạo & kiểm tra toàn vẹn snapshot archive mã hóa cho các object ngoài prefix `backups/`
 */
@Injectable()
export class StorageBackupService {
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly config: CoreConfigService,
    private readonly storage: BaseStorageProvider,
    @Optional() private readonly storageMonitoring?: StorageMonitoringService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async getVersioningStatus(): Promise<StorageVersioningStatusView> {
    return this.storage.getBucketVersioningStatus();
  }

  public async enableBucketVersioning(): Promise<StorageVersioningStatusView> {
    const result = await this.storage.enableBucketVersioning();
    if (result.supported) {
      await this.eventBus
        .publish({
          type: BACKUP_DOMAIN_EVENTS.STORAGE_VERSIONING_UPDATED,
          dotName: BACKUP_DOMAIN_EVENTS.STORAGE_VERSIONING_UPDATED,
          sourceModule: 'backup-ops',
          aggregateType: 'StorageBucket',
          aggregateId: result.bucket ?? result.driver,
          payload: {
            driver: result.driver,
            bucket: result.bucket,
            status: result.status,
          },
        })
        .catch(() => undefined);
    }
    return result;
  }

  /** Quét object người dùng (loại trừ prefix backups/ và .healthcheck/) để đóng gói snapshot. */
  public async createStorageSnapshot(storagePrefix: string): Promise<StorageSnapshotResult> {
    const prefixNorm = storagePrefix.replace(/^\/+|\/+$/g, '');
    const maxBytes = this.config.backup.maxStorageSnapshotBytes;
    const scanned = this.storageMonitoring
      ? await this.storageMonitoring.provider.scan(5000)
      : { objects: [], total: 0, truncated: false };

    const entries: StorageSnapshotArchive['entries'] = [];
    let totalPlainBytes = 0;
    let truncated = scanned.truncated;

    for (const obj of scanned.objects) {
      if (
        obj.key.startsWith(`${prefixNorm}/`) ||
        obj.key === prefixNorm ||
        obj.key.startsWith('.healthcheck/')
      ) {
        continue;
      }
      if (totalPlainBytes + obj.size > maxBytes) {
        truncated = true;
        break;
      }
      const buf = await this.storage.download(obj.key);
      totalPlainBytes += buf.length;
      entries.push({
        key: obj.key,
        size: buf.length,
        sha256: sha256Hex(buf),
        contentBase64: buf.toString('base64'),
      });
    }

    const archive: StorageSnapshotArchive = {
      format: 'core-storage-snapshot-v1',
      driver: this.storage.driverName,
      createdAt: new Date().toISOString(),
      entries,
    };

    return {
      payload: Buffer.from(JSON.stringify(archive), 'utf8'),
      objectCount: entries.length,
      totalPlainBytes,
      truncated,
    };
  }

  /** Kiểm tra toàn vẹn giải mã & SHA-256 từng object trong snapshot storage. */
  public verifyStorageSnapshot(payload: Buffer): {
    passed: boolean;
    objectCount: number;
    totalBytes: number;
  } {
    const parsed = JSON.parse(payload.toString('utf8')) as Partial<StorageSnapshotArchive>;
    if (parsed.format !== 'core-storage-snapshot-v1' || !Array.isArray(parsed.entries)) {
      throw new Error('Invalid storage snapshot archive format');
    }

    let totalBytes = 0;
    for (const entry of parsed.entries) {
      const buf = Buffer.from(entry.contentBase64, 'base64');
      if (buf.length !== entry.size || sha256Hex(buf) !== entry.sha256) {
        throw new Error(`Corrupted storage snapshot entry: ${entry.key}`);
      }
      totalBytes += buf.length;
    }

    return {
      passed: true,
      objectCount: parsed.entries.length,
      totalBytes,
    };
  }

  /** Khôi phục các object từ snapshot storage lên storage provider hiện hành. */
  public async restoreStorageSnapshot(payload: Buffer): Promise<{ restoredCount: number }> {
    const parsed = JSON.parse(payload.toString('utf8')) as Partial<StorageSnapshotArchive>;
    if (parsed.format !== 'core-storage-snapshot-v1' || !Array.isArray(parsed.entries)) {
      throw new Error('Invalid storage snapshot archive format');
    }
    let restoredCount = 0;
    for (const entry of parsed.entries) {
      const buf = Buffer.from(entry.contentBase64, 'base64');
      if (sha256Hex(buf) !== entry.sha256) {
        throw new Error(`Checksum mismatch while restoring object: ${entry.key}`);
      }
      await this.storage.upload(entry.key, buf);
      restoredCount++;
    }
    return { restoredCount };
  }
}
