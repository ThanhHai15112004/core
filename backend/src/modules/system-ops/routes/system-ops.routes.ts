const PREFIX = 'ops';

export const SYSTEM_OPS_ROUTES = {
  PREFIX,
  PACKAGES: 'packages',
  PACKAGE_DETAIL: 'packages/:packageId',
  EXECUTE_ACTION: 'packages/:packageId/actions/:actionId',
  OVERVIEW: 'overview',
  buildPackagesPath: () => `/${PREFIX}/packages`,
  buildPackageDetailPath: (packageId: string) => `/${PREFIX}/packages/${packageId}`,
  buildExecuteActionPath: (packageId: string, actionId: string) =>
    `/${PREFIX}/packages/${packageId}/actions/${actionId}`,
  buildOverviewPath: () => `/${PREFIX}/overview`,
} as const;
