const PREFIX = 'ops';

export const SYSTEM_OPS_ROUTES = {
  PREFIX,
  PACKAGES: 'packages',
  EXECUTE_ACTION: 'packages/:packageId/actions/:actionId',
  OVERVIEW: 'overview',
  SECRETS: 'secrets',
  CONFIGURATION: 'configuration',
  buildPackagesPath: () => `/${PREFIX}/packages`,
  buildExecuteActionPath: (packageId: string, actionId: string) =>
    `/${PREFIX}/packages/${packageId}/actions/${actionId}`,
  buildOverviewPath: () => `/${PREFIX}/overview`,
  buildSecretsPath: () => `/${PREFIX}/secrets`,
  buildConfigurationPath: () => `/${PREFIX}/configuration`,
} as const;
