import { useCallback, useState } from 'react';
import { runtimesApi } from '../services/runtimes.api';
import { useConsoleData } from '../context/console-data-context';
import { useLocale } from '../../../core/i18n/index';
import type { RestartMode, RuntimeAction, RuntimeCommand, RuntimeId } from '../types/runtime.types';

const POLL_MS = 1000;
/* Khớp RESTART_TIMEOUT_MS phía backend (2 phút) + dư. */
const MAX_WAIT_MS = 150_000;

export interface PendingCommand {
  runtime: RuntimeId;
  action: RuntimeAction;
  status: RuntimeCommand['status'];
}

/** Gửi lệnh Restart/Stop/Start rồi theo dõi tới khi hoàn tất hoặc thất bại, báo bằng toast. */
export function useRuntimeCommand(onSettled?: () => void) {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const [pending, setPending] = useState<PendingCommand | null>(null);

  const run = useCallback(
    async (runtime: RuntimeId, action: RuntimeAction, options: { mode?: RestartMode; confirm?: string } = {}) => {
      const name = t(`rt.name.${runtime}`);
      const label = t(`rt.action.${action}`);
      try {
        let command =
          action === 'restart'
            ? await runtimesApi.restart(runtime, options.mode ?? 'graceful')
            : action === 'stop'
              ? await runtimesApi.stop(runtime, options.confirm ?? '')
              : await runtimesApi.start(runtime);
        setPending({ runtime, action, status: command.status });

        const deadline = Date.now() + MAX_WAIT_MS;
        while ((command.status === 'pending' || command.status === 'accepted') && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          // API restart: request có thể lỗi trong lúc API đang khởi động lại — thử tiếp.
          command = await runtimesApi.command(command.id).catch(() => command);
          setPending({ runtime, action, status: command.status });
          onSettled?.();
        }

        if (command.status === 'completed') {
          addToast({ type: 'success', title: t('rt.command.completed', { action: label, name }) });
        } else {
          addToast({
            type: 'error',
            title: t('rt.command.failed', { action: label, name }),
            ...(command.message ? { message: command.message } : {}),
          });
        }
      } catch (err) {
        addToast({
          type: 'error',
          title: t('rt.command.failed', { action: label, name }),
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPending(null);
        onSettled?.();
      }
    },
    [addToast, onSettled, t],
  );

  return { run, pending };
}
