const env = import.meta.env;

export const frontendConfig = {
  appName: 'Core Framework',
  version: '1.0.0',
  isProduction: env.PROD,
  apiBaseUrl: env['VITE_API_BASE_URL'] || 'http://localhost:3005/api/v1',
  apiTimeoutMs: Number(env['VITE_API_TIMEOUT_MS']) || 8000,
};
