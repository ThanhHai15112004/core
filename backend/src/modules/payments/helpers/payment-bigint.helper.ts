import type { ValueTransformer } from 'typeorm';
import { BadRequestAppException } from '@packages/kernel/index.js';

/**
 * Chuyển đổi cột `BIGINT` (PostgreSQL `pg` trả về `string` lúc runtime) sang `number` an toàn,
 * tránh lỗi so sánh sai kiểu (`'100000' === 100000`) khi đối chiếu số tiền thanh toán/hoàn tiền.
 */
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

export function assertSafeMinorAmount(amount: number, allowZero = false): number {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(amount) ||
    (allowZero ? amount < 0 : amount <= 0)
  ) {
    throw new BadRequestAppException('payments.invalidAmount', [{ amount }]);
  }
  return amount;
}
