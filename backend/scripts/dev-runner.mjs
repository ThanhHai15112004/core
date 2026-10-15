/**
 * Dev runner cho Docker (thay `nest start --watch` + `node --watch-path=dist`).
 *
 *   node scripts/dev-runner.mjs --name api --build --entry dist/apps/api/main.js
 *   node scripts/dev-runner.mjs --name worker --entry dist/apps/worker/main.js
 *
 * --build : chạy `tsc --watch --incremental` (KHÔNG xoá dist), sau mỗi lần build thành công chạy
 *           `tsc-alias`, dọn file .js mồ côi (source đã xoá) rồi ghi `dist/.build-stamp`.
 * (không --build): chỉ theo dõi `dist/.build-stamp` do container API ghi → restart đúng 1 lần/build,
 *           không restart giữa chừng khi dist đang được ghi.
 *
 * App crash (thoát ngoài ý muốn) → tự khởi động lại với backoff 1s → 30s, in rõ mã lỗi ra log.
 * Tiến trình `tsc --watch` chết → runner thoát code 1 để Docker (`restart: unless-stopped`) dựng lại container.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(backendRoot, 'dist');
const srcDir = path.join(backendRoot, 'src');
const stampFile = path.join(distDir, '.build-stamp');
const binDir = path.join(backendRoot, 'node_modules', '.bin');

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const name = argValue('--name') ?? 'app';
const entry = argValue('--entry');
const buildMode = argv.includes('--build');
if (!entry) {
  process.stderr.write('[dev-runner] Thiếu tham số --entry <dist/...js>\n');
  process.exit(2);
}
const entryAbs = path.resolve(backendRoot, entry);

const STOP_TIMEOUT_MS = 8_000;
const MAX_BACKOFF_MS = 30_000;
const STABLE_UPTIME_MS = 60_000;

/** Ghi log có tiền tố runner ra stdout (đồng bộ với pipe trên Linux) */
function log(message) {
  process.stdout.write(`[dev-runner:${name}] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Giám sát tiến trình ứng dụng
// ---------------------------------------------------------------------------
let child = null;
let shuttingDown = false;
let crashCount = 0;
let crashTimer = null;
let lastStartAt = 0;
let appChain = Promise.resolve();

/** Khởi động app con; tự lên lịch khởi động lại khi app thoát ngoài ý muốn */
function startApp() {
  if (shuttingDown || child) return;
  if (!fs.existsSync(entryAbs)) {
    log(`Chưa có ${entry} — chờ build...`);
    return;
  }
  lastStartAt = Date.now();
  log(`▶ Khởi động ${entry}`);
  const proc = spawn(process.execPath, ['--enable-source-maps', entryAbs], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
  });
  proc.intentionalStop = false;
  child = proc;
  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    if (shuttingDown || proc.intentionalStop) return;
    if (Date.now() - lastStartAt > STABLE_UPTIME_MS) crashCount = 0;
    crashCount += 1;
    const delay = Math.min(1000 * 2 ** (crashCount - 1), MAX_BACKOFF_MS);
    log(
      `✖ App thoát ngoài ý muốn (code=${code ?? '-'}, signal=${signal ?? '-'}). ` +
        `Tự khởi động lại sau ${delay / 1000}s (lần ${crashCount}) — hoặc ngay khi có build mới.`,
    );
    clearTimeout(crashTimer);
    crashTimer = setTimeout(() => {
      appChain = appChain.then(startApp);
    }, delay);
  });
}

/** Dừng app con một cách graceful (SIGTERM → SIGKILL sau timeout) */
function stopApp() {
  const proc = child;
  if (!proc) return Promise.resolve();
  proc.intentionalStop = true;
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), STOP_TIMEOUT_MS);
    proc.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

/** Xếp hàng restart app (tuần tự, không chồng lấn) */
function restartApp(reason) {
  appChain = appChain.then(async () => {
    if (shuttingDown) return;
    clearTimeout(crashTimer);
    crashCount = 0;
    log(`↻ Restart (${reason})`);
    await stopApp();
    startApp();
  });
  return appChain;
}

// ---------------------------------------------------------------------------
// Chế độ build: tsc --watch → tsc-alias → dọn file mồ côi → ghi stamp
// ---------------------------------------------------------------------------
const OUTPUT_EXTS = ['.d.ts.map', '.js.map', '.d.ts', '.js'];

/** Xoá output trong dist mà source .ts tương ứng không còn (thay cho `rm -rf dist`) */
function pruneOrphans(dir = distDir) {
  let removed = 0;
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      removed += pruneOrphans(full);
      continue;
    }
    const ext = OUTPUT_EXTS.find((e) => dirent.name.endsWith(e));
    if (!ext) continue;
    const rel = path.relative(distDir, full).slice(0, -ext.length);
    if (!fs.existsSync(path.join(srcDir, `${rel}.ts`))) {
      fs.rmSync(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/** Chạy tsc-alias (giống script `build`) và trả về true nếu thành công */
function runTscAlias() {
  return new Promise((resolve) => {
    const proc = spawn(path.join(binDir, 'tsc-alias'), [], { cwd: backendRoot, stdio: 'inherit' });
    proc.on('exit', (code) => resolve(code === 0));
    proc.on('error', (err) => {
      log(`tsc-alias lỗi: ${err.message}`);
      resolve(false);
    });
  });
}

let buildChain = Promise.resolve();
let firstBuildDone = false;

/** Xử lý khi tsc báo kết quả một vòng build */
function onBuildFinished(errorCount) {
  buildChain = buildChain.then(async () => {
    if (shuttingDown) return;
    if (errorCount > 0) {
      log(`⚠ Build có ${errorCount} lỗi TypeScript — giữ nguyên tiến trình đang chạy.`);
      if (!firstBuildDone && !child) {
        log('Khởi động bản build cũ trong dist (nếu có) để API vẫn phục vụ.');
        startApp();
      }
      return;
    }
    const started = Date.now();
    if (!(await runTscAlias())) {
      log('⚠ tsc-alias thất bại — bỏ qua restart.');
      return;
    }
    const removed = pruneOrphans();
    fs.writeFileSync(stampFile, String(Date.now()));
    log(
      `✔ Build xong (alias ${Date.now() - started}ms${removed ? `, dọn ${removed} file mồ côi` : ''}).`,
    );
    firstBuildDone = true;
    if (child) await restartApp('build mới');
    else startApp();
  });
}

let tscProc = null;

/** Khởi chạy tsc ở chế độ watch + incremental và theo dõi kết quả build */
function startTscWatch() {
  fs.mkdirSync(distDir, { recursive: true });
  log('Khởi chạy tsc --watch --incremental (không xoá dist)...');
  tscProc = spawn(
    path.join(binDir, 'tsc'),
    [
      '-p',
      'tsconfig.build.json',
      '--watch',
      '--preserveWatchOutput',
      '--incremental',
      '--tsBuildInfoFile',
      'dist/.tsbuildinfo',
    ],
    { cwd: backendRoot, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  readline.createInterface({ input: tscProc.stdout }).on('line', (line) => {
    process.stdout.write(`${line}\n`);
    const match = /Found (\d+) errors?\./.exec(line);
    if (match) onBuildFinished(Number(match[1]));
  });
  tscProc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(`✖ tsc --watch dừng (code=${code ?? '-'}, signal=${signal ?? '-'}) — thoát để Docker khởi động lại.`);
    void shutdown(1);
  });
}

// ---------------------------------------------------------------------------
// Chế độ theo dõi: restart khi container API ghi stamp mới
// ---------------------------------------------------------------------------
function watchStamp() {
  if (fs.existsSync(stampFile)) startApp();
  else log('Chờ container API build xong (dist/.build-stamp)...');
  fs.watchFile(stampFile, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs === 0 || curr.mtimeMs === prev.mtimeMs) return;
    if (child) void restartApp('build mới từ container API');
    else {
      clearTimeout(crashTimer);
      appChain = appChain.then(startApp);
    }
  });
}

// ---------------------------------------------------------------------------
// Tắt máy graceful
// ---------------------------------------------------------------------------
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(crashTimer);
  fs.unwatchFile(stampFile);
  if (tscProc && tscProc.exitCode === null) tscProc.kill('SIGTERM');
  await stopApp();
  process.exit(exitCode);
}
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));

if (buildMode) startTscWatch();
else watchStamp();

