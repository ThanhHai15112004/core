const PREFIX = 'ops/storage';

export const STORAGE_OPS_ROUTES = {
  PREFIX,
  OVERVIEW: 'overview',
  METRICS: 'metrics',
  TRAFFIC: 'traffic',
  USAGE: 'usage',
  CONTAINERS: 'containers',
  CONTAINER_DETAIL: 'containers/:id',
  OBJECTS: 'objects',
  OBJECT_DETAIL: 'objects/detail',
  OBJECT_DOWNLOAD: 'objects/download',
  OBJECT_PREVIEW: 'objects/preview',
  OBJECT_SIGNED_URL: 'objects/signed-url',
  UPLOADS: 'uploads',
  UPLOAD_ABORT: 'uploads/abort',
  LIFECYCLE: 'lifecycle',
  ERRORS: 'errors',
  EVENTS: 'events',
  OPERATIONS: 'operations',
  CONFIG: 'config',
  TEST: 'test',
} as const;
