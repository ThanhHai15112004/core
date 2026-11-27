#!/usr/bin/env node
/**
 * 15.2.8 — Chạy DAST trên môi trường Staging (Kiểm tra API đang chạy)
 *
 * Nguyên tắc an toàn bắt buộc (Safety Gate):
 *   - CHỈ chạy với URL Staging/Local được khai báo tường minh (`--target <url>` hoặc `STAGING_BASE_URL`).
 *   - CHẶN TUYỆT ĐỐI domain Production (`prod.`, `.production.`, `live.`, ...).
 *   - Không hardcode credential; token kiểm thử (nếu có) truyền qua `STAGING_DAST_AUTH_TOKEN`.
 *
 * Các đầu mục kiểm tra chủ động (non-destructive):
 *   1. Kiểm tra tính sẵn sàng Health endpoint & rò rỉ thông tin server (`Server`, `X-Powered-By`).
 *   2. Kiểm tra OWASP Security Headers (`X-Content-Type-Options`, `X-Frame-Options`, `HSTS`, `CSP`, `Referrer-Policy`).
 *   3. Kiểm tra lỗi cấu hình CORS (Origin giả mạo + `Access-Control-Allow-Credentials: true`).
 *   4. Kiểm tra xác thực các endpoint nhạy cảm (`/api/v1/users`, `/api/v1/roles`, `/api/v1/settings`, `/api/v1/ops/system/overview`) — bắt buộc 401/403 khi không có token.
 *   5. Kiểm tra rò rỉ stack trace / SQL error khi gửi payload sai định dạng.
 *   6. Kiểm tra vô hiệu hóa phương thức HTTP nguy hiểm (`TRACE`).
 *   7. Tùy chọn `--zap`: chạy OWASP ZAP API Scan qua Docker nạp OpenAPI spec của Core.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  buildSarifReport,
  commandExists,
  compileRegexList,
  getFlagValue,
  loadSecurityPolicy,
  writeJsonReport,
} from './common.mjs';

export function validateTargetUrl(rawUrl, policy = loadSecurityPolicy(), { allowNonStandardStaging = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Thiếu URL mục tiêu (cung cấp qua `--target` hoặc biến môi trường `STAGING_BASE_URL`).' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: `URL không hợp lệ: "${rawUrl}"` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Chỉ hỗ trợ giao thức http/https (nhận: ${parsed.protocol}).` };
  }

  const hostname = parsed.hostname.toLowerCase();
  const dastPolicy = policy.dast ?? {};
  const blocked = compileRegexList(dastPolicy.blockedHostPatterns ?? []);
  for (const re of blocked) {
    if (re.test(hostname)) {
      return {
        valid: false,
        reason: `SAFETY GATE: Từ chối chạy DAST vì host "${hostname}" khớp mẫu Production bị chặn (${re}).`,
      };
    }
  }

  if (!allowNonStandardStaging) {
    const allowed = compileRegexList(dastPolicy.allowedHostPatterns ?? []);
    if (!allowed.some((re) => re.test(hostname))) {
      return {
        valid: false,
        reason: `SAFETY GATE: Host "${hostname}" không nằm trong mẫu Staging/Local an toàn. (Chỉ cho phép staging/stage/stg/qa/uat/dev/test/localhost hoặc truyền --allow-non-standard-staging sau khi xác minh).`,
      };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString().replace(/\/+$/, ''),
    hostname,
    protocol: parsed.protocol,
  };
}

export function analyzeDastProbeResults(probeResults, { protocol = 'https:', policy = loadSecurityPolicy() } = {}) {
  const findings = [];
  const dast = policy.dast ?? {};
  const requiredHeaders = dast.requiredSecurityHeaders ?? ['x-content-type-options', 'x-frame-options'];
  const recommendedHeaders = dast.recommendedSecurityHeaders ?? [
    'strict-transport-security',
    'content-security-policy',
    'referrer-policy',
  ];

  // 1. Health / Security headers / Server leak
  const health = probeResults.health;
  if (health) {
    const headers = health.headers ?? {};
    for (const h of requiredHeaders) {
      if (!headers[h]) {
        findings.push({
          rule: `DAST-HEADER-MISSING-${h.toUpperCase()}`,
          severity: 'Medium',
          status: 'WARN',
          category: 'DAST',
          file: health.url,
          line: 1,
          message: `Thiếu Security Header bắt buộc \`${h}\` trên ${health.url}.`,
          remediation: 'Bổ sung header trong Nginx (`docker/nginx/security-headers.conf`) hoặc Fastify Helmet/hook.',
        });
      }
    }

    for (const h of recommendedHeaders) {
      if (h === 'strict-transport-security' && protocol !== 'https:') continue;
      if (!headers[h]) {
        findings.push({
          rule: `DAST-HEADER-RECOMMENDED-${h.toUpperCase()}`,
          severity: 'Low',
          status: 'WARN',
          category: 'DAST',
          file: health.url,
          line: 1,
          message: `Thiếu Security Header khuyến nghị OWASP \`${h}\` trên ${health.url}.`,
          remediation: 'Bổ sung header bảo mật tương ứng trên reverse proxy / API gateway.',
        });
      }
    }

    if (headers['x-powered-by']) {
      findings.push({
        rule: 'DAST-SERVER-BANNER-LEAK',
        severity: 'Low',
        status: 'WARN',
        category: 'DAST',
        file: health.url,
        line: 1,
        message: `Response để lộ header \`X-Powered-By: ${headers['x-powered-by']}\`.`,
        remediation: 'Ẩn header X-Powered-By để giảm thông tin fingerprinting.',
      });
    }
  }

  // 2. CORS misconfiguration
  const cors = probeResults.cors;
  if (cors) {
    const acao = String(cors.headers?.['access-control-allow-origin'] ?? '');
    const acac = String(cors.headers?.['access-control-allow-credentials'] ?? '').toLowerCase();
    if ((acao === cors.probeOrigin || acao === '*') && acac === 'true') {
      findings.push({
        rule: 'DAST-CORS-CREDENTIAL-REFLECTION',
        severity: 'Critical',
        status: 'FAIL',
        category: 'DAST',
        file: cors.url,
        line: 1,
        message: `Lỗi cấu hình CORS nghiêm trọng: phản chiếu origin lạ "${acao}" kèm Access-Control-Allow-Credentials: true.`,
        remediation: 'Chỉ cho phép danh sách origin tin cậy rõ ràng trong cấu hình CORS.',
      });
    }
  }

  // 3. Unauthenticated access to protected endpoints
  for (const ep of probeResults.protectedEndpoints ?? []) {
    if (ep.status >= 200 && ep.status < 300) {
      findings.push({
        rule: 'DAST-BROKEN-ACCESS-CONTROL',
        severity: 'Critical',
        status: 'FAIL',
        category: 'DAST',
        file: ep.url,
        line: 1,
        message: `Endpoint bảo vệ \`${ep.url}\` trả HTTP ${ep.status} mà KHÔNG yêu cầu xác thực!`,
        remediation: 'Kiểm tra JwtAuthGuard / PermissionGuard cho route này ngay lập tức.',
      });
    }
  }

  // 4. Error / Stack trace leak
  const errProbe = probeResults.errorLeak;
  if (errProbe?.body) {
    const leakRe = /(?:at\s+\S+\s+\([^)]+\.(?:ts|js):\d+:\d+\)|QueryFailedError|TypeORMError|SELECT\s+.+\s+FROM\s+|ECONNREFUSED|\/home\/|\/app\/dist\/)/i;
    if (leakRe.test(errProbe.body)) {
      findings.push({
        rule: 'DAST-ERROR-STACK-LEAK',
        severity: 'High',
        status: 'FAIL',
        category: 'DAST',
        file: errProbe.url,
        line: 1,
        message: `Phản hồi lỗi từ \`${errProbe.url}\` để lộ stack trace, đường dẫn nội bộ hoặc câu truy vấn SQL.`,
        remediation: 'Đảm bảo GlobalExceptionFilter ẩn toàn bộ chi tiết nội bộ ở môi trường staging/production.',
      });
    }
  }

  // 5. HTTP TRACE method
  if (probeResults.traceMethod?.status === 200) {
    findings.push({
      rule: 'DAST-HTTP-TRACE-ENABLED',
      severity: 'Medium',
      status: 'WARN',
      category: 'DAST',
      file: probeResults.traceMethod.url,
      line: 1,
      message: 'Máy chủ phản hồi 200 OK cho phương thức HTTP TRACE (nguy cơ XST).',
      remediation: 'Chặn phương thức TRACE trên Nginx/Gateway.',
    });
  }

  return findings;
}

async function fetchSafe(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = await res.text().catch(() => '');
    return { ok: true, url, status: res.status, headers, body: body.slice(0, 4000) };
  } catch (err) {
    return { ok: false, url, status: 0, headers: {}, body: '', error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function runOwaspZapIfRequested(targetUrl, openApiPath, outDirAbs) {
  if (!commandExists('docker')) {
    throw new Error('Cần Docker để chạy OWASP ZAP container (`--zap`).');
  }
  const hasSpec = openApiPath && fs.existsSync(openApiPath);
  const zapReportName = 'zap-dast-report.json';
  const zapArgs = [
    'run',
    '--rm',
    '-v',
    `${outDirAbs}:/zap/wrk:rw`,
    'ghcr.io/zaproxy/zaproxy:stable',
    hasSpec ? 'zap-api-scan.py' : 'zap-baseline.py',
    '-t',
    hasSpec ? `${targetUrl}/api/v1/health` : targetUrl,
    '-J',
    zapReportName,
    '-I',
  ];

  const res = spawnSync('docker', zapArgs, { cwd: REPO_ROOT, stdio: 'inherit' });
  return { exitCode: res.status ?? 1, reportFile: path.join(outDirAbs, zapReportName) };
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const targetRaw = getFlagValue(args, '--target') || process.env.STAGING_BASE_URL || '';
  const allowNonStandardStaging = args.includes('--allow-non-standard-staging');
  const dryRun = args.includes('--dry-run');
  const useZap = args.includes('--zap');
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-dast-report.json';
  const sarifOut = getFlagValue(args, '--sarif') ?? 'reports/security-dast.sarif';

  const validation = validateTargetUrl(targetRaw, policy, { allowNonStandardStaging });
  if (!validation.valid) {
    console.error(`✗ [security:dast] ${validation.reason}`);
    process.exit(1);
  }

  const baseUrl = validation.normalizedUrl;
  const dastPolicy = policy.dast ?? {};
  const timeoutMs = Number(dastPolicy.timeoutMs ?? 10000);

  if (dryRun) {
    console.log(`✓ [security:dast] Safety Gate hợp lệ cho mục tiêu Staging: ${baseUrl}`);
    console.log(`  • Health check: ${baseUrl}${dastPolicy.healthEndpoint || '/api/v1/health'}`);
    console.log(`  • Protected probes: ${(dastPolicy.protectedEndpoints ?? []).join(', ')}`);
    return;
  }

  const healthUrl = `${baseUrl}${dastPolicy.healthEndpoint || '/api/v1/health'}`;
  const healthRes = await fetchSafe(healthUrl, { method: 'GET' }, timeoutMs);
  if (!healthRes.ok) {
    const errReport = {
      generatedAt: new Date().toISOString(),
      gate: 'Security DAST (Staging)',
      target: baseUrl,
      available: false,
      passed: false,
      error: `Không thể kết nối tới mục tiêu Staging (${healthUrl}): ${healthRes.error}`,
      findings: [
        {
          rule: 'DAST-TARGET-UNREACHABLE',
          severity: 'High',
          status: 'FAIL',
          category: 'DAST',
          file: healthUrl,
          line: 1,
          message: `Không thể kết nối tới Staging API (${healthUrl}): ${healthRes.error}`,
          remediation: 'Xác minh dịch vụ Staging đang hoạt động và runner CI có quyền truy cập mạng tới Staging.',
        },
      ],
    };
    await writeJsonReport(reportOut, errReport);
    console.error(`✗ [security:dast] ${errReport.error}`);
    process.exit(1);
  }

  const probeOrigin = 'https://evil-dast-probe.invalid';
  const corsRes = await fetchSafe(
    healthUrl,
    { method: 'GET', headers: { Origin: probeOrigin } },
    timeoutMs,
  );

  const protectedEndpoints = [];
  for (const epPath of dastPolicy.protectedEndpoints ?? []) {
    const res = await fetchSafe(`${baseUrl}${epPath}`, { method: 'GET' }, timeoutMs);
    protectedEndpoints.push(res);
  }

  const errorLeakRes = await fetchSafe(
    `${baseUrl}/api/v1/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"malformed":',
    },
    timeoutMs,
  );

  const traceRes = await fetchSafe(healthUrl, { method: 'TRACE' }, timeoutMs);

  const findings = analyzeDastProbeResults(
    {
      health: healthRes,
      cors: { ...corsRes, probeOrigin },
      protectedEndpoints,
      errorLeak: errorLeakRes,
      traceMethod: traceRes,
    },
    { protocol: validation.protocol, policy },
  );

  let zapSummary = null;
  if (useZap) {
    const outDirAbs = path.dirname(path.resolve(REPO_ROOT, reportOut));
    zapSummary = runOwaspZapIfRequested(baseUrl, path.resolve(REPO_ROOT, 'backend/openapi/openapi.v1.json'), outDirAbs);
  }

  const failCount = findings.filter((f) => f.status === 'FAIL').length;
  const warnCount = findings.filter((f) => f.status === 'WARN').length;
  const passed = failCount === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'Security DAST (Staging)',
    target: baseUrl,
    available: true,
    probesExecuted: 3 + protectedEndpoints.length,
    zap: zapSummary,
    summary: {
      total: findings.length,
      fail: failCount,
      warn: warnCount,
    },
    passed,
    findings,
  };

  await writeJsonReport(reportOut, report);
  await writeJsonReport(sarifOut, buildSarifReport({ toolName: 'core-dast-scanner', findings }));

  if (!passed) {
    console.error(`\n✗ [security:dast] PHÁT HIỆN ${failCount} LỖ HỔNG NGHIÊM TRỌNG TRÊN STAGING (${baseUrl}):`);
    for (const f of findings.filter((x) => x.status === 'FAIL')) {
      console.error(`  - [${f.severity}] ${f.rule} → ${f.message}`);
    }
    process.exit(1);
  }

  console.log(`✓ [security:dast] Kiểm tra DAST trên ${baseUrl} hoàn tất (fail=${failCount}, warn=${warnCount}).`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:dast] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
