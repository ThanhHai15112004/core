import React from 'react';
import { AlertTriangle, CheckCircle2, FileText, XOctagon } from 'lucide-react';
import type { MultipartUpload, StorageErrorItem, StorageRange, StorageTab } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { SectionState } from '../../components/database/SectionState';
import { BarList } from '../../components/cache/TtlDistribution';
import { CapacityCard } from '../../components/storage/CapacityCard';
import { LineChart } from '../../components/common/LineChart';
import { AGE_BUCKETS } from '../../constants/storage';
import { formatBytes, formatCompact, formatDuration } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatGrowth, toStorageChart } from '../../utils/storage-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type Go = (tab: StorageTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;

/** Bảng lỗi upload/download → mở log theo correlationId. */
const FailureTable: React.FC<{ items: StorageErrorItem[]; emptyText: string; navigate: (p: string) => void }> = ({ items, emptyText, navigate }) => {
  const { t, formatTime } = useLocale();
  if (items.length === 0)
    return (
      <p className="cache-ok-line">
        <CheckCircle2 size={15} /> {emptyText}
      </p>
    );
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            <th>{t('db.errors.time')}</th>
            <th>{t('storage.object.key')}</th>
            <th>{t('storage.object.size')}</th>
            <th>{t('db.errors.message')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((e, i) => (
            <tr key={`${e.at}-${i}`}>
              <td>{formatTime(Date.parse(e.at), true)}</td>
              <td className="cache-key-cell">
                <code>{e.key}</code>
              </td>
              <td>{formatBytes(e.size)}</td>
              <td className="db-sql-cell">
                <span className={`pf-chip ov-tone-${e.kind === 'not_found' ? 'unknown' : 'warn'}`}>{e.code ?? t(`storage.errors.kind.${e.kind}`)}</span>
                <span>{e.message}</span>
              </td>
              <td>
                {e.correlationId && (
                  <button
                    type="button"
                    className="ov-link"
                    onClick={() => navigate(`logs?runtime=${e.runtime ?? 'api'}&correlationId=${encodeURIComponent(e.correlationId!)}`)}
                  >
                    <FileText size={12} /> {t('db.query.openLogs')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Upload: đang chạy (tiến độ), multipart dở (stale + Abort), upload/download thất bại. */
export const StorageUploadsView: React.FC<{
  range: StorageRange;
  paused: boolean;
  product: string;
  reloadKey: number;
  navigate: (p: string) => void;
  onAbort: (u: MultipartUpload) => void;
}> = ({ range, paused, product, reloadKey, navigate, onAbort }) => {
  const { t } = useLocale();
  const { data } = usePolling(() => storageApi.uploads(range), `uploads:${range}:${reloadKey}`, 5000, paused);
  const multipart = data?.multipart.available ? data.multipart.data : null;
  const stale = multipart?.filter((m) => m.stale) ?? [];
  return (
    <>
      <div className="ov-kpi-grid db-kpi-grid">
        {[
          { key: 'active', value: data ? String(data.active.length) : NO_VALUE, tone: 'unknown' },
          { key: 'completedPerMin', value: formatUnit(data?.completedPerMin ?? null, '/min'), tone: 'unknown' },
          { key: 'failed', value: data ? String(data.failedUploads.length) : NO_VALUE, tone: (data?.failedUploads.length ?? 0) > 0 ? 'warn' : 'ok' },
          { key: 'avgDuration', value: formatUnit(data?.avgUploadMs ?? null, 'ms'), tone: 'unknown' },
        ].map((k) => (
          <div key={k.key} className={`ov-card ov-kpi ov-tone-${k.tone}`}>
            <span className="ov-kpi-label">{t(`storage.uploads.${k.key}`)}</span>
            <span className="ov-kpi-value">{k.value}</span>
          </div>
        ))}
      </div>
      {stale.length > 0 && (
        <p className="scp-alert-warning">
          <AlertTriangle size={13} /> <strong>{t('storage.uploads.staleTitle')}</strong>{' '}
          {t('storage.uploads.staleMessage', {
            count: stale.length,
            minutes: data?.staleUploadMin ?? 60,
            size: formatBytes(stale.reduce((s, u) => s + (u.uploadedBytes ?? 0), 0)),
          })}
        </p>
      )}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.uploads.activeTitle')}</h3>
          <span className="ov-section-hint">{t('storage.uploads.activeHint')}</span>
        </header>
        {!data || data.active.length === 0 ? (
          <p className="ov-empty-line">{data ? t('storage.uploads.noActive') : t('common.loading')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('storage.object.key')}</th>
                  <th>{t('storage.object.size')}</th>
                  <th>{t('storage.uploads.progress')}</th>
                  <th>{t('storage.uploads.age')}</th>
                  <th>{t('db.session.source')}</th>
                </tr>
              </thead>
              <tbody>
                {data.active.map((a) => (
                  <tr key={a.id}>
                    <td className="cache-key-cell">
                      <code>{a.key}</code>
                      {a.multipart && <span className="pf-chip ov-tone-unknown cache-chip">multipart</span>}
                    </td>
                    <td>{formatBytes(a.size)}</td>
                    <td>
                      <span className="rt-bar st-progress">
                        <span style={{ width: `${Math.min(100, a.percent ?? 0)}%` }} />
                      </span>
                      <small>{a.percent === null ? NO_VALUE : `${a.percent}%`}</small>
                    </td>
                    <td>{formatDuration(a.ageSec * 1000)}</td>
                    <td>{a.runtime ? t(`rt.name.${a.runtime}`) : NO_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.uploads.multipartTitle')}</h3>
        </header>
        {data && (
          <SectionState section={data.multipart} driver={product} scope="storage">
            {(list) =>
              list.length === 0 ? (
                <p className="cache-ok-line">
                  <CheckCircle2 size={15} /> {t('storage.uploads.noMultipart')}
                </p>
              ) : (
                <div className="scp-table-wrap">
                  <table className="scp-table">
                    <thead>
                      <tr>
                        <th>{t('storage.object.key')}</th>
                        <th>{t('storage.uploads.parts')}</th>
                        <th>{t('storage.uploads.uploaded')}</th>
                        <th>{t('storage.uploads.age')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((u) => (
                        <tr key={u.uploadId} className={u.stale ? 'db-row-warn' : ''}>
                          <td className="cache-key-cell">
                            <code>{u.key}</code>
                            {u.stale && <span className="pf-chip ov-tone-warn cache-chip">{t('storage.uploads.staleChip')}</span>}
                          </td>
                          <td>{u.parts ?? NO_VALUE}</td>
                          <td>{formatBytes(u.uploadedBytes)}</td>
                          <td>{u.ageMin === null ? NO_VALUE : formatDuration(u.ageMin * 60_000)}</td>
                          <td className="db-actions-cell">
                            <button
                              type="button"
                              className="rt-icon-btn is-danger"
                              disabled={!data.abortEnabled}
                              title={data.abortEnabled ? t('storage.uploads.abort') : t('storage.action.abortDisabled')}
                              aria-label={t('storage.uploads.abort')}
                              onClick={() => onAbort(u)}
                            >
                              <XOctagon size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </SectionState>
        )}
      </section>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.uploads.failedUploads')}</h3>
          </header>
          {data && <FailureTable items={data.failedUploads} emptyText={t('storage.uploads.noFailedUploads')} navigate={navigate} />}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.uploads.failedDownloads')}</h3>
          </header>
          {data && <FailureTable items={data.failedDownloads} emptyText={t('storage.uploads.noFailedDownloads')} navigate={navigate} />}
        </section>
      </div>
    </>
  );
};

/** Usage: capacity, tăng trưởng theo thời gian, object count, theo loại file, theo tuổi, object lớn nhất. */
export const StorageUsageView: React.FC<{ product: string; reloadKey: number; go: Go }> = ({ product, reloadKey, go }) => {
  const { t, locale, formatTime } = useLocale();
  const { data } = usePolling(() => storageApi.usage(), `usage:${reloadKey}`, 60_000);
  const bytes = data
    ? toStorageChart([{ id: 'bytes', label: t('storage.usage.size'), unit: 'B', points: data.history.map((h) => ({ t: h.t, value: h.bytes })) }])
    : null;
  // Lịch sử chụp mỗi giờ: chưa đủ 2 điểm thì hiện "chưa có lịch sử" thay vì một điểm lẻ.
  const objects =
    data && data.history.length >= 2
      ? toStorageChart([{ id: 'objects', label: t('storage.usage.objects'), unit: '', points: data.history.map((h) => ({ t: h.t, value: h.objects })) }])
      : { series: [], unit: '' };
  const dateTime = (ts: number) => `${new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${formatTime(ts)}`;
  return (
    <>
      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.capacity.title')}</h3>
            {data?.usageAt && <span className="ov-section-hint">{t('storage.usage.scannedAt', { time: new Date(data.usageAt).toLocaleTimeString() })}</span>}
          </header>
          {data && <CapacityCard capacity={data.capacity} growth={data.growth} usedBytes={data.usedBytes} product={product} />}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.usage.objectsTitle')}</h3>
          </header>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('storage.usage.total')}</dt>
              <dd>
                {formatCompact(data?.totalObjects, locale)}
                {data?.truncated ? '+' : ''}
              </dd>
            </div>
            <div>
              <dt>{t('storage.usage.createdToday')}</dt>
              <dd>{formatCompact(data?.growth.createdToday, locale)}</dd>
            </div>
            <div>
              <dt>{t('storage.usage.deletedToday')}</dt>
              <dd>{formatCompact(data?.growth.deletedTodayEstimate, locale)}</dd>
            </div>
            <div>
              <dt>{t('storage.usage.netChange')}</dt>
              <dd>
                {data?.growth.todayObjects === null || !data
                  ? NO_VALUE
                  : `${data.growth.todayObjects > 0 ? '+' : ''}${formatCompact(data.growth.todayObjects, locale)}`}
              </dd>
            </div>
          </dl>
          <p className="pf-chart-note">
            {data?.truncated ? t('storage.usage.truncatedNote', { count: formatCompact(data.scannedObjects, locale) }) : t('storage.usage.deletedNote')}
          </p>
        </section>
      </div>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.usage.growthChart')}</h3>
            <span className="ov-section-hint">
              {t('storage.usage.growthHint', { d7: formatGrowth(data?.growth.d7Bytes), d30: formatGrowth(data?.growth.d30Bytes) })}
            </span>
          </header>
          {bytes && (
            <LineChart
              series={bytes.series}
              unit={bytes.unit}
              formatTime={dateTime}
              emptyText={t('storage.usage.noHistory')}
              ariaLabel={t('storage.usage.growthChart')}
            />
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.usage.objectsChart')}</h3>
          </header>
          {objects && (
            <LineChart
              series={objects.series}
              unit=""
              formatTime={dateTime}
              emptyText={t('storage.usage.noHistory')}
              ariaLabel={t('storage.usage.objectsChart')}
            />
          )}
        </section>
      </div>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.usage.byKind')}</h3>
          </header>
          {data && (
            <BarList
              items={data.byKind
                .filter((k) => k.objects > 0)
                .sort((a, b) => b.bytes - a.bytes)
                .map((k) => ({
                  id: k.kind,
                  label: t(`storage.kind.${k.kind}`),
                  value: k.bytes,
                  text: `${formatBytes(k.bytes)} · ${formatCompact(k.objects, locale)}`,
                  onClick: () => go('objects', null, { kind: k.kind }),
                }))}
            />
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.usage.byAge')}</h3>
          </header>
          {data && (
            <BarList
              items={AGE_BUCKETS.map((b) => data.byAge.find((a) => a.bucket === b)!).map((a) => ({
                id: a.bucket,
                label: t(`storage.usage.age.${a.bucket}`),
                value: a.bytes,
                text: `${formatBytes(a.bytes)} · ${formatCompact(a.objects, locale)}`,
              }))}
            />
          )}
        </section>
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.usage.largest')}</h3>
          <span className="ov-section-hint">{t('storage.usage.largeHint', { size: formatBytes(data?.largeObjectBytes ?? 0) })}</span>
        </header>
        {!data || data.largest.length === 0 ? (
          <p className="ov-empty-line">{data ? t('storage.empty') : t('common.loading')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table cache-key-table">
              <thead>
                <tr>
                  <th>{t('storage.object.key')}</th>
                  <th>{t('storage.objects.kind')}</th>
                  <th>{t('storage.object.size')}</th>
                </tr>
              </thead>
              <tbody>
                {data.largest.map((o) => (
                  <tr key={o.key} className={`is-clickable ${o.large ? 'db-row-warn' : ''}`} onClick={() => go('objects', o.key)}>
                    <td className="cache-key-cell">
                      <code>{o.key}</code>
                      {o.large && <span className="pf-chip ov-tone-warn cache-chip">{t('storage.usage.largeChip')}</span>}
                    </td>
                    <td>{t(`storage.kind.${o.kind}`)}</td>
                    <td>{formatBytes(o.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};

/** Lifecycle: rule (chỉ đọc), ước tính object quá hạn, versioning/object lock. */
export const StorageLifecycleView: React.FC<{ product: string }> = ({ product }) => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => storageApi.lifecycle(), 'lifecycle', 60_000);
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.lifecycle.title')}</h3>
          <span className="ov-section-hint">{t('storage.lifecycle.hint')}</span>
        </header>
        {data && (
          <SectionState section={data.lifecycle} driver={product} scope="storage">
            {(l) => (
              <>
                <dl className="db-stat-grid db-stat-compact">
                  <div>
                    <dt>{t('storage.lifecycle.versioning')}</dt>
                    <dd>{l.versioning ? t(`storage.lifecycle.versioningState.${l.versioning}`) : NO_VALUE}</dd>
                  </div>
                  <div>
                    <dt>{t('storage.lifecycle.objectLock')}</dt>
                    <dd>{l.objectLock === null ? NO_VALUE : l.objectLock ? t('db.config.yes') : t('db.config.no')}</dd>
                  </div>
                  <div>
                    <dt>{t('storage.lifecycle.rules')}</dt>
                    <dd>{l.rules.length}</dd>
                  </div>
                </dl>
                {l.rules.length === 0 ? (
                  <p className="ov-empty-line">{t('storage.lifecycle.noRules')}</p>
                ) : (
                  <div className="scp-table-wrap">
                    <table className="scp-table">
                      <thead>
                        <tr>
                          <th>{t('storage.lifecycle.name')}</th>
                          <th>{t('storage.lifecycle.prefix')}</th>
                          <th>{t('storage.lifecycle.action')}</th>
                          <th>{t('storage.lifecycle.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.rules.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <code>{r.id}</code>
                            </td>
                            <td>
                              <code>{r.prefix || t('storage.lifecycle.allObjects')}</code>
                            </td>
                            <td>
                              {r.actions.map((a) => (
                                <div key={`${a.type}-${a.days}`}>
                                  {t(`storage.lifecycle.actionType.${a.type}`, { days: a.days ?? '?', cls: a.storageClass ?? '' })}
                                </div>
                              ))}
                            </td>
                            <td>
                              <span className={`pf-chip ov-tone-${r.status === 'enabled' ? 'ok' : 'unknown'}`}>{t(`storage.lifecycle.state.${r.status}`)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </SectionState>
        )}
      </section>
      {data?.estimate && data.estimate.length > 0 && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.lifecycle.estimateTitle')}</h3>
            <span className="ov-section-hint">{t('storage.lifecycle.estimateHint')}</span>
          </header>
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('storage.lifecycle.name')}</th>
                  <th>{t('storage.lifecycle.prefix')}</th>
                  <th>{t('storage.lifecycle.pastDue')}</th>
                  <th>{t('storage.lifecycle.freed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.estimate.map((e) => (
                  <tr key={`${e.rule}-${e.days}`}>
                    <td>
                      <code>{e.rule}</code>
                    </td>
                    <td>
                      <code>{e.prefix || '*'}</code>
                    </td>
                    <td>
                      {formatCompact(e.objects, locale)}
                      {e.capped ? '+' : ''} <small className="pf-row-note">{t('storage.lifecycle.olderThan', { days: e.days })}</small>
                    </td>
                    <td>{formatBytes(e.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pf-chart-note">{t('storage.lifecycle.activityNote')}</p>
        </section>
      )}
    </>
  );
};
