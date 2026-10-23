import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { BadRequestAppException } from '@packages/kernel/index.js';
import type { ResolvedByteRange, TemporaryDownloadTokenPayload } from '../types/files.types.js';

/** Tính mã băm SHA-256 dạng chuỗi hex 64 ký tự */
export function computeSha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Sinh đường dẫn lưu trữ bất biến theo prefix cấu hình, năm/tháng/ngày và UUID */
export function buildImmutableStorageKey(prefix: string, ext: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${prefix}/${yyyy}/${mm}/${dd}/${randomUUID()}.${ext}`;
}

/** Sinh đường dẫn lưu trữ ảnh thu nhỏ (Thumbnail — Mục 6.3.5) */
export function buildThumbnailStorageKey(prefix: string, ext: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${prefix}/thumbnails/${yyyy}/${mm}/${dd}/${randomUUID()}.${ext}`;
}

/** Chuẩn hóa tên file khi tải xuống để dùng `displayName` mới kèm đuôi chuẩn */
export function buildSafeDownloadFileName(displayName: string, extension: string): string {
  const cleaned = displayName.trim().replace(/[^\p{L}\p{N}._\-() ]+/gu, '_');
  const expectedSuffix = `.${extension.toLowerCase()}`;
  const hasExt = cleaned.toLowerCase().endsWith(expectedSuffix);
  const withExt = hasExt ? cleaned : `${cleaned}${expectedSuffix}`;
  return path.basename(withExt) || `download${expectedSuffix}`;
}

/** Phân tích header `Range: bytes=start-end` phục vụ tua Video (`206 Partial Content`) */
export function parseByteRangeHeader(rangeHeader: string, totalSize: number): ResolvedByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    throw new BadRequestAppException('files.error.invalidByteRange');
  }
  const startStr = match[1] ?? '';
  const endStr = match[2] ?? '';

  let start = startStr ? Number.parseInt(startStr, 10) : 0;
  let end = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;

  if (!startStr && endStr) {
    const suffixLength = Number.parseInt(endStr, 10);
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= totalSize) {
    throw new BadRequestAppException('files.error.invalidByteRange');
  }

  const clampedEnd = Math.min(end, totalSize - 1);
  return {
    start,
    end: clampedEnd,
    totalSize,
    contentLength: clampedEnd - start + 1,
  };
}

/** Chuẩn hóa slug tên thư mục */
export function slugifyFolderName(name: string): string {
  return (
    name
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'folder'
  );
}

/** Ký token HMAC-SHA256 cho đường dẫn tải file tạm thời */
export function signTemporaryDownloadToken(
  payload: TemporaryDownloadTokenPayload,
  secret: string,
): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureSegment = createHmac('sha256', secret).update(payloadSegment).digest('base64url');
  return `${payloadSegment}.${signatureSegment}`;
}

/** Xác thực token HMAC-SHA256 của đường dẫn tải file tạm thời */
export function verifyTemporaryDownloadToken(
  token: string,
  secret: string,
): TemporaryDownloadTokenPayload | null {
  if (!token || !secret) return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [payloadSegment, signatureSegment] = parts;
  if (!payloadSegment || !signatureSegment) return null;

  try {
    const expectedSig = createHmac('sha256', secret).update(payloadSegment).digest('base64url');
    const sigBuf = Buffer.from(signatureSegment, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf8'),
    ) as Partial<TemporaryDownloadTokenPayload>;

    if (
      !decoded ||
      decoded.typ !== 'file_temp_dl' ||
      typeof decoded.fid !== 'number' ||
      decoded.fid <= 0 ||
      typeof decoded.exp !== 'number'
    ) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (decoded.exp <= nowSeconds) {
      return null;
    }

    return {
      typ: 'file_temp_dl',
      fid: decoded.fid,
      exp: decoded.exp,
      disp: decoded.disp === 'inline' ? 'inline' : 'attachment',
      uid: typeof decoded.uid === 'number' ? decoded.uid : null,
    };
  } catch {
    return null;
  }
}
