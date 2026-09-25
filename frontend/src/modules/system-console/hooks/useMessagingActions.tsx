import { useCallback, useState } from 'react';
import type { MessageRow } from '../types/messaging.types';
import { messagingApi } from '../services/messaging.api';
import { REPLAY_CONFIRM } from '../constants/messaging';
import { DbActionModal } from '../components/database/DbActionModal';
import { useConsoleData } from '../context/console-data-context';
import { useLocale } from '../../../core/i18n/index';

export type MessagingAction = 'retry' | 'replay' | 'discard';
/** Message cần thao tác; `idempotent` lấy từ chi tiết (bảng không có → không rõ). */
export type ActionTarget = Pick<MessageRow, 'id' | 'queue' | 'channel' | 'attempts' | 'maxAttempts' | 'error'> & { idempotent?: boolean | null };

/**
 * Retry ngay (message đang chờ retry), Replay (Dead Letter → hàng đợi, gõ REPLAY), Discard (xoá vĩnh viễn,
 * gõ lại message ID) — modal xác nhận + toast; `onDone` để tải lại/đóng drawer.
 */
export function useMessagingActions(onDone: (action: MessagingAction, target: ActionTarget) => void) {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<{ action: MessagingAction; target: ActionTarget } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (typed: string) => {
      if (!pending) return;
      const { action, target } = pending;
      setBusy(true);
      try {
        if (action === 'retry') await messagingApi.retry(target.id, target.queue);
        else if (action === 'replay') await messagingApi.replay(target.id, target.queue);
        else await messagingApi.discard(target.id, target.queue, typed);
        addToast({ type: 'success', title: t(`messaging.action.done.${action}`, { id: target.id }) });
        setPending(null);
        onDone(action, target);
      } catch (err) {
        addToast({ type: 'error', title: t('messaging.action.failed'), message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [addToast, onDone, pending, t],
  );

  let modal: React.ReactNode = null;
  if (pending) {
    const { action, target } = pending;
    const idem = target.idempotent;
    modal = (
      <DbActionModal
        title={t(`messaging.modal.${action}.title`)}
        context={[
          { label: t('messaging.message.id'), value: <code className="db-modal-sql">{target.id}</code> },
          { label: t('messaging.message.channel'), value: <code>{target.channel}</code> },
          { label: t('messaging.message.queue'), value: <code>{target.queue}</code> },
          { label: t('messaging.message.attempts'), value: `${target.attempts} / ${target.maxAttempts}` },
          ...(target.error ? [{ label: t('messaging.message.lastError'), value: target.error }] : []),
          ...(action !== 'discard'
            ? [
                {
                  label: t('messaging.message.idempotency'),
                  value: (
                    <span className={`pf-chip ov-tone-${idem === true ? 'ok' : 'warn'}`}>
                      {t(`messaging.idempotent.${idem === true ? 'yes' : idem === false ? 'no' : 'unknown'}`)}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
        warning={
          action === 'replay'
            ? t('messaging.modal.replay.warning', { attempts: target.attempts })
            : action === 'discard'
              ? t('messaging.modal.discard.warning')
              : t('messaging.modal.retry.warning')
        }
        confirmLabel={t(`messaging.modal.${action}.confirm`)}
        {...(action === 'replay' ? { confirmWord: REPLAY_CONFIRM } : action === 'discard' ? { confirmWord: target.id } : {})}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(typed) => void run(typed)}
      />
    );
  }

  return {
    modal,
    request: (action: MessagingAction, target: ActionTarget) => setPending({ action, target }),
  };
}
