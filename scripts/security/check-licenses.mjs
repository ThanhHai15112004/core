#!/usr/bin/env node
/**
 * 15.2.6 — Kiểm tra License dependency (SPDX Policy)
 *
 * - Đọc toàn bộ dependency từ `package-lock.json` (root, backend, frontend) và bổ sung từ `node_modules` nếu thiếu.
 * - Hỗ trợ biểu thức SPDX (`OR`, `AND`, `WITH`) theo đúng ngữ nghĩa:
 *     + `A OR B`: hợp lệ nếu ít nhất 1 nhánh được phép (allowed).
 *     + `A AND B`: vi phạm nếu bất kỳ nhánh bắt buộc nào nằm trong danh sách cấm (denied).
 * - Xuất JSON (`reports/security-license-report.json`) & SARIF (`reports/security-license.sarif`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  buildSarifReport,
  getFlagValue,
  loadSecurityPolicy,
  writeJsonReport,
} from './common.mjs';

function normalizeSpdxToken(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^\(+|\)+$/g, '')
    .trim();
}

export function evaluateSpdxExpression(rawLicense, licensePolicy) {
  const allowed = new Set((licensePolicy.allowed ?? []).map((x) => x.toLowerCase()));
  const denied = new Set((licensePolicy.denied ?? []).map((x) => x.toLowerCase()));
  const warnOn = new Set((licensePolicy.warnOn ?? []).map((x) => x.toLowerCase()));

  const expr = normalizeSpdxToken(rawLicense);
  if (!expr || expr.toUpperCase() === 'UNKNOWN' || expr.toUpperCase() === 'UNLICENSED') {
    return {
      decision: 'WARN',
      severity: 'Medium',
      reason: 'Không xác định được license SPDX của gói.',
    };
  }

  // Hỗ trợ nhánh OR (chỉ cần 1 nhánh allowed là chấp nhận)
  if (/\s+OR\s+/i.test(expr) && !/\s+AND\s+/i.test(expr)) {
    const branches = expr.split(/\s+OR\s+/i).map(normalizeSpdxToken);
    if (branches.some((b) => allowed.has(b.toLowerCase()))) {
      return { decision: 'ALLOW', severity: 'Low', reason: `Được phép qua nhánh OR (${expr})` };
    }
    if (branches.every((b) => denied.has(b.toLowerCase()))) {
      return { decision: 'DENY', severity: 'High', reason: `Tất cả nhánh đều thuộc license cấm (${expr})` };
    }
    return { decision: 'WARN', severity: 'Medium', reason: `License cần rà soát pháp lý (${expr})` };
  }

  // Hỗ trợ nhánh AND (mọi nhánh bắt buộc đều phải không thuộc denied)
  if (/\s+AND\s+/i.test(expr)) {
    const parts = expr.split(/\s+AND\s+/i).map(normalizeSpdxToken);
    for (const part of parts) {
      const sub = evaluateSpdxExpression(part, licensePolicy);
      if (sub.decision === 'DENY') return sub;
    }
    const allAllowed = parts.every((p) => evaluateSpdxExpression(p, licensePolicy).decision === 'ALLOW');
    return allAllowed
      ? { decision: 'ALLOW', severity: 'Low', reason: `Tất cả nhánh AND được phép (${expr})` }
      : { decision: 'WARN', severity: 'Medium', reason: `Biểu thức AND có thành phần cần rà soát (${expr})` };
  }

  const lower = expr.toLowerCase();
  if (allowed.has(lower)) {
    return { decision: 'ALLOW', severity: 'Low', reason: 'Thuộc danh sách license được phép.' };
  }
  if (denied.has(lower) || /^(?:a?gpl|sspl)-/i.test(expr)) {
    return {
      decision: 'DENY',
      severity: 'High',
      reason: `License copyleft mạnh / không tương thích chính sách thương mại (${expr}).`,
    };
  }
  if (warnOn.has(lower)) {
    return {
      decision: 'WARN',
      severity: 'Medium',
      reason: `License thuộc nhóm cần rà soát (${expr}).`,
    };
  }

  return {
    decision: 'WARN',
    severity: 'Medium',
    reason: `License chưa có trong allowlist (${expr}) — cần xác minh pháp lý.`,
  };
}

function readPackageLicenseFallback(workspaceDirAbs, pkgPathKey) {
  try {
    const pkgJsonPath = path.join(workspaceDirAbs, pkgPathKey, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (typeof pkg.license === 'string') return pkg.license;
    if (typeof pkg.license === 'object' && pkg.license?.type) return pkg.license.type;
    if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
      return pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean).join(' OR ');
    }
  } catch {
    return null;
  }
  return null;
}

export function extractPackageNameFromLockKey(pkgKey, entry) {
  if (entry?.name) return entry.name;
  const idx = pkgKey.lastIndexOf('node_modules/');
  return idx >= 0 ? pkgKey.slice(idx + 'node_modules/'.length) : pkgKey;
}

export function checkWorkspaceLicenses(workspaceName, workspaceDirRel, policy = loadSecurityPolicy()) {
  const licensePolicy = policy.licenses ?? {};
  const allowlistPkgs = new Set((licensePolicy.allowlistPackages ?? []).map((p) => String(p).toLowerCase()));
  const workspaceDirAbs = path.resolve(REPO_ROOT, workspaceDirRel);
  const lockfilePath = path.join(workspaceDirAbs, 'package-lock.json');
  const lockfileRel = workspaceDirRel === '.' ? 'package-lock.json' : `${workspaceDirRel}/package-lock.json`;

  if (!fs.existsSync(lockfilePath)) {
    return { workspace: workspaceName, totalPackages: 0, licenseCounts: {}, findings: [] };
  }

  const lock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const packages = lock.packages ?? {};
  const seen = new Set();
  const licenseCounts = {};
  const findings = [];
  let totalPackages = 0;

  for (const [pkgKey, entry] of Object.entries(packages)) {
    if (!pkgKey || entry?.link) continue;
    const name = extractPackageNameFromLockKey(pkgKey, entry);
    const version = entry?.version || '0.0.0';
    const uniq = `${name}@${version}`;
    if (seen.has(uniq)) continue;
    seen.add(uniq);
    totalPackages++;

    let rawLic = entry?.license;
    if (!rawLic) {
      rawLic = readPackageLicenseFallback(workspaceDirAbs, pkgKey) || 'UNKNOWN';
    }
    const licStr = typeof rawLic === 'string' ? rawLic.trim() : String(rawLic);
    licenseCounts[licStr] = (licenseCounts[licStr] ?? 0) + 1;

    if (allowlistPkgs.has(name.toLowerCase()) || allowlistPkgs.has(uniq.toLowerCase())) {
      continue;
    }

    const evaluation = evaluateSpdxExpression(licStr, licensePolicy);
    if (evaluation.decision === 'DENY' || evaluation.decision === 'WARN') {
      findings.push({
        rule: evaluation.decision === 'DENY' ? 'LICENSE-DENIED' : 'LICENSE-REVIEW',
        workspace: workspaceName,
        package: name,
        version,
        license: licStr,
        severity: evaluation.severity,
        status: evaluation.decision === 'DENY' ? 'FAIL' : 'WARN',
        category: 'License Compliance',
        file: lockfileRel,
        line: 1,
        message: `[${workspaceName}] ${name}@${version} sử dụng license \`${licStr}\` — ${evaluation.reason}`,
        remediation:
          evaluation.decision === 'DENY'
            ? 'Thay thế bằng thư viện có license tương thích (MIT/Apache-2.0/BSD/ISC).'
            : 'Kiểm tra license thực tế của gói; nếu hợp lệ thì bổ sung vào `licenses.allowed` hoặc `licenses.allowlistPackages` trong `security-policy.json`.',
      });
    }
  }

  return { workspace: workspaceName, totalPackages, licenseCounts, findings };
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-license-report.json';
  const sarifOut = getFlagValue(args, '--sarif') ?? 'reports/security-license.sarif';

  const workspaces = policy.licenses?.workspaces ?? [];
  const results = [];
  const findings = [];
  const aggregatedCounts = {};

  for (const ws of workspaces) {
    const res = checkWorkspaceLicenses(ws.name, ws.dir, policy);
    results.push({
      workspace: res.workspace,
      totalPackages: res.totalPackages,
      fail: res.findings.filter((f) => f.status === 'FAIL').length,
      warn: res.findings.filter((f) => f.status === 'WARN').length,
    });
    for (const [lic, cnt] of Object.entries(res.licenseCounts)) {
      aggregatedCounts[lic] = (aggregatedCounts[lic] ?? 0) + cnt;
    }
    findings.push(...res.findings);
  }

  const failCount = findings.filter((f) => f.status === 'FAIL').length;
  const warnCount = findings.filter((f) => f.status === 'WARN').length;
  const passed = failCount === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'Security License Compliance',
    workspaces: results,
    licenseDistribution: aggregatedCounts,
    summary: {
      totalPackages: results.reduce((sum, r) => sum + r.totalPackages, 0),
      fail: failCount,
      warn: warnCount,
    },
    passed,
    findings,
  };

  await writeJsonReport(reportOut, report);
  await writeJsonReport(sarifOut, buildSarifReport({ toolName: 'core-license-checker', findings }));

  if (!passed) {
    console.error(`\n✗ [security:licenses] PHÁT HIỆN ${failCount} GÓI VI PHẠM CHÍNH SÁCH LICENSE (warn=${warnCount}):`);
    for (const f of findings.filter((x) => x.status === 'FAIL').slice(0, 20)) {
      console.error(`  - [${f.severity}] ${f.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ [security:licenses] Kiểm tra License đạt yêu cầu (${report.summary.totalPackages} packages, fail=${failCount}, warn=${warnCount}).`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:licenses] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
