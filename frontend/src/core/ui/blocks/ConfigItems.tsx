import React from 'react';
import { useLocale } from '../../i18n/index';
import { formatNumber } from '../../lib/format';
import { Badge } from '../primitives/badge';
import { ConfigGroups, type ConfigGroup } from './ConfigSheet';
import { CopyButton } from './CopyButton';

/** Một giá trị cấu hình đang nạp (từ biến môi trường) — bí mật chỉ cho biết "đã cấu hình" hay chưa. */
export interface ConfigItem {
  key: string;
  value: string | number | boolean | null;
  sensitive?: boolean;
  group: string;
}

interface ConfigItemsProps {
  items: ConfigItem[];
  groupLabel: (group: string) => string;
  itemLabel: (key: string) => string;
  /** Định dạng riêng theo key; trả `undefined` = dùng mặc định (bí mật / có-không / số / chuỗi). */
  format?: (item: ConfigItem) => React.ReactNode | undefined;
  /** Hiện nút sao chép JSON (không gồm bí mật). Mặc định có. */
  copy?: boolean;
}

/** Cấu hình chỉ đọc theo nhóm, giữ thứ tự backend gửi; kèm nút sao chép bản không có bí mật. */
export function ConfigItems({ items, groupLabel, itemLabel, format, copy = true }: ConfigItemsProps) {
  const { t, locale } = useLocale();
  const render = (i: ConfigItem): React.ReactNode => {
    if (i.sensitive) return <Badge tone={i.value ? 'ok' : undefined}>{i.value ? t('ui.config.configured') : t('ui.config.notConfigured')}</Badge>;
    const custom = format?.(i);
    if (custom !== undefined) return custom;
    if (typeof i.value === 'boolean') return i.value ? t('ui.config.yes') : t('ui.config.no');
    if (typeof i.value === 'number') return formatNumber(i.value, locale);
    return i.value;
  };
  const groups: ConfigGroup[] = [...new Set(items.map((i) => i.group))].map((g) => ({
    id: g,
    title: groupLabel(g),
    items: items.filter((i) => i.group === g).map((i) => ({ key: i.key, label: itemLabel(i.key), value: render(i), mono: !i.sensitive && typeof i.value !== 'boolean' })),
  }));
  const safe = JSON.stringify(Object.fromEntries(items.filter((i) => !i.sensitive).map((i) => [i.key, i.value])), null, 2);
  return (
    <>
      {copy && (
        <div className="mb-3 flex justify-end">
          <CopyButton value={safe} label={t('ui.config.copy')} size="xs" />
        </div>
      )}
      <ConfigGroups groups={groups} />
    </>
  );
}
