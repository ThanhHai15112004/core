const PREFIX = 'ops';

export const SYSTEM_OPS_ROUTES = {
  PREFIX,
  PACKAGES: 'packages',
  PACKAGE_DETAIL: 'packages/:packageId',
  EXECUTE_ACTION: 'packages/:packageId/actions/:actionId',
  OVERVIEW: 'overview',
  SECRETS: 'secrets',
  CONFIGURATION: 'configuration',
  CONFIGURATION_DOMAIN: 'configuration/:domain',
  buildPackagesPath: () => `/${PREFIX}/packages`,
  buildPackageDetailPath: (packageId: string) => `/${PREFIX}/packages/${packageId}`,
  buildExecuteActionPath: (packageId: string, actionId: string) =>
    `/${PREFIX}/packages/${packageId}/actions/${actionId}`,
  buildOverviewPath: () => `/${PREFIX}/overview`,
  buildSecretsPath: () => `/${PREFIX}/secrets`,
  buildConfigurationPath: (domain?: string) =>
    domain ? `/${PREFIX}/configuration/${domain}` : `/${PREFIX}/configuration`,
} as const;
