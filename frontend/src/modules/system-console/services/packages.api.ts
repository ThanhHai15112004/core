import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type { InstalledModulesResponse, PackageActionResult, PackageSummary } from '../types/packages.types';

/** Package hạ tầng đã đăng ký (`ManageablePackage`) và trạng thái — mục Governance → Packages. */
export function fetchPackages(): Promise<PackageSummary[]> {
  return fetchApi<PackageSummary[]>(API_ROUTES.OPS.PACKAGES);
}

/** Danh sách module đã cài đặt (Core & Project) kèm tên, version và trạng thái. */
export function fetchInstalledModules(): Promise<InstalledModulesResponse> {
  return fetchApi<InstalledModulesResponse>(API_ROUTES.OPS.MODULES);
}

export function executePackageAction(
  packageId: string,
  actionId: string,
  params?: unknown,
): Promise<PackageActionResult> {
  return fetchApi<PackageActionResult>(API_ROUTES.OPS.EXECUTE_ACTION(packageId, actionId), {
    method: 'POST',
    body: JSON.stringify(params ?? {}),
  });
}
