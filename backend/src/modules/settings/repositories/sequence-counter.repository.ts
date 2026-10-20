import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SequenceCounterEntity } from '../entities/sequence-counter.entity.js';

@Injectable()
export class SequenceCounterRepository extends BaseTypeOrmRepository<SequenceCounterEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SequenceCounterEntity, dataSource, transactionManager);
  }

  public async findBySequenceKey(sequenceKey: string): Promise<SequenceCounterEntity[]> {
    const normalized = sequenceKey.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { sequenceKey: normalized },
        order: { periodKey: 'DESC', unitScopeKey: 'ASC' },
      }),
    );
  }

  public async findAllCounters(): Promise<SequenceCounterEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        order: { sequenceKey: 'ASC', periodKey: 'DESC' },
      }),
    );
  }

  /**
   * 5.5.4: Cấp phát nguyên tử (Atomic Allocation) một dải `count` số thứ tự liên tiếp
   * bên trong Database Transaction / Upsert để đảm bảo 100% không bao giờ trùng mã
   * khi nhiều request hoặc nhiều instance gọi đồng thời.
   */
  public async allocateRange(params: {
    sequenceId: number;
    sequenceKey: string;
    periodKey: string;
    organizationUnitId: number | null;
    unitScopeKey: string;
    startValue: number;
    step: number;
    count: number;
  }): Promise<number[]> {
    const safeCount = Math.max(1, Math.trunc(params.count));
    const safeStart = Math.max(1, Math.trunc(params.startValue));
    const safeStep = Math.max(1, Math.trunc(params.step));

    const executeAtomic = async (manager: EntityManager): Promise<number[]> => {
      const isPostgres = this.dataSource.options.type === 'postgres';
      const firstBatchLastVal = safeStart + (safeCount - 1) * safeStep;
      const totalIncrement = safeCount * safeStep;

      if (isPostgres) {
        const rows = (await manager.query(
          `INSERT INTO sequence_counters (
             sequence_id, sequence_key, period_key, organization_unit_id, unit_scope_key, current_value, version
           ) VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (sequence_id, period_key, unit_scope_key)
           DO UPDATE SET
             current_value = GREATEST(
               sequence_counters.current_value + $7,
               $6
             ),
             version = sequence_counters.version + 1,
             updated_at = CURRENT_TIMESTAMP
           RETURNING current_value`,
          [
            params.sequenceId,
            params.sequenceKey,
            params.periodKey,
            params.organizationUnitId,
            params.unitScopeKey,
            firstBatchLastVal,
            totalIncrement,
          ],
        )) as Array<{ current_value: string | number }>;

        const endVal = Number(rows[0]?.current_value ?? firstBatchLastVal);
        const startOfBatch = endVal - (safeCount - 1) * safeStep;
        const numbers: number[] = [];
        for (let i = 0; i < safeCount; i++) {
          numbers.push(startOfBatch + i * safeStep);
        }
        return numbers;
      }

      // MySQL / MariaDB: Atomic Upsert (INSERT ... ON DUPLICATE KEY UPDATE) chống Race Condition
      // khi nhiều instance cùng cấp mã đầu tiên của kỳ mới trên uq_sequence_counters_scope,
      // kết hợp đọc giá trị đã khóa trong cùng Transaction để lấy chính xác endVal.
      const upsertResult = (await manager.query(
        `INSERT INTO sequence_counters (
           sequence_id, sequence_key, period_key, organization_unit_id, unit_scope_key, current_value, version, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           current_value = LAST_INSERT_ID(GREATEST(current_value + ?, ?)),
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP`,
        [
          params.sequenceId,
          params.sequenceKey,
          params.periodKey,
          params.organizationUnitId,
          params.unitScopeKey,
          firstBatchLastVal,
          totalIncrement,
          firstBatchLastVal,
        ],
      )) as
        | { affectedRows?: number; insertId?: number | string }
        | Array<{ current_value?: string | number }>;

      const lockedRows = (await manager.query(
        `SELECT id, current_value FROM sequence_counters
         WHERE sequence_id = ? AND period_key = ? AND unit_scope_key = ?
         FOR UPDATE`,
        [params.sequenceId, params.periodKey, params.unitScopeKey],
      )) as Array<{ id?: number; current_value?: string | number }> | undefined;

      let endVal = firstBatchLastVal;
      if (Array.isArray(lockedRows) && lockedRows[0]?.current_value !== undefined) {
        endVal = Number(lockedRows[0].current_value);
      } else if (
        upsertResult &&
        !Array.isArray(upsertResult) &&
        typeof upsertResult === 'object' &&
        upsertResult.affectedRows === 2 &&
        upsertResult.insertId !== undefined &&
        Number(upsertResult.insertId) > 0
      ) {
        endVal = Number(upsertResult.insertId);
      }

      const startOfBatch = endVal - (safeCount - 1) * safeStep;
      const numbers: number[] = [];
      for (let i = 0; i < safeCount; i++) {
        numbers.push(startOfBatch + i * safeStep);
      }
      return numbers;
    };

    const runOnce = async (): Promise<number[]> => {
      if (this.transactionManager) {
        return this.transactionManager.runInTransaction((manager) => executeAtomic(manager));
      }
      return executeAtomic(this.manager);
    };

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await runOnce();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTransientConcurrencyError =
          /deadlock|lock wait timeout|could not serialize|duplicate key|ER_LOCK_DEADLOCK|ER_DUP_ENTRY|40P01|23505/i.test(
            msg,
          );
        if (isTransientConcurrencyError && attempt < maxAttempts) {
          continue;
        }
        throw err;
      }
    }

    return runOnce();
  }
}
