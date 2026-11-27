#!/usr/bin/env node
/**
 * Phase 15.3 — Deployment Release State & Rollback Anti-Loop Guard
 *
 * Lưu trạng thái release theo từng môi trường (`current`, `previous`, `activeSlot`, `history`)
 * và cưỡng chế chốt chặn chống vòng lặp rollback (`rollbackInProgress`, `consecutiveRollbacks < maxRollbackAttempts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_HISTORY = 20;

export function createEmptyState(environment = 'production', maxRollbackAttempts = 2) {
  return {
    schemaVersion: '1.0',
    environment,
    activeSlot: 'blue',
    current: null,
    previous: null,
    rollbackInProgress: false,
    consecutiveRollbacks: 0,
    maxRollbackAttempts: Math.max(1, Number(maxRollbackAttempts) || 2),
    lastRollbackAt: null,
    lastRollbackReason: null,
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

export function loadState(statePath, environment = 'production', maxRollbackAttempts = 2) {
  if (!fs.existsSync(statePath)) {
    return createEmptyState(environment, maxRollbackAttempts);
  }
  const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return {
    ...createEmptyState(environment, maxRollbackAttempts),
    ...raw,
    maxRollbackAttempts: Math.max(
      1,
      Number(maxRollbackAttempts ?? raw.maxRollbackAttempts) || 2,
    ),
  };
}

export function saveState(statePath, state) {
  const resolved = path.resolve(statePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  const tmpPath = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, resolved);
  return next;
}

/** Chọn slot Blue-Green kế tiếp (luôn đối ngược activeSlot hiện tại). */
export function selectNextSlot(state) {
  return state.activeSlot === 'blue' ? 'green' : 'blue';
}

/**
 * Kiểm tra điều kiện an toàn trước khi cho phép Rollback (chống vòng lặp vô hạn).
 */
export function canRollback(state) {
  if (state.rollbackInProgress) {
    return {
      allowed: false,
      code: 'ROLLBACK_ALREADY_IN_PROGRESS',
      reason: 'Một tiến trình rollback khác đang chạy — chặn rollback đệ quy để tránh lặp vô hạn.',
    };
  }
  if (!state.previous || !state.previous.backendImage) {
    return {
      allowed: false,
      code: 'NO_PREVIOUS_RELEASE',
      reason: 'Không có phiên bản ổn định trước đó để rollback.',
    };
  }
  if (state.consecutiveRollbacks >= state.maxRollbackAttempts) {
    return {
      allowed: false,
      code: 'ROLLBACK_LIMIT_EXCEEDED',
      reason: `Đã đạt giới hạn rollback liên tiếp (${state.consecutiveRollbacks}/${state.maxRollbackAttempts}) — dừng tự động rollback và yêu cầu can thiệp thủ công.`,
    };
  }
  return {
    allowed: true,
    code: 'OK',
    targetRelease: state.previous,
  };
}

/**
 * Ghi nhận bản triển khai mới thành công: đẩy `current` thành `previous` và reset bộ đếm rollback.
 */
export function recordDeploySuccess(state, release) {
  const entry = {
    version: release.version,
    commitSha: release.commitSha,
    backendImage: release.backendImage,
    frontendImage: release.frontendImage,
    nginxImage: release.nginxImage,
    strategy: release.strategy || 'rolling',
    slot: release.slot || state.activeSlot || 'default',
    deployedAt: release.deployedAt || new Date().toISOString(),
    status: 'succeeded',
  };

  const previous =
    state.current && state.current.backendImage !== entry.backendImage
      ? state.current
      : state.previous;

  const history = [entry, ...(Array.isArray(state.history) ? state.history : [])].slice(
    0,
    MAX_HISTORY,
  );

  return {
    ...state,
    activeSlot: entry.slot === 'blue' || entry.slot === 'green' ? entry.slot : state.activeSlot,
    current: entry,
    previous,
    rollbackInProgress: false,
    consecutiveRollbacks: 0,
    history,
  };
}

/**
 * Khóa trạng thái bắt đầu rollback (tăng `consecutiveRollbacks`, bật cờ `rollbackInProgress`).
 */
export function beginRollback(state, reason = 'Post-deploy health/smoke check failed') {
  const check = canRollback(state);
  if (!check.allowed) {
    const err = new Error(check.reason);
    err.code = check.code;
    throw err;
  }

  return {
    ...state,
    rollbackInProgress: true,
    consecutiveRollbacks: state.consecutiveRollbacks + 1,
    lastRollbackAt: new Date().toISOString(),
    lastRollbackReason: reason,
  };
}

/**
 * Hoàn tất rollback (thành công hoặc thất bại), mở khóa `rollbackInProgress` và ghi lịch sử.
 */
export function finishRollback(state, { succeeded, targetRelease, error = null }) {
  const entry = {
    version: targetRelease?.version || 'unknown',
    commitSha: targetRelease?.commitSha || 'unknown',
    backendImage: targetRelease?.backendImage || '',
    frontendImage: targetRelease?.frontendImage || '',
    nginxImage: targetRelease?.nginxImage || '',
    strategy: 'rollback',
    slot: targetRelease?.slot || state.activeSlot || 'default',
    deployedAt: new Date().toISOString(),
    status: succeeded ? 'rolled_back' : 'rollback_failed',
    ...(error ? { error } : {}),
  };

  const history = [entry, ...(Array.isArray(state.history) ? state.history : [])].slice(
    0,
    MAX_HISTORY,
  );

  return {
    ...state,
    rollbackInProgress: false,
    activeSlot:
      succeeded && (entry.slot === 'blue' || entry.slot === 'green')
        ? entry.slot
        : state.activeSlot,
    current: succeeded && targetRelease ? { ...targetRelease, rolledBackAt: entry.deployedAt } : state.current,
    history,
  };
}

function parseArgs(argv) {
  const cmd = argv[0];
  const args = {};
  for (let i = 1; i < argv.length; i += 1) {
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
  return { cmd, args };
}

function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  const statePath = args.state || '.deploy/release-state.json';
  const envName = args.env || 'production';
  const maxRollbacks = Number(args['max-rollbacks'] || process.env.MAX_ROLLBACK_ATTEMPTS || 2);

  const state = loadState(statePath, envName, maxRollbacks);

  switch (cmd) {
    case 'status': {
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    case 'next-slot': {
      process.stdout.write(`${selectNextSlot(state)}\n`);
      return;
    }
    case 'can-rollback': {
      const result = canRollback(state);
      console.log(JSON.stringify(result, null, 2));
      if (!result.allowed) {
        process.exit(result.code === 'ROLLBACK_LIMIT_EXCEEDED' ? 2 : 1);
      }
      return;
    }
    case 'record-success': {
      const next = recordDeploySuccess(state, {
        version: args.version,
        commitSha: args.commit,
        backendImage: args['backend-image'],
        frontendImage: args['frontend-image'],
        nginxImage: args['nginx-image'],
        strategy: args.strategy,
        slot: args.slot,
      });
      saveState(statePath, next);
      console.log(`✓ Recorded deploy success (${next.current.version}, slot=${next.activeSlot})`);
      return;
    }
    case 'begin-rollback': {
      try {
        const next = beginRollback(state, args.reason);
        saveState(statePath, next);
        console.log(JSON.stringify(next.previous, null, 2));
      } catch (err) {
        console.error(`✗ ${err.message}`);
        process.exit(err.code === 'ROLLBACK_LIMIT_EXCEEDED' ? 2 : 1);
      }
      return;
    }
    case 'finish-rollback': {
      const succeeded = String(args.succeeded) === 'true';
      const next = finishRollback(state, {
        succeeded,
        targetRelease: state.previous,
        error: args.error || null,
      });
      saveState(statePath, next);
      console.log(`✓ Rollback finalized (succeeded=${succeeded}, consecutiveRollbacks=${next.consecutiveRollbacks})`);
      return;
    }
    default:
      console.error(
        'Usage: state-manager.mjs <status|next-slot|can-rollback|record-success|begin-rollback|finish-rollback> --state <path> ...',
      );
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
