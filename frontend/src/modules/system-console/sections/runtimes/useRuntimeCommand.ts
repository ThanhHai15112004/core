import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { useAppMutation } from '@core/data';
import type { RuntimeAction, RuntimeCommand, RuntimeId } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { COMMAND_MAX_WAIT_MS, COMMAND_POLL_MS, STOP_CONFIRM_WORD } from '../../constants/runtime-metrics';
import { runtimesKeys } from './runtimes-keys';

export interface RuntimeCommandVars {
  runtime: RuntimeId;
  action: RuntimeAction;
}

export interface PendingCommand extends RuntimeCommandVars {
  status: RuntimeCommand['status'];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isOpen = (c: RuntimeCommand) => c.status === 'pending' || c.status === 'accepted';

/**
 * Gửi lệnh Stop/Start rồi theo dõi tới khi hoàn tất / thất bại / quá hạn.
 * Trong lúc chờ: làm mới dữ liệu runtime mỗi lần hỏi trạng thái để thẻ cập nhật theo.
 */
export function useRuntimeCommand() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingCommand | null>(null);

  const mutation = useAppMutation<RuntimeCommandVars, RuntimeCommand>({
    mutationFn: async ({ runtime, action }) => {
      try {
        let command = action === 'stop' ? await runtimesApi.stop(runtime, STOP_CONFIRM_WORD) : await runtimesApi.start(runtime);
        setPending({ runtime, action, status: command.status });
        const deadline = Date.now() + COMMAND_MAX_WAIT_MS;
        while (isOpen(command) && Date.now() < deadline) {
          await sleep(COMMAND_POLL_MS);
          command = await runtimesApi.command(command.id).catch(() => command);
          setPending({ runtime, action, status: command.status });
          void queryClient.invalidateQueries({ queryKey: runtimesKeys.all });
        }
        if (command.status !== 'completed') throw new Error(command.message ?? t(isOpen(command) ? 'rt.command.timeout' : 'rt.command.failedGeneric'));
        return command;
      } finally {
        setPending(null);
      }
    },
    invalidate: [runtimesKeys.all],
    success: (_c, v) => t('rt.command.completed', { action: t(`rt.action.${v.action}`), name: t(`rt.name.${v.runtime}`) }),
    error: t('rt.command.failedGeneric'),
  });

  /** Thao tác đang chạy (kể cả trước khi backend nhận lệnh). */
  const active = mutation.isPending ? mutation.variables?.action : undefined;
  return { run: mutation.mutate, pending, active };
}
