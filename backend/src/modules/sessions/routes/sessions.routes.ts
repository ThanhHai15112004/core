export const SESSIONS_ROUTES = {
  PREFIX: 'sessions',
  LIST: '',
  LOGIN_HISTORY: 'login-history',
  USER_LOGIN_HISTORY: 'users/:userId/login-history',
  USER_REVOKE_ALL: 'users/:userId/revoke',
  BY_ID: ':sessionId',
  REVOKE_ALL: 'revoke-all',
} as const;
