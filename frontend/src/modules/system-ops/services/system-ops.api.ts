import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type { PackageActionResult, PackageSummary } from '../types/system-ops.types';

export function getSystemOpsPackages(): Promise<PackageSummary[]> {
  return fetchApi<PackageSummary[]>(API_ROUTES.OPS.PACKAGES);
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
