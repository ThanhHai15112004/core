/** Query key của Security / Secrets / Configuration. Package dùng chung key `consoleKeys.packages`. */
export const securityKeys = {
  all: ['governance'] as const,
  secrets: () => ['governance', 'secrets'] as const,
  configuration: () => ['governance', 'configuration'] as const,
};
