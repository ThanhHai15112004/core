#!/usr/bin/env node
/**
 * Phase 15.3 — Container Registry Retention Policy (GHCR / GitLab Registry)
 *
 * Bảo vệ toàn bộ release SemVer (`vX.Y.Z`), tag đang active và `keepLast` bản mới nhất;
 * dọn dẹp các image dev/untagged cũ hơn `maxAgeDays` ngày. Mặc định `--dry-run`.
 */
import { pathToFileURL } from 'node:url';

const SEMVER_TAG_REGEX = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Đánh giá danh sách image version theo chính sách retention.
 * @param {Array<{id: string|number, tags: string[], createdAt: string}>} versions
 * @param {{keepLast?: number, maxAgeDays?: number, keepTags?: string[], nowMs?: number}} policy
 */
export function evaluateRetentionPolicy(versions, policy = {}) {
  const keepLast = Math.max(1, Number(policy.keepLast ?? 10));
  const maxAgeDays = Math.max(1, Number(policy.maxAgeDays ?? 30));
  const keepTagSet = new Set(
    (policy.keepTags || ['latest', 'main', 'develop', 'staging', 'production']).map((t) =>
      String(t).trim().toLowerCase(),
    ),
  );
  const nowMs = Number(policy.nowMs ?? Date.now());
  const cutoffMs = nowMs - maxAgeDays * 86_400_000;

  const sorted = [...versions].sort(
    (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0),
  );

  const keep = [];
  const prune = [];

  sorted.forEach((item, index) => {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const createdMs = Date.parse(item.createdAt || 0);

    const hasSemver = tags.some((t) => SEMVER_TAG_REGEX.test(String(t)));
    const hasProtectedTag = tags.some((t) => keepTagSet.has(String(t).toLowerCase()));
    const withinKeepLast = index < keepLast;
    const withinMaxAge = Number.isFinite(createdMs) && createdMs >= cutoffMs;

    if (hasSemver) {
      keep.push({ ...item, reason: 'semver-release' });
    } else if (hasProtectedTag) {
      keep.push({ ...item, reason: 'protected-tag' });
    } else if (withinKeepLast) {
      keep.push({ ...item, reason: `recent-top-${keepLast}` });
    } else if (withinMaxAge) {
      keep.push({ ...item, reason: `within-${maxAgeDays}d` });
    } else {
      prune.push({ ...item, reason: `older-than-${maxAgeDays}d` });
    }
  });

  return { keep, prune, policy: { keepLast, maxAgeDays } };
}

async function pruneGhcrPackage({ owner, ownerType, pkg, token, policy, apply }) {
  const base =
    ownerType === 'org'
      ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/packages/container/${encodeURIComponent(pkg)}/versions`
      : `https://api.github.com/users/${encodeURIComponent(owner)}/packages/container/${encodeURIComponent(pkg)}/versions`;

  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  };

  const res = await fetch(`${base}?per_page=100`, { headers });
  if (!res.ok) {
    throw new Error(`GHCR API list failed for ${pkg}: HTTP ${res.status}`);
  }
  const raw = await res.json();
  const versions = raw.map((v) => ({
    id: v.id,
    tags: v.metadata?.container?.tags || [],
    createdAt: v.created_at,
  }));

  const plan = evaluateRetentionPolicy(versions, policy);
  console.log(
    `📦 [retention] ${pkg}: total=${versions.length}, keep=${plan.keep.length}, prune=${plan.prune.length} (mode=${apply ? 'APPLY' : 'DRY-RUN'})`,
  );

  if (apply) {
    for (const item of plan.prune) {
      const delRes = await fetch(`${base}/${item.id}`, { method: 'DELETE', headers });
      if (!delRes.ok) {
        throw new Error(`GHCR delete failed for ${pkg}@${item.id}: HTTP ${delRes.status}`);
      }
      console.log(`  🗑 Deleted version ${item.id} (tags=${item.tags.join(',') || 'untagged'})`);
    }
  }

  return plan;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = String(args.provider || 'ghcr').toLowerCase();
  const apply = Boolean(args.apply);
  const policy = {
    keepLast: Number(args['keep-last'] || process.env.REGISTRY_KEEP_LAST || 10),
    maxAgeDays: Number(args['max-age-days'] || process.env.REGISTRY_MAX_AGE_DAYS || 30),
    keepTags: args['keep-tags']
      ? String(args['keep-tags']).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
  };

  if (provider !== 'ghcr') {
    console.error(`Unsupported provider "${provider}". GitLab Registry uses built-in expiration_policy or API.`);
    process.exit(1);
  }

  const owner = args.owner || process.env.GITHUB_REPOSITORY_OWNER || '';
  const ownerType = args['owner-type'] || 'user';
  const packages = String(args.packages || 'core-backend,core-frontend,core-nginx')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const token = process.env.GHCR_TOKEN || process.env.GITHUB_TOKEN || '';

  if (!owner || !token) {
    console.error('✗ Missing --owner (or GITHUB_REPOSITORY_OWNER) and GHCR_TOKEN/GITHUB_TOKEN');
    process.exit(1);
  }

  for (const pkg of packages) {
    await pruneGhcrPackage({ owner, ownerType, pkg, token, policy, apply });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ Registry retention failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
