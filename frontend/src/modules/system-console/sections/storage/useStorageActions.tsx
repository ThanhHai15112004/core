import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { ConfirmDialog, KeyValueGrid } from '@core/ui/blocks';
import type { MultipartUpload, ObjectDetail } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { STORAGE_CONFIRM } from '../../constants/storage';
import { storageKeys } from './storage-keys';

type Pending = { action: 'delete'; object: ObjectDetail; versionId?: string } | { action: 'abort'; upload: MultipartUpload } | null;

/**
 * Xoá object / version và huỷ multipart upload: hộp xác nhận gõ lại chữ xác nhận + toast + làm mới.
 * `onDeleted` để đóng drawer của object vừa xoá (nó không còn → tránh 404).
 */
export function useStorageActions(onDeleted: (versioned: boolean) => void) {
  const { t } = useLocale();
  const f = useFormat();
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const del = useAppMutation({
    mutationFn: (v: { key: string; confirm: string; versionId?: string }) => storageApi.deleteObject(v.key, v.confirm, v.versionId),
    invalidate: [storageKeys.all],
    success: (_d, v) => t(v.versionId ? 'storage.action.versionDeleted' : 'storage.action.deleted', { key: v.key }),
    onSuccess: (_d, v) => (close(), onDeleted(Boolean(v.versionId))),
  });
  const abort = useAppMutation({
    mutationFn: (u: MultipartUpload) => storageApi.abortUpload(u.key, u.uploadId),
    invalidate: [storageKeys.all],
    success: (_d, u) => t('storage.action.aborted', { key: u.key }),
    onSuccess: close,
  });

  let dialog: React.ReactNode = null;
  if (pending?.action === 'delete') {
    const o = pending.object;
    const version = pending.versionId;
    const word = version ? o.key : STORAGE_CONFIRM.delete;
    dialog = (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && close()}
        tone="danger"
        title={t(version ? 'storage.modal.deleteVersion.title' : 'storage.modal.delete.title')}
        impact={[t(version ? 'storage.modal.deleteVersion.warning' : o.versions ? 'storage.modal.delete.warningVersioned' : 'storage.modal.delete.warning')]}
        confirmLabel={t(version ? 'storage.modal.deleteVersion.confirm' : 'storage.modal.delete.confirm')}
        typeToConfirm={word}
        loading={del.isPending}
        onConfirm={() => del.mutate({ key: o.key, confirm: word, versionId: version })}
      >
        <KeyValueGrid
          items={[
            { label: t('storage.object.key'), value: o.key, mono: true },
            { label: t('storage.object.size'), value: f.bytes(o.size), mono: true },
            { label: t('storage.object.container'), value: o.container, mono: true },
            ...(version ? [{ label: t('storage.object.version'), value: version, mono: true }] : []),
          ]}
        />
      </ConfirmDialog>
    );
  } else if (pending?.action === 'abort') {
    const u = pending.upload;
    dialog = (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && close()}
        tone="danger"
        title={t('storage.modal.abort.title')}
        impact={[t('storage.modal.abort.warning')]}
        confirmLabel={t('storage.modal.abort.confirm')}
        typeToConfirm={STORAGE_CONFIRM.abort}
        loading={abort.isPending}
        onConfirm={() => abort.mutate(u)}
      >
        <KeyValueGrid
          items={[
            { label: t('storage.object.key'), value: u.key, mono: true },
            { label: t('storage.uploads.parts'), value: u.parts === null ? NO_VALUE : f.number(u.parts), mono: true },
            { label: t('storage.uploads.uploaded'), value: f.bytes(u.uploadedBytes), mono: true },
            { label: t('storage.uploads.age'), value: u.ageMin === null ? NO_VALUE : f.duration(u.ageMin * 60_000), mono: true },
          ]}
        />
      </ConfirmDialog>
    );
  }

  return {
    dialog,
    requestDelete: (object: ObjectDetail, versionId?: string) => setPending({ action: 'delete', object, versionId }),
    requestAbort: (upload: MultipartUpload) => setPending({ action: 'abort', upload }),
  };
}
