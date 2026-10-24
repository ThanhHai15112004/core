import path from 'node:path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  SettingRegistryService,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { mimeOf } from '@packages/storage/index.js';
import {
  FILE_CATEGORY,
  FILE_VISIBILITY,
  type FileCategoryCode,
  type FileCategoryName,
  type FileVisibilityCode,
  getFileCategoryName,
} from '../contracts/index.js';
import {
  DEFAULT_ALLOWED_EXTENSIONS,
  DEFAULT_CATEGORY_ALLOWED_EXTENSIONS,
  DEFAULT_CATEGORY_MAX_SIZE_MB,
  DEFAULT_IMAGE_MAX_HEIGHT,
  DEFAULT_IMAGE_MAX_WIDTH,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_MAX_BATCH_FILES,
  DEFAULT_MAX_UPLOAD_MB,
  DEFAULT_MODULE_MAX_SIZE_MB,
  DEFAULT_STORAGE_KEY_PREFIX,
  DEFAULT_STORAGE_QUOTA_MB,
  DEFAULT_TEMP_LINK_MAX_TTL_SEC,
  DEFAULT_TEMP_LINK_TTL_SEC,
  DEFAULT_THUMBNAIL_MAX_DIM,
  DEFAULT_TRASH_RETENTION_DAYS,
  DEFAULT_UNUSED_RETENTION_DAYS,
  DEFAULT_USER_STORAGE_QUOTA_MB,
} from '../enum/files.enum.js';
import {
  assertMagicBytesMatch,
  assertMimeTypeCompatibleWithExtension,
  decodeUploadBuffer,
  scanBufferForMalware,
} from '../helpers/file-security-scanner.helper.js';
import {
  extractImageDimensionsFromBuffer,
  processAndOptimizeImageBuffer,
} from '../helpers/image-processor.helper.js';
import type {
  InitChunkedUploadRequest,
  UploadSingleFileRequest,
} from '../requests/files.requests.js';
import type {
  ImageProcessingOptions,
  ImageProcessingResult,
  MalwareScanResult,
  ValidatedUploadPayload,
} from '../types/files.types.js';

export interface ValidatedChunkedInitPayload {
  readonly originalName: string;
  readonly displayName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly category: FileCategoryCode;
  readonly categoryName: FileCategoryName;
  readonly sizeBytes: number;
}

export type { ImageProcessingResult, MalwareScanResult, ValidatedUploadPayload };

@Injectable()
export class FileValidationService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    @Optional()
    @Inject(SettingRegistryService)
    settingRegistry?: SettingRegistryService | null,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  /** Đọc cấu hình giới hạn dung lượng tối đa chung (MB) theo đơn vị */
  public getMaxUploadSizeMb(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.upload.max_size_mb',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_MAX_UPLOAD_MB,
    );
    return val > 0 ? val : DEFAULT_MAX_UPLOAD_MB;
  }

  /** Đọc danh sách phần mở rộng tệp cho phép từ cấu hình động */
  public getAllowedExtensions(organizationUnitId?: number | null): string[] {
    const list = this.settingRegistry.getJson<string[]>(
      'file.upload.allowed_extensions',
      organizationUnitId ? { organizationUnitId } : undefined,
      [...DEFAULT_ALLOWED_EXTENSIONS],
    );
    if (!Array.isArray(list) || list.length === 0) {
      return [...DEFAULT_ALLOWED_EXTENSIONS];
    }
    return list.map((ext) => String(ext).trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
  }

  /**
   * Đọc cấu hình định dạng đuôi tệp cho phép theo từng loại file (`IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`...)
   * (Mục 6.3.1: Cấu hình loại file nào chấp nhận những định dạng nào).
   */
  public getCategoryAllowedExtensions(
    organizationUnitId?: number | null,
  ): Record<string, string[]> {
    const raw = this.settingRegistry.getJson<Record<string, unknown>>(
      'file.upload.category_allowed_extensions',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_CATEGORY_ALLOWED_EXTENSIONS,
    );
    const result: Record<string, string[]> = {};
    for (const [key, fallbackList] of Object.entries(DEFAULT_CATEGORY_ALLOWED_EXTENSIONS)) {
      const candidate = raw && typeof raw === 'object' ? raw[key] : undefined;
      if (Array.isArray(candidate) && candidate.length > 0) {
        result[key] = candidate
          .map((ext) => String(ext).trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean);
      } else {
        result[key] = [...fallbackList];
      }
    }
    return result;
  }

  /** Đọc cấu hình giới hạn dung lượng tối đa (MB) theo từng loại file (Mục 6.3.2) */
  public getCategoryMaxSizeMap(organizationUnitId?: number | null): Record<string, number> {
    const raw = this.settingRegistry.getJson<Record<string, unknown>>(
      'file.upload.category_max_size_mb',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_CATEGORY_MAX_SIZE_MB,
    );
    const result: Record<string, number> = { ...DEFAULT_CATEGORY_MAX_SIZE_MB };
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          result[k.trim().toUpperCase()] = num;
        }
      }
    }
    return result;
  }

  /** Đọc cấu hình giới hạn dung lượng tối đa (MB) theo từng module nghiệp vụ (Mục 6.3.2) */
  public getModuleMaxSizeMap(organizationUnitId?: number | null): Record<string, number> {
    const raw = this.settingRegistry.getJson<Record<string, unknown>>(
      'file.upload.module_max_size_mb',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_MODULE_MAX_SIZE_MB,
    );
    const result: Record<string, number> = { ...DEFAULT_MODULE_MAX_SIZE_MB };
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          result[k.trim().toLowerCase()] = num;
        }
      }
    }
    return result;
  }

  /** Đọc số ngày chờ trong thùng rác trước khi xóa vĩnh viễn */
  public getTrashRetentionDays(organizationUnitId?: number | null): number {
    const days = this.settingRegistry.getNumber(
      'file.trash.retention_days',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_TRASH_RETENTION_DAYS,
    );
    return days > 0 ? days : DEFAULT_TRASH_RETENTION_DAYS;
  }

  /** Đọc thời gian an toàn (ngày) trước khi dọn file không còn sử dụng (`usageCount = 0` — Mục 6.3.7) */
  public getUnusedRetentionDays(organizationUnitId?: number | null): number {
    const days = this.settingRegistry.getNumber(
      'file.cleanup.unused_retention_days',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_UNUSED_RETENTION_DAYS,
    );
    return days > 0 ? days : DEFAULT_UNUSED_RETENTION_DAYS;
  }

  /** Đọc số lượng tệp tối đa cho phép trong một lần tải lên hàng loạt (Batch Upload) */
  public getMaxBatchFiles(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.upload.max_batch_files',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_MAX_BATCH_FILES,
    );
    return val > 0 ? val : DEFAULT_MAX_BATCH_FILES;
  }

  /** Đọc cấu hình bật/tắt kiểm tra chữ ký nhị phân (Magic Bytes) khi tải lên */
  public shouldVerifyMagicBytes(organizationUnitId?: number | null): boolean {
    return this.settingRegistry.getBoolean(
      'file.upload.verify_magic_bytes',
      organizationUnitId ? { organizationUnitId } : undefined,
      true,
    );
  }

  /** Đọc cấu hình bật/tắt quét mã độc (Malware / Virus / Script) khi tải lên (Mục 6.3.3) */
  public isMalwareScanEnabled(organizationUnitId?: number | null): boolean {
    return this.settingRegistry.getBoolean(
      'file.security.malware_scan_enabled',
      organizationUnitId ? { organizationUnitId } : undefined,
      true,
    );
  }

  /** Đọc cấu hình đưa file vào khu vực chờ (`PENDING_SCAN`) trước khi công bố (Mục 6.3.3) */
  public shouldStageBeforePublish(organizationUnitId?: number | null): boolean {
    return this.settingRegistry.getBoolean(
      'file.security.stage_before_publish',
      organizationUnitId ? { organizationUnitId } : undefined,
      false,
    );
  }

  /** Đọc chính sách xử lý khi phát hiện file trùng lặp mã băm SHA-256 (`ALLOW` | `REJECT` | `REUSE` — Mục 6.3.4) */
  public getDuplicatePolicy(organizationUnitId?: number | null): 'ALLOW' | 'REJECT' | 'REUSE' {
    const raw = this.settingRegistry
      .getString(
        'file.security.duplicate_policy',
        organizationUnitId ? { organizationUnitId } : undefined,
        'ALLOW',
      )
      .trim()
      .toUpperCase();
    if (raw === 'REJECT' || raw === 'REUSE') {
      return raw;
    }
    return 'ALLOW';
  }

  /** Đọc cấu hình bật/tắt tạo ảnh thu nhỏ (Thumbnail — Mục 6.3.5) */
  public isThumbnailEnabled(organizationUnitId?: number | null): boolean {
    return this.settingRegistry.getBoolean(
      'file.image.thumbnail_enabled',
      organizationUnitId ? { organizationUnitId } : undefined,
      true,
    );
  }

  /** Đọc kích thước cạnh tối đa (px) của ảnh Thumbnail (Mục 6.3.5) */
  public getThumbnailMaxDim(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.image.thumbnail_max_dim',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_THUMBNAIL_MAX_DIM,
    );
    return val >= 32 ? val : DEFAULT_THUMBNAIL_MAX_DIM;
  }

  /** Đọc cấu hình bật/tắt tự động resize & tối ưu dung lượng ảnh (Mục 6.3.6) */
  public isOptimizeImageEnabled(organizationUnitId?: number | null): boolean {
    return this.settingRegistry.getBoolean(
      'file.image.optimize_enabled',
      organizationUnitId ? { organizationUnitId } : undefined,
      true,
    );
  }

  /** Đọc chiều rộng tối đa (px) khi resize ảnh (Mục 6.3.6) */
  public getImageMaxWidth(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.image.max_width',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_IMAGE_MAX_WIDTH,
    );
    return val >= 64 ? val : DEFAULT_IMAGE_MAX_WIDTH;
  }

  /** Đọc chiều cao tối đa (px) khi resize ảnh (Mục 6.3.6) */
  public getImageMaxHeight(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.image.max_height',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_IMAGE_MAX_HEIGHT,
    );
    return val >= 64 ? val : DEFAULT_IMAGE_MAX_HEIGHT;
  }

  /** Đọc chất lượng mục tiêu (%) khi tối ưu ảnh (Mục 6.3.6) */
  public getImageQuality(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.image.quality',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_IMAGE_QUALITY,
    );
    return val >= 10 && val <= 100 ? val : DEFAULT_IMAGE_QUALITY;
  }

  /** Đọc mức hiển thị mặc định khi tải tệp lên */
  public getDefaultVisibility(organizationUnitId?: number | null): FileVisibilityCode {
    const val = this.settingRegistry.getNumber(
      'file.upload.default_visibility',
      organizationUnitId ? { organizationUnitId } : undefined,
      FILE_VISIBILITY.PRIVATE,
    );
    if (
      val === FILE_VISIBILITY.PRIVATE ||
      val === FILE_VISIBILITY.INTERNAL ||
      val === FILE_VISIBILITY.PUBLIC
    ) {
      return val;
    }
    return FILE_VISIBILITY.PRIVATE;
  }

  /** Đọc hạn mức tổng dung lượng lưu trữ tối đa (MB) của hệ thống/đơn vị (0 = không giới hạn) */
  public getStorageQuotaMb(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.storage.quota_mb',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_STORAGE_QUOTA_MB,
    );
    return val >= 0 ? val : DEFAULT_STORAGE_QUOTA_MB;
  }

  /** Đọc hạn mức dung lượng lưu trữ tối đa (MB) theo từng người dùng (0 = không giới hạn) */
  public getUserStorageQuotaMb(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.storage.user_quota_mb',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_USER_STORAGE_QUOTA_MB,
    );
    return val >= 0 ? val : DEFAULT_USER_STORAGE_QUOTA_MB;
  }

  /** Đọc thời gian hiệu lực mặc định (giây) của đường dẫn tải file tạm thời */
  public getTempLinkDefaultTtlSec(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.download.temp_link_default_ttl_sec',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_TEMP_LINK_TTL_SEC,
    );
    return val > 0 ? val : DEFAULT_TEMP_LINK_TTL_SEC;
  }

  /** Đọc thời gian hiệu lực tối đa (giây) cho phép khi tạo đường dẫn tải file tạm thời */
  public getTempLinkMaxTtlSec(organizationUnitId?: number | null): number {
    const val = this.settingRegistry.getNumber(
      'file.download.temp_link_max_ttl_sec',
      organizationUnitId ? { organizationUnitId } : undefined,
      DEFAULT_TEMP_LINK_MAX_TTL_SEC,
    );
    return val > 0 ? val : DEFAULT_TEMP_LINK_MAX_TTL_SEC;
  }

  /** Đọc cấu hình tự động đối soát sự tồn tại của file vật lý khi truy vấn danh sách */
  public shouldReconcileOnList(): boolean {
    return this.settingRegistry.getBoolean('file.storage.reconcile_on_list', undefined, true);
  }

  /** Đọc tiền tố thư mục lưu trữ vật lý trên Storage */
  public getStorageKeyPrefix(): string {
    const raw = this.settingRegistry.getString(
      'file.storage.key_prefix',
      undefined,
      DEFAULT_STORAGE_KEY_PREFIX,
    );
    const cleaned = raw.trim().replace(/^\/+|\/+$/g, '');
    return cleaned || DEFAULT_STORAGE_KEY_PREFIX;
  }

  /**
   * Đọc domain CDN hoặc URL công khai gốc (`file.storage.cdn_base_url` — Mục 6.4.7).
   * Chỉ áp dụng cho các tệp được phép công khai (`visibility = PUBLIC`).
   */
  public getCdnBaseUrl(organizationUnitId?: number | null): string | null {
    const raw = this.settingRegistry
      .getString(
        'file.storage.cdn_base_url',
        organizationUnitId ? { organizationUnitId } : undefined,
        '',
      )
      .trim()
      .replace(/\/+$/, '');
    return raw.length > 0 ? raw : null;
  }

  /**
   * Kiểm tra toàn diện tệp tải lên trước khi lưu vào Storage (Mục 6.1 & Mục 6.3):
   * 1. Giải mã nội dung và kiểm tra rỗng.
   * 2. Kiểm tra phần mở rộng (`extension`), đối chiếu theo danh sách chung + danh sách theo Loại file (`category_allowed_extensions`).
   * 3. Kiểm tra tính nhất quán giữa `mimeType` gửi lên với định dạng thực tế.
   * 4. Kiểm tra chữ ký tệp (Magic Bytes) và quét mã độc (Malware / EICAR / Script).
   * 5. Giới hạn dung lượng theo Module (`module_max_size_mb`), theo Loại file (`category_max_size_mb`) và giới hạn chung (`max_size_mb`).
   * 6. Tự động Resize, tối ưu dung lượng ảnh và sinh ảnh Thumbnail (nếu là ảnh).
   */
  public validateUploadInput(
    input: UploadSingleFileRequest,
    organizationUnitId?: number | null,
  ): ValidatedUploadPayload {
    const originalName = path.basename(input.fileName.trim());
    const extRaw = path.extname(originalName).replace(/^\./, '').toLowerCase();
    if (!extRaw) {
      throw new BadRequestAppException('files.error.extensionNotAllowed', [], { ext: 'none' });
    }

    const allowedExtensions = this.getAllowedExtensions(organizationUnitId);
    const categoryAllowedMap = this.getCategoryAllowedExtensions(organizationUnitId);
    const allCategoryExts = Object.values(categoryAllowedMap).flat();
    if (!allowedExtensions.includes(extRaw) && !allCategoryExts.includes(extRaw)) {
      throw new BadRequestAppException('files.error.extensionNotAllowed', [], { ext: extRaw });
    }

    const rawBuffer = decodeUploadBuffer(input);
    if (rawBuffer.length === 0) {
      throw new BadRequestAppException('files.error.emptyUpload');
    }

    const detectedMime = mimeOf(originalName);
    const providedMime = input.mimeType?.trim().toLowerCase();
    if (providedMime && providedMime !== 'application/octet-stream') {
      assertMimeTypeCompatibleWithExtension(providedMime, extRaw, detectedMime);
    }

    const mimeType =
      detectedMime && detectedMime !== 'application/octet-stream'
        ? detectedMime
        : providedMime || 'application/octet-stream';

    const category = this.resolveCategory(extRaw, mimeType, organizationUnitId);
    const categoryName = getFileCategoryName(category);

    // Nếu người gọi chỉ định expectedCategory (ví dụ: chỉ cho phép tải AUDIO hoặc IMAGE)
    if (input.expectedCategory !== undefined && input.expectedCategory !== category) {
      const expectedCategoryName = getFileCategoryName(input.expectedCategory);
      throw new BadRequestAppException('files.error.categoryExtensionNotAllowed', [], {
        ext: extRaw,
        category: expectedCategoryName,
      });
    }

    // Kiểm tra định dạng ext có được phép trong nhóm category hiện tại hay không
    const allowedForCat = categoryAllowedMap[categoryName];
    if (
      Array.isArray(allowedForCat) &&
      allowedForCat.length > 0 &&
      !allowedForCat.includes(extRaw) &&
      !allowedExtensions.includes(extRaw)
    ) {
      throw new BadRequestAppException('files.error.categoryExtensionNotAllowed', [], {
        ext: extRaw,
        category: categoryName,
      });
    }

    if (this.shouldVerifyMagicBytes(organizationUnitId)) {
      assertMagicBytesMatch(rawBuffer, extRaw);
    }

    // Quét mã độc (Mục 6.3.3)
    const malwareScan = this.scanForMalware(rawBuffer, extRaw, organizationUnitId);
    if (!malwareScan.clean && !input.quarantineOnThreat && !input.stageForScan) {
      throw new BadRequestAppException('files.error.malwareDetected', [], {
        threatName: malwareScan.threatName ?? 'SUSPICIOUS_PAYLOAD',
      });
    }

    // Xử lý Resize, tối ưu ảnh & tạo Thumbnail (Mục 6.3.5 & 6.3.6)
    const shouldOptimize =
      category === FILE_CATEGORY.IMAGE &&
      (input.optimizeImage ?? this.isOptimizeImageEnabled(organizationUnitId));
    const shouldThumb =
      category === FILE_CATEGORY.IMAGE &&
      (input.generateThumbnail ?? this.isThumbnailEnabled(organizationUnitId));

    const imageProcessed =
      category === FILE_CATEGORY.IMAGE
        ? this.processAndOptimizeImage(rawBuffer, extRaw, mimeType, {
            optimize: shouldOptimize,
            generateThumbnail: shouldThumb,
            maxWidth: input.maxWidth ?? this.getImageMaxWidth(organizationUnitId),
            maxHeight: input.maxHeight ?? this.getImageMaxHeight(organizationUnitId),
            quality: input.quality ?? this.getImageQuality(organizationUnitId),
            thumbnailMaxDim: this.getThumbnailMaxDim(organizationUnitId),
          })
        : null;

    const finalBuffer = imageProcessed ? imageProcessed.buffer : rawBuffer;

    // Kiểm tra giới hạn dung lượng theo Module, theo Loại file và giới hạn chung (Mục 6.3.2)
    this.assertSizeWithinLimits(
      finalBuffer.length,
      categoryName,
      input.moduleName,
      organizationUnitId,
    );

    const displayName = input.displayName?.trim() || originalName;

    return {
      originalName,
      displayName,
      extension: extRaw,
      mimeType,
      category,
      buffer: finalBuffer,
      sizeBytes: finalBuffer.length,
      originalSizeBytes: rawBuffer.length,
      optimizedSavedBytes: imageProcessed ? imageProcessed.savedBytes : 0,
      imageDimensions: imageProcessed ? imageProcessed.dimensions : null,
      thumbnail: imageProcessed ? imageProcessed.thumbnail : null,
      malwareScan,
    };
  }

  /**
   * Kiểm tra thông tin khởi tạo phiên tải lên theo mảnh (Chunked Upload Init):
   * Kiểm tra tên tệp, phần mở rộng, MIME type và hạn mức tổng dung lượng trước khi nhận các mảnh dữ liệu.
   */
  public validateChunkedInitInput(
    input: InitChunkedUploadRequest,
    organizationUnitId?: number | null,
  ): ValidatedChunkedInitPayload {
    const originalName = path.basename(input.fileName.trim());
    const extRaw = path.extname(originalName).replace(/^\./, '').toLowerCase();
    if (!extRaw) {
      throw new BadRequestAppException('files.error.extensionNotAllowed', [], { ext: 'none' });
    }

    const allowedExtensions = this.getAllowedExtensions(organizationUnitId);
    const categoryAllowedMap = this.getCategoryAllowedExtensions(organizationUnitId);
    const allCategoryExts = Object.values(categoryAllowedMap).flat();
    if (!allowedExtensions.includes(extRaw) && !allCategoryExts.includes(extRaw)) {
      throw new BadRequestAppException('files.error.extensionNotAllowed', [], { ext: extRaw });
    }

    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestAppException('files.error.emptyUpload');
    }

    const detectedMime = mimeOf(originalName);
    const providedMime = input.mimeType?.trim().toLowerCase();
    if (providedMime && providedMime !== 'application/octet-stream') {
      assertMimeTypeCompatibleWithExtension(providedMime, extRaw, detectedMime);
    }

    const mimeType =
      detectedMime && detectedMime !== 'application/octet-stream'
        ? detectedMime
        : providedMime || 'application/octet-stream';

    const category = this.resolveCategory(extRaw, mimeType, organizationUnitId);
    const categoryName = getFileCategoryName(category);

    if (input.expectedCategory !== undefined && input.expectedCategory !== category) {
      const expectedCategoryName = getFileCategoryName(input.expectedCategory);
      throw new BadRequestAppException('files.error.categoryExtensionNotAllowed', [], {
        ext: extRaw,
        category: expectedCategoryName,
      });
    }

    const allowedForCat = categoryAllowedMap[categoryName];
    if (
      Array.isArray(allowedForCat) &&
      allowedForCat.length > 0 &&
      !allowedForCat.includes(extRaw) &&
      !allowedExtensions.includes(extRaw)
    ) {
      throw new BadRequestAppException('files.error.categoryExtensionNotAllowed', [], {
        ext: extRaw,
        category: categoryName,
      });
    }

    this.assertSizeWithinLimits(
      input.sizeBytes,
      categoryName,
      input.moduleName,
      organizationUnitId,
    );

    const displayName = input.displayName?.trim() || originalName;

    return {
      originalName,
      displayName,
      extension: extRaw,
      mimeType,
      category,
      categoryName,
      sizeBytes: input.sizeBytes,
    };
  }

  /**
   * Kiểm tra chữ ký nhị phân (Magic Bytes) và quét mã độc ngay trên mảnh đầu tiên (chunk 0)
   * của phiên tải lên theo chunk để phát hiện sớm tệp giả mạo mà không cần chờ tải hết hàng GB.
   */
  public validateFirstChunkBuffer(
    firstChunkBuf: Buffer,
    ext: string,
    options: {
      organizationUnitId?: number | null;
      quarantineOnThreat?: boolean | undefined;
      stageForScan?: boolean | undefined;
    } = {},
  ): MalwareScanResult {
    if (firstChunkBuf.length === 0) {
      throw new BadRequestAppException('files.error.emptyUpload');
    }

    if (this.shouldVerifyMagicBytes(options.organizationUnitId)) {
      assertMagicBytesMatch(firstChunkBuf, ext);
    }

    const malwareScan = this.scanForMalware(firstChunkBuf, ext, options.organizationUnitId);
    if (!malwareScan.clean && !options.quarantineOnThreat && !options.stageForScan) {
      throw new BadRequestAppException('files.error.malwareDetected', [], {
        threatName: malwareScan.threatName ?? 'SUSPICIOUS_PAYLOAD',
      });
    }

    return malwareScan;
  }

  /** Quét mã độc trong nội dung tệp tải lên (Mục 6.3.3) */
  public scanForMalware(
    buf: Buffer,
    ext: string,
    organizationUnitId?: number | null,
  ): MalwareScanResult {
    if (!this.isMalwareScanEnabled(organizationUnitId)) {
      return { clean: true, threatName: null, scannedAt: new Date().toISOString() };
    }
    return scanBufferForMalware(buf, ext);
  }

  /** Xử lý ảnh: Đọc kích thước, Resize & tối ưu dung lượng, và tạo ảnh Thumbnail (Mục 6.3.5 & 6.3.6) */
  public processAndOptimizeImage(
    buf: Buffer,
    ext: string,
    mimeType: string,
    options: ImageProcessingOptions,
  ): ImageProcessingResult {
    return processAndOptimizeImageBuffer(buf, ext, mimeType, options);
  }

  /** Đọc kích thước chiều rộng & chiều cao (px) từ header nhị phân của ảnh */
  public extractImageDimensions(
    buf: Buffer,
    ext: string,
  ): { readonly width: number; readonly height: number } | null {
    return extractImageDimensionsFromBuffer(buf, ext);
  }

  /** Phân loại nhóm tệp tin (`files.category`) từ phần mở rộng, cấu hình `category_allowed_extensions` và MIME type */
  public resolveCategory(
    ext: string,
    mimeType: string,
    organizationUnitId?: number | null,
  ): FileCategoryCode {
    const categoryMap = this.getCategoryAllowedExtensions(organizationUnitId);
    if (categoryMap.IMAGE?.includes(ext)) return FILE_CATEGORY.IMAGE;
    if (categoryMap.VIDEO?.includes(ext)) return FILE_CATEGORY.VIDEO;
    if (categoryMap.AUDIO?.includes(ext)) return FILE_CATEGORY.AUDIO;
    if (categoryMap.SPREADSHEET?.includes(ext)) return FILE_CATEGORY.SPREADSHEET;
    if (categoryMap.DOCUMENT?.includes(ext)) return FILE_CATEGORY.DOCUMENT;
    if (categoryMap.ARCHIVE?.includes(ext)) return FILE_CATEGORY.ARCHIVE;

    const lowerMime = mimeType.toLowerCase();
    if (lowerMime.startsWith('image/')) return FILE_CATEGORY.IMAGE;
    if (lowerMime.startsWith('video/')) return FILE_CATEGORY.VIDEO;
    if (lowerMime.startsWith('audio/')) return FILE_CATEGORY.AUDIO;
    return FILE_CATEGORY.OTHER;
  }

  /**
   * Kiểm tra giới hạn dung lượng theo 3 lớp (Mục 6.3.2):
   * 1. Theo Module (`file.upload.module_max_size_mb`, nếu có `moduleName`).
   * 2. Theo Loại file (`file.upload.category_max_size_mb`).
   * 3. Theo giới hạn chung (`file.upload.max_size_mb`).
   */
  private assertSizeWithinLimits(
    sizeBytes: number,
    categoryName: FileCategoryName,
    moduleName?: string,
    organizationUnitId?: number | null,
  ): void {
    if (moduleName && moduleName.trim().length > 0) {
      const normalizedModule = moduleName.trim().toLowerCase();
      const moduleMap = this.getModuleMaxSizeMap(organizationUnitId);
      const moduleLimitMb = moduleMap[normalizedModule];
      if (typeof moduleLimitMb === 'number' && moduleLimitMb > 0) {
        const maxModuleBytes = moduleLimitMb * 1024 * 1024;
        if (sizeBytes > maxModuleBytes) {
          throw new BadRequestAppException('files.error.moduleFileTooLarge', [], {
            moduleName: normalizedModule,
            maxMb: moduleLimitMb,
          });
        }
      }
    }

    const categoryMap = this.getCategoryMaxSizeMap(organizationUnitId);
    const categoryLimitMb = categoryMap[categoryName];
    if (typeof categoryLimitMb === 'number' && categoryLimitMb > 0) {
      const maxCatBytes = categoryLimitMb * 1024 * 1024;
      if (sizeBytes > maxCatBytes) {
        throw new BadRequestAppException('files.error.categoryFileTooLarge', [], {
          category: categoryName,
          maxMb: categoryLimitMb,
        });
      }
    }

    const maxMb = this.getMaxUploadSizeMb(organizationUnitId);
    const maxBytes = maxMb * 1024 * 1024;
    if (sizeBytes > maxBytes) {
      throw new BadRequestAppException('files.error.fileTooLarge', [], { maxMb });
    }
  }
}
