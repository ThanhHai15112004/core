import { describe, expect, it, jest } from '@jest/globals';
import type { TransactionManager } from '@packages/database/index.js';
import type { HttpClientContract } from '@packages/http-client/index.js';
import {
  DomainEventBusService,
  SEQUENCE_DATE_FORMAT,
  SEQUENCE_RESET_POLICY,
  SequenceRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import { PlatformSecurityService } from '@packages/security/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import type { AlertOwnerMappingEntity } from '@modules/incidents-ops/entities/alert-owner-mapping.entity.js';
import type { IncidentPostmortemEntity } from '@modules/incidents-ops/entities/incident-postmortem.entity.js';
import type { IncidentRunbookEntity } from '@modules/incidents-ops/entities/incident-runbook.entity.js';
import type { IncidentSeverityPolicyEntity } from '@modules/incidents-ops/entities/incident-severity-policy.entity.js';
import type { IncidentEntity } from '@modules/incidents-ops/entities/incident.entity.js';
import type { SiemDispatchLogEntity } from '@modules/incidents-ops/entities/siem-dispatch-log.entity.js';
import {
  buildIncidentFingerprint,
  formatSiemDispatchRequest,
  normalizeIncidentSeverity,
} from '@modules/incidents-ops/helpers/incident-ops.helper.js';
import type { AlertOwnerMappingRepository } from '@modules/incidents-ops/repositories/alert-owner-mapping.repository.js';
import type { IncidentPostmortemRepository } from '@modules/incidents-ops/repositories/incident-postmortem.repository.js';
import type { IncidentRunbookRepository } from '@modules/incidents-ops/repositories/incident-runbook.repository.js';
import type { IncidentSeverityPolicyRepository } from '@modules/incidents-ops/repositories/incident-severity-policy.repository.js';
import type { IncidentRepository } from '@modules/incidents-ops/repositories/incident.repository.js';
import type { SiemDispatchLogRepository } from '@modules/incidents-ops/repositories/siem-dispatch-log.repository.js';
import { IncidentGovernanceService } from '@modules/incidents-ops/services/incident-governance.service.js';
import { IncidentLifecycleService } from '@modules/incidents-ops/services/incident-lifecycle.service.js';
import { SiemDispatcherService } from '@modules/incidents-ops/services/siem-dispatcher.service.js';

function createPassthroughTxManager(): TransactionManager {
  return {
    runInTransaction: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as TransactionManager;
}

describe('12.6 Incident Management & SIEM Unit Tests', () => {
  it('formats SIEM payloads for webhook, splunk_hec, and elastic, and normalizes P1-P4 severities', () => {
    expect(normalizeIncidentSeverity('CRITICAL')).toBe('P1');
    expect(normalizeIncidentSeverity('HIGH')).toBe('P2');
    expect(normalizeIncidentSeverity('MEDIUM')).toBe('P3');
    expect(normalizeIncidentSeverity('LOW')).toBe('P4');
    expect(normalizeIncidentSeverity('P1')).toBe('P1');

    const splunk = formatSiemDispatchRequest({
      driver: 'splunk_hec',
      endpoint: 'https://splunk.local:8088/services/collector',
      authToken: 'hec-token-123',
      payload: { eventType: 'LOGIN_FAILED' },
    });
    expect(splunk.headers['Authorization']).toBe('Splunk hec-token-123');
    expect(JSON.parse(splunk.body)).toMatchObject({
      sourcetype: 'core:security:siem',
      event: { eventType: 'LOGIN_FAILED' },
    });

    const elastic = formatSiemDispatchRequest({
      driver: 'elastic',
      endpoint: 'https://elastic.local:9200/siem-events/_doc',
      authToken: 'ApiKey abc',
      payload: { eventType: 'DATA_EXPORT' },
    });
    expect(elastic.headers['Authorization']).toBe('ApiKey abc');
    expect(JSON.parse(elastic.body)).toMatchObject({
      event: { kind: 'alert' },
      eventType: 'DATA_EXPORT',
    });
  });

  it('forwards security events (failed login, permission change, large export) to SIEM, assigns guaranteed owner, deduplicates repeated alerts, tracks MTTR and publishes post-mortem', async () => {
    const settingRegistry = new SettingRegistryService();
    const registerBool = (key: string, defaultValue: boolean) => {
      settingRegistry.removeDefinition(key);
      return settingRegistry.registerManifestSetting({
        key,
        name: key,
        module: 'incidents-ops',
        groupCode: 'security',
        valueType: 'BOOLEAN',
        defaultValue,
      });
    };
    const registerNum = (key: string, defaultValue: number) => {
      settingRegistry.removeDefinition(key);
      return settingRegistry.registerManifestSetting({
        key,
        name: key,
        module: 'incidents-ops',
        groupCode: 'security',
        valueType: 'NUMBER',
        defaultValue,
      });
    };
    const registerText = (key: string, defaultValue: string) => {
      settingRegistry.removeDefinition(key);
      return settingRegistry.registerManifestSetting({
        key,
        name: key,
        module: 'incidents-ops',
        groupCode: 'security',
        valueType: 'TEXT',
        defaultValue,
      });
    };
    registerNum('incidents.default_owner_user_id', 99);
    registerNum('incidents.dedup_window_minutes', 60);
    registerBool('siem.enabled', true);
    registerText('siem.driver', 'webhook');
    registerText('siem.endpoint', 'https://siem.example.test/ingest');
    registerText('siem.auth_token', 'secret-token');

    const sequenceRegistry = new SequenceRegistryService();
    sequenceRegistry.registerRule({
      key: 'incidents.incident_code',
      module: 'incidents-ops',
      name: 'Incident Code',
      description: null,
      prefix: 'INC',
      suffix: '',
      separator: '-',
      dateFormat: SEQUENCE_DATE_FORMAT.YYYYMM,
      dateFormatName: 'YYYYMM',
      paddingLength: 4,
      templatePattern: null,
      startValue: 1,
      step: 1,
      resetPolicy: SEQUENCE_RESET_POLICY.MONTHLY,
      resetPolicyName: 'MONTHLY',
      scopeByUnit: false,
      timezone: 'Asia/Ho_Chi_Minh',
      status: 1,
      isSystem: true,
    });

    const policies: IncidentSeverityPolicyEntity[] = [
      {
        id: 1,
        severity: 'P1',
        name: 'Critical',
        description: null,
        responseSlaMinutes: 15,
        resolutionSlaMinutes: 60,
        autoEscalate: true,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as IncidentSeverityPolicyEntity,
      {
        id: 2,
        severity: 'P2',
        name: 'High',
        description: null,
        responseSlaMinutes: 30,
        resolutionSlaMinutes: 240,
        autoEscalate: true,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as IncidentSeverityPolicyEntity,
    ];

    const runbooks: IncidentRunbookEntity[] = [
      {
        id: 10,
        code: 'RB_BRUTE_FORCE_LOGIN',
        title: 'Brute-Force Runbook',
        description: null,
        alertCode: 'ANOMALY_BRUTE_FORCE_LOGIN',
        defaultSeverity: 'P2',
        triageStepsJson: JSON.stringify(['Check IP & login history']),
        mitigationStepsJson: JSON.stringify(['Block IP / lock user']),
        verificationStepsJson: JSON.stringify(['Confirm 0 failed attempts']),
        isActive: true,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as IncidentRunbookEntity,
    ];

    const ownerMappings: AlertOwnerMappingEntity[] = [
      {
        id: 20,
        alertCode: 'ANOMALY_BRUTE_FORCE_LOGIN',
        alertName: 'Brute Force',
        source: 'SIEM',
        defaultSeverity: 'P2',
        ownerUserId: 7,
        backupOwnerUserId: 8,
        runbookId: 10,
        notifyChannelsJson: JSON.stringify(['IN_APP']),
        isEnabled: true,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AlertOwnerMappingEntity,
    ];

    const incidentsStore: IncidentEntity[] = [];
    const postmortemStore: IncidentPostmortemEntity[] = [];
    const siemLogsStore: SiemDispatchLogEntity[] = [];
    let idSeq = 100;

    const policyRepo = {
      listAll: async () => policies,
      findBySeverity: async (s: string) => policies.find((p) => p.severity === s) ?? null,
    } as unknown as IncidentSeverityPolicyRepository;

    const runbookRepo = {
      findByIdSafe: async (id: number) => runbooks.find((r) => r.id === id) ?? null,
      findActiveByAlertCode: async (code: string) =>
        runbooks.find((r) => r.alertCode === code && r.isActive) ?? null,
    } as unknown as IncidentRunbookRepository;

    const ownerMappingRepo = {
      findByAlertCode: async (code: string) =>
        ownerMappings.find((m) => m.alertCode === code) ?? null,
    } as unknown as AlertOwnerMappingRepository;

    const incidentRepo = {
      findByIdSafe: async (id: number) => incidentsStore.find((i) => i.id === id) ?? null,
      findActiveByFingerprint: async (fp: string, since: Date) =>
        incidentsStore.find(
          (i) =>
            i.fingerprint === fp &&
            (i.status === 'OPEN' || i.status === 'ACKNOWLEDGED' || i.status === 'MITIGATED') &&
            new Date(i.lastSeenAt).getTime() >= since.getTime(),
        ) ?? null,
      saveEntity: async (entity: Partial<IncidentEntity>) => {
        if (entity.id) {
          const idx = incidentsStore.findIndex((x) => x.id === entity.id);
          if (idx >= 0) {
            incidentsStore[idx] = { ...incidentsStore[idx]!, ...entity, updatedAt: new Date() };
            return incidentsStore[idx]!;
          }
        }
        const created = {
          ...entity,
          id: ++idSeq,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as IncidentEntity;
        incidentsStore.push(created);
        return created;
      },
    } as unknown as IncidentRepository;

    const postmortemRepo = {
      findByIncidentId: async (incidentId: number) =>
        postmortemStore.find((p) => p.incidentId === incidentId) ?? null,
      saveEntity: async (entity: Partial<IncidentPostmortemEntity>) => {
        if (entity.id) {
          const idx = postmortemStore.findIndex((x) => x.id === entity.id);
          if (idx >= 0) {
            postmortemStore[idx] = { ...postmortemStore[idx]!, ...entity, updatedAt: new Date() };
            return postmortemStore[idx]!;
          }
        }
        const created = {
          ...entity,
          id: ++idSeq,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as IncidentPostmortemEntity;
        postmortemStore.push(created);
        return created;
      },
    } as unknown as IncidentPostmortemRepository;

    const siemLogRepo = {
      isDatabaseReady: () => true,
      countLast24h: async () => ({
        sent: siemLogsStore.filter((l) => l.status === 'SENT').length,
        failed: siemLogsStore.filter((l) => l.status === 'FAILED').length,
      }),
      saveEntity: async (entity: Partial<SiemDispatchLogEntity>) => {
        if (entity.id) {
          const idx = siemLogsStore.findIndex((x) => x.id === entity.id);
          if (idx >= 0) {
            siemLogsStore[idx] = { ...siemLogsStore[idx]!, ...entity };
            return siemLogsStore[idx]!;
          }
        }
        const created = { ...entity, id: ++idSeq } as SiemDispatchLogEntity;
        siemLogsStore.push(created);
        return created;
      },
    } as unknown as SiemDispatchLogRepository;

    const notifications = {
      dispatch: jest.fn(async () => ({ id: 1 })),
    } as unknown as INotificationsPublicService;

    const httpClient = {
      requestRaw: jest.fn(async () => ({
        status: 202,
        headers: {},
        data: { accepted: true },
        durationMs: 5,
      })),
    } as unknown as HttpClientContract;

    const eventBus = new DomainEventBusService();
    const txManager = createPassthroughTxManager();
    const platformSecurity = new PlatformSecurityService();
    platformSecurity.configureAnomalyThresholds({
      failedLoginAlertThreshold: 2,
      largeExportRowThreshold: 50,
    });

    const governance = new IncidentGovernanceService(
      policyRepo,
      runbookRepo,
      ownerMappingRepo,
      txManager,
      settingRegistry,
    );
    const lifecycle = new IncidentLifecycleService(
      incidentRepo,
      postmortemRepo,
      runbookRepo,
      siemLogRepo,
      governance,
      txManager,
      notifications,
      settingRegistry,
      sequenceRegistry,
      eventBus,
    );
    const siemDispatcher = new SiemDispatcherService(
      siemLogRepo,
      lifecycle,
      txManager,
      platformSecurity,
      httpClient,
      settingRegistry,
      eventBus,
    );
    siemDispatcher.onModuleInit();

    // 1) Repeated failed logins -> sends to SIEM & creates 1 incident with mapped owner #7 and runbook #10
    await platformSecurity.recordSecurityEvent({
      eventType: 'LOGIN_FAILED',
      module: 'auth',
      targetUserId: 42,
      ipAddress: '203.0.113.10',
    });
    await platformSecurity.recordSecurityEvent({
      eventType: 'LOGIN_FAILED',
      module: 'auth',
      targetUserId: 42,
      ipAddress: '203.0.113.10',
    });
    // 3rd failed login triggers anomaly again -> grouped into existing incident (dedup, reduces alert noise!)
    await platformSecurity.recordSecurityEvent({
      eventType: 'LOGIN_FAILED',
      module: 'auth',
      targetUserId: 42,
      ipAddress: '203.0.113.10',
    });

    expect(httpClient.requestRaw).toHaveBeenCalledTimes(3);
    expect(incidentsStore).toHaveLength(1);
    const bruteIncident = incidentsStore[0]!;
    expect(bruteIncident.ownerUserId).toBe(7);
    expect(bruteIncident.runbookId).toBe(10);
    expect(bruteIncident.severity).toBe('P2');
    expect(bruteIncident.occurrenceCount).toBe(2);
    expect(bruteIncident.suppressedCount).toBe(1);
    expect(bruteIncident.isRepeated).toBe(true);
    expect(notifications.dispatch).toHaveBeenCalledTimes(1);

    // 2) Permission change & large export with unmapped alertCode -> fallback default owner #99 (never ownerless)
    await platformSecurity.recordSecurityEvent({
      eventType: 'PERMISSION_CHANGED',
      module: 'roles',
      actorUserId: 5,
      reason: 'Granted admin permissions',
    });
    await platformSecurity.recordSecurityEvent({
      eventType: 'DATA_EXPORT',
      module: 'exports',
      actorUserId: 5,
      exportedRowCount: 500,
    });
    expect(incidentsStore).toHaveLength(3);
    expect(incidentsStore[1]!.ownerUserId).toBe(99);
    expect(incidentsStore[2]!.ownerUserId).toBe(99);
    expect(siemLogsStore).toHaveLength(5);

    // 3) Incident lifecycle: acknowledge -> resolve (with rootCause & mitigation) -> postmortem upsert + publish
    const acked = await lifecycle.acknowledge(bruteIncident.id, {
      actorUserId: 7,
      note: 'Investigating',
    });
    expect(acked.status).toBe('ACKNOWLEDGED');

    const resolved = await lifecycle.resolve(bruteIncident.id, {
      rootCause: 'Credential stuffing from 203.0.113.10',
      mitigationSummary: 'Blocked IP range and enforced MFA',
      actorUserId: 7,
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.recoverySeconds).toBeGreaterThanOrEqual(0);
    expect(resolved.rootCause).toContain('203.0.113.10');

    const pmDraft = await lifecycle.upsertPostmortem(bruteIncident.id, {
      title: 'Post-mortem brute force incident',
      summary: 'Blocked credential stuffing source IP',
      rootCauseAnalysis: 'Missing strict rate limit on login',
      lessonsLearned: 'Enable adaptive rate limiting earlier',
      preventiveActions: [{ title: 'Tighten login rate limit', status: 'OPEN' }],
      authorId: 7,
    });
    expect(pmDraft.status).toBe('DRAFT');

    const pmPub = await lifecycle.publishPostmortem(bruteIncident.id, 7);
    expect(pmPub.status).toBe('PUBLISHED');
    expect(pmPub.publishedAt).toBeTruthy();

    const detail = await lifecycle.getIncidentDetail(bruteIncident.id);
    expect(detail.runbook?.code).toBe('RB_BRUTE_FORCE_LOGIN');
    expect(detail.postmortem?.status).toBe('PUBLISHED');

    expect(
      buildIncidentFingerprint({
        source: 'SIEM',
        alertCode: 'ANOMALY_LARGE_DATA_EXPORT',
        title: 'Large Export',
        module: 'users',
        actorUserId: 5,
        ipAddress: '10.0.0.1',
      }),
    ).toBe('SIEM|ANOMALY_LARGE_DATA_EXPORT|mod=users|actor=5|ip=10.0.0.1');
  });
});
