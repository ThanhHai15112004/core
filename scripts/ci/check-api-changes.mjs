#!/usr/bin/env node
/**
 * Kiểm tra thay đổi hợp đồng API (OpenAPI Breaking Change Gate) cho CI & PR.
 *
 * Khắc phục lỗ hổng so sánh cùng nhánh:
 * - Trên Pull Request / Merge Request (có base SHA), lấy bản `backend/openapi/openapi.v1.json`
 *   từ nhánh gốc (`git show <base>:backend/openapi/openapi.v1.json`) làm baseline thật để chống
 *   việc ghi đè file baseline trong PR làm pass giả.
 * - Khi không có base commit hoặc file chưa tồn tại ở base, fallback về `backend/openapi/openapi.v1.json`.
 * - Đồng thời kiểm tra drift giữa code hiện tại và `backend/openapi/openapi.v1.json` đang commit.
 *
 * Cách dùng:
 *   node scripts/ci/check-api-changes.mjs [--base <sha>] [--report reports/openapi-report.json]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');
const backendDir = path.join(repoRoot, 'backend');
const OPENAPI_REPO_PATH = 'backend/openapi/openapi.v1.json';
const ZERO_SHA = '0000000000000000000000000000000000000000';

const args = process.argv.slice(2);
function getFlagValue(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function runGit(gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function resolveBaseSha() {
  const candidate =
    getFlagValue('--base') ||
    process.env.PR_BASE_SHA ||
    process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA ||
    process.env.BEFORE_SHA ||
    process.env.CI_COMMIT_BEFORE_SHA ||
    '';

  if (candidate && candidate !== ZERO_SHA) {
    const verified = runGit(['rev-parse', '--verify', candidate])?.trim();
    if (verified) return verified;
  }

  return null;
}

async function main() {
  const reportArg = getFlagValue('--report');
  const reportPath = reportArg
    ? path.isAbsolute(reportArg)
      ? reportArg
      : path.resolve(repoRoot, reportArg)
    : path.join(repoRoot, 'reports', 'openapi-report.json');

  await fs.mkdir(path.dirname(reportPath), { recursive: true });

  const baseSha = resolveBaseSha();
  let baselinePath = path.join(backendDir, 'openapi', 'openapi.v1.json');
  let baselineSource = 'working-tree:backend/openapi/openapi.v1.json';
  let tempDir = null;

  try {
    if (baseSha) {
      const baseSpecContent = runGit(['show', `${baseSha}:${OPENAPI_REPO_PATH}`]);
      if (baseSpecContent) {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-openapi-base-'));
        baselinePath = path.join(tempDir, 'openapi.base.v1.json');
        await fs.writeFile(baselinePath, baseSpecContent, 'utf8');
        baselineSource = `git:${baseSha.slice(0, 12)}:${OPENAPI_REPO_PATH}`;
      }
    }

    const cliMain = path.join(backendDir, 'dist', 'apps', 'cli', 'main.js');
    const result = spawnSync(
      process.execPath,
      [cliMain, 'openapi:check', '--base', baselinePath, '--report', reportPath],
      {
        cwd: backendDir,
        stdio: 'inherit',
      },
    );

    // Gắn thêm metadata nguồn baseline vào file JSON report
    try {
      const rawReport = await fs.readFile(reportPath, 'utf8');
      const parsed = JSON.parse(rawReport);
      parsed.baselineSource = baselineSource;
      parsed.baseSha = baseSha;
      await fs.writeFile(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    } catch {
      // Nếu CLI chưa kịp tạo report do lỗi sớm, bỏ qua để exit code gốc được giữ nguyên
    }

    console.log(`[check-api-changes] Baseline source: ${baselineSource}`);
    console.log(`[check-api-changes] Report written to: ${path.relative(repoRoot, reportPath)}`);

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('✗ [check-api-changes] Unexpected error:', err);
  process.exit(1);
});
