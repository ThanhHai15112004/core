import React from 'react';
import { Menu } from 'lucide-react';
import { useLocale } from '../../i18n/index';
import { Button } from '../primitives/button';
import { useShell } from './shell-context';

interface TopBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function TopBar({ left, right }: TopBarProps) {
  const { t } = useLocale();
  const { setMobileOpen } = useShell();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-elevated/95 px-3 backdrop-blur md:px-4">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label={t('ui.sidebar.menu')}>
        <Menu />
      </Button>
      <div className="flex min-w-0 flex-1 items-center">{left}</div>
      <div className="flex shrink-0 items-center gap-1.5">{right}</div>
    </header>
  );
}
