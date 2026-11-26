import { useCallback, useEffect, useState } from 'react';
import {
  scimProvisioningApi,
  type UpsertScimClientPayload,
} from '../services/scim-provisioning.api';
import type {
  ScimClientItem,
  ScimGroupItem,
  ScimReconciliationMode,
  ScimReconciliationRunItem,
  ScimSyncLogItem,
  ScimUserLinkItem,
} from '../types/scim-provisioning.types';

export function useScimProvisioning(
  accessToken: string,
  notify: (type: 'ok' | 'err', text: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState<ScimClientItem[]>([]);
  const [userLinks, setUserLinks] = useState<ScimUserLinkItem[]>([]);
  const [groups, setGroups] = useState<ScimGroupItem[]>([]);
  const [syncLogs, setSyncLogs] = useState<ScimSyncLogItem[]>([]);
  const [reconciliations, setReconciliations] = useState<ScimReconciliationRunItem[]>([]);
  const [issuedTokenBanner, setIssuedTokenBanner] = useState<{
    readonly clientCode: string;
    readonly plainToken: string;
  } | null>(null);

  const refreshAll = useCallback(async () => {
    if (!accessToken) {
      setClients([]);
      setUserLinks([]);
      setGroups([]);
      setSyncLogs([]);
      setReconciliations([]);
      return;
    }
    setBusy(true);
    try {
      const [c, u, g, l, r] = await Promise.all([
        scimProvisioningApi.listClients(accessToken).catch(() => []),
        scimProvisioningApi.listUserLinks(accessToken).catch(() => []),
        scimProvisioningApi.listGroups(accessToken).catch(() => []),
        scimProvisioningApi.listSyncLogs(accessToken).catch(() => []),
        scimProvisioningApi.listReconciliations(accessToken).catch(() => []),
      ]);
      setClients(Array.isArray(c) ? c : []);
      setUserLinks(Array.isArray(u) ? u : []);
      setGroups(Array.isArray(g) ? g : []);
      setSyncLogs(Array.isArray(l) ? l : []);
      setReconciliations(Array.isArray(r) ? r : []);
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const createClient = useCallback(
    async (payload: UpsertScimClientPayload) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        const res = await scimProvisioningApi.createClient(accessToken, payload);
        setIssuedTokenBanner({
          clientCode: res.client.code,
          plainToken: res.plainToken,
        });
        notify('ok', `Đã tạo SCIM Client "${res.client.code}". Hãy sao chép Bearer Token ngay!`);
        await refreshAll();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể tạo SCIM Client');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const updateClient = useCallback(
    async (clientId: number, payload: UpsertScimClientPayload) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await scimProvisioningApi.updateClient(accessToken, clientId, payload);
        notify('ok', `Đã cập nhật SCIM Client #${clientId}`);
        await refreshAll();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể cập nhật SCIM Client');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const rotateToken = useCallback(
    async (clientId: number) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        const res = await scimProvisioningApi.rotateClientToken(accessToken, clientId);
        setIssuedTokenBanner({
          clientCode: res.client.code,
          plainToken: res.plainToken,
        });
        notify('ok', `Đã xoay vòng Bearer Token cho "${res.client.code}"`);
        await refreshAll();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể xoay vòng token');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const deleteClient = useCallback(
    async (clientId: number) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        await scimProvisioningApi.deleteClient(accessToken, clientId);
        notify('ok', `Đã xóa SCIM Client #${clientId}`);
        await refreshAll();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể xóa SCIM Client');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  const loadSyncLogs = useCallback(
    async (filters?: { clientId?: number; outcome?: string; resourceType?: string }) => {
      if (!accessToken) return;
      setBusy(true);
      try {
        const list = await scimProvisioningApi.listSyncLogs(accessToken, filters);
        setSyncLogs(Array.isArray(list) ? list : []);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không tải được lịch sử SCIM');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify],
  );

  const runReconciliation = useCallback(
    async (
      clientId: number,
      payload: {
        mode: ScimReconciliationMode;
        applyDeprovisionOrphans?: boolean;
        applySyncMissingAndDrifts?: boolean;
        idpUsers: unknown[];
        idpGroups?: unknown[];
      },
    ): Promise<ScimReconciliationRunItem | null> => {
      if (!accessToken) return null;
      setBusy(true);
      try {
        const run = await scimProvisioningApi.runReconciliation(accessToken, clientId, payload);
        notify(
          'ok',
          `Đối soát ${run.mode} hoàn tất: phát hiện ${run.discrepanciesCount} sai lệch, đã xử lý ${run.appliedActionsCount}`,
        );
        await refreshAll();
        return run;
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi chạy đối soát SCIM');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, refreshAll],
  );

  return {
    busy,
    clients,
    userLinks,
    groups,
    syncLogs,
    reconciliations,
    issuedTokenBanner,
    clearIssuedTokenBanner: () => setIssuedTokenBanner(null),
    refreshAll,
    createClient,
    updateClient,
    rotateToken,
    deleteClient,
    loadSyncLogs,
    runReconciliation,
  };
}
