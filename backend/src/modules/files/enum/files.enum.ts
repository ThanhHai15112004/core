import { FILE_CATEGORY, type FileCategoryCode, type FileCategoryName } from '../contracts/index.js';

export const DEFAULT_MAX_UPLOAD_MB = 25;
export const DEFAULT_MAX_BATCH_FILES = 20;
export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const DEFAULT_UNUSED_RETENTION_DAYS = 30;
export const DEFAULT_STORAGE_QUOTA_MB = 51_200;
export const DEFAULT_USER_STORAGE_QUOTA_MB = 0;
export const DEFAULT_TEMP_LINK_TTL_SEC = 3_600;
export const DEFAULT_TEMP_LINK_MAX_TTL_SEC = 604_800;
export const DEFAULT_STORAGE_KEY_PREFIX = 'files';
export const DEFAULT_THUMBNAIL_MAX_DIM = 320;
export const DEFAULT_IMAGE_MAX_WIDTH = 1920;
export const DEFAULT_IMAGE_MAX_HEIGHT = 1080;
export const DEFAULT_IMAGE_QUALITY = 82;

export const DAY_MS = 86_400_000;
export const FALLBACK_TEMP_LINK_SECRET = 'core-files-temporary-download-hmac-secret-key';

export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'csv',
  'txt',
  'json',
  'mp4',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'zip',
];

export const DEFAULT_CATEGORY_ALLOWED_EXTENSIONS: Readonly<
  Record<FileCategoryName, readonly string[]>
> = {
  IMAGE: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  VIDEO: ['mp4', 'webm', 'mov', 'mkv', 'avi'],
  AUDIO: ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'rtf'],
  SPREADSHEET: ['xlsx', 'xls', 'csv', 'tsv', 'json'],
  ARCHIVE: ['zip', 'rar', '7z', 'tar', 'gz'],
  OTHER: ['bin', 'dat'],
};

export const DEFAULT_CATEGORY_MAX_SIZE_MB: Readonly<Record<FileCategoryName, number>> = {
  IMAGE: 10,
  VIDEO: 200,
  AUDIO: 50,
  DOCUMENT: 25,
  SPREADSHEET: 25,
  ARCHIVE: 100,
  OTHER: 25,
};

export const DEFAULT_MODULE_MAX_SIZE_MB: Readonly<Record<string, number>> = {
  users: 5,
  organizations: 15,
  courses: 200,
};

export const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const DANGEROUS_MIMES: readonly string[] = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'application/x-bat',
];

export const ALL_FILE_CATEGORIES: readonly FileCategoryCode[] = [
  FILE_CATEGORY.IMAGE,
  FILE_CATEGORY.VIDEO,
  FILE_CATEGORY.AUDIO,
  FILE_CATEGORY.DOCUMENT,
  FILE_CATEGORY.SPREADSHEET,
  FILE_CATEGORY.ARCHIVE,
  FILE_CATEGORY.OTHER,
];
