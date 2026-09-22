import { useCallback, useState } from 'react';
import type { MultipartUpload, ObjectDetail } from '../types/storage.types';
import { storageApi } from '../services/storage.api';
import { STORAGE_CONFIRM } from '../constants/storage';
import { DbActionModal } from '../components/database/DbActionModal';
import { formatBytes } from '../utils/database-format';
import { useConsoleData } from '../context/console-data-context';
import { useLocale } from '../../../core/i18n/index';

type Pending = { action: 'delete'; object: ObjectDetail; versionId?: string } | { action: 'abort'; upload: MultipartUpload } | null;

/** Xoá object/version và huỷ multipart upload với modal xác nhận + toast; `onDone` để tải lại/đóng drawer. */
export function useStorageActions(onDone: (action: 'delete' | 'abort') => void) {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (typed: string) => {
      if (!pending) return;
      setBusy(true);
      try {
        if (pending.action === 'delete') {
          await storageApi.deleteObject(pending.object.key, typed, pending.versionId);
          addToast({ type: 'success', title: t(pending.versionId ? 'storage.action.versionDeleted' : 'storage.action.deleted', { key: pending.object.key }) });
        } else {
          await storageApi.abortUpload(pending.upload.key, pending.upload.uploadId);
          addToast({ type: 'success', title: t('storage.action.aborted', { key: pending.upload.key }) });
        }
        const action = pending.action;
        setPending(null);
        onDone(action);
      } catch (err) {
        addToast({ type: 'error', title: t('storage.action.failed'), message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [addToast, onDone, pending, t],
  );

  let modal: React.ReactNode = null;
  if (pending?.action === 'delete') {
    const o = pending.object;
    const version = pending.versionId;
    modal = (
      <DbActionModal
        title={t(version ? 'storage.modal.deleteVersion.title' : 'storage.modal.delete.title')}
        context={[
          { label: t('storage.object.key'), value: <code className="db-modal-sql">{o.key}</code> },
          { label: t('storage.object.size'), value: formatBytes(o.size) },
          { label: t('storage.object.container'), value: <code>{o.container}</code> },
          ...(version ? [{ label: t('storage.object.version'), value: <code>{version}</code> }] : []),
        ]}
        warning={t(version ? 'storage.modal.deleteVersion.warning' : o.versions ? 'storage.modal.delete.warningVersioned' : 'storage.modal.delete.warning')}
        confirmLabel={t(version ? 'storage.modal.deleteVersion.confirm' : 'storage.modal.delete.confirm')}
        confirmWord={version ? o.key : STORAGE_CONFIRM.delete}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(typed) => void run(typed)}
      />
    );
  } else if (pending?.action === 'abort') {
    const u = pending.upload;
    modal = (
      <DbActionModal
        title={t('storage.modal.abort.title')}
        context={[
          { label: t('storage.object.key'), value: <code className="db-modal-sql">{u.key}</code> },
          { label: t('storage.uploads.parts'), value: u.parts ?? '--' },
          { label: t('storage.uploads.uploaded'), value: formatBytes(u.uploadedBytes) },
          { label: t('storage.uploads.age'), value: u.ageMin === null ? '--' : `${u.ageMin} min` },
        ]}
        warning={t('storage.modal.abort.warning')}
        confirmLabel={t('storage.modal.abort.confirm')}
        confirmWord={STORAGE_CONFIRM.abort}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(typed) => void run(typed)}
      />
    );
  }

  return {
    modal,
    requestDelete: (object: ObjectDetail, versionId?: string) => setPending({ action: 'delete', object, ...(versionId ? { versionId } : {}) }),
    requestAbort: (upload: MultipartUpload) => setPending({ action: 'abort', upload }),
  };
}
