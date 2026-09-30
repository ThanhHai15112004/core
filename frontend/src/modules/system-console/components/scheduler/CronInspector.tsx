import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { CronInspect } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { useLocale } from '../../../../core/i18n/index';

const DEBOUNCE_MS = 350;

/** Cron Inspector: biểu thức → mô tả cho người đọc + các lần chạy kế tiếp theo múi giờ (công cụ nhỏ, chỉ đọc). */
export const CronInspector: React.FC<{ defaultTimezone: string; now: number }> = ({ defaultTimezone, now }) => {
  const { t, formatTime } = useLocale();
  const [expression, setExpression] = useState('0 */6 * * *');
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [result, setResult] = useState<CronInspect | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTimezone(defaultTimezone), [defaultTimezone]);
  useEffect(() => {
    if (!expression.trim()) return;
    let alive = true;
    const timer = setTimeout(() => {
      schedulerApi
        .cron(expression.trim(), timezone.trim() || undefined)
        .then((r) => {
          if (!alive) return;
          setResult(r);
          setError(null);
        })
        .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [expression, timezone]);

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.cron.title')}</h3>
        <span className="ov-section-hint">{t('sch.cron.hint')}</span>
      </header>
      <div className="sch-cron-form">
        <label>
          <span>{t('sch.cron.expression')}</span>
          <input value={expression} onChange={(e) => setExpression(e.target.value)} spellCheck={false} maxLength={120} />
        </label>
        <label>
          <span>{t('sch.cron.timezone')}</span>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} spellCheck={false} maxLength={64} />
        </label>
      </div>
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      {result && !error && (
        <>
          {result.valid ? (
            <p className="msg-status-line ov-tone-ok">
              <CheckCircle2 size={14} /> <strong>{result.description}</strong>
              <span>
                {result.timezone} ({result.utcOffset})
              </span>
            </p>
          ) : (
            <p className="msg-status-line ov-tone-crit">
              <XCircle size={14} /> <strong>{t('sch.cron.invalid')}</strong> <span>{result.error}</span>
            </p>
          )}
          {result.next.length > 0 && (
            <ol className="sch-cron-next">
              {result.next.map((at) => (
                <li key={at}>
                  {new Date(at).toLocaleDateString()} {formatTime(Date.parse(at), false)} <small className="pf-row-note">{formatIn(secondsUntil(at, now))}</small>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <p className="pf-chart-note">{t('sch.cron.note')}</p>
    </section>
  );
};
