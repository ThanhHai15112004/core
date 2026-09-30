import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { DurationStats, RateBalance as Rates, WaitStats } from '../../types/worker.types';
import { formatJobRate, formatMs, formatSignedRate } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Incoming vs Processing (queue đang dồn hay đang xả), thời gian chờ trong queue và thời gian xử lý.
 * Trực quan hơn một con số "Waiting = 482": 500 job xử lý trong vài giây khác 500 job + cũ nhất 3 giờ.
 */
export const RateBalance: React.FC<{ rates: Rates; wait: WaitStats; processing: DurationStats; onOpenOldest?: (() => void) | undefined }> = ({
  rates,
  wait,
  processing,
  onOpenOldest,
}) => {
  const { t } = useLocale();
  const Icon = rates.state === 'draining' ? TrendingDown : TrendingUp;
  return (
    <>
      <dl className="db-stat-grid msg-balance">
        <div>
          <dt>{t('wq.rates.incoming')}</dt>
          <dd>{formatJobRate(rates.incomingPerMin)}</dd>
        </div>
        <div>
          <dt>{t('wq.rates.processing')}</dt>
          <dd>{formatJobRate(rates.processingPerMin)}</dd>
        </div>
        <div>
          <dt>{t('wq.rates.diff')}</dt>
          <dd className={rates.state === 'growing' ? 'is-warn' : ''}>{formatSignedRate(rates.diffPerMin)}</dd>
        </div>
      </dl>
      {rates.state && (
        <p className={`msg-status-line ov-tone-${rates.state === 'growing' ? 'warn' : 'ok'}`}>
          {rates.state !== 'stable' && <Icon size={14} />} {t(`wq.rates.state.${rates.state}`)}
        </p>
      )}
      <h4>{t('wq.wait.title')}</h4>
      <dl className="db-stat-grid db-stat-compact">
        <div>
          <dt>{t('wq.wait.avg')}</dt>
          <dd>{formatMs(wait.avgMs)}</dd>
        </div>
        <div>
          <dt>P95</dt>
          <dd>{formatMs(wait.p95Ms)}</dd>
        </div>
        <div>
          <dt>{t('wq.wait.oldest')}</dt>
          <dd>
            {wait.oldestSec !== null && onOpenOldest && wait.oldestJobId ? (
              <button type="button" className="ov-link" onClick={onOpenOldest}>
                {formatMs(wait.oldestSec * 1000)}
              </button>
            ) : (
              formatMs(wait.oldestSec === null ? null : wait.oldestSec * 1000)
            )}
          </dd>
        </div>
      </dl>
      <h4>{t('wq.processing.title')}</h4>
      <dl className="db-stat-grid db-stat-compact">
        <div>
          <dt>{t('wq.processing.avg')}</dt>
          <dd>{formatMs(processing.avgMs)}</dd>
        </div>
        <div>
          <dt>P50</dt>
          <dd>{formatMs(processing.p50Ms)}</dd>
        </div>
        <div>
          <dt>P95</dt>
          <dd>{formatMs(processing.p95Ms)}</dd>
        </div>
        <div>
          <dt>P99</dt>
          <dd>{formatMs(processing.p99Ms)}</dd>
        </div>
      </dl>
    </>
  );
};
