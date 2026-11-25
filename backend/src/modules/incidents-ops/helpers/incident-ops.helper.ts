import { randomUUID } from 'node:crypto';
import {
  SequenceRegistryService,
  SettingRegistryService,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  safeJsonParse,
} from '@packages/kernel/index.js';
import {
  ALL_INCIDENT_SEVERITIES,
  ALL_SIEM_DRIVERS,
  DEFAULT_RESPONSE_SLA_MINUTES,
  INCIDENTS_DEFAULTS,
  INCIDENTS_SETTING_KEYS,
  INCIDENT_SEVERITY,
  SIEM_DRIVER,
  type IncidentSeverity,
  type SiemDriver,
} from '../enum/incidents-ops.enum.js';
import type {
  IncidentTimelineEntry,
  IncidentsRuntimeConfig,
  IngestIncidentAlertInput,
} from '../types/incidents-ops.types.js';

const VALID_SEVERITY_SET = new Set<string>(ALL_INCIDENT_SEVERITIES);
const VALID_SIEM_DRIVER_SET = new Set<string>(ALL_SIEM_DRIVERS);

export function resolveIncidentsRuntimeConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): IncidentsRuntimeConfig {
  const defaultOwner = Math.max(
    1,
    Math.trunc(
      settingRegistry.getNumber(
        INCIDENTS_SETTING_KEYS.DEFAULT_OWNER_USER_ID,
        undefined,
        INCIDENTS_DEFAULTS.DEFAULT_OWNER_USER_ID,
      ),
    ),
  );
  const dedupWindowMinutes = Math.max(
    1,
    Math.trunc(
      settingRegistry.getNumber(
        INCIDENTS_SETTING_KEYS.DEDUP_WINDOW_MINUTES,
        undefined,
        INCIDENTS_DEFAULTS.DEDUP_WINDOW_MINUTES,
      ),
    ),
  );
  const siemEnabled = settingRegistry.getBoolean(
    INCIDENTS_SETTING_KEYS.SIEM_ENABLED,
    undefined,
    INCIDENTS_DEFAULTS.SIEM_ENABLED,
  );
  const rawDriver = settingRegistry
    .getString(INCIDENTS_SETTING_KEYS.SIEM_DRIVER, undefined, INCIDENTS_DEFAULTS.SIEM_DRIVER)
    .trim()
    .toLowerCase();
  const siemDriver: SiemDriver = VALID_SIEM_DRIVER_SET.has(rawDriver)
    ? (rawDriver as SiemDriver)
    : SIEM_DRIVER.INTERNAL_LOG;
  const siemEndpoint = settingRegistry
    .getString(INCIDENTS_SETTING_KEYS.SIEM_ENDPOINT, undefined, INCIDENTS_DEFAULTS.SIEM_ENDPOINT)
    .trim();
  const siemAuthToken = settingRegistry
    .getString(INCIDENTS_SETTING_KEYS.SIEM_AUTH_TOKEN, undefined, '')
    .trim();

  return {
    defaultOwnerUserId: defaultOwner,
    dedupWindowMinutes,
    siemEnabled,
    siemDriver,
    siemEndpoint,
    siemAuthToken,
  };
}

export async function allocateIncidentCode(
  sequenceRegistry: SequenceRegistryService | undefined,
): Promise<string> {
  const registry = sequenceRegistry ?? defaultSequenceRegistry;
  try {
    const generated = await registry.nextCode(INCIDENTS_DEFAULTS.INCIDENT_CODE_SEQUENCE_KEY);
    return generated.code;
  } catch {
    return `INC-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  }
}

/** Chuyển đổi độ nghiêm trọng từ SIEM (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`INFO`) hoặc `P1..P4` về chuẩn `P1..P4`. */
export function normalizeIncidentSeverity(
  hint?: string | null,
  fallback: IncidentSeverity = INCIDENT_SEVERITY.P2,
): IncidentSeverity {
  if (!hint) return fallback;
  const upper = hint.trim().toUpperCase();
  if (VALID_SEVERITY_SET.has(upper)) {
    return upper as IncidentSeverity;
  }
  switch (upper) {
    case 'CRITICAL':
      return INCIDENT_SEVERITY.P1;
    case 'HIGH':
    case 'WARNING':
      return INCIDENT_SEVERITY.P2;
    case 'MEDIUM':
      return INCIDENT_SEVERITY.P3;
    case 'LOW':
    case 'INFO':
      return INCIDENT_SEVERITY.P4;
    default:
      return fallback;
  }
}

/** Tạo fingerprint ổn định để gom nhóm các cảnh báo lặp lại (giảm alert noise). */
export function buildIncidentFingerprint(input: IngestIncidentAlertInput): string {
  if (input.fingerprint?.trim()) {
    return input.fingerprint.trim().slice(0, 191);
  }
  const parts = [
    input.source.toUpperCase(),
    input.alertCode.trim().toUpperCase(),
    input.module ? `mod=${input.module.trim().toLowerCase()}` : '',
    input.targetUserId ? `target=${input.targetUserId}` : '',
    !input.targetUserId && input.actorUserId ? `actor=${input.actorUserId}` : '',
    input.ipAddress ? `ip=${input.ipAddress.trim()}` : '',
  ].filter((p) => p.length > 0);
  return parts.join('|').slice(0, 191);
}

export function computeSlaDueAt(
  firstSeenAt: Date,
  severity: IncidentSeverity,
  responseSlaMinutes?: number,
): Date {
  const minutes = responseSlaMinutes ?? DEFAULT_RESPONSE_SLA_MINUTES[severity];
  return new Date(firstSeenAt.getTime() + Math.max(1, minutes) * 60_000);
}

export function appendIncidentTimeline(
  existingJson: string | null | undefined,
  entry: IncidentTimelineEntry,
): string {
  const parsed = safeJsonParse<IncidentTimelineEntry[]>(existingJson, []);
  const entries = Array.isArray(parsed) ? parsed : [];
  const next = [...entries, entry].slice(-100);
  return JSON.stringify(next);
}

export function isValidSiemEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function maskSiemEndpoint(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return trimmed.slice(0, 64);
  }
}

export function formatSiemDispatchRequest(params: {
  driver: SiemDriver;
  endpoint: string;
  authToken: string;
  payload: Record<string, unknown>;
}): { url: string; headers: Record<string, string>; body: string } {
  const { driver, endpoint, authToken, payload } = params;
  const trimmedUrl = endpoint.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (driver === SIEM_DRIVER.SPLUNK_HEC) {
    if (authToken) {
      headers['Authorization'] = authToken.startsWith('Splunk ')
        ? authToken
        : `Splunk ${authToken}`;
    }
    return {
      url: trimmedUrl,
      headers,
      body: JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        sourcetype: 'core:security:siem',
        source: 'core-incidents-ops',
        event: payload,
      }),
    };
  }

  if (driver === SIEM_DRIVER.ELASTIC) {
    if (authToken) {
      headers['Authorization'] =
        authToken.startsWith('ApiKey ') || authToken.startsWith('Bearer ')
          ? authToken
          : `Bearer ${authToken}`;
    }
    return {
      url: trimmedUrl,
      headers,
      body: JSON.stringify({
        '@timestamp': new Date().toISOString(),
        ecs: { version: '8.11.0' },
        event: {
          kind: 'alert',
          category: ['iam', 'security'],
          module: 'core-siem',
        },
        ...payload,
      }),
    };
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return {
    url: trimmedUrl,
    headers,
    body: JSON.stringify(payload),
  };
}
