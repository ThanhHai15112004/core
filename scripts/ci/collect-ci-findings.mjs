#!/usr/bin/env node
/**
 * Bộ thu thập & chuẩn hóa lỗi/cảnh báo chi tiết kèm `git blame` + trích đoạn mã nguồn
 * từ toàn bộ các công cụ kiểm tra CI (Prettier, ESLint, TypeScript, Architecture, OpenAPI,
 * Lockfiles, Jest, Live DB+Redis, Oxlint, Hardcode Gate, Vitest).
 *
 * Ngoài việc được import bởi `ci-report.mjs`, script này còn có chế độ CLI `--capture`:
 *   node scripts/ci/collect-ci-findings.mjs --capture <prettier|tsc-be|tsc-fe|fe-hardcode|fe-oxlint|eslint> --out reports/xxx.json -- <command...>
 * Chế độ `--capture` chạy lệnh gốc, in nguyên stdout/stderr, lưu JSON chi tiết VÀ giữ nguyên exit code!
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');

const blameCache = new Map();
const fileLinesCache = new Map();

function normalizeRepoPath(rawPath, defaultPrefix = '') {
  if (!rawPath) return '';
  let p = String(rawPath).replace(/\\/g, '/').trim();
  const absRoot = repoRoot.replace(/\\/g, '/');
  if (p.startsWith(`${absRoot}/`)) {
    p = p.slice(absRoot.length + 1);
  } else if (path.isAbsolute(p)) {
    p = path.relative(repoRoot, p).replace(/\\/g, '/');
  } else if (defaultPrefix && !p.startsWith(`${defaultPrefix}/`)) {
    p = `${defaultPrefix}/${p.replace(/^\.\//, '')}`;
  }
  return p.replace(/^\.\//, '');
}

export function inferModuleFromPath(relPath) {
  const p = String(relPath ?? '').replace(/\\/g, '/');
  const m = p.match(/(?:backend|frontend)\/(?:src|test)\/(?:modules|project-modules|packages|apps|unit|feature|integration)\/([^/]+)/);
  if (m?.[1]) return m[1];
  if (p.startsWith('frontend/')) return 'frontend';
  if (p.startsWith('backend/')) return 'backend';
  if (p.startsWith('scripts/') || p.startsWith('.github/') || p === '.gitlab-ci.yml') return 'ci-infra';
  return 'core';
}

function getCodeSnippet(relPath, lineNum, radius = 1) {
  if (!relPath || !lineNum || lineNum < 1) return '';
  const absPath = path.resolve(repoRoot, relPath);
  let lines = fileLinesCache.get(absPath);
  if (lines === undefined) {
    try {
      lines = fs.readFileSync(absPath, 'utf8').split('\n');
    } catch {
      lines = null;
    }
    fileLinesCache.set(absPath, lines);
  }
  if (!lines) return '';

  const start = Math.max(1, lineNum - radius);
  const end = Math.min(lines.length, lineNum + radius);
  const out = [`[${relPath}:L${lineNum}]`];
  for (let l = start; l <= end; l++) {
    const marker = l === lineNum ? '>>' : '  ';
    const text = (lines[l - 1] ?? '').slice(0, 140);
    out.push(`${marker} L${l}: ${text}`);
  }
  return out.join('\n');
}

function getGitBlameInfo(relPath, lineNum) {
  const empty = { author: 'N/A', commit: '', commitDate: '', commitSummary: '' };
  if (!relPath) return empty;
  const safeLine = lineNum && lineNum > 0 ? lineNum : 1;
  const cacheKey = `${relPath}:${safeLine}`;
  if (blameCache.has(cacheKey)) return blameCache.get(cacheKey);

  try {
    const raw = execFileSync(
      'git',
      ['blame', '-L', `${safeLine},${safeLine}`, '--porcelain', '--', relPath],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const lines = raw.split('\n');
    const sha = (lines[0] ?? '').split(' ')[0] ?? '';
    let author = 'Unknown';
    let authorTime = 0;
    let summary = '';
    for (const l of lines) {
      if (l.startsWith('author ')) author = l.slice(7).trim();
      else if (l.startsWith('author-time ')) authorTime = Number(l.slice(12).trim()) || 0;
      else if (l.startsWith('summary ')) summary = l.slice(8).trim();
    }
    const commitDate = authorTime
      ? new Date(authorTime * 1000).toISOString().slice(0, 16).replace('T', ' ')
      : '';
    const info = {
      author: author || 'Unknown',
      commit: sha && !/^0+$/.test(sha) ? sha.slice(0, 9) : 'uncommitted',
      commitDate,
      commitSummary: summary,
    };
    blameCache.set(cacheKey, info);
    return info;
  } catch {
    blameCache.set(cacheKey, empty);
    return empty;
  }
}

export function getGitContext() {
  const run = (args) => {
    try {
      return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  return {
    branch: process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_BRANCH || run(['branch', '--show-current']) || 'HEAD',
    sha: (process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || run(['rev-parse', 'HEAD'])).slice(0, 9),
    author: run(['log', '-1', '--pretty=%an']) || 'CI',
    commitMessage: run(['log', '-1', '--pretty=%s']) || '',
    runUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : process.env.CI_PIPELINE_URL || 'local',
  };
}

function suggestFix(gate, rule, message) {
  const r = String(rule ?? '');
  if (gate === 'Prettier') return 'Chạy `npm --prefix backend run format` để tự động định dạng theo .prettierrc.';
  if (r.includes('no-explicit-any')) return 'Thay kiểu `any` bằng interface/type cụ thể hoặc `unknown` + type guard.';
  if (r.includes('no-unused-vars')) return 'Xóa biến/import thừa hoặc thêm tiền tố `_` nếu tham số bắt buộc theo chữ ký.';
  if (r.includes('exhaustive-deps')) return 'Bọc hàm bằng `useCallback` hoặc bổ sung dependency còn thiếu vào mảng useEffect.';
  if (gate === 'FE Hardcode Gate') return 'Chuyển chuỗi hiển thị sang `t(...)` (i18n) hoặc màu sang token theme; thêm `hardcode-ok` nếu chủ đích.';
  if (gate.startsWith('TypeScript')) return 'Sửa kiểu dữ liệu / thuộc tính bắt buộc theo định nghĩa TypeScript và chạy `npm run typecheck`.';
  if (gate === 'Architecture') return 'Tuân thủ ranh giới Modular Monolith: giao tiếp xuyên module qua Public Service / Domain Event, không import nội bộ.';
  if (gate === 'OpenAPI Contract') {
    return r.startsWith('ENDPOINT_ADDED') || r.startsWith('OPTIONAL_') || r.startsWith('RESPONSE_FIELD_ADDED')
      ? 'Thay đổi tương thích ngược (additive) — chạy `npm --prefix backend run openapi:export` nếu cần cập nhật baseline.'
      : 'Breaking change API — giữ trường/endpoint cũ với trạng thái deprecated hoặc nâng phiên bản API (v2).';
  }
  if (gate === 'Lockfile') return 'Chạy `npm install --package-lock-only` trong thư mục tương ứng và commit lại `package-lock.json`.';
  if (gate.includes('Test')) return 'Xem stack trace lỗi, sửa logic hoặc cập nhật fixture/mock rồi chạy lại test suite tương ứng.';
  return message ? `Kiểm tra và xử lý theo thông báo: ${String(message).slice(0, 120)}` : 'Kiểm tra log CI chi tiết.';
}

function createFinding({ prefix, index, status, severity, gate, file, line, rule, message, extraDetail }) {
  const relPath = file ? normalizeRepoPath(file) : '';
  const lineNum = Number(line) || null;
  const location = relPath ? (lineNum ? `${relPath}:L${lineNum}` : relPath) : '-';
  const snippet = relPath && lineNum ? getCodeSnippet(relPath, lineNum, 1) : '';
  const blame = relPath ? getGitBlameInfo(relPath, lineNum) : { author: 'N/A', commit: '', commitDate: '', commitSummary: '' };
  const evidenceParts = [];
  if (snippet) evidenceParts.push(snippet);
  if (message) evidenceParts.push(`Chi tiết: ${message}`);
  if (extraDetail) evidenceParts.push(extraDetail);

  return {
    code: `${prefix}-${String(index).padStart(2, '0')}`,
    status, // FAIL | WARN | INFO
    severity, // Critical | High | Medium | Low
    gate,
    module: inferModuleFromPath(relPath),
    location,
    evidence: evidenceParts.join('\n\n'),
    rule: rule || '-',
    author: blame.author,
    commit: blame.commit,
    commitDate: blame.commitDate,
    commitSummary: blame.commitSummary,
    suggestion: suggestFix(gate, rule, message),
  };
}

/**
 * Thu thập tất cả findings & testCases từ các file báo cáo JSON của CI.
 */
export function collectNormalizedArtifacts(artifacts) {
  const findings = [];
  const testCases = [];
  const counters = {};
  const nextIdx = (p) => {
    counters[p] = (counters[p] ?? 0) + 1;
    return counters[p];
  };

  // 1. Lockfiles
  for (const target of artifacts.lockfile?.targets ?? []) {
    for (const issue of target.issues ?? []) {
      findings.push(
        createFinding({
          prefix: 'LOCK',
          index: nextIdx('LOCK'),
          status: 'FAIL',
          severity: 'Critical',
          gate: 'Lockfile',
          file: `${target.dir === '.' ? '' : `${target.dir}/`}package-lock.json`,
          line: 1,
          rule: 'LOCKFILE_SYNC',
          message: issue,
        }),
      );
    }
  }

  // 2. Prettier (Backend)
  for (const file of artifacts.prettier?.unformattedFiles ?? []) {
    findings.push(
      createFinding({
        prefix: 'FMT',
        index: nextIdx('FMT'),
        status: 'FAIL',
        severity: 'Low',
        gate: 'Prettier',
        file: normalizeRepoPath(file, 'backend'),
        line: 1,
        rule: 'prettier/format',
        message: 'Tệp chưa tuân thủ định dạng Prettier chuẩn của dự án.',
      }),
    );
  }

  // 3. ESLint (Backend) — mảng kết quả từ `eslint -f json`
  if (Array.isArray(artifacts.eslint)) {
    for (const fileRes of artifacts.eslint) {
      for (const msg of fileRes.messages ?? []) {
        const isErr = msg.severity === 2;
        findings.push(
          createFinding({
            prefix: 'ESL',
            index: nextIdx('ESL'),
            status: isErr ? 'FAIL' : 'WARN',
            severity: isErr ? 'High' : 'Medium',
            gate: 'ESLint (BE)',
            file: fileRes.filePath,
            line: msg.line,
            rule: msg.ruleId || 'eslint',
            message: msg.message,
          }),
        );
      }
    }
  }

  // 4. TypeScript Typecheck (BE & FE)
  for (const [key, gateName, defaultPrefix] of [
    ['typecheckBe', 'TypeScript (BE)', 'backend'],
    ['typecheckFe', 'TypeScript (FE)', 'frontend'],
  ]) {
    for (const item of artifacts[key]?.errors ?? []) {
      findings.push(
        createFinding({
          prefix: 'TS',
          index: nextIdx('TS'),
          status: 'FAIL',
          severity: 'Critical',
          gate: gateName,
          file: normalizeRepoPath(item.file, defaultPrefix),
          line: item.line,
          rule: item.code || 'TS',
          message: item.message,
        }),
      );
    }
  }

  // 5. Architecture Boundary Violations
  for (const v of artifacts.architecture?.violations ?? []) {
    findings.push(
      createFinding({
        prefix: 'ARCH',
        index: nextIdx('ARCH'),
        status: 'FAIL',
        severity: 'Critical',
        gate: 'Architecture',
        file: normalizeRepoPath(v.file, 'backend'),
        line: v.line ?? 1,
        rule: v.rule,
        message: v.message,
      }),
    );
  }

  // 6. OpenAPI Breaking & Non-Breaking Changes
  for (const b of artifacts.openapi?.breakingChanges ?? []) {
    findings.push(
      createFinding({
        prefix: 'API',
        index: nextIdx('API'),
        status: 'FAIL',
        severity: 'Critical',
        gate: 'OpenAPI Contract',
        file: 'backend/openapi/openapi.v1.json',
        line: 1,
        rule: b.rule,
        message: `[${b.method} ${b.path}${b.field ? ` • ${b.field}` : ''}] ${b.message}`,
      }),
    );
  }
  for (const nb of artifacts.openapi?.nonBreakingChanges ?? []) {
    findings.push(
      createFinding({
        prefix: 'API',
        index: nextIdx('API'),
        status: 'INFO',
        severity: 'Low',
        gate: 'OpenAPI Contract',
        file: 'backend/openapi/openapi.v1.json',
        line: 1,
        rule: nb.rule,
        message: `[${nb.method} ${nb.path}${nb.field ? ` • ${nb.field}` : ''}] ${nb.message}`,
      }),
    );
  }

  // 7. Frontend Oxlint (`oxlint --format json`)
  for (const diag of artifacts.feOxlint?.diagnostics ?? []) {
    const isErr = String(diag.severity).toLowerCase() === 'error';
    const firstLabel = diag.labels?.[0];
    const line = firstLabel?.span?.line ?? 1;
    findings.push(
      createFinding({
        prefix: 'OX',
        index: nextIdx('OX'),
        status: isErr ? 'FAIL' : 'WARN',
        severity: isErr ? 'High' : 'Low',
        gate: 'Oxlint (FE)',
        file: normalizeRepoPath(diag.filename, 'frontend'),
        line,
        rule: diag.code || 'oxlint',
        message: diag.message,
        extraDetail: diag.help ? `Gợi ý Oxlint: ${diag.help}` : '',
      }),
    );
  }

  // 8. Frontend Hardcode Gate
  for (const item of artifacts.feHardcode?.violations ?? []) {
    findings.push(
      createFinding({
        prefix: 'FEHC',
        index: nextIdx('FEHC'),
        status: 'FAIL',
        severity: 'Medium',
        gate: 'FE Hardcode Gate',
        file: normalizeRepoPath(item.file, 'frontend'),
        line: item.line,
        rule: item.kind || 'hardcode',
        message: item.snippet || item.message,
      }),
    );
  }

  // 9. Jest & Vitest Test Results (mỗi test case đều ghi vào sheet Chi_Tiet_Test_Suites; nếu FAIL ghi luôn vào Chi_Tiet_Loi_Canh_Bao!)
  const parseTestRunnerJson = (rawJson, groupLabel, defaultPrefix) => {
    if (!rawJson || !Array.isArray(rawJson.testResults)) return;
    for (const suite of rawJson.testResults) {
      const suiteFile = normalizeRepoPath(suite.name, defaultPrefix);
      const moduleName = inferModuleFromPath(suiteFile);
      const assertions = suite.assertionResults ?? [];

      if (assertions.length === 0 && suite.status === 'failed') {
        const errMsg = String(suite.message ?? 'Test suite failed to execute').slice(0, 600);
        testCases.push({
          group: groupLabel,
          module: moduleName,
          file: suiteFile,
          title: '[Suite Setup / Load Failure]',
          status: 'FAIL',
          durationMs: 0,
          error: errMsg,
        });
        findings.push(
          createFinding({
            prefix: 'TEST',
            index: nextIdx('TEST'),
            status: 'FAIL',
            severity: 'Critical',
            gate: `${groupLabel} Test`,
            file: suiteFile,
            line: 1,
            rule: 'TEST_SUITE_FAILED',
            message: errMsg,
          }),
        );
        continue;
      }

      for (const a of assertions) {
        const st =
          a.status === 'passed'
            ? 'PASS'
            : a.status === 'failed'
              ? 'FAIL'
              : 'SKIPPED';
        const fullTitle = a.fullName || [...(a.ancestorTitles ?? []), a.title].filter(Boolean).join(' › ');
        const errText = Array.isArray(a.failureMessages) && a.failureMessages.length > 0
          ? a.failureMessages.join('\n').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 600)
          : '';
        const durationMs = Math.round(Number(a.duration ?? 0));

        testCases.push({
          group: groupLabel,
          module: moduleName,
          file: suiteFile,
          title: fullTitle,
          status: st,
          durationMs,
          error: errText || '-',
        });

        if (st === 'FAIL') {
          findings.push(
            createFinding({
              prefix: 'TEST',
              index: nextIdx('TEST'),
              status: 'FAIL',
              severity: 'Critical',
              gate: `${groupLabel} Test`,
              file: suiteFile,
              line: a.location?.line ?? 1,
              rule: 'ASSERTION_FAILED',
              message: `${fullTitle}\n${errText}`,
            }),
          );
        }
      }
    }
  };

  parseTestRunnerJson(artifacts.jestMain, 'Backend Unit/Feature', 'backend');
  parseTestRunnerJson(artifacts.jestLive, 'Backend Live DB+Redis', 'backend');
  parseTestRunnerJson(artifacts.vitest, 'Frontend Vitest', 'frontend');

  return { findings, testCases };
}

// ============================================================================
// Chế độ CLI `--capture`: Chạy lệnh gốc, lưu báo cáo JSON, giữ nguyên exit code
// ============================================================================
function parseTscErrors(output) {
  const errors = [];
  const re = /^([^\s(][^(\n]*)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  let m;
  while ((m = re.exec(output)) !== null) {
    errors.push({
      file: m[1].trim(),
      line: Number(m[2]),
      column: Number(m[3]),
      code: m[4],
      message: m[5].trim(),
    });
  }
  return errors;
}

function parseFeHardcode(output) {
  const violations = [];
  const re = /^([^\s:]+\.[jt]sx?):(\d+)\s+\[([^\]]+)\]\s+(.+)$/gm;
  let m;
  while ((m = re.exec(output)) !== null) {
    violations.push({
      file: m[1].trim(),
      line: Number(m[2]),
      kind: m[3].trim(),
      snippet: m[4].trim(),
    });
  }
  return violations;
}

async function runCaptureCli() {
  const args = process.argv.slice(2);
  const capIdx = args.indexOf('--capture');
  if (capIdx < 0) return;

  const kind = args[capIdx + 1];
  const outIdx = args.indexOf('--out');
  const outArg = outIdx >= 0 ? args[outIdx + 1] : null;
  const cwdIdx = args.indexOf('--cwd');
  const cwdArg = cwdIdx >= 0 ? path.resolve(repoRoot, args[cwdIdx + 1]) : process.cwd();
  const sepIdx = args.indexOf('--');
  const cmdParts = sepIdx >= 0 ? args.slice(sepIdx + 1) : [];

  if (!kind || !outArg || cmdParts.length === 0) {
    console.error('Usage: node scripts/ci/collect-ci-findings.mjs --capture <kind> --out <file> [--cwd <dir>] -- <cmd...>');
    process.exit(2);
  }

  const res = spawnSync(cmdParts[0], cmdParts.slice(1), {
    cwd: cwdArg,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const exitCode = res.status ?? 1;
  const outPath = path.isAbsolute(outArg) ? outArg : path.resolve(repoRoot, outArg);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  let payload;
  if (kind === 'prettier') {
    const files = (res.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && /\.[cm]?[jt]sx?$/.test(l));
    payload = { generatedAt: new Date().toISOString(), passed: exitCode === 0, unformattedFiles: files };
  } else if (kind === 'tsc-be' || kind === 'tsc-fe') {
    const errors = parseTscErrors(combined);
    payload = { generatedAt: new Date().toISOString(), passed: exitCode === 0, errorCount: errors.length, errors };
  } else if (kind === 'fe-hardcode') {
    const violations = parseFeHardcode(combined);
    payload = { generatedAt: new Date().toISOString(), passed: exitCode === 0, violationCount: violations.length, violations };
  } else if (kind === 'fe-oxlint') {
    try {
      payload = JSON.parse(res.stdout || '{"diagnostics":[]}');
    } catch {
      payload = { diagnostics: [] };
    }
  } else {
    payload = { generatedAt: new Date().toISOString(), passed: exitCode === 0, exitCode };
  }

  await fsp.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.exit(exitCode);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runCaptureCli().catch((err) => {
    console.error('✗ [collect-ci-findings] Unexpected error:', err);
    process.exit(1);
  });
}
