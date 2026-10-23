import { BadRequestAppException } from '@packages/kernel/index.js';
import { DANGEROUS_MIMES, EICAR_SIGNATURE } from '../enum/files.enum.js';
import type { UploadSingleFileRequest } from '../requests/files.requests.js';
import type { MalwareScanResult } from '../types/files.types.js';

/** Giải mã nội dung file từ chuỗi Base64 (hỗ trợ cả Data URL) hoặc chuỗi văn bản */
export function decodeUploadBuffer(input: UploadSingleFileRequest): Buffer {
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

/** Kiểm tra tính tương thích giữa MIME type gửi lên và phần mở rộng thực tế (Mục 6.3.1) */
export function assertMimeTypeCompatibleWithExtension(
  providedMime: string,
  ext: string,
  detectedMime: string | null,
): void {
  if (DANGEROUS_MIMES.includes(providedMime)) {
    throw new BadRequestAppException('files.error.mimeTypeMismatch', [], {
      mimeType: providedMime,
      ext,
    });
  }

  if (!detectedMime || detectedMime === 'application/octet-stream') {
    return;
  }

  const expectedMajor = detectedMime.split('/')[0];
  const providedMajor = providedMime.split('/')[0];

  if (
    (expectedMajor === 'image' || expectedMajor === 'video' || expectedMajor === 'audio') &&
    providedMajor !== expectedMajor
  ) {
    throw new BadRequestAppException('files.error.mimeTypeMismatch', [], {
      mimeType: providedMime,
      ext,
    });
  }
}

/** Kiểm tra chữ ký byte đầu (Magic Bytes) để chặn tệp thực thi hoặc giả mạo định dạng */
export function assertMagicBytesMatch(buf: Buffer, ext: string): void {
  // Chặn tệp thực thi Windows PE (MZ) hoặc Linux ELF (\x7FELF) giả mạo
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    throw new BadRequestAppException('files.error.signatureMismatch', [], { ext });
  }
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
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

/**
 * Quét mã độc trong nội dung tệp tải lên (Mục 6.3.3):
 * - Phát hiện tệp thực thi PE (`MZ`) / ELF (`\x7FELF`) / Shebang (`#!/bin/sh`).
 * - Phát hiện mẫu virus kiểm thử chuẩn quốc tế EICAR.
 * - Phát hiện mã kịch bản độc hại nhúng trong ảnh/tài liệu (`<script`, `javascript:`, `/JavaScript`, `/Launch`).
 */
export function scanBufferForMalware(buf: Buffer, ext: string): MalwareScanResult {
  const scannedAt = new Date().toISOString();

  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return { clean: false, threatName: 'WIN32_PE_EXECUTABLE', scannedAt };
  }
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return { clean: false, threatName: 'LINUX_ELF_EXECUTABLE', scannedAt };
  }

  // Kiểm tra trên 64KB đầu tiên để tối ưu hiệu năng
  const headSample = buf.subarray(0, Math.min(buf.length, 65_536)).toString('latin1');
  if (headSample.includes(EICAR_SIGNATURE)) {
    return { clean: false, threatName: 'EICAR_TEST_VIRUS', scannedAt };
  }

  if (
    headSample.startsWith('#!/bin/sh') ||
    headSample.startsWith('#!/bin/bash') ||
    headSample.startsWith('#!/usr/bin/env')
  ) {
    return { clean: false, threatName: 'SHELL_SCRIPT_PAYLOAD', scannedAt };
  }

  const lowerSample = headSample.toLowerCase();
  // Chặn XSS / Script nhúng trong ảnh hoặc tài liệu
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    if (
      lowerSample.includes('<script') ||
      lowerSample.includes('javascript:') ||
      lowerSample.includes('onerror=') ||
      lowerSample.includes('onload=')
    ) {
      return { clean: false, threatName: 'EMBEDDED_XSS_SCRIPT', scannedAt };
    }
  }

  // Chặn PDF chứa lệnh tự động thực thi /Launch hoặc /JavaScript độc hại
  if (ext === 'pdf') {
    if (headSample.includes('/Launch') || headSample.includes('/JavaScript')) {
      return { clean: false, threatName: 'PDF_ACTIVE_SCRIPT_OR_LAUNCH', scannedAt };
    }
  }

  return { clean: true, threatName: null, scannedAt };
}
