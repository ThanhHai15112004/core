#!/usr/bin/env node
/**
 * Kiểm tra tính toàn vẹn và đồng bộ của Lockfile cố định (npm package-lock.json)
 * trên toàn workspace (root, backend, frontend) trước khi chạy cài đặt `npm ci`.
 *
 * Cách dùng:
 *   node scripts/ci/check-lockfiles.mjs [--report reports/lockfile-report.json]
 */
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

const TARGETS = [
  { name: 'root', dir: '.' },
  { name: 'backend', dir: 'backend' },
  { name: 'frontend', dir: 'frontend' },
];

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function checkTarget(target) {
  const targetDir = path.resolve(repoRoot, target.dir);
  const pkgPath = path.join(targetDir, 'package.json');
  const lockPath = path.join(targetDir, 'package-lock.json');
  const issues = [];

  let pkg;
  try {
    pkg = await readJson(pkgPath);
  } catch (err) {
    return {
      name: target.name,
      dir: target.dir,
      passed: false,
      lockfileVersion: null,
      issues: [`Cannot read ${path.relative(repoRoot, pkgPath)}: ${err.message}`],
    };
  }

  let lock;
  try {
    lock = await readJson(lockPath);
  } catch (err) {
    return {
      name: target.name,
      dir: target.dir,
      passed: false,
      lockfileVersion: null,
      issues: [`Missing or invalid ${path.relative(repoRoot, lockPath)}: ${err.message}`],
    };
  }

  const lockfileVersion = Number(lock.lockfileVersion ?? 0);
  if (lockfileVersion < 2) {
    issues.push(`Unsupported lockfileVersion (${lockfileVersion}); expected >= 2 for deterministic npm ci.`);
  }

  const rootEntry = lock.packages?.[''];
  if (!rootEntry) {
    issues.push('Missing root entry packages[""] in package-lock.json.');
  } else {
    if (pkg.name && rootEntry.name && pkg.name !== rootEntry.name) {
      issues.push(`Package name mismatch: package.json="${pkg.name}" vs lockfile="${rootEntry.name}".`);
    }
    if (pkg.version && rootEntry.version && pkg.version !== rootEntry.version) {
      issues.push(`Package version mismatch: package.json="${pkg.version}" vs lockfile="${rootEntry.version}".`);
    }

    const sections = ['dependencies', 'devDependencies', 'optionalDependencies'];
    for (const section of sections) {
      const pkgDeps = pkg[section] ?? {};
      const lockDeps = rootEntry[section] ?? {};

      for (const [depName, expectedRange] of Object.entries(pkgDeps)) {
        const lockedRange = lockDeps[depName];
        if (!lockedRange) {
          issues.push(`Missing ${section}.${depName} ("${expectedRange}") in package-lock.json.`);
        } else if (lockedRange !== expectedRange) {
          issues.push(
            `Out-of-sync ${section}.${depName}: package.json="${expectedRange}" vs lockfile="${lockedRange}".`,
          );
        }
      }

      for (const depName of Object.keys(lockDeps)) {
        if (!(depName in pkgDeps)) {
          issues.push(`Stale ${section}.${depName} exists in package-lock.json but not in package.json.`);
        }
      }
    }
  }

  return {
    name: target.name,
    dir: target.dir,
    passed: issues.length === 0,
    lockfileVersion,
    dependencyCount: Object.keys(lock.packages ?? {}).length,
    issues,
  };
}

async function main() {
  const reportPath = getFlagValue('--report');
  const results = [];
  for (const target of TARGETS) {
    results.push(await checkTarget(target));
  }

  const passed = results.every((r) => r.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    packageManager: 'npm',
    passed,
    targets: results,
  };

  if (reportPath) {
    const resolved = path.isAbsolute(reportPath) ? reportPath : path.resolve(repoRoot, reportPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log('\n======================================================');
  console.log('         Fixed Lockfile Integrity Gate (npm ci)       ');
  console.log('======================================================');
  for (const r of results) {
    const badge = r.passed ? '✓' : '✗';
    console.log(
      `  ${badge} [${r.name}] ${r.dir}/package-lock.json (v${r.lockfileVersion ?? '?'}, entries=${r.dependencyCount ?? 0})`,
    );
    for (const issue of r.issues) {
      console.error(`      - ${issue}`);
    }
  }
  console.log('======================================================\n');

  if (!passed) {
    console.error('✗ Lockfile integrity check failed. Re-run `npm install --package-lock-only` in the affected folder and commit package-lock.json.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ [check-lockfiles] Unexpected error:', err);
  process.exit(1);
});
