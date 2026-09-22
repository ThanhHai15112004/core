import { fetchApi } from '../../../core/services/api';
import { frontendConfig } from '../../../config/index';
import { API_ROUTES } from '../../../routes/index';
import type {
  ContainerDetail,
  ObjectDetail,
  ObjectFilter,
  ObjectPreview,
  StorageConfig,
  StorageContainers,
  StorageErrors,
  StorageEvent,
  StorageLifecycle,
  StorageMetric,
  StorageMetrics,
  StorageObjects,
  StorageOperation,
  StorageOverview,
  StorageRange,
  StorageTest,
  StorageTraffic,
  StorageUploads,
  StorageUsage,
} from '../types/storage.types';
import { toQuery } from './traffic.api';

const S = API_ROUTES.OPS.STORAGE.path;
const send = <T>(method: 'POST' | 'DELETE', path: string, qs = '', body: object = {}) => fetchApi<T>(S(path, qs), { method, body: JSON.stringify(body) });

export const storageApi = {
  overview: (range: StorageRange) => fetchApi<StorageOverview>(S('overview', toQuery({ range }))),
  metrics: (range: StorageRange, metric: StorageMetric) => fetchApi<StorageMetrics>(S('metrics', toQuery({ range, metric }))),
  traffic: (range: StorageRange) => fetchApi<StorageTraffic>(S('traffic', toQuery({ range }))),
  usage: () => fetchApi<StorageUsage>(S('usage')),
  containers: (range: StorageRange) => fetchApi<StorageContainers>(S('containers', toQuery({ range }))),
  container: (name: string, range: StorageRange) => fetchApi<ContainerDetail>(S(`containers/${encodeURIComponent(name)}`, toQuery({ range }))),
  objects: (f: ObjectFilter, cursor: string, count = 100) =>
    fetchApi<StorageObjects>(
      S(
        'objects',
        toQuery({
          container: f.container || undefined,
          prefix: f.prefix || undefined,
          kind: f.kind || undefined,
          age: f.age || undefined,
          minSize: f.minSizeMb ? Math.round(Number(f.minSizeMb) * 1024 * 1024) : undefined,
          cursor: cursor || undefined,
          count,
        }),
      ),
    ),
  object: (key: string) => fetchApi<ObjectDetail>(S('objects/detail', toQuery({ key }))),
  /** URL tải trực tiếp (GET, trình duyệt tự tải file). */
  downloadUrl: (key: string) => `${frontendConfig.apiBaseUrl}${S('objects/download', toQuery({ key }))}`,
  preview: (key: string) => fetchApi<ObjectPreview>(S('objects/preview', toQuery({ key }))),
  signedUrl: (key: string, ttlSec: number) => send<{ url: string; expiresAt: string }>('POST', 'objects/signed-url', '', { key, ttlSec }),
  deleteObject: (key: string, confirm: string, versionId?: string) => send<StorageOperation>('DELETE', 'objects', toQuery({ key, versionId }), { confirm }),
  uploads: (range: StorageRange) => fetchApi<StorageUploads>(S('uploads', toQuery({ range }))),
  abortUpload: (key: string, uploadId: string) => send<StorageOperation>('POST', 'uploads/abort', '', { key, uploadId, confirm: 'ABORT' }),
  lifecycle: () => fetchApi<StorageLifecycle>(S('lifecycle')),
  errors: (range: StorageRange) => fetchApi<StorageErrors>(S('errors', toQuery({ range }))),
  events: (range: StorageRange) => fetchApi<StorageEvent[]>(S('events', toQuery({ range }))),
  operations: () => fetchApi<StorageOperation[]>(S('operations')),
  config: () => fetchApi<StorageConfig>(S('config')),
  test: () => send<StorageTest>('POST', 'test'),
};
