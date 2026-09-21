import { env } from './env.js';

export const storageConfig = () => ({
  driver: env('STORAGE_DRIVER'),
  localPath: env('STORAGE_LOCAL_PATH'),
});

export type StorageConfig = ReturnType<typeof storageConfig>;
