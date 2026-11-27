#!/usr/bin/env node
/**
 * 15.2.5 — Quét cấu hình hạ tầng (IaC: Dockerfile, Docker Compose, Kubernetes YAML & Terraform *.tf)
 *
 * - Tự động gọi `trivy config` nếu hệ thống/CI đã cài đặt Trivy.
 * - Luôn chạy bộ kiểm tra IaC nội bộ trên toàn bộ tệp hạ tầng của dự án.
 * - Xuất JSON (`reports/security-iac-report.json`) & SARIF 2.1.0 (`reports/security-iac.sarif`).
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

function makeFinding(failSet, { rule, severity, file, line, message, remediation }) {
  const norm = normalizeSeverity(severity);
  return {
    rule,
    severity: norm,
    status: failSet.has(norm) ? 'FAIL' : 'WARN',
    category: 'IaC Security',
    file: normalizeRepoPath(file),
    line: Number(line) || 1,
    message,
    remediation,
  };
}

export function scanDockerfile(content, filePath, policy = loadSecurityPolicy()) {
  const failSet = new Set((policy.iac?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const findings = [];
  const lines = String(content ?? '').split('\n');
  const rel = normalizeRepoPath(filePath);
  const isProdBackend = /Dockerfile\.prod$|^Dockerfile$/.test(rel) && !rel.includes('frontend') && !rel.includes('nginx');

  let lastStageStartLine = 1;
  let lastStageHasNonRootUser = false;
  let lastStageHasHealthcheck = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || /iac-ok/.test(raw)) continue;

    if (/^FROM\s+/i.test(trimmed)) {
      lastStageStartLine = i + 1;
      lastStageHasNonRootUser = false;
      lastStageHasHealthcheck = false;
      if (/:latest(\s|$)/i.test(trimmed)) {
        findings.push(
          makeFinding(failSet, {
            rule: 'IAC-DOCKER-LATEST-TAG',
            severity: 'Medium',
            file: rel,
            line: i + 1,
            message: 'Base image sử dụng tag `:latest` gây rủi ro build không ổn định.',
            remediation: 'Ghim phiên bản cụ thể (ví dụ `node:22-alpine` hoặc digest SHA256).',
          }),
        );
      }
    }

    if (/^USER\s+(\S+)/i.test(trimmed)) {
      const user = trimmed.replace(/^USER\s+/i, '').trim().toLowerCase();
      if (user === 'root' || user === '0' || user.startsWith('0:')) {
        findings.push(
          makeFinding(failSet, {
            rule: 'IAC-DOCKER-ROOT-USER',
            severity: 'High',
            file: rel,
            line: i + 1,
            message: 'Dockerfile chuyển tường minh sang `USER root` làm tăng rủi ro leo thang đặc quyền.',
            remediation: 'Chạy container dưới user không đặc quyền (ví dụ `USER node`).',
          }),
        );
        lastStageHasNonRootUser = false;
      } else {
        lastStageHasNonRootUser = true;
      }
    }

    if (/^HEALTHCHECK\s+/i.test(trimmed)) {
      lastStageHasHealthcheck = true;
    }

    if (/^(?:ENV|ARG)\s+.*(?:PASSWORD|SECRET|API_KEY|PRIVATE_KEY|TOKEN)\s*=\s*['"]?[^'"\s$]{8,}/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-DOCKER-HARDCODED-SECRET',
          severity: 'Critical',
          file: rel,
          line: i + 1,
          message: 'Phát hiện bí mật/mật khẩu gán cứng trong lệnh ENV/ARG của Dockerfile.',
          remediation: 'Truyền bí mật ở runtime qua env/secret manager, không nhúng vào image layer.',
        }),
      );
    }

    if (/^RUN\s+.*(?:curl|wget)[^|]*\|\s*(?:sh|bash)\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-DOCKER-PIPE-TO-SHELL',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: 'Tải script từ mạng và pipe thẳng vào shell (`curl | sh`) không kiểm tra chữ ký/checksum.',
          remediation: 'Tải gói từ repository chính thức (apk/apt) hoặc xác minh SHA256 trước khi chạy.',
        }),
      );
    }

    if (/^RUN\s+.*chmod\s+(?:-R\s+)?0?777\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-DOCKER-CHMOD-777',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: 'Cấp quyền `chmod 777` quá rộng bên trong image.',
          remediation: 'Chỉ cấp quyền tối thiểu cần thiết (ví dụ `755` hoặc `640` với đúng owner).',
        }),
      );
    }

    if (/^ADD\s+https?:\/\//i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-DOCKER-ADD-URL',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: 'Lệnh `ADD` tải tệp từ URL không kiểm tra tính toàn vẹn.',
          remediation: 'Dùng `COPY` từ build context hoặc tải kèm kiểm tra SHA256.',
        }),
      );
    }
  }

  if (isProdBackend && !lastStageHasNonRootUser) {
    findings.push(
      makeFinding(failSet, {
        rule: 'IAC-DOCKER-MISSING-USER',
        severity: 'High',
        file: rel,
        line: lastStageStartLine,
        message: 'Stage production cuối cùng chưa khai báo `USER` non-root.',
        remediation: 'Thêm `USER node` (hoặc user không đặc quyền) trước CMD/ENTRYPOINT.',
      }),
    );
  }

  if (isProdBackend && !lastStageHasHealthcheck) {
    findings.push(
      makeFinding(failSet, {
        rule: 'IAC-DOCKER-MISSING-HEALTHCHECK',
        severity: 'Low',
        file: rel,
        line: lastStageStartLine,
        message: 'Stage production chưa khai báo lệnh `HEALTHCHECK`.',
        remediation: 'Bổ sung `HEALTHCHECK` kiểm tra endpoint `/api/v1/health`.',
      }),
    );
  }

  return findings;
}

export function scanCompose(content, filePath, policy = loadSecurityPolicy()) {
  const failSet = new Set((policy.iac?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const findings = [];
  const lines = String(content ?? '').split('\n');
  const rel = normalizeRepoPath(filePath);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || /iac-ok/.test(raw)) continue;

    if (/^privileged\s*:\s*true\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-COMPOSE-PRIVILEGED',
          severity: 'Critical',
          file: rel,
          line: i + 1,
          message: 'Container chạy chế độ `privileged: true` toàn quyền trên host.',
          remediation: 'Bỏ `privileged: true` và chỉ cấp capability tối thiểu nếu bắt buộc.',
        }),
      );
    }

    if (/^(?:network_mode|pid|ipc)\s*:\s*['"]?host['"]?/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-COMPOSE-HOST-NAMESPACE',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: `Container chia sẻ namespace của host (${trimmed}).`,
          remediation: 'Sử dụng bridge network cô lập của Docker Compose thay vì host namespace.',
        }),
      );
    }

    if (/\/var\/run\/docker\.sock/.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-COMPOSE-DOCKER-SOCKET',
          severity: 'Critical',
          file: rel,
          line: i + 1,
          message: 'Mount `/var/run/docker.sock` vào container cho phép kiểm soát toàn bộ Docker daemon.',
          remediation: 'Loại bỏ mount Docker socket khỏi container ứng dụng.',
        }),
      );
    }

    if (/^\-\s*(?:ALL|SYS_ADMIN|NET_ADMIN)\s*$/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-COMPOSE-DANGEROUS-CAP',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: `Cấp Linux capability nguy hiểm (${trimmed}).`,
          remediation: 'Loại bỏ capability không cần thiết và dùng `cap_drop: [ALL]`.',
        }),
      );
    }

    if (/^image\s*:\s*\S+:latest\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-COMPOSE-LATEST-IMAGE',
          severity: 'Medium',
          file: rel,
          line: i + 1,
          message: `Image dùng tag \`:latest\` (${trimmed}) khó kiểm soát phiên bản & bản vá.`,
          remediation: 'Ghim tag phiên bản cố định (ví dụ `certbot/certbot:v3.2.0`).',
        }),
      );
    }
  }

  return findings;
}

export function scanKubernetes(content, filePath, policy = loadSecurityPolicy()) {
  const failSet = new Set((policy.iac?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const findings = [];
  const lines = String(content ?? '').split('\n');
  const rel = normalizeRepoPath(filePath);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || /iac-ok/.test(raw)) continue;

    if (/^privileged\s*:\s*true\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-K8S-PRIVILEGED',
          severity: 'Critical',
          file: rel,
          line: i + 1,
          message: 'Kubernetes container bật `privileged: true`.',
          remediation: 'Đặt `privileged: false` trong `securityContext`.',
        }),
      );
    }

    if (/^(?:hostNetwork|hostPID|hostIPC)\s*:\s*true\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-K8S-HOST-NAMESPACE',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: `Kubernetes Pod chia sẻ host namespace (${trimmed}).`,
          remediation: 'Đặt giá trị `false` để cô lập Pod.',
        }),
      );
    }

    if (/^allowPrivilegeEscalation\s*:\s*true\b/i.test(trimmed) || /^runAsUser\s*:\s*0\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-K8S-ROOT-ESCALATION',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: `Cấu hình securityContext kém an toàn (${trimmed}).`,
          remediation: 'Đặt `runAsNonRoot: true`, `allowPrivilegeEscalation: false` và UID > 0.',
        }),
      );
    }

    if (/^namespace\s*:\s*default\s*$/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-K8S-DEFAULT-NAMESPACE',
          severity: 'Low',
          file: rel,
          line: i + 1,
          message: 'Manifest đang trỏ tới `namespace: default`.',
          remediation: 'Khi deploy thực tế nên dùng namespace riêng theo môi trường (staging/production).',
        }),
      );
    }
  }

  return findings;
}

export function scanTerraform(content, filePath, policy = loadSecurityPolicy()) {
  const failSet = new Set((policy.iac?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const findings = [];
  const lines = String(content ?? '').split('\n');
  const rel = normalizeRepoPath(filePath);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || /iac-ok/.test(raw)) continue;

    if (/acl\s*=\s*["']public-read(?:-write)?["']/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-TF-PUBLIC-STORAGE',
          severity: 'Critical',
          file: rel,
          line: i + 1,
          message: 'Terraform cấu hình Storage/S3 Bucket công khai (`public-read`).',
          remediation: 'Chuyển ACL sang `private` và bật Block Public Access.',
        }),
      );
    }

    if (/(?:storage_encrypted|encrypted)\s*=\s*false\b/i.test(trimmed)) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-TF-UNENCRYPTED-STORAGE',
          severity: 'High',
          file: rel,
          line: i + 1,
          message: 'Terraform tắt mã hóa dữ liệu lưu trữ (`encrypted = false`).',
          remediation: 'Đặt `encrypted = true` / `storage_encrypted = true` dùng KMS key.',
        }),
      );
    }

    if (/0\.0\.0\.0\/0/.test(trimmed) && /(?:22|3306|5432|6379|ssh|db|postgres|mysql|redis)/i.test(lines.slice(Math.max(0, i - 4), i + 4).join(' '))) {
      findings.push(
        makeFinding(failSet, {
          rule: 'IAC-TF-OPEN-ADMIN-PORT',
          severity: 'Critical',
          file: rel,
          line: i + 1,
          message: 'Mở cổng quản trị/DB (SSH/PostgreSQL/MySQL/Redis) cho toàn bộ Internet `0.0.0.0/0`.',
          remediation: 'Giới hạn CIDR chỉ trong dải VPC/Bastion nội bộ.',
        }),
      );
    }
  }

  return findings;
}

function runTrivyConfigIfAvailable(policy, engine) {
  if (engine === 'native') return { used: false, findings: [] };
  if (!commandExists('trivy')) {
    if (engine === 'trivy') {
      throw new Error('Không tìm thấy CLI `trivy` trên hệ thống.');
    }
    return { used: false, findings: [] };
  }

  const failSet = new Set((policy.iac?.failOn ?? ['Critical', 'High']).map((s) => normalizeSeverity(s)));
  const res = spawnSync(
    'trivy',
    ['config', '--format', 'json', '--quiet', '--skip-dirs', 'node_modules,dist,reports,coverage', '.'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout || '{}');
  } catch {
    parsed = null;
  }

  const findings = [];
  for (const result of parsed?.Results ?? []) {
    for (const mis of result.Misconfigurations ?? []) {
      if (mis.Status && mis.Status !== 'FAIL') continue;
      const severity = normalizeSeverity(mis.Severity);
      findings.push({
        rule: `TRIVY:${mis.ID || mis.AVDID || 'IAC'}`,
        severity,
        status: failSet.has(severity) ? 'FAIL' : 'WARN',
        category: 'IaC Security',
        file: normalizeRepoPath(result.Target || ''),
        line: Number(mis.CauseMetadata?.StartLine) || 1,
        message: `${mis.Title || mis.ID}: ${mis.Message || ''}`.trim(),
        remediation: mis.Resolution || 'Sửa cấu hình theo khuyến nghị bảo mật của Trivy.',
      });
    }
  }

  return { used: true, findings };
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const engine = getFlagValue(args, '--engine') ?? 'auto';
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-iac-report.json';
  const sarifOut = getFlagValue(args, '--sarif') ?? 'reports/security-iac.sarif';

  const iac = policy.iac ?? {};
  const nativeFindings = [];
  const scannedTargets = [];

  for (const rel of iac.dockerfilePaths ?? []) {
    const abs = path.resolve(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    scannedTargets.push(rel);
    nativeFindings.push(...scanDockerfile(fs.readFileSync(abs, 'utf8'), abs, policy));
  }

  for (const rel of iac.composePaths ?? []) {
    const abs = path.resolve(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    scannedTargets.push(rel);
    nativeFindings.push(...scanCompose(fs.readFileSync(abs, 'utf8'), abs, policy));
  }

  for (const dirRel of iac.kubernetesDirs ?? []) {
    const files = walkFiles(path.resolve(REPO_ROOT, dirRel), { extensions: ['.yaml', '.yml'] });
    for (const abs of files) {
      const text = fs.readFileSync(abs, 'utf8');
      if (!/apiVersion\s*:/.test(text)) continue;
      scannedTargets.push(normalizeRepoPath(abs));
      nativeFindings.push(...scanKubernetes(text, abs, policy));
    }
  }

  for (const dirRel of iac.terraformDirs ?? []) {
    const files = walkFiles(path.resolve(REPO_ROOT, dirRel), { extensions: ['.tf'] });
    for (const abs of files) {
      scannedTargets.push(normalizeRepoPath(abs));
      nativeFindings.push(...scanTerraform(fs.readFileSync(abs, 'utf8'), abs, policy));
    }
  }

  const trivyRes = runTrivyConfigIfAvailable(policy, engine);
  const findings = [...trivyRes.findings, ...nativeFindings];
  const failCount = findings.filter((f) => f.status === 'FAIL').length;
  const warnCount = findings.filter((f) => f.status === 'WARN').length;
  const passed = failCount === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    gate: 'Security IaC Config Scan',
    engines: [trivyRes.used ? 'trivy-config' : null, 'native-iac'].filter(Boolean),
    scannedTargets,
    summary: {
      total: findings.length,
      fail: failCount,
      warn: warnCount,
    },
    passed,
    findings,
  };

  await writeJsonReport(reportOut, report);
  await writeJsonReport(sarifOut, buildSarifReport({ toolName: 'core-iac-scanner', findings }));

  if (!passed) {
    console.error(`\n✗ [security:iac] PHÁT HIỆN ${failCount} LỖI CẤU HÌNH HẠ TẦNG (warn=${warnCount}):`);
    for (const f of findings.filter((x) => x.status === 'FAIL').slice(0, 20)) {
      console.error(`  - [${f.severity}] ${f.file}:${f.line} (${f.rule}) → ${f.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ [security:iac] Cấu hình hạ tầng đạt chuẩn (scanned=${scannedTargets.length} target(s), fail=${failCount}, warn=${warnCount}, engines=${report.engines.join('+')}).`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:iac] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
