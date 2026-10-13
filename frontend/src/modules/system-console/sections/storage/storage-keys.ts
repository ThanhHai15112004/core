import type { ObjectFilter, StorageRange } from '../../types/storage.types';

/** Query key của Storage — prefix `['storage']` để invalidate cả trang sau thao tác. */
export const storageKeys = {
  all: ['storage'] as const,
  overview: (range: StorageRange) => ['storage', 'overview', range] as const,
  usage: () => ['storage', 'usage'] as const,
  containers: (range: StorageRange) => ['storage', 'containers', range] as const,
  container: (name: string, range: StorageRange) => ['storage', 'container', name, range] as const,
  objects: (filter: ObjectFilter) => ['storage', 'objects', filter] as const,
  object: (key: string) => ['storage', 'object', key] as const,
  uploads: (range: StorageRange) => ['storage', 'uploads', range] as const,
  lifecycle: () => ['storage', 'lifecycle'] as const,
  errors: (range: StorageRange) => ['storage', 'errors', range] as const,
  events: (range: StorageRange) => ['storage', 'events', range] as const,
  operations: () => ['storage', 'operations'] as const,
  config: () => ['storage', 'config'] as const,
};
