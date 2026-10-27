import React, { useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  Clock,
  Database,
  Download,
  Play,
  Plus,
  RefreshCw,
  Send,
  Zap,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { USER_STATUS_META } from '../enum/users.enum';
import type {
  CreateUserReportSchedulePayload,
  OrganizationOptionSummary,
  RegisteredReportDefinition,
  RunUserReportPayload,
  UserReportExecutionResult,
  UserReportHistoryItem,
  UserReportScheduleItem,
} from '../types/users.types';

export interface UsersReportsDashboardTabProps {
  readonly submitting: boolean;
  readonly availableReports: readonly RegisteredReportDefinition[];
  readonly organizationOptions: readonly OrganizationOptionSummary[];
  readonly lastReportResult: UserReportExecutionResult | null;
  readonly reportSchedules: readonly UserReportScheduleItem[];
  readonly reportHistories: readonly UserReportHistoryItem[];
  readonly onRunReport: (
    payload: RunUserReportPayload,
  ) => Promise<UserReportExecutionResult | null>;
  readonly onCreateSchedule: (
    payload: CreateUserReportSchedulePayload,
  ) => Promise<UserReportScheduleItem | null>;
  readonly onTriggerDueSchedules: () => Promise<void>;
  readonly onRefreshReportsData: () => Promise<void>;
  readonly onDownloadTemporaryReport: (token: string) => Promise<void>;
}

export const UsersReportsDashboardTab: React.FC<UsersReportsDashboardTabProps> = ({
  submitting,
  availableReports,
  organizationOptions,
  lastReportResult,
  reportSchedules,
  reportHistories,
  onRunReport,
  onCreateSchedule,
  onTriggerDueSchedules,
  onRefreshReportsData,
  onDownloadTemporaryReport,
}) => {
  const [selectedReportCode, setSelectedReportCode] = useState<string>(
    availableReports[0]?.code ?? 'users.summary_dashboard',
  );
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [organizationUnitId, setOrganizationUnitId] = useState<string>('');
  const [includeSubUnits, setIncludeSubUnits] = useState<boolean>(true);
  const [reportFormat, setReportFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx');
  const [runAsyncQueue, setRunAsyncQueue] = useState<boolean>(false);
  const [preferReplica, setPreferReplica] = useState<boolean>(true);
  const [useCache, setUseCache] = useState<boolean>(true);
  const [forceRefresh, setForceRefresh] = useState<boolean>(false);
  const [recipientEmailsInput, setRecipientEmailsInput] = useState<string>('');

  // Schedule creation state (Mục 8.4.5 & 8.4.6)
  const [scheduleName, setScheduleName] = useState<string>(
    'Báo cáo Tổng hợp Nhân sự Định kỳ',
  );
  const [scheduleFrequency, setScheduleFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>(
    'WEEKLY',
  );
  const [scheduleHour, setScheduleHour] = useState<number>(8);
  const [scheduleMinute, setScheduleMinute] = useState<number>(0);
  const [scheduleFormat, setScheduleFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx');
  const [scheduleEmails, setScheduleEmails] = useState<string>('hr-report@company.vn');
  const [scheduleTtlSeconds, setScheduleTtlSeconds] = useState<number>(3600);

  const activeReportDef =
    availableReports.find((r) => r.code === selectedReportCode) ?? availableReports[0] ?? null;

  const parseEmails = (raw: string): string[] =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));

  const handleExecuteReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const emails = parseEmails(recipientEmailsInput);
    await onRunReport({
      reportCode: selectedReportCode,
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(statusFilter ? { status: Number(statusFilter) } : {}),
      ...(organizationUnitId ? { organizationUnitId: Number(organizationUnitId) } : {}),
      includeSubUnits,
      format: reportFormat,
      async: runAsyncQueue,
      preferReplica,
      useCache,
      forceRefresh,
      ...(emails.length > 0
        ? { notifyChannels: ['EMAIL', 'IN_APP'], recipientEmails: emails }
        : {}),
    });
  };

  const handleCreateScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleName.trim()) return;
    const emails = parseEmails(scheduleEmails);
    await onCreateSchedule({
      reportCode: selectedReportCode,
      name: scheduleName.trim(),
      frequency: scheduleFrequency,
      hour: scheduleHour,
      minute: scheduleMinute,
      format: scheduleFormat,
      channels: ['EMAIL', 'IN_APP'],
      recipientEmails: emails,
      ttlSeconds: scheduleTtlSeconds,
      parameters: {
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {}),
        ...(statusFilter ? { status: Number(statusFilter) } : {}),
        ...(organizationUnitId ? { organizationUnitId: Number(organizationUnitId) } : {}),
        includeSubUnits,
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Registered Reports Catalog Banner (Mục 8.4.1 & 8.4.3) */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '14px',
          }}
        >
          <div>
            <h3 style={{ ...authStyles.sectionTitle, marginBottom: '4px' }}>
              <BarChart3 size={17} /> Danh mục Báo cáo & Dashboard đã đăng ký theo Module (Mục
              8.4.1 & 8.4.3)
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Mỗi module tự khai báo danh sách báo cáo qua <code>ReportRegistryService</code> và
              kiểm soát bằng quyền riêng <code>users.report</code> (tách biệt với quyền xem danh
              sách thông thường).
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onRefreshReportsData()}
            style={authStyles.btnSecondary}
          >
            <RefreshCw size={14} /> Làm mới dữ liệu Báo cáo
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '12px',
          }}
        >
          {availableReports.map((rep) => {
            const selected = rep.code === selectedReportCode;
            return (
              <div
                key={rep.code}
                onClick={() => setSelectedReportCode(rep.code)}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: selected
                    ? '2px solid var(--primary)'
                    : '1px solid var(--border-color)',
                  background: selected ? 'var(--bg-light-blue)' : 'var(--bg-surface-elevated)',
                  cursor: 'pointer',
                  transition: 'var(--transition-fast)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-main)' }}>
                    {rep.name}
                  </span>
                  <span
                    style={
                      rep.category === 'DASHBOARD'
                        ? authStyles.badgePrimary
                        : authStyles.badgeSuccess
                    }
                  >
                    {rep.category}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginBottom: '8px',
                    lineHeight: 1.4,
                  }}
                >
                  {rep.description || rep.code}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={authStyles.badgePrimary}>Quyền: {rep.requiredPermission}</span>
                  {rep.supportsReadReplica && (
                    <span style={authStyles.badgeSuccess}>Read Replica (8.4.8)</span>
                  )}
                  <span style={authStyles.badgeWarning}>Cache TTL: {rep.cacheTtlSeconds}s</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Execute Report (8.4.2, 8.4.4, 8.4.8, 8.4.9) & Schedule Report (8.4.5, 8.4.6) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
          gap: '18px',
        }}
      >
        {/* Left: Run Report Form */}
        <form onSubmit={(e) => void handleExecuteReport(e)} style={authStyles.cardHighlighted}>
          <h3 style={authStyles.sectionTitle}>
            <Play size={16} /> Thiết lập Tham số & Chạy Báo cáo (Mục 8.4.2, 8.4.4, 8.4.8, 8.4.9)
          </h3>
          <p style={authStyles.sectionDesc}>
            Đang chọn:{' '}
            <strong>{activeReportDef?.name ?? selectedReportCode}</strong> (
            <code>{selectedReportCode}</code>). Hỗ trợ lọc khoảng ngày, trạng thái, đơn vị, đọc từ
            Read Replica và Cache thông minh.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginBottom: '10px',
            }}
          >
            <div>
              <label style={authStyles.label}>Từ ngày (fromDate — 8.4.2)</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Đến ngày (toDate — 8.4.2)</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={authStyles.input}
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 0.8fr',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div>
              <label style={authStyles.label}>Trạng thái nhân sự</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={authStyles.input}
              >
                <option value="">-- Tất cả trạng thái --</option>
                {Object.values(USER_STATUS_META).map((st) => (
                  <option key={st.code} value={st.code}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={authStyles.label}>Đơn vị tổ chức</label>
              <select
                value={organizationUnitId}
                onChange={(e) => setOrganizationUnitId(e.target.value)}
                style={authStyles.input}
              >
                <option value="">-- Toàn bộ đơn vị trong phạm vi --</option>
                {organizationOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={authStyles.label}>Định dạng xuất</label>
              <select
                value={reportFormat}
                onChange={(e) => setReportFormat(e.target.value as 'xlsx' | 'csv' | 'pdf')}
                style={authStyles.input}
              >
                <option value="xlsx">Excel (.XLSX)</option>
                <option value="csv">CSV (.CSV)</option>
                <option value="pdf">PDF (.PDF)</option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              marginBottom: '12px',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={includeSubUnits}
                onChange={(e) => setIncludeSubUnits(e.target.checked)}
              />
              Bao gồm các đơn vị trực thuộc con
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={runAsyncQueue}
                onChange={(e) => setRunAsyncQueue(e.target.checked)}
              />
              Chạy báo cáo nặng bằng Queue (8.4.4)
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={preferReplica}
                onChange={(e) => setPreferReplica(e.target.checked)}
              />
              Ưu tiên đọc từ Read Replica (8.4.8)
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={useCache}
                onChange={(e) => setUseCache(e.target.checked)}
              />
              Sử dụng Cache báo cáo (8.4.9)
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 1fr',
              gap: '10px',
              marginBottom: '12px',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={authStyles.label}>
                Email nhận thông báo kèm link tải tạm thời (phân cách bằng dấu phẩy — 8.4.6)
              </label>
              <input
                type="text"
                placeholder="vd: manager@company.vn, hr@company.vn"
                value={recipientEmailsInput}
                onChange={(e) => setRecipientEmailsInput(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                paddingBottom: '8px',
              }}
            >
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
              />
              Bỏ qua Cache (Force Refresh)
            </label>
          </div>

          <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
            <Play size={15} />
            {runAsyncQueue ? 'Đẩy Báo cáo vào Queue (8.4.4)' : 'Chạy Báo cáo & Tổng hợp ngay'}
          </button>
        </form>

        {/* Right: Schedule Report Form (Mục 8.4.5 & 8.4.6) */}
        <form onSubmit={(e) => void handleCreateScheduleSubmit(e)} style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '6px',
            }}
          >
            <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
              <CalendarClock size={16} /> Lên lịch gửi Báo cáo tự động (Mục 8.4.5 & 8.4.6)
            </h3>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onTriggerDueSchedules()}
              style={{ ...authStyles.btnTeal, padding: '6px 12px', fontSize: '12px' }}
            >
              <Send size={13} /> Kích hoạt Lịch đến hạn ngay
            </button>
          </div>
          <p style={authStyles.sectionDesc}>
            Tự động chạy theo Ngày (<code>DAILY</code>), Tuần (<code>WEEKLY</code>) hoặc Tháng (
            <code>MONTHLY</code>) qua <code>SystemProcessor</code> và gửi link tải tạm thời.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr',
              gap: '10px',
              marginBottom: '10px',
            }}
          >
            <div>
              <label style={authStyles.label}>Tên lịch gửi báo cáo</label>
              <input
                type="text"
                required
                value={scheduleName}
                onChange={(e) => setScheduleName(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Chu kỳ định kỳ (8.4.5)</label>
              <select
                value={scheduleFrequency}
                onChange={(e) =>
                  setScheduleFrequency(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')
                }
                style={authStyles.input}
              >
                <option value="DAILY">Hàng ngày (DAILY)</option>
                <option value="WEEKLY">Hàng tuần (WEEKLY)</option>
                <option value="MONTHLY">Hàng tháng (MONTHLY)</option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: '10px',
              marginBottom: '10px',
            }}
          >
            <div>
              <label style={authStyles.label}>Giờ (0-23)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={scheduleHour}
                onChange={(e) => setScheduleHour(Number(e.target.value) || 0)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Phút (0-59)</label>
              <input
                type="number"
                min={0}
                max={59}
                value={scheduleMinute}
                onChange={(e) => setScheduleMinute(Number(e.target.value) || 0)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Định dạng file</label>
              <select
                value={scheduleFormat}
                onChange={(e) => setScheduleFormat(e.target.value as 'xlsx' | 'csv' | 'pdf')}
                style={authStyles.input}
              >
                <option value="xlsx">XLSX</option>
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
            <div>
              <label style={authStyles.label}>TTL File tạm (s)</label>
              <input
                type="number"
                min={60}
                max={604800}
                value={scheduleTtlSeconds}
                onChange={(e) => setScheduleTtlSeconds(Number(e.target.value) || 3600)}
                style={authStyles.monoInput}
              />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={authStyles.label}>
              Danh sách Email nhận báo cáo định kỳ (8.4.6 — Email & In-App Notification)
            </label>
            <input
              type="text"
              value={scheduleEmails}
              onChange={(e) => setScheduleEmails(e.target.value)}
              style={authStyles.input}
            />
          </div>

          <button type="submit" disabled={submitting} style={authStyles.btnSecondary}>
            <Plus size={15} /> Đăng ký Lịch gửi báo cáo ({scheduleFrequency})
          </button>

          {/* Registered Schedules List */}
          {reportSchedules.length > 0 && (
            <div style={{ marginTop: '14px', maxHeight: '165px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>Tên lịch / Báo cáo</th>
                    <th style={authStyles.tableHeaderCell}>Chu kỳ / Cron</th>
                    <th style={authStyles.tableHeaderCell}>Lần chạy kế tiếp</th>
                  </tr>
                </thead>
                <tbody>
                  {reportSchedules.map((sch) => (
                    <tr key={sch.id}>
                      <td style={authStyles.tableCell}>
                        <div style={{ fontWeight: 700 }}>
                          #{sch.id} — {sch.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          <code>{sch.reportCode}</code> • {sch.format.toUpperCase()}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgePrimary}>{sch.frequency}</span>{' '}
                        <code style={{ fontSize: '11.5px' }}>{sch.cronExpression}</code>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {new Date(sch.nextRunAt).toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </form>
      </div>

      {/* Report Execution Result Inspector (Mục 8.4.2, 8.4.8, 8.4.9) */}
      {lastReportResult && (
        <div style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div>
              <h3 style={{ ...authStyles.sectionTitle, marginBottom: '4px' }}>
                <Zap size={16} /> Kết quả thực thi Báo cáo: {lastReportResult.reportName}
              </h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={authStyles.badgePrimary}>
                  Chế độ: {lastReportResult.executionMode}
                </span>
                <span
                  style={
                    lastReportResult.dataSourceUsed === 'CACHE'
                      ? authStyles.badgeSuccess
                      : lastReportResult.dataSourceUsed === 'REPLICA'
                        ? authStyles.badgePrimary
                        : authStyles.badgeWarning
                  }
                >
                  <Database size={12} /> Nguồn đọc: {lastReportResult.dataSourceUsed}
                  {lastReportResult.cacheHit ? ' (Cache Hit — 8.4.9)' : ''}
                </span>
                <span style={authStyles.badgeSuccess}>
                  Tổng bản ghi: {lastReportResult.totalRecords}
                </span>
                {lastReportResult.durationMs !== null && (
                  <span style={authStyles.badgePrimary}>{lastReportResult.durationMs} ms</span>
                )}
              </div>
            </div>

            {lastReportResult.downloadToken && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onDownloadTemporaryReport(lastReportResult.downloadToken!)}
                style={authStyles.btnTeal}
              >
                <Download size={15} /> Tải file Báo cáo tạm ({lastReportResult.format?.toUpperCase()})
              </button>
            )}
          </div>

          {/* KPI Summary Metrics */}
          {Object.keys(lastReportResult.summary).length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
                marginBottom: '12px',
              }}
            >
              {Object.entries(lastReportResult.summary).map(([key, val]) => {
                if (typeof val === 'object' && val !== null) return null;
                return (
                  <div
                    key={key}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{key}</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-main)' }}>
                      {String(val)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sample Rows Table */}
          {lastReportResult.rows.length > 0 && (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {Object.keys(lastReportResult.rows[0]!).slice(0, 7).map((col) => (
                      <th key={col} style={authStyles.tableHeaderCell}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lastReportResult.rows.slice(0, 20).map((row, idx) => (
                    <tr key={idx}>
                      {Object.keys(lastReportResult.rows[0]!).slice(0, 7).map((col) => (
                        <td key={col} style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                          {typeof row[col] === 'object'
                            ? JSON.stringify(row[col])
                            : String(row[col] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Report Execution Histories Table (Mục 8.4.7) */}
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <Clock size={16} /> Lịch sử Chạy Báo cáo (Thời gian, Người chạy, Nguồn đọc & Kết quả —
          Mục 8.4.7)
        </h3>
        {reportHistories.length === 0 ? (
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
            Chưa có lịch sử chạy báo cáo nào.
          </p>
        ) : (
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>ID / Báo cáo</th>
                  <th style={authStyles.tableHeaderCell}>Chế độ / Nguồn đọc</th>
                  <th style={authStyles.tableHeaderCell}>Bản ghi / Thời gian</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                  <th style={authStyles.tableHeaderCell}>File tạm (8.4.6)</th>
                </tr>
              </thead>
              <tbody>
                {reportHistories.map((h) => (
                  <tr key={h.id}>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>
                        #{h.id} — {h.reportName}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Actor: {h.actorId ? `#${h.actorId}` : 'Scheduler'} •{' '}
                        {new Date(h.startedAt).toLocaleString('vi-VN')}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{h.executionMode}</span>{' '}
                      <span style={authStyles.badgeSuccess}>
                        {h.dataSourceUsed}
                        {h.cacheHit ? ' (HIT)' : ''}
                      </span>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      <strong>{h.totalRecords}</strong> dòng ({h.durationMs ?? 0} ms)
                    </td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          h.isExpired || h.status === 'EXPIRED'
                            ? authStyles.badgeWarning
                            : h.status === 'COMPLETED'
                              ? authStyles.badgeSuccess
                              : authStyles.badgePrimary
                        }
                      >
                        {h.isExpired ? 'EXPIRED' : h.status}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      {h.downloadToken && !h.isExpired ? (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void onDownloadTemporaryReport(h.downloadToken!)}
                          style={{ ...authStyles.btnSecondary, padding: '5px 10px', fontSize: '11.5px' }}
                        >
                          <Download size={12} /> Tải {h.format?.toUpperCase()}
                        </button>
                      ) : (
                        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {h.isExpired ? 'Đã hết hạn' : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
