import { ChevronDown, RefreshCw } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { cn } from '../../lib/cn';
import { formatInterval } from '../../lib/format';
import { useLocale } from '../../i18n/index';
import { useLive } from '../../data/live-context';
import { REFRESH_OPTIONS_MS, type RefreshMs } from '../../constants/ui.constants';
import { Button } from '../primitives/button';
import { Hint } from '../primitives/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../primitives/dropdown-menu';
import { StatusDot } from '../blocks/StatusDot';

/** Nút làm mới ngay + chọn chu kỳ tự làm mới (kiểu Grafana). */
export function RefreshControl() {
  const { t } = useLocale();
  const { refreshMs, setRefreshMs, refreshNow } = useLive();
  const fetching = useIsFetching() > 0;
  const label = (ms: number) => (ms === 0 ? t('ui.refresh.off') : formatInterval(ms));

  return (
    <div className="inline-flex items-center">
      <Hint content={t('ui.action.refresh')}>
        <Button variant="secondary" size="sm" className="rounded-r-none border-r-0 px-2" onClick={refreshNow} aria-label={t('ui.action.refresh')}>
          <RefreshCw className={cn(fetching && 'animate-spin')} />
        </Button>
      </Hint>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="rounded-l-none px-2" aria-label={t('ui.refresh.label')}>
            {refreshMs > 0 ? <StatusDot tone="ok" size="xs" pulse /> : <StatusDot tone="unknown" size="xs" />}
            <span className="font-mono text-xs">{label(refreshMs)}</span>
            <ChevronDown className="text-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('ui.refresh.label')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(refreshMs)} onValueChange={(v) => setRefreshMs(Number(v) as RefreshMs)}>
            {REFRESH_OPTIONS_MS.map((ms) => (
              <DropdownMenuRadioItem key={ms} value={String(ms)}>
                {ms === 0 ? t('ui.refresh.off') : t('ui.refresh.every', { value: formatInterval(ms) })}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
