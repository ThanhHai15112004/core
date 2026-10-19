#!/usr/bin/env node
/**
 * Chốt chặn kiểm soát chất lượng Diff & Chống AI gian lận kiểm thử (Anti-AI-Deception Guard)
 * Dùng chung cho:
 *   1. Local Git Hook (.husky/pre-commit):  node scripts/ci/guard-diff.mjs --staged
 *   2. GitHub Actions & GitLab CI:          node scripts/ci/guard-diff.mjs --enforce-feature-test [--base <sha>] [--head <sha>]
 *
 * Các quy tắc kiểm tra:
 *   [Rule 1] Chặn dấu hiệu xung đột merge chưa giải quyết (<<<<<<<, =======, >>>>>>>)
 *   [Rule 2] Chặn AI vô hiệu hóa test (.skip, .only, .todo, xit, xdescribe) hoặc bịt lỗi TS (@ts-ignore, @ts-nocheck)
 *   [Rule 3] Kiểm tra vị trí & tên tệp kiểm thử chuẩn (Cấm đặt test trong backend/src/ hoặc đặt sai thư mục trong backend/test/)
 *   [Rule 4] Bắt buộc có cập nhật Test khi sửa code nghiệp vụ Module (Controllers/Services/Repositories) trên CI
 *            (Hỗ trợ ngoại lệ khi commit message có chứa "[skip-test-guard]")
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const isStaged = args.includes('--staged');
const enforceFeatureTest = args.includes('--enforce-feature-test');

function getFlagValue(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function runGit(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

const ZERO_SHA = '0000000000000000000000000000000000000000';

function resolveDiffRange() {
  if (isStaged) {
    return { mode: 'staged', base: null, head: null };
  }

  let head = getFlagValue('--head') || process.env.CI_COMMIT_SHA || process.env.GITHUB_SHA || 'HEAD';
  let base =
    getFlagValue('--base') ||
    process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA ||
    process.env.CI_COMMIT_BEFORE_SHA ||
    '';

  if (!base || base === ZERO_SHA) {
    const parent = runGit(['rev-parse', `${head}^`]);
    if (parent) {
      base = parent;
    } else {
      base = runGit(['hash-object', '-t', 'tree', '/dev/null']);
    }
  }

  return { mode: 'range', base, head };
}

const range = resolveDiffRange();
const diffBaseArgs =
  range.mode === 'staged' ? ['diff', '--cached'] : ['diff', range.base, range.head];

const changedFilesRaw = runGit([...diffBaseArgs, '--name-only', '--diff-filter=ACMR']);
const changedFiles = changedFilesRaw ? changedFilesRaw.split('\n').map((f) => f.trim()).filter(Boolean) : [];

if (changedFiles.length === 0) {
  console.log('✓ [guard-diff] Không có tệp mới hoặc chỉnh sửa nào cần kiểm tra.');
  process.exit(0);
}

console.log(
  `🔍 [guard-diff] Đang kiểm tra ${changedFiles.length} tệp thay đổi (${
    range.mode === 'staged' ? 'staged' : `${range.base.slice(0, 8)}..${range.head.slice(0, 8)}`
  })...`,
);

const violations = [];

// ============================================================================
// [Rule 1] & [Rule 2]: Quét nội dung các dòng vừa thêm mới (git diff --unified=0)
// ============================================================================
const CONFLICT_RE = new RegExp('^\\+(' + '<'.repeat(7) + '|' + '='.repeat(7) + '|' + '>'.repeat(7) + ')(\\s|$)');
const SKIP_ONLY_TEST_RE = /\b(?:describe|it|test)\.(?:skip|only|todo)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(/;
const TS_SUPPRESS_RE = /@ts-(?:ignore|nocheck)\b/;

for (const file of changedFiles) {
  // Bỏ qua chính file script này hoặc tài liệu markdown
  if (file === 'scripts/ci/guard-diff.mjs' || file.endsWith('.md')) continue;

  const fileDiff = runGit([...diffBaseArgs, '--unified=0', '--', file]);
  if (!fileDiff) continue;

  const isTestFile =
    file.startsWith('backend/test/') ||
    /\.(?:spec|test|integration-spec|feature-spec)\.[jt]sx?$/.test(file);
  const isTsFile = /\.[mc]?tsx?$/.test(file);

  let currentLine = 0;
  for (const line of fileDiff.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /\+(\d+)/.exec(line);
      if (m) currentLine = Number(m[1]) - 1;
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    if (line.startsWith('+')) {
      currentLine++;
      const addedText = line.slice(1);
      if (addedText.includes('guard-ok')) continue;

      if (CONFLICT_RE.test(line)) {
        violations.push({
          rule: 'Rule 1: Conflict Marker',
          file: `${file}:${currentLine}`,
          message: `Phát hiện dấu hiệu merge conflict chưa giải quyết: "${addedText.trim()}"`,
        });
      }

      if (isTestFile && SKIP_ONLY_TEST_RE.test(addedText)) {
        violations.push({
          rule: 'Rule 2: Anti-AI-Deception (Skipped/Focused Test)',
          file: `${file}:${currentLine}`,
          message: `Cấm sử dụng .skip / .only / .todo / xit trong file test để lách kiểm thử: "${addedText.trim()}"`,
        });
      }

      if (isTsFile && TS_SUPPRESS_RE.test(addedText)) {
        violations.push({
          rule: 'Rule 2: Anti-AI-Deception (TS Error Suppression)',
          file: `${file}:${currentLine}`,
          message: `Cấm sử dụng @ts-ignore / @ts-nocheck để che giấu lỗi kiểu dữ liệu: "${addedText.trim()}"`,
        });
      }
    }
  }
}

// ============================================================================
// [Rule 3]: Kiểm tra vị trí & quy chuẩn đặt tên tệp kiểm thử
// ============================================================================
for (const file of changedFiles) {
  // 3a. Cấm đặt file test trong backend/src/
  if (
    file.startsWith('backend/src/') &&
    /\.(?:spec|test|integration-spec|feature-spec)\.ts$/.test(file)
  ) {
    violations.push({
      rule: 'Rule 3: Test Separation',
      file,
      message: 'CẤM TUYỆT ĐỐI đặt file test trong backend/src/. Phải đặt tại backend/test/{unit,integration,feature}/.',
    });
  }

  // 3b. Kiểm tra cấu trúc bên trong backend/test/
  if (file.startsWith('backend/test/') && file.endsWith('.ts')) {
    const validBackendTestPath =
      file === 'backend/test/setup-env.ts' ||
      /^backend\/test\/concerns\/.+\.ts$/.test(file) ||
      /^backend\/test\/fixtures\/.+\.ts$/.test(file) ||
      /^backend\/test\/unit\/.+\.spec\.ts$/.test(file) ||
      /^backend\/test\/integration\/.+\.integration-spec\.ts$/.test(file) ||
      /^backend\/test\/feature\/.+\.(?:feature-spec|spec)\.ts$/.test(file);

    if (!validBackendTestPath) {
      violations.push({
        rule: 'Rule 3: Invalid Test Path / Suffix',
        file,
        message:
          'File trong backend/test/ phải tuân thủ đúng cấu trúc: unit/*.spec.ts, integration/*.integration-spec.ts, feature/*.feature-spec.ts, hoặc helper trong concerns/ và fixtures/.',
      });
    }
  }
}

// ============================================================================
// [Rule 4]: Sửa code nghiệp vụ Module bắt buộc phải có cập nhật Test đi kèm (CI)
// ============================================================================
if (enforceFeatureTest) {
  const commitMsg = runGit(['log', '-1', '--pretty=%B', range.head || 'HEAD']);
  const skipTestGuard = commitMsg.includes('[skip-test-guard]');

  const touchedModuleLogicFiles = changedFiles.filter((file) =>
    /^backend\/src\/(?:modules|project-modules)\/[^/]+\/.*\.(?:controller|service|repository|processor|use-case|handler)\.ts$/.test(
      file,
    ),
  );

  const touchedBackendTestFiles = changedFiles.filter((file) =>
    /^backend\/test\/(?:unit|integration|feature)\/.+\.(?:spec|integration-spec|feature-spec)\.ts$/.test(
      file,
    ),
  );

  if (
    touchedModuleLogicFiles.length > 0 &&
    touchedBackendTestFiles.length === 0 &&
    !skipTestGuard
  ) {
    violations.push({
      rule: 'Rule 4: Missing Companion Test for Module Logic Change',
      file: touchedModuleLogicFiles.join(', '),
      message:
        'Đã thay đổi code nghiệp vụ trong backend/src/(modules|project-modules) nhưng không có bất kỳ file test nào trong backend/test/{unit,integration,feature} được thêm hoặc cập nhật. (Nếu chỉ sửa log/comment nhỏ, thêm "[skip-test-guard]" vào commit message).',
    });
  }
}

if (violations.length > 0) {
  console.error('\n======================================================================');
  console.error(`✗ [guard-diff] PHÁT HIỆN ${violations.length} VI PHẠM CHẤT LƯỢNG MÃ NGUỒN / TEST:`);
  console.error('======================================================================\n');
  violations.forEach((v, idx) => {
    console.error(`  [${idx + 1}] ${v.rule}`);
    console.error(`      File:   ${v.file}`);
    console.error(`      Chi tiết: ${v.message}\n`);
  });
  process.exit(1);
}

console.log('✓ [guard-diff] Tất cả kiểm tra Diff, Cấu trúc Test và Chống gian lận đều HỢP LỆ.');

