import { AlertTriangle, Play } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Badge, Button } from '@core/ui/primitives';
import { DetailSection, DetailSheet, JsonView, KeyValueGrid, PanelState } from '@core/ui/blocks';
import type { PackageActionDescriptor, PackageSummary } from '../../types/packages.types';
import { PACKAGE_JSON_MAX_HEIGHT_PX, PACKAGE_STATUS_TONE } from '../../constants/governance';

interface PackageDetailSheetProps {
  pkg: PackageSummary | null;
  onClose: () => void;
  onAction: (pkg: PackageSummary, action: PackageActionDescriptor) => void;
  /** Id thao tác đang chạy (khoá nút). */
  runningId: string | null;
  categoryLabel: (category: string) => string;
}

/** Drawer một package: tóm tắt, metric, thao tác (nguy hiểm → nút đỏ, xác nhận ở trang), JSON gốc. */
export function PackageDetailSheet({ pkg, onClose, onAction, runningId, categoryLabel }: PackageDetailSheetProps) {
  const { t } = useLocale();
  const status = pkg?.statusReport.status;
  const metrics = Object.entries(pkg?.statusReport.metrics ?? {});
  return (
    <DetailSheet
      open={pkg !== null}
      onOpenChange={(o) => !o && onClose()}
      title={pkg?.displayName}
      subtitle={pkg ? <span className="font-mono">{pkg.packageId}</span> : undefined}
      status={status ? { tone: PACKAGE_STATUS_TONE[status] ?? 'unknown', label: t(`console.status.${status}`) } : undefined}
      width="lg"
    >
      {pkg && (
        <>
          <DetailSection title={t('gov.packages.detail.summary')} actions={<Badge>{categoryLabel(pkg.category)}</Badge>}>
            <p className="text-sm text-fg-2">{pkg.statusReport.summary}</p>
          </DetailSection>

          <DetailSection title={t('gov.packages.detail.metrics', { count: metrics.length })}>
            {metrics.length > 0 ? (
              <KeyValueGrid items={metrics.map(([k, v]) => ({ key: k, label: k, value: String(v), mono: true }))} />
            ) : (
              <PanelState status="empty" compact message={t('gov.packages.detail.noMetrics')} />
            )}
          </DetailSection>

          <DetailSection title={t('gov.packages.detail.actions', { count: pkg.actions.length })}>
            {pkg.actions.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {pkg.actions.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
                        {a.isDanger && <AlertTriangle className="size-3.5 shrink-0 text-crit" />}
                        {a.label}
                      </div>
                      {a.description && <div className="text-xs text-muted">{a.description}</div>}
                    </div>
                    <Button size="sm" variant={a.isDanger ? 'danger-outline' : 'secondary'} disabled={runningId !== null} onClick={() => onAction(pkg, a)}>
                      <Play />
                      {runningId === a.id ? t('gov.packages.detail.running') : t('gov.packages.detail.run')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelState status="empty" compact message={t('gov.packages.detail.noActions')} />
            )}
          </DetailSection>

          <DetailSection title={t('gov.packages.detail.raw')}>
            <JsonView value={pkg} maxHeight={PACKAGE_JSON_MAX_HEIGHT_PX} />
          </DetailSection>
        </>
      )}
    </DetailSheet>
  );
}
