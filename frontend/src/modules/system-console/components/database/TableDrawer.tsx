import React, { useEffect, useState } from 'react';
import type { DbTableDetail } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { DbDrawer } from './DbDrawer';
import { useLocale } from '../../../../core/i18n/index';

/** Chi tiết bảng: kích thước, hoạt động đọc/ghi, cột, index và số lần dùng (0 lần chỉ là dữ kiện). */
export const TableDrawer: React.FC<{ name: string; onClose: () => void }> = ({ name, onClose }) => {
  const { t, locale } = useLocale();
  const [data, setData] = useState<DbTableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    databaseApi
      .table(name)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <DbDrawer title={name} meta={data?.engine ?? undefined} onClose={onClose}>
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
      {data && (
        <>
          <dl className="db-stat-grid">
            <div><dt>{t('db.table.rows')}</dt><dd>{formatCompact(data.rows, locale)}</dd></div>
            <div><dt>{t('db.table.total')}</dt><dd>{formatBytes(data.totalBytes)}</dd></div>
            <div><dt>{t('db.table.data')}</dt><dd>{formatBytes(data.dataBytes)}</dd></div>
            <div><dt>{t('db.table.indexes')}</dt><dd>{formatBytes(data.indexBytes)}</dd></div>
            <div><dt>{t('db.table.readsPerSec')}</dt><dd>{data.readsPerSec ?? NO_VALUE}</dd></div>
            <div><dt>{t('db.table.writesPerSec')}</dt><dd>{data.writesPerSec ?? NO_VALUE}</dd></div>
            <div><dt>{t('db.table.growth')}</dt><dd>{data.growthPercent === null ? NO_VALUE : `${data.growthPercent > 0 ? '+' : ''}${data.growthPercent}%`}</dd></div>
          </dl>
          <p className="pf-chart-note">{t('db.table.rowsNote')}</p>
          <h4 className="pf-drawer-h">{t('db.table.indexList')}</h4>
          <table className="scp-table">
            <thead>
              <tr>
                <th>{t('db.table.index')}</th>
                <th>{t('db.table.columns')}</th>
                <th>{t('db.table.scans')}</th>
              </tr>
            </thead>
            <tbody>
              {data.indexes.map((i) => (
                <tr key={i.name}>
                  <td>
                    <code>{i.name}</code>
                    {i.primary ? <small className="pf-row-note">{t('db.table.primary')}</small> : i.unique ? <small className="pf-row-note">{t('db.table.unique')}</small> : null}
                  </td>
                  <td>{i.columns.join(', ')}</td>
                  <td>
                    {i.scans === null ? NO_VALUE : formatCompact(i.scans, locale)}
                    {i.scans === 0 && !i.primary && <small className="pf-row-note">{t('db.table.unused')}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pf-chart-note">{t('db.table.scansNote')}</p>
          <h4 className="pf-drawer-h">{t('db.table.columnList')}</h4>
          <table className="scp-table tr-kv-table">
            <tbody>
              {data.columns.map((c) => (
                <tr key={c.name}>
                  <th>{c.name}</th>
                  <td>
                    <code>{c.type}</code>
                    {c.nullable && <small> · NULL</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </DbDrawer>
  );
};
