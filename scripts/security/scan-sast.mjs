#!/usr/bin/env node
/**
 * 15.2.3 — Quét mã nguồn bằng SAST (Tìm lỗi bảo mật phổ biến OWASP / TypeScript / Node.js / React)
 *
 * - Tự động gọi `semgrep` nếu có trên máy / CI (`p/owasp-top-ten`, `p/typescript`, `p/nodejs`, `p/react`).
 * - Luôn chạy bộ phân tích SAST nội bộ (zero-dependency) để hoạt động ổn định cả Local lẫn offline.
 * - Hỗ trợ chú thích miễn trừ có lý do: `// sast-ok: <lý do>` hoặc `/* sast-ok *\/`.
 * - Xuất JSON (`reports/security-sast-report.json`) & SARIF 2.1.0 (`reports/security-sast.sarif`).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  buildSarifReport,
  commandExists,
  getFlagValue,
  loadSecurityPolicy,
  normalizeRepoPath,
  normalizeSeverity,
  walkFiles,
  writeJsonReport,
} from './common.mjs';

export const SAST_RULES = [
  {
    id: 'SAST-CODE-INJECTION-EVAL',
    severity: 'High',
    description: 'Sử dụng eval() hoặc new Function() có nguy cơ thực thi mã tùy ý (Code Injection)',
    regex: /(?:^|[^.\w$]|(?:globalThis|window|global)\.)eval\s*\(|\bnew\s+Function\s*\(/,
    remediation: 'Loại bỏ eval()/new Function(); thay bằng JSON.parse() hoặc ánh xạ hàm tường minh.',
  },
  {
    id: 'SAST-CMD-INJECTION-SHELL',
    severity: 'High',
    description: 'Gọi shell command bằng exec/execSync có nội suy biến trực tiếp (Command Injection)',
    regex: /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/,
    remediation: 'Thay bằng execFile / execFileSync / spawnSync với mảng tham số args[] và không bật shell: true.',
  },
  {
    id: 'SAST-SQL-RAW-INTERPOLATION',
    severity: 'High',
    description: 'Truy vấn SQL thô có nội suy giá trị trực tiếp trong mệnh đề WHERE/VALUES/SET/LIKE (nguy cơ SQL Injection)',
    regex: /\.(?:query|execute)\s*\(\s*`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\b(?:WHERE|VALUES|SET|LIKE|HAVING)\b[^`]*\$\{/i,
    remediation: 'Sử dụng parameterized query ($1, ?, :param) hoặc QueryBuilder với setParameters().',
  },
  {
    id: 'SAST-SQL-IDENTIFIER-INTERPOLATION',
    severity: 'Medium',
    description: 'Truy vấn SQL thô có nội suy định danh bảng/cột/DDL `${...}` — cần đảm bảo đã kiểm tra allowlist',
    regex: /\.(?:query|execute)\s*\(\s*`(?![^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\b(?:WHERE|VALUES|SET|LIKE|HAVING)\b[^`]*\$\{)[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[^`]*\$\{/i,
    remediation: 'Xác minh định danh qua regex allowlist nghiêm ngặt (ví dụ /^[a-zA-Z0-9_]+$/) hoặc ghi `// sast-ok: validated identifier`.',
  },
  {
    id: 'SAST-XSS-DANGEROUS-HTML',
    severity: 'High',
    description: 'Sử dụng dangerouslySetInnerHTML / document.write / innerHTML trực tiếp (nguy cơ XSS)',
    regex: /\bdangerouslySetInnerHTML\b|\bdocument\.write\s*\(|\.\b(?:innerHTML|outerHTML)\s*=/,
    remediation: 'Tránh chèn HTML thô; nếu bắt buộc, phải sanitize bằng DOMPurify/allowlist trước khi render.',
  },
  {
    id: 'SAST-TLS-VERIFY-DISABLED',
    severity: 'High',
    description: 'Vô hiệu hóa xác thực chứng chỉ TLS (rejectUnauthorized: false / NODE_TLS_REJECT_UNAUTHORIZED=0)',
    regex: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/,
    remediation: 'Bật xác thực TLS mặc định; nếu dùng chứng chỉ nội bộ hãy nạp CA bundle qua NODE_EXTRA_CA_CERTS.',
  },
  {
    id: 'SAST-OPEN-CORS-CREDENTIALS',
    severity: 'High',
    description: 'Cấu hình CORS wildcard (*) đi kèm credentials: true',
    regex: /origin\s*:\s*['"]\*['"][^}\n]*credentials\s*:\s*true|credentials\s*:\s*true[^}\n]*origin\s*:\s*['"]\*['"]/,
    remediation: 'Chỉ định danh sách origin allowlist rõ ràng khi bật credentials: true.',
  },
  {
    id: 'SAST-PROTO-POLLUTION',
    severity: 'Medium',
    description: 'Truy cập/gán thuộc tính __proto__ hoặc constructor.prototype có nguy cơ Prototype Pollution',
    regex: /\[\s*['"]__proto__['"]\s*\]|\.__proto__\s*=|constructor\s*\[\s*['"]prototype['"]\s*\]/,
    remediation: 'Dùng Object.create(null) hoặc Map, và lọc bỏ các khóa __proto__, constructor, prototype từ input.',
  },
  {
    id: 'SAST-WEAK-HASH-CRYPTO',
    severity: 'Medium',
    description: 'Phát hiện sử dụng thuật toán băm yếu MD5/SHA1 (createHash)',
    regex: /\bcreateHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
    remediation: 'Dùng SHA-256/SHA-512 cho integrity hoặc Argon2/scrypt/bcrypt cho mật khẩu; nếu chỉ dùng ETag không nhạy cảm hãy ghi `// sast-ok: non-crypto`.',
  },
  {
    id: 'SAST-INSECURE-HTTP-URL',
    severity: 'Low',
    description: 'Hardcode URL HTTP không mã hóa tới dịch vụ bên ngoài (ngoài localhost/127.0.0.1)',
    regex: /['"]http:\/\/(?!localhost\b|127\.0\.0\.1\b|0\.0\.0\.0\b|prometheus\b|redis\b|backend\b|core-|schemas\.|www\.w3\.org|purl\.org|example\.com)[^'"\s]+['"]/,
    remediation: 'Chuyển sang HTTPS hoặc cấu hình URL qua biến môi trường.',
  },
];

export function scanSourceForSast(content, filePath, policy = loadSecurityPolicy()) {
  const rel = normalizeRepoPath(filePath);
  const failSet = new Set((policy.sast?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const findings = [];
  const lines = String(content ?? '').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (/sast-ok|nosemgrep/.test(raw)) continue;

    for (const rule of SAST_RULES) {
      if (!rule.regex.test(raw)) continue;
      const severity = normalizeSeverity(rule.severity);
      const status = failSet.has(severity) ? 'FAIL' : 'WARN';
      findings.push({
        rule: rule.id,
        severity,
        status,
        category: 'SAST',
        file: rel,
        line: i + 1,
        message: rule.description,
        remediation: rule.remediation,
      });
    }
  }

  return findings;
}

function runSemgrepIfAvailable(policy, engine) {
  if (engine === 'native') return { used: false, findings: [] };
  if (!commandExists('semgrep')) {
    if (engine === 'semgrep') {
      throw new Error('Không tìm thấy CLI `semgrep` trên hệ thống.');
    }
    return { used: false, findings: [] };
  }

  const failSet = new Set((policy.sast?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const configs = policy.sast?.semgrepConfigs ?? ['p/owasp-top-ten', 'p/typescript'];
  const scanDirs = (policy.sast?.scanDirs ?? ['backend/src', 'frontend/src']).filter((d) =>
    fs.existsSync(path.resolve(REPO_ROOT, d)),
  );

  const sgArgs = ['scan', '--json', '--quiet', '--metrics=off'];
  for (const cfg of configs) {
    sgArgs.push('--config', cfg);
  }
  sgArgs.push(...scanDirs);

  const res = spawnSync('semgrep', sgArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout || '{}');
  } catch {
    parsed = null;
  }

  const findings = (parsed?.results ?? []).map((item) => {
    const rawSev = item.extra?.severity || 'WARNING';
    const severity =
      rawSev === 'ERROR' ? 'High' : rawSev === 'WARNING' ? 'Medium' : 'Low';
    return {
      rule: `SEMGREP:${item.check_id || 'rule'}`,
      severity,
      status: failSet.has(severity) ? 'FAIL' : 'WARN',
      category: 'SAST',
      file: normalizeRepoPath(item.path || ''),
      line: Number(item.start?.line) || 1,
      message: item.extra?.message || item.check_id || 'Semgrep security finding',
      remediation: 'Kiểm tra khuyến nghị OWASP/Semgrep và xử lý theo đúng chuẩn an toàn đầu vào.',
    };
  });

  return { used: true, findings };
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const engine = getFlagValue(args, '--engine') ?? 'auto';
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-sast-report.json';
  const sarifOut = getFlagValue(args, '--sarif') ?? 'reports/security-sast.sarif';

  const scanDirs = policy.sast?.scanDirs ?? ['backend/src', 'frontend/src', 'scripts'];
  const ignorePatterns = policy.sast?.ignorePaths ?? [];
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  const nativeFindings = [];
  let scannedFiles = 0;

  for (const dirRel of scanDirs) {
    const files = walkFiles(path.resolve(REPO_ROOT, dirRel), {
      ignorePatterns,
      extensions: exts,
    });
    for (const fileAbs of files) {
      scannedFiles++;
      const content = fs.readFileSync(fileAbs, 'utf8');
      nativeFindings.push(...scanSourceForSast(content, fileAbs, policy));
    }
  }

  const semgrepRes = runSemgrepIfAvailable(policy, engine);

  const dedup = new Map();
  for (const item of [...semgrepRes.findings, ...nativeFindings]) {
    const key = `${item.file}:${item.line}:${item.rule}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  const findings = [...dedup.values()];
  const failCount = findings.filter((f) => f.status === 'FAIL').length;
  const warnCount = findings.filter((f) => f.status === 'WARN').length;
  const passed = failCount === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'Security SAST Scan',
    engines: [semgrepRes.used ? 'semgrep' : null, 'native-sast'].filter(Boolean),
    scannedFiles,
    summary: {
      total: findings.length,
      fail: failCount,
      warn: warnCount,
    },
    passed,
    findings,
  };

  await writeJsonReport(reportOut, report);
  await writeJsonReport(sarifOut, buildSarifReport({ toolName: 'core-sast-scanner', findings }));

  if (!passed) {
    console.error(`\n✗ [security:sast] PHÁT HIỆN ${failCount} LỖI SAST VƯỢT NGƯỠNG CHẶN (warn=${warnCount}):`);
    for (const f of findings.filter((x) => x.status === 'FAIL').slice(0, 20)) {
      console.error(`  - [${f.severity}] ${f.file}:${f.line} (${f.rule}) → ${f.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ [security:sast] SAST đạt yêu cầu (scanned=${scannedFiles} file(s), fail=${failCount}, warn=${warnCount}, engines=${report.engines.join('+')}).`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:sast] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
