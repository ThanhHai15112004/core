import React from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Gauge, XCircle } from 'lucide-react';
import type { EndpointStatus } from '../../types/traffic.types';
import { ENDPOINT_TONE, httpStatusTone } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

export const MethodBadge: React.FC<{ method: string }> = ({ method }) => (
  <span className={`tr-method tr-method-${method.toLowerCase()}`}>{method}</span>
);

export const HttpStatusBadge: React.FC<{ status: number }> = ({ status }) => (
  <span className={`tr-code ov-tone-${httpStatusTone(status)}`}>{status}</span>
);

const ICONS: Record<EndpointStatus, React.ComponentType<{ size?: number }>> = {
  healthy: CheckCircle2,
  slow: Gauge,
  high_error: AlertTriangle,
  failing: XCircle,
  idle: CircleDashed,
  low_traffic: CircleDashed,
};

export const EndpointStatusBadge: React.FC<{ status: EndpointStatus; title?: string }> = ({ status, title }) => {
  const { t } = useLocale();
  const Icon = ICONS[status];
  return (
    <span className={`rt-status rt-status-sm ov-tone-${ENDPOINT_TONE[status]}`} title={title}>
      <Icon size={12} />
      {t(`tr.endpointStatus.${status}`)}
    </span>
  );
};
