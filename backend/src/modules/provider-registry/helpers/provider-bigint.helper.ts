import type { ValueTransformer } from 'typeorm';

export const bigintNumberTransformer: ValueTransformer = {
  to(value: number): number {
    return value;
  },
  from(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
  },
};

export const nullableBigintNumberTransformer: ValueTransformer = {
  to(value: number | null | undefined): number | null {
    return value === undefined ? null : value;
  },
  from(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  },
};
