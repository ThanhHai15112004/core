import { safeJsonParseObject, safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  ASSESSMENT_APPROVAL_STATUS,
  COMPLIANCE_DUE_STATUS,
  COMPLIANCE_RISK_LEVEL,
  CONTROL_CHECK_RESULT,
  CONTROL_FREQUENCY,
  CONTROL_STATUS,
  EVIDENCE_STATUS,
  type ComplianceDueStatus,
  type ControlFrequency,
  type VendorCategory,
} from '../enum/compliance.enum.js';
import type {
  ComplianceCheckHistoryView,
  ComplianceControlView,
  ComplianceEvidenceView,
  ComplianceReportSummaryMetrics,
  ComplianceVendorView,
  VendorDataAssessmentView,
} from '../types/compliance.types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeFrameworkTags(tags?: readonly string[] | null): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

export function controlMatchesFrameworkTag(
  frameworkTags: readonly string[],
  frameworkTag?: string | null,
): boolean {
  const filter = frameworkTag?.trim().toLowerCase();
  if (!filter) return true;
  return frameworkTags.some((tag) => tag.toLowerCase().includes(filter));
}

export function computeNextDueDate(
  frequency: ControlFrequency,
  fromDate: Date = new Date(),
): Date | null {
  const base = new Date(fromDate.getTime());
  switch (frequency) {
    case CONTROL_FREQUENCY.DAILY:
      base.setUTCDate(base.getUTCDate() + 1);
      return base;
    case CONTROL_FREQUENCY.WEEKLY:
      base.setUTCDate(base.getUTCDate() + 7);
      return base;
    case CONTROL_FREQUENCY.MONTHLY:
      base.setUTCMonth(base.getUTCMonth() + 1);
      return base;
    case CONTROL_FREQUENCY.QUARTERLY:
      base.setUTCMonth(base.getUTCMonth() + 3);
      return base;
    case CONTROL_FREQUENCY.SEMI_ANNUAL:
      base.setUTCMonth(base.getUTCMonth() + 6);
      return base;
    case CONTROL_FREQUENCY.ANNUAL:
      base.setUTCFullYear(base.getUTCFullYear() + 1);
      return base;
    case CONTROL_FREQUENCY.AD_HOC:
    default:
      return null;
  }
}

export function computeDaysUntil(targetDate: Date | null | undefined, now: Date = new Date()): number | null {
  if (!targetDate) return null;
  const diffMs = targetDate.getTime() - now.getTime();
  return Math.ceil(diffMs / MS_PER_DAY);
}

export function classifyDueStatus(
  targetDate: Date | null | undefined,
  reminderDaysBefore: number,
  now: Date = new Date(),
): ComplianceDueStatus {
  if (!targetDate) return COMPLIANCE_DUE_STATUS.UNSCHEDULED;
  if (targetDate.getTime() < now.getTime()) return COMPLIANCE_DUE_STATUS.OVERDUE;
  const days = computeDaysUntil(targetDate, now);
  if (days !== null && days <= reminderDaysBefore) return COMPLIANCE_DUE_STATUS.DUE_SOON;
  return COMPLIANCE_DUE_STATUS.ON_TRACK;
}

export function parseJsonStringList(raw: string | null | undefined): string[] {
  return safeJsonParseStringArray(raw);
}

export function parseJsonObjectOrNull(
  raw: string | null | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!raw) return null;
  const parsed = safeJsonParseObject(raw);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

export function parseJsonNumberList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => Number(item))
      .filter((num) => Number.isInteger(num) && num > 0);
  } catch {
    return [];
  }
}

export function hasVendorFallbackPlan(vendor: {
  readonly fallbackVendorName?: string | null;
  readonly fallbackStrategy?: string | null;
}): boolean {
  return Boolean(vendor.fallbackVendorName?.trim() || vendor.fallbackStrategy?.trim());
}

export function buildComplianceReportSummary(input: {
  readonly controls: readonly ComplianceControlView[];
  readonly evidences: readonly ComplianceEvidenceView[];
  readonly checks: readonly ComplianceCheckHistoryView[];
  readonly vendors: readonly ComplianceVendorView[];
  readonly assessments: readonly VendorDataAssessmentView[];
  readonly frameworkTag?: string | null;
  readonly domain?: string | null;
  readonly vendorCategory?: VendorCategory | null;
  readonly fromDate?: Date | null;
  readonly toDate?: Date | null;
  readonly contractExpiringDaysBefore?: number;
  readonly now?: Date;
}): {
  readonly summary: ComplianceReportSummaryMetrics;
  readonly filteredControls: ComplianceControlView[];
  readonly filteredVendors: ComplianceVendorView[];
} {
  const now = input.now ?? new Date();
  const contractWindow = input.contractExpiringDaysBefore ?? 45;
  const frameworkFilter = input.frameworkTag?.trim() || null;
  const domainFilter = input.domain?.trim() || null;
  const vendorCategoryFilter = input.vendorCategory ?? null;

  const filteredControls = input.controls.filter((ctrl) => {
    if (domainFilter && ctrl.domain.toLowerCase() !== domainFilter.toLowerCase()) return false;
    if (!controlMatchesFrameworkTag(ctrl.frameworkTags, frameworkFilter)) return false;
    return true;
  });

  const controlIdSet = new Set(filteredControls.map((c) => c.id));
  const filteredEvidences = input.evidences.filter((ev) => controlIdSet.has(ev.controlId));
  const filteredChecks = input.checks.filter((ch) => {
    if (!controlIdSet.has(ch.controlId)) return false;
    const checkedDate = new Date(ch.checkedAt);
    if (input.fromDate && checkedDate < input.fromDate) return false;
    if (input.toDate && checkedDate > input.toDate) return false;
    return true;
  });

  const activeControls = filteredControls.filter((c) => c.status === CONTROL_STATUS.ACTIVE);
  const passedControls = activeControls.filter(
    (c) => c.lastCheckResult === CONTROL_CHECK_RESULT.PASS,
  ).length;
  const partialControls = activeControls.filter(
    (c) => c.lastCheckResult === CONTROL_CHECK_RESULT.PARTIAL,
  ).length;
  const failedControls = activeControls.filter(
    (c) => c.lastCheckResult === CONTROL_CHECK_RESULT.FAIL,
  ).length;
  const uncheckedControls = activeControls.filter((c) => c.lastCheckResult === null).length;

  const applicableControls = activeControls.filter(
    (c) => c.lastCheckResult !== CONTROL_CHECK_RESULT.NOT_APPLICABLE,
  );
  const passRatePercent =
    applicableControls.length > 0
      ? Number(((passedControls / applicableControls.length) * 100).toFixed(2))
      : 100;

  const overdueControls = activeControls.filter(
    (c) => c.dueStatus === COMPLIANCE_DUE_STATUS.OVERDUE,
  ).length;

  const validEvidenceControlIds = new Set(
    filteredEvidences
      .filter((ev) => ev.status === EVIDENCE_STATUS.VALID)
      .map((ev) => ev.controlId),
  );
  const controlsWithoutValidEvidence = activeControls.filter(
    (c) => !validEvidenceControlIds.has(c.id),
  ).length;

  const validEvidences = filteredEvidences.filter(
    (e) => e.status === EVIDENCE_STATUS.VALID,
  ).length;
  const expiredEvidences = filteredEvidences.filter(
    (e) => e.status === EVIDENCE_STATUS.EXPIRED,
  ).length;

  const filteredVendors = input.vendors.filter((v) => {
    if (vendorCategoryFilter && v.category !== vendorCategoryFilter) return false;
    return true;
  });
  const vendorIdSet = new Set(filteredVendors.map((v) => v.id));
  const filteredAssessments = input.assessments.filter((a) => vendorIdSet.has(a.vendorId));

  const activeVendors = filteredVendors.filter((v) => v.status !== 'OFFBOARDED');
  const vendorsMissingFallback = activeVendors.filter((v) => !v.hasFallbackPlan).length;
  const vendorsWithoutDpa = activeVendors.filter((v) => !v.dpaSigned).length;
  const expiringOrExpiredContracts = activeVendors.filter((v) => {
    if (!v.contractEndDate) return false;
    const end = new Date(v.contractEndDate);
    const days = computeDaysUntil(end, now);
    return days !== null && days <= contractWindow;
  }).length;
  const overdueVendorReviews = activeVendors.filter(
    (v) => v.reviewDueStatus === COMPLIANCE_DUE_STATUS.OVERDUE,
  ).length;

  const crossBorderAssessments = filteredAssessments.filter((a) => a.crossBorderTransfer).length;
  const highOrCriticalAssessments = filteredAssessments.filter(
    (a) =>
      (a.riskLevel === COMPLIANCE_RISK_LEVEL.HIGH ||
        a.riskLevel === COMPLIANCE_RISK_LEVEL.CRITICAL) &&
      a.approvalStatus !== ASSESSMENT_APPROVAL_STATUS.REJECTED,
  ).length;

  return {
    summary: {
      frameworkFilter,
      domainFilter,
      vendorCategoryFilter,
      totalControls: filteredControls.length,
      activeControls: activeControls.length,
      passedControls,
      partialControls,
      failedControls,
      uncheckedControls,
      passRatePercent,
      overdueControls,
      controlsWithoutValidEvidence,
      validEvidences,
      expiredEvidences,
      checksInPeriod: filteredChecks.length,
      totalVendors: filteredVendors.length,
      activeVendors: activeVendors.length,
      vendorsMissingFallback,
      vendorsWithoutDpa,
      expiringOrExpiredContracts,
      overdueVendorReviews,
      totalDataAssessments: filteredAssessments.length,
      crossBorderAssessments,
      highOrCriticalAssessments,
    },
    filteredControls,
    filteredVendors,
  };
}

export function buildComplianceReportRows(
  controls: readonly ComplianceControlView[],
  vendors: readonly ComplianceVendorView[],
): Array<Readonly<Record<string, unknown>>> {
  const rows: Array<Readonly<Record<string, unknown>>> = [];
  for (const c of controls) {
    rows.push({
      section: 'CONTROL',
      code: c.controlCode,
      name: c.title,
      categoryOrDomain: c.domain,
      frameworks: c.frameworkTags.join(' | '),
      status: c.status,
      resultOrRisk: c.lastCheckResult ?? 'UNCHECKED',
      dueStatus: c.dueStatus,
      dueAt: c.nextCheckDueAt ?? '',
      fallbackReady: '',
    });
  }
  for (const v of vendors) {
    rows.push({
      section: 'VENDOR',
      code: v.vendorCode,
      name: v.name,
      categoryOrDomain: v.category,
      frameworks: v.dpaSigned ? 'DPA_SIGNED' : 'NO_DPA',
      status: v.status,
      resultOrRisk: v.criticality,
      dueStatus: v.contractDueStatus,
      dueAt: v.contractEndDate ?? '',
      fallbackReady: v.hasFallbackPlan ? v.fallbackVendorName ?? 'YES' : 'MISSING',
    });
  }
  return rows;
}
