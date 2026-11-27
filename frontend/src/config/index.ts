export interface RuntimeFrontendConfig {
  appName?: string;
  version?: string;
  environment?: string;
  commit?: string;
  buildTime?: string;
  apiBaseUrl?: string;
  apiTimeoutMs?: number | string;
  uploadTimeoutMs?: number | string;
}

declare global {
  interface Window {
    __CORE_RUNTIME_CONFIG__?: RuntimeFrontendConfig;
  }
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Hợp nhất cấu hình runtime (`window.__CORE_RUNTIME_CONFIG__` sinh lúc start container)
 * với fallback từ `import.meta.env`, giúp FE build 1 lần dùng chung cho mọi môi trường.
 */
export function resolveFrontendConfig(
  runtime: RuntimeFrontendConfig | undefined,
  buildEnv: Record<string, unknown>,
) {
  return {
    appName: readNonEmptyString(runtime?.appName) ?? 'Core Framework',
    version: readNonEmptyString(runtime?.version) ?? '1.0.0',
    environment:
      readNonEmptyString(runtime?.environment) ??
      (buildEnv['PROD'] ? 'production' : 'development'),
    commit: readNonEmptyString(runtime?.commit) ?? null,
    buildTime: readNonEmptyString(runtime?.buildTime) ?? null,
    isProduction: Boolean(buildEnv['PROD']),
    apiBaseUrl:
      readNonEmptyString(runtime?.apiBaseUrl) ??
      readNonEmptyString(buildEnv['VITE_API_BASE_URL']) ??
      'http://localhost:3006/api/v1',
    apiTimeoutMs: readPositiveNumber(
      runtime?.apiTimeoutMs ?? buildEnv['VITE_API_TIMEOUT_MS'],
      15000,
    ),
    uploadTimeoutMs: readPositiveNumber(
      runtime?.uploadTimeoutMs ?? buildEnv['VITE_UPLOAD_TIMEOUT_MS'],
      300000,
    ),
  };
}

const runtimeConfig =
  typeof window !== 'undefined' ? window.__CORE_RUNTIME_CONFIG__ : undefined;

export const frontendConfig = resolveFrontendConfig(
  runtimeConfig,
  import.meta.env as Record<string, unknown>,
);
