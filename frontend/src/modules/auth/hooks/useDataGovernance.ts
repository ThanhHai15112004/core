import { useCallback, useEffect, useState } from 'react';
import { dataGovernanceApi } from '../services/data-governance.api';
import type {
  ConsentDefinitionItem,
  DataClassificationItem,
  DataClassificationLevel,
  DataGovernanceOverviewItem,
  DsarDownloadPayload,
  DsarExportFormat,
  DsarRequestItem,
  DsarRequestType,
  LegalHoldItem,
  LegalHoldScopeType,
  RetentionAction,
  SensitiveFieldItem,
  SensitiveMaskStrategy,
  UserConsentItem,
} from '../types/data-governance.types';

export function useDataGovernance(
  accessToken: string,
  notify: (type: 'ok' | 'err', text: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<DataGovernanceOverviewItem | null>(null);
  const [classifications, setClassifications] = useState<readonly DataClassificationItem[]>([]);
  const [sensitiveFields, setSensitiveFields] = useState<readonly SensitiveFieldItem[]>([]);
  const [dsarRequests, setDsarRequests] = useState<readonly DsarRequestItem[]>([]);
  const [consentDefinitions, setConsentDefinitions] = useState<readonly ConsentDefinitionItem[]>([]);
  const [consentRecords, setConsentRecords] = useState<readonly UserConsentItem[]>([]);
  const [legalHolds, setLegalHolds] = useState<readonly LegalHoldItem[]>([]);
  const [lastExportPreview, setLastExportPreview] = useState<DsarDownloadPayload | null>(null);

  const refreshAll = useCallback(async () => {
    if (!accessToken) {
      setOverview(null);
      setClassifications([]);
      setSensitiveFields([]);
      setDsarRequests([]);
      setConsentDefinitions([]);
      setConsentRecords([]);
      setLegalHolds([]);
      return;
    }
    setBusy(true);
    try {
      const [ov, cls, sf, dsar, defs, recs, holds] = await Promise.all([
        dataGovernanceApi.getOverview(accessToken).catch(() => null),
        dataGovernanceApi.listClassifications(accessToken).catch(() => []),
        dataGovernanceApi.listSensitiveFields(accessToken).catch(() => []),
        dataGovernanceApi.listDsarRequests(accessToken).catch(() => []),
        dataGovernanceApi.listConsentDefinitions(accessToken).catch(() => []),
        dataGovernanceApi.listConsentRecords(accessToken).catch(() => []),
        dataGovernanceApi.listLegalHolds(accessToken).catch(() => []),
      ]);
      setOverview(ov);
      setClassifications(Array.isArray(cls) ? cls : []);
      setSensitiveFields(Array.isArray(sf) ? sf : []);
      setDsarRequests(Array.isArray(dsar) ? dsar : []);
      setConsentDefinitions(Array.isArray(defs) ? defs : []);
      setConsentRecords(Array.isArray(recs) ? recs : []);
      setLegalHolds(Array.isArray(holds) ? holds : []);
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const runAction = useCallback(
    async (fn: () => Promise<void>, successMessage: string) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await fn();
        notify('ok', successMessage);
        await refreshAll();
      } catch (err) {
        notify(
          'err',
          err instanceof Error ? err.message : 'Thao tác Quyền riêng tư & Dữ liệu thất bại',
        );
        await refreshAll();
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const upsertClassification = useCallback(
    async (payload: {
      dataTypeCode: string;
      displayName: string;
      moduleName: string;
      classificationLevel: DataClassificationLevel;
      containsPii: boolean;
      retentionDays: number;
      retentionAction: RetentionAction;
      legalBasis?: string;
    }) => {
      await runAction(
        async () => {
          await dataGovernanceApi.upsertClassification(accessToken, payload);
        },
        `Đã lưu phân loại "${payload.dataTypeCode}".`,
      );
    },
    [accessToken, runAction],
  );

  const upsertSensitiveField = useCallback(
    async (payload: {
      resourceType: string;
      fieldPath: string;
      displayName: string;
      classificationLevel: DataClassificationLevel;
      maskStrategy: SensitiveMaskStrategy;
      redactInLog: boolean;
      maskInExport: boolean;
      requiredPermission?: string;
    }) => {
      await runAction(
        async () => {
          await dataGovernanceApi.upsertSensitiveField(accessToken, payload);
        },
        `Đã đánh dấu trường nhạy cảm "${payload.resourceType}.${payload.fieldPath}".`,
      );
    },
    [accessToken, runAction],
  );

  const runRetentionSweep = useCallback(
    async (dryRun: boolean) => {
      await runAction(
        async () => {
          await dataGovernanceApi.runRetentionSweep(accessToken, dryRun);
        },
        `${dryRun ? '[Dry-run] ' : ''}Đã thực thi quét chính sách lưu trữ dữ liệu.`,
      );
    },
    [accessToken, runAction],
  );

  const createDsarRequest = useCallback(
    async (payload: {
      requestType: DsarRequestType;
      subjectUserId?: number;
      exportFormat?: DsarExportFormat;
      reason?: string;
      excludedDataTypeCodes?: string[];
    }) => {
      await runAction(
        async () => {
          await dataGovernanceApi.createDsarRequest(accessToken, payload);
        },
        `Đã tạo yêu cầu DSAR (${payload.requestType}).`,
      );
    },
    [accessToken, runAction],
  );

  const approveDsar = useCallback(
    async (id: number, comment?: string, excludedCodesCsv?: string) => {
      const excludedDataTypeCodes = excludedCodesCsv
        ? excludedCodesCsv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      await runAction(
        async () => {
          await dataGovernanceApi.approveDsarRequest(accessToken, id, {
            comment,
            excludedDataTypeCodes,
          });
        },
        `Đã phê duyệt & thực thi yêu cầu xóa #${id}.`,
      );
    },
    [accessToken, runAction],
  );

  const rejectDsar = useCallback(
    async (id: number, comment: string) => {
      await runAction(
        async () => {
          await dataGovernanceApi.rejectDsarRequest(accessToken, id, comment);
        },
        `Đã từ chối yêu cầu xóa #${id}.`,
      );
    },
    [accessToken, runAction],
  );

  const downloadDsarExport = useCallback(
    async (downloadUrl: string) => {
      const token = downloadUrl.split('/').pop() ?? '';
      if (!token || !accessToken) return;
      setBusy(true);
      try {
        const res = await dataGovernanceApi.downloadDsarExport(accessToken, token);
        setLastExportPreview(res);
        notify('ok', `Đã tải gói máy đọc "${res.fileName}".`);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Tải gói dữ liệu cá nhân thất bại.');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const upsertConsentDefinition = useCallback(
    async (payload: {
      purposeCode: string;
      policyVersion: string;
      title: string;
      description: string;
      classificationLevel: DataClassificationLevel;
      isMandatory: boolean;
      validityDays?: number | null;
    }) => {
      await runAction(
        async () => {
          await dataGovernanceApi.upsertConsentDefinition(accessToken, payload);
        },
        `Đã lưu mục đích "${payload.purposeCode}" v${payload.policyVersion}.`,
      );
    },
    [accessToken, runAction],
  );

  const grantConsent = useCallback(
    async (purposeCode: string, userId?: number) => {
      await runAction(
        async () => {
          await dataGovernanceApi.grantConsent(accessToken, { purposeCode, userId });
        },
        `Đã ghi nhận đồng ý cho "${purposeCode}".`,
      );
    },
    [accessToken, runAction],
  );

  const withdrawConsent = useCallback(
    async (purposeCode: string, reason?: string, userId?: number) => {
      await runAction(
        async () => {
          await dataGovernanceApi.withdrawConsent(accessToken, { purposeCode, reason, userId });
        },
        `Đã rút lại sự đồng ý cho "${purposeCode}".`,
      );
    },
    [accessToken, runAction],
  );

  const createLegalHold = useCallback(
    async (payload: {
      title: string;
      caseReference?: string;
      reason: string;
      scopeType: LegalHoldScopeType;
      targetUserId?: number | null;
      dataTypeCode?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
    }) => {
      await runAction(
        async () => {
          await dataGovernanceApi.createLegalHold(accessToken, payload);
        },
        'Đã kích hoạt lệnh tạm giữ pháp lý (Legal Hold).',
      );
    },
    [accessToken, runAction],
  );

  const releaseLegalHold = useCallback(
    async (id: number, reason: string) => {
      await runAction(
        async () => {
          await dataGovernanceApi.releaseLegalHold(accessToken, id, reason);
        },
        `Đã giải phóng lệnh Legal Hold #${id}.`,
      );
    },
    [accessToken, runAction],
  );

  return {
    busy,
    overview,
    classifications,
    sensitiveFields,
    dsarRequests,
    consentDefinitions,
    consentRecords,
    legalHolds,
    lastExportPreview,
    clearExportPreview: () => setLastExportPreview(null),
    refreshAll,
    upsertClassification,
    upsertSensitiveField,
    runRetentionSweep,
    createDsarRequest,
    approveDsar,
    rejectDsar,
    downloadDsarExport,
    upsertConsentDefinition,
    grantConsent,
    withdrawConsent,
    createLegalHold,
    releaseLegalHold,
  };
}
