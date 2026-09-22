import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Play, RotateCw, Square } from 'lucide-react';
import type { RuntimeAction, RuntimeSummary } from '../../types/runtime.types';
import type { PendingCommand } from '../../hooks/useRuntimeCommand';
import { useLocale } from '../../../../core/i18n/index';

interface RuntimeActionsProps {
  runtime: RuntimeSummary;
  pending: PendingCommand | null;
  onAction: (action: RuntimeAction) => void;
  /** `menu`: nút ⋮ mở danh sách (card); `buttons`: hiện nút trực tiếp (trang chi tiết). */
  variant: 'menu' | 'buttons';
}

const ICONS: Record<RuntimeAction, React.ComponentType<{ size?: number }>> = {
  restart: RotateCw,
  stop: Square,
  start: Play,
};
const ORDER: RuntimeAction[] = ['restart', 'stop', 'start'];

/** Các action vận hành; action không được phép bị disable kèm lý do từ backend. */
export const RuntimeActions: React.FC<RuntimeActionsProps> = ({ runtime, pending, onAction, variant }) => {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isPending = pending?.runtime === runtime.id;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = ORDER.map((action) => {
    const availability = runtime.actions[action];
    const Icon = ICONS[action];
    const running = isPending && pending?.action === action;
    return (
      <button
        key={action}
        type="button"
        role={variant === 'menu' ? 'menuitem' : undefined}
        className={variant === 'menu' ? 'rt-menu-item' : `scp-btn scp-btn-sm ${action === 'start' && availability.allowed ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
        disabled={!availability.allowed || isPending}
        title={availability.allowed ? undefined : availability.reason}
        onClick={() => {
          setOpen(false);
          onAction(action);
        }}
      >
        <Icon size={13} />
        <span>{running ? t(`rt.pending.${action}`) : t(`rt.action.${action}`)}</span>
        {variant === 'menu' && !availability.allowed && <small>{availability.reason}</small>}
      </button>
    );
  });

  if (variant === 'buttons') return <div className="rt-actions">{items}</div>;

  return (
    <div className="rt-menu" ref={ref}>
      <button
        type="button"
        className="rt-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('rt.actionsMenu')}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="rt-menu-list" role="menu">
          {items}
        </div>
      )}
    </div>
  );
};
