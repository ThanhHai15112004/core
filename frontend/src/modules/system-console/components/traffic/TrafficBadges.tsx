import { useLocale } from '@core/i18n/index';
import { Badge, Hint } from '@core/ui/primitives';
import { StatusDot } from '@core/ui/blocks';
import type { EndpointStatus, Reason } from '../../types/traffic.types';
import { ENDPOINT_TONE, METHOD_TONE } from '../../constants/traffic';
import { httpStatusTone, shortRoute } from '../../utils/traffic-format';

export function MethodBadge({ method }: { method: string }) {
  return (
    <Badge tone={METHOD_TONE[method]} variant="outline" size="xs" className="w-14 justify-center font-mono">
      {method}
    </Badge>
  );
}

export function HttpStatusBadge({ status }: { status: number }) {
  return (
    <Badge tone={httpStatusTone(status)} size="xs" className="font-mono">
      {status}
    </Badge>
  );
}

/** Trạng thái do backend suy ra; lý do (ngưỡng bị vượt) ở tooltip. */
export function EndpointStatusBadge({ status, reasons }: { status: EndpointStatus; reasons?: Reason[] }) {
  const { t } = useLocale();
  const tone = ENDPOINT_TONE[status];
  const badge = (
    <Badge tone={tone} size="xs">
      <StatusDot tone={tone} size="xs" />
      {t(`tr.endpointStatus.${status}`)}
    </Badge>
  );
  const why = reasons?.map((r) => r.message).join(' · ');
  return why ? <Hint content={why}>{badge}</Hint> : badge;
}

/** Method + route rút gọn (+ nhãn nội bộ). */
export function EndpointLabel({ method, route, internal }: { method: string; route: string; internal?: boolean }) {
  const { t } = useLocale();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MethodBadge method={method} />
      <span className="truncate font-mono text-xs text-fg" title={route}>
        {shortRoute(route)}
      </span>
      {internal && (
        <Badge size="xs" className="shrink-0">
          {t('tr.internal')}
        </Badge>
      )}
    </span>
  );
}
