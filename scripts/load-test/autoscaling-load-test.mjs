#!/usr/bin/env node
/**
 * Core Framework — Autoscaling & Database Impact Load Test Runner (Phase 13.2)
 *
 * Chạy kịch bản 4 pha (Baseline -> Ramp-up -> Peak Spike -> Cooldown) bằng Node.js thuần
 * (không cần cài thêm binary ngoài như k6/autocannon):
 *   1. Bơm tải HTTP đồng thời vào API (mặc định `/health/ready` có chạm DB `SELECT 1` + Redis + Queue).
 *   2. Lấy mẫu mỗi giây từ `/metrics` (Prometheus exposition):
 *      - CPU%, RAM%, http_requests_in_flight, core_queue_backlog_total
 *      - Ảnh hưởng Database: core_db_pool_connections (used/idle/waiting/limit), core_db_sessions,
 *        core_db_statements_total, core_db_statement_seconds_total, core_db_statement_errors_total.
 *   3. Gọi `/ops/runtimes/autoscaling/simulate` theo timeline để kiểm chứng:
 *      - Scale-up khi vượt ngưỡng in-flight / CPU / RAM
 *      - Clamp chặt trong [minReplicas, maxReplicas]
 *      - Cooldown chặn scale-down ngay khi spike vừa kết thúc (chống flapping)
 *      - Scale-down từng bước sau khi hết thời gian cooldown.
 *
 * Cách chạy:
 *   npm run load-test:autoscaling -- --base-url=http://127.0.0.1:3005/api/v1
 *   node scripts/load-test/autoscaling-load-test.mjs --help
 */

import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.LOAD_TEST_BASE_URL || 'http://127.0.0.1:3005/api/v1',
    endpoint: process.env.LOAD_TEST_ENDPOINT || '/health/ready',
    token: process.env.LOAD_TEST_TOKEN || '',
    baselineSec: Number(process.env.LOAD_TEST_BASELINE_SEC || 4),
    rampSec: Number(process.env.LOAD_TEST_RAMP_SEC || 6),
    peakSec: Number(process.env.LOAD_TEST_PEAK_SEC || 10),
    cooldownSec: Number(process.env.LOAD_TEST_COOLDOWN_SEC || 10),
    baselineConcurrency: Number(process.env.LOAD_TEST_BASELINE_CONCURRENCY || 2),
    peakConcurrency: Number(process.env.LOAD_TEST_PEAK_CONCURRENCY || 24),
    sampleIntervalMs: Number(process.env.LOAD_TEST_SAMPLE_INTERVAL_MS || 1000),
    apiMin: Number(process.env.LOAD_TEST_API_MIN || 1),
    apiMax: Number(process.env.LOAD_TEST_API_MAX || 4),
    targetInFlight: Number(process.env.LOAD_TEST_TARGET_IN_FLIGHT || 4),
    scaleUpCooldownSec: Number(process.env.LOAD_TEST_SCALE_UP_COOLDOWN_SEC || 2),
    scaleDownCooldownSec: Number(process.env.LOAD_TEST_SCALE_DOWN_COOLDOWN_SEC || 5),
    thinkMs: Number(process.env.LOAD_TEST_THINK_MS || 0),
    requestTimeoutMs: Number(process.env.LOAD_TEST_TIMEOUT_MS || 5000),
    output: process.env.LOAD_TEST_OUTPUT || '',
    strict: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--strict') {
      opts.strict = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, val] = match;
    switch (key) {
      case 'base-url':
        opts.baseUrl = val.replace(/\/+$/, '');
        break;
      case 'endpoint':
        opts.endpoint = val.startsWith('/') ? val : `/${val}`;
        break;
      case 'token':
        opts.token = val;
        break;
      case 'baseline-sec':
        opts.baselineSec = Math.max(1, Number(val));
        break;
      case 'ramp-sec':
        opts.rampSec = Math.max(1, Number(val));
        break;
      case 'peak-sec':
        opts.peakSec = Math.max(2, Number(val));
        break;
      case 'cooldown-sec':
        opts.cooldownSec = Math.max(2, Number(val));
        break;
      case 'baseline-concurrency':
        opts.baselineConcurrency = Math.max(1, Number(val));
        break;
      case 'peak-concurrency':
        opts.peakConcurrency = Math.max(2, Number(val));
        break;
      case 'sample-interval-ms':
        opts.sampleIntervalMs = Math.max(250, Number(val));
        break;
      case 'api-min':
        opts.apiMin = Math.max(1, Number(val));
        break;
      case 'api-max':
        opts.apiMax = Math.max(1, Number(val));
        break;
      case 'target-in-flight':
        opts.targetInFlight = Math.max(1, Number(val));
        break;
      case 'scale-up-cooldown':
        opts.scaleUpCooldownSec = Math.max(0, Number(val));
        break;
      case 'scale-down-cooldown':
        opts.scaleDownCooldownSec = Math.max(0, Number(val));
        break;
      case 'think-ms':
        opts.thinkMs = Math.max(0, Number(val));
        break;
      case 'output':
        opts.output = val;
        break;
    }
  }
  opts.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  opts.apiMax = Math.max(opts.apiMin, opts.apiMax);
  return opts;
}

function printHelp() {
  console.log(`Core Framework — Autoscaling & Database Impact Load Test

Usage:
  node scripts/load-test/autoscaling-load-test.mjs [options]

Options:
  --base-url=<url>             API base URL (default: http://127.0.0.1:3005/api/v1)
  --endpoint=<path>            Target endpoint hitting DB/API (default: /health/ready)
  --token=<jwt>                Optional Bearer token for protected endpoints
  --baseline-sec=<n>           Baseline phase duration in sec (default: 4)
  --ramp-sec=<n>               Ramp-up phase duration in sec (default: 6)
  --peak-sec=<n>               Peak spike duration in sec (default: 10)
  --cooldown-sec=<n>           Cooldown phase duration in sec (default: 10)
  --baseline-concurrency=<n>   Baseline concurrent workers (default: 2)
  --peak-concurrency=<n>       Peak concurrent workers (default: 24)
  --api-min=<n>                Simulated minReplicas (default: 1)
  --api-max=<n>                Simulated maxReplicas (default: 4)
  --target-in-flight=<n>       Target http_requests_in_flight / instance (default: 4)
  --scale-up-cooldown=<sec>    Simulated scale-up cooldown sec (default: 2)
  --scale-down-cooldown=<sec>  Simulated scale-down cooldown sec (default: 5)
  --think-ms=<ms>              Delay between requests per worker (default: 0)
  --output=<path>              Save full JSON report to file
  --strict                     Exit non-zero if any autoscaling/error check fails
`);
}

/** Parse Prometheus text exposition into a list of { name, labels, value }. */
function parsePrometheusText(text) {
  const samples = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[+-]?Inf|NaN)/.exec(
      line,
    );
    if (!match) continue;
    const name = match[1];
    const labelRaw = match[3] || '';
    const value = Number(match[4]);
    if (!Number.isFinite(value)) continue;
    const labels = {};
    if (labelRaw) {
      for (const pair of labelRaw.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g)) {
        labels[pair[1]] = pair[2];
      }
    }
    samples.push({ name, labels, value });
  }
  return samples;
}

function findMetric(samples, name, labelFilter = {}) {
  const matched = samples.filter((s) => {
    if (s.name !== name) return false;
    for (const [k, v] of Object.entries(labelFilter)) {
      if (s.labels[k] !== v) return false;
    }
    return true;
  });
  if (matched.length === 0) return null;
  return matched.reduce((sum, s) => sum + s.value, 0);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

function round2(n) {
  return n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

async function fetchJson(url, init = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, data: json?.data ?? json };
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeMetrics(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/metrics`, { signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    const samples = parsePrometheusText(text);
    return {
      cpuPercent: findMetric(samples, 'core_runtime_cpu_percent'),
      memoryPercent: findMetric(samples, 'core_runtime_memory_percent'),
      memoryRssMb:
        findMetric(samples, 'core_runtime_memory_rss_bytes') !== null
          ? round2(findMetric(samples, 'core_runtime_memory_rss_bytes') / (1024 * 1024))
          : findMetric(samples, 'process_resident_memory_bytes') !== null
            ? round2(findMetric(samples, 'process_resident_memory_bytes') / (1024 * 1024))
            : null,
      httpInFlight: findMetric(samples, 'http_requests_in_flight'),
      queueBacklogTotal: findMetric(samples, 'core_queue_backlog_total'),
      dbPoolUsed: findMetric(samples, 'core_db_pool_connections', { state: 'used' }),
      dbPoolIdle: findMetric(samples, 'core_db_pool_connections', { state: 'idle' }),
      dbPoolWaiting: findMetric(samples, 'core_db_pool_connections', { state: 'waiting' }),
      dbPoolLimit: findMetric(samples, 'core_db_pool_connections', { state: 'limit' }),
      dbSessions: findMetric(samples, 'core_db_sessions'),
      dbStatementsTotal: findMetric(samples, 'core_db_statements_total'),
      dbStatementSecondsTotal: findMetric(samples, 'core_db_statement_seconds_total'),
      dbStatementErrorsTotal: findMetric(samples, 'core_db_statement_errors_total'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const headers = opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
  const targetUrl = `${opts.baseUrl}${opts.endpoint}`;

  console.log('====================================================================');
  console.log(' Core Framework — Autoscaling & Database Impact Load Test');
  console.log('====================================================================');
  console.log(`Target API   : ${targetUrl}`);
  console.log(
    `Phases (sec) : baseline=${opts.baselineSec}s (c=${opts.baselineConcurrency}), ramp=${opts.rampSec}s, peak=${opts.peakSec}s (c=${opts.peakConcurrency}), cooldown=${opts.cooldownSec}s`,
  );
  console.log(
    `Policy Sim   : min=${opts.apiMin}, max=${opts.apiMax}, targetInFlight=${opts.targetInFlight}, upCooldown=${opts.scaleUpCooldownSec}s, downCooldown=${opts.scaleDownCooldownSec}s`,
  );

  // Kiểm tra nhanh API + Autoscaling overview trước khi chạy tải
  const initialOverview = await fetchJson(
    `${opts.baseUrl}/ops/runtimes/autoscaling`,
    { headers },
    opts.requestTimeoutMs,
  ).catch(() => null);
  const initialMetrics = await scrapeMetrics(opts.baseUrl, opts.requestTimeoutMs);
  if (!initialMetrics) {
    console.error(`\n[ERROR] Cannot scrape ${opts.baseUrl}/metrics. Is the API server running?`);
    process.exit(1);
  }

  const totalSec = opts.baselineSec + opts.rampSec + opts.peakSec + opts.cooldownSec;
  const phases = [
    { name: 'baseline', startSec: 0, endSec: opts.baselineSec },
    { name: 'ramp', startSec: opts.baselineSec, endSec: opts.baselineSec + opts.rampSec },
    {
      name: 'peak',
      startSec: opts.baselineSec + opts.rampSec,
      endSec: opts.baselineSec + opts.rampSec + opts.peakSec,
    },
    { name: 'cooldown', startSec: opts.baselineSec + opts.rampSec + opts.peakSec, endSec: totalSec },
  ];

  const phaseStats = Object.fromEntries(
    phases.map((p) => [
      p.name,
      {
        requests: 0,
        success: 0,
        rateLimited429: 0,
        serverErrors5xx: 0,
        errors: 0,
        latenciesMs: [],
        peakInFlight: 0,
        peakClientInFlight: 0,
        peakCpuPercent: 0,
        peakMemoryPercent: 0,
        peakDbPoolUsed: 0,
        peakDbPoolWaiting: 0,
      },
    ]),
  );

  let activePhase = 'baseline';
  let desiredConcurrency = opts.baselineConcurrency;
  let running = true;
  let clientInFlight = 0;

  // Trạng thái giả lập vòng lặp HPA dựa trên phản hồi thật của /ops/runtimes/autoscaling/simulate
  const simState = {
    currentReplicas: opts.apiMin,
    lastScaleUpAtMs: null,
    lastScaleDownAtMs: null,
    scaleUpCount: 0,
    scaleDownCount: 0,
    cooldownHoldCount: 0,
    maxReplicasReached: opts.apiMin,
    minReplicasObserved: opts.apiMin,
    neverExceededMax: true,
    neverDroppedBelowMin: true,
  };

  const timeline = [];
  const startedAtMs = Date.now();

  const resolvePhase = (elapsedSec) => {
    if (elapsedSec < opts.baselineSec) {
      return { name: 'baseline', concurrency: opts.baselineConcurrency };
    }
    if (elapsedSec < opts.baselineSec + opts.rampSec) {
      const progress = (elapsedSec - opts.baselineSec) / opts.rampSec;
      const c = Math.round(
        opts.baselineConcurrency + (opts.peakConcurrency - opts.baselineConcurrency) * progress,
      );
      return { name: 'ramp', concurrency: Math.max(opts.baselineConcurrency, c) };
    }
    if (elapsedSec < opts.baselineSec + opts.rampSec + opts.peakSec) {
      return { name: 'peak', concurrency: opts.peakConcurrency };
    }
    return { name: 'cooldown', concurrency: 1 };
  };

  // Worker pool động theo desiredConcurrency
  const workers = Array.from({ length: opts.peakConcurrency }, (_, idx) =>
    (async () => {
      while (running) {
        if (idx >= desiredConcurrency) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const phaseName = activePhase;
        const t0 = performance.now();
        clientInFlight += 1;
        if (clientInFlight > phaseStats[phaseName].peakClientInFlight) {
          phaseStats[phaseName].peakClientInFlight = clientInFlight;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), opts.requestTimeoutMs);
          const res = await fetch(targetUrl, { headers, signal: controller.signal });
          await res.arrayBuffer();
          clearTimeout(timer);
          const ms = performance.now() - t0;
          phaseStats[phaseName].requests += 1;
          phaseStats[phaseName].latenciesMs.push(ms);
          if (res.ok) {
            phaseStats[phaseName].success += 1;
          } else if (res.status === 429) {
            phaseStats[phaseName].rateLimited429 += 1;
          } else {
            if (res.status >= 500) phaseStats[phaseName].serverErrors5xx += 1;
            phaseStats[phaseName].errors += 1;
          }
        } catch {
          const ms = performance.now() - t0;
          phaseStats[phaseName].requests += 1;
          phaseStats[phaseName].errors += 1;
          phaseStats[phaseName].latenciesMs.push(ms);
        } finally {
          clientInFlight = Math.max(0, clientInFlight - 1);
        }
        if (opts.thinkMs > 0) {
          await new Promise((r) => setTimeout(r, opts.thinkMs));
        }
      }
    })(),
  );

  // Vòng lấy mẫu metrics + mô phỏng quyết định Autoscaling mỗi chu kỳ
  while (true) {
    const nowMs = Date.now();
    const elapsedSec = (nowMs - startedAtMs) / 1000;
    if (elapsedSec >= totalSec) break;

    const current = resolvePhase(elapsedSec);
    activePhase = current.name;
    desiredConcurrency = current.concurrency;

    const metrics = await scrapeMetrics(opts.baseUrl, opts.requestTimeoutMs);
    const observedInFlight = metrics?.httpInFlight ?? clientInFlight;
    const effectiveInFlight = Math.max(observedInFlight ?? 0, clientInFlight);

    const pStat = phaseStats[activePhase];
    if (observedInFlight !== null && observedInFlight > pStat.peakInFlight) {
      pStat.peakInFlight = observedInFlight;
    }
    if (metrics?.cpuPercent != null && metrics.cpuPercent > pStat.peakCpuPercent) {
      pStat.peakCpuPercent = metrics.cpuPercent;
    }
    if (metrics?.memoryPercent != null && metrics.memoryPercent > pStat.peakMemoryPercent) {
      pStat.peakMemoryPercent = metrics.memoryPercent;
    }
    if (metrics?.dbPoolUsed != null && metrics.dbPoolUsed > pStat.peakDbPoolUsed) {
      pStat.peakDbPoolUsed = metrics.dbPoolUsed;
    }
    if (metrics?.dbPoolWaiting != null && metrics.dbPoolWaiting > pStat.peakDbPoolWaiting) {
      pStat.peakDbPoolWaiting = metrics.dbPoolWaiting;
    }

    const simRes = await fetchJson(
      `${opts.baseUrl}/ops/runtimes/autoscaling/simulate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          target: 'api',
          currentReplicas: simState.currentReplicas,
          signals: {
            cpuPercent: metrics?.cpuPercent ?? null,
            memoryPercent: metrics?.memoryPercent ?? null,
            inFlightRequests: effectiveInFlight,
          },
          cooldown: {
            lastScaleUpAtMs: simState.lastScaleUpAtMs,
            lastScaleDownAtMs: simState.lastScaleDownAtMs,
          },
          policyOverrides: {
            minReplicas: opts.apiMin,
            maxReplicas: opts.apiMax,
            targetInFlightPerInstance: opts.targetInFlight,
            scaleUpCooldownSec: opts.scaleUpCooldownSec,
            scaleDownCooldownSec: opts.scaleDownCooldownSec,
            scaleUpMaxStep: 2,
            scaleDownMaxStep: 1,
          },
          nowMs,
        }),
      },
      opts.requestTimeoutMs,
    ).catch(() => null);

    const decision = simRes?.data?.decision ?? null;
    if (decision) {
      if (decision.cooldownActive) {
        simState.cooldownHoldCount += 1;
      }
      if (decision.action === 'scale_up') {
        simState.currentReplicas = decision.recommendedReplicas;
        simState.lastScaleUpAtMs = nowMs;
        simState.scaleUpCount += 1;
      } else if (decision.action === 'scale_down') {
        simState.currentReplicas = decision.recommendedReplicas;
        simState.lastScaleDownAtMs = nowMs;
        simState.scaleDownCount += 1;
      }
      simState.maxReplicasReached = Math.max(simState.maxReplicasReached, simState.currentReplicas);
      simState.minReplicasObserved = Math.min(simState.minReplicasObserved, simState.currentReplicas);
      if (simState.currentReplicas > opts.apiMax) simState.neverExceededMax = false;
      if (simState.currentReplicas < opts.apiMin) simState.neverDroppedBelowMin = false;
    }

    timeline.push({
      sec: Math.round(elapsedSec),
      phase: activePhase,
      concurrency: desiredConcurrency,
      httpInFlightGauge: metrics?.httpInFlight ?? null,
      clientInFlight,
      cpuPercent: metrics?.cpuPercent ?? null,
      memoryPercent: metrics?.memoryPercent ?? null,
      queueBacklogTotal: metrics?.queueBacklogTotal ?? null,
      dbPoolUsed: metrics?.dbPoolUsed ?? null,
      dbPoolWaiting: metrics?.dbPoolWaiting ?? null,
      dbPoolLimit: metrics?.dbPoolLimit ?? null,
      dbSessions: metrics?.dbSessions ?? null,
      replicas: simState.currentReplicas,
      action: decision?.action ?? null,
      blockedReason: decision?.blockedReason ?? null,
    });

    await new Promise((r) => setTimeout(r, opts.sampleIntervalMs));
  }

  running = false;
  await Promise.all(workers);
  await new Promise((r) => setTimeout(r, 200));

  const finalMetrics = (await scrapeMetrics(opts.baseUrl, opts.requestTimeoutMs)) ?? initialMetrics;
  const finalOverview = await fetchJson(
    `${opts.baseUrl}/ops/runtimes/autoscaling`,
    { headers },
    opts.requestTimeoutMs,
  ).catch(() => null);

  // Tổng hợp kết quả theo từng pha
  const phaseSummary = {};
  let totalRequests = 0;
  let totalErrors = 0;
  let totalRateLimited429 = 0;
  let totalServerErrors5xx = 0;
  for (const p of phases) {
    const s = phaseStats[p.name];
    const sorted = [...s.latenciesMs].sort((a, b) => a - b);
    const dur = Math.max(1, p.endSec - p.startSec);
    totalRequests += s.requests;
    totalErrors += s.errors;
    totalRateLimited429 += s.rateLimited429;
    totalServerErrors5xx += s.serverErrors5xx;
    phaseSummary[p.name] = {
      durationSec: dur,
      requests: s.requests,
      rps: round2(s.requests / dur),
      rateLimited429: s.rateLimited429,
      serverErrors5xx: s.serverErrors5xx,
      errorRatePercent: s.requests > 0 ? round2((s.errors / s.requests) * 100) : 0,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      peakHttpInFlightGauge: s.peakInFlight,
      peakClientInFlight: s.peakClientInFlight,
      peakCpuPercent: round2(s.peakCpuPercent),
      peakMemoryPercent: round2(s.peakMemoryPercent),
      peakDbPoolUsed: s.peakDbPoolUsed,
      peakDbPoolWaiting: s.peakDbPoolWaiting,
    };
  }

  const dbDeltaStatements =
    initialMetrics?.dbStatementsTotal != null && finalMetrics?.dbStatementsTotal != null
      ? Math.max(0, Math.round(finalMetrics.dbStatementsTotal - initialMetrics.dbStatementsTotal))
      : null;
  const dbDeltaSeconds =
    initialMetrics?.dbStatementSecondsTotal != null && finalMetrics?.dbStatementSecondsTotal != null
      ? Math.max(0, finalMetrics.dbStatementSecondsTotal - initialMetrics.dbStatementSecondsTotal)
      : null;
  const dbDeltaErrors =
    initialMetrics?.dbStatementErrorsTotal != null && finalMetrics?.dbStatementErrorsTotal != null
      ? Math.max(
          0,
          Math.round(finalMetrics.dbStatementErrorsTotal - initialMetrics.dbStatementErrorsTotal),
        )
      : null;

  const dbImpactReport = {
    observedPoolLimit: finalMetrics?.dbPoolLimit ?? initialMetrics?.dbPoolLimit ?? null,
    peakPoolUsed: Math.max(...Object.values(phaseSummary).map((p) => p.peakDbPoolUsed)),
    peakPoolWaiting: Math.max(...Object.values(phaseSummary).map((p) => p.peakDbPoolWaiting)),
    sessionsBefore: initialMetrics?.dbSessions ?? null,
    sessionsAfter: finalMetrics?.dbSessions ?? null,
    deltaStatements: dbDeltaStatements,
    avgStatementMs:
      dbDeltaStatements && dbDeltaStatements > 0 && dbDeltaSeconds != null
        ? round2((dbDeltaSeconds * 1000) / dbDeltaStatements)
        : null,
    deltaStatementErrors: dbDeltaErrors,
    serverProjection: finalOverview?.data?.databaseImpact ?? initialOverview?.data?.databaseImpact ?? null,
  };

  const checks = {
    metricsPublished:
      finalMetrics?.httpInFlight != null &&
      finalMetrics?.cpuPercent != null &&
      finalMetrics?.memoryPercent != null,
    scaledUpOnPeak: simState.scaleUpCount > 0,
    respectedMinMaxBounds: simState.neverExceededMax && simState.neverDroppedBelowMin,
    cooldownPreventedFlapping: simState.cooldownHoldCount > 0,
    scaledDownAfterCooldown: simState.scaleDownCount > 0,
    lowErrorRate: totalRequests > 0 ? totalErrors / totalRequests < 0.05 : false,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl: opts.baseUrl,
      endpoint: opts.endpoint,
      apiMin: opts.apiMin,
      apiMax: opts.apiMax,
      targetInFlight: opts.targetInFlight,
      scaleUpCooldownSec: opts.scaleUpCooldownSec,
      scaleDownCooldownSec: opts.scaleDownCooldownSec,
    },
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      rateLimited429: totalRateLimited429,
      serverErrors5xx: totalServerErrors5xx,
      errorRatePercent: totalRequests > 0 ? round2((totalErrors / totalRequests) * 100) : 0,
    },
    phases: phaseSummary,
    autoscalingSimulation: simState,
    databaseImpact: dbImpactReport,
    checks,
    timeline,
  };

  console.log('\n--- Phase Summary ---');
  console.table(
    Object.entries(phaseSummary).map(([phase, s]) => ({
      phase,
      reqs: s.requests,
      rps: s.rps,
      errPct: s.errorRatePercent,
      p50Ms: s.p50Ms,
      p95Ms: s.p95Ms,
      inFlightGauge: s.peakHttpInFlightGauge,
      cpuPct: s.peakCpuPercent,
      memPct: s.peakMemoryPercent,
      dbPoolPeak: s.peakDbPoolUsed,
    })),
  );

  console.log('\n--- Autoscaling Verification ---');
  console.log(JSON.stringify({ ...simState, checks }, null, 2));

  console.log('\n--- Database Impact ---');
  console.log(JSON.stringify(dbImpactReport, null, 2));

  if (opts.output) {
    await fs.writeFile(opts.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nReport written to ${opts.output}`);
  }

  const allPassed = Object.values(checks).every(Boolean);
  if (opts.strict && !allPassed) {
    console.error('\n[FAIL] One or more strict autoscaling load-test assertions failed.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
