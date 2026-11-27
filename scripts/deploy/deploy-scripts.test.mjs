import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createReleaseManifest,
  deriveReleaseVersion,
  toShellEnv,
  validateReleaseManifest,
} from './release-manifest.mjs';
import {
  beginRollback,
  canRollback,
  createEmptyState,
  finishRollback,
  loadState,
  recordDeploySuccess,
  saveState,
  selectNextSlot,
} from './state-manager.mjs';
import { runPostDeploySmokeTest } from './smoke-test.mjs';
import { evaluateRetentionPolicy } from './prune-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_DIGEST = `sha256:${'a'.repeat(64)}`;
const SAMPLE_SHA = 'abcdef1234567890abcdef1234567890abcdef12';

test('release-manifest: derives version from tag or branch+sha and creates immutable refs', () => {
  assert.equal(
    deriveReleaseVersion({ gitRef: 'refs/tags/v2.4.1', packageVersion: '1.0.0', commitSha: SAMPLE_SHA }),
    '2.4.1',
  );
  assert.equal(
    deriveReleaseVersion({ gitRef: 'refs/heads/main', packageVersion: '1.2.0', commitSha: SAMPLE_SHA }),
    '1.2.0-abcdef1',
  );

  const manifest = createReleaseManifest({
    version: '2.4.1',
    commitSha: SAMPLE_SHA,
    registry: 'ghcr.io',
    namespace: 'org/core',
    backendDigest: SAMPLE_DIGEST,
    frontendDigest: SAMPLE_DIGEST,
    nginxDigest: SAMPLE_DIGEST,
  });

  assert.equal(manifest.shortSha, 'abcdef1');
  assert.equal(manifest.images.backend.ref, `ghcr.io/org/core/core-backend@${SAMPLE_DIGEST}`);
  assert.equal(validateReleaseManifest(manifest, { requireDigest: true }).valid, true);

  const envOutput = toShellEnv(manifest);
  assert.match(envOutput, /APP_VERSION='2\.4\.1'/);
  assert.match(envOutput, /APP_GIT_COMMIT='abcdef1234567890abcdef1234567890abcdef12'/);
  assert.match(envOutput, /BACKEND_IMAGE='ghcr\.io\/org\/core\/core-backend@sha256:a{64}'/);
});

test('release-manifest: rejects mutable :latest tag and missing production digest', () => {
  const manifestWithoutDigest = createReleaseManifest({
    version: '1.0.0-abcdef1',
    commitSha: SAMPLE_SHA,
    tag: 'sha-abcdef1',
  });
  assert.equal(validateReleaseManifest(manifestWithoutDigest, { requireDigest: false }).valid, true);

  const prodCheck = validateReleaseManifest(manifestWithoutDigest, { requireDigest: true });
  assert.equal(prodCheck.valid, false);
  assert.equal(prodCheck.errors.length, 3);

  const latestManifest = structuredClone(manifestWithoutDigest);
  latestManifest.images.backend.ref = 'ghcr.io/core/core-backend:latest';
  const latestCheck = validateReleaseManifest(latestManifest);
  assert.equal(latestCheck.valid, false);
  assert.match(latestCheck.errors[0], /:latest/);
});

test('state-manager: tracks blue-green slots and enforces rollback anti-loop guard', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-deploy-state-'));
  const statePath = path.join(tmpDir, 'prod-state.json');

  try {
    let state = createEmptyState('production', 2);
    assert.equal(canRollback(state).code, 'NO_PREVIOUS_RELEASE');
    assert.equal(selectNextSlot(state), 'green');

    // Release 1 (blue)
    state = recordDeploySuccess(state, {
      version: '1.0.0',
      commitSha: '1111111',
      backendImage: `ghcr.io/core/core-backend@sha256:${'1'.repeat(64)}`,
      frontendImage: `ghcr.io/core/core-frontend@sha256:${'1'.repeat(64)}`,
      nginxImage: `ghcr.io/core/core-nginx@sha256:${'1'.repeat(64)}`,
      strategy: 'blue-green',
      slot: 'blue',
    });
    assert.equal(state.activeSlot, 'blue');
    assert.equal(selectNextSlot(state), 'green');
    assert.equal(canRollback(state).allowed, false);

    // Release 2 (green)
    state = recordDeploySuccess(state, {
      version: '1.1.0',
      commitSha: '2222222',
      backendImage: `ghcr.io/core/core-backend@sha256:${'2'.repeat(64)}`,
      frontendImage: `ghcr.io/core/core-frontend@sha256:${'2'.repeat(64)}`,
      nginxImage: `ghcr.io/core/core-nginx@sha256:${'2'.repeat(64)}`,
      strategy: 'blue-green',
      slot: 'green',
    });
    assert.equal(state.activeSlot, 'green');
    assert.equal(state.previous?.version, '1.0.0');
    assert.equal(canRollback(state).allowed, true);

    // Rollback attempt #1 -> locks rollbackInProgress to block recursive rollback
    state = beginRollback(state, 'Smoke failed');
    assert.equal(state.rollbackInProgress, true);
    assert.equal(state.consecutiveRollbacks, 1);
    assert.equal(canRollback(state).code, 'ROLLBACK_ALREADY_IN_PROGRESS');

    state = finishRollback(state, { succeeded: true, targetRelease: state.previous });
    assert.equal(state.rollbackInProgress, false);
    assert.equal(state.activeSlot, 'blue');
    assert.equal(state.current?.version, '1.0.0');

    // Rollback attempt #2 -> allowed (2/2)
    state = beginRollback(state, 'Second failure');
    state = finishRollback(state, { succeeded: false, targetRelease: state.previous, error: 'still unhealthy' });
    assert.equal(state.consecutiveRollbacks, 2);

    // Rollback attempt #3 -> BLOCKED by anti-loop guard!
    const limitCheck = canRollback(state);
    assert.equal(limitCheck.allowed, false);
    assert.equal(limitCheck.code, 'ROLLBACK_LIMIT_EXCEEDED');

    saveState(statePath, state);
    const reloaded = loadState(statePath, 'production', 2);
    assert.equal(reloaded.consecutiveRollbacks, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('prune-registry: keeps SemVer releases, protected tags, recent N, and prunes stale dev images', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();

  const versions = [
    { id: 1, tags: ['v1.0.0'], createdAt: daysAgo(120) }, // SemVer -> keep
    { id: 2, tags: ['production'], createdAt: daysAgo(90) }, // Protected -> keep
    { id: 3, tags: ['sha-aaaaaaa'], createdAt: daysAgo(2) }, // Top keepLast -> keep
    { id: 4, tags: ['sha-bbbbbbb'], createdAt: daysAgo(5) }, // Top keepLast -> keep
    { id: 5, tags: ['sha-ccccccc'], createdAt: daysAgo(10) }, // Within 30d -> keep
    { id: 6, tags: ['sha-ddddddd'], createdAt: daysAgo(45) }, // Stale -> prune
    { id: 7, tags: [], createdAt: daysAgo(60) }, // Untagged stale -> prune
  ];

  const plan = evaluateRetentionPolicy(versions, { keepLast: 2, maxAgeDays: 30, nowMs: now });
  assert.deepEqual(
    plan.keep.map((x) => x.id).sort((a, b) => a - b),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    plan.prune.map((x) => x.id).sort((a, b) => a - b),
    [6, 7],
  );
});

test('smoke-test: verifies live/ready, version+commit traceability, FE runtime config, login and core features', async () => {
  let healthy = true;
  let loggedOut = false;

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const sendJson = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url === '/api/v1/health/live') {
      return sendJson(200, { success: true, data: { status: 'ok', live: true } });
    }
    if (url === '/api/v1/health/ready') {
      return sendJson(healthy ? 200 : 503, { success: healthy, data: { status: healthy ? 'ok' : 'down', ready: healthy } });
    }
    if (url === '/api/v1/ops/system-info') {
      return sendJson(200, {
        success: true,
        data: {
          projectVersion: '2.4.1',
          coreVersion: '1.0.0',
          deployment: { commit: SAMPLE_SHA, shortCommit: 'abcdef1' },
        },
      });
    }
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><html><body>Core</body></html>');
    }
    if (url === '/env-config.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end('window.__CORE_RUNTIME_CONFIG__ = { apiBaseUrl: "/api/v1" };');
    }
    if (url === '/api/v1/auth/login' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (body.identifier === 'smoke@core.local' && body.password === 'SmokePass123!') {
        return sendJson(200, {
          success: true,
          data: { tokens: { accessToken: 'tok_smoke_123', refreshToken: 'ref_smoke_123' } },
        });
      }
      return sendJson(401, { success: false, message: 'Invalid credentials' });
    }
    if (url === '/api/v1/auth/me') {
      if (req.headers.authorization === 'Bearer tok_smoke_123') {
        return sendJson(200, { success: true, data: { id: 1, email: 'smoke@core.local' } });
      }
      return sendJson(401, { success: false });
    }
    if (url === '/api/v1/ops/modules' || url === '/api/v1/codes/types') {
      if (req.headers.authorization === 'Bearer tok_smoke_123') {
        return sendJson(200, { success: true, data: { items: [] } });
      }
      return sendJson(401, { success: false });
    }
    if (url === '/api/v1/auth/logout' && req.method === 'POST') {
      loggedOut = true;
      return sendJson(200, { success: true });
    }
    return sendJson(404, { success: false });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Happy path
    const okReport = await runPostDeploySmokeTest({
      baseUrl,
      waitTimeoutMs: 3000,
      pollIntervalMs: 100,
      expectedCommit: 'abcdef1',
      expectedVersion: '2.4.1',
      requireAuth: true,
      authIdentifier: 'smoke@core.local',
      authPassword: 'SmokePass123!',
    });
    assert.equal(okReport.passed, true);
    assert.equal(okReport.summary.failed, 0);
    assert.equal(loggedOut, true);

    // 2. Commit SHA mismatch fails traceability check
    const mismatchReport = await runPostDeploySmokeTest({
      baseUrl,
      waitTimeoutMs: 1000,
      pollIntervalMs: 100,
      expectedCommit: '9999999',
      skipFrontend: true,
    });
    assert.equal(mismatchReport.passed, false);
    assert.equal(mismatchReport.checks.find((c) => c.name === 'release.traceability')?.passed, false);

    // 3. Unhealthy readiness fails smoke test (triggering auto-rollback in deploy.sh)
    healthy = false;
    const unhealthyReport = await runPostDeploySmokeTest({
      baseUrl,
      waitTimeoutMs: 400,
      pollIntervalMs: 100,
      skipFrontend: true,
    });
    assert.equal(unhealthyReport.passed, false);
    assert.equal(unhealthyReport.checks.find((c) => c.name === 'health.ready')?.passed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('deploy.sh: validates manifest and plans blue-green production deploy in dry-run mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-deploy-cli-'));
  const manifestPath = path.join(tmpDir, 'release-manifest.json');
  const statePath = path.join(tmpDir, 'prod-state.json');

  try {
    const manifest = createReleaseManifest({
      version: '2.5.0',
      commitSha: SAMPLE_SHA,
      registry: 'ghcr.io',
      namespace: 'org/core',
      backendDigest: SAMPLE_DIGEST,
      frontendDigest: SAMPLE_DIGEST,
      nginxDigest: SAMPLE_DIGEST,
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const out = execFileSync(
      'bash',
      [
        path.join(REPO_ROOT, 'scripts/deploy/deploy.sh'),
        '--env',
        'production',
        '--manifest',
        manifestPath,
        '--strategy',
        'blue-green',
        '--state-file',
        statePath,
        '--dry-run',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

    assert.match(out, /Version\s*:\s*2\.5\.0 \(commit abcdef1\)/);
    assert.match(out, /Strategy\s*:\s*blue-green \(slot=green/);
    assert.match(out, /DRY-RUN hoàn tất/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('build-release.sh: prints 1-command build-once plan in dry-run mode', () => {
  const out = execFileSync(
    'bash',
    [
      path.join(REPO_ROOT, 'scripts/deploy/build-release.sh'),
      '--version',
      '2.6.0',
      '--registry',
      'ghcr.io',
      '--namespace',
      'org/core',
      '--dry-run',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  assert.match(out, /Version\s*:\s*2\.6\.0/);
  assert.match(out, /ghcr\.io\/org\/core\/core-backend:/);
  assert.match(out, /ghcr\.io\/org\/core\/core-frontend:/);
  assert.match(out, /ghcr\.io\/org\/core\/core-nginx:/);
  assert.match(out, /DRY-RUN hoàn tất/);
});
