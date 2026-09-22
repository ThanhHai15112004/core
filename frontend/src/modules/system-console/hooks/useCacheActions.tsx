import { useCallback, useState } from 'react';
import type { FlushImpact, KeyRow, NamespaceRow } from '../types/cache.types';
import { cacheApi } from '../services/cache.api';
import { CACHE_CONFIRM } from '../constants/cache';
import { DbActionModal } from '../components/database/DbActionModal';
import { formatBytes, formatCompact } from '../utils/database-format';
import { formatTtl } from '../utils/cache-format';
import { useConsoleData } from '../context/console-data-context';
import { useLocale } from '../../../core/i18n/index';

type Pending =
  | { action: 'deleteKey'; key: Pick<KeyRow, 'key' | 'namespace' | 'type' | 'bytes' | 'ttlMs'> }
  | { action: 'clearNamespace'; ns: NamespaceRow }
  | { action: 'flush'; impact: FlushImpact }
  | null;

/**
 * Xoá key / clear namespace / flush cache với modal xác nhận đúng mức độ nguy hiểm + toast kết quả.
 * `onDone` để tải lại dữ liệu (và đóng drawer của đối tượng vừa xoá) sau khi thao tác thành công.
 */
export function useCacheActions(onDone: (action: 'deleteKey' | 'clearNamespace' | 'flush') => void) {
  const { t, locale } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (typed: string) => {
      if (!pending) return;
      setBusy(true);
      try {
        const op =
          pending.action === 'deleteKey'
            ? await cacheApi.deleteKey(pending.key.key)
            : pending.action === 'clearNamespace'
              ? await cacheApi.clearNamespace(pending.ns.name, typed)
              : await cacheApi.flush(typed);
        addToast({ type: 'success', title: t(`cache.action.${pending.action}Done`, { target: op.target, count: op.affected }) });
        setPending(null);
        onDone(pending.action);
      } catch (err) {
        addToast({ type: 'error', title: t('cache.action.failed'), message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [addToast, onDone, pending, t],
  );

  const requestFlush = useCallback(async () => {
    try {
      setPending({ action: 'flush', impact: await cacheApi.flushImpact() });
    } catch (err) {
      addToast({ type: 'error', title: t('cache.action.failed'), message: err instanceof Error ? err.message : String(err) });
    }
  }, [addToast, t]);

  let modal: React.ReactNode = null;
  if (pending?.action === 'deleteKey') {
    const k = pending.key;
    modal = (
      <DbActionModal
        title={t('cache.modal.deleteKey.title')}
        context={[
          { label: t('cache.key.key'), value: <code className="db-modal-sql">{k.key}</code> },
          { label: t('cache.key.namespace'), value: <code>{k.namespace}</code> },
          { label: t('cache.key.ttl'), value: k.ttlMs === null ? t('cache.ttl.none') : formatTtl(k.ttlMs) },
          { label: t('cache.key.size'), value: formatBytes(k.bytes) },
        ]}
        warning={t('cache.modal.deleteKey.warning')}
        confirmLabel={t('cache.modal.deleteKey.confirm')}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(typed) => void run(typed)}
      />
    );
  } else if (pending?.action === 'clearNamespace') {
    const n = pending.ns;
    modal = (
      <DbActionModal
        title={t('cache.modal.clearNamespace.title')}
        context={[
          { label: t('cache.ns.name'), value: <code>{n.name}</code> },
          { label: t('cache.ns.keys'), value: formatCompact(n.keys, locale) },
          { label: t('cache.ns.memory'), value: formatBytes(n.bytes) },
        ]}
        warning={n.session ? t('cache.modal.clearNamespace.sessionWarning', { count: formatCompact(n.keys, locale) }) : t('cache.modal.clearNamespace.warning')}
        confirmLabel={t('cache.modal.clearNamespace.confirm')}
        confirmWord={n.name}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(typed) => void run(typed)}
      />
    );
  } else if (pending?.action === 'flush') {
    const i = pending.impact;
    modal = (
      <DbActionModal
        title={t('cache.modal.flush.title')}
        context={[
          { label: t('cache.modal.flush.environment'), value: <strong>{i.environment.toUpperCase()}</strong> },
          { label: t('cache.modal.flush.keys'), value: i.keys === null ? '--' : `${formatCompact(i.keys, locale)}${i.truncated ? '+' : ''}` },
          { label: t('cache.modal.flush.memory'), value: formatBytes(i.bytes) },
        ]}
        warning={[
          t('cache.modal.flush.warning'),
          i.sessionKeys > 0
            ? t('cache.modal.flush.sessionWarning', { count: formatCompact(i.sessionKeys, locale), namespaces: i.sessionNamespaces.join(', ') })
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')}
        confirmLabel={t('cache.modal.flush.confirm')}
        confirmWord={CACHE_CONFIRM.flush}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(typed) => void run(typed)}
      />
    );
  }

  return {
    modal,
    requestDeleteKey: (key: Pick<KeyRow, 'key' | 'namespace' | 'type' | 'bytes' | 'ttlMs'>) => setPending({ action: 'deleteKey', key }),
    requestClearNamespace: (ns: NamespaceRow) => setPending({ action: 'clearNamespace', ns }),
    requestFlush,
  };
}
