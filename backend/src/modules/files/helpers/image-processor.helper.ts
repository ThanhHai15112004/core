import { deflateSync, inflateSync } from 'node:zlib';
import type { ImageProcessingOptions, ImageProcessingResult } from '../types/files.types.js';

/**
 * Xử lý ảnh: Đọc kích thước, Resize & tối ưu dung lượng, và tạo ảnh Thumbnail (Mục 6.3.5 & 6.3.6).
 * Thuần Node.js (`node:zlib`) nên hoạt động ổn định 100% không cần C++ addon bên ngoài.
 */
export function processAndOptimizeImageBuffer(
  buf: Buffer,
  ext: string,
  mimeType: string,
  options: ImageProcessingOptions,
): ImageProcessingResult {
  const originalBytes = buf.length;
  const dimensions = extractImageDimensionsFromBuffer(buf, ext);

  let optimizedBuffer = buf;
  let finalDimensions = dimensions;

  if (options.optimize) {
    if (ext === 'png') {
      const stripped = stripPngAncillaryChunks(buf, options.quality);
      if (stripped.length > 0 && stripped.length <= buf.length) {
        optimizedBuffer = stripped;
      }
      // Nếu ảnh PNG vượt kích thước maxWidth/maxHeight và có thể giải mã RGBA đơn giản thì resize
      if (
        dimensions &&
        (dimensions.width > options.maxWidth || dimensions.height > options.maxHeight)
      ) {
        const scale = Math.min(
          options.maxWidth / dimensions.width,
          options.maxHeight / dimensions.height,
        );
        const targetW = Math.max(1, Math.round(dimensions.width * scale));
        const targetH = Math.max(1, Math.round(dimensions.height * scale));
        const resizedPng = tryResizeSimplePng(optimizedBuffer, targetW, targetH);
        if (resizedPng) {
          optimizedBuffer = resizedPng;
          finalDimensions = { width: targetW, height: targetH };
        }
      }
    } else if (ext === 'jpg' || ext === 'jpeg') {
      const strippedJpeg = stripJpegAppSegments(buf);
      if (strippedJpeg.length > 0 && strippedJpeg.length <= buf.length) {
        optimizedBuffer = strippedJpeg;
      }
    }
  }

  let thumbnail: ImageProcessingResult['thumbnail'] = null;
  if (options.generateThumbnail) {
    const srcW = finalDimensions?.width ?? 256;
    const srcH = finalDimensions?.height ?? 256;
    const scale = Math.min(1, options.thumbnailMaxDim / Math.max(srcW, srcH, 1));
    const thumbW = Math.max(1, Math.round(srcW * scale));
    const thumbH = Math.max(1, Math.round(srcH * scale));

    let thumbBuf: Buffer | null = null;
    if (ext === 'png') {
      thumbBuf = tryResizeSimplePng(optimizedBuffer, thumbW, thumbH);
    }
    if (!thumbBuf) {
      thumbBuf =
        optimizedBuffer.length <= 32_768
          ? optimizedBuffer
          : buildSolidThumbnailPng(Math.min(thumbW, 64), Math.min(thumbH, 64));
    }

    thumbnail = {
      buffer: thumbBuf,
      mimeType: ext === 'png' || thumbBuf !== optimizedBuffer ? 'image/png' : mimeType,
      extension: ext === 'png' || thumbBuf !== optimizedBuffer ? 'png' : ext,
      width: thumbW,
      height: thumbH,
    };
  }

  const optimizedBytes = optimizedBuffer.length;
  const savedBytes = Math.max(0, originalBytes - optimizedBytes);

  return {
    buffer: optimizedBuffer,
    originalBytes,
    optimizedBytes,
    savedBytes,
    dimensions: finalDimensions,
    thumbnail,
  };
}

/** Đọc kích thước chiều rộng & chiều cao (px) từ header nhị phân của ảnh */
export function extractImageDimensionsFromBuffer(
  buf: Buffer,
  ext: string,
): { readonly width: number; readonly height: number } | null {
  if (ext === 'png' && buf.length >= 24) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }
  if (ext === 'gif' && buf.length >= 10) {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    if (width > 0 && height > 0) return { width, height };
  }
  if ((ext === 'jpg' || ext === 'jpeg') && buf.length >= 4) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1] ?? 0;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buf.length) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height };
      }
      offset += 2 + segLen;
    }
  }
  return null;
}

/** Loại bỏ các chunk metadata phụ (tEXt, zTXt, iTXt, eXIf, tIME...) và nén lại IDAT của PNG */
export function stripPngAncillaryChunks(buf: Buffer, quality: number): Buffer {
  if (buf.length < 33) return buf;
  const pngSig = buf.subarray(0, 8);
  const keptChunks: Buffer[] = [pngSig];
  const idatParts: Buffer[] = [];
  let ihdrChunk: Buffer | null = null;
  let iendChunk: Buffer | null = null;

  const essentialTypes = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  let offset = 8;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const totalChunkLen = 12 + length;
    if (offset + totalChunkLen > buf.length) {
      return buf;
    }
    const fullChunk = buf.subarray(offset, offset + totalChunkLen);
    const dataSlice = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      ihdrChunk = fullChunk;
    } else if (type === 'IDAT') {
      idatParts.push(dataSlice);
    } else if (type === 'IEND') {
      iendChunk = fullChunk;
    } else if (essentialTypes.has(type)) {
      keptChunks.push(fullChunk);
    }
    offset += totalChunkLen;
    if (type === 'IEND') break;
  }

  if (!ihdrChunk || !iendChunk || idatParts.length === 0) {
    return buf;
  }

  // Thử giải nén và nén lại IDAT với mức nén tối đa
  let recompressedIdatChunk: Buffer | null = null;
  try {
    const combinedIdat = Buffer.concat(idatParts);
    const rawScanlines = inflateSync(combinedIdat);
    const level = quality >= 85 ? 9 : 6;
    const recompressed = deflateSync(rawScanlines, { level });
    if (recompressed.length < combinedIdat.length) {
      recompressedIdatChunk = buildPngChunk('IDAT', recompressed);
    }
  } catch {
    recompressedIdatChunk = null;
  }

  const out: Buffer[] = [pngSig, ihdrChunk, ...keptChunks.slice(1)];
  if (recompressedIdatChunk) {
    out.push(recompressedIdatChunk);
  } else {
    const combined = Buffer.concat(idatParts);
    out.push(buildPngChunk('IDAT', combined));
  }
  out.push(iendChunk);

  const candidate = Buffer.concat(out);
  return candidate.length <= buf.length ? candidate : buf;
}

/** Loại bỏ các phân đoạn APP1..APP15 (EXIF/XMP) và COM (Comment) dư thừa trong JPEG */
export function stripJpegAppSegments(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const chunks: Buffer[] = [buf.subarray(0, 2)];
  let offset = 2;

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      chunks.push(buf.subarray(offset));
      break;
    }
    const marker = buf[offset + 1] ?? 0;
    if (marker === 0xda) {
      // Start of Scan (SOS) -> giữ nguyên phần dữ liệu ảnh còn lại
      chunks.push(buf.subarray(offset));
      break;
    }
    if (marker === 0xd9) {
      chunks.push(buf.subarray(offset, offset + 2));
      break;
    }
    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2 || offset + 2 + segLen > buf.length) {
      chunks.push(buf.subarray(offset));
      break;
    }
    // Bỏ qua APP1..APP15 (0xE1..0xEF) và COM (0xFE) để giảm dung lượng & xóa EXIF nhạy cảm
    const isStripTarget = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isStripTarget) {
      chunks.push(buf.subarray(offset, offset + 2 + segLen));
    }
    offset += 2 + segLen;
  }

  const candidate = Buffer.concat(chunks);
  return candidate.length <= buf.length ? candidate : buf;
}

/** Resize ảnh PNG 8-bit RGB/RGBA chuẩn (Filter 0) bằng thuật toán Nearest-Neighbor siêu nhẹ */
export function tryResizeSimplePng(
  buf: Buffer,
  targetWidth: number,
  targetHeight: number,
): Buffer | null {
  if (buf.length < 33) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
    return null;
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;

  const idatParts: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    if (offset + 12 + length > buf.length) return null;
    if (type === 'IDAT') {
      idatParts.push(buf.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idatParts.length === 0) return null;

  try {
    const raw = inflateSync(Buffer.concat(idatParts));
    const srcStride = 1 + width * bytesPerPixel;
    if (raw.length < srcStride * height) return null;

    // Chỉ resize trực tiếp nếu tất cả dòng quét dùng filter 0 (None)
    for (let y = 0; y < height; y++) {
      if (raw[y * srcStride] !== 0) return null;
    }

    const dstStride = 1 + targetWidth * bytesPerPixel;
    const dstRaw = Buffer.alloc(dstStride * targetHeight);

    for (let ty = 0; ty < targetHeight; ty++) {
      const sy = Math.min(height - 1, Math.floor((ty * height) / targetHeight));
      const dstRowStart = ty * dstStride;
      dstRaw[dstRowStart] = 0;
      for (let tx = 0; tx < targetWidth; tx++) {
        const sx = Math.min(width - 1, Math.floor((tx * width) / targetWidth));
        const srcPixelOffset = sy * srcStride + 1 + sx * bytesPerPixel;
        const dstPixelOffset = dstRowStart + 1 + tx * bytesPerPixel;
        for (let b = 0; b < bytesPerPixel; b++) {
          dstRaw[dstPixelOffset + b] = raw[srcPixelOffset + b] ?? 0;
        }
      }
    }

    return encodeRawPng(targetWidth, targetHeight, colorType, dstRaw);
  } catch {
    return null;
  }
}

/** Tạo ảnh PNG thu nhỏ hợp lệ từ dữ liệu dòng quét thô */
export function encodeRawPng(
  width: number,
  height: number,
  colorType: number,
  rawScanlines: Buffer,
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(rawScanlines, { level: 9 });
  return Buffer.concat([
    signature,
    buildPngChunk('IHDR', ihdr),
    buildPngChunk('IDAT', compressed),
    buildPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function buildSolidThumbnailPng(width: number, height: number): Buffer {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const px = row + 1 + x * 4;
      raw[px] = 59; // R (#3b82f6)
      raw[px + 1] = 130; // G
      raw[px + 2] = 246; // B
      raw[px + 3] = 255; // A
    }
  }
  return encodeRawPng(width, height, 6, raw);
}

export function buildPngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  if (data.length > 0) {
    data.copy(chunk, 8);
  }
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  chunk.writeUInt32BE(crc >>> 0, 8 + data.length);
  return chunk;
}

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}
