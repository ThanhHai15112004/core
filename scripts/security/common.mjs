#!/usr/bin/env node
/**
 * Tiện ích dùng chung cho toàn bộ bộ quét bảo mật tự động (Mục 15.2):
 * - Đọc `security-policy.json`
 * - Chuyển đổi kết quả sang SARIF 2.1.0 (tương thích GitHub Code Scanning & GitLab)
 * - Che giấu (redact) giá trị secret khi xuất báo cáo
 * - Kiểm tra công cụ ngoài (gitleaks, trivy, semgrep, syft, docker)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(currentDir, '..', '..');
export const DEFAULT_POLICY_PATH = path.join(currentDir, 'security-policy.json');

export function loadSecurityPolicy(policyPath = DEFAULT_POLICY_PATH) {
  const raw = fs.readFileSync(policyPath, 'utf8');
  return JSON.parse(raw);
}

export function getFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export function normalizeRepoPath(filePath) {
  if (!filePath) return '';
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
  return path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
}

export function commandExists(cmd) {
  const res = spawnSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 && Boolean((res.stdout ?? '').trim());
}

export function runGit(gitArgs, cwd = REPO_ROOT) {
  try {
    return execFileSync('git', gitArgs, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

export function redactSecretValue(value) {
  const str = String(value ?? '').trim();
  if (!str) return '***';
  if (str.length <= 8) return `${str.slice(0, 2)}****`;
  return `${str.slice(0, 4)}****${str.slice(-4)}`;
}

export function compileRegexList(patterns = []) {
  return patterns.map((raw) => {
    const str = String(raw);
    if (str.startsWith('(?i)')) {
      return new RegExp(str.slice(4), 'i');
    }
    return new RegExp(str);
  });
}

export function normalizeSeverity(raw) {
  const s = String(raw ?? 'Medium').trim().toLowerCase();
  if (s === 'critical' || s === 'error') return 'Critical';
  if (s === 'high') return 'High';
  if (s === 'medium' || s === 'moderate' || s === 'warning' || s === 'warn') return 'Medium';
  return 'Low';
}

export function severityToSarifLevel(severity) {
  const norm = normalizeSeverity(severity);
  if (norm === 'Critical' || norm === 'High') return 'error';
  if (norm === 'Medium') return 'warning';
  return 'note';
}

export function buildSarifReport({ toolName, toolVersion = '1.0.0', findings = [] }) {
  const rulesMap = new Map();
  const results = [];

  for (const item of findings) {
    const ruleId = String(item.rule || item.ruleId || 'SECURITY-RULE');
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: ruleId,
        shortDescription: { text: String(item.title || item.message || ruleId).slice(0, 200) },
        defaultConfiguration: { level: severityToSarifLevel(item.severity) },
        properties: {
          severity: normalizeSeverity(item.severity),
          category: item.category || toolName,
        },
      });
    }

    const location = item.file
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: String(item.file).replace(/\\/g, '/') },
              region: {
                startLine: Math.max(1, Number(item.line) || 1),
              },
            },
          },
        ]
      : [];

    results.push({
      ruleId,
      level: severityToSarifLevel(item.severity),
      message: { text: String(item.message || ruleId) },
      locations: location,
      properties: {
        status: item.status || 'FAIL',
        severity: normalizeSeverity(item.severity),
        ...(item.slaDueDate ? { slaDueDate: item.slaDueDate } : {}),
        ...(item.remediation ? { remediation: item.remediation } : {}),
      },
    });
  }

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            rules: [...rulesMap.values()],
          },
        },
        results,
      },
    ],
  };
}

export async function writeJsonReport(outPath, payload) {
  const resolved = path.isAbsolute(outPath) ? outPath : path.resolve(REPO_ROOT, outPath);
  await fsp.mkdir(path.dirname(resolved), { recursive: true });
  await fsp.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return resolved;
}

export function walkFiles(dir, { ignorePatterns = [], extensions = null } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const compiledIgnores = compileRegexList(ignorePatterns);

  const visit = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const rel = normalizeRepoPath(fullPath);
      if (compiledIgnores.some((re) => re.test(rel) || re.test(`${rel}/`))) continue;
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
          out.push(fullPath);
        }
      }
    }
  };

  visit(dir);
  return out;
}
