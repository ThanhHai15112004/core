const PREFIX = 'health';

export const HEALTH_ROUTES = {
  PREFIX,
  CHECK: '',
  LIVE: 'live',
  READY: 'ready',
  DETAILS: 'details',
  buildCheckPath: () => `/${PREFIX}`,
  buildLivePath: () => `/${PREFIX}/live`,
  buildReadyPath: () => `/${PREFIX}/ready`,
  buildDetailsPath: () => `/${PREFIX}/details`,
} as const;
