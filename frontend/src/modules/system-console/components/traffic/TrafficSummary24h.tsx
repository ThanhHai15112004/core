import React from 'react';
import type { TrafficInsights } from '../../types/traffic.types';
import { formatCount, formatMs, formatRps } from '../../utils/traffic-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Báo cáo nhỏ 24h qua (dùng aggregate phút — Reports sau này lấy cùng nguồn). */
export const TrafficSummary24h: React.FC<{ insights: TrafficInsights | null }> = ({ insights }) => {
  const { t, locale, formatTime } = useLocale();
  const s = insights?.last24h;
  const rows = s
    ? [
        { label: t('tr.summary24h.total'), value: formatCount(s.total, locale) },
        { label: t('tr.summary24h.successful'), value: formatCount(s.successful, locale) },
        { label: t('tr.summary24h.clientErrors'), value: formatCount(s.clientErrors, locale) },
        { label: t('tr.summary24h.serverErrors'), value: formatCount(s.serverErrors, locale), bad: s.serverErrors > 0 },
        {
          label: t('tr.summary24h.peak'),
          value: s.peak ? `${formatRps(s.peak.requestsPerSecond)} req/s · ${formatTime(s.peak.at, false)}` : NO_VALUE,
        },
        {
          label: t('tr.summary24h.slowest'),
          value: s.slowest
            ? `${formatTime(s.slowest.from, false)}–${formatTime(s.slowest.to, false)} · P95 ${formatMs(s.slowest.p95LatencyMs)}`
            : NO_VALUE,
        },
      ]
    : [];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('tr.summary24h.title')}</h3>
      </header>
      {!s ? (
        <p className="ov-empty-line">{t('common.loading')}</p>
      ) : (
        <dl className="rt-kv">
          {rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd className={r.bad ? 'tr-bad' : ''}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
};
