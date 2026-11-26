import type { ValueTransformer } from 'typeorm';

export const backupNullableBigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return null;
    }
    return Math.trunc(Number(value));
  },
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  },
};
