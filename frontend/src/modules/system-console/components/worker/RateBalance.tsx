import React from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { TONE_CLASS } from '@core/theme';
import { KeyValueGrid } from '@core/ui/blocks';
import type { DurationStats, RateBalance as Rates, WaitStats } from '../../types/worker.types';
import { DENSE_GRID, signedRate } from './worker-ui';

const STATE_ICON = { growing: TrendingUp, draining: TrendingDown, stable: Minus } as const;

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
}

interface Props {
  rates: Rates;
  wait: WaitStats;
  processing: DurationStats;
  /** Có job chờ lâu nhất → bấm số "lâu nhất" để mở Job Detail. */
  onOpenOldest?: () => void;
}

/**
 * Nhận vào vs Xử lý (queue đang dồn hay đang xả) + thời gian chờ trong queue + thời gian xử lý.
 * 500 job xử lý trong vài giây khác 500 job mà job cũ nhất đã chờ 3 giờ.
 */
export function RateBalance({ rates, wait, processing, onOpenOldest }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const tone = rates.state === 'growing' ? 'warn' : 'ok';
  const Icon = rates.state ? STATE_ICON[rates.state] : null;
  const oldest = wait.oldestSec === null ? null : f.duration(wait.oldestSec * 1000);
  return (
    <>
      <KeyValueGrid
        columns={3}
        className={DENSE_GRID[3]}
        items={[
          { label: t('wq.rates.incoming'), value: f.rate(rates.incomingPerMin, 'min'), mono: true },
          { label: t('wq.rates.processing'), value: f.rate(rates.processingPerMin, 'min'), mono: true },
          {
            label: t('wq.rates.diff'),
            value: <span className={rates.state === 'growing' ? TONE_CLASS.warn.fg : undefined}>{signedRate(f, rates.diffPerMin)}</span>,
            mono: true,
          },
        ]}
      />
      {rates.state && Icon && (
        <p className={cn('mt-2 flex items-center gap-1.5 text-xs', TONE_CLASS[tone].fg)}>
          <Icon className="size-3.5" />
          {t(`wq.rates.state.${rates.state}`)}
        </p>
      )}
      <SubTitle>{t('wq.wait.title')}</SubTitle>
      <KeyValueGrid
        columns={3}
        className={DENSE_GRID[3]}
        items={[
          { label: t('wq.common.avg'), value: f.duration(wait.avgMs), mono: true },
          { label: t('wq.common.p95'), value: f.duration(wait.p95Ms), mono: true },
          {
            label: t('wq.wait.oldest'),
            value:
              oldest && onOpenOldest ? (
                <button type="button" className="text-info-fg hover:underline" onClick={onOpenOldest}>
                  {oldest}
                </button>
              ) : (
                oldest
              ),
            mono: true,
          },
        ]}
      />
      <SubTitle>{t('wq.processing.title')}</SubTitle>
      <KeyValueGrid
        columns={4}
        className={DENSE_GRID[4]}
        items={[
          { label: t('wq.common.avg'), value: f.duration(processing.avgMs), mono: true },
          { label: t('wq.common.p50'), value: f.duration(processing.p50Ms), mono: true },
          { label: t('wq.common.p95'), value: f.duration(processing.p95Ms), mono: true },
          { label: t('wq.common.p99'), value: f.duration(processing.p99Ms), mono: true },
        ]}
      />
    </>
  );
}
