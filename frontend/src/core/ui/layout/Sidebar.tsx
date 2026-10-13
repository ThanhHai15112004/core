import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import type { Tone } from '../../theme/tone';
import { Hint } from '../primitives/tooltip';
import { StatusDot } from '../blocks/StatusDot';
import { useShell } from './shell-context';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Chấm trạng thái (chỉ hiện khi warn / crit). */
  tone?: Tone;
  /** Số đếm nhỏ bên phải (vd. số package lỗi). */
  count?: number;
  countLabel?: string;
}

export interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

interface SidebarProps {
  brand: { icon: LucideIcon; title: string; subtitle?: string };
  groups: NavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  rail: boolean;
  onNavigate?: () => void;
  footer?: (rail: boolean) => React.ReactNode;
}

const ALERT_TONES: Tone[] = ['warn', 'crit'];

export function Sidebar({ brand, groups, activeId, onSelect, rail, onNavigate, footer }: SidebarProps) {
  const { t } = useLocale();
  const { collapsed, toggleCollapsed } = useShell();
  const BrandIcon = brand.icon;

  const renderItem = (item: NavItem) => {
    const active = item.id === activeId;
    const Icon = item.icon;
    const showTone = item.tone && ALERT_TONES.includes(item.tone);
    const button = (
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          onSelect(item.id);
          onNavigate?.();
        }}
        className={cn(
          'group relative flex h-8 w-full items-center gap-2.5 rounded-md text-sm transition-colors',
          rail ? 'justify-center px-0' : 'px-2.5',
          active ? 'bg-panel-3 font-medium text-fg' : 'text-fg-2 hover:bg-panel-2 hover:text-fg',
        )}
      >
        {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />}
        <span className="relative flex">
          <Icon className={cn('size-4 shrink-0', active ? 'text-fg' : 'text-muted group-hover:text-fg-2')} />
          {rail && showTone && <StatusDot tone={item.tone!} size="xs" className="absolute -right-1 -top-1" />}
        </span>
        {!rail && <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>}
        {!rail && item.count !== undefined && item.count > 0 && (
          <span className="rounded-sm bg-crit-bg px-1.5 font-mono text-2xs text-crit-fg" title={item.countLabel}>
            {item.count}
          </span>
        )}
        {!rail && showTone && <StatusDot tone={item.tone!} size="sm" aria-label={t(`ui.status.${item.tone}`)} />}
      </button>
    );
    return (
      <li key={item.id}>
        {rail ? (
          <Hint content={item.label} side="right">
            {button}
          </Hint>
        ) : (
          button
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-border', rail ? 'justify-center px-0' : 'px-3.5')}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-fg">
          <BrandIcon className="size-4" />
        </span>
        {!rail && (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-fg">{brand.title}</span>
            {brand.subtitle && <span className="truncate text-2xs text-muted">{brand.subtitle}</span>}
          </span>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label={brand.title}>
        {groups.map((group, i) => (
          <div key={group.id} className={cn(i > 0 && 'mt-4')}>
            {group.label && !rail && (
              <div className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-faint">{group.label}</div>
            )}
            {group.label && rail && i > 0 && <div className="mx-2 mb-2 h-px bg-border" aria-hidden="true" />}
            <ul className="flex flex-col gap-0.5">{group.items.map(renderItem)}</ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        {footer?.(rail)}
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cn(
            'hidden h-8 w-full items-center gap-2.5 rounded-md text-sm text-muted hover:bg-panel-2 hover:text-fg md:flex',
            rail ? 'justify-center' : 'px-2.5',
          )}
          aria-label={collapsed ? t('ui.sidebar.expand') : t('ui.sidebar.collapse')}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!rail && <span>{t('ui.sidebar.collapse')}</span>}
        </button>
      </div>
    </div>
  );
}
