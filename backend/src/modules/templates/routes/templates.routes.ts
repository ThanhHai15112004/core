export const TEMPLATES_ROUTES = {
  PREFIX: 'templates',
  BY_ID: ':id',
  PREVIEW: 'preview',
  RENDER_DOCUMENT: 'render-document',
  VERSIONS: ':id/versions',
  PUBLISH: ':id/publish',
  VERSION_PUBLISH: ':id/versions/publish',
  ROLLBACK: ':id/rollback',
  VERSION_ROLLBACK: ':id/versions/rollback',
  USAGES: ':id/usages',
  USAGE_BY_ID: 'usages/:id',
} as const;
