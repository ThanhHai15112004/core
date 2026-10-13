import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { KeyValueGrid, PageHeader, Panel, PanelState, QueryView, StatGrid, StatTile, StatusBanner, type KeyValueItem } from '@core/ui/blocks';
import type { PackageSummary } from '../../types/packages.types';
import { fetchSecrets } from '../../services/governance.api';
import { useConsoleRoute } from '../../context/console-route-context';
import { PACKAGE_STATUS_TONE, SECURITY_CONFIG_ENV, SECURITY_PACKAGE_ID, SECURITY_STATE_METRICS, TOKEN_VERIFICATION_SKELETON } from '../../constants/governance';
import { usePackagesQuery } from '../packages/usePackages';
import { securityKeys } from './security-keys';
import { JwtDecoderPanel } from './JwtDecoderPanel';

const HIDDEN_METRICS = new Set<string>([...Object.keys(SECURITY_CONFIG_ENV), ...SECURITY_STATE_METRICS]);

/**
 * Bảo mật: trạng thái xác thực (verify chữ ký, AuthGuard, secret đã cấu hình) → cấu hình JWT → công cụ giải mã JWT
 * (chạy hoàn toàn ở trình duyệt, vẫn dùng được khi API lỗi).
 */
export const SecuritySection: React.FC = () => {
  const { t } = useLocale();
  const packages = usePackagesQuery();
  const pkg = packages.data?.find((p) => p.packageId === SECURITY_PACKAGE_ID);
  const status = pkg?.statusReport.status;
  const skeleton = pkg?.statusReport.metrics['tokenVerification'] === TOKEN_VERIFICATION_SKELETON;

  return (
    <div>
      <PageHeader
        title={t('nav.security')}
        icon={ShieldCheck}
        status={status ? { tone: PACKAGE_STATUS_TONE[status] ?? 'unknown', label: t(`console.status.${status}`) } : undefined}
      />

      {skeleton && <StatusBanner tone="crit" title={t('gov.security.skeletonTitle')} description={pkg?.statusReport.summary} />}

      <QueryView query={packages} skeleton="block">
        {(list) => {
          const found = list.find((p) => p.packageId === SECURITY_PACKAGE_ID);
          return found ? <SecurityState pkg={found} /> : <PanelState status="no-source" message={t('gov.security.noPackage')} className="mb-4" />;
        }}
      </QueryView>

      <JwtDecoderPanel />
    </div>
  );
};

function SecurityState({ pkg }: { pkg: PackageSummary }) {
  const { t } = useLocale();
  const f = useFormat();
  const { navigate } = useConsoleRoute();
  const secrets = useLiveQuery(securityKeys.secrets(), fetchSecrets, { tier: 'slow' });
  const m = pkg.statusReport.metrics;

  const verification = m['tokenVerification'];
  const guard = m['globalAuthGuard'];
  const total = secrets.data?.length;
  const present = secrets.data?.filter((s) => s.present).length;
  const missing = total !== undefined && present !== undefined ? total - present : undefined;

  const config: KeyValueItem[] = [
    ...Object.entries(SECURITY_CONFIG_ENV).map(([key, env]) => ({
      key,
      label: t(`gov.security.config.${key}`),
      value: m[key] === undefined ? null : key === 'secretDriver' ? String(m[key]).toUpperCase() : String(m[key]),
      mono: true,
      hint: t('gov.common.envVar', { name: env }),
    })),
    /* Metric khác backend có thể thêm sau — vẫn hiện, không bỏ sót. */
    ...Object.entries(m)
      .filter(([key]) => !HIDDEN_METRICS.has(key))
      .map(([key, value]) => ({ key, label: key, value: String(value), mono: true })),
  ];

  return (
    <>
      <StatGrid columns={3}>
        <StatTile
          label={t('gov.security.kpi.verification')}
          value={verification === undefined ? NO_VALUE : verification === TOKEN_VERIFICATION_SKELETON ? t('gov.security.verification.skeleton') : String(verification)}
          tone={verification === undefined ? undefined : verification === TOKEN_VERIFICATION_SKELETON ? 'crit' : 'ok'}
          hint={t('gov.security.kpi.verificationHint')}
        />
        <StatTile
          label={t('gov.security.kpi.authGuard')}
          value={guard === undefined ? NO_VALUE : guard ? t('gov.common.enabled') : t('gov.common.disabled')}
          tone={guard === undefined ? undefined : guard ? 'ok' : 'warn'}
          hint={t('gov.security.kpi.authGuardHint')}
        />
        <StatTile
          label={t('gov.security.kpi.secrets')}
          value={total === undefined ? NO_VALUE : `${f.number(present)}/${f.number(total)}`}
          sub={missing ? t('gov.secrets.missingCount', { count: f.number(missing) }) : undefined}
          tone={missing ? 'warn' : undefined}
          loading={secrets.isPending}
          hint={t('gov.security.kpi.secretsHint')}
          onClick={() => navigate('secrets')}
        />
      </StatGrid>

      <Panel title={t('gov.security.config.title')} hint={t('gov.security.config.hint')} className="mb-4">
        <KeyValueGrid items={config} columns={3} />
      </Panel>
    </>
  );
}
