#!/usr/bin/env node
/**
 * Bộ điều phối chạy toàn bộ các chốt chặn quét bảo mật tự động (Mục 15.2)
 *
 * Cách dùng:
 *   node scripts/security/run-all.mjs                          # Chạy 6 gate lõi (Secrets, Deps, SAST, IaC, Licenses, SBOM)
 *   node scripts/security/run-all.mjs --with-images            # Chạy thêm Docker Image Scan (cần Docker)
 *   node scripts/security/run-all.mjs --dast http://localhost:3005  # Chạy thêm DAST trên Staging/Local
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, getFlagValue, writeJsonReport } from './common.mjs';

async function main() {
  const args = process.argv.slice(2);
  const withImages = args.includes('--with-images');
  const dastTarget = getFlagValue(args, '--dast');

  const steps = [
    { name: '15.2.1 Secret Scanning', cmd: process.execPath, args: ['scripts/security/scan-secrets.mjs'] },
    { name: '15.2.2 Dependency Audit (SLA)', cmd: process.execPath, args: ['scripts/security/scan-dependencies.mjs'] },
    { name: '15.2.3 SAST Source Code Scan', cmd: process.execPath, args: ['scripts/security/scan-sast.mjs'] },
    { name: '15.2.5 IaC Config Scan (Docker/K8s/TF)', cmd: process.execPath, args: ['scripts/security/scan-iac.mjs'] },
    { name: '15.2.6 Dependency License Check', cmd: process.execPath, args: ['scripts/security/check-licenses.mjs'] },
    { name: '15.2.7 CycloneDX SBOM Generation', cmd: process.execPath, args: ['scripts/security/generate-sbom.mjs'] },
  ];

  if (withImages) {
    steps.push({
      name: '15.2.4 Docker Image Vulnerability Scan',
      cmd: 'bash',
      args: ['scripts/security/scan-docker-images.sh'],
    });
  }

  if (dastTarget) {
    steps.push({
      name: '15.2.8 Staging DAST API Scan',
      cmd: process.execPath,
      args: ['scripts/security/run-dast.mjs', '--target', dastTarget],
    });
  }

  const results = [];
  for (const step of steps) {
    console.log(`\n▶ [security:all] ${step.name}`);
    const started = Date.now();
    const res = spawnSync(step.cmd, step.args, { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
    const durationMs = Date.now() - started;
    results.push({
      name: step.name,
      status: res.status === 0 ? 'passed' : 'failed',
      exitCode: res.status ?? 1,
      durationMs,
    });
  }

  const failed = results.filter((r) => r.status !== 'passed');
  const summary = {
    generatedAt: new Date().toISOString(),
    passed: failed.length === 0,
    totalSteps: results.length,
    passedSteps: results.length - failed.length,
    failedSteps: failed.length,
    steps: results,
  };

  await writeJsonReport('reports/security-summary.json', summary);

  console.log('\n======================================================================');
  console.log(`TỔNG KẾT QUÉT BẢO MẬT TỰ ĐỘNG (15.2): ${summary.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('======================================================================');
  for (const r of results) {
    console.log(`  ${r.status === 'passed' ? '✅' : '❌'} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  if (!summary.passed) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:all] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
