export enum PackageStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  ERROR = 'error',
  IDLE = 'idle',
}

export enum PackageCategory {
  CACHE = 'cache',
  QUEUE = 'queue',
  LOGGING = 'logging',
  DATABASE = 'database',
  STORAGE = 'storage',
  CUSTOM = 'custom',
}

export enum CorePackageId {
  CACHE = 'cache',
  LOGGING = 'logging',
  MESSAGING = 'messaging',
  DATABASE = 'database',
  STORAGE = 'storage',
  SECURITY = 'security',
}
