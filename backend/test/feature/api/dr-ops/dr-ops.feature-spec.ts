import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createPaginatedResult } from '@packages/http/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { DrProfileRepository } from '@modules/dr-ops/repositories/dr-profile.repository.js';
import { DrSyncRunRepository } from '@modules/dr-ops/repositories/dr-sync-run.repository.js';
import { DrSwitchExecutionRepository } from '@modules/dr-ops/repositories/dr-switch-execution.repository.js';
import { DrReconciliationReportRepository } from '@modules/dr-ops/repositories/dr-reconciliation-report.repository.js';
import { DrDrillRepository } from '@modules/dr-ops/repositories/dr-drill.repository.js';
import type { DrProfileEntity } from '@modules/dr-ops/entities/dr-profile.entity.js';
import type { DrSyncRunEntity } from '@modules/dr-ops/entities/dr-sync-run.entity.js';
import type { DrSwitchExecutionEntity } from '@modules/dr-ops/entities/dr-switch-execution.entity.js';
import type { DrReconciliationReportEntity } from '@modules/dr-ops/entities/dr-reconciliation-report.entity.js';
import type { DrDrillEntity } from '@modules/dr-ops/entities/dr-drill.entity.js';

describe('Feature: Disaster Recovery Ops API (/ops/dr)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    process.env['DR_DB_PASSWORD'] = 'secret-dr-db-password';
    process.env['DR_STORAGE_S3_ACCESS_KEY'] = 'secret-dr-access-key';
    process.env['DR_STORAGE_S3_SECRET_KEY'] = 'secret-dr-secret-key';
    process.env['DR_SWITCH_WEBHOOK_SECRET'] = 'secret-dr-webhook-hmac';
    context = await createTestApp();

    const profileRepo = context.moduleFixture.get(DrProfileRepository);
    if (!profileRepo.isDatabaseReady()) {
      const syncRepo = context.moduleFixture.get(DrSyncRunRepository);
      const switchRepo = context.moduleFixture.get(DrSwitchExecutionRepository);
      const reconcileRepo = context.moduleFixture.get(DrReconciliationReportRepository);
      const drillRepo = context.moduleFixture.get(DrDrillRepository);

      let profileMem: DrProfileEntity | null = null;
      const syncsMem: DrSyncRunEntity[] = [];
      const switchesMem: DrSwitchExecutionEntity[] = [];
      const reconcilesMem: DrReconciliationReportEntity[] = [];
      const drillsMem: DrDrillEntity[] = [];
      let seq = 1;

      jest.spyOn(profileRepo, 'isDatabaseReady').mockReturnValue(true);
      jest.spyOn(profileRepo, 'findByCodeSafe').mockImplementation(async () => profileMem);
      jest.spyOn(profileRepo, 'saveEntity').mockImplementation(async (input) => {
        const now = new Date();
        profileMem = {
          id: profileMem?.id ?? 1,
          version: 1,
          createdAt: profileMem?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
          ...(profileMem ?? {}),
          ...input,
        } as DrProfileEntity;
        return profileMem;
      });

      jest.spyOn(syncRepo, 'isDatabaseReady').mockReturnValue(true);
      jest.spyOn(syncRepo, 'findLatest').mockImplementation(async () => syncsMem[0] ?? null);
      jest
        .spyOn(syncRepo, 'listPaginated')
        .mockImplementation(async (f) =>
          createPaginatedResult(syncsMem, syncsMem.length, f.page ?? 1, f.limit ?? 20),
        );
      jest.spyOn(syncRepo, 'saveEntity').mockImplementation(async (input) => {
        const now = new Date();
        const item = {
          id: seq++,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...input,
        } as DrSyncRunEntity;
        syncsMem.unshift(item);
        return item;
      });

      jest.spyOn(switchRepo, 'isDatabaseReady').mockReturnValue(true);
      jest
        .spyOn(switchRepo, 'listPaginated')
        .mockImplementation(async (f) =>
          createPaginatedResult(switchesMem, switchesMem.length, f.page ?? 1, f.limit ?? 20),
        );
      jest
        .spyOn(switchRepo, 'findActiveInProgress')
        .mockImplementation(
          async () => switchesMem.find((s) => s.status === 'IN_PROGRESS') ?? null,
        );
      jest
        .spyOn(switchRepo, 'findByIdSafe')
        .mockImplementation(async (id) => switchesMem.find((s) => Number(s.id) === id) ?? null);
      jest.spyOn(switchRepo, 'saveEntity').mockImplementation(async (input) => {
        const now = new Date();
        const existingIdx =
          input.id !== undefined
            ? switchesMem.findIndex((s) => Number(s.id) === Number(input.id))
            : -1;
        if (existingIdx >= 0) {
          switchesMem[existingIdx] = {
            ...switchesMem[existingIdx]!,
            ...input,
            updatedAt: now,
          } as DrSwitchExecutionEntity;
          return switchesMem[existingIdx]!;
        }
        const item = {
          id: seq++,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...input,
        } as DrSwitchExecutionEntity;
        switchesMem.unshift(item);
        return item;
      });

      jest.spyOn(reconcileRepo, 'isDatabaseReady').mockReturnValue(true);
      jest
        .spyOn(reconcileRepo, 'listPaginated')
        .mockImplementation(async (f) =>
          createPaginatedResult(reconcilesMem, reconcilesMem.length, f.page ?? 1, f.limit ?? 20),
        );
      jest
        .spyOn(reconcileRepo, 'findLatest')
        .mockImplementation(async () => reconcilesMem[0] ?? null);
      jest.spyOn(reconcileRepo, 'saveEntity').mockImplementation(async (input) => {
        const now = new Date();
        const item = {
          id: seq++,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...input,
        } as DrReconciliationReportEntity;
        reconcilesMem.unshift(item);
        return item;
      });

      jest.spyOn(drillRepo, 'isDatabaseReady').mockReturnValue(true);
      jest
        .spyOn(drillRepo, 'listPaginated')
        .mockImplementation(async (f) =>
          createPaginatedResult(drillsMem, drillsMem.length, f.page ?? 1, f.limit ?? 20),
        );
      jest.spyOn(drillRepo, 'findLatest').mockImplementation(async () => drillsMem[0] ?? null);
      jest.spyOn(drillRepo, 'saveEntity').mockImplementation(async (input) => {
        const now = new Date();
        const item = {
          id: seq++,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...input,
        } as DrDrillEntity;
        drillsMem.unshift(item);
        return item;
      });
    }
  });

  afterAll(async () => {
    delete process.env['DR_DB_PASSWORD'];
    delete process.env['DR_STORAGE_S3_ACCESS_KEY'];
    delete process.env['DR_STORAGE_S3_SECRET_KEY'];
    delete process.env['DR_SWITCH_WEBHOOK_SECRET'];
    if (context) {
      await context.close();
    }
  });

  it('GET /ops/dr/overview, /profile, /sync/runs, /switches, /reconciliations, /drills and /runbook return 200', async () => {
    const [overviewRes, profileRes, syncsRes, switchesRes, recRes, drillsRes, runbookRes] =
      await Promise.all([
        context.injectJson<{
          configEnabled: boolean;
          effectiveEnabled: boolean;
          liveSwitchEnabled: boolean;
          profile: { rpoTargetSeconds: number; rtoTargetSeconds: number; activeSite: string };
        }>({ method: 'GET', url: '/ops/dr/overview' }),
        context.injectJson<{ code: string; topologyMode: string }>({
          method: 'GET',
          url: '/ops/dr/profile',
        }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/dr/sync/runs' }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/dr/switches' }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/dr/reconciliations' }),
        context.injectJson<unknown[]>({ method: 'GET', url: '/ops/dr/drills' }),
        context.injectJson<{
          sections: Array<{ id: string }>;
          antiSplitBrainRules: string[];
        }>({ method: 'GET', url: '/ops/dr/runbook' }),
      ]);

    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.success).toBe(true);
    expect(overviewRes.body.data.configEnabled).toBe(false);
    expect(overviewRes.body.data.liveSwitchEnabled).toBe(false);
    expect(overviewRes.body.data.profile.rpoTargetSeconds).toBe(900);
    expect(overviewRes.body.data.profile.rtoTargetSeconds).toBe(1800);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.data.code).toBe('DEFAULT');

    expect(syncsRes.status).toBe(200);
    expect(Array.isArray(syncsRes.body.data)).toBe(true);

    expect(switchesRes.status).toBe(200);
    expect(Array.isArray(switchesRes.body.data)).toBe(true);

    expect(recRes.status).toBe(200);
    expect(Array.isArray(recRes.body.data)).toBe(true);

    expect(drillsRes.status).toBe(200);
    expect(Array.isArray(drillsRes.body.data)).toBe(true);

    expect(runbookRes.status).toBe(200);
    expect(runbookRes.body.data.sections.length).toBeGreaterThanOrEqual(5);
    expect(runbookRes.body.data.antiSplitBrainRules.length).toBeGreaterThan(0);
  });

  it('PATCH /ops/dr/profile updates RPO/RTO and executes full SIMULATED failover checklist lifecycle', async () => {
    const patchRes = await context.injectJson<{
      rpoTargetSeconds: number;
      rtoTargetSeconds: number;
      topologyMode: string;
    }>({
      method: 'PATCH',
      url: '/ops/dr/profile',
      payload: {
        topologyMode: 'WARM_STANDBY',
        rpoTargetSeconds: 600,
        rtoTargetSeconds: 1200,
      },
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.rpoTargetSeconds).toBe(600);
    expect(patchRes.body.data.rtoTargetSeconds).toBe(1200);

    // Initiate SIMULATED failover
    const startRes = await context.injectJson<{
      id: number;
      switchCode: string;
      status: string;
      checklist: Array<{ stepKey: string; required: boolean }>;
    }>({
      method: 'POST',
      url: '/ops/dr/switches/failover',
      payload: {
        mode: 'SIMULATED',
        reason: 'Feature test failover checklist verification',
      },
    });
    expect(startRes.status).toBe(201);
    const switchId = startRes.body.data.id;
    expect(startRes.body.data.status).toBe('IN_PROGRESS');

    // Completing before finishing mandatory steps must fail (403)
    const prematureComplete = await context.injectJson({
      method: 'POST',
      url: `/ops/dr/switches/${switchId}/complete`,
      payload: {},
    });
    expect(prematureComplete.status).toBe(403);

    // Tick all required checklist steps
    for (const step of startRes.body.data.checklist) {
      if (step.required) {
        const tickRes = await context.injectJson({
          method: 'PATCH',
          url: `/ops/dr/switches/${switchId}/checklist/${step.stepKey}`,
          payload: { status: 'COMPLETED', note: 'Verified in feature test' },
        });
        expect(tickRes.status).toBe(200);
      }
    }

    // Complete switch
    const completeRes = await context.injectJson<{
      status: string;
      rtoMet: boolean | null;
    }>({
      method: 'POST',
      url: `/ops/dr/switches/${switchId}/complete`,
      payload: {},
    });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('COMPLETED');
    expect(completeRes.body.data.rtoMet).toBe(true);
  });

  it('POST /ops/dr/reconciliations/run and /drills/run execute cleanly and detect discrepancies', async () => {
    const recRes = await context.injectJson<{
      reportCode: string;
      status: string;
      totalDiscrepancies: number;
      storageMissingCount: number;
    }>({
      method: 'POST',
      url: '/ops/dr/reconciliations/run',
      payload: {
        scope: 'STORAGE',
        primaryStorageSnapshots: [
          { key: 'uploads/file-1.pdf', checksumOrSize: 1200 },
          { key: 'uploads/file-2.pdf', checksumOrSize: 2400 },
        ],
        drStorageSnapshots: [{ key: 'uploads/file-1.pdf', checksumOrSize: 1200 }],
      },
    });
    expect(recRes.status).toBe(200);
    expect(recRes.body.data.status).toBe('DISCREPANCIES_FOUND');
    expect(recRes.body.data.storageMissingCount).toBe(1);
    expect(recRes.body.data.totalDiscrepancies).toBe(1);

    const drillRes = await context.injectJson<{
      drillCode: string;
      drillType: string;
      status: string;
      rpoMet: boolean;
      rtoMet: boolean;
    }>({
      method: 'POST',
      url: '/ops/dr/drills/run',
      payload: {
        drillType: 'TABLETOP',
        scenario: 'Feature test DR drill',
        measuredRpoSeconds: 100,
        measuredRtoSeconds: 300,
        lessonsLearned: 'All checklist items verified',
      },
    });
    expect(drillRes.status).toBe(200);
    expect(drillRes.body.data.status).toBe('PASSED');
    expect(drillRes.body.data.rpoMet).toBe(true);
    expect(drillRes.body.data.rtoMet).toBe(true);
  });

  it('GET /ops/configuration masks sensitive DR secrets and passwords', async () => {
    const res = await context.injectJson<
      Array<{ domain: string; key: string; value: unknown; sensitive: boolean }>
    >({
      method: 'GET',
      url: '/ops/configuration',
    });

    expect(res.status).toBe(200);
    const expectedMasked = [
      'db.password',
      'storage.s3AccessKeySecret',
      'storage.s3SecretKey',
      'switchWebhookSecret',
    ];
    for (const key of expectedMasked) {
      const item = res.body.data.find((i) => i.domain === 'dr' && i.key === key);
      expect(item).toBeDefined();
      expect(item?.sensitive).toBe(true);
      expect(item?.value).toBe('••••••••');
    }
  });
});
