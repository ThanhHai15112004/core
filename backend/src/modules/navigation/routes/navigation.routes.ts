export const MENUS_ROUTES = {
  ROOT: 'navigation/menus',
  SYNC: 'sync',
  TREE: 'tree',
  REORDER: 'reorder',
  INVALIDATE_CACHE: 'cache/invalidate',
  DETAIL: ':code',
  TOGGLE: ':code/toggle',
} as const;

export const NAVIGATION_ROUTES = MENUS_ROUTES;
