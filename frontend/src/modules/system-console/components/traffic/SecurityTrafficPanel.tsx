import { ArrowRight, ShieldAlert } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Button } from '@core/ui/primitives';
import { Panel } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { TrafficInsights } from '../../types/traffic.types';
import { SECURITY_TONE } from '../../constants/traffic';
import { shortRoute } from '../../utils/traffic-format';
import { useTrafficFormat } from './useTrafficFormat';

interface SecurityTrafficPanelProps {
  insights: TrafficInsights;
  onSelectStatus: (status: string) => void;
  onOpenSecurity: () => void;
}

/** 401 / 403 / 429 là tín hiệu cho Security; quản lý chặn / rate limit ở trang Bảo mật. */
export function SecurityTrafficPanel({ insights, onSelectStatus, onOpenSecurity }: SecurityTrafficPanelProps) {
  const { t } = useLocale();
  const tf = useTrafficFormat();
  return (
    <Panel
      title={t('tr.security.title')}
      actions={
        <Button size="xs" variant="ghost" onClick={onOpenSecurity}>
          {t('tr.security.open')}
          <ArrowRight />
        </Button>
      }
    >
      <BarList
        items={insights.security.map((s) => ({
          id: String(s.status),
          label: (
            <>
              <span className="font-mono">{s.status}</span> {t(`tr.security.status.${s.status}`)}
            </>
          ),
          sub: s.topRoute ? <span className="font-mono">{`${s.topRoute.method} ${shortRoute(s.topRoute.route)}`}</span> : undefined,
          value: s.count,
          display: tf.count(s.count),
          tone: s.count > 0 ? SECURITY_TONE[s.status] : undefined,
          onClick: s.count > 0 ? () => onSelectStatus(String(s.status)) : undefined,
        }))}
      />
      {!insights.rateLimit.configured && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-panel-2 px-2.5 py-2 text-xs text-muted">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <span>
            <span className="font-medium text-fg-2">{t('tr.security.rateLimit')}: </span>
            {insights.rateLimit.message}
          </span>
        </div>
      )}
    </Panel>
  );
}
