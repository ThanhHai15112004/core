import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation } from '@core/data';
import { Badge } from '@core/ui/primitives';
import { ConfirmDialog, KeyValueGrid } from '@core/ui/blocks';
import type { MessageRow } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { REPLAY_CONFIRM } from '../../constants/messaging';
import { idemKey } from '../../utils/messaging-format';
import { messagingKeys } from './messaging-keys';

export type MessageAction = 'retry' | 'replay' | 'discard';
/** Message cần thao tác; `idempotent` lấy từ chi tiết (bảng không có → không rõ). */
export type ActionTarget = Pick<MessageRow, 'id' | 'queue' | 'channel' | 'attempts' | 'maxAttempts' | 'error'> & { idempotent?: boolean | null };

interface Pending {
  action: MessageAction;
  target: ActionTarget;
}

/**
 * Retry ngay (message đang chờ retry), Replay (dead letter → hàng đợi, gõ REPLAY), Discard (xoá vĩnh viễn, gõ lại
 * message ID) — hộp xác nhận + toast + làm mới dữ liệu messaging. `onDone` để đóng drawer khi message bị xoá.
 */
export function useMessageActions(onDone?: (action: MessageAction, target: ActionTarget) => void) {
  const { t } = useLocale();
  const [pending, setPending] = useState<Pending | null>(null);
  const mutation = useAppMutation({
    mutationFn: ({ action, target }: Pending) =>
      action === 'retry'
        ? messagingApi.retry(target.id, target.queue)
        : action === 'replay'
          ? messagingApi.replay(target.id, target.queue)
          : messagingApi.discard(target.id, target.queue, target.id),
    invalidate: [messagingKeys.all],
    success: (_d, p) => t(`messaging.action.done.${p.action}`, { id: p.target.id }),
    error: t('messaging.action.failed'),
    onSuccess: (_d, p) => {
      setPending(null);
      onDone?.(p.action, p.target);
    },
  });

  const p = pending;
  const dialog = (
    <ConfirmDialog
      key={p ? `${p.action}:${p.target.queue}:${p.target.id}` : 'none'}
      open={p !== null}
      onOpenChange={(o) => !o && !mutation.isPending && setPending(null)}
      title={p ? t(`messaging.modal.${p.action}.title`) : ''}
      impact={p ? [p.action === 'replay' ? t('messaging.modal.replay.warning', { attempts: p.target.attempts }) : t(`messaging.modal.${p.action}.warning`)] : undefined}
      confirmLabel={p ? t(`messaging.modal.${p.action}.confirm`) : ''}
      tone={p?.action === 'discard' ? 'danger' : 'primary'}
      typeToConfirm={p?.action === 'replay' ? REPLAY_CONFIRM : p?.action === 'discard' ? p.target.id : undefined}
      loading={mutation.isPending}
      onConfirm={() => p && mutation.mutate(p)}
    >
      {p && (
        <KeyValueGrid
          items={[
            { key: 'id', label: t('messaging.message.id'), value: p.target.id, mono: true },
            { key: 'channel', label: t('messaging.message.channel'), value: p.target.channel, mono: true },
            { key: 'queue', label: t('messaging.message.queue'), value: p.target.queue, mono: true },
            { key: 'attempts', label: t('messaging.message.attempts'), value: `${p.target.attempts} / ${p.target.maxAttempts}`, mono: true },
            ...(p.action !== 'discard'
              ? [
                  {
                    key: 'idem',
                    label: t('messaging.message.idempotency'),
                    value: <Badge tone={p.target.idempotent === true ? 'ok' : 'warn'}>{t(`messaging.idempotent.${idemKey(p.target.idempotent)}`)}</Badge>,
                  },
                ]
              : []),
            ...(p.target.error ? [{ key: 'error', label: t('messaging.message.lastError'), value: <span className="text-crit-fg">{p.target.error}</span> }] : []),
          ]}
        />
      )}
    </ConfirmDialog>
  );

  return { dialog, request: (action: MessageAction, target: ActionTarget) => setPending({ action, target }) };
}
