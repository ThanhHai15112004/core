import type { FileCategoryCode } from '../contracts/index.js';

export interface MalwareScanResult {
  readonly clean: boolean;
  readonly threatName: string | null;
  readonly scannedAt: string;
}

export interface ImageProcessingOptions {
  readonly optimize: boolean;
  readonly generateThumbnail: boolean;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly quality: number;
  readonly thumbnailMaxDim: number;
}

export interface ImageProcessingResult {
  readonly buffer: Buffer;
  readonly originalBytes: number;
  readonly optimizedBytes: number;
  readonly savedBytes: number;
  readonly dimensions: { readonly width: number; readonly height: number } | null;
  readonly thumbnail: {
    readonly buffer: Buffer;
    readonly mimeType: string;
    readonly extension: string;
    readonly width: number;
    readonly height: number;
  } | null;
}

export interface ValidatedUploadPayload {
  readonly originalName: string;
  readonly displayName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly category: FileCategoryCode;
  readonly buffer: Buffer;
  readonly sizeBytes: number;
  readonly originalSizeBytes: number;
  readonly optimizedSavedBytes: number;
  readonly imageDimensions: { readonly width: number; readonly height: number } | null;
  readonly thumbnail: {
    readonly buffer: Buffer;
    readonly mimeType: string;
    readonly extension: string;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly malwareScan: MalwareScanResult;
}

export interface TemporaryDownloadTokenPayload {
  readonly typ: 'file_temp_dl';
  readonly fid: number;
  readonly exp: number;
  readonly disp: 'attachment' | 'inline';
  readonly uid: number | null;
}

export interface ResolvedByteRange {
  readonly start: number;
  readonly end: number;
  readonly totalSize: number;
  readonly contentLength: number;
}
