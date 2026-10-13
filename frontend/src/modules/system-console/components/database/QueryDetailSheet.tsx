import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button } from '@core/ui/primitives';
import { CodeBlock, DetailSection, DetailSheet, KeyValueGrid, QueryView } from '@core/ui/blocks';
import type { DbQueryStat, DbRange } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_LOG_MODULE, DB_SQL_MAX_HEIGHT_PX } from '../../constants/database';
import { dbKeys } from '../../sections/database/database-keys';
import { ExplainPlan } from './ExplainPlan';
import { dateTime } from './db-labels';

interface Props {
  id: string | null;
  range: DbRange;
  onClose: () => void;
  navigate: (path: string) => void;
}

/** Chi tiết một dạng câu query (digest): SQL chuẩn hoá, thống kê cộng dồn của database, execution plan. */
export function QueryDetailSheet({ id, range, onClose, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(dbKeys.query(id ?? '', range), () => databaseApi.queryDetail(id!, range), { tier: 'static', enabled: Boolean(id), keepPrevious: false });
  const s = query.data?.stat;
  const body = (content: (stat: DbQueryStat) => ReactNode) => <QueryView query={query}>{(d) => content(d.stat)}</QueryView>;
  return (
    <DetailSheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={t('db.query.title')}
      status={s ? { tone: s.slow ? 'warn' : 'ok', label: s.slow ? t('db.query.slow') : t('db.query.normal') } : undefined}
      actions={
        <Button size="sm" onClick={() => navigate(`logs/explorer?module=${DB_LOG_MODULE}`)}>
          <FileText />
          {t('db.query.openLogs')}
        </Button>
      }
      tabs={[
        { id: 'summary', label: t('db.query.tab.summary'), content: body((stat) => <QuerySummary s={stat} />) },
        { id: 'plan', label: t('db.query.tab.plan'), content: id ? <ExplainPlan id={id} /> : null },
      ]}
    />
  );
}

function QuerySummary({ s }: { s: DbQueryStat }) {
  const { t, locale, formatTime } = useLocale();
  const f = useFormat();
  const ms = (v: number | null) => (s.timingReliable ? f.duration(v) : t('db.query.unreliable'));
  return (
    <>
      <DetailSection title={t('db.session.query')}>
        <CodeBlock code={s.sql} wrap maxHeight={DB_SQL_MAX_HEIGHT_PX} />
      </DetailSection>
      {!s.timingReliable && <p className="mb-5 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn-fg">{t('db.query.unreliableNote')}</p>}
      <DetailSection title={t('db.query.statsTitle')} hint={t('db.query.cumulativeNote')}>
        <KeyValueGrid
          columns={2}
          items={[
            { label: t('db.query.avg'), value: ms(s.avgMs), mono: s.timingReliable },
            { label: t('db.query.max'), value: ms(s.maxMs), mono: s.timingReliable },
            { label: t('db.query.calls'), value: f.compact(s.calls), mono: true },
            { label: t('db.query.errors'), value: f.number(s.errors), mono: true },
            { label: t('db.query.rowsExamined'), value: f.compact(s.rowsExamined), mono: true },
            { label: t('db.query.rowsReturned'), value: f.compact(s.rowsReturned), mono: true },
            { label: t('db.query.noIndex'), value: f.compact(s.noIndexUsed), mono: true },
            { label: t('db.query.lastSeen'), value: s.lastSeen ? dateTime(s.lastSeen, locale, formatTime) : null, mono: true },
          ]}
        />
      </DetailSection>
    </>
  );
}
