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
  type FileVisibilityCode,
} from '../contracts/index.js';
import type { UploadSingleFileRequest } from '../requests/files.requests.js';

const DEFAULT_MAX_UPLOAD_MB = 25;
const DEFAULT_MAX_BATCH_FILES = 20;
const DEFAULT_TRASH_RETENTION_DAYS = 30;
const DEFAULT_STORAGE_QUOTA_MB = 51_200;
const DEFAULT_USER_STORAGE_QUOTA_MB = 0;
const DEFAULT_TEMP_LINK_TTL_SEC = 3_600;
const DEFAULT_TEMP_LINK_MAX_TTL_SEC = 604_800;
const DEFAULT_STORAGE_KEY_PREFIX = 'files';
const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'csv',
  'txt',
  'json',
  'mp4',
  'webm',
  'mp3',
  'zip',
];

export interface ValidatedUploadPayload {
  readonly originalName: string;
  readonly displayName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly category: FileCategoryCode;
  readonly buffer: Buffer;
  readonly sizeBytes: number;
}

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

  /** Đọc cấu hình giới hạn dung lượng tối đa (MB) theo đơn vị (nếu có) */
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
      DEFAULT_ALLOWED_EXTENSIONS,
    );
    if (!Array.isArray(list) || list.length === 0) {
      return DEFAULT_ALLOWED_EXTENSIONS;
    }
    return list.map((ext) => String(ext).trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
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
   * Kiểm tra toàn diện tệp tải lên trước khi lưu vào Storage (Mục 6.1):
   * 1. Giải mã nội dung và kiểm tra rỗng.
   * 2. Kiểm tra phần mở rộng (`extension`) theo danh sách cho phép.
   * 3. Kiểm tra dung lượng tối đa (`max_size_mb`).
   * 4. Kiểm tra chữ ký tệp (Magic Bytes) chống giả mạo định dạng / mã độc thực thi (nếu bật `verify_magic_bytes`).
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
    if (!allowedExtensions.includes(extRaw)) {
      throw new BadRequestAppException('files.error.extensionNotAllowed', [], { ext: extRaw });
    }

    const buffer = this.decodeBuffer(input);
    if (buffer.length === 0) {
      throw new BadRequestAppException('files.error.emptyUpload');
    }

    const maxMb = this.getMaxUploadSizeMb(organizationUnitId);
    const maxBytes = maxMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new BadRequestAppException('files.error.fileTooLarge', [], { maxMb });
    }

    if (this.shouldVerifyMagicBytes(organizationUnitId)) {
      this.assertMagicBytesMatch(buffer, extRaw);
    }

    const detectedMime = mimeOf(originalName);
    const mimeType =
      detectedMime && detectedMime !== 'application/octet-stream'
        ? detectedMime
        : input.mimeType?.trim() || 'application/octet-stream';

    const category = this.resolveCategory(extRaw, mimeType);
    const displayName = input.displayName?.trim() || originalName;

    return {
      originalName,
      displayName,
      extension: extRaw,
      mimeType,
      category,
      buffer,
      sizeBytes: buffer.length,
    };
  }

  /** Giải mã nội dung file từ chuỗi Base64 (hỗ trợ cả Data URL) hoặc chuỗi văn bản */
  private decodeBuffer(input: UploadSingleFileRequest): Buffer {
    if (typeof input.contentBase64 === 'string' && input.contentBase64.trim().length > 0) {
      const trimmed = input.contentBase64.trim();
      const commaIndex = trimmed.indexOf(',');
      const rawBase64 =
        trimmed.startsWith('data:') && commaIndex !== -1 ? trimmed.slice(commaIndex + 1) : trimmed;
      return Buffer.from(rawBase64, 'base64');
    }
    if (typeof input.textContent === 'string' && input.textContent.length > 0) {
      return Buffer.from(input.textContent, 'utf8');
    }
    throw new BadRequestAppException('files.error.emptyUpload');
  }

  /** Kiểm tra chữ ký byte đầu (Magic Bytes) để chặn tệp thực thi hoặc giả mạo định dạng */
  private assertMagicBytesMatch(buf: Buffer, ext: string): void {
    // Chặn tệp thực thi Windows PE (MZ) hoặc Linux ELF (\x7FELF) giả mạo
    if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
      throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
    }
    if (
      buf.length >= 4 &&
      buf[0] === 0x7f &&
      buf[1] === 0x45 &&
      buf[2] === 0x4c &&
      buf[3] === 0x46
    ) {
      throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
    }

    if (ext === 'png') {
      const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (buf.length < 8 || !pngMagic.every((b, idx) => buf[idx] === b)) {
        throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
      }
      return;
    }

    if (ext === 'jpg' || ext === 'jpeg') {
      if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
        throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
      }
      return;
    }

    if (ext === 'gif') {
      if (
        buf.length < 4 ||
        buf[0] !== 0x47 ||
        buf[1] !== 0x49 ||
        buf[2] !== 0x46 ||
        buf[3] !== 0x38
      ) {
        throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
      }
      return;
    }

    if (ext === 'webp') {
      const isRiff =
        buf.length >= 12 &&
        buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!isRiff) {
        throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
      }
      return;
    }

    if (ext === 'pdf') {
      if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
      }
      return;
    }

    if (ext === 'zip' || ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
      const isPkZip =
        buf.length >= 4 &&
        buf[0] === 0x50 &&
        buf[1] === 0x4b &&
        (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
      if (!isPkZip) {
        throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
      }
    }
  }

  /** Phân loại nhóm tệp tin (`files.category`) từ phần mở rộng và MIME type */
  public resolveCategory(ext: string, mimeType: string): FileCategoryCode {
    const lowerMime = mimeType.toLowerCase();
    if (
      lowerMime.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)
    ) {
      return FILE_CATEGORY.IMAGE;
    }
    if (lowerMime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
      return FILE_CATEGORY.VIDEO;
    }
    if (lowerMime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
      return FILE_CATEGORY.AUDIO;
    }
    if (['xlsx', 'xls', 'csv', 'tsv', 'json'].includes(ext)) {
      return FILE_CATEGORY.SPREADSHEET;
    }
    if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'rtf'].includes(ext)) {
      return FILE_CATEGORY.DOCUMENT;
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return FILE_CATEGORY.ARCHIVE;
    }
    return FILE_CATEGORY.OTHER;
  }
}
