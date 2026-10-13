import React, { useState } from 'react';
import { PlugZap, Radio, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { Badge, Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { MessagingTest } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { MESSAGING_HEALTH_TONE, MESSAGING_TABS, type MessagingPageTab } from '../../constants/messaging';
import { HealthBanner, TestResultBanner } from '../../components/messaging/BrokerBanners';
import { ChannelSheet } from '../../components/messaging/ChannelSheet';
import { ConsumerSheet } from '../../components/messaging/ConsumerSheet';
import { MessageSheet } from '../../components/messaging/MessageSheet';
import { useMessagingPage } from './useMessagingPage';
import { useMessageActions } from './useMessageActions';
import { messagingKeys } from './messaging-keys';
import { MessagingOverviewTab } from './MessagingOverviewTab';
import { MessagingFlowTab } from './MessagingFlowTab';
import { MessagingMessagesTab } from './MessagingMessagesTab';
import { MessagingActivityTab } from './MessagingActivityTab';
import { MessagingConfigSheet } from './MessagingConfigSheet';

/**
 * Messaging — luồng message giữa các thành phần: Tổng quan · Channels & Consumers · Messages · Hoạt động.
 * Chi tiết channel / consumer / message mở drawer; cấu hình + thông tin broker mở sheet ⚙.
 * Phần broker không hỗ trợ nói rõ lý do (theo capability), không có số liệu giả.
 */
export const MessagingSection: React.FC = () => {
  const { t } = useLocale();
  const page = useMessagingPage();
  const overview = useLiveQuery(messagingKeys.overview(page.range), () => messagingApi.overview(page.range));
  const data = overview.data;
  const product = data?.provider.product ?? '';
  const [testResult, setTestResult] = useState<MessagingTest | null>(null);
  const test = useAppMutation({
    mutationFn: () => messagingApi.test(),
    invalidate: [messagingKeys.all],
    success: false,
    error: t('messaging.test.error'),
    onSuccess: (r) => setTestResult(r),
  });
  const actions = useMessageActions((action, target) => {
    // Message vừa xoá không còn → đóng drawer thay vì tải lại (404).
    if (action === 'discard' && page.messageId === target.id) page.openMessage(null);
  });

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const tabs: PageTab<MessagingPageTab>[] = MESSAGING_TABS.map((id) => ({
    id,
    label: t(`messaging.tab.${id}`),
    ...(id === 'overview' ? { count: problems, countTone: data?.alerts.some((a) => a.severity === 'critical') ? ('crit' as const) : ('warn' as const) } : {}),
    ...(id === 'messages' ? { count: data?.kpis.deadLetter ?? null, countTone: 'crit' as const } : {}),
  }));

  const renderTab = () => {
    switch (page.tab) {
      case 'channels':
        return <MessagingFlowTab page={page} overview={data} />;
      case 'messages':
        return <MessagingMessagesTab page={page} overview={data} onAction={actions.request} />;
      case 'activity':
        return <MessagingActivityTab page={page} product={product} />;
      default:
        return <MessagingOverviewTab page={page} data={data} error={overview.isError && !data ? overview.error : null} onRetry={() => void overview.refetch()} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.messaging')}
        icon={Radio}
        status={data ? { tone: MESSAGING_HEALTH_TONE[data.health.status], label: t(`messaging.health.short.${data.health.status}`) } : undefined}
        actions={
          <>
            {data && (
              <Badge variant="outline" className="hidden font-mono sm:inline-flex">
                {t('messaging.page.provider', { product: data.provider.product, broker: data.provider.broker })}
              </Badge>
            )}
            <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
              <PlugZap />
              {test.isPending ? t('messaging.test.running') : t('messaging.test.button')}
            </Button>
          </>
        }
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && (
        <StatusBanner
          tone="crit"
          title={t('messaging.page.offline')}
          description={overview.error instanceof Error ? overview.error.message : undefined}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}
      {data && <HealthBanner data={data} />}
      {testResult && <TestResultBanner result={testResult} onClose={() => setTestResult(null)} onOpenLogs={() => page.navigate('logs/explorer?runtime=api&level=warn,error,fatal')} />}

      <PageTabs tabs={tabs} value={page.tab} onChange={(tab) => page.go(tab)} />
      {renderTab()}

      <ChannelSheet
        name={page.tab === 'channels' && page.view === 'channels' ? page.itemId : null}
        range={page.range}
        onClose={() => page.openItem(null)}
        onBrowse={page.browseChannel}
        onOpenConsumer={page.openConsumer}
        onOpenMessage={page.openMessage}
      />
      <ConsumerSheet
        name={page.tab === 'channels' && page.view === 'consumers' ? page.itemId : null}
        range={page.range}
        onClose={() => page.openItem(null)}
        onOpenMessage={page.openMessage}
        navigate={page.navigate}
      />
      <MessageSheet
        messageId={page.messageId}
        queue={page.messageQueue}
        onClose={() => page.openMessage(null)}
        onAction={actions.request}
        onOpenChannel={page.openChannel}
        onOpenConsumer={page.openConsumer}
        navigate={page.navigate}
      />
      <MessagingConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} product={product} />
      {actions.dialog}
    </div>
  );
};
