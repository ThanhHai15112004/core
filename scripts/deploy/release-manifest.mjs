#!/usr/bin/env node
/**
 * Phase 15.3 — Build-Once Release Manifest & Immutable Artifact Traceability
 *
 * Quản lý tệp `release-manifest.json` khóa chặt Version, Git Commit SHA và
 * Docker Image Digests (`@sha256:...`) để tái sử dụng nguyên vẹn qua
 * Development -> Staging -> Production mà không build lại image.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_REGEX = /^[0-9a-f]{7,40}$/i;
const DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/i;

/**
 * Chuẩn hóa tham chiếu image immutable: ưu tiên `repository@sha256:...` nếu có digest.
 */
export function resolveImageRef({ repository, tag, digest }) {
  const repo = String(repository ?? '').trim();
  if (!repo) {
    throw new Error('Image repository is required');
  }
  const cleanDigest = String(digest ?? '').trim();
  if (cleanDigest) {
    if (!DIGEST_REGEX.test(cleanDigest)) {
      throw new Error(`Invalid image digest format: ${cleanDigest}`);
    }
    return `${repo}@${cleanDigest}`;
  }
  const cleanTag = String(tag ?? '').trim();
  if (!cleanTag) {
    throw new Error(`Image tag or digest is required for ${repo}`);
  }
  return `${repo}:${cleanTag}`;
}

/**
 * Suy luận phiên bản phát hành từ Git ref/tag + package version + short SHA.
 */
export function deriveReleaseVersion({ gitRef = '', packageVersion = '1.0.0', commitSha = '' }) {
  const cleanRef = String(gitRef).trim();
  const tagMatch = cleanRef.match(/^(?:refs\/tags\/)?v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (tagMatch) {
    return tagMatch[1];
  }
  const shortSha = String(commitSha).trim().slice(0, 7) || 'local';
  const base = String(packageVersion || '1.0.0').replace(/^v/, '');
  return `${base}-${shortSha}`;
}

/**
 * Tạo đối tượng release-manifest chuẩn gắn version, commit SHA, buildTime và digests.
 */
export function createReleaseManifest(input) {
  const commitSha = String(input.commitSha ?? '').trim();
  if (!SHA_REGEX.test(commitSha)) {
    throw new Error(`Invalid commitSha: "${commitSha}" (expected 7-40 hex chars)`);
  }

  const version = String(input.version ?? '').trim();
  if (!version) {
    throw new Error('version is required');
  }

  const registry = String(input.registry ?? 'ghcr.io').trim().replace(/\/+$/, '');
  const namespace = String(input.namespace ?? 'core').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const builtAt = input.builtAt || new Date().toISOString();
  const shortSha = commitSha.slice(0, 7);
  const tag = String(input.tag || `sha-${shortSha}`).trim();

  const buildImageEntry = (name, explicitRepo, explicitDigest) => {
    const repository = explicitRepo || `${registry}/${namespace}/${name}`;
    const digest = explicitDigest ? String(explicitDigest).trim() : null;
    if (digest && !DIGEST_REGEX.test(digest)) {
      throw new Error(`Invalid digest for ${name}: ${digest}`);
    }
    const ref = resolveImageRef({ repository, tag, digest });
    return {
      repository,
      tag,
      digest,
      ref,
    };
  };

  return {
    schemaVersion: '1.0',
    version,
    commitSha,
    shortSha,
    gitRef: input.gitRef || null,
    builtAt,
    registry,
    sourceUrl: input.sourceUrl || null,
    images: {
      backend: buildImageEntry('core-backend', input.backendRepo, input.backendDigest),
      frontend: buildImageEntry('core-frontend', input.frontendRepo, input.frontendDigest),
      nginx: buildImageEntry('core-nginx', input.nginxRepo, input.nginxDigest),
    },
  };
}

/**
 * Xác thực release-manifest trước khi deploy (chặn `:latest` hoặc thiếu digest ở Production).
 */
export function validateReleaseManifest(manifest, options = {}) {
  const requireDigest = Boolean(options.requireDigest);
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'] };
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('Missing or invalid "version"');
  }
  if (!manifest.commitSha || !SHA_REGEX.test(String(manifest.commitSha))) {
    errors.push('Missing or invalid "commitSha"');
  }
  if (!manifest.builtAt || Number.isNaN(Date.parse(String(manifest.builtAt)))) {
    errors.push('Missing or invalid "builtAt" ISO timestamp');
  }

  for (const key of ['backend', 'frontend', 'nginx']) {
    const img = manifest.images?.[key];
    if (!img || typeof img !== 'object') {
      errors.push(`Missing images.${key}`);
      continue;
    }
    if (!img.ref || typeof img.ref !== 'string') {
      errors.push(`Missing images.${key}.ref`);
    } else if (/:latest$/i.test(img.ref)) {
      errors.push(`Mutable :latest tag is forbidden in images.${key}.ref (${img.ref})`);
    }
    if (img.digest && !DIGEST_REGEX.test(String(img.digest))) {
      errors.push(`Invalid digest in images.${key}.digest`);
    }
    if (requireDigest && !img.digest) {
      errors.push(`Immutable sha256 digest is required for images.${key} in production`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Xuất chuỗi biến môi trường POSIX-safe từ release-manifest để deploy.sh nạp.
 */
export function toShellEnv(manifest) {
  const escapeVal = (v) => `'${String(v ?? '').replace(/'/g, `'\\''`)}'`;
  const lines = [
    `APP_VERSION=${escapeVal(manifest.version)}`,
    `APP_GIT_COMMIT=${escapeVal(manifest.commitSha)}`,
    `APP_BUILD_TIME=${escapeVal(manifest.builtAt)}`,
    `APP_IMAGE=${escapeVal(manifest.images.backend.ref)}`,
    `APP_IMAGE_DIGEST=${escapeVal(manifest.images.backend.digest || '')}`,
    `BACKEND_IMAGE=${escapeVal(manifest.images.backend.ref)}`,
    `FRONTEND_IMAGE=${escapeVal(manifest.images.frontend.ref)}`,
    `NGINX_IMAGE=${escapeVal(manifest.images.nginx.ref)}`,
    `IMAGE_REGISTRY=${escapeVal(manifest.registry || '')}`,
  ];
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.create) {
    const manifest = createReleaseManifest({
      version: args.version || deriveReleaseVersion({
        gitRef: args['git-ref'] || process.env.GITHUB_REF || process.env.CI_COMMIT_REF_NAME || '',
        packageVersion: args['package-version'] || '1.0.0',
        commitSha: args.commit || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || '',
      }),
      commitSha: args.commit || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || '',
      gitRef: args['git-ref'] || process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_REF_NAME || null,
      builtAt: args['built-at'] || new Date().toISOString(),
      registry: args.registry || process.env.IMAGE_REGISTRY || 'ghcr.io',
      namespace: args.namespace || process.env.IMAGE_NAMESPACE || 'core',
      tag: args.tag,
      sourceUrl: args['source-url'] || null,
      backendRepo: args['backend-repo'],
      frontendRepo: args['frontend-repo'],
      nginxRepo: args['nginx-repo'],
      backendDigest: args['backend-digest'],
      frontendDigest: args['frontend-digest'],
      nginxDigest: args['nginx-digest'],
    });

    const outPath = path.resolve(args.out || 'reports/release-manifest.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`✓ Generated release manifest: ${outPath} (version=${manifest.version}, sha=${manifest.shortSha})`);
    return;
  }

  if (args.validate) {
    const filePath = path.resolve(String(args.validate));
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = validateReleaseManifest(manifest, {
      requireDigest: Boolean(args['require-digest']),
    });
    if (!result.valid) {
      console.error(`✗ Release manifest validation failed (${filePath}):`);
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    console.log(`✓ Release manifest valid: ${manifest.version} (${manifest.shortSha})`);
    return;
  }

  if (args['to-env']) {
    const filePath = path.resolve(String(args['to-env']));
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const check = validateReleaseManifest(manifest, {
      requireDigest: Boolean(args['require-digest']),
    });
    if (!check.valid) {
      console.error(`✗ Invalid manifest: ${check.errors.join('; ')}`);
      process.exit(1);
    }
    process.stdout.write(toShellEnv(manifest));
    return;
  }

  console.error('Usage: release-manifest.mjs [--create ... | --validate <file> | --to-env <file>]');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
