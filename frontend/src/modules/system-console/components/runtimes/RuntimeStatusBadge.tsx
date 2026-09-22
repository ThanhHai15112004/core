import React from 'react';
import { AlertTriangle, CheckCircle2, CircleStop, HelpCircle, Loader2, RotateCw, XCircle } from 'lucide-react';
import type { RuntimeStatus } from '../../types/runtime.types';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

const ICONS: Record<RuntimeStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  starting: Loader2,
  restarting: RotateCw,
  stopping: Loader2,
  stopped: CircleStop,
  crashed: XCircle,
  unknown: HelpCircle,
};

const SPINNING = new Set<RuntimeStatus>(['starting', 'restarting', 'stopping']);

export const RuntimeStatusBadge: React.FC<{ status: RuntimeStatus; size?: 'sm' | 'md' }> = ({ status, size = 'md' }) => {
  const { t } = useLocale();
  const Icon = ICONS[status];
  return (
    <span className={`rt-status rt-status-${size} ov-tone-${toneOf(status)} is-${status}`}>
      <Icon size={size === 'sm' ? 12 : 14} className={SPINNING.has(status) ? 'ov-spin' : ''} />
      {t(`rt.status.${status}`)}
    </span>
  );
};
