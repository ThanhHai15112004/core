const PREFIX = 'ops';

export const SYSTEM_OPS_ROUTES = {
  PREFIX,
  PACKAGES: 'packages',
  EXECUTE_ACTION: 'packages/:packageId/actions/:actionId',
  OVERVIEW: 'overview',
  SYSTEM_INFO: 'system-info',
  MODULES: 'modules',
  SECRETS: 'secrets',
  CONFIGURATION: 'configuration',
  buildPackagesPath: () => `/${PREFIX}/packages`,
  buildExecuteActionPath: (packageId: string, actionId: string) =>
    `/${PREFIX}/packages/${packageId}/actions/${actionId}`,
  buildOverviewPath: () => `/${PREFIX}/overview`,
  buildSystemInfoPath: () => `/${PREFIX}/system-info`,
  buildModulesPath: () => `/${PREFIX}/modules`,
  buildSecretsPath: () => `/${PREFIX}/secrets`,
  buildConfigurationPath: () => `/${PREFIX}/configuration`,
} as const;
