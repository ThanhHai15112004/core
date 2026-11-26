import { fetchApi, fetchApiWithMeta } from '@core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  BackupOverviewDto,
  BackupPolicyDto,
  BackupRecordDto,
  BackupRestoreHistoryDto,
  BackupRunbookDto,
  BackupTargetType,
  PaginatedBackupList,
  RestoreScope,
  StorageVersioningDto,
} from '../types/backups.types';

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

export const backupsApi = {
  overview: (): Promise<BackupOverviewDto> =>
    fetchApi<BackupOverviewDto>(API_ROUTES.OPS.BACKUPS.path('overview')),

  listPolicies: (): Promise<BackupPolicyDto[]> =>
    fetchApi<BackupPolicyDto[]>(API_ROUTES.OPS.BACKUPS.path('policies')),

  updatePolicy: (
    id: number,
    input: Partial<
      Pick<
        BackupPolicyDto,
        'isEnabled' | 'scheduleCron' | 'retentionDays' | 'maxKeepCount' | 'encryptionEnabled' | 'autoVerifyDrill'
      >
    >,
  ): Promise<BackupPolicyDto> =>
    fetchApi<BackupPolicyDto>(API_ROUTES.OPS.BACKUPS.path(`policies/${id}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  listRecords: async (params: {
    page?: number;
    limit?: number;
    targetType?: string;
    status?: string;
  }): Promise<PaginatedBackupList<BackupRecordDto>> => {
    const res = await fetchApiWithMeta<BackupRecordDto[]>(
      API_ROUTES.OPS.BACKUPS.path(
        'records',
        qs({
          page: params.page ?? 1,
          limit: params.limit ?? 30,
          targetType: params.targetType,
          status: params.status,
        }),
      ),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? 1,
        limit: res.meta?.limit ?? 30,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  runBackup: (input: { targetType?: BackupTargetType; policyId?: number; note?: string }): Promise<BackupRecordDto> =>
    fetchApi<BackupRecordDto>(API_ROUTES.OPS.BACKUPS.path('run'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pruneExpired: (): Promise<{ purgedCount: number; purgedBackupCodes: string[] }> =>
    fetchApi<{ purgedCount: number; purgedBackupCodes: string[] }>(API_ROUTES.OPS.BACKUPS.path('prune'), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  verifyRecord: (id: number, reason?: string): Promise<{ passed: boolean; verificationMode: string }> =>
    fetchApi<{ passed: boolean; verificationMode: string }>(
      API_ROUTES.OPS.BACKUPS.path(`records/${id}/verify`),
      {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      },
    ),

  enableStorageVersioning: (): Promise<StorageVersioningDto> =>
    fetchApi<StorageVersioningDto>(API_ROUTES.OPS.BACKUPS.path('storage/versioning/enable'), {
      method: 'POST',
      body: JSON.stringify({ confirm: 'ENABLE_VERSIONING' }),
    }),

  listRestores: async (params: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedBackupList<BackupRestoreHistoryDto>> => {
    const res = await fetchApiWithMeta<BackupRestoreHistoryDto[]>(
      API_ROUTES.OPS.BACKUPS.path(
        'restores',
        qs({
          page: params.page ?? 1,
          limit: params.limit ?? 30,
        }),
      ),
    );
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? 1,
        limit: res.meta?.limit ?? 30,
        total: res.meta?.total ?? null,
        totalPages: res.meta?.totalPages ?? null,
      },
    };
  },

  recordOrExecuteRestore: (input: {
    backupRecordId?: number | null;
    mode: 'RECORD_MANUAL' | 'EXECUTE_LIVE';
    scope: RestoreScope;
    targetEnvironment: string;
    targetDatabase?: string | null;
    actorName?: string;
    reason: string;
    confirm?: string;
  }): Promise<BackupRestoreHistoryDto> =>
    fetchApi<BackupRestoreHistoryDto>(API_ROUTES.OPS.BACKUPS.path('restores'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  runbook: (): Promise<BackupRunbookDto> =>
    fetchApi<BackupRunbookDto>(API_ROUTES.OPS.BACKUPS.path('runbook')),
};
