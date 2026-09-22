import { useConsoleData } from '../context/console-data-context';
import type { PackageSummary } from '../types/console.types';

type MetricValue = string | number | boolean;

/** Lấy package theo id cùng hàm đọc metric; metric thiếu trả về `undefined` thay vì giá trị mặc định đoán. */
export function usePackage(packageId: string): {
  pkg: PackageSummary | undefined;
  metric: (key: string) => MetricValue | undefined;
} {
  const { packages } = useConsoleData();
  const pkg = packages.find((p) => p.packageId === packageId);
  return { pkg, metric: (key) => pkg?.statusReport.metrics[key] };
}
