#!/usr/bin/env node
/**
 * Bộ tạo báo cáo kết quả CI (Markdown + JSON + GitHub Step Summary).
 *
 * Hỗ trợ 2 chế độ:
 * 1. Tổng hợp kết quả từ CI pipeline (GitHub Actions / GitLab CI):
 *    node scripts/ci/ci-report.mjs --summarize \
 *      --step "Validate & Lockfile=success" \
 *      --step "Backend Quality & Unit/Feature=failure" \
 *      --step "Backend Integration & API (DB+Redis)=success" \
 *      --step "Frontend Quality & Build=skipped" \
 *      --lockfile-report reports/lockfile-report.json \
 *      --arch-report reports/arch-report.json \
 *      --openapi-report reports/openapi-report.json \
 *      --coverage-report backend/coverage/module-coverage-summary.json \
 *      --out-dir reports
 *
 * 2. Chạy tuần tự bộ kiểm tra chất lượng tại local và xuất báo cáo tổng hợp:
 *    node scripts/ci/ci-report.mjs --run [--live] [--skip-fe] [--out-dir reports]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function readJsonSafe(relOrAbsPath) {
  if (!relOrAbsPath) return null;
  const resolved = path.isAbsolute(relOrAbsPath)
    ? relOrAbsPath
    : path.resolve(repoRoot, relOrAbsPath);
  try {
    const raw = await fs.readFile(resolved, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  const lines = [
    `# Core CI Quality Report — ${overallLabel}`,
    '',
    `- **Generated At:** \`${summary.generatedAt}\``,
    `- **Mode:** \`${summary.mode}\``,
    `- **Summary:** ${summary.counts.passed} passed | ${summary.counts.failed} failed | ${summary.counts.skipped} skipped`,
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

  if (summary.details.lockfile) {
    const lf = summary.details.lockfile;
    lines.push('## Lockfile Integrity');
    lines.push(`- Status: ${lf.passed ? '✅ PASS' : '❌ FAIL'} (\`${lf.packageManager ?? 'npm'}\`)`);
    for (const t of lf.targets ?? []) {
      lines.push(
        `  - \`${t.dir}/package-lock.json\`: ${t.passed ? 'OK' : `FAILED (${(t.issues ?? []).length} issue(s))`}`,
      );
    }
    lines.push('');
  }

  if (summary.details.architecture) {
    const arch = summary.details.architecture;
    lines.push('## Architecture Boundary Check');
    lines.push(
      `- Status: ${arch.passed ? '✅ PASS' : '❌ FAIL'} | Files scanned: **${arch.totalFilesScanned}** | Violations: **${arch.violationCount}**`,
    );
    if (Array.isArray(arch.violations) && arch.violations.length > 0) {
      for (const v of arch.violations.slice(0, 10)) {
        lines.push(`  - \`[${v.rule}]\` \`${v.file}\`: ${v.message}`);
      }
    }
    lines.push('');
  }

  if (summary.details.openapi) {
    const api = summary.details.openapi;
    lines.push('## OpenAPI Contract & Breaking Change Check');
    lines.push(
      `- Status: ${api.passed ? '✅ PASS' : '❌ FAIL'} | Baseline: \`${api.baselineSource ?? api.baselinePath ?? 'unknown'}\` | Operations compared: **${api.totalOperationsCompared}**`,
    );
    lines.push(
      `- Breaking changes: **${api.breakingCount ?? 0}** | Non-breaking/additive changes: **${api.nonBreakingCount ?? 0}**`,
    );
    if (Array.isArray(api.breakingChanges) && api.breakingChanges.length > 0) {
      for (const b of api.breakingChanges.slice(0, 10)) {
        lines.push(`  - **[BREAKING]** \`${b.method} ${b.path}\` (${b.rule}): ${b.message}`);
      }
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

  return `${lines.join('\n')}\n`;
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
  const lockReport = path.join(outDir, 'lockfile-report.json');
  const archReport = path.join(outDir, 'arch-report.json');
  const openApiReport = path.join(outDir, 'openapi-report.json');
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
  steps.push(runLocalStep('Backend Format Check (Prettier)', 'npm', ['run', 'format:check'], backendDir));
  steps.push(runLocalStep('Backend ESLint Check', 'npm', ['run', 'lint:check'], backendDir));
  steps.push(runLocalStep('Backend TypeScript Typecheck', 'npm', ['run', 'typecheck'], backendDir));
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

  steps.push(runLocalStep('Backend Unit Tests', 'npm', ['run', 'test:unit'], backendDir));
  steps.push(runLocalStep('Backend Feature/API Tests', 'npm', ['run', 'test:feature'], backendDir));

  if (includeLive) {
    steps.push(
      runLocalStep(
        'Backend Live Integration & API Tests (DB + Redis)',
        'npm',
        ['run', 'test:integration:live'],
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
    steps.push(runLocalStep('Frontend Lint & Hardcode Gate', 'npm', ['run', 'lint'], frontendDir));
    steps.push(runLocalStep('Frontend TypeScript Typecheck', 'npm', ['run', 'typecheck'], frontendDir));
    steps.push(runLocalStep('Frontend Unit Tests (Vitest)', 'npm', ['run', 'test'], frontendDir));
  } else {
    steps.push({ name: 'Frontend Quality Checks', status: 'skipped', detail: 'Skipped via --skip-fe' });
  }

  return {
    mode: 'local-runner',
    steps,
    detailPaths: {
      lockfile: lockReport,
      architecture: archReport,
      openapi: openApiReport,
      coverage: path.join(backendDir, 'coverage', 'module-coverage-summary.json'),
    },
  };
}

function summarizeMode() {
  const stepEntries = getAllFlagValues('--step').map((raw) => {
    const sep = raw.lastIndexOf('=');
    const name = sep >= 0 ? raw.slice(0, sep).trim() : raw.trim();
    const status = normalizeStatus(sep >= 0 ? raw.slice(sep + 1) : 'unknown');
    return { name, status, detail: status === 'failed' ? 'Gate failed — inspect job logs' : '-' };
  });

  return {
    mode: 'ci-summary',
    steps: stepEntries,
    detailPaths: {
      lockfile: getFlagValue('--lockfile-report') ?? 'reports/lockfile-report.json',
      architecture: getFlagValue('--arch-report') ?? 'reports/arch-report.json',
      openapi: getFlagValue('--openapi-report') ?? 'reports/openapi-report.json',
      coverage: getFlagValue('--coverage-report') ?? 'backend/coverage/module-coverage-summary.json',
    },
  };
}

async function main() {
  const outDirArg = getFlagValue('--out-dir') ?? 'reports';
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(repoRoot, outDirArg);
  await fs.mkdir(outDir, { recursive: true });

  const isRun = args.includes('--run');
  const result = isRun ? await runMode(outDir) : summarizeMode();

  const details = {
    lockfile: await readJsonSafe(result.detailPaths.lockfile),
    architecture: await readJsonSafe(result.detailPaths.architecture),
    openapi: await readJsonSafe(result.detailPaths.openapi),
    coverage: await readJsonSafe(result.detailPaths.coverage),
  };

  if (args.includes('--infer-from-artifacts') && result.steps.length === 0) {
    result.steps.push({
      name: 'Lockfile Integrity Check',
      status: details.lockfile ? (details.lockfile.passed ? 'passed' : 'failed') : 'skipped',
      detail: details.lockfile ? `${(details.lockfile.targets ?? []).length} lockfile(s) verified` : 'No artifact',
    });
    result.steps.push({
      name: 'Architecture Boundary Check',
      status: details.architecture ? (details.architecture.passed ? 'passed' : 'failed') : 'skipped',
      detail: details.architecture
        ? `${details.architecture.violationCount ?? 0} violation(s)`
        : 'No artifact',
    });
    result.steps.push({
      name: 'OpenAPI Breaking Change Check',
      status: details.openapi ? (details.openapi.passed ? 'passed' : 'failed') : 'skipped',
      detail: details.openapi
        ? `${details.openapi.breakingCount ?? 0} breaking, ${details.openapi.nonBreakingCount ?? 0} non-breaking`
        : 'No artifact',
    });
    result.steps.push({
      name: 'Backend Module Coverage',
      status: details.coverage?.overall ? 'passed' : 'skipped',
      detail: details.coverage?.overall
        ? `Lines ${Number(details.coverage.overall.lines?.pct ?? 0).toFixed(2)}%`
        : 'No artifact',
    });
  }

  const counts = {
    passed: result.steps.filter((s) => s.status === 'passed').length,
    failed: result.steps.filter((s) => s.status === 'failed' || s.status === 'cancelled').length,
    skipped: result.steps.filter((s) => s.status === 'skipped').length,
  };
  const failedSteps = result.steps.filter((s) => s.status === 'failed' || s.status === 'cancelled');

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: result.mode,
    passed: failedSteps.length === 0,
    counts,
    failedSteps,
    steps: result.steps,
    details,
  };

  const jsonPath = path.join(outDir, 'ci-summary.json');
  const mdPath = path.join(outDir, 'ci-summary.md');
  const markdown = buildMarkdownReport(summary);

  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, markdown, 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  }

  console.log('\n' + markdown);
  console.log(`[ci-report] Saved: ${path.relative(repoRoot, mdPath)} & ${path.relative(repoRoot, jsonPath)}`);

  if (!summary.passed && !args.includes('--no-fail')) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ [ci-report] Unexpected error:', err);
  process.exit(1);
});
