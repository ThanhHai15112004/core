import React from 'react';
import { useLocale } from '@core/i18n/index';
import { ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { Panel, PanelState } from '@core/ui/blocks';
import type { DbOverview } from '../../types/database.types';
import { VIEW_CAPABILITY } from '../../constants/database';

/** Thanh chọn segment trong một tab (`?view=`). */
export function DbViewSwitch<V extends string>({ views, value, onChange, trailing }: { views: readonly V[]; value: V; onChange: (v: V) => void; trailing?: React.ReactNode }) {
  const { t } = useLocale();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as V)} aria-label={t('db.view.label')}>
        {views.map((v) => (
          <ToggleGroupItem key={v} value={v}>
            {t(`db.view.${v}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {trailing && <div className="ml-auto flex flex-wrap items-center gap-2">{trailing}</div>}
    </div>
  );
}

/** Segment cần capability mà driver hiện tại không có → nói rõ, không gọi API. */
export function DbCapabilityGate({ view, overview, children }: { view: keyof typeof VIEW_CAPABILITY; overview: DbOverview | undefined; children: React.ReactNode }) {
  const { t } = useLocale();
  const cap = VIEW_CAPABILITY[view];
  if (overview && cap && !overview.capabilities.includes(cap)) {
    return (
      <Panel>
        <PanelState status="no-source" message={t('db.unsupported.message', { driver: overview.driver })} />
      </Panel>
    );
  }
  return <>{children}</>;
}
