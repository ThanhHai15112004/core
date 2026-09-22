import React from 'react';
import type { BlockingNode } from '../../types/database.types';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

/** Chuỗi chặn: session gốc giữ lock → các session đang chờ (lồng nhau). */
export const BlockingTree: React.FC<{ nodes: BlockingNode[]; onOpen: (session: string) => void }> = ({ nodes, onOpen }) => {
  const { t } = useLocale();
  const render = (n: BlockingNode, root: boolean): React.ReactNode => (
    <li key={`${n.session}-${root}`}>
      <button type="button" className={`db-block-node ${root ? 'is-root' : ''}`} onClick={() => onOpen(n.session)}>
        <span className="db-block-head">
          <code>#{n.session}</code>
          <span>{n.runtime ? t(`rt.name.${n.runtime}`) : t('db.session.external')}</span>
          {root ? (
            <span className="pf-chip ov-tone-crit">{t('db.locks.holding')}</span>
          ) : (
            <span className="pf-chip ov-tone-warn">
              {t('db.locks.waiting', { time: formatDuration(n.waitMs) })}
              {n.object && ` · ${n.object}`}
              {n.lockMode && ` (${n.lockMode})`}
            </span>
          )}
        </span>
        <code className="db-block-sql">{n.query ?? t('db.locks.idleHolder')}</code>
      </button>
      {n.children.length > 0 && <ul>{n.children.map((c) => render(c, false))}</ul>}
    </li>
  );
  return <ul className="db-block-tree">{nodes.map((n) => render(n, true))}</ul>;
};
