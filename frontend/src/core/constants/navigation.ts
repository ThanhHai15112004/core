import { ROUTES } from '../../routes/index';

export type NavigationTabId =
  | 'home'
  | 'auth'
  | 'organizations'
  | 'roles'
  | 'users'
  | 'codes'
  | 'settings'
  | 'files'
  | 'notifications'
  | 'workflows';

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
  {
    id: 'notifications',
    labelKey: 'header.notifications',
    icon: 'bell',
    route: ROUTES.NOTIFICATIONS,
  },
  {
    id: 'workflows',
    labelKey: 'header.workflows',
    icon: 'git-branch',
    route: ROUTES.WORKFLOWS,
  },
] as const;

const TAB_TO_ROUTE_MAP = new Map<NavigationTabId, string>(
  NAVIGATION_ITEMS.map((item) => [item.id, item.route]),
);

/** Ánh xạ `NavigationTabId` sang đường dẫn URL thật (ví dụ: `'files'` → `'/files'`). */
export function resolveRouteForTab(tab: NavigationTabId): string {
  return TAB_TO_ROUTE_MAP.get(tab) ?? ROUTES.HOME;
}

/** Ánh xạ `pathname` hiện tại trên URL sang `NavigationTabId` tương ứng (hỗ trợ F5 và Back/Forward). */
export function resolveTabFromPathname(pathname: string): NavigationTabId {
  const normalized = pathname.trim().replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === ROUTES.HOME) {
    return 'home';
  }
  for (const item of NAVIGATION_ITEMS) {
    if (item.route !== '/' && (normalized === item.route || normalized.startsWith(`${item.route}/`))) {
      return item.id;
    }
  }
  return 'home';
}
