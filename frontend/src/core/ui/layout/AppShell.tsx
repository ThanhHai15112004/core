import React, { useCallback, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { Sheet, SheetContent, SheetTitle } from '../primitives/sheet';
import { UI_STORAGE_KEYS } from '../../constants/ui.constants';
import { ShellContext } from './shell-context';

export interface SidebarRenderOptions {
  /** `true` = chỉ hiện icon. */
  rail: boolean;
  /** Gọi sau khi chọn mục (đóng menu mobile). */
  onNavigate: () => void;
}

interface AppShellProps {
  sidebar: (opts: SidebarRenderOptions) => React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(UI_STORAGE_KEYS.sidebarCollapsed) === '1';
  } catch {
    return false;
  }
}

/** Khung ứng dụng: sidebar (thu gọn được / off-canvas trên mobile) + thanh trên cùng + nội dung. */
export function AppShell({ sidebar, topbar, children, className }: AppShellProps) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(UI_STORAGE_KEYS.sidebarCollapsed, prev ? '0' : '1');
      } catch {
        /* chỉ giữ trong phiên */
      }
      return !prev;
    });
  }, []);

  const value = useMemo(() => ({ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }), [collapsed, toggleCollapsed, mobileOpen]);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <ShellContext.Provider value={value}>
      <div className={cn('flex min-h-screen bg-bg text-fg', className)}>
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-elevated transition-[width] duration-200 md:flex',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          {sidebar({ rail: collapsed, onNavigate: () => undefined })}
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" width="sm" className="w-64 bg-elevated" hideClose aria-describedby={undefined}>
            <SheetTitle className="sr-only">{t('ui.sidebar.menu')}</SheetTitle>
            {sidebar({ rail: false, onNavigate: closeMobile })}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {topbar}
          <main className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-5">{children}</main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
