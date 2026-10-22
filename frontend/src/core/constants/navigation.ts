import { ROUTES } from '../../routes/index';

export type NavigationTabId = 'home' | 'iam' | 'files';

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
    id: 'iam',
    labelKey: 'header.iam',
    icon: '🛡️',
    route: ROUTES.IAM,
  },
  {
    id: 'files',
    labelKey: 'header.files',
    icon: '📁',
    route: ROUTES.FILES,
  },
] as const;

