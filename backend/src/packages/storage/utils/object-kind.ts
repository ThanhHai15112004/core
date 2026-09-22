export type ObjectKind = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'text' | 'other';
export const OBJECT_KINDS: readonly ObjectKind[] = [
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'text',
  'other',
];

const EXT: Record<string, { kind: ObjectKind; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  avif: { kind: 'image', mime: 'image/avif' },
  ico: { kind: 'image', mime: 'image/x-icon' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  mkv: { kind: 'video', mime: 'video/x-matroska' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  pdf: { kind: 'document', mime: 'application/pdf' },
  doc: { kind: 'document', mime: 'application/msword' },
  docx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xls: { kind: 'document', mime: 'application/vnd.ms-excel' },
  xlsx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  ppt: { kind: 'document', mime: 'application/vnd.ms-powerpoint' },
  pptx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  odt: { kind: 'document', mime: 'application/vnd.oasis.opendocument.text' },
  zip: { kind: 'archive', mime: 'application/zip' },
  gz: { kind: 'archive', mime: 'application/gzip' },
  tgz: { kind: 'archive', mime: 'application/gzip' },
  tar: { kind: 'archive', mime: 'application/x-tar' },
  '7z': { kind: 'archive', mime: 'application/x-7z-compressed' },
  rar: { kind: 'archive', mime: 'application/vnd.rar' },
  txt: { kind: 'text', mime: 'text/plain' },
  log: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/markdown' },
  csv: { kind: 'text', mime: 'text/csv' },
  json: { kind: 'text', mime: 'application/json' },
  xml: { kind: 'text', mime: 'application/xml' },
  html: { kind: 'text', mime: 'text/html' },
  yml: { kind: 'text', mime: 'text/yaml' },
  yaml: { kind: 'text', mime: 'text/yaml' },
};

const extOf = (key: string) => {
  const name = key.split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

/** Content-type suy từ đuôi file (không đọc nội dung). */
export const mimeOf = (key: string): string => EXT[extOf(key)]?.mime ?? 'application/octet-stream';

/** Nhóm loại file theo content-type (ưu tiên) hoặc đuôi file. */
export function kindOf(key: string, contentType?: string | null): ObjectKind {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'application/pdf') return 'document';
  if (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml')
    return 'text';
  if (/zip|gzip|x-tar|compressed|rar/.test(ct)) return 'archive';
  return EXT[extOf(key)]?.kind ?? 'other';
}

/** Có thể preview nội dung dạng text không. */
export const isTextual = (key: string, contentType?: string | null) =>
  kindOf(key, contentType) === 'text';

/** Container của object = segment đầu (`uploads/a/b.png` → `uploads`); key không có `/` → `(root)`. */
export const ROOT_CONTAINER = '(root)';
export function containerOf(key: string): string {
  const i = key.indexOf('/');
  return i > 0 ? key.slice(0, i) : ROOT_CONTAINER;
}

/** Key hợp lệ: tương đối, không `..`, không ký tự điều khiển, không bắt đầu bằng `/`. */
export function isValidKey(key: string): boolean {
  if (!key || key.length > 1024 || key.startsWith('/') || key.endsWith('/')) return false;
  if ([...key].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false;
  return !key.split('/').some((s) => s === '..' || s === '.' || s === '');
}
