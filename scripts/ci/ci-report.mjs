#!/usr/bin/env node
/**
 * Bộ tạo báo cáo kết quả CI chuyên sâu (Excel 4 sheet có công thức + AutoFilter + git blame, Markdown & JSON).
 *
 * Cấu trúc 4 sheet trong `reports/ci-summary.xlsx`:
 *   1. `Tong_Quan_CI`           — Dashboard KPI tự động bằng công thức Excel (COUNTIF/COUNTIFS/SUM),
 *                                 thống kê theo Gate CI, theo Tác giả dòng mã (git blame) & theo Mức độ.
 *   2. `Chi_Tiet_Loi_Canh_Bao`  — Từng lỗi/cảnh báo chi tiết (vị trí file:line, đoạn mã minh chứng,
 *                                 tác giả git blame, commit, thời gian, đề xuất sửa, có AutoFilter).
 *   3. `Chi_Tiet_Test_Suites`   — Từng test case (Backend Unit/Feature, Live DB+Redis, Frontend Vitest):
 *                                 PASS báo PASS, FAIL báo FAIL kèm chi tiết lỗi & thời gian chạy.
 *   4. `Do_Phu_Theo_Module`     — Độ phủ kiểm thử theo từng module/package + xếp loại & dòng tổng.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectNormalizedArtifacts,
  getGitContext,
} from './collect-ci-findings.mjs';
import { XLSX_STYLE, buildMultiSheetXlsxBuffer } from './xlsx-writer.mjs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');

const args = process.argv.slice(2);

function getFlagValue(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function getAllFlagValues(flag) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

async function findFileRecursive(rootDir, fileName) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isFile() && entry.name === fileName) return fullPath;
      if (entry.isDirectory()) {
        const nested = await findFileRecursive(fullPath, fileName);
        if (nested) return nested;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function readJsonSafe(relOrAbsPath, searchDir = null, fallbackFileName = null) {
  if (relOrAbsPath) {
    const resolved = path.isAbsolute(relOrAbsPath)
      ? relOrAbsPath
      : path.resolve(repoRoot, relOrAbsPath);
    try {
      const raw = await fs.readFile(resolved, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Fallback sang tìm đệ quy
    }
  }
  if (searchDir && fallbackFileName) {
    const resolvedDir = path.isAbsolute(searchDir)
      ? searchDir
      : path.resolve(repoRoot, searchDir);
    const found = await findFileRecursive(resolvedDir, fallbackFileName);
    if (found) {
      try {
        return JSON.parse(await fs.readFile(found, 'utf8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeStatus(raw) {
  const s = String(raw ?? 'unknown').trim().toLowerCase();
  if (s === 'success' || s === 'passed' || s === 'pass' || s === 'ok') return 'passed';
  if (s === 'failure' || s === 'failed' || s === 'fail' || s === 'error') return 'failed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'skipped' || s === 'skip') return 'skipped';
  return s || 'unknown';
}

function statusBadge(status) {
  switch (status) {
    case 'passed':
      return '✅ PASS';
    case 'failed':
      return '❌ FAIL';
    case 'cancelled':
      return '⚠️ CANCELLED';
    case 'skipped':
      return '⏭️ SKIPPED';
    default:
      return `❓ ${status.toUpperCase()}`;
  }
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildMarkdownReport(summary) {
  const overallLabel = summary.passed ? '✅ PASSED' : '❌ FAILED';
  const f = summary.findingsSummary;
  const t = summary.testsSummary;
  const lines = [
    `# Core CI Quality Report — ${overallLabel}`,
    '',
    `- **Branch / Commit:** \`${summary.git.branch}\` @ \`${summary.git.sha}\` (${summary.git.author})`,
    `- **Generated At:** \`${summary.generatedAt}\` | **Mode:** \`${summary.mode}\``,
    `- **Gates:** ${summary.counts.passed} passed | ${summary.counts.failed} failed | ${summary.counts.skipped} skipped`,
    `- **Findings:** ${f.total} total (**${f.fail}** errors, **${f.warn}** warnings, **${f.info}** info)`,
    `- **Test Cases:** ${t.total} total (**${t.pass}** pass, **${t.fail}** fail, **${t.skipped}** skipped)`,
    '',
  ];

  if (summary.failedSteps.length > 0) {
    lines.push('## ❌ Failed Steps');
    for (const step of summary.failedSteps) {
      lines.push(`- **${step.name}**${step.detail ? `: ${step.detail}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Quality Gates Breakdown');
  lines.push('');
  lines.push('| Step / Gate | Status | Duration | Notes |');
  lines.push('| :--- | :---: | :---: | :--- |');
  for (const step of summary.steps) {
    lines.push(
      `| ${step.name} | ${statusBadge(step.status)} | ${formatDuration(step.durationMs)} | ${step.detail ?? '-'} |`,
    );
  }
  lines.push('');

  if (summary.findings.length > 0) {
    lines.push('## Top Findings (Errors & Warnings)');
    lines.push('');
    lines.push('| Code | Status | Severity | Gate | Location | Author (git blame) | Rule |');
    lines.push('| :--- | :---: | :---: | :--- | :--- | :--- | :--- |');
    for (const item of summary.findings.slice(0, 20)) {
      lines.push(
        `| \`${item.code}\` | ${item.status} | ${item.severity} | ${item.gate} | \`${item.location}\` | ${item.author} | \`${item.rule}\` |`,
      );
    }
    if (summary.findings.length > 20) {
      lines.push(`\n*...và ${summary.findings.length - 20} mục khác — xem đầy đủ trong file Excel \`reports/ci-summary.xlsx\`.*`);
    }
    lines.push('');
  }

  if (summary.details.coverage?.overall) {
    const ov = summary.details.coverage.overall;
    lines.push('## Backend Test Coverage');
    lines.push(
      `- Statements: **${Number(ov.statements?.pct ?? 0).toFixed(2)}%** | Branches: **${Number(ov.branches?.pct ?? 0).toFixed(2)}%** | Functions: **${Number(ov.functions?.pct ?? 0).toFixed(2)}%** | Lines: **${Number(ov.lines?.pct ?? 0).toFixed(2)}%**`,
    );
    lines.push('');
  }

  if (summary.details.securitySbom) {
    const sbom = summary.details.securitySbom;
    lines.push('## Security & SBOM (15.2)');
    lines.push(
      `- **SBOM (${sbom.format} ${sbom.specVersion}):** Release \`v${sbom.releaseVersion}\` — **${sbom.totalUniqueComponents}** unique components (\`${sbom.artifacts?.[0]?.file ?? 'reports/sbom/core-sbom-latest.cdx.json'}\`)`,
    );
    if (summary.details.securityLicenses?.summary) {
      const lic = summary.details.securityLicenses.summary;
      lines.push(`- **Licenses:** ${lic.totalPackages} packages checked (**${lic.fail}** denied, **${lic.warn}** review)`);
    }
    if (summary.details.securityDeps?.summary) {
      const dep = summary.details.securityDeps.summary;
      lines.push(`- **Dependency Audit (SLA):** **${dep.fail}** blocking, **${dep.warn}** warnings`);
    }
    lines.push('');
  }

  lines.push('> 📊 **Excel Audit Workbook (4 sheets, công thức động + AutoFilter + git blame):** `reports/ci-summary.xlsx`');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildExcelWorkbook(summary) {
  const overallText = summary.passed ? 'PASS' : 'FAIL';
  const findings = summary.findings;
  const testCases = summary.testCases;
  const findingDataStart = 4;
  const findingDataEnd = Math.max(findingDataStart, findingDataStart + findings.length - 1);
  const hasRealFindings = findings.length > 0;
  const fSheet = 'Chi_Tiet_Loi_Canh_Bao';
  const tSheet = 'Chi_Tiet_Test_Suites';
  const testDataStart = 4;
  const testDataEnd = Math.max(testDataStart, testDataStart + testCases.length - 1);
  const hasRealTests = testCases.length > 0;

  // ==========================================================================
  // Sheet 1: Tong_Quan_CI (Dashboard công thức tự động giống chuẩn file mẫu)
  // ==========================================================================
  const kpiLabels = [
    'KẾT QUẢ CI',
    'GATES PASS',
    'GATES FAIL',
    'LỖI (FAIL)',
    'CẢNH BÁO (WARN)',
    'CRITICAL',
    'HIGH',
    'TEST PASS',
    'TEST FAIL',
    'TỶ LỆ TEST PASS (%)',
  ];

  const kpiValues = [
    { v: overallText, s: summary.passed ? XLSX_STYLE.BADGE_PASS : XLSX_STYLE.BADGE_FAIL },
    { v: summary.counts.passed, s: XLSX_STYLE.KPI_VALUE },
    { v: summary.counts.failed, s: summary.counts.failed > 0 ? XLSX_STYLE.BADGE_FAIL : XLSX_STYLE.KPI_VALUE },
    hasRealFindings
      ? { f: `COUNTIF(${fSheet}!C${findingDataStart}:C${findingDataEnd},"FAIL")`, v: summary.findingsSummary.fail, s: summary.findingsSummary.fail > 0 ? XLSX_STYLE.BADGE_FAIL : XLSX_STYLE.KPI_VALUE }
      : { v: 0, s: XLSX_STYLE.KPI_VALUE },
    hasRealFindings
      ? { f: `COUNTIF(${fSheet}!C${findingDataStart}:C${findingDataEnd},"WARN")`, v: summary.findingsSummary.warn, s: summary.findingsSummary.warn > 0 ? XLSX_STYLE.BADGE_WARN : XLSX_STYLE.KPI_VALUE }
      : { v: 0, s: XLSX_STYLE.KPI_VALUE },
    hasRealFindings
      ? { f: `COUNTIF(${fSheet}!D${findingDataStart}:D${findingDataEnd},"Critical")`, v: summary.findingsSummary.bySeverity.Critical, s: XLSX_STYLE.KPI_VALUE }
      : { v: 0, s: XLSX_STYLE.KPI_VALUE },
    hasRealFindings
      ? { f: `COUNTIF(${fSheet}!D${findingDataStart}:D${findingDataEnd},"High")`, v: summary.findingsSummary.bySeverity.High, s: XLSX_STYLE.KPI_VALUE }
      : { v: 0, s: XLSX_STYLE.KPI_VALUE },
    hasRealTests
      ? { f: `COUNTIF(${tSheet}!F${testDataStart}:F${testDataEnd},"PASS")`, v: summary.testsSummary.pass, s: XLSX_STYLE.KPI_VALUE }
      : { v: 0, s: XLSX_STYLE.KPI_VALUE },
    hasRealTests
      ? { f: `COUNTIF(${tSheet}!F${testDataStart}:F${testDataEnd},"FAIL")`, v: summary.testsSummary.fail, s: summary.testsSummary.fail > 0 ? XLSX_STYLE.BADGE_FAIL : XLSX_STYLE.KPI_VALUE }
      : { v: 0, s: XLSX_STYLE.KPI_VALUE },
    hasRealTests
      ? {
          f: `ROUND(COUNTIF(${tSheet}!F${testDataStart}:F${testDataEnd},"PASS")/COUNTA(${tSheet}!F${testDataStart}:F${testDataEnd})*100,2)`,
          v: summary.testsSummary.total > 0 ? Math.round((summary.testsSummary.pass / summary.testsSummary.total) * 10000) / 100 : 100,
          s: XLSX_STYLE.KPI_VALUE,
        }
      : { v: 100, s: XLSX_STYLE.KPI_VALUE },
  ];

  const dashboardRows = [
    {
      cells: [`TỔNG QUAN CHẤT LƯỢNG CI & KIỂM TOÁN TỰ ĐỘNG — CORE FRAMEWORK (${overallText})`],
      mergeFullWidth: true,
      defaultStyle: XLSX_STYLE.TITLE,
      height: 30,
    },
    {
      cells: [
        `Nhánh: ${summary.git.branch} @ ${summary.git.sha}  |  Ngày giờ: ${summary.generatedAt}  |  Tác giả commit: ${summary.git.author}  |  Run: ${summary.git.runUrl}  |  Số liệu tự động tính bằng công thức từ các sheet chi tiết`,
      ],
      mergeFullWidth: true,
      defaultStyle: XLSX_STYLE.SUBTITLE,
      height: 24,
    },
    { cells: [''], height: 10 },
    { cells: kpiLabels, defaultStyle: XLSX_STYLE.KPI_LABEL, height: 22 },
    { cells: kpiValues, defaultStyle: XLSX_STYLE.KPI_VALUE, height: 28 },
    { cells: [''], height: 12 },
    // Bảng 1: Chi tiết từng Quality Gate / Pipeline Step
    {
      cells: ['1. KẾT QUẢ CHI TIẾT TỪNG QUALITY GATE / BƯỚC CI'],
      mergeFullWidth: true,
      defaultStyle: XLSX_STYLE.SECTION,
      height: 24,
    },
    {
      cells: ['#', 'Quality Gate / Bước CI', 'Trạng thái', 'Thời gian', 'Lỗi (FAIL)', 'Cảnh báo', 'Ghi chú / Kết quả', '', '', ''],
      merges: [[6, 9]],
      defaultStyle: XLSX_STYLE.HEADER,
      height: 22,
    },
  ];

  const gateStatsMap = new Map();
  for (const f of findings) {
    const cur = gateStatsMap.get(f.gate) ?? { fail: 0, warn: 0 };
    if (f.status === 'FAIL') cur.fail++;
    else if (f.status === 'WARN') cur.warn++;
    gateStatsMap.set(f.gate, cur);
  }

  for (let i = 0; i < summary.steps.length; i++) {
    const s = summary.steps[i];
    const upperSt = String(s.status ?? 'unknown').toUpperCase();
    const displaySt = upperSt === 'PASSED' ? 'PASS' : upperSt === 'FAILED' ? 'FAIL' : upperSt;
    dashboardRows.push({
      cells: [
        i + 1,
        s.name,
        displaySt,
        formatDuration(s.durationMs),
        displaySt === 'FAIL' ? 'Xem Sheet 2' : 0,
        '-',
        s.detail ?? '-',
        '',
        '',
        '',
      ],
      merges: [[6, 9]],
      centerCols: [0, 2, 3, 4, 5],
      statusCols: [2],
      height: 22,
    });
  }

  // Bảng 2: Thống kê lỗi & cảnh báo theo Tác giả dòng mã (git blame)
  dashboardRows.push({ cells: [''], height: 12 });
  dashboardRows.push({
    cells: ['2. THỐNG KÊ LỖI & CẢNH BÁO THEO TÁC GIẢ DÒNG MÃ (Tự động bằng COUNTIFS từ git blame)'],
    mergeFullWidth: true,
    defaultStyle: XLSX_STYLE.SECTION,
    height: 24,
  });
  dashboardRows.push({
    cells: [
      'Tác giả (git blame)',
      'Critical',
      'High',
      'Medium',
      'Low',
      'Tổng Lỗi (FAIL)',
      'Tổng Cảnh báo (WARN)',
      'Info',
      'Tổng mục',
      'Trạng thái',
    ],
    defaultStyle: XLSX_STYLE.HEADER,
    height: 22,
  });

  const authors = Array.from(new Set(findings.map((f) => f.author))).sort();
  if (authors.length === 0) {
    dashboardRows.push({
      cells: ['Không có lỗi / cảnh báo nào', 0, 0, 0, 0, 0, 0, 0, 0, 'PASS'],
      centerCols: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      statusCols: [9],
      height: 22,
    });
  } else {
    const authorStartRow = dashboardRows.length + 1;
    for (const author of authors) {
      const aItems = findings.filter((f) => f.author === author);
      const cCrit = aItems.filter((f) => f.severity === 'Critical').length;
      const cHigh = aItems.filter((f) => f.severity === 'High').length;
      const cMed = aItems.filter((f) => f.severity === 'Medium').length;
      const cLow = aItems.filter((f) => f.severity === 'Low').length;
      const cFail = aItems.filter((f) => f.status === 'FAIL').length;
      const cWarn = aItems.filter((f) => f.status === 'WARN').length;
      const cInfo = aItems.filter((f) => f.status === 'INFO').length;
      const rowExcelIdx = dashboardRows.length + 1;
      const safeAuthorRef = `A${rowExcelIdx}`;
      dashboardRows.push({
        cells: [
          author,
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"Critical")`, v: cCrit },
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"High")`, v: cHigh },
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"Medium")`, v: cMed },
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"Low")`, v: cLow },
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$C$${findingDataStart}:$C$${findingDataEnd},"FAIL")`, v: cFail },
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$C$${findingDataStart}:$C$${findingDataEnd},"WARN")`, v: cWarn },
          { f: `COUNTIFS(${fSheet}!$J$${findingDataStart}:$J$${findingDataEnd},${safeAuthorRef},${fSheet}!$C$${findingDataStart}:$C$${findingDataEnd},"INFO")`, v: cInfo },
          { f: `SUM(B${rowExcelIdx}:E${rowExcelIdx})`, v: aItems.length },
          cFail > 0 ? 'FAIL' : cWarn > 0 ? 'WARN' : 'PASS',
        ],
        centerCols: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        statusCols: [9],
        height: 21,
      });
    }
    const authorEndRow = dashboardRows.length;
    dashboardRows.push({
      cells: [
        { v: 'TỔNG CỘNG', s: XLSX_STYLE.TOTAL_LEFT },
        { f: `SUM(B${authorStartRow}:B${authorEndRow})`, v: summary.findingsSummary.bySeverity.Critical, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(C${authorStartRow}:C${authorEndRow})`, v: summary.findingsSummary.bySeverity.High, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(D${authorStartRow}:D${authorEndRow})`, v: summary.findingsSummary.bySeverity.Medium, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(E${authorStartRow}:E${authorEndRow})`, v: summary.findingsSummary.bySeverity.Low, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(F${authorStartRow}:F${authorEndRow})`, v: summary.findingsSummary.fail, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(G${authorStartRow}:G${authorEndRow})`, v: summary.findingsSummary.warn, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(H${authorStartRow}:H${authorEndRow})`, v: summary.findingsSummary.info, s: XLSX_STYLE.TOTAL_CENTER },
        { f: `SUM(I${authorStartRow}:I${authorEndRow})`, v: summary.findingsSummary.total, s: XLSX_STYLE.TOTAL_CENTER },
        { v: summary.findingsSummary.fail > 0 ? 'FAIL' : 'PASS', s: summary.findingsSummary.fail > 0 ? XLSX_STYLE.BADGE_FAIL : XLSX_STYLE.BADGE_PASS },
      ],
      height: 22,
    });
  }

  // Bảng 3: Thống kê theo Mức độ nghiêm trọng
  dashboardRows.push({ cells: [''], height: 12 });
  dashboardRows.push({
    cells: ['3. THỐNG KÊ THEO MỨC ĐỘ NGHIÊM TRỌNG & NHÓM CÔNG CỤ'],
    mergeFullWidth: true,
    defaultStyle: XLSX_STYLE.SECTION,
    height: 24,
  });
  dashboardRows.push({
    cells: ['Mức độ', 'Số lượng', 'Lỗi chặn merge (FAIL)', 'Cảnh báo (WARN)', 'Thông tin (INFO)', 'Ý nghĩa / Quy định CI', '', '', '', ''],
    merges: [[5, 9]],
    defaultStyle: XLSX_STYLE.HEADER,
    height: 22,
  });
  const sevDescriptions = [
    ['Critical', 'Lỗi nghiêm trọng (TypeScript, Test fail, Architecture violation, OpenAPI Breaking Change, Lockfile) — CHẶN MERGE'],
    ['High', 'Lỗi chất lượng cao (ESLint error, Oxlint error) — CHẶN MERGE'],
    ['Medium', 'Cảnh báo trung bình (no-explicit-any, FE hardcode) — cần dọn dần để giữ code sạch'],
    ['Low', 'Cảnh báo nhẹ / Thông tin (Prettier format, exhaustive-deps, OpenAPI additive changes)'],
  ];
  for (const [sev, desc] of sevDescriptions) {
    const sItems = findings.filter((f) => f.severity === sev);
    dashboardRows.push({
      cells: [
        sev,
        hasRealFindings
          ? { f: `COUNTIF(${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"${sev}")`, v: sItems.length }
          : 0,
        hasRealFindings
          ? { f: `COUNTIFS(${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"${sev}",${fSheet}!$C$${findingDataStart}:$C$${findingDataEnd},"FAIL")`, v: sItems.filter((f) => f.status === 'FAIL').length }
          : 0,
        hasRealFindings
          ? { f: `COUNTIFS(${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"${sev}",${fSheet}!$C$${findingDataStart}:$C$${findingDataEnd},"WARN")`, v: sItems.filter((f) => f.status === 'WARN').length }
          : 0,
        hasRealFindings
          ? { f: `COUNTIFS(${fSheet}!$D$${findingDataStart}:$D$${findingDataEnd},"${sev}",${fSheet}!$C$${findingDataStart}:$C$${findingDataEnd},"INFO")`, v: sItems.filter((f) => f.status === 'INFO').length }
          : 0,
        desc,
        '',
        '',
        '',
        '',
      ],
      merges: [[5, 9]],
      centerCols: [0, 1, 2, 3, 4],
      statusCols: [0],
      height: 22,
    });
  }

  const sheets = [
    {
      name: 'Tong_Quan_CI',
      colCount: 10,
      colWidths: [24, 16, 16, 14, 15, 16, 18, 13, 14, 18],
      freezeRow: 2,
      customRows: dashboardRows,
    },

    // ========================================================================
    // Sheet 2: Chi_Tiet_Loi_Canh_Bao (Có AutoFilter, code snippet, git blame)
    // ========================================================================
    {
      name: fSheet,
      title: `DANH SÁCH CHI TIẾT LỖI & CẢNH BÁO CI — ${summary.git.branch} @ ${summary.git.sha}`,
      subtitle: `Truy vết tự động từ ESLint, Prettier, TypeScript, Architecture, OpenAPI, Lockfile, Jest/Vitest & git blame. Dùng bộ lọc (AutoFilter) trên dòng tiêu đề để lọc theo Trạng thái / Mức độ / Gate / Tác giả.`,
      headers: [
        '#',
        'Mã mục',
        'Trạng thái',
        'Mức độ',
        'Công cụ / Gate',
        'Phân hệ',
        'Chỗ trong mã (File:Line)',
        'Minh chứng (Đoạn mã nguồn & Chi tiết lỗi)',
        'Quy tắc / Rule',
        'Tác giả dòng mã (git blame)',
        'Commit',
        'Thời gian commit',
        'Đề xuất sửa nhanh',
      ],
      colWidths: [6, 11, 12, 12, 18, 16, 36, 54, 24, 20, 13, 18, 42],
      centerCols: [0, 1, 2, 3, 5, 10, 11],
      statusCols: [2, 3],
      codeCols: [6, 7],
      rows:
        findings.length > 0
          ? findings.map((item, idx) => [
              idx + 1,
              item.code,
              item.status,
              item.severity,
              item.gate,
              item.module,
              item.location,
              item.evidence,
              item.rule,
              item.author,
              item.commit,
              item.commitDate,
              item.suggestion,
            ])
          : [
              [
                1,
                'ALL-00',
                'PASS',
                'Low',
                'Tất cả Quality Gates',
                'core',
                '-',
                'Không phát hiện bất kỳ lỗi (FAIL) hay cảnh báo (WARN) nào trên toàn hệ thống.',
                '-',
                summary.git.author,
                summary.git.sha,
                summary.generatedAt.slice(0, 16).replace('T', ' '),
                'Không cần xử lý.',
              ],
            ],
    },

    // ========================================================================
    // Sheet 3: Chi_Tiet_Test_Suites (Từng test case PASS / FAIL / SKIPPED)
    // ========================================================================
    {
      name: tSheet,
      title: `CHI TIẾT TỪNG TEST CASE (UNIT, FEATURE, LIVE DB+REDIS & FRONTEND VITEST)`,
      subtitle: `Tổng số: ${summary.testsSummary.total} test cases | PASS: ${summary.testsSummary.pass} | FAIL: ${summary.testsSummary.fail} | SKIPPED: ${summary.testsSummary.skipped}. Dùng AutoFilter cột Trạng thái để lọc nhanh các test FAIL hoặc chậm.`,
      headers: [
        '#',
        'Nhóm Test',
        'Phân hệ',
        'Tệp kiểm thử',
        'Tên Test Case',
        'Trạng thái',
        'Thời gian (ms)',
        'Chi tiết lỗi (nếu FAIL)',
      ],
      colWidths: [6, 22, 18, 38, 52, 12, 14, 52],
      centerCols: [0, 2, 5, 6],
      statusCols: [5],
      codeCols: [3, 7],
      rows:
        testCases.length > 0
          ? testCases.map((tc, idx) => [
              idx + 1,
              tc.group,
              tc.module,
              tc.file,
              tc.title,
              tc.status,
              tc.durationMs,
              tc.error,
            ])
          : [
              [
                1,
                'All Test Suites',
                'core',
                '-',
                'Chưa có artifact kết quả JSON chi tiết từ Jest/Vitest (xem trạng thái tổng ở Sheet 1).',
                'SKIPPED',
                0,
                '-',
              ],
            ],
    },
  ];

  // ==========================================================================
  // Sheet 4: Do_Phu_Theo_Module (Backend Module Coverage chi tiết)
  // ==========================================================================
  const coverage = summary.details.coverage;
  if (coverage?.overall) {
    const covRows = (coverage.items ?? []).map((item, idx) => {
      const linePct = Number(item.lines?.pct ?? 0);
      const rating = linePct >= 75 ? 'TỐT' : linePct >= 50 ? 'ĐẠT' : 'CẦN BỔ SUNG';
      return [
        idx + 1,
        item.key,
        item.category,
        item.fileCount,
        `${Number(item.statements?.pct ?? 0).toFixed(2)}%`,
        `${Number(item.branches?.pct ?? 0).toFixed(2)}%`,
        `${Number(item.functions?.pct ?? 0).toFixed(2)}%`,
        `${linePct.toFixed(2)}%`,
        rating,
      ];
    });
    const totalLinePct = Number(coverage.overall.lines?.pct ?? 0);
    covRows.push([
      '-',
      'TỔNG CỘNG (ALL MODULES)',
      'overall',
      coverage.totalFiles ?? covRows.length,
      `${Number(coverage.overall.statements?.pct ?? 0).toFixed(2)}%`,
      `${Number(coverage.overall.branches?.pct ?? 0).toFixed(2)}%`,
      `${Number(coverage.overall.functions?.pct ?? 0).toFixed(2)}%`,
      `${totalLinePct.toFixed(2)}%`,
      totalLinePct >= 75 ? 'TỐT' : totalLinePct >= 50 ? 'ĐẠT' : 'CẦN BỔ SUNG',
    ]);
    sheets.push({
      name: 'Do_Phu_Theo_Module',
      title: 'BÁO CÁO ĐỘ PHỦ KIỂM THỬ THEO MODULE & PACKAGE (BACKEND)',
      subtitle: `Tổng số tệp nguồn: ${coverage.totalFiles ?? 0} | Lines: ${totalLinePct.toFixed(2)}% | Statements: ${Number(coverage.overall.statements?.pct ?? 0).toFixed(2)}% | Ngưỡng đánh giá: >=75% TỐT, 50-75% ĐẠT, <50% CẦN BỔ SUNG`,
      headers: [
        '#',
        'Module / Package',
        'Phân nhóm',
        'Số tệp',
        'Statements %',
        'Branches %',
        'Functions %',
        'Lines %',
        'Đánh giá',
      ],
      colWidths: [6, 30, 16, 10, 15, 15, 15, 15, 16],
      centerCols: [0, 2, 3, 4, 5, 6, 7, 8],
      statusCols: [8],
      totalLastRow: true,
      rows: covRows,
    });
  }

  return buildMultiSheetXlsxBuffer(sheets);
}

function runLocalStep(name, command, commandArgs, cwd) {
  console.log(`\n▶ [ci-report] Running: ${name}`);
  const startedAt = Date.now();
  const res = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  const durationMs = Date.now() - startedAt;
  const passed = res.status === 0;
  return {
    name,
    status: passed ? 'passed' : 'failed',
    durationMs,
    detail: passed ? 'OK' : `Exited with code ${res.status ?? 1}`,
  };
}

async function runMode(outDir) {
  const includeLive = args.includes('--live');
  const skipFe = args.includes('--skip-fe');
  const collector = path.join(repoRoot, 'scripts/ci/collect-ci-findings.mjs');
  const lockReport = path.join(outDir, 'lockfile-report.json');
  const prettierReport = path.join(outDir, 'prettier-report.json');
  const eslintReport = path.join(outDir, 'eslint-report.json');
  const typecheckBeReport = path.join(outDir, 'typecheck-be-report.json');
  const archReport = path.join(outDir, 'arch-report.json');
  const openApiReport = path.join(outDir, 'openapi-report.json');
  const jestMainReport = path.join(outDir, 'jest-results.json');
  const jestLiveReport = path.join(outDir, 'jest-live-results.json');
  const feOxlintReport = path.join(outDir, 'fe-oxlint-report.json');
  const feHardcodeReport = path.join(outDir, 'fe-hardcode-report.json');
  const typecheckFeReport = path.join(outDir, 'typecheck-fe-report.json');
  const vitestReport = path.join(outDir, 'vitest-results.json');
  const backendDir = path.join(repoRoot, 'backend');
  const frontendDir = path.join(repoRoot, 'frontend');

  const steps = [];
  steps.push(
    runLocalStep(
      'Lockfile Integrity Check',
      process.execPath,
      [path.join(repoRoot, 'scripts/ci/check-lockfiles.mjs'), '--report', lockReport],
      repoRoot,
    ),
  );
  steps.push(
    runLocalStep(
      'Config & Script Syntax Validation',
      'bash',
      [path.join(repoRoot, 'scripts/ci/validate-configs.sh')],
      repoRoot,
    ),
  );
  steps.push(
    runLocalStep(
      'Backend Format Check (Prettier)',
      process.execPath,
      [collector, '--capture', 'prettier', '--cwd', 'backend', '--out', prettierReport, '--', 'npx', 'prettier', '--list-different', 'src/**/*.ts', 'test/**/*.ts'],
      repoRoot,
    ),
  );
  steps.push(
    runLocalStep(
      'Backend ESLint Check',
      'npx',
      ['eslint', '{src,test}/**/*.ts', '-f', 'json', '-o', eslintReport],
      backendDir,
    ),
  );
  steps.push(
    runLocalStep(
      'Backend TypeScript Typecheck',
      process.execPath,
      [collector, '--capture', 'tsc-be', '--cwd', 'backend', '--out', typecheckBeReport, '--', 'npx', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
      repoRoot,
    ),
  );
  const buildStep = runLocalStep('Backend Build (ESM + tsc-alias)', 'npm', ['run', 'build'], backendDir);
  steps.push(buildStep);

  if (buildStep.status === 'passed') {
    steps.push(
      runLocalStep(
        'Architecture Boundary Check',
        'npm',
        ['run', 'cli', '--', 'arch:check', '--report', archReport],
        backendDir,
      ),
    );
    steps.push(
      runLocalStep(
        'OpenAPI Breaking Change Check',
        process.execPath,
        [path.join(repoRoot, 'scripts/ci/check-api-changes.mjs'), '--report', openApiReport],
        repoRoot,
      ),
    );
  } else {
    steps.push({ name: 'Architecture Boundary Check', status: 'skipped', detail: 'Skipped because build failed' });
    steps.push({ name: 'OpenAPI Breaking Change Check', status: 'skipped', detail: 'Skipped because build failed' });
  }

  steps.push(
    runLocalStep(
      'Backend Unit & Feature Tests (with Coverage)',
      'npm',
      ['run', 'test:cov:module', '--', '--json', `--outputFile=${jestMainReport}`],
      backendDir,
    ),
  );

  if (includeLive) {
    steps.push(
      runLocalStep(
        'Backend Live Integration & API Tests (DB + Redis)',
        'npm',
        ['run', 'test:integration:live', '--', '--json', `--outputFile=${jestLiveReport}`],
        backendDir,
      ),
    );
  } else {
    steps.push({
      name: 'Backend Live Integration & API Tests (DB + Redis)',
      status: 'skipped',
      detail: 'Pass --live when Postgres & Redis test services are running',
    });
  }

  if (!skipFe) {
    steps.push(
      runLocalStep(
        'Frontend Oxlint Check',
        process.execPath,
        [collector, '--capture', 'fe-oxlint', '--cwd', 'frontend', '--out', feOxlintReport, '--', 'npx', 'oxlint', '--format', 'json'],
        repoRoot,
      ),
    );
    steps.push(
      runLocalStep(
        'Frontend Hardcode Gate',
        process.execPath,
        [collector, '--capture', 'fe-hardcode', '--cwd', 'frontend', '--out', feHardcodeReport, '--', 'node', 'scripts/check-hardcode.mjs'],
        repoRoot,
      ),
    );
    steps.push(
      runLocalStep(
        'Frontend TypeScript Typecheck',
        process.execPath,
        [collector, '--capture', 'tsc-fe', '--cwd', 'frontend', '--out', typecheckFeReport, '--', 'npx', 'tsc', '-b', '--noEmit'],
        repoRoot,
      ),
    );
    steps.push(
      runLocalStep(
        'Frontend Unit Tests (Vitest)',
        'npx',
        ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${vitestReport}`],
        frontendDir,
      ),
    );
  } else {
    steps.push({ name: 'Frontend Quality Checks', status: 'skipped', detail: 'Skipped via --skip-fe' });
  }

  return {
    mode: 'local-runner',
    steps,
    detailPaths: {
      lockfile: lockReport,
      prettier: prettierReport,
      eslint: eslintReport,
      typecheckBe: typecheckBeReport,
      architecture: archReport,
      openapi: openApiReport,
      jestMain: jestMainReport,
      jestLive: jestLiveReport,
      feOxlint: feOxlintReport,
      feHardcode: feHardcodeReport,
      typecheckFe: typecheckFeReport,
      vitest: vitestReport,
      coverage: path.join(backendDir, 'coverage', 'module-coverage-summary.json'),
      securitySecrets: path.join(outDir, 'security-secrets-report.json'),
      securityDeps: path.join(outDir, 'security-deps-report.json'),
      securitySast: path.join(outDir, 'security-sast-report.json'),
      securityIac: path.join(outDir, 'security-iac-report.json'),
      securityLicenses: path.join(outDir, 'security-license-report.json'),
      securityDocker: path.join(outDir, 'security-docker-report.json'),
      securitySbom: path.join(outDir, 'security-sbom-report.json'),
      securityDast: path.join(outDir, 'security-dast-report.json'),
    },
  };
}

function summarizeMode() {
  const stepEntries = getAllFlagValues('--step').map((raw) => {
    const sep = raw.lastIndexOf('=');
    const name = sep >= 0 ? raw.slice(0, sep).trim() : raw.trim();
    const status = normalizeStatus(sep >= 0 ? raw.slice(sep + 1) : 'unknown');
    return { name, status, detail: status === 'failed' ? 'Gate failed — xem chi tiết tại Sheet 2 & Sheet 3' : 'OK' };
  });

  return {
    mode: 'ci-summary',
    steps: stepEntries,
    detailPaths: {
      lockfile: getFlagValue('--lockfile-report') ?? 'reports/lockfile-report.json',
      prettier: getFlagValue('--prettier-report') ?? 'reports/prettier-report.json',
      eslint: getFlagValue('--eslint-report') ?? 'reports/eslint-report.json',
      typecheckBe: getFlagValue('--typecheck-be-report') ?? 'reports/typecheck-be-report.json',
      architecture: getFlagValue('--arch-report') ?? 'reports/arch-report.json',
      openapi: getFlagValue('--openapi-report') ?? 'reports/openapi-report.json',
      jestMain: getFlagValue('--jest-report') ?? 'reports/jest-results.json',
      jestLive: getFlagValue('--jest-live-report') ?? 'reports/jest-live-results.json',
      feOxlint: getFlagValue('--fe-oxlint-report') ?? 'reports/fe-oxlint-report.json',
      feHardcode: getFlagValue('--fe-hardcode-report') ?? 'reports/fe-hardcode-report.json',
      typecheckFe: getFlagValue('--typecheck-fe-report') ?? 'reports/typecheck-fe-report.json',
      vitest: getFlagValue('--vitest-report') ?? 'reports/vitest-results.json',
      coverage: getFlagValue('--coverage-report') ?? 'backend/coverage/module-coverage-summary.json',
      securitySecrets: getFlagValue('--security-secrets-report') ?? 'reports/security-secrets-report.json',
      securityDeps: getFlagValue('--security-deps-report') ?? 'reports/security-deps-report.json',
      securitySast: getFlagValue('--security-sast-report') ?? 'reports/security-sast-report.json',
      securityIac: getFlagValue('--security-iac-report') ?? 'reports/security-iac-report.json',
      securityLicenses: getFlagValue('--security-license-report') ?? 'reports/security-license-report.json',
      securityDocker: getFlagValue('--security-docker-report') ?? 'reports/security-docker-report.json',
      securitySbom: getFlagValue('--security-sbom-report') ?? 'reports/security-sbom-report.json',
      securityDast: getFlagValue('--security-dast-report') ?? 'reports/security-dast-report.json',
    },
  };
}

async function main() {
  const outDirArg = getFlagValue('--out-dir') ?? 'reports';
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(repoRoot, outDirArg);
  const searchDir = getFlagValue('--search-dir') ?? null;
  await fs.mkdir(outDir, { recursive: true });

  const isRun = args.includes('--run');
  const result = isRun ? await runMode(outDir) : summarizeMode();

  const details = {
    lockfile: await readJsonSafe(result.detailPaths.lockfile, searchDir, 'lockfile-report.json'),
    prettier: await readJsonSafe(result.detailPaths.prettier, searchDir, 'prettier-report.json'),
    eslint: await readJsonSafe(result.detailPaths.eslint, searchDir, 'eslint-report.json'),
    typecheckBe: await readJsonSafe(result.detailPaths.typecheckBe, searchDir, 'typecheck-be-report.json'),
    architecture: await readJsonSafe(result.detailPaths.architecture, searchDir, 'arch-report.json'),
    openapi: await readJsonSafe(result.detailPaths.openapi, searchDir, 'openapi-report.json'),
    jestMain: await readJsonSafe(result.detailPaths.jestMain, searchDir, 'jest-results.json'),
    jestLive: await readJsonSafe(result.detailPaths.jestLive, searchDir, 'jest-live-results.json'),
    feOxlint: await readJsonSafe(result.detailPaths.feOxlint, searchDir, 'fe-oxlint-report.json'),
    feHardcode: await readJsonSafe(result.detailPaths.feHardcode, searchDir, 'fe-hardcode-report.json'),
    typecheckFe: await readJsonSafe(result.detailPaths.typecheckFe, searchDir, 'typecheck-fe-report.json'),
    vitest: await readJsonSafe(result.detailPaths.vitest, searchDir, 'vitest-results.json'),
    coverage: await readJsonSafe(result.detailPaths.coverage, searchDir, 'module-coverage-summary.json'),
    securitySecrets: await readJsonSafe(result.detailPaths.securitySecrets, searchDir, 'security-secrets-report.json'),
    securityDeps: await readJsonSafe(result.detailPaths.securityDeps, searchDir, 'security-deps-report.json'),
    securitySast: await readJsonSafe(result.detailPaths.securitySast, searchDir, 'security-sast-report.json'),
    securityIac: await readJsonSafe(result.detailPaths.securityIac, searchDir, 'security-iac-report.json'),
    securityLicenses: await readJsonSafe(result.detailPaths.securityLicenses, searchDir, 'security-license-report.json'),
    securityDocker: await readJsonSafe(result.detailPaths.securityDocker, searchDir, 'security-docker-report.json'),
    securitySbom: await readJsonSafe(result.detailPaths.securitySbom, searchDir, 'security-sbom-report.json'),
    securityDast: await readJsonSafe(result.detailPaths.securityDast, searchDir, 'security-dast-report.json'),
  };

  if (args.includes('--infer-from-artifacts') && result.steps.length === 0) {
    result.steps.push({
      name: 'Lockfile Integrity Check',
      status: details.lockfile ? (details.lockfile.passed ? 'passed' : 'failed') : 'skipped',
      detail: details.lockfile ? `${(details.lockfile.targets ?? []).length} lockfile(s) verified` : 'No artifact',
    });
    result.steps.push({
      name: 'Backend Format & ESLint',
      status: details.eslint || details.prettier ? (details.prettier?.passed === false ? 'failed' : 'passed') : 'skipped',
      detail: details.eslint ? `${details.eslint.length} file(s) linted` : 'No artifact',
    });
    result.steps.push({
      name: 'Architecture Boundary Check',
      status: details.architecture ? (details.architecture.passed ? 'passed' : 'failed') : 'skipped',
      detail: details.architecture ? `${details.architecture.violationCount ?? 0} violation(s)` : 'No artifact',
    });
    result.steps.push({
      name: 'OpenAPI Breaking Change Check',
      status: details.openapi ? (details.openapi.passed ? 'passed' : 'failed') : 'skipped',
      detail: details.openapi ? `${details.openapi.breakingCount ?? 0} breaking, ${details.openapi.nonBreakingCount ?? 0} non-breaking` : 'No artifact',
    });
    result.steps.push({
      name: 'Backend Module Coverage',
      status: details.coverage?.overall ? 'passed' : 'skipped',
      detail: details.coverage?.overall ? `Lines ${Number(details.coverage.overall.lines?.pct ?? 0).toFixed(2)}%` : 'No artifact',
    });
    if (details.securitySecrets) {
      result.steps.push({
        name: 'Security Secret Scan',
        status: details.securitySecrets.passed ? 'passed' : 'failed',
        detail: `${details.securitySecrets.findingCount ?? 0} secret finding(s)`,
      });
    }
    if (details.securityDeps) {
      result.steps.push({
        name: 'Security Dependency Audit (SLA)',
        status: details.securityDeps.passed ? 'passed' : 'failed',
        detail: `${details.securityDeps.summary?.fail ?? 0} blocking, ${details.securityDeps.summary?.warn ?? 0} warn`,
      });
    }
    if (details.securitySast) {
      result.steps.push({
        name: 'Security SAST Scan',
        status: details.securitySast.passed ? 'passed' : 'failed',
        detail: `${details.securitySast.summary?.fail ?? 0} blocking, ${details.securitySast.summary?.warn ?? 0} warn`,
      });
    }
    if (details.securityIac) {
      result.steps.push({
        name: 'Security IaC Config Scan',
        status: details.securityIac.passed ? 'passed' : 'failed',
        detail: `${details.securityIac.summary?.fail ?? 0} blocking, ${details.securityIac.summary?.warn ?? 0} warn`,
      });
    }
    if (details.securityLicenses) {
      result.steps.push({
        name: 'Security License Compliance',
        status: details.securityLicenses.passed ? 'passed' : 'failed',
        detail: `${details.securityLicenses.summary?.totalPackages ?? 0} pkgs (${details.securityLicenses.summary?.fail ?? 0} denied)`,
      });
    }
    if (details.securitySbom) {
      result.steps.push({
        name: 'Security SBOM Generation (CycloneDX)',
        status: details.securitySbom.passed ? 'passed' : 'failed',
        detail: `v${details.securitySbom.releaseVersion} (${details.securitySbom.totalUniqueComponents ?? 0} components)`,
      });
    }
    if (details.securityDocker) {
      result.steps.push({
        name: 'Security Docker Image Scan',
        status: details.securityDocker.passed ? 'passed' : 'failed',
        detail: `${details.securityDocker.summary?.fail ?? 0} blocking CVE(s)`,
      });
    }
  }

  const { findings, testCases } = collectNormalizedArtifacts(details);

  const counts = {
    passed: result.steps.filter((s) => s.status === 'passed').length,
    failed: result.steps.filter((s) => s.status === 'failed' || s.status === 'cancelled').length,
    skipped: result.steps.filter((s) => s.status === 'skipped').length,
  };
  const failedSteps = result.steps.filter((s) => s.status === 'failed' || s.status === 'cancelled');

  const findingsSummary = {
    total: findings.length,
    fail: findings.filter((f) => f.status === 'FAIL').length,
    warn: findings.filter((f) => f.status === 'WARN').length,
    info: findings.filter((f) => f.status === 'INFO').length,
    bySeverity: {
      Critical: findings.filter((f) => f.severity === 'Critical').length,
      High: findings.filter((f) => f.severity === 'High').length,
      Medium: findings.filter((f) => f.severity === 'Medium').length,
      Low: findings.filter((f) => f.severity === 'Low').length,
    },
  };

  const testsSummary = {
    total: testCases.length,
    pass: testCases.filter((t) => t.status === 'PASS').length,
    fail: testCases.filter((t) => t.status === 'FAIL').length,
    skipped: testCases.filter((t) => t.status === 'SKIPPED').length,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: result.mode,
    git: getGitContext(),
    passed: failedSteps.length === 0,
    counts,
    failedSteps,
    steps: result.steps,
    findingsSummary,
    testsSummary,
    findings,
    testCasesCount: testCases.length,
    testCases,
    details: {
      lockfile: details.lockfile,
      architecture: details.architecture,
      openapi: details.openapi,
      coverage: details.coverage,
      securitySbom: details.securitySbom,
      securityLicenses: details.securityLicenses,
      securityDeps: details.securityDeps,
    },
  };

  const jsonPath = path.join(outDir, 'ci-summary.json');
  const mdPath = path.join(outDir, 'ci-summary.md');
  const xlsxPath = path.join(outDir, 'ci-summary.xlsx');
  const markdown = buildMarkdownReport(summary);
  const xlsxBuffer = buildExcelWorkbook(summary);

  await fs.writeFile(jsonPath, `${JSON.stringify({ ...summary, testCases: undefined }, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, markdown, 'utf8');
  await fs.writeFile(xlsxPath, xlsxBuffer);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  }

  console.log('\n' + markdown);
  console.log(
    `[ci-report] Saved: ${path.relative(repoRoot, mdPath)}, ${path.relative(repoRoot, jsonPath)} & ${path.relative(repoRoot, xlsxPath)} (${findings.length} findings, ${testCases.length} test cases)`,
  );

  if (!summary.passed && !args.includes('--no-fail')) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ [ci-report] Unexpected error:', err);
  process.exit(1);
});
