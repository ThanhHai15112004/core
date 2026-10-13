import { createContext, useContext } from 'react';

export interface ShellContextValue {
  /** Sidebar thu về dạng icon (desktop). */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Menu off-canvas (mobile). */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export const useShell = (): ShellContextValue => {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within an AppShell');
  return ctx;
};
