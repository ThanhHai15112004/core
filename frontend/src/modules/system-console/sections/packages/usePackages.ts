import { useLiveQuery } from '@core/data';
import { consoleKeys } from '../../context/console-data-context';
import { fetchPackages } from '../../services/packages.api';

/**
 * Danh sách package hạ tầng — cùng key với dữ liệu chung của console (không gọi API hai lần), nhưng trả về
 * cả trạng thái loading / lỗi để trang tự hiển thị.
 */
export function usePackagesQuery() {
  return useLiveQuery(consoleKeys.packages, fetchPackages, { tier: 'slow' });
}
