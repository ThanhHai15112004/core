import type { ValueTransformer } from 'typeorm';

export const reconBigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return 0;
    }
    return Math.trunc(Number(value));
  },
  from: (value: string | number | null | undefined): number => {
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
};

export const reconNullableBigintTransformer: ValueTransformer = {
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
