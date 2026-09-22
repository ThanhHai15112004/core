import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { RequestKind, TrafficFilters } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { REQUEST_PAGE_SIZE } from '../../constants/traffic';
import { RequestTable } from '../../components/traffic/RequestTable';
import { downloadCsv } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

/** Backend trả tối đa 200 request mỗi lần. */
const MAX_LIMIT = 200;

interface RequestsPanelProps {
  filters: TrafficFilters;
  paused: boolean;
  title: string;
  onOpen: (id: string) => void;
  kind?: RequestKind;
  routeId?: string;
  minMs?: number;
  slowMs?: number;
  emptyText?: string;
  /** Số dòng cố định (không phân trang, không export) — dùng cho khối tóm tắt. */
  fixedLimit?: number;
  footer?: React.ReactNode;
}

/** Danh sách request từ log nhẹ của backend (mọi request), cập nhật live, xuất CSV được. */
export const RequestsPanel: React.FC<RequestsPanelProps> = ({
  filters,
  paused,
  title,
  onOpen,
  kind,
  routeId,
  minMs,
  slowMs,
  emptyText,
  fixedLimit,
  footer,
}) => {
  const { t } = useLocale();
  const [pages, setPages] = useState(1);
  const limit = fixedLimit ?? Math.min(MAX_LIMIT, REQUEST_PAGE_SIZE * pages);
  const params = { limit, ...(kind ? { kind } : {}), ...(routeId ? { routeId } : {}), ...(minMs !== undefined ? { minMs } : {}) };
  const key = `${JSON.stringify(filters)}:${JSON.stringify(params)}`;
  const { data, error } = usePolling(() => trafficApi.requests(filters, params), key, undefined, paused);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `http-requests-${new Date().toISOString().slice(0, 19)}.csv`,
      ['time', 'method', 'route', 'path', 'status', 'duration_ms', 'error_code', 'instance', 'request_id', 'correlation_id'],
      data.items.map((r) => [
        new Date(r.at).toISOString(),
        r.method,
        r.route,
        r.path,
        r.status,
        r.durationMs,
        r.errorCode,
        r.instance,
        r.id,
        r.correlationId,
      ]),
    );
  };

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title}</h3>
        {data && !fixedLimit && (
          <div className="tr-head-actions">
            <span className="ov-section-hint">{t('tr.requests.shown', { shown: data.items.length, total: data.total })}</span>
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={exportCsv} disabled={data.items.length === 0}>
              <Download size={13} /> {t('tr.requests.export')}
            </button>
          </div>
        )}
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      <RequestTable
        items={data?.items ?? (error ? [] : null)}
        onOpen={onOpen}
        emptyText={emptyText ?? t('tr.requests.empty')}
        {...(slowMs !== undefined ? { slowMs } : {})}
      />
      {!fixedLimit && data && data.nextOffset !== null && (
        <footer className="ov-section-foot">
          {limit < MAX_LIMIT ? (
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPages((p) => p + 1)}>
              {t('tr.requests.more')}
            </button>
          ) : (
            <span className="ov-section-hint">{t('tr.requests.narrow', { max: MAX_LIMIT })}</span>
          )}
        </footer>
      )}
      {!fixedLimit && data && (
        <p className="tr-note-inline">{t('tr.requests.retention', { count: data.retained.toLocaleString() })}</p>
      )}
      {footer && <footer className="ov-section-foot">{footer}</footer>}
    </section>
  );
};
