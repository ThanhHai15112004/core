export const API_ROUTES = {
  HEALTH: '/health',
  OPS: {
    OVERVIEW: '/ops/overview',
    PACKAGES: '/ops/packages',
    PACKAGE_DETAIL: (packageId: string) => `/ops/packages/${packageId}`,
    EXECUTE_ACTION: (packageId: string, actionId: string) =>
      `/ops/packages/${packageId}/actions/${actionId}`,
  },
} as const;
