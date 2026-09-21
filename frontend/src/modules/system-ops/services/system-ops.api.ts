import { fetchApi } from '../../../core/services/api';
import type { PackageSummary } from '../types/system-ops.types';
import { SYSTEM_OPS_ENDPOINTS } from '../constants/system-ops.constants';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export async function getSystemOpsPackages(): Promise<PackageSummary[]> {
  const res = await fetchApi<ApiResponse<PackageSummary[]>>(SYSTEM_OPS_ENDPOINTS.PACKAGES);
  return res.data;
}

export async function executePackageAction(
  packageId: string,
  actionId: string,
  params?: unknown,
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const res = await fetchApi<ApiResponse<{ success: boolean; message: string; data?: unknown }>>(
    SYSTEM_OPS_ENDPOINTS.EXECUTE_ACTION(packageId, actionId),
    {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    },
  );
  return res.data;
}
