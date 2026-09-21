import { ROUTES } from '../../routes/index';

export type NavigationTabId = 'home' | 'ops';

export interface NavigationItem {
  id: NavigationTabId;
  label: string;
  icon: string;
  route: string;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    id: 'home',
    label: 'Trang chủ',
    icon: '🏠',
    route: ROUTES.HOME,
  },
  {
    id: 'ops',
    label: 'Quản lý System Ops',
    icon: '⚙️',
    route: ROUTES.SYSTEM_OPS,
  },
] as const;
