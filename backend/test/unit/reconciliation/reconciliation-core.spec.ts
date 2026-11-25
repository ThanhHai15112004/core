import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import {
  BadRequestAppException,
  ConflictAppException,
  DATA_REPAIR_ACTION_MODE,
  DATA_REPAIR_EXECUTION_MODE,
  DATA_REPAIR_STATUS,
  ForbiddenAppException,
  RECONCILIATION_DISCREPANCY_STATUS,
  RECONCILIATION_DISCREPANCY_TYPE,
  RECONCILIATION_QUEUE_TOPICS,
  RECONCILIATION_RUN_STATUS,
  RECONCILIATION_SEVERITY,
  ReconciliationRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import { REQUIRED_PERMISSIONS_KEY, createPaginatedResult } from '@packages/http/index.js';
import type { AuditLogService, UserIdentity } from '@packages/security/index.js';
import type { IPaymentsPublicService } from '@modules/payments/contracts/index.js';
import {
  GenericDatasetReconciliationAdapter,
  GenericDatasetRepairHandler,
} from '@modules/reconciliation/adapters/generic-dataset.adapter.js';
import {
  PaymentsBridgeReconciliationAdapter,
  PaymentsBridgeRepairHandler,
} from '@modules/reconciliation/adapters/payments-bridge.adapter.js';
import { ReconciliationController } from '@modules/reconciliation/controllers/reconciliation.controller.js';
import type { DataRepairExecutionEntity } from '@modules/reconciliation/entities/data-repair-execution.entity.js';
import type { DataRepairRequestEntity } from '@modules/reconciliation/entities/data-repair-request.entity.js';
import type { ReconciliationDiscrepancyEntity } from '@modules/reconciliation/entities/reconciliation-discrepancy.entity.js';
import type { ReconciliationJobEntity } from '@modules/reconciliation/entities/reconciliation-job.entity.js';
import type { ReconciliationRunEntity } from '@modules/reconciliation/entities/reconciliation-run.entity.js';
import {
  RECONCILIATION_ADAPTER_CODES,
  RECONCILIATION_COMPENSATION_TYPES,
  RECONCILIATION_REPAIR_HANDLER_CODES,
  RECONCILIATION_SETTING_KEYS,
} from '@modules/reconciliation/enum/reconciliation.enum.js';
import {
  parseComparableRecordsFromCsv,
  resolveReconciliationRuntimeConfig,
} from '@modules/reconciliation/helpers/reconciliation-config.helper.js';
import { runReconciliationComparison } from '@modules/reconciliation/helpers/reconciliation-engine.helper.js';
import type { DataRepairExecutionRepository } from '@modules/reconciliation/repositories/data-repair-execution.repository.js';
import type { DataRepairRequestRepository } from '@modules/reconciliation/repositories/data-repair-request.repository.js';
import type { ReconciliationDiscrepancyRepository } from '@modules/reconciliation/repositories/reconciliation-discrepancy.repository.js';
import type { ReconciliationJobRepository } from '@modules/reconciliation/repositories/reconciliation-job.repository.js';
import type { ReconciliationRunRepository } from '@modules/reconciliation/repositories/reconciliation-run.repository.js';
import { DataRepairService } from '@modules/reconciliation/services/data-repair.service.js';
import { ReconciliationDiscrepanciesService } from '@modules/reconciliation/services/reconciliation-discrepancies.service.js';
import { ReconciliationJobsService } from '@modules/reconciliation/services/reconciliation-jobs.service.js';
import { ReconciliationRunnerService } from '@modules/reconciliation/services/reconciliation-runner.service.js';

function createInMemoryRepos() {
  let jobSeq = 1;
  let runSeq = 1;
  let discSeq = 1;
  let repairSeq = 1;
  let execSeq = 1;

  const jobs: ReconciliationJobEntity[] = [];
  const runs: ReconciliationRunEntity[] = [];
  const discrepancies: ReconciliationDiscrepancyEntity[] = [];
  const repairs: DataRepairRequestEntity[] = [];
  const executions: DataRepairExecutionEntity[] = [];

  const jobRepo = {
    findByIdSafe: jest.fn(async (id: number) => jobs.find((j) => Number(j.id) === id) ?? null),
    findByJobCode: jest.fn(async (code: string) => jobs.find((j) => j.jobCode === code) ?? null),
    listPaginated: jest.fn(async () => createPaginatedResult([...jobs], jobs.length, 1, 20)),
    listDueScheduledJobs: jest.fn(async (now: Date) =>
      jobs.filter(
        (j) =>
          j.isEnabled &&
          Boolean(j.scheduleCron) &&
          (!j.nextRunAt || j.nextRunAt.getTime() <= now.getTime()),
      ),
    ),
    saveEntity: jest.fn(async (partial: Partial<ReconciliationJobEntity>) => {
      if (partial.id) {
        const idx = jobs.findIndex((j) => Number(j.id) === Number(partial.id));
        if (idx >= 0) {
          jobs[idx] = { ...jobs[idx]!, ...partial, updatedAt: new Date() };
          return jobs[idx]!;
        }
      }
      const created = {
        id: jobSeq++,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...partial,
      } as ReconciliationJobEntity;
      jobs.push(created);
      return created;
    }),
  } as unknown as ReconciliationJobRepository;

  const runRepo = {
    findByIdSafe: jest.fn(async (id: number) => runs.find((r) => Number(r.id) === id) ?? null),
    findByRunCode: jest.fn(async (code: string) => runs.find((r) => r.runCode === code) ?? null),
    listPaginated: jest.fn(async () => createPaginatedResult([...runs], runs.length, 1, 20)),
    saveEntity: jest.fn(async (partial: Partial<ReconciliationRunEntity>) => {
      if (partial.id) {
        const idx = runs.findIndex((r) => Number(r.id) === Number(partial.id));
        if (idx >= 0) {
          runs[idx] = { ...runs[idx]!, ...partial, updatedAt: new Date() };
          return runs[idx]!;
        }
      }
      const created = {
        id: runSeq++,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        totalInternalCount: 0,
        totalExternalCount: 0,
        matchedCount: 0,
        discrepancyCount: 0,
        missingInternalCount: 0,
        missingExternalCount: 0,
        duplicateCount: 0,
        statusMismatchCount: 0,
        amountMismatchCount: 0,
        dataMismatchCount: 0,
        internalTotalAmount: 0,
        externalTotalAmount: 0,
        amountDiffTotal: 0,
        currency: null,
        correlationId: null,
        idempotencyKey: null,
        summaryJson: null,
        errorMessage: null,
        ...partial,
      } as ReconciliationRunEntity;
      runs.push(created);
      return created;
    }),
  } as unknown as ReconciliationRunRepository;

  const discrepancyRepo = {
    findByIdSafe: jest.fn(
      async (id: number) => discrepancies.find((d) => Number(d.id) === id) ?? null,
    ),
    listPaginated: jest.fn(async () =>
      createPaginatedResult([...discrepancies], discrepancies.length, 1, 20),
    ),
    listForReport: jest.fn(async (filter: { runId?: number; jobId?: number }) =>
      discrepancies.filter(
        (d) =>
          (filter.runId === undefined || Number(d.runId) === filter.runId) &&
          (filter.jobId === undefined || Number(d.jobId) === filter.jobId),
      ),
    ),
    listForExport: jest.fn(async () => [...discrepancies]),
    saveEntity: jest.fn(async (partial: Partial<ReconciliationDiscrepancyEntity>) => {
      if (partial.id) {
        const idx = discrepancies.findIndex((d) => Number(d.id) === Number(partial.id));
        if (idx >= 0) {
          discrepancies[idx] = { ...discrepancies[idx]!, ...partial, updatedAt: new Date() };
          return discrepancies[idx]!;
        }
      }
      const created = {
        id: discSeq++,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...partial,
      } as ReconciliationDiscrepancyEntity;
      discrepancies.push(created);
      return created;
    }),
  } as unknown as ReconciliationDiscrepancyRepository;

  const repairRepo = {
    findByIdSafe: jest.fn(async (id: number) => repairs.find((r) => Number(r.id) === id) ?? null),
    findByRepairCode: jest.fn(
      async (code: string) => repairs.find((r) => r.repairCode === code) ?? null,
    ),
    listPaginated: jest.fn(async () => createPaginatedResult([...repairs], repairs.length, 1, 20)),
    listByParentRepairId: jest.fn(async (parentId: number) =>
      repairs.filter((r) => Number(r.parentRepairId) === parentId),
    ),
    saveEntity: jest.fn(async (partial: Partial<DataRepairRequestEntity>) => {
      if (partial.id) {
        const idx = repairs.findIndex((r) => Number(r.id) === Number(partial.id));
        if (idx >= 0) {
          repairs[idx] = { ...repairs[idx]!, ...partial, updatedAt: new Date() };
          return repairs[idx]!;
        }
      }
      const created = {
        id: repairSeq++,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...partial,
      } as DataRepairRequestEntity;
      repairs.push(created);
      return created;
    }),
  } as unknown as DataRepairRequestRepository;

  const executionRepo = {
    listByRepairRequestId: jest.fn(async (repairRequestId: number) =>
      executions.filter((e) => Number(e.repairRequestId) === repairRequestId),
    ),
    saveEntity: jest.fn(async (partial: Partial<DataRepairExecutionEntity>) => {
      const created = {
        id: execSeq++,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...partial,
      } as DataRepairExecutionEntity;
      executions.push(created);
      return created;
    }),
  } as unknown as DataRepairExecutionRepository;

  return {
    stores: { jobs, runs, discrepancies, repairs, executions },
    jobRepo,
    runRepo,
    discrepancyRepo,
    repairRepo,
    executionRepo,
  };
}

describe('Phase 11.5 — Reconciliation & Data Repair Core', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies missing, duplicate, status mismatch, amount mismatch, and data mismatch with severity', () => {
    const settingRegistry = new SettingRegistryService();
    const runtimeConfig = resolveReconciliationRuntimeConfig(settingRegistry);

    const internalCsv = [
      'recordKey,status,amount,currency,channel',
      'ORD-OK,SUCCEEDED,500000,VND,WEB',
      'ORD-MISS-EXT,SUCCEEDED,1500000,VND,WEB',
      'ORD-DUP-INT,SUCCEEDED,200000,VND,WEB',
      'ORD-DUP-INT,SUCCEEDED,200000,VND,WEB',
      'ORD-STATUS,PENDING,400000,VND,WEB',
      'ORD-AMOUNT,SUCCEEDED,12500000,VND,WEB',
      'ORD-DATA,SUCCEEDED,300000,VND,WEB',
    ].join('\n');

    const externalCsv = [
      'recordKey,status,amount,currency,channel',
      'ORD-OK,SUCCEEDED,500000,VND,WEB',
      'ORD-MISS-INT,SUCCEEDED,2000000,VND,APP',
      'ORD-DUP-EXT,SUCCEEDED,100000,VND,WEB',
      'ORD-DUP-EXT,SUCCEEDED,100000,VND,WEB',
      'ORD-STATUS,SUCCEEDED,400000,VND,WEB',
      'ORD-AMOUNT,SUCCEEDED,2000000,VND,WEB',
      'ORD-DATA,SUCCEEDED,300000,VND,MOBILE',
    ].join('\n');

    const result = runReconciliationComparison({
      internalRecords: parseComparableRecordsFromCsv(internalCsv),
      externalRecords: parseComparableRecordsFromCsv(externalCsv),
      matchingRules: { compareFields: ['channel'] },
      runtimeConfig,
    });

    expect(result.matchedCount).toBe(1);
    expect(result.missingInternalCount).toBe(1);
    expect(result.missingExternalCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.statusMismatchCount).toBe(1);
    expect(result.amountMismatchCount).toBe(1);
    expect(result.dataMismatchCount).toBe(1);

    const byKey = new Map(result.discrepancies.map((d) => [d.recordKey, d]));
    expect(byKey.get('ORD-MISS-INT')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL,
    );
    expect(byKey.get('ORD-MISS-EXT')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.MISSING_EXTERNAL,
    );
    expect(byKey.get('ORD-DUP-INT')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_INTERNAL,
    );
    expect(byKey.get('ORD-DUP-EXT')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_EXTERNAL,
    );
    expect(byKey.get('ORD-STATUS')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.STATUS_MISMATCH,
    );
    expect(byKey.get('ORD-STATUS')?.severity).toBe(RECONCILIATION_SEVERITY.MEDIUM);
    expect(byKey.get('ORD-AMOUNT')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH,
    );
    expect(byKey.get('ORD-AMOUNT')?.amountDiff).toBe(10_500_000);
    expect(byKey.get('ORD-AMOUNT')?.severity).toBe(RECONCILIATION_SEVERITY.CRITICAL);
    expect(byKey.get('ORD-DATA')?.discrepancyType).toBe(
      RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH,
    );
    expect(byKey.get('ORD-DATA')?.severity).toBe(RECONCILIATION_SEVERITY.LOW);
  });

  it('executes manual reconciliation with audit, builds discrepancy report with severity/owner, assigns owner and exports CSV', async () => {
    const { jobRepo, runRepo, discrepancyRepo } = createInMemoryRepos();
    const registry = new ReconciliationRegistryService();
    registry.registerAdapter(new GenericDatasetReconciliationAdapter());

    const auditRecord = jest.fn(async () => undefined);
    const auditLogService = { record: auditRecord } as unknown as AuditLogService;
    const notifyDispatch = jest.fn(async () => ({ id: 1 }));
    const notificationsService = { dispatch: notifyDispatch } as never;

    const jobsService = new ReconciliationJobsService(
      jobRepo,
      registry,
      undefined,
      auditLogService,
    );
    const runnerService = new ReconciliationRunnerService(
      jobsService,
      jobRepo,
      runRepo,
      discrepancyRepo,
      registry,
      new SettingRegistryService(),
      undefined,
      undefined,
      auditLogService,
      undefined,
      notificationsService,
    );
    const discrepanciesService = new ReconciliationDiscrepanciesService(
      discrepancyRepo,
      auditLogService,
      undefined,
      notificationsService,
    );

    const operator: UserIdentity = {
      id: 10,
      roles: ['admin'],
      permissions: ['reconciliation.job.manage', 'reconciliation.run.execute'],
    };

    const job = await jobsService.createJob(
      {
        name: 'Daily Order Statement Recon',
        adapterCode: RECONCILIATION_ADAPTER_CODES.GENERIC_DATASET,
        scheduleCron: '*/15 * * * *',
        defaultAssigneeUserId: 21,
      },
      operator,
    );

    const run = await runnerService.triggerManualRun(
      job.id,
      {
        reason: 'End-of-day audit check',
        internalRecords: [
          { recordKey: 'TX-1', status: 'PENDING', amount: 500_000, currency: 'VND' },
          { recordKey: 'TX-2', status: 'SUCCEEDED', amount: 3_000_000, currency: 'VND' },
        ],
        externalRecords: [
          { recordKey: 'TX-1', status: 'SUCCEEDED', amount: 500_000, currency: 'VND' },
          { recordKey: 'TX-2', status: 'SUCCEEDED', amount: 1_500_000, currency: 'VND' },
        ],
      },
      operator,
    );

    expect(run.status).toBe(RECONCILIATION_RUN_STATUS.COMPLETED);
    expect(run.discrepancyCount).toBe(2);
    expect(run.statusMismatchCount).toBe(1);
    expect(run.amountMismatchCount).toBe(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'reconciliation',
        action: 'MANUAL_RUN',
        actorUserId: 10,
      }),
    );
    // HIGH/CRITICAL discrepancy notifies default owner #21
    expect(notifyDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: 21 }));

    const report = await discrepanciesService.getDiscrepancyReport({ runId: run.id });
    expect(report.totalDiscrepancies).toBe(2);
    expect(report.byType.STATUS_MISMATCH).toBe(1);
    expect(report.byType.AMOUNT_MISMATCH).toBe(1);
    expect(report.bySeverity.HIGH).toBe(1);
    expect(report.totalAbsAmountDiff).toBe(1_500_000);
    expect(report.byAssignee[0]?.assigneeUserId).toBe(21);

    const list = await discrepanciesService.listDiscrepancies({ page: 1, limit: 20, offset: 0 });
    const firstDisc = list.data[0]!;
    const reassigned = await discrepanciesService.assignDiscrepancy(
      firstDisc.id,
      { assigneeUserId: 35, note: 'Handing over to finance lead' },
      operator,
    );
    expect(reassigned.assigneeUserId).toBe(35);

    const exported = await discrepanciesService.exportDiscrepanciesCsv({}, operator);
    expect(exported.totalRows).toBe(2);
    expect(exported.buffer.toString('utf8')).toContain('TX-1');
    expect(exported.buffer.toString('utf8')).toContain('AMOUNT_MISMATCH');
  });

  it('enforces Dry-Run preview, Maker-Checker approval on sensitive repairs, records before/after, and creates compensating action without losing history', async () => {
    const { stores, discrepancyRepo, repairRepo, executionRepo } = createInMemoryRepos();
    const registry = new ReconciliationRegistryService();
    registry.registerRepairHandler(new GenericDatasetRepairHandler());

    const auditEntries: Array<Record<string, unknown>> = [];
    const auditLogService = {
      record: jest.fn(async (entry: Record<string, unknown>) => {
        auditEntries.push(entry);
      }),
    } as unknown as AuditLogService;

    const settingRegistry = new SettingRegistryService();
    settingRegistry.setGlobalValue(
      RECONCILIATION_SETTING_KEYS.SENSITIVE_AMOUNT_THRESHOLD,
      1_000_000,
    );
    settingRegistry.setGlobalValue(RECONCILIATION_SETTING_KEYS.REQUIRE_DRY_RUN_BEFORE_APPLY, true);

    const repairService = new DataRepairService(
      repairRepo,
      executionRepo,
      discrepancyRepo,
      registry,
      settingRegistry,
      undefined,
      undefined,
      auditLogService,
    );

    const savedDisc = await discrepancyRepo.saveEntity({
      discrepancyCode: 'RDS-202611-000001',
      runId: 1,
      jobId: 1,
      targetModule: 'reconciliation',
      entityType: 'order_ledger',
      entityId: 'ORD-9001',
      recordKey: 'ORD-9001',
      discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH,
      severity: RECONCILIATION_SEVERITY.HIGH,
      status: RECONCILIATION_DISCREPANCY_STATUS.OPEN,
      assigneeUserId: 101,
      internalStatus: 'SUCCEEDED',
      externalStatus: 'SUCCEEDED',
      internalAmount: 2_500_000,
      externalAmount: 1_000_000,
      amountDiff: 1_500_000,
      currency: 'VND',
      internalSnapshotJson: JSON.stringify({
        recordKey: 'ORD-9001',
        status: 'SUCCEEDED',
        amount: 2_500_000,
        currency: 'VND',
      }),
      externalSnapshotJson: JSON.stringify({
        recordKey: 'ORD-9001',
        status: 'SUCCEEDED',
        amount: 1_000_000,
        currency: 'VND',
      }),
      diffFieldsJson: JSON.stringify({ amountDiff: 1_500_000 }),
      resolutionNote: null,
      resolvedBy: null,
      resolvedAt: null,
    });

    const proposer: UserIdentity = { id: 101, roles: ['ops'], permissions: [] };
    const approver: UserIdentity = { id: 202, roles: ['finance_manager'], permissions: [] };

    // 1. Standalone Dry-Run Preview — no DB records created
    const preview = await repairService.previewRepair(
      {
        discrepancyId: savedDisc.id,
        handlerCode: RECONCILIATION_REPAIR_HANDLER_CODES.GENERIC_DATASET,
        payload: { syncFromExternal: true, nonRollbackable: true },
        reason: 'Dry-run verify amount adjustment before proposing',
      },
      proposer,
    );
    expect(preview.isSensitive).toBe(true);
    expect(preview.canRollback).toBe(false);
    expect(preview.beforeSnapshot.amount).toBe(2_500_000);
    expect(preview.predictedAfterSnapshot.amount).toBe(1_000_000);
    expect(stores.repairs.length).toBe(0);

    // 2. Propose sensitive repair -> PENDING_APPROVAL + DRY_RUN execution log
    const proposed = await repairService.proposeRepair(
      {
        discrepancyId: savedDisc.id,
        handlerCode: RECONCILIATION_REPAIR_HANDLER_CODES.GENERIC_DATASET,
        payload: { syncFromExternal: true, nonRollbackable: true },
        reason: 'Sync settled order amount with external statement',
      },
      proposer,
    );
    expect(proposed.status).toBe(DATA_REPAIR_STATUS.PENDING_APPROVAL);
    expect(proposed.isSensitive).toBe(true);
    expect(proposed.canRollback).toBe(false);
    expect(proposed.executions?.length).toBe(1);
    expect(proposed.executions?.[0]?.executionMode).toBe(DATA_REPAIR_EXECUTION_MODE.DRY_RUN);

    // 3. Cannot apply sensitive repair before approval
    await expect(repairService.applyRepair(proposed.id, proposer)).rejects.toThrow(
      ForbiddenAppException,
    );

    // 4. Maker CANNOT self-approve (tách người đề xuất và người duyệt)
    await expect(
      repairService.approveRepair(proposed.id, { note: 'Self approve attempt' }, proposer),
    ).rejects.toThrow(ForbiddenAppException);

    // 5. Independent Checker approves
    const approved = await repairService.approveRepair(
      proposed.id,
      { note: 'Verified bank statement' },
      approver,
    );
    expect(approved.status).toBe(DATA_REPAIR_STATUS.APPROVED);
    expect(approved.approvedBy).toBe(202);

    // 6. Apply repair -> records exact before & after snapshots + append-only execution + AuditLog
    const applied = await repairService.applyRepair(proposed.id, proposer);
    expect(applied.status).toBe(DATA_REPAIR_STATUS.EXECUTED);
    expect(applied.beforeSnapshot?.amount).toBe(2_500_000);
    expect(applied.afterSnapshot?.amount).toBe(1_000_000);
    expect(applied.executions?.length).toBe(2);
    expect(applied.executions?.[1]?.executionMode).toBe(DATA_REPAIR_EXECUTION_MODE.APPLY);
    expect(
      auditEntries.some(
        (e) =>
          e.action === 'APPLY_REPAIR' &&
          (e.beforeData as Record<string, unknown>)?.amount === 2_500_000 &&
          (e.afterData as Record<string, unknown>)?.amount === 1_000_000,
      ),
    ).toBe(true);

    // Double-apply must fail with Conflict
    await expect(repairService.applyRepair(proposed.id, proposer)).rejects.toThrow(
      ConflictAppException,
    );

    // 7. Compensating action when rollback is not possible -> preserves original history!
    const compProposed = await repairService.proposeCompensation(
      applied.id,
      {
        compensationType: RECONCILIATION_COMPENSATION_TYPES.ADJUSTMENT_ENTRY,
        payload: { adjustmentAmount: 500_000, currency: 'VND' },
        reason: 'Post compensating ledger entry since original settlement cannot be rolled back',
      },
      proposer,
    );
    expect(compProposed.actionMode).toBe(DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION);
    expect(compProposed.parentRepairId).toBe(applied.id);
    expect(compProposed.status).toBe(DATA_REPAIR_STATUS.PENDING_APPROVAL);

    await repairService.approveRepair(compProposed.id, { note: 'Approved compensation' }, approver);
    const compExecuted = await repairService.applyRepair(compProposed.id, proposer);
    expect(compExecuted.status).toBe(DATA_REPAIR_STATUS.EXECUTED);
    expect(compExecuted.compensationDetails?.adjustmentAmount).toBe(500_000);

    // Verify original repair history is 100% intact and marked COMPENSATED
    const originalAfterComp = await repairService.getRepairById(applied.id);
    expect(originalAfterComp.status).toBe(DATA_REPAIR_STATUS.COMPENSATED);
    expect(originalAfterComp.beforeSnapshot?.amount).toBe(2_500_000);
    expect(originalAfterComp.afterSnapshot?.amount).toBe(1_000_000);
    expect(originalAfterComp.executions?.length).toBe(2);

    // Linked discrepancy reflects COMPENSATED
    const discAfter = await discrepancyRepo.findByIdSafe(savedDisc.id);
    expect(discAfter?.status).toBe(RECONCILIATION_DISCREPANCY_STATUS.COMPENSATED);
  });

  it('bridges with payments module for cross-reconciliation and refund compensation', async () => {
    const refundPaymentMock = jest.fn(async () => ({
      refund: { id: 55, refundCode: 'RFD-202611-000055' },
      transaction: {
        id: 9,
        paymentCode: 'PAY-202611-000009',
        statusName: 'PARTIALLY_REFUNDED',
        refundedAmount: 200_000,
      },
    }));
    const paymentsPublicMock = {
      listTransactions: jest.fn(async () =>
        createPaginatedResult(
          [
            {
              id: 9,
              paymentCode: 'PAY-202611-000009',
              providerCode: 'vnpay',
              merchantOrderRef: 'INV-9',
              providerTransactionId: 'VNP-9',
              statusName: 'SUCCEEDED',
              amount: 1_000_000,
              refundedAmount: 0,
              currency: 'VND',
              paidAt: '2026-11-25T05:00:00.000Z',
              createdAt: '2026-11-25T05:00:00.000Z',
            },
          ],
          1,
          1,
          100,
        ),
      ),
      getTransactionByCode: jest.fn(async () => ({
        id: 9,
        paymentCode: 'PAY-202611-000009',
        providerCode: 'vnpay',
        statusName: 'SUCCEEDED',
        amount: 1_000_000,
        refundedAmount: 0,
        currency: 'VND',
      })),
      refundPayment: refundPaymentMock,
    } as unknown as IPaymentsPublicService;

    const adapter = new PaymentsBridgeReconciliationAdapter(paymentsPublicMock);
    const dataset = await adapter.fetchData({
      jobCode: 'RJB-PAY',
      jobConfig: {},
      matchingRules: adapter.defaultMatchingRules,
      periodStart: new Date('2026-11-25T00:00:00.000Z'),
      periodEnd: new Date('2026-11-25T23:59:59.000Z'),
      maxRecords: 100,
      externalCsv: 'paymentCode,status,amount,currency\nPAY-202611-000009,PAID,800000,VND',
    });

    expect(dataset.internalRecords.length).toBe(1);
    expect(dataset.externalRecords.length).toBe(1);

    const compared = runReconciliationComparison({
      internalRecords: dataset.internalRecords,
      externalRecords: dataset.externalRecords,
      matchingRules: adapter.defaultMatchingRules,
      runtimeConfig: resolveReconciliationRuntimeConfig(new SettingRegistryService()),
    });
    expect(compared.amountMismatchCount).toBe(1);
    expect(compared.discrepancies[0]?.amountDiff).toBe(200_000);

    const repairHandler = new PaymentsBridgeRepairHandler(paymentsPublicMock);
    const preview = await repairHandler.preview({
      repairCode: 'RPR-PAY-1',
      actionMode: DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION,
      target: {
        targetModule: 'payments',
        targetEntityType: 'payment_transaction',
        targetEntityId: 'PAY-202611-000009',
        amountDiff: 200_000,
      },
      payload: {
        compensationType: RECONCILIATION_COMPENSATION_TYPES.REFUND_COMPENSATION,
        refundAmount: 200_000,
      },
      reason: 'Refund excess charged amount',
      actorUserId: 10,
      dryRun: true,
    });
    expect(preview.isSensitive).toBe(true);
    expect(preview.canRollback).toBe(false);
    expect(preview.predictedAfterSnapshot.refundedAmount).toBe(200_000);

    const compensated = await repairHandler.compensate({
      repairCode: 'RPR-PAY-1',
      actionMode: DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION,
      target: {
        targetModule: 'payments',
        targetEntityType: 'payment_transaction',
        targetEntityId: 'PAY-202611-000009',
        amountDiff: 200_000,
      },
      payload: { refundAmount: 200_000 },
      reason: 'Refund excess charged amount',
      actorUserId: 10,
      dryRun: false,
      compensationType: RECONCILIATION_COMPENSATION_TYPES.REFUND_COMPENSATION,
    });
    expect(refundPaymentMock).toHaveBeenCalledTimes(1);
    expect(compensated.afterSnapshot.refundedAmount).toBe(200_000);
    expect(compensated.compensationDetails?.refundCode).toBe('RFD-202611-000055');
  });

  it('guards manual run, repair propose/approve/execute with granular RBAC permissions and validates invalid inputs', async () => {
    const reflector = new Reflector();
    expect(
      reflector.get(REQUIRED_PERMISSIONS_KEY, ReconciliationController.prototype.triggerManualRun),
    ).toEqual(['reconciliation.run.execute']);
    expect(
      reflector.get(REQUIRED_PERMISSIONS_KEY, ReconciliationController.prototype.proposeRepair),
    ).toEqual(['reconciliation.repair.propose']);
    expect(
      reflector.get(REQUIRED_PERMISSIONS_KEY, ReconciliationController.prototype.approveRepair),
    ).toEqual(['reconciliation.repair.approve']);
    expect(
      reflector.get(REQUIRED_PERMISSIONS_KEY, ReconciliationController.prototype.applyRepair),
    ).toEqual(['reconciliation.repair.execute']);

    expect(RECONCILIATION_QUEUE_TOPICS.RUN_JOB).toBe('reconciliation.run');
    expect(RECONCILIATION_QUEUE_TOPICS.SCHEDULE_TICK).toBe('reconciliation.schedule.tick');
    expect(() => parseComparableRecordsFromCsv('only_header')).toThrow(BadRequestAppException);
  });
});
