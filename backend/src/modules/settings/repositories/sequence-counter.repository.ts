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

      // MySQL / MariaDB: Khóa dòng trong Transaction để cấp dải số nguyên tử
      const existingRows = (await manager.query(
        `SELECT id, current_value FROM sequence_counters
         WHERE sequence_id = ? AND period_key = ? AND unit_scope_key = ?
         FOR UPDATE`,
        [params.sequenceId, params.periodKey, params.unitScopeKey],
      )) as Array<{ id: number; current_value: string | number }>;

      if (existingRows.length === 0) {
        await manager.query(
          `INSERT INTO sequence_counters (
             sequence_id, sequence_key, period_key, organization_unit_id, unit_scope_key, current_value, version
           ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [
            params.sequenceId,
            params.sequenceKey,
            params.periodKey,
            params.organizationUnitId,
            params.unitScopeKey,
            firstBatchLastVal,
          ],
        );
        const numbers: number[] = [];
        for (let i = 0; i < safeCount; i++) {
          numbers.push(safeStart + i * safeStep);
        }
        return numbers;
      }

      const prevVal = Number(existingRows[0]!.current_value);
      const nextFirstVal = Math.max(prevVal + safeStep, safeStart);
      const nextLastVal = nextFirstVal + (safeCount - 1) * safeStep;

      await manager.query(
        `UPDATE sequence_counters
         SET current_value = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextLastVal, existingRows[0]!.id],
      );

      const numbers: number[] = [];
      for (let i = 0; i < safeCount; i++) {
        numbers.push(nextFirstVal + i * safeStep);
      }
      return numbers;
    };

    if (this.transactionManager) {
      try {
        return await this.transactionManager.runInTransaction((manager) => executeAtomic(manager));
      } catch {
        return executeAtomic(this.manager);
      }
    }

    return executeAtomic(this.manager);
  }
}
