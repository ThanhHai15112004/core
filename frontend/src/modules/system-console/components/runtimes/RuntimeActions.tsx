import { useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Button, Hint } from '@core/ui/primitives';
import { ConfirmDialog } from '@core/ui/blocks';
import type { RuntimeAction, RuntimeSummary } from '../../types/runtime.types';
import { BUSY_METRICS, STOP_CONFIRM_WORD } from '../../constants/runtime-metrics';
import { useRuntimeCommand } from '../../sections/runtimes/useRuntimeCommand';
import { useMetricFormat } from './runtime-view';

const ICON = { start: Play, stop: Square } as const;
const ORDER: RuntimeAction[] = ['start', 'stop'];

/**
 * Nút Start / Stop của một runtime. Stop cần xác nhận (gõ STOP) kèm ngữ cảnh "đang bận" thật;
 * thao tác không được phép → nút mờ, lý do từ backend ở tooltip. Theo dõi lệnh tới khi xong.
 */
export function RuntimeActions({ runtime, size = 'xs' }: { runtime: RuntimeSummary; size?: 'xs' | 'sm' }) {
  const { t } = useLocale();
  const metric = useMetricFormat();
  const { run, active, pending } = useRuntimeCommand();
  const [confirmStop, setConfirmStop] = useState(false);
  const name = t(`rt.name.${runtime.id}`);

  // Chặn click (kể cả từ dialog qua portal) lan lên thẻ / hàng chứa nút.
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {ORDER.map((action) => {
        const availability = runtime.actions[action];
        if (!availability) return null;
        const running = active === action;
        const Icon = running ? Loader2 : ICON[action];
        const button = (
          <Button
            size={size}
            variant={action === 'stop' ? 'danger-outline' : 'secondary'}
            disabled={!availability.allowed || Boolean(active)}
            onClick={() => {
              if (action === 'stop') setConfirmStop(true);
              else run({ runtime: runtime.id, action });
            }}
          >
            <Icon className={running ? 'animate-spin' : undefined} />
            {running ? t(`rt.pending.${action}`) : t(`rt.action.${action}`)}
          </Button>
        );
        return (
          <Hint key={action} content={running && pending ? t(`rt.commandStatus.${pending.status}`) : availability.allowed ? undefined : availability.reason}>
            {/* span giữ tooltip khi nút bị disable */}
            <span className="inline-flex">{button}</span>
          </Hint>
        );
      })}
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={t('rt.stop.title', { name })}
        description={BUSY_METRICS[runtime.id].map((key) => `${t(`rt.metric.${key}`)}: ${metric(runtime, key)}`).join(' · ')}
        impact={[t(`rt.stop.impact.${runtime.id}`)]}
        confirmLabel={t('rt.stop.confirm')}
        tone="danger"
        typeToConfirm={STOP_CONFIRM_WORD}
        onConfirm={() => {
          setConfirmStop(false);
          run({ runtime: runtime.id, action: 'stop' });
        }}
      />
    </div>
  );
}
