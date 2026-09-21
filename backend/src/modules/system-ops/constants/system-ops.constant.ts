export const SYSTEM_OPS_ROUTES = {
  PREFIX: 'ops',
  PACKAGES: 'packages',
  PACKAGE_DETAIL: 'packages/:packageId',
  EXECUTE_ACTION: 'packages/:packageId/actions/:actionId',
  buildPackagesPath: () => `/ops/packages`,
  buildPackageDetailPath: (packageId: string) => `/ops/packages/${packageId}`,
  buildExecuteActionPath: (packageId: string, actionId: string) =>
    `/ops/packages/${packageId}/actions/${actionId}`,
} as const;
