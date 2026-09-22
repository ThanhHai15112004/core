import { useCallback, useState } from 'react';
import type { DbSession } from '../types/database.types';
import { databaseApi } from '../services/database.api';
import { DB_CONFIRM } from '../constants/database';
import { DbActionModal } from '../components/database/DbActionModal';
import { formatDuration } from '../utils/database-format';
import { useConsoleData } from '../context/console-data-context';
import { useLocale } from '../../../core/i18n/index';

type Pending = { action: 'cancel' | 'terminate'; session: DbSession } | null;

/** Cancel Query / Terminate Session với modal xác nhận + toast kết quả; `onDone` để tải lại danh sách. */
export function useSessionActions(onDone: () => void) {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (typed: string) => {
      if (!pending) return;
      setBusy(true);
      const { action, session } = pending;
      try {
        if (action === 'cancel') await databaseApi.cancel(session.id);
        else await databaseApi.terminate(session.id, typed);
        addToast({ type: 'success', title: t(`db.action.${action}Done`, { id: session.id }) });
        setPending(null);
        onDone();
      } catch (err) {
        addToast({ type: 'error', title: t('db.action.failed'), message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [addToast, onDone, pending, t],
  );

  const modal = pending ? (
    <DbActionModal
      title={t(`db.modal.${pending.action}.title`)}
      context={[
        { label: t('db.session.id'), value: <code>#{pending.session.id}</code> },
        { label: t('db.session.source'), value: pending.session.runtime ? t(`rt.name.${pending.session.runtime}`) : (pending.session.program ?? t('db.session.external')) },
        { label: t('db.session.age'), value: formatDuration(pending.session.queryMs) },
        ...(pending.session.query ? [{ label: t('db.session.query'), value: <code className="db-modal-sql">{pending.session.query}</code> }] : []),
      ]}
      warning={t(`db.modal.${pending.action}.warning`)}
      confirmLabel={t(`db.modal.${pending.action}.confirm`)}
      {...(pending.action === 'terminate' ? { confirmWord: DB_CONFIRM.terminate } : {})}
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={(typed) => void run(typed)}
    />
  ) : null;

  return {
    modal,
    requestCancel: (session: DbSession) => setPending({ action: 'cancel', session }),
    requestTerminate: (session: DbSession) => setPending({ action: 'terminate', session }),
  };
}
