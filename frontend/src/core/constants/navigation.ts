import { ROUTES } from '../../routes/index';

export type NavigationTabId = 'home' | 'ops';

export interface NavigationItem {
  id: NavigationTabId;
  /** Khóa i18n */
  labelKey: string;
  icon: string;
  route: string;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    id: 'home',
    labelKey: 'header.home',
    icon: '🏠',
    route: ROUTES.HOME,
  },
  {
    id: 'ops',
    labelKey: 'header.systemOps',
    icon: '⚙️',
    route: ROUTES.SYSTEM_OPS,
  },
] as const;
