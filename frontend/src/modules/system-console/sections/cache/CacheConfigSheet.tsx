import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { ConfigItems, ConfigSheet, QueryView, type ConfigItem } from '@core/ui/blocks';
import { cacheApi } from '../../services/cache.api';
import { cacheKeys } from './cache-keys';

/** Giá trị số hiển thị nguyên dạng (không phân cách hàng nghìn). */
const RAW_NUMBER_KEYS = new Set(['port', 'database']);

/** Cấu hình cache đang nạp (chỉ đọc) — host/port/prefix ở đây; mật khẩu chỉ hiện "đã cấu hình". */
export function CacheConfigSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(cacheKeys.config(), () => cacheApi.config(), { tier: 'static', enabled: open });

  const format = (i: ConfigItem) => {
    if (i.value === null || typeof i.value === 'boolean') return undefined;
    if (i.key === 'maxMemory') return i.value === 0 ? t('cache.memory.unlimited') : f.bytes(Number(i.value));
    if (i.key === 'largeKeyBytes') return f.bytes(Number(i.value));
    if (i.key === 'defaultTtlSec') return i.value === 0 ? t('cache.ttl.none') : f.duration(Number(i.value) * 1000);
    if (RAW_NUMBER_KEYS.has(i.key)) return String(i.value);
    return undefined;
  };

  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('cache.config.title')} subtitle={t('cache.config.note')}>
      <QueryView query={query}>
        {(d) => <ConfigItems items={d.items} groupLabel={(g) => t(`cache.config.group.${g}`)} itemLabel={(k) => t(`cache.config.key.${k}`)} format={format} />}
      </QueryView>
    </ConfigSheet>
  );
}
