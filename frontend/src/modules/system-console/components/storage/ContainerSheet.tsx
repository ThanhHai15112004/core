import { Search } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button } from '@core/ui/primitives';
import { AlertList, DetailSection, DetailSheet, KeyValueGrid, QueryView, RelativeTime } from '@core/ui/blocks';
import { BarList, TimeSeriesChart } from '@core/ui/charts';
import type { StorageRange } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { CONTAINER_LARGEST_LIMIT, HISTORY_MIN_POINTS } from '../../constants/storage';
import { storageKeys } from '../../sections/storage/storage-keys';
import { useContainerLabel } from './useContainerLabel';

interface ContainerSheetProps {
  name: string | null;
  range: StorageRange;
  driver: 'local' | 's3' | undefined;
  onClose: () => void;
  onBrowse: (container: string) => void;
  onOpenObject: (key: string) => void;
}

/** Chi tiết container: số object, dung lượng, tăng trưởng, loại file, object lớn nhất, lỗi gần đây; Duyệt object. */
export function ContainerSheet({ name, range, driver, onClose, onBrowse, onOpenObject }: ContainerSheetProps) {
  const { t } = useLocale();
  const f = useFormat();
  const label = useContainerLabel();
  const query = useLiveQuery(storageKeys.container(name ?? '', range), () => storageApi.container(name ?? '', range), { tier: 'slow', enabled: Boolean(name), keepPrevious: false });

  return (
    <DetailSheet
      open={Boolean(name)}
      onOpenChange={(o) => !o && onClose()}
      title={<span className="font-mono">{name ? label(name) : ''}</span>}
      subtitle={t(`storage.container.title.${driver === 's3' ? 's3' : 'local'}`)}
      width="lg"
      actions={
        <Button size="sm" onClick={() => name && onBrowse(name)}>
          <Search />
          {t('storage.container.browse')}
        </Button>
      }
    >
      <QueryView query={query}>
        {(d) => (
          <>
            <DetailSection title={t('storage.container.summary')}>
              <KeyValueGrid
                columns={3}
                items={[
                  { label: t('storage.container.objects'), value: f.compact(d.container.objects), mono: true },
                  { label: t('storage.container.size'), value: f.bytes(d.container.bytes), mono: true },
                  { label: t('storage.container.growth'), value: f.signedBytes(d.container.growth24hBytes), mono: true },
                  { label: t('storage.container.createdToday'), value: f.compact(d.container.createdToday), mono: true },
                  { label: t('storage.container.newest'), value: d.container.newest ? <RelativeTime value={d.container.newest} /> : null },
                  { label: t('storage.container.errors'), value: <span className={d.container.errors > 0 ? 'text-crit-fg' : undefined}>{f.number(d.container.errors)}</span>, mono: true },
                ]}
              />
            </DetailSection>
            <DetailSection title={t('storage.usage.growthChart')}>
              <TimeSeriesChart
                series={[{ id: 'bytes', label: t('storage.usage.size'), color: 'series-1', area: true, points: d.history.length >= HISTORY_MIN_POINTS ? d.history.map((h) => ({ t: h.t, v: h.bytes })) : [] }]}
                format={(v) => f.bytes(v)}
                height="sm"
                emptyMessage={t('storage.usage.noHistory')}
                ariaLabel={t('storage.usage.growthChart')}
              />
            </DetailSection>
            {d.byKind.length > 0 && (
              <DetailSection title={t('storage.usage.byKind')}>
                <BarList
                  items={[...d.byKind]
                    .sort((a, b) => b.bytes - a.bytes)
                    .map((k) => ({ id: k.kind, label: t(`storage.kind.${k.kind}`), value: k.bytes, display: f.bytes(k.bytes), sub: f.compact(k.objects) }))}
                />
              </DetailSection>
            )}
            {d.largest.length > 0 && (
              <DetailSection title={t('storage.usage.largest')}>
                <BarList
                  items={d.largest.slice(0, CONTAINER_LARGEST_LIMIT).map((o) => ({
                    id: o.key,
                    label: <span className="font-mono text-xs">{o.key}</span>,
                    value: o.size,
                    display: f.bytes(o.size),
                    tone: o.large ? 'warn' : undefined,
                    onClick: () => onOpenObject(o.key),
                  }))}
                />
              </DetailSection>
            )}
            <DetailSection title={t('storage.errors.recent')}>
              <AlertList
                emptyMessage={t('storage.errors.noneContainer')}
                items={d.recentErrors.map((e, i) => ({
                  id: `${e.at}-${i}`,
                  tone: e.kind === 'not_found' ? 'unknown' : 'warn',
                  title: `${e.op.toUpperCase()} ${e.key}`,
                  detail: `${e.code ?? t(`storage.errors.kind.${e.kind}`)} · ${e.message}`,
                  since: e.at,
                }))}
              />
            </DetailSection>
          </>
        )}
      </QueryView>
    </DetailSheet>
  );
}
