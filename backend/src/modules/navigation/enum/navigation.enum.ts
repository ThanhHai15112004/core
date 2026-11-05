export const MENU_TREE_CACHE_PREFIX = 'settings:menus:tree:';
export const MENU_TREE_CACHE_TTL_SEC = 300;

export const NAVIGATION_AUDIT_META = {
  MODULE: 'navigation',
  FEATURES: {
    MENUS: 'menus',
  },
} as const;

export const MENU_AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  TOGGLE: 'TOGGLE',
  REORDER: 'REORDER',
  DELETE: 'DELETE',
} as const;

export type MenuAuditActionType = (typeof MENU_AUDIT_ACTIONS)[keyof typeof MENU_AUDIT_ACTIONS];
