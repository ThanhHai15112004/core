import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { ConfigGroups, ConfigSheet, CopyButton, QueryView, type ConfigGroup } from '@core/ui/blocks';
import type { CacheConfig } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { cacheKeys } from './cache-keys';

type Item = CacheConfig['items'][number];
/** Giá trị số hiển thị nguyên dạng (không phân cách hàng nghìn). */
const RAW_NUMBER_KEYS = new Set(['port', 'database']);

/** Cấu hình cache đang nạp (chỉ đọc) — host/port/prefix ở đây; mật khẩu chỉ hiện "đã cấu hình". */
export function CacheConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(cacheKeys.config(), () => cacheApi.config(), { tier: 'static', enabled: open });

  const render = (i: Item) => {
    if (i.sensitive) return <Badge tone={i.value ? 'ok' : undefined}>{i.value ? t('cache.config.configured') : t('cache.config.notConfigured')}</Badge>;
    if (typeof i.value === 'boolean') return i.value ? t('cache.config.yes') : t('cache.config.no');
    if (i.value === null) return null;
    if (i.key === 'maxMemory') return i.value === 0 ? t('cache.memory.unlimited') : f.bytes(Number(i.value));
    if (i.key === 'largeKeyBytes') return f.bytes(Number(i.value));
    if (i.key === 'defaultTtlSec') return i.value === 0 ? t('cache.ttl.none') : f.duration(Number(i.value) * 1000);
    if (typeof i.value === 'number') return RAW_NUMBER_KEYS.has(i.key) ? String(i.value) : f.number(i.value);
    return String(i.value);
  };
  const groupsOf = (d: CacheConfig): ConfigGroup[] =>
    [...new Set(d.items.map((i) => i.group))].map((g) => ({
      id: g,
      title: t(`cache.config.group.${g}`),
      items: d.items.filter((i) => i.group === g).map((i) => ({ key: i.key, label: t(`cache.config.key.${i.key}`), value: render(i), mono: !i.sensitive && typeof i.value !== 'boolean' })),
    }));
  const safeJson = (d: CacheConfig) => JSON.stringify(Object.fromEntries(d.items.filter((i) => !i.sensitive).map((i) => [i.key, i.value])), null, 2);

  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('cache.config.title')} subtitle={t('cache.config.note')}>
      <QueryView query={query}>
        {(d) => (
          <>
            <div className="mb-3 flex justify-end">
              <CopyButton value={safeJson(d)} label={t('cache.config.copy')} size="xs" />
            </div>
            <ConfigGroups groups={groupsOf(d)} />
          </>
        )}
      </QueryView>
    </ConfigSheet>
  );
}
