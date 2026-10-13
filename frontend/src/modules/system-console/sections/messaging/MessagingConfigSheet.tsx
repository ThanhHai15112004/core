import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { ConfigSheet, CopyButton, DetailSection, KeyValueGrid, QueryView } from '@core/ui/blocks';
import type { BrokerInfo, MessagingConfig } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { CONFIG_LABELLED_KEYS, CONFIG_MS_KEYS } from '../../constants/messaging';
import { BrokerSection } from '../../components/messaging/BrokerSection';
import { messagingKeys } from './messaging-keys';

type ConfigItem = MessagingConfig['items'][number];

/** Cấu hình Messaging (sheet ⚙): thông tin broker (chỉ đọc) + cấu hình đang nạp; credential chỉ hiện "đã cấu hình". */
export function MessagingConfigSheet({ open, onOpenChange, product }: { open: boolean; onOpenChange: (open: boolean) => void; product: string }) {
  const { t } = useLocale();
  const config = useLiveQuery(messagingKeys.config(), () => messagingApi.config(), { tier: 'static', enabled: open });
  const broker = useLiveQuery(messagingKeys.broker(), () => messagingApi.broker(), { tier: 'slow', enabled: open });
  return (
    <ConfigSheet open={open} onOpenChange={onOpenChange} title={t('messaging.config.title')} subtitle={t('messaging.config.note')}>
      <DetailSection title={t('messaging.broker.title')}>
        <QueryView query={broker} compact>
          {(b) => (
            <BrokerSection section={b.broker} product={product} onRetry={() => void broker.refetch()}>
              {(info) => <BrokerFacts info={info} />}
            </BrokerSection>
          )}
        </QueryView>
      </DetailSection>
      <QueryView query={config}>{(d) => <ConfigBody d={d} />}</QueryView>
    </ConfigSheet>
  );
}

function BrokerFacts({ info }: { info: BrokerInfo }) {
  const { t } = useLocale();
  const f = useFormat();
  return (
    <KeyValueGrid
      columns={3}
      items={[
        { key: 'version', label: t('messaging.broker.version'), value: info.version, mono: true },
        { key: 'uptime', label: t('messaging.broker.uptime'), value: info.uptimeSec === null ? null : f.uptime(info.uptimeSec), mono: true },
        {
          key: 'memory',
          label: t('messaging.broker.memory'),
          value: info.usedMemoryBytes === null ? null : `${f.bytes(info.usedMemoryBytes)}${info.maxMemoryBytes ? ` / ${f.bytes(info.maxMemoryBytes)}` : ''}`,
          mono: true,
        },
        { key: 'clients', label: t('messaging.broker.clients'), value: info.connectedClients === null ? null : f.number(info.connectedClients), mono: true },
        {
          key: 'connections',
          label: t('messaging.broker.connections'),
          value: info.connections.length ? info.connections.map((c) => `${t(`rt.name.${c.runtime}`)} ${c.count}`).join(' · ') : null,
        },
      ]}
    />
  );
}

function ConfigBody({ d }: { d: MessagingConfig }) {
  const { t } = useLocale();
  const f = useFormat();
  const render = (item: ConfigItem) => {
    if (item.sensitive) return <Badge tone={item.value ? 'ok' : 'unknown'}>{item.value ? t('messaging.config.configured') : t('messaging.config.notConfigured')}</Badge>;
    if (typeof item.value === 'boolean') return <Badge tone={item.value ? 'ok' : 'unknown'}>{item.value ? t('messaging.config.yes') : t('messaging.config.no')}</Badge>;
    if (item.value === null) return null;
    if (CONFIG_MS_KEYS.includes(item.key)) return f.duration(Number(item.value));
    if (CONFIG_LABELLED_KEYS.includes(item.key)) return t(`messaging.config.value.${item.key}.${item.value}`);
    if (typeof item.value === 'number') return f.compact(item.value);
    return String(item.value);
  };
  const groups = [...new Set(d.items.map((i) => i.group))];
  const safe = JSON.stringify(Object.fromEntries(d.items.filter((i) => !i.sensitive).map((i) => [i.key, i.value])), null, 2);
  return (
    <>
      {groups.map((g, gi) => (
        <DetailSection key={g} title={t(`messaging.config.group.${g}`)} actions={gi === 0 ? <CopyButton value={safe} label={t('messaging.config.copy')} size="xs" /> : undefined}>
          <KeyValueGrid
            items={d.items
              .filter((i) => i.group === g)
              .map((i) => ({ key: i.key, label: t(`messaging.config.key.${i.key}`), value: render(i), mono: !i.sensitive && typeof i.value !== 'boolean' && !CONFIG_LABELLED_KEYS.includes(i.key) }))}
          />
        </DetailSection>
      ))}
    </>
  );
}
