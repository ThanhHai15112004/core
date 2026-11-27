#!/usr/bin/env node
/**
 * Phase 15.3 — Post-Deploy Smoke Test (Remote HTTP / Local Stack)
 *
 * Kiểm chứng toàn diện sau triển khai trên mọi môi trường (Dev / Staging / Prod):
 *  1. Liveness (`/api/v1/health/live`) & Readiness (`/api/v1/health/ready`) có retry chờ warmup
 *  2. Đối chiếu Version / Git Commit SHA thực tế đang chạy tại `/api/v1/ops/system-info`
 *  3. Frontend SPA (`/`) & Runtime Config (`/env-config.js`)
 *  4. Luồng Login (`/api/v1/auth/login` -> `/api/v1/auth/me` -> `/api/v1/auth/logout`)
 *  5. Các API chức năng chính ở chế độ đọc (read-only) với JWT vừa đăng nhập
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForProbe(url, predicate, { timeoutMs = 60000, intervalMs = 2000, requestTimeoutMs = 5000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let attempts = 0;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' }, requestTimeoutMs);
      if (predicate(res)) {
        return { passed: true, attempts, status: res.status, durationMs: res.durationMs, json: res.json };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() + intervalMs > deadline) break;
    await sleep(intervalMs);
  }

  return { passed: false, attempts, error: lastError || 'Timeout waiting for probe' };
}

/**
 * Thực thi toàn bộ bộ kiểm thử Smoke Test sau triển khai.
 */
export async function runPostDeploySmokeTest(options) {
  const baseUrl = String(options.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('baseUrl is required for post-deploy smoke test');
  }

  const apiPrefix = String(options.apiPrefix || '/api/v1').replace(/\/+$/, '');
  const waitTimeoutMs = Number(options.waitTimeoutMs ?? 60000);
  const pollIntervalMs = Number(options.pollIntervalMs ?? 2000);
  const requestTimeoutMs = Number(options.requestTimeoutMs ?? 8000);
  const expectedCommit = options.expectedCommit ? String(options.expectedCommit).trim() : null;
  const expectedVersion = options.expectedVersion ? String(options.expectedVersion).trim() : null;
  const skipFrontend = Boolean(options.skipFrontend);
  const requireAuth = Boolean(options.requireAuth);
  const authIdentifier = options.authIdentifier ? String(options.authIdentifier).trim() : '';
  const authPassword = options.authPassword ? String(options.authPassword) : '';
  const featurePaths = Array.isArray(options.featurePaths) && options.featurePaths.length > 0
    ? options.featurePaths
    : [`${apiPrefix}/ops/modules`, `${apiPrefix}/codes/types`];

  const checks = [];
  const record = (name, passed, detail = {}) => {
    checks.push({ name, passed: Boolean(passed), ...detail });
  };

  // 1. Liveness Probe
  const liveUrl = `${baseUrl}${apiPrefix}/health/live`;
  const live = await waitForProbe(
    liveUrl,
    (res) => res.ok && (res.json?.data?.live === true || res.json?.live === true),
    { timeoutMs: waitTimeoutMs, intervalMs: pollIntervalMs, requestTimeoutMs },
  );
  record('health.live', live.passed, {
    url: liveUrl,
    attempts: live.attempts,
    status: live.status ?? null,
    durationMs: live.durationMs ?? null,
    ...(live.error ? { error: live.error } : {}),
  });

  // 2. Readiness Probe
  const readyUrl = `${baseUrl}${apiPrefix}/health/ready`;
  const ready = await waitForProbe(
    readyUrl,
    (res) => res.ok && (res.json?.data?.ready === true || res.json?.ready === true),
    { timeoutMs: waitTimeoutMs, intervalMs: pollIntervalMs, requestTimeoutMs },
  );
  record('health.ready', ready.passed, {
    url: readyUrl,
    attempts: ready.attempts,
    status: ready.status ?? null,
    durationMs: ready.durationMs ?? null,
    ...(ready.error ? { error: ready.error } : {}),
  });

  // 3. Release Traceability Check (Version & Commit SHA via /ops/system-info)
  const sysInfoUrl = `${baseUrl}${apiPrefix}/ops/system-info`;
  try {
    const res = await fetchWithTimeout(sysInfoUrl, { method: 'GET' }, requestTimeoutMs);
    const payload = res.json?.data ?? res.json;
    const actualCommit = payload?.deployment?.commit ?? null;
    const actualVersion = payload?.projectVersion ?? payload?.coreVersion ?? null;

    let commitMatches = true;
    let versionMatches = true;
    const mismatchReasons = [];

    if (expectedCommit) {
      commitMatches =
        typeof actualCommit === 'string' &&
        (actualCommit.toLowerCase().startsWith(expectedCommit.toLowerCase()) ||
          expectedCommit.toLowerCase().startsWith(actualCommit.toLowerCase()));
      if (!commitMatches) {
        mismatchReasons.push(`expected commit ${expectedCommit}, got ${actualCommit ?? 'null'}`);
      }
    }
    if (expectedVersion) {
      versionMatches = actualVersion === expectedVersion || payload?.deployment?.version === expectedVersion;
      if (!versionMatches) {
        mismatchReasons.push(`expected version ${expectedVersion}, got ${actualVersion ?? 'null'}`);
      }
    }

    record('release.traceability', res.ok && commitMatches && versionMatches, {
      url: sysInfoUrl,
      status: res.status,
      durationMs: res.durationMs,
      actualCommit,
      actualVersion,
      ...(mismatchReasons.length > 0 ? { error: mismatchReasons.join('; ') } : {}),
    });
  } catch (err) {
    record('release.traceability', false, {
      url: sysInfoUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Frontend SPA & Runtime Config
  if (!skipFrontend) {
    const spaUrl = `${baseUrl}/`;
    try {
      const res = await fetchWithTimeout(spaUrl, { method: 'GET' }, requestTimeoutMs);
      const isHtml = /<!doctype html|<html/i.test(res.text);
      record('frontend.spa', res.ok && isHtml, {
        url: spaUrl,
        status: res.status,
        durationMs: res.durationMs,
        ...(!isHtml ? { error: 'Response is not HTML document' } : {}),
      });
    } catch (err) {
      record('frontend.spa', false, {
        url: spaUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const envCfgUrl = `${baseUrl}/env-config.js`;
    try {
      const res = await fetchWithTimeout(envCfgUrl, { method: 'GET' }, requestTimeoutMs);
      const hasConfig = res.text.includes('__CORE_RUNTIME_CONFIG__');
      record('frontend.runtimeConfig', res.ok && hasConfig, {
        url: envCfgUrl,
        status: res.status,
        durationMs: res.durationMs,
        ...(!hasConfig ? { error: 'Missing __CORE_RUNTIME_CONFIG__ in env-config.js' } : {}),
      });
    } catch (err) {
      record('frontend.runtimeConfig', false, {
        url: envCfgUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. Login Flow & Core Read-Only Features
  if (authIdentifier && authPassword) {
    const loginUrl = `${baseUrl}${apiPrefix}/auth/login`;
    let accessToken = null;
    let refreshToken = null;
    try {
      const loginRes = await fetchWithTimeout(
        loginUrl,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identifier: authIdentifier,
            password: authPassword,
            deviceName: 'post-deploy-smoke',
          }),
        },
        requestTimeoutMs,
      );
      const data = loginRes.json?.data ?? loginRes.json;
      accessToken = data?.tokens?.accessToken ?? data?.accessToken ?? null;
      refreshToken = data?.tokens?.refreshToken ?? data?.refreshToken ?? null;

      record('auth.login', loginRes.ok && Boolean(accessToken), {
        url: loginUrl,
        status: loginRes.status,
        durationMs: loginRes.durationMs,
        ...(!accessToken ? { error: 'Login response did not include accessToken' } : {}),
      });
    } catch (err) {
      record('auth.login', false, {
        url: loginUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (accessToken) {
      const authHeaders = { authorization: `Bearer ${accessToken}` };

      // 5b. /auth/me
      const meUrl = `${baseUrl}${apiPrefix}/auth/me`;
      try {
        const meRes = await fetchWithTimeout(meUrl, { method: 'GET', headers: authHeaders }, requestTimeoutMs);
        record('auth.me', meRes.ok, {
          url: meUrl,
          status: meRes.status,
          durationMs: meRes.durationMs,
        });
      } catch (err) {
        record('auth.me', false, {
          url: meUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 5c. Core read-only functional endpoints
      for (const relPath of featurePaths) {
        const normalized = relPath.startsWith('/') ? relPath : `/${relPath}`;
        const url = `${baseUrl}${normalized}`;
        const checkName = `feature:${normalized}`;
        try {
          const res = await fetchWithTimeout(url, { method: 'GET', headers: authHeaders }, requestTimeoutMs);
          record(checkName, res.ok, {
            url,
            status: res.status,
            durationMs: res.durationMs,
            ...(!res.ok ? { error: `HTTP ${res.status}` } : {}),
          });
        } catch (err) {
          record(checkName, false, {
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 5d. Clean Logout (best-effort session cleanup)
      const logoutUrl = `${baseUrl}${apiPrefix}/auth/logout`;
      try {
        const logoutRes = await fetchWithTimeout(
          logoutUrl,
          {
            method: 'POST',
            headers: { ...authHeaders, 'content-type': 'application/json' },
            body: JSON.stringify(refreshToken ? { refreshToken } : {}),
          },
          requestTimeoutMs,
        );
        record('auth.logout', logoutRes.ok || logoutRes.status === 204, {
          url: logoutUrl,
          status: logoutRes.status,
          durationMs: logoutRes.durationMs,
        });
      } catch (err) {
        record('auth.logout', false, {
          url: logoutUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else if (requireAuth) {
    record('auth.login', false, {
      error: 'requireAuth=true nhưng thiếu SMOKE_AUTH_IDENTIFIER / SMOKE_AUTH_PASSWORD',
    });
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.length - passedCount;

  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    expectedCommit,
    expectedVersion,
    passed: failedCount === 0,
    summary: {
      total: checks.length,
      passed: passedCount,
      failed: failedCount,
    },
    checks,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args['base-url'] || process.env.DEPLOY_BASE_URL || '';
  if (!baseUrl) {
    console.error('✗ Missing --base-url (or DEPLOY_BASE_URL)');
    process.exit(1);
  }

  const featurePaths = args['feature-paths']
    ? String(args['feature-paths']).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const report = await runPostDeploySmokeTest({
    baseUrl,
    apiPrefix: args['api-prefix'] || '/api/v1',
    waitTimeoutMs: args['wait-timeout-ms'] ? Number(args['wait-timeout-ms']) : 60000,
    pollIntervalMs: args['poll-interval-ms'] ? Number(args['poll-interval-ms']) : 2000,
    expectedCommit: args['expected-commit'] || process.env.APP_GIT_COMMIT || null,
    expectedVersion: args['expected-version'] || process.env.APP_VERSION || null,
    skipFrontend: Boolean(args['skip-frontend']),
    requireAuth: Boolean(args['require-auth']),
    authIdentifier: args['auth-identifier'] || process.env.SMOKE_AUTH_IDENTIFIER || '',
    authPassword: args['auth-password'] || process.env.SMOKE_AUTH_PASSWORD || '',
    featurePaths,
  });

  console.log(`=== POST-DEPLOY SMOKE TEST (${report.baseUrl}) ===`);
  for (const check of report.checks) {
    const icon = check.passed ? '✅' : '❌';
    const meta = [
      check.status ? `HTTP ${check.status}` : null,
      typeof check.durationMs === 'number' ? `${check.durationMs}ms` : null,
      check.error || null,
    ].filter(Boolean).join(' · ');
    console.log(`  ${icon} ${check.name}${meta ? ` (${meta})` : ''}`);
  }
  console.log(`Summary: ${report.summary.passed}/${report.summary.total} passed`);

  if (args.report) {
    const outPath = path.resolve(String(args.report));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (!report.passed) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Smoke test crashed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
