import { ROUTES } from '../../routes/index';

export type NavigationTabId = 'home' | 'auth' | 'organizations' | 'files';

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
    icon: 'home',
    route: ROUTES.HOME,
  },
  {
    id: 'auth',
    labelKey: 'header.auth',
    icon: 'shield',
    route: ROUTES.AUTH,
  },
  {
    id: 'organizations',
    labelKey: 'header.organizations',
    icon: 'building',
    route: ROUTES.ORGANIZATIONS,
  },
  {
    id: 'files',
    labelKey: 'header.files',
    icon: 'folder',
    route: ROUTES.FILES,
  },
] as const;
