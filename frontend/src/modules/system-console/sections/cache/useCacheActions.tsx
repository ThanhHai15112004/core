import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { ConfirmDialog, KeyValueGrid, QueryView } from '@core/ui/blocks';
import type { KeyRow, NamespaceRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { CACHE_CONFIRM } from '../../constants/cache';
import { cacheKeys } from './cache-keys';

type KeyTarget = Pick<KeyRow, 'key' | 'namespace' | 'bytes' | 'ttlMs'>;
type Pending = { action: 'deleteKey'; key: KeyTarget } | { action: 'clearNamespace'; ns: NamespaceRow } | { action: 'flush' } | null;

/**
 * Xoá key / clear namespace / flush cache: hộp xác nhận đúng mức nguy hiểm (gõ lại chữ xác nhận) + toast + làm mới.
 * `onDone` để đóng drawer của đối tượng vừa xoá (nó không còn → tránh 404).
 */
export function useCacheActions(onDone: (action: 'deleteKey' | 'clearNamespace' | 'flush') => void) {
  const { t } = useLocale();
  const f = useFormat();
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const deleteKey = useAppMutation({
    mutationFn: (key: string) => cacheApi.deleteKey(key),
    invalidate: [cacheKeys.all],
    success: (op) => t('cache.action.deleteKeyDone', { target: op.target }),
    onSuccess: () => (close(), onDone('deleteKey')),
  });
  const clearNamespace = useAppMutation({
    mutationFn: (name: string) => cacheApi.clearNamespace(name, name),
    invalidate: [cacheKeys.all],
    success: (op) => t('cache.action.clearNamespaceDone', { target: op.target, count: f.compact(op.affected) }),
    onSuccess: () => (close(), onDone('clearNamespace')),
  });
  const flush = useAppMutation({
    mutationFn: () => cacheApi.flush(CACHE_CONFIRM.flush),
    invalidate: [cacheKeys.all],
    success: (op) => t('cache.action.flushDone', { count: f.compact(op.affected) }),
    onSuccess: () => (close(), onDone('flush')),
  });
  const impact = useLiveQuery(cacheKeys.flushImpact(), () => cacheApi.flushImpact(), { tier: 'static', enabled: pending?.action === 'flush', keepPrevious: false });
  const ttlText = (ms: number | null) => (ms === null ? t('cache.ttl.none') : f.duration(ms));

  const dialogs = (
    <>
      {pending?.action === 'deleteKey' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          tone="danger"
          title={t('cache.modal.deleteKey.title')}
          impact={[t('cache.modal.deleteKey.warning')]}
          confirmLabel={t('cache.modal.deleteKey.confirm')}
          typeToConfirm={CACHE_CONFIRM.deleteKey}
          loading={deleteKey.isPending}
          onConfirm={() => deleteKey.mutate(pending.key.key)}
        >
          <KeyValueGrid
            items={[
              { label: t('cache.key.key'), value: pending.key.key, mono: true },
              { label: t('cache.key.namespace'), value: pending.key.namespace, mono: true },
              { label: t('cache.key.ttl'), value: ttlText(pending.key.ttlMs) },
              { label: t('cache.key.size'), value: f.bytes(pending.key.bytes) },
            ]}
          />
        </ConfirmDialog>
      )}
      {pending?.action === 'clearNamespace' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          tone="danger"
          title={t('cache.modal.clearNamespace.title')}
          impact={[
            t('cache.modal.clearNamespace.warning'),
            ...(pending.ns.session ? [t('cache.modal.clearNamespace.sessionWarning', { count: f.compact(pending.ns.keys) })] : []),
          ]}
          confirmLabel={t('cache.modal.clearNamespace.confirm')}
          typeToConfirm={pending.ns.name}
          loading={clearNamespace.isPending}
          onConfirm={() => clearNamespace.mutate(pending.ns.name)}
        >
          <KeyValueGrid
            columns={3}
            items={[
              { label: t('cache.ns.name'), value: pending.ns.name, mono: true },
              { label: t('cache.ns.keys'), value: f.compact(pending.ns.keys) },
              { label: t('cache.ns.memory'), value: f.bytes(pending.ns.bytes) },
            ]}
          />
        </ConfirmDialog>
      )}
      {pending?.action === 'flush' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          tone="danger"
          title={t('cache.modal.flush.title')}
          impact={[
            t('cache.modal.flush.missSpike'),
            t('cache.modal.flush.dbLoad'),
            t('cache.modal.flush.tempData'),
            ...(impact.data && impact.data.sessionKeys > 0
              ? [t('cache.modal.flush.sessionWarning', { count: f.compact(impact.data.sessionKeys), namespaces: impact.data.sessionNamespaces.join(', ') })]
              : []),
          ]}
          confirmLabel={t('cache.modal.flush.confirm')}
          typeToConfirm={CACHE_CONFIRM.flush}
          loading={flush.isPending}
          onConfirm={() => flush.mutate()}
        >
          <QueryView query={impact} skeleton="block" compact>
            {(i) => (
              <KeyValueGrid
                columns={3}
                items={[
                  { label: t('cache.modal.flush.environment'), value: i.environment.toUpperCase(), mono: true },
                  { label: t('cache.modal.flush.keys'), value: i.keys === null ? NO_VALUE : `${f.compact(i.keys)}${i.truncated ? '+' : ''}` },
                  { label: t('cache.modal.flush.memory'), value: f.bytes(i.bytes) },
                ]}
              />
            )}
          </QueryView>
        </ConfirmDialog>
      )}
    </>
  );

  return {
    dialogs,
    requestDeleteKey: (key: KeyTarget) => setPending({ action: 'deleteKey', key }),
    requestClearNamespace: (ns: NamespaceRow) => setPending({ action: 'clearNamespace', ns }),
    requestFlush: () => setPending({ action: 'flush' }),
  };
}

export type CacheActions = ReturnType<typeof useCacheActions>;
