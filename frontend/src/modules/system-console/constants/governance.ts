import type { LucideIcon } from 'lucide-react';
import { Boxes, Database, FileText, HardDrive, ListChecks, Zap } from 'lucide-react';
import type { Tone } from '@core/theme';
import type { PackageCategory, PackageStatus } from '../types/packages.types';

/** Package của mục Security trong Package Registry. */
export const SECURITY_PACKAGE_ID = 'security';

/** Metric của package security → biến môi trường nguồn (hiện ở tooltip). Thứ tự = thứ tự hiển thị. */
export const SECURITY_CONFIG_ENV: Record<string, string> = {
  accessExpiration: 'JWT_ACCESS_EXPIRATION',
  refreshExpiration: 'JWT_REFRESH_EXPIRATION',
  secretDriver: 'SECRET_DRIVER',
};
/** Metric hiện ở ô trạng thái (không lặp lại trong bảng cấu hình). */
export const SECURITY_STATE_METRICS = ['globalAuthGuard', 'tokenVerification'] as const;
/** Giá trị `tokenVerification` khi TokenService.verify() chưa kiểm tra chữ ký. */
export const TOKEN_VERIFICATION_SKELETON = 'skeleton';

/** Số dòng ô dán JWT. */
export const JWT_INPUT_ROWS = 3;
/** Chiều cao tối đa khung JSON header / payload (px). */
export const JWT_JSON_MAX_HEIGHT_PX = 320;

/** Danh mục package (thứ tự nút lọc). */
export const PACKAGE_CATEGORIES: PackageCategory[] = ['cache', 'queue', 'logging', 'database', 'storage', 'custom'];
export const PACKAGE_CATEGORY_ICON: Record<PackageCategory, LucideIcon> = {
  cache: Zap,
  queue: ListChecks,
  logging: FileText,
  database: Database,
  storage: HardDrive,
  custom: Boxes,
};
export const PACKAGE_STATUS_TONE: Record<PackageStatus, Tone> = { healthy: 'ok', warning: 'warn', error: 'crit', idle: 'unknown' };
/** Số metric xem nhanh trên mỗi dòng bảng package. */
export const PACKAGE_METRICS_PREVIEW = 3;
/** Chiều cao tối đa khung JSON gốc trong drawer package (px). */
export const PACKAGE_JSON_MAX_HEIGHT_PX = 360;

/** Giá trị lọc "tất cả" trên URL. */
export const FILTER_ALL = 'all';
