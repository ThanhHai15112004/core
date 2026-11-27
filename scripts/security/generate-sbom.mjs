#!/usr/bin/env node
/**
 * 15.2.7 — Sinh SBOM (Software Bill of Materials) chuẩn CycloneDX 1.5 cho mỗi phiên bản
 *
 * - Trích xuất chính xác toàn bộ thành phần, phiên bản, PURL, license và hash SHA-512/SHA-256
 *   từ `package-lock.json` của cả 3 workspace (`root`, `backend`, `frontend`).
 * - Tạo:
 *     + `reports/sbom/core-sbom-v<version>.cdx.json` (bản hợp nhất gắn phiên bản & git SHA)
 *     + `reports/sbom/core-sbom-latest.cdx.json`
 *     + `reports/sbom/<workspace>-sbom.cdx.json`
 *     + `reports/sbom/SHA256SUMS.txt`
 *     + `reports/security-sbom-report.json`
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  getFlagValue,
  loadSecurityPolicy,
  runGit,
  writeJsonReport,
} from './common.mjs';

export function parseSriHash(integrity) {
  if (!integrity || typeof integrity !== 'string') return [];
  const parts = integrity.trim().split(/\s+/);
  const hashes = [];
  for (const part of parts) {
    const m = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/i.exec(part);
    if (!m) continue;
    const algMap = {
      sha512: 'SHA-512',
      sha384: 'SHA-384',
      sha256: 'SHA-256',
      sha1: 'SHA-1',
    };
    const hex = Buffer.from(m[2], 'base64').toString('hex');
    hashes.push({
      alg: algMap[m[1].toLowerCase()],
      content: hex,
    });
  }
  return hashes;
}

export function buildPackageUrl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${encodeURIComponent(name.slice(1)).replace(/%2F/gi, '/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function readLockfileComponents(workspaceName, workspaceDirRel) {
  const dirAbs = path.resolve(REPO_ROOT, workspaceDirRel);
  const lockPath = path.join(dirAbs, 'package-lock.json');
  const pkgPath = path.join(dirAbs, 'package.json');
  if (!fs.existsSync(lockPath)) {
    return { rootMeta: null, components: [], dependencies: [] };
  }

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const pkgJson = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
  const packages = lock.packages ?? {};
  const components = [];
  const directDeps = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
  ]);
  const rootDepRefs = [];
  const seenPurls = new Map();

  for (const [pkgKey, entry] of Object.entries(packages)) {
    if (!pkgKey || entry?.link) continue;
    const idx = pkgKey.lastIndexOf('node_modules/');
    const name = entry?.name || (idx >= 0 ? pkgKey.slice(idx + 'node_modules/'.length) : pkgKey);
    const version = entry?.version || '0.0.0';
    const purl = buildPackageUrl(name, version);

    if (seenPurls.has(purl)) {
      const existing = seenPurls.get(purl);
      const wsProp = existing.properties.find((p) => p.name === 'core:workspaces');
      if (wsProp && !wsProp.value.split(',').includes(workspaceName)) {
        wsProp.value = `${wsProp.value},${workspaceName}`;
      }
      continue;
    }

    const scope = entry?.optional ? 'optional' : 'required';
    const licenses = entry?.license ? [{ expression: String(entry.license) }] : [];
    const hashes = parseSriHash(entry?.integrity);

    const component = {
      type: 'library',
      'bom-ref': purl,
      name,
      version,
      scope,
      purl,
      ...(licenses.length > 0 ? { licenses } : {}),
      ...(hashes.length > 0 ? { hashes } : {}),
      ...(entry?.resolved
        ? {
            externalReferences: [
              {
                type: 'distribution',
                url: entry.resolved,
              },
            ],
          }
        : {}),
      properties: [
        { name: 'core:workspaces', value: workspaceName },
        { name: 'core:devDependency', value: String(Boolean(entry?.dev)) },
      ],
    };

    seenPurls.set(purl, component);
    components.push(component);

    if (directDeps.has(name) && !pkgKey.includes('node_modules/', pkgKey.indexOf('node_modules/') + 1)) {
      rootDepRefs.push(purl);
    }
  }

  return {
    rootMeta: {
      name: pkgJson.name || workspaceName,
      version: pkgJson.version || '1.0.0',
    },
    components,
    directRefs: [...new Set(rootDepRefs)].sort(),
  };
}

export function buildCycloneDxBom({
  appName,
  appVersion,
  gitCommit,
  gitBranch,
  components,
  directRefs,
}) {
  const rootRef = `pkg:generic/${encodeURIComponent(appName)}@${encodeURIComponent(appVersion)}`;
  const sortedComponents = [...components].sort((a, b) => a.purl.localeCompare(b.purl));

  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: {
        components: [
          {
            type: 'application',
            name: 'core-sbom-generator',
            version: '1.0.0',
          },
        ],
      },
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: appName,
        version: appVersion,
        purl: rootRef,
        properties: [
          { name: 'git:commit', value: gitCommit || 'unknown' },
          { name: 'git:branch', value: gitBranch || 'unknown' },
        ],
      },
    },
    components: sortedComponents,
    dependencies: [
      {
        ref: rootRef,
        dependsOn: directRefs,
      },
    ],
  };
}

async function sha256File(filePath) {
  const buf = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const policy = loadSecurityPolicy();
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const releaseVersion =
    getFlagValue(args, '--version') ||
    (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME?.replace(/^v/, '') : null) ||
    process.env.CI_COMMIT_TAG?.replace(/^v/, '') ||
    rootPkg.version ||
    '1.0.0';

  const outDirRel = getFlagValue(args, '--out-dir') ?? policy.sbom?.outputDir ?? 'reports/sbom';
  const reportOut = getFlagValue(args, '--report') ?? 'reports/security-sbom-report.json';
  const outDirAbs = path.isAbsolute(outDirRel) ? outDirRel : path.resolve(REPO_ROOT, outDirRel);
  await fsp.mkdir(outDirAbs, { recursive: true });

  const gitCommit = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || runGit(['rev-parse', 'HEAD']) || 'unknown';
  const gitBranch =
    process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_BRANCH || runGit(['branch', '--show-current']) || 'HEAD';

  const mergedComponentsMap = new Map();
  const mergedDirectRefs = new Set();
  const artifacts = [];

  for (const ws of policy.sbom?.workspaces ?? []) {
    const wsData = readLockfileComponents(ws.name, ws.dir);
    const wsBom = buildCycloneDxBom({
      appName: wsData.rootMeta?.name || `core-${ws.name}`,
      appVersion: releaseVersion,
      gitCommit,
      gitBranch,
      components: wsData.components,
      directRefs: wsData.directRefs,
    });

    const wsFile = path.join(outDirAbs, `${ws.name}-sbom.cdx.json`);
    await writeJsonReport(wsFile, wsBom);
    artifacts.push({
      workspace: ws.name,
      file: path.relative(REPO_ROOT, wsFile).replace(/\\/g, '/'),
      componentCount: wsBom.components.length,
      sha256: await sha256File(wsFile),
    });

    for (const ref of wsData.directRefs) mergedDirectRefs.add(ref);
    for (const comp of wsData.components) {
      if (!mergedComponentsMap.has(comp.purl)) {
        mergedComponentsMap.set(comp.purl, structuredClone(comp));
      } else {
        const existing = mergedComponentsMap.get(comp.purl);
        const wsProp = existing.properties.find((p) => p.name === 'core:workspaces');
        const incomingWs = comp.properties.find((p) => p.name === 'core:workspaces')?.value || ws.name;
        if (wsProp) {
          const mergedSet = new Set([...wsProp.value.split(','), ...incomingWs.split(',')]);
          wsProp.value = [...mergedSet].join(',');
        }
      }
    }
  }

  const unifiedBom = buildCycloneDxBom({
    appName: rootPkg.name || 'core-workspace',
    appVersion: releaseVersion,
    gitCommit,
    gitBranch,
    components: [...mergedComponentsMap.values()],
    directRefs: [...mergedDirectRefs].sort(),
  });

  const versionedFile = path.join(outDirAbs, `core-sbom-v${releaseVersion}.cdx.json`);
  const latestFile = path.join(outDirAbs, 'core-sbom-latest.cdx.json');
  await writeJsonReport(versionedFile, unifiedBom);
  await writeJsonReport(latestFile, unifiedBom);

  const unifiedHash = await sha256File(versionedFile);
  artifacts.unshift({
    workspace: 'unified',
    file: path.relative(REPO_ROOT, versionedFile).replace(/\\/g, '/'),
    componentCount: unifiedBom.components.length,
    sha256: unifiedHash,
  });

  const checksumLines = artifacts.map((a) => `${a.sha256}  ${path.basename(a.file)}`);
  await fsp.writeFile(path.join(outDirAbs, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf8');

  const summaryReport = {
    generatedAt: new Date().toISOString(),
    gate: 'Security SBOM Generation',
    format: 'CycloneDX',
    specVersion: '1.5',
    releaseVersion,
    gitCommit: gitCommit.slice(0, 12),
    gitBranch,
    totalUniqueComponents: unifiedBom.components.length,
    artifacts,
    passed: unifiedBom.components.length > 0,
  };

  await writeJsonReport(reportOut, summaryReport);

  console.log(
    `✓ [security:sbom] Đã sinh CycloneDX 1.5 SBOM cho v${releaseVersion} (${unifiedBom.components.length} thành phần duy nhất) → ${path.relative(REPO_ROOT, versionedFile)}`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('✗ [security:sbom] Lỗi không mong đợi:', err);
    process.exit(1);
  });
}
