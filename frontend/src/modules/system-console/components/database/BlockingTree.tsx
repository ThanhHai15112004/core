import React from 'react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import type { BlockingNode } from '../../types/database.types';
import { runtimeLabel } from './db-labels';

/** Chuỗi chặn: session gốc giữ lock → các session đang chờ (lồng nhau). Bấm một session để xem chi tiết. */
export function BlockingTree({ nodes, onOpen }: { nodes: BlockingNode[]; onOpen: (session: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const render = (n: BlockingNode, root: boolean): React.ReactNode => (
    <li key={`${n.session}-${root}`}>
      <button
        type="button"
        onClick={() => onOpen(n.session)}
        className={`flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left hover:bg-panel-2 ${root ? 'border-crit-border' : 'border-border'}`}
      >
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-fg">#{n.session}</span>
          <span className="text-muted">{runtimeLabel(n.runtime, t)}</span>
          {root ? (
            <Badge tone="crit" size="xs">
              {t('db.locks.holding')}
            </Badge>
          ) : (
            <Badge tone="warn" size="xs">
              {t('db.locks.waiting', { time: f.duration(n.waitMs) })}
              {n.object && ` · ${n.object}`}
              {n.lockMode && ` (${n.lockMode})`}
            </Badge>
          )}
        </span>
        <span className="truncate font-mono text-xs text-fg-2">{n.query ?? t('db.locks.idleHolder')}</span>
      </button>
      {n.children.length > 0 && <ul className="ml-4 mt-1.5 flex flex-col gap-1.5 border-l border-border pl-3">{n.children.map((c) => render(c, false))}</ul>}
    </li>
  );
  return <ul className="flex flex-col gap-2">{nodes.map((n) => render(n, true))}</ul>;
}
