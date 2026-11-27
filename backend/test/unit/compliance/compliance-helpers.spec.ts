import { describe, expect, it } from '@jest/globals';
import {
  buildComplianceReportSummary,
  classifyDueStatus,
  computeNextDueDate,
  controlMatchesFrameworkTag,
  normalizeFrameworkTags,
} from '../../../src/modules/compliance/helpers/compliance.helper.js';
import {
  COMPLIANCE_DUE_STATUS,
  CONTROL_CHECK_RESULT,
  CONTROL_FREQUENCY,
  CONTROL_STATUS,
  EVIDENCE_STATUS,
  EVIDENCE_TYPE,
  VENDOR_CATEGORY,
  VENDOR_STATUS,
} from '../../../src/modules/compliance/enum/compliance.enum.js';
import type {
  ComplianceControlView,
  ComplianceEvidenceView,
  ComplianceVendorView,
} from '../../../src/modules/compliance/types/compliance.types.js';

describe('Compliance Helpers (Unit)', () => {
  it('computes next due dates accurately for all control frequencies', () => {
    const base = new Date('2026-01-15T10:00:00.000Z');

    expect(computeNextDueDate(CONTROL_FREQUENCY.DAILY, base)?.toISOString()).toBe(
      '2026-01-16T10:00:00.000Z',
    );
    expect(computeNextDueDate(CONTROL_FREQUENCY.WEEKLY, base)?.toISOString()).toBe(
      '2026-01-22T10:00:00.000Z',
    );
    expect(computeNextDueDate(CONTROL_FREQUENCY.MONTHLY, base)?.toISOString()).toBe(
      '2026-02-15T10:00:00.000Z',
    );
    expect(computeNextDueDate(CONTROL_FREQUENCY.QUARTERLY, base)?.toISOString()).toBe(
      '2026-04-15T10:00:00.000Z',
    );
    expect(computeNextDueDate(CONTROL_FREQUENCY.SEMI_ANNUAL, base)?.toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
    expect(computeNextDueDate(CONTROL_FREQUENCY.ANNUAL, base)?.toISOString()).toBe(
      '2027-01-15T10:00:00.000Z',
    );
    expect(computeNextDueDate(CONTROL_FREQUENCY.AD_HOC, base)).toBeNull();
  });

  it('normalizes framework tags without duplicates and matches framework-agnostically', () => {
    const tags = normalizeFrameworkTags([' ISO27001:A.8 ', 'soc2:CC6', 'iso27001:a.8', '', 'INTERNAL']);
    expect(tags).toEqual(['ISO27001:A.8', 'soc2:CC6', 'INTERNAL']);
    expect(controlMatchesFrameworkTag(tags, 'iso27001')).toBe(true);
    expect(controlMatchesFrameworkTag(tags, 'SOC2:CC6')).toBe(true);
    expect(controlMatchesFrameworkTag(tags, 'PCI-DSS')).toBe(false);
    expect(controlMatchesFrameworkTag(tags, null)).toBe(true);
  });

  it('classifies due status across overdue, due soon, on track, and unscheduled', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(classifyDueStatus(null, 30, now)).toBe(COMPLIANCE_DUE_STATUS.UNSCHEDULED);
    expect(classifyDueStatus(new Date('2026-05-20T00:00:00.000Z'), 30, now)).toBe(
      COMPLIANCE_DUE_STATUS.OVERDUE,
    );
    expect(classifyDueStatus(new Date('2026-06-15T00:00:00.000Z'), 30, now)).toBe(
      COMPLIANCE_DUE_STATUS.DUE_SOON,
    );
    expect(classifyDueStatus(new Date('2026-08-01T00:00:00.000Z'), 30, now)).toBe(
      COMPLIANCE_DUE_STATUS.ON_TRACK,
    );
  });

  it('aggregates framework-agnostic report summary including missing vendor fallbacks', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const controls: ComplianceControlView[] = [
      {
        id: 1,
        controlCode: 'CTRL-1',
        title: 'Access Review',
        description: null,
        domain: 'ACCESS',
        frameworkTags: ['ISO27001:A.5', 'SOC2:CC6'],
        ownerUserId: 1,
        organizationUnitId: null,
        frequency: CONTROL_FREQUENCY.QUARTERLY,
        status: CONTROL_STATUS.ACTIVE,
        lastCheckedAt: '2026-05-01T00:00:00.000Z',
        nextCheckDueAt: '2026-08-01T00:00:00.000Z',
        lastCheckResult: CONTROL_CHECK_RESULT.PASS,
        dueStatus: COMPLIANCE_DUE_STATUS.ON_TRACK,
        daysUntilDue: 61,
        metadata: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: 2,
        controlCode: 'CTRL-2',
        title: 'Vendor Review',
        description: null,
        domain: 'VENDOR',
        frameworkTags: ['GDPR:Art.28'],
        ownerUserId: 1,
        organizationUnitId: null,
        frequency: CONTROL_FREQUENCY.MONTHLY,
        status: CONTROL_STATUS.ACTIVE,
        lastCheckedAt: null,
        nextCheckDueAt: '2026-05-15T00:00:00.000Z',
        lastCheckResult: CONTROL_CHECK_RESULT.FAIL,
        dueStatus: COMPLIANCE_DUE_STATUS.OVERDUE,
        daysUntilDue: -17,
        metadata: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];

    const evidences: ComplianceEvidenceView[] = [
      {
        id: 10,
        controlId: 1,
        checkHistoryId: null,
        vendorId: null,
        evidenceType: EVIDENCE_TYPE.REPORT,
        title: 'PAM Report',
        description: null,
        fileId: null,
        auditLogId: null,
        logReference: null,
        reportHistoryId: null,
        reportCode: 'users.security_compliance',
        externalUrl: null,
        checksumSha256: null,
        collectedByUserId: 1,
        collectedAt: now.toISOString(),
        validUntil: null,
        status: EVIDENCE_STATUS.VALID,
        metadata: null,
        createdAt: now.toISOString(),
      },
    ];

    const vendors: ComplianceVendorView[] = [
      {
        id: 100,
        vendorCode: 'VEND-1',
        name: 'Gemini AI',
        category: VENDOR_CATEGORY.AI,
        criticality: 'HIGH',
        status: VENDOR_STATUS.ACTIVE,
        providerEntryId: null,
        websiteUrl: null,
        contactEmail: null,
        ownerUserId: 1,
        organizationUnitId: null,
        contractStartDate: null,
        contractEndDate: '2026-06-20T00:00:00.000Z',
        contractDueStatus: COMPLIANCE_DUE_STATUS.DUE_SOON,
        daysUntilContractEnd: 19,
        autoRenew: false,
        reviewFrequency: CONTROL_FREQUENCY.QUARTERLY,
        lastReviewedAt: null,
        nextReviewDueAt: '2026-05-25T00:00:00.000Z',
        reviewDueStatus: COMPLIANCE_DUE_STATUS.OVERDUE,
        daysUntilReviewDue: -7,
        dpaSigned: false,
        dpaFileId: null,
        fallbackVendorName: null,
        fallbackStrategy: null,
        migrationRunbook: null,
        rtoHours: null,
        exitPlanTestedAt: null,
        hasFallbackPlan: false,
        metadata: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];

    const allResult = buildComplianceReportSummary({
      controls,
      evidences,
      checks: [],
      vendors,
      assessments: [],
      now,
    });
    expect(allResult.summary.totalControls).toBe(2);
    expect(allResult.summary.passRatePercent).toBe(50);
    expect(allResult.summary.overdueControls).toBe(1);
    expect(allResult.summary.controlsWithoutValidEvidence).toBe(1);
    expect(allResult.summary.vendorsMissingFallback).toBe(1);
    expect(allResult.summary.expiringOrExpiredContracts).toBe(1);

    const isoOnly = buildComplianceReportSummary({
      controls,
      evidences,
      checks: [],
      vendors,
      assessments: [],
      frameworkTag: 'ISO27001',
      now,
    });
    expect(isoOnly.summary.totalControls).toBe(1);
    expect(isoOnly.summary.passRatePercent).toBe(100);
  });
});
