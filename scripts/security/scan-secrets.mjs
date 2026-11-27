#!/usr/bin/env node
/**
 * 15.2.1 — Quét Secret trong source code (Chặn token, API key, private key & password bị commit)
 *
 * Chế độ hỗ trợ:
 *   - `--staged`                    : Quét các dòng staged chuẩn bị commit (dùng cho `.husky/pre-commit`)
 *   - `--diff --base A --head B`    : Quét diff giữa 2 commit trên CI PR/Push
 *   - `--all` (mặc định)            : Quét toàn bộ tệp được Git theo dõi
 *   - `--engine <auto|gitleaks|native>`
 *   - `--report reports/security-secrets-report.json`
 *   - `--sarif reports/security-secrets.sarif`
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
  normalizeRepoPath,
  redactSecretValue,
  runGit,
  writeJsonReport,
} from './common.mjs';

export const SECRET_RULES = [
  {
    id: 'SECRET-PRIVATE-KEY',
    severity: 'Critical',
    description: 'Phát hiện Private Key (RSA/EC/DSA/OPENSSH/PGP) trong mã nguồn',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    id: 'SECRET-AWS-ACCESS-KEY',
    severity: 'Critical',
    description: 'Phát hiện AWS Access Key ID (AKIA/ASIA)',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'SECRET-GITHUB-TOKEN',
    severity: 'Critical',
    description: 'Phát hiện GitHub Personal Access / OAuth / App Token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/,
  },
  {
    id: 'SECRET-GITLAB-TOKEN',
    severity: 'Critical',
    description: 'Phát hiện GitLab Personal Access / Runner Token',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'SECRET-SLACK-TOKEN',
    severity: 'Critical',
    description: 'Phát hiện Slack API Token',
    regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'SECRET-STRIPE-KEY',
    severity: 'Critical',
    description: 'Phát hiện Stripe Live Secret / Restricted Key',
    regex: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/,
  },
  {
    id: 'SECRET-GOOGLE-API-KEY',
    severity: 'High',
    description: 'Phát hiện Google Cloud / Firebase API Key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'SECRET-SENDGRID-KEY',
    severity: 'Critical',
    description: 'Phát hiện SendGrid API Key',
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
  },
  {
    id: 'SECRET-JWT-TOKEN',
    severity: 'High',
    description: 'Phát hiện chuỗi JWT thật bị nhúng cứng trong mã nguồn',
    regex: /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/,
  },
  {
    id: 'SECRET-DB-URI-CREDENTIAL',
    severity: 'Critical',
    description: 'Phát hiện chuỗi kết nối DB/Redis chứa mật khẩu cứng',
    regex: /\b(?:postgres(?:ql)?|mysql|redis|rediss|mongodb(?:\+srv)?):\/\/[a-zA-Z0-9._-]+:([^@\s$'"{}<>]{8,})@[a-zA-Z0-9.-]+/i,
    secretGroup: 1,
  },
  {
    id: 'SECRET-GENERIC-ASSIGNMENT',
    severity: 'High',
    description: 'Phát hiện giá trị password / secret / token / api_key gán cứng có độ ngẫu nhiên cao',
    regex: /(?:^|[\s,{])(?:['"]?(?:password|passwd|db_password|jwt_access_secret|jwt_refresh_secret|api_key|apikey|api_secret|client_secret|access_token|refresh_token|private_key|signing_secret|webhook_secret|encryption_key)['"]?)\s*[:=]\s*['"]([^'"\s]{16,})['"]/i,
    secretGroup: 1,
    requireEntropy: 3.3,
  },
];

export function shannonEntropy(input) {
  const s = String(input ?? '');
  if (!s) return 0;
  const counts = new Map();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function scanTextForSecrets(text, filePath, policy = loadSecurityPolicy()) {
  const rel = normalizeRepoPath(filePath);
  const pathAllow = compileRegexList(policy.secrets?.allowlistPaths ?? []);
  if (pathAllow.some((re) => re.test(rel))) return [];

  const valueAllow = compileRegexList(policy.secrets?.allowlistValuePatterns ?? []);
  const findings = [];
  const lines = String(text ?? '').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!lineText || lineText.length > 4000) continue;
    if (/gitleaks:allow|secret-scan-ok|guard-ok/.test(lineText)) continue;

    for (const rule of SECRET_RULES) {
      const m = rule.regex.exec(lineText);
      if (!m) continue;
      const secretVal = rule.secretGroup ? m[rule.secretGroup] : m[0];
      if (valueAllow.some((re) => re.test(secretVal) || re.test(lineText))) continue;
      if (rule.requireEntropy && shannonEntropy(secretVal) < rule.requireEntropy) continue;

      findings.push({
        rule: rule.id,
        severity: rule.severity,
        status: 'FAIL',
        category: 'Secret Scanning',
        file: rel,
        line: i + 1,
        matchPreview: redactSecretValue(secretVal),
        message: `${rule.description} (giá trị đã che: ${redactSecretValue(secretVal)})`,
        remediation:
          'Xóa secret khỏi mã nguồn, thu hồi/xoay vòng (rotate) khóa bị lộ và đưa vào biến môi trường (.env / CI Secrets).',
      });
      break;
    }
  }

  return findings;
}

function scanAddedDiffLines(diffArgs, policy) {
  const pathAllow = compileRegexList(policy.secrets?.allowlistPaths ?? []);
  const changedRaw = runGit([...diffArgs, '--name-only', '--diff-filter=ACMR']);
  const files = changedRaw ? changedRaw.split('\n').map((f) => f.trim()).filter(Boolean) : [];
  const findings = [];
  let scannedFiles = 0;

  for (const file of files) {
    if (pathAllow.some((re) => re.test(file))) continue;
    const diff = runGit([...diffArgs, '--unified=0', '--', file]);
    if (!diff) continue;
    scannedFiles++;

    let currentLine = 0;
    const addedLines = [];
    for (const rawLine of diff.split('\n')) {
      if (rawLine.startsWith('@@')) {
        const m = /\+(\d+)/.exec(rawLine);
        if (m) currentLine = Number(m[1]) - 1;
        continue;
      }
      if (rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
      if (rawLine.startsWith('+')) {
        currentLine++;
        addedLines.push({ line: currentLine, text: rawLine.slice(1) });
      }
    }

    for (const entry of addedLines) {
      const lineFindings = scanTextForSecrets(entry.text, file, policy);
      for (const f of lineFindings) {
        findings.push({ ...f, line: entry.line });
      }
    }
  }

  return { scannedFiles, findings };
}

function scanAllTrackedFiles(policy) {
  const pathAllow = compileRegexList(policy.secrets?.allowlistPaths ?? []);
  const trackedRaw = runGit(['ls-files']);
  const files = trackedRaw ? trackedRaw.split('\n').map((f) => f.trim()).filter(Boolean) : [];
  const findings = [];
  let scannedFiles = 0;

  for (const rel of files) {
    if (pathAllow.some((re) => re.test(rel))) continue;
    const abs = path.resolve(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;

    // Bỏ qua file nhị phân
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 1024).includes(0)) continue;

    scannedFiles++;
    const fileFindings = scanTextForSecrets(buf.toString('utf8'), rel, policy);
    findings.push(...fileFindings);
  }

  return { scannedFiles, findings };
}

function runGitleaksIfRequested(mode, baseSha, headSha, engine) {
  if (engine === 'native') return { used: false, findings: [] };
  if (!commandExists('gitleaks')) {
    if (engine === 'gitleaks') {
      throw new Error('Không tìm thấy CLI `gitleaks` trên hệ thống.');
    }
    return { used: false, findings: [] };
  }

  const tmpReport = path.resolve(REPO_ROOT, 'reports/.tmp-gitleaks.json');
  fs.mkdirSync(path.dirname(tmpReport), { recursive: true });
  if (fs.existsSync(tmpReport)) fs.unlinkSync(tmpReport);

  const glArgs = ['detect', '--config', '.gitleaks.toml', '--report-format', 'json', '--report-path', tmpReport, '--no-banner'];
  if (mode === 'staged') {
    glArgs.splice(0, 1, 'protect');
    glArgs.push('--staged');
  } else if (mode === 'diff' && baseSha && headSha) {
    glArgs.push('--log-opts', `${baseSha}..${headSha}`);
  } else {
    glArgs.push('--no-git', '--source', '.');
  }

  spawnSync('gitleaks', glArgs, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  let raw = [];
  if (fs.existsSync(tmpReport)) {
    try {
      raw = JSON.parse(fs.readFileSync(tmpReport, 'utf8')) || [];
    } catch {
      raw = [];
    }
    fs.unlinkSync(tmpReport);
  }

  const findings = (Array.isArray(raw) ? raw : []).map((item) => ({
    rule: `GITLEAKS:${item.RuleID || 'secret'}`,
    severity: 'Critical',
    status: 'FAIL',
    category: 'Secret Scanning',
    file: normalizeRepoPath(item.File || ''),
    line: Number(item.StartLine) || 1,
    matchPreview: redactSecretValue(item.Secret || item.Match || ''),
    message: `${item.Description || 'Gitleaks phát hiện secret'} (giá trị đã che: ${redactSecretValue(item.Secret || item.Match || '')})`,
    remediation: 'Xóa secret khỏi mã nguồn/commit, xoay vòng khóa bị lộ và dùng biến môi trường.',
  }));

  return { used: true, findings };
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const mode = args.includes('--staged') ? 'staged' : args.includes('--diff') ? 'diff' : 'all';
  const engine = getFlagValue(args, '--engine') ?? 'auto';
  const baseSha = getFlagValue(args, '--base') ?? process.env.PR_BASE_SHA ?? process.env.BEFORE_SHA ?? '';
  const headSha = getFlagValue(args, '--head') ?? process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA ?? 'HEAD';
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-secrets-report.json';
  const sarifOut = getFlagValue(args, '--sarif') ?? 'reports/security-secrets.sarif';

  let nativeRes;
  if (mode === 'staged') {
    nativeRes = scanAddedDiffLines(['diff', '--cached'], policy);
  } else if (mode === 'diff' && baseSha && !/^0+$/.test(baseSha)) {
    nativeRes = scanAddedDiffLines(['diff', baseSha, headSha], policy);
  } else {
    nativeRes = scanAllTrackedFiles(policy);
  }

  const gitleaksRes = runGitleaksIfRequested(mode, baseSha, headSha, engine);

  // Gộp kết quả & chống trùng theo (file, line)
  const dedup = new Map();
  for (const item of [...gitleaksRes.findings, ...nativeRes.findings]) {
    const key = `${item.file}:${item.line}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  const findings = [...dedup.values()];
  const passed = findings.length === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'Security Secret Scan',
    mode,
    engines: [gitleaksRes.used ? 'gitleaks' : null, 'native-secret-scanner'].filter(Boolean),
    scannedFiles: nativeRes.scannedFiles,
    findingCount: findings.length,
    passed,
    findings,
  };

  if (mode !== 'staged' || args.includes('--report')) {
    await writeJsonReport(reportOut, report);
    await writeJsonReport(
      sarifOut,
      buildSarifReport({ toolName: 'core-secret-scanner', findings }),
    );
  }

  if (!passed) {
    console.error(`\n✗ [security:secrets] PHÁT HIỆN ${findings.length} SECRET / THÔNG TIN NHẠY CẢM TRONG MÃ NGUỒN:`);
    for (const f of findings) {
      console.error(`  - [${f.severity}] ${f.file}:${f.line} (${f.rule}) → ${f.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ [security:secrets] Không phát hiện secret nào bị lộ (mode=${mode}, scanned=${nativeRes.scannedFiles} file(s), engines=${report.engines.join('+')}).`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:secrets] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
