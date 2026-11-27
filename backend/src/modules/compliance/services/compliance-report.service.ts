import { Injectable, Optional } from '@nestjs/common';
import {
  COMPLIANCE_DOMAIN_EVENTS,
  DomainEventBusService,
  EXPORT_FORMAT,
  ExportRegistryService,
  FeatureFlagRegistryService,
  ReportRegistryService,
  SettingRegistryService,
  assertDistinctReportPermission,
  buildExportFileArtifact,
  createDomainEvent,
  defaultDomainEventBus,
  defaultExportRegistry,
  defaultFeatureFlagRegistry,
  defaultReportRegistry,
  defaultSettingRegistry,
  discoverManifestReports,
  resolveExportFormat,
  type ExportFormat,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { COMPLIANCE_PERMISSIONS } from '../enum/compliance.enum.js';
import {
  assertReportsEnabled,
  resolveComplianceRuntimeConfig,
} from '../helpers/compliance-config.helper.js';
import {
  buildComplianceReportRows,
  buildComplianceReportSummary,
} from '../helpers/compliance.helper.js';
import type {
  ComplianceReportQuery,
  GenerateComplianceReportRequest,
} from '../requests/compliance.requests.js';
import type {
  ComplianceReportDownloadView,
  ComplianceReportResultView,
} from '../types/compliance.types.js';
import { ComplianceControlService } from './compliance-control.service.js';
import { ComplianceEvidenceService } from './compliance-evidence.service.js';
import { ComplianceVendorService } from './compliance-vendor.service.js';

const COMPLIANCE_REPORT_CODE = 'compliance.summary_report';
const COMPLIANCE_REPORT_PROFILE_CODE = 'compliance_report';

@Injectable()
export class ComplianceReportService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly reportRegistry: ReportRegistryService;
  private readonly exportRegistry: ExportRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly controlService: ComplianceControlService,
    private readonly evidenceService: ComplianceEvidenceService,
    private readonly vendorService: ComplianceVendorService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() reportRegistry?: ReportRegistryService,
    @Optional() exportRegistry?: ExportRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.reportRegistry = reportRegistry ?? defaultReportRegistry;
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public ensureModuleReportsRegistered(): void {
    const discovered = discoverManifestReports().filter((item) => item.module === 'compliance');
    if (discovered.length > 0) {
      this.reportRegistry.registerManifestReports(discovered);
    }

    if (!this.reportRegistry.getReport(COMPLIANCE_REPORT_CODE)) {
      this.reportRegistry.registerReport({
        code: COMPLIANCE_REPORT_CODE,
        module: 'compliance',
        name: 'Báo cáo tổng hợp Compliance & Rủi ro nhà cung cấp',
        description:
          'Báo cáo tổng hợp trạng thái tuân thủ các yêu cầu kiểm soát, bằng chứng, lịch sử kiểm tra, đánh giá dữ liệu và phương án dự phòng nhà cung cấp (không phụ thuộc một tiêu chuẩn duy nhất)',
        category: 'REPORT',
        requiredPermission: COMPLIANCE_PERMISSIONS.REPORT,
        isHeavy: false,
        heavyRecordThreshold: 2000,
        cacheTtlSeconds: 180,
        supportsReadReplica: true,
        supportedFormats: ['xlsx', 'csv', 'pdf'],
        parameters: [
          { key: 'dateRange', name: 'Khoảng ngày kiểm tra', type: 'date-range', required: false },
          {
            key: 'organizationUnitId',
            name: 'Đơn vị / Phòng ban',
            type: 'organization-unit',
            required: false,
          },
          {
            key: 'filters',
            name: 'Bộ lọc frameworkTag / domain / vendorCategory',
            type: 'filter',
            required: false,
          },
        ],
        isSystem: true,
        status: 1,
      });
    }
  }

  public async getComplianceSummaryReport(
    query: ComplianceReportQuery = {},
    actor?: UserIdentity,
  ): Promise<ComplianceReportResultView> {
    return this.generateComplianceReport(
      {
        frameworkTag: query.frameworkTag ?? null,
        domain: query.domain ?? null,
        vendorCategory: query.vendorCategory ?? null,
        organizationUnitId: query.organizationUnitId ?? null,
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null,
        includeControls: query.includeControls ?? true,
        includeVendors: query.includeVendors ?? true,
        format: 'json',
      },
      actor,
    );
  }

  public async generateComplianceReport(
    dto: GenerateComplianceReportRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceReportResultView> {
    this.ensureModuleReportsRegistered();
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertReportsEnabled(cfg);
    assertDistinctReportPermission(COMPLIANCE_PERMISSIONS.REPORT, actor);

    const now = new Date();
    const [allControls, allEvidences, allChecks, allVendors, allAssessments] = await Promise.all([
      this.controlService.listAllControlsForAggregation(now),
      this.evidenceService.listAllEvidencesForAggregation(),
      this.controlService.listAllChecksForAggregation(),
      this.vendorService.listAllVendorsForAggregation(now),
      this.vendorService.listAllAssessmentsForAggregation(),
    ]);

    const scopedControls =
      dto.organizationUnitId !== null && dto.organizationUnitId !== undefined
        ? allControls.filter((c) => c.organizationUnitId === dto.organizationUnitId)
        : allControls;
    const scopedVendors =
      dto.organizationUnitId !== null && dto.organizationUnitId !== undefined
        ? allVendors.filter((v) => v.organizationUnitId === dto.organizationUnitId)
        : allVendors;

    const fromDate = dto.fromDate ? new Date(dto.fromDate) : null;
    const toDate = dto.toDate ? new Date(dto.toDate) : null;

    const { summary, filteredControls, filteredVendors } = buildComplianceReportSummary({
      controls: scopedControls,
      evidences: allEvidences,
      checks: allChecks,
      vendors: scopedVendors,
      assessments: allAssessments,
      frameworkTag: dto.frameworkTag ?? null,
      domain: dto.domain ?? null,
      vendorCategory: dto.vendorCategory ?? null,
      fromDate: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null,
      toDate: toDate && !Number.isNaN(toDate.getTime()) ? toDate : null,
      contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
      now,
    });

    const controlsOut = dto.includeControls ? filteredControls : [];
    const vendorsOut = dto.includeVendors ? filteredVendors : [];
    const rows = buildComplianceReportRows(controlsOut, vendorsOut);

    const historyRecord = this.reportRegistry.startReportHistory({
      reportCode: COMPLIANCE_REPORT_CODE,
      module: 'compliance',
      reportName: 'Báo cáo tổng hợp Compliance & Rủi ro nhà cung cấp',
      actorId: actor?.id ?? null,
      parameters: {
        fromDate: dto.fromDate ?? null,
        toDate: dto.toDate ?? null,
        statuses: [],
        organizationUnitId: dto.organizationUnitId ?? null,
        includeSubUnits: false,
        filters: {
          frameworkTag: dto.frameworkTag ?? null,
          domain: dto.domain ?? null,
          vendorCategory: dto.vendorCategory ?? null,
        },
      },
      executionMode: 'SYNC',
      status: 'PROCESSING',
      format: dto.format === 'json' ? null : dto.format,
    });

    let fileName: string | null = null;
    let downloadToken: string | null = null;
    let downloadUrl: string | null = null;
    let expiresAt: string | null = null;
    const resolvedExportFormat: ExportFormat | null =
      dto.format === 'json' ? null : resolveExportFormat(dto.format, EXPORT_FORMAT.XLSX);

    if (resolvedExportFormat) {
      const ttlSeconds = dto.ttlSeconds ?? cfg.reportFileTtlSeconds;
      const sampleRow = rows[0] ?? {
        section: 'SUMMARY',
        frameworkFilter: summary.frameworkFilter ?? 'ALL',
        totalControls: summary.totalControls,
        passRatePercent: summary.passRatePercent,
        totalVendors: summary.totalVendors,
        vendorsMissingFallback: summary.vendorsMissingFallback,
      };
      const headers = Object.keys(sampleRow);
      const matrixRows: Array<Array<string | number>> =
        rows.length > 0
          ? rows.map((row) =>
              headers.map((key) => {
                const val = row[key];
                if (val === null || val === undefined) return '';
                return typeof val === 'number' ? val : String(val);
              }),
            )
          : [
              headers.map((key) => {
                const val = sampleRow[key];
                if (val === null || val === undefined) return '';
                return typeof val === 'number' ? val : String(val);
              }),
            ];

      const datePart = now.toISOString().slice(0, 10);
      const built = await buildExportFileArtifact({
        fileBaseName: `compliance_report_${datePart}`,
        format: resolvedExportFormat,
        headers,
        rows: matrixRows,
        xlsxOptions: {
          sheetName: 'Compliance',
          title: 'COMPLIANCE & VENDOR RISK REPORT',
          subtitle: `Framework: ${summary.frameworkFilter ?? 'ALL'} | Pass Rate: ${summary.passRatePercent}%`,
          freezeHeader: true,
        },
        pdfOptions: {
          title: 'COMPLIANCE & VENDOR RISK REPORT',
          subtitle: `Framework: ${summary.frameworkFilter ?? 'ALL'} | Pass Rate: ${summary.passRatePercent}%`,
          landscape: true,
        },
        pdfAdapter: this.exportRegistry.getPdfAdapter(),
        onlyRequestedFormat: true,
      });

      const artifact = this.exportRegistry.storeTemporaryArtifact({
        profileCode: COMPLIANCE_REPORT_PROFILE_CODE,
        module: 'compliance',
        fileName: built.fileName,
        format: resolvedExportFormat,
        contentType: built.contentType,
        totalExported: rows.length,
        buffer: built.primaryBuffer,
        actorId: actor?.id ?? null,
        historyId: historyRecord.id,
        jobId: null,
        ttlSeconds,
        baseDownloadPath: '/api/v1/compliance/reports/downloads',
      });

      fileName = artifact.fileName;
      downloadToken = artifact.token;
      downloadUrl = artifact.downloadUrl;
      expiresAt = artifact.expiresAt;
    }

    this.reportRegistry.updateReportHistory(historyRecord.id, {
      status: 'COMPLETED',
      executionMode: 'SYNC',
      dataSourceUsed: 'PRIMARY',
      format: resolvedExportFormat,
      fileName,
      totalRecords: rows.length,
      summary: summary as unknown as Readonly<Record<string, unknown>>,
      downloadToken,
      downloadUrl,
      expiresAt,
      completedAt: new Date().toISOString(),
    });

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.REPORT_GENERATED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_report',
          aggregateId: String(historyRecord.id),
          payload: {
            frameworkFilter: summary.frameworkFilter,
            format: dto.format,
            totalControls: summary.totalControls,
            totalVendors: summary.totalVendors,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'report',
        action: 'COMPLIANCE_REPORT_GENERATED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_report',
        resourceId: COMPLIANCE_REPORT_CODE,
        afterData: {
          historyId: historyRecord.id,
          format: dto.format,
          frameworkFilter: summary.frameworkFilter,
          totalControls: summary.totalControls,
          totalVendors: summary.totalVendors,
        },
      });
    }

    return {
      reportCode: COMPLIANCE_REPORT_CODE,
      generatedAt: now.toISOString(),
      historyId: historyRecord.id,
      format: dto.format,
      fileName,
      downloadToken,
      downloadUrl,
      expiresAt,
      summary,
      controls: controlsOut,
      vendors: vendorsOut,
      rows,
    };
  }

  public downloadReportArtifact(token: string, now: Date = new Date()): ComplianceReportDownloadView {
    this.reportRegistry.purgeExpiredReportArtifacts(now);
    const downloaded = this.exportRegistry.formatTemporaryArtifactDownload(token, {
      now,
      expectedProfileCode: COMPLIANCE_REPORT_PROFILE_CODE,
      expiredErrorKey: 'compliance.reportDownloadExpired',
    });
    return {
      token: downloaded.token,
      fileName: downloaded.fileName,
      contentType: downloaded.contentType,
      format: downloaded.format,
      totalExported: downloaded.totalExported,
      sizeBytes: downloaded.sizeBytes,
      createdAt: downloaded.createdAt,
      expiresAt: downloaded.expiresAt,
      ...(downloaded.csvContent !== undefined ? { csvContent: downloaded.csvContent } : {}),
      ...(downloaded.xlsxBase64 !== undefined ? { xlsxBase64: downloaded.xlsxBase64 } : {}),
      ...(downloaded.pdfBase64 !== undefined ? { pdfBase64: downloaded.pdfBase64 } : {}),
    };
  }
}
