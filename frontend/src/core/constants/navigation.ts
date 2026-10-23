import { ROUTES } from '../../routes/index';

export type NavigationTabId =
  | 'home'
  | 'auth'
  | 'organizations'
  | 'roles'
  | 'users'
  | 'codes'
  | 'settings'
  | 'files';

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
    id: 'roles',
    labelKey: 'header.roles',
    icon: 'key',
    route: ROUTES.ROLES,
  },
  {
    id: 'users',
    labelKey: 'header.users',
    icon: 'users',
    route: ROUTES.USERS,
  },
  {
    id: 'codes',
    labelKey: 'header.codes',
    icon: 'book',
    route: ROUTES.CODES,
  },
  {
    id: 'settings',
    labelKey: 'header.settings',
    icon: 'settings',
    route: ROUTES.SETTINGS,
  },
  {
    id: 'files',
    labelKey: 'header.files',
    icon: 'folder',
    route: ROUTES.FILES,
  },
] as const;
