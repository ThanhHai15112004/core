import { describe, expect, it, jest } from '@jest/globals';
import { CoreConfigService, drConfig } from '@packages/config/index.js';
import {
  DR_CHECKLIST_STEP_STATUS,
  DR_DISCREPANCY_KIND,
  DR_DRILL_STATUS,
  DR_DRILL_TYPE,
  DR_OPERATIONAL_STATE,
  DR_RECONCILE_STATUS,
  DR_SITE_ROLE,
  DR_SWITCH_DIRECTION,
  DR_SWITCH_MODE,
  DR_SWITCH_STATUS,
  DR_TOPOLOGY_MODE,
} from '../../../src/modules/dr-ops/enum/dr-ops.enum.js';
import {
  DrDisabledException,
  DrSplitBrainGuardException,
  DrSwitchGuardException,
} from '../../../src/modules/dr-ops/exceptions/dr-ops.exceptions.js';
import {
  buildFailbackChecklist,
  buildFailoverChecklist,
  diffDataSnapshots,
  evaluateRpoCompliance,
  evaluateRtoCompliance,
  validateChecklistReadyForCompletion,
} from '../../../src/modules/dr-ops/helpers/dr-checklist.helper.js';
import { DrSwitchoverService } from '../../../src/modules/dr-ops/services/dr-switchover.service.js';
import { DrDrillService } from '../../../src/modules/dr-ops/services/dr-drill.service.js';
import type { DrProfileEntity } from '../../../src/modules/dr-ops/entities/dr-profile.entity.js';
import type { DrSwitchExecutionEntity } from '../../../src/modules/dr-ops/entities/dr-switch-execution.entity.js';
import type { DrDrillEntity } from '../../../src/modules/dr-ops/entities/dr-drill.entity.js';

function makeProfile(overrides?: Partial<DrProfileEntity>): DrProfileEntity {
  const now = new Date();
  return {
    id: 1,
    code: 'DEFAULT',
    name: 'Default DR Profile',
    isEnabled: true,
    topologyMode: DR_TOPOLOGY_MODE.WARM_STANDBY,
    rpoTargetSeconds: 900,
    rtoTargetSeconds: 1800,
    primarySiteCode: 'dc-primary',
    primarySiteName: 'Primary DC',
    primaryRegion: 'ap-southeast-1',
    primaryEndpoint: 'https://api.primary.local',
    drSiteCode: 'dc-dr',
    drSiteName: 'DR Site',
    drRegion: 'ap-southeast-2',
    drEndpoint: 'https://api.dr.local',
    activeSite: DR_SITE_ROLE.PRIMARY,
    operationalState: DR_OPERATIONAL_STATE.NORMAL,
    syncCron: '*/15 * * * *',
    drillIntervalDays: 30,
    lastSyncAt: null,
    lastRpoSeconds: null,
    lastDrillAt: null,
    lastRtoSeconds: null,
    nextDrillDueAt: new Date(now.getTime() + 30 * 86_400_000),
    optionsJson: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as DrProfileEntity;
}

describe('Unit: Disaster Recovery Core Logic (Section 13.7)', () => {
  it('drConfig defaults to opt-in disabled with 900s RPO / 1800s RTO and WARM_STANDBY', () => {
    const cfg = drConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.liveSwitchEnabled).toBe(false);
    expect(cfg.rpoTargetSeconds).toBe(900);
    expect(cfg.rtoTargetSeconds).toBe(1800);
    expect(cfg.topologyMode).toBe('WARM_STANDBY');
  });

  it('evaluates RPO and RTO compliance accurately including unknown/null measurements', () => {
    expect(evaluateRpoCompliance(120, 900)).toEqual({ met: true, status: 'MET' });
    expect(evaluateRpoCompliance(901, 900)).toEqual({ met: false, status: 'BREACHED' });
    expect(evaluateRpoCompliance(null, 900)).toEqual({ met: false, status: 'UNKNOWN' });

    expect(evaluateRtoCompliance(1800, 1800)).toEqual({ met: true, status: 'MET' });
    expect(evaluateRtoCompliance(1801, 1800)).toEqual({ met: false, status: 'BREACHED' });
    expect(evaluateRtoCompliance(undefined, 1800)).toEqual({ met: false, status: 'UNKNOWN' });
  });

  it('builds failover & failback checklists and enforces mandatory steps before completion', () => {
    const failoverSteps = buildFailoverChecklist(DR_TOPOLOGY_MODE.WARM_STANDBY);
    expect(failoverSteps.length).toBeGreaterThanOrEqual(7);
    expect(failoverSteps.some((s) => s.stepKey === 'freeze_primary_writes' && s.required)).toBe(
      true,
    );

    const failbackSteps = buildFailbackChecklist(DR_TOPOLOGY_MODE.WARM_STANDBY);
    expect(
      failbackSteps.some((s) => s.stepKey === 'verify_reverse_sync_zero_lag' && s.required),
    ).toBe(true);

    const incomplete = validateChecklistReadyForCompletion(failoverSteps);
    expect(incomplete.ready).toBe(false);
    expect(incomplete.pendingRequiredKeys.length).toBeGreaterThan(0);

    const completedAllRequired = failoverSteps.map((s) =>
      s.required ? { ...s, status: DR_CHECKLIST_STEP_STATUS.COMPLETED } : s,
    );
    expect(validateChecklistReadyForCompletion(completedAllRequired)).toEqual({
      ready: true,
      pendingRequiredKeys: [],
    });
  });

  it('diffDataSnapshots detects missing, extra, duplicate keys and mismatches accurately', () => {
    const clean = diffDataSnapshots({
      area: 'STORAGE',
      target: 'object_storage',
      primaryRecords: [
        { key: 'avatars/a.png', checksumOrSize: 1024 },
        { key: 'docs/b.pdf', checksumOrSize: 2048 },
      ],
      drRecords: [
        { key: 'avatars/a.png', checksumOrSize: 1024 },
        { key: 'docs/b.pdf', checksumOrSize: 2048 },
      ],
    });
    expect(clean.findings).toHaveLength(0);
    expect(clean.missingCount).toBe(0);
    expect(clean.duplicateCount).toBe(0);
    expect(clean.mismatchCount).toBe(0);

    const dirty = diffDataSnapshots({
      area: 'STORAGE',
      target: 'object_storage',
      primaryRecords: [
        { key: 'a.png', checksumOrSize: 100 },
        { key: 'a.png', checksumOrSize: 100 },
        { key: 'missing-on-dr.png', checksumOrSize: 500 },
        { key: 'size-diff.png', checksumOrSize: 300 },
      ],
      drRecords: [
        { key: 'a.png', checksumOrSize: 100 },
        { key: 'size-diff.png', checksumOrSize: 999 },
        { key: 'extra-on-dr.png', checksumOrSize: 50 },
      ],
    });
    expect(dirty.duplicateCount).toBe(1);
    expect(dirty.missingCount).toBe(2);
    expect(dirty.mismatchCount).toBe(1);
    expect(dirty.findings.some((f) => f.kind === DR_DISCREPANCY_KIND.DUPLICATE_KEY)).toBe(true);
    expect(dirty.findings.some((f) => f.kind === DR_DISCREPANCY_KIND.MISSING_ON_TARGET)).toBe(true);
    expect(dirty.findings.some((f) => f.kind === DR_DISCREPANCY_KIND.EXTRA_ON_TARGET)).toBe(true);
    expect(dirty.findings.some((f) => f.kind === DR_DISCREPANCY_KIND.SIZE_MISMATCH)).toBe(true);
  });

  it('DrSwitchoverService enforces anti-split-brain, live switch flag, and checklist guards', async () => {
    const profile = makeProfile({ isEnabled: true, activeSite: DR_SITE_ROLE.PRIMARY });
    const config = new CoreConfigService();

    let savedSwitch: DrSwitchExecutionEntity | null = null;
    const switchRepo = {
      findActiveInProgress: jest.fn(async () => null),
      findByIdSafe: jest.fn(async () => savedSwitch),
      saveEntity: jest.fn(async (input: Partial<DrSwitchExecutionEntity>) => {
        const now = new Date();
        savedSwitch = {
          id: 10,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...(savedSwitch ?? {}),
          ...input,
        } as DrSwitchExecutionEntity;
        return savedSwitch;
      }),
    };
    const profileRepo = {
      isDatabaseReady: () => true,
      saveEntity: jest.fn(async (p: DrProfileEntity) => p),
    };
    const profileService = {
      getOrCreateDefaultProfile: jest.fn(async () => profile),
    };
    const alertService = {
      publishEvent: jest.fn(async () => true),
    };

    const svc = new DrSwitchoverService(
      config,
      profileService as never,
      profileRepo as never,
      switchRepo as never,
      alertService as never,
    );

    // LIVE failover blocked when DR_LIVE_SWITCH_ENABLED=false
    await expect(
      svc.initiateSwitch({
        direction: DR_SWITCH_DIRECTION.FAILOVER,
        mode: DR_SWITCH_MODE.LIVE,
        reason: 'DC primary outage test',
        confirm: 'FAILOVER',
        actorName: 'ops-admin',
      }),
    ).rejects.toThrow(DrSwitchGuardException);

    // LIVE failback blocked when activeSite is PRIMARY (anti-split-brain)
    const liveConfig = { ...config, dr: { ...config.dr, enabled: true, liveSwitchEnabled: true } };
    const liveSvc = new DrSwitchoverService(
      liveConfig as CoreConfigService,
      profileService as never,
      profileRepo as never,
      switchRepo as never,
      alertService as never,
    );
    await expect(
      liveSvc.initiateSwitch({
        direction: DR_SWITCH_DIRECTION.FAILBACK,
        mode: DR_SWITCH_MODE.LIVE,
        reason: 'Invalid failback while on primary',
        confirm: 'FAILBACK',
        actorName: 'ops-admin',
      }),
    ).rejects.toThrow(DrSplitBrainGuardException);

    // Disabled profile blocks LIVE switch when config.dr.enabled=false
    const disabledProfileSvc = new DrSwitchoverService(
      {
        ...config,
        dr: { ...config.dr, enabled: false, liveSwitchEnabled: true },
      } as CoreConfigService,
      { getOrCreateDefaultProfile: async () => makeProfile({ isEnabled: false }) } as never,
      profileRepo as never,
      switchRepo as never,
      alertService as never,
    );
    await expect(
      disabledProfileSvc.initiateSwitch({
        direction: DR_SWITCH_DIRECTION.FAILOVER,
        mode: DR_SWITCH_MODE.LIVE,
        reason: 'Should fail when disabled',
        confirm: 'FAILOVER',
        actorName: 'ops-admin',
      }),
    ).rejects.toThrow(DrDisabledException);

    // SIMULATED failover works and blocks skip on mandatory step + completion before checklist done
    const started = await svc.initiateSwitch({
      direction: DR_SWITCH_DIRECTION.FAILOVER,
      mode: DR_SWITCH_MODE.SIMULATED,
      reason: 'Simulated failover drill',
      actorName: 'ops-admin',
    });
    expect(started.status).toBe(DR_SWITCH_STATUS.IN_PROGRESS);

    await expect(
      svc.updateChecklistStep(started.id, 'freeze_primary_writes', {
        status: DR_CHECKLIST_STEP_STATUS.SKIPPED,
        actorName: 'ops-admin',
      }),
    ).rejects.toThrow(DrSwitchGuardException);

    await expect(svc.completeSwitch(started.id, { actorName: 'ops-admin' })).rejects.toThrow(
      DrSwitchGuardException,
    );

    for (const step of started.checklist) {
      if (step.required) {
        await svc.updateChecklistStep(started.id, step.stepKey, {
          status: DR_CHECKLIST_STEP_STATUS.COMPLETED,
          actorName: 'ops-admin',
        });
      }
    }

    const completed = await svc.completeSwitch(started.id, { actorName: 'ops-admin' });
    expect(completed.status).toBe(DR_SWITCH_STATUS.COMPLETED);
    expect(completed.rtoMet).toBe(true);
  });

  it('DrDrillService scores drill PASSED when within RPO/RTO and FAILED when breaching', async () => {
    const profile = makeProfile({ rpoTargetSeconds: 900, rtoTargetSeconds: 1800 });
    const config = new CoreConfigService();

    const drillRepo = {
      saveEntity: jest.fn(async (input: Partial<DrDrillEntity>) => ({
        id: 1,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...input,
      })),
    };
    const profileRepo = {
      isDatabaseReady: () => true,
      saveEntity: jest.fn(async (p: DrProfileEntity) => p),
    };
    const syncService = {
      runSync: jest.fn(async () => ({
        syncCode: 'DRS-TEST',
        actualRpoSeconds: 120,
        rpoMet: true,
      })),
    };
    const switchoverService = {
      initiateSwitch: jest.fn(async () => ({
        id: 99,
        switchCode: 'FOV-TEST',
        checklist: [{ stepKey: 'confirm_primary_outage', required: true }],
      })),
      updateChecklistStep: jest.fn(async () => ({})),
      completeSwitch: jest.fn(async () => ({ switchCode: 'FOV-TEST' })),
    };
    const reconciliationService = {
      runReconciliation: jest.fn(async () => ({
        id: 55,
        reportCode: 'DRC-TEST',
        status: DR_RECONCILE_STATUS.PASSED,
        totalDiscrepancies: 0,
      })),
    };
    const alertService = {
      publishEvent: jest.fn(async () => true),
      emitAlert: jest.fn(async () => ({
        eventPublished: true,
        incidentCreated: false,
        notificationDispatched: false,
      })),
    };

    const drillSvc = new DrDrillService(
      config,
      { getOrCreateDefaultProfile: async () => profile } as never,
      profileRepo as never,
      drillRepo as never,
      syncService as never,
      switchoverService as never,
      reconciliationService as never,
      alertService as never,
    );

    const passed = await drillSvc.runDrill({
      drillType: DR_DRILL_TYPE.MANUAL_SIMULATION,
      scenario: 'Monthly simulation',
      actorName: 'ops-tester',
    });
    expect(passed.status).toBe(DR_DRILL_STATUS.PASSED);
    expect(passed.rpoMet).toBe(true);
    expect(passed.rtoMet).toBe(true);
    expect(profile.nextDrillDueAt).not.toBeNull();

    const failed = await drillSvc.runDrill({
      drillType: DR_DRILL_TYPE.TABLETOP,
      scenario: 'Breached RTO tabletop',
      measuredRpoSeconds: 300,
      measuredRtoSeconds: 2400,
      actorName: 'ops-tester',
    });
    expect(failed.status).toBe(DR_DRILL_STATUS.FAILED);
    expect(failed.rpoMet).toBe(true);
    expect(failed.rtoMet).toBe(false);
    expect(alertService.emitAlert).toHaveBeenCalledTimes(1);
  });
});
