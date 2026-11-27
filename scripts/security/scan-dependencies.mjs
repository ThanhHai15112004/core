#!/usr/bin/env node
/**
 * 15.2.2 — Quét lỗ hổng Dependency có mức độ & thời hạn xử lý (SLA)
 *
 * - Quét `npm audit --json` trên 3 workspace: root, backend, frontend.
 * - Gắn mức độ (critical / high / moderate / low) và hạn SLA xử lý theo `security-policy.json`.
 * - Hỗ trợ kiểm tra waiver có ngày hết hạn (`expiresAt`): hết hạn sẽ tự động FAIL.
 * - Xuất JSON (`reports/security-deps-report.json`) & SARIF (`reports/security-deps.sarif`).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  buildSarifReport,
  getFlagValue,
  loadSecurityPolicy,
  normalizeSeverity,
  writeJsonReport,
} from './common.mjs';

export function computeSlaDueDate(severity, slaDaysMap, referenceDate = new Date()) {
  const key = String(severity ?? 'low').toLowerCase();
  const days = Number(slaDaysMap?.[key] ?? 90);
  const due = new Date(referenceDate.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    slaDays: days,
    slaDueDate: due.toISOString().slice(0, 10),
  };
}

export function evaluateWaivers(waivers = [], referenceDate = new Date()) {
  const active = new Map();
  const expired = [];
  const nowMs = referenceDate.getTime();

  for (const w of waivers) {
    if (!w?.id || !w?.expiresAt) continue;
    const expMs = Date.parse(w.expiresAt);
    if (!Number.isFinite(expMs) || expMs < nowMs) {
      expired.push(w);
    } else {
      active.set(String(w.id), w);
    }
  }
  return { active, expired };
}

export function evaluateAuditReport(workspaceName, workspaceDir, auditJson, policy, referenceDate = new Date()) {
  const depPolicy = policy.dependencyAudit ?? {};
  const slaDaysMap = depPolicy.slaDays ?? { critical: 1, high: 7, moderate: 30, low: 90 };
  const failSet = new Set((depPolicy.failOn ?? ['critical', 'high']).map((s) => s.toLowerCase()));
  const { active: activeWaivers } = evaluateWaivers(depPolicy.waivers ?? [], referenceDate);

  const findings = [];
  const seenAdvisories = new Set();
  const lockfileRel = workspaceDir === '.' ? 'package-lock.json' : `${workspaceDir}/package-lock.json`;
  const vulns = auditJson?.vulnerabilities ?? {};

  for (const [pkgName, info] of Object.entries(vulns)) {
    const rawSeverity = String(info?.severity ?? 'low').toLowerCase();
    const viaEntries = Array.isArray(info?.via) ? info.via.filter((v) => typeof v === 'object' && v !== null) : [];

    // Nếu package chỉ bị kéo gián tiếp không có advisory riêng, tạo 1 mục đại diện nếu là direct
    const advisories =
      viaEntries.length > 0
        ? viaEntries
        : info?.isDirect
          ? [{ source: `NPM:${pkgName}`, title: `Transitive vulnerability in ${pkgName}`, severity: rawSeverity, url: '' }]
          : [];

    for (const adv of advisories) {
      const advId = String(adv.source || adv.cve || `NPM-${pkgName}`);
      const dedupKey = `${workspaceName}:${pkgName}:${advId}`;
      if (seenAdvisories.has(dedupKey)) continue;
      seenAdvisories.add(dedupKey);
      const advSev = String(adv.severity || rawSeverity).toLowerCase();
      const { slaDays, slaDueDate } = computeSlaDueDate(advSev, slaDaysMap, referenceDate);
      const waiver = activeWaivers.get(advId) || activeWaivers.get(pkgName);

      const status = waiver ? 'INFO' : failSet.has(advSev) ? 'FAIL' : 'WARN';
      const fixText =
        typeof info.fixAvailable === 'object' && info.fixAvailable
          ? `Nâng cấp ${info.fixAvailable.name}@${info.fixAvailable.version}${info.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
          : info.fixAvailable === true
            ? 'Chạy `npm audit fix` để nâng cấp phiên bản vá lỗi.'
            : 'Theo dõi bản vá upstream hoặc đánh giá thay thế thư viện.';

      findings.push({
        rule: `DEP-CVE:${advId}`,
        advisoryId: advId,
        workspace: workspaceName,
        package: pkgName,
        installedRange: info.range || '*',
        isDirect: Boolean(info.isDirect),
        severity: normalizeSeverity(advSev),
        rawSeverity: advSev,
        status,
        category: 'Dependency Vulnerability',
        file: lockfileRel,
        line: 1,
        slaDays,
        slaDueDate,
        waived: Boolean(waiver),
        waiverExpiresAt: waiver?.expiresAt ?? null,
        advisoryUrl: adv.url || '',
        message: `[${workspaceName}] ${pkgName} (${advSev.toUpperCase()}, SLA ${slaDays}d — hạn ${slaDueDate}): ${adv.title || 'Lỗ hổng bảo mật dependency'}${waiver ? ` [Waived tới ${waiver.expiresAt}]` : ''}`,
        remediation: `${fixText}${adv.url ? ` (${adv.url})` : ''}`,
      });
    }
  }

  return findings;
}

function runNpmAuditForWorkspace(workspace) {
  const cwd = path.resolve(REPO_ROOT, workspace.dir);
  const lockfilePath = path.join(cwd, 'package-lock.json');
  if (!fs.existsSync(lockfilePath)) {
    return {
      workspace: workspace.name,
      available: false,
      error: 'Không tìm thấy package-lock.json',
      json: null,
    };
  }

  const res = spawnSync('npm', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });

  const rawStdout = (res.stdout ?? '').trim();
  if (!rawStdout) {
    return {
      workspace: workspace.name,
      available: false,
      error: (res.stderr ?? 'npm audit không trả về dữ liệu').trim().slice(0, 300),
      json: null,
    };
  }

  try {
    const parsed = JSON.parse(rawStdout);
    if (parsed?.error) {
      return {
        workspace: workspace.name,
        available: false,
        error: `${parsed.error.code || 'AUDIT_ERROR'}: ${parsed.error.summary || 'Không thể kết nối registry npm audit'}`,
        json: null,
      };
    }
    return { workspace: workspace.name, available: true, error: null, json: parsed };
  } catch (err) {
    return {
      workspace: workspace.name,
      available: false,
      error: `Không parse được JSON từ npm audit: ${String(err.message || err)}`,
      json: null,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-deps-report.json';
  const sarifOut = getFlagValue(args, '--sarif') ?? 'reports/security-deps.sarif';
  const strictNetwork = args.includes('--strict-network');
  const now = new Date();

  const depPolicy = policy.dependencyAudit ?? {};
  const { expired: expiredWaivers } = evaluateWaivers(depPolicy.waivers ?? [], now);

  const findings = [];
  const workspaceSummaries = [];

  for (const w of expiredWaivers) {
    findings.push({
      rule: 'DEP-WAIVER-EXPIRED',
      advisoryId: w.id,
      workspace: 'policy',
      package: w.package || w.id,
      severity: 'High',
      rawSeverity: 'high',
      status: 'FAIL',
      category: 'Dependency Vulnerability',
      file: 'scripts/security/security-policy.json',
      line: 1,
      slaDays: 0,
      slaDueDate: w.expiresAt,
      message: `Waiver lỗ hổng ${w.id} (${w.package || 'unknown'}) đã hết hạn từ ${w.expiresAt}.`,
      remediation: 'Nâng cấp gói bị ảnh hưởng hoặc rà soát/gia hạn waiver có phê duyệt mới.',
    });
  }

  for (const ws of depPolicy.workspaces ?? []) {
    const res = runNpmAuditForWorkspace(ws);
    if (!res.available) {
      workspaceSummaries.push({
        workspace: ws.name,
        available: false,
        error: res.error,
        total: 0,
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
      });
      if (strictNetwork) {
        findings.push({
          rule: 'DEP-AUDIT-UNAVAILABLE',
          workspace: ws.name,
          severity: 'High',
          rawSeverity: 'high',
          status: 'FAIL',
          category: 'Dependency Vulnerability',
          file: ws.dir === '.' ? 'package-lock.json' : `${ws.dir}/package-lock.json`,
          line: 1,
          message: `[${ws.name}] Không thể chạy npm audit: ${res.error}`,
          remediation: 'Kiểm tra kết nối tới npm registry hoặc chạy lại trên môi trường CI.',
        });
      }
      continue;
    }

    const wsFindings = evaluateAuditReport(ws.name, ws.dir, res.json, policy, now);
    findings.push(...wsFindings);

    const meta = res.json?.metadata?.vulnerabilities ?? {};
    workspaceSummaries.push({
      workspace: ws.name,
      available: true,
      error: null,
      total: Number(meta.total ?? wsFindings.length),
      critical: Number(meta.critical ?? 0),
      high: Number(meta.high ?? 0),
      moderate: Number(meta.moderate ?? 0),
      low: Number(meta.low ?? 0),
    });
  }

  const failCount = findings.filter((f) => f.status === 'FAIL').length;
  const warnCount = findings.filter((f) => f.status === 'WARN').length;
  const passed = failCount === 0;

  const report = {
    generatedAt: now.toISOString(),
    gate: 'Security Dependency Audit (SLA)',
    slaPolicyDays: depPolicy.slaDays,
    failOn: depPolicy.failOn,
    workspaces: workspaceSummaries,
    summary: {
      totalFindings: findings.length,
      fail: failCount,
      warn: warnCount,
      expiredWaivers: expiredWaivers.length,
    },
    passed,
    findings,
  };

  await writeJsonReport(reportOut, report);
  await writeJsonReport(
    sarifOut,
    buildSarifReport({ toolName: 'core-dependency-audit', findings }),
  );

  for (const ws of workspaceSummaries) {
    if (!ws.available) {
      console.warn(`⚠️  [security:deps] ${ws.workspace}: không khả dụng (${ws.error})`);
    } else {
      console.log(
        `  • ${ws.workspace}: total=${ws.total} (critical=${ws.critical}, high=${ws.high}, moderate=${ws.moderate}, low=${ws.low})`,
      );
    }
  }

  if (!passed) {
    console.error(`\n✗ [security:deps] PHÁT HIỆN ${failCount} LỖ HỔNG VƯỢT NGƯỠNG CHẶN (${(depPolicy.failOn ?? []).join(', ')}):`);
    for (const f of findings.filter((x) => x.status === 'FAIL').slice(0, 20)) {
      console.error(`  - [${f.severity}] ${f.message}`);
    }
    process.exit(1);
  }

  console.log(`✓ [security:deps] Đạt ngưỡng chính sách SLA (fail=${failCount}, warn=${warnCount}).`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:deps] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
