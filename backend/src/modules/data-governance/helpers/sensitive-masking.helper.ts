import { createHash } from 'node:crypto';
import {
  buildCsvContent,
  maskEmail,
  maskPhone,
  normalizeSpreadsheetHeader,
  parseCsvToMatrix,
  type PersonalDataModuleSection,
  type SensitiveFieldActorContext,
  type SensitiveFieldMaskStrategy,
  type SensitiveFieldPolicyRule,
} from '@packages/kernel/index.js';
import { DATA_GOVERNANCE_PERMISSIONS } from '../enum/data-governance.enum.js';

function canonicalFieldKey(raw: string): string {
  return normalizeSpreadsheetHeader(raw).replace(/[-_\s]/g, '');
}

export function maskValueByStrategy(value: unknown, strategy: SensitiveFieldMaskStrategy): unknown {
  if (value === null || value === undefined) return value;
  const raw = String(value);
  if (!raw.trim()) return value;

  switch (strategy) {
    case 'EMAIL':
      return maskEmail(raw);
    case 'PHONE':
      return maskPhone(raw);
    case 'PARTIAL': {
      if (raw.length <= 4) return '••••';
      return `${raw.slice(0, 2)}${'•'.repeat(Math.min(6, raw.length - 4))}${raw.slice(-2)}`;
    }
    case 'HASH':
      return `sha256:${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
    case 'FULL':
    default:
      return '••••••••';
  }
}

export function canActorBypassSensitiveMask(
  rule: SensitiveFieldPolicyRule,
  actor?: SensitiveFieldActorContext,
): boolean {
  if (!actor) return false;
  const roles = new Set((actor.roles ?? []).map((r) => r.trim().toLowerCase()));
  if (roles.has('super_admin')) return true;

  const perms = new Set(actor.permissions ?? []);
  if (perms.has('*') || perms.has(DATA_GOVERNANCE_PERMISSIONS.SENSITIVE_READ)) {
    return true;
  }
  if (rule.requiredPermission && perms.has(rule.requiredPermission)) {
    return true;
  }
  return false;
}

export function applySensitiveMaskToRecord<T extends Record<string, unknown>>(
  record: T,
  rules: readonly SensitiveFieldPolicyRule[],
  actor?: SensitiveFieldActorContext,
  context: 'read' | 'export' = 'read',
): T {
  if (rules.length === 0) return record;
  const clone: Record<string, unknown> = { ...record };

  for (const rule of rules) {
    if (context === 'export' && !rule.maskInExport) continue;
    if (canActorBypassSensitiveMask(rule, actor)) continue;

    const parts = rule.fieldPath.split('.').filter(Boolean);
    if (parts.length === 0) continue;

    if (parts.length === 1) {
      const targetKey = canonicalFieldKey(parts[0]!);
      for (const existingKey of Object.keys(clone)) {
        if (canonicalFieldKey(existingKey) === targetKey) {
          clone[existingKey] = maskValueByStrategy(clone[existingKey], rule.maskStrategy);
        }
      }
      continue;
    }

    let cursor: Record<string, unknown> | null = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor) break;
      const seg = parts[i]!;
      const nextVal: unknown = cursor[seg];
      if (!nextVal || typeof nextVal !== 'object' || Array.isArray(nextVal)) {
        cursor = null;
        break;
      }
      const nestedCopy: Record<string, unknown> = { ...(nextVal as Record<string, unknown>) };
      cursor[seg] = nestedCopy;
      cursor = nestedCopy;
    }
    const leaf = parts[parts.length - 1]!;
    if (cursor && leaf in cursor) {
      cursor[leaf] = maskValueByStrategy(cursor[leaf], rule.maskStrategy);
    }
  }

  return clone as T;
}

export function maskCsvContentColumns(params: {
  readonly csvContent: string;
  readonly rules: readonly SensitiveFieldPolicyRule[];
  readonly actor?: SensitiveFieldActorContext | undefined;
}): { readonly csvContent: string; readonly maskedColumns: readonly string[] } {
  const { csvContent, rules, actor } = params;
  if (!csvContent.trim() || rules.length === 0) {
    return { csvContent, maskedColumns: [] };
  }

  const applicableRules = rules.filter(
    (r) => r.maskInExport && !canActorBypassSensitiveMask(r, actor),
  );
  if (applicableRules.length === 0) {
    return { csvContent, maskedColumns: [] };
  }

  const matrix = parseCsvToMatrix(csvContent);
  if (matrix.length < 2) {
    return { csvContent, maskedColumns: [] };
  }

  const headers = matrix[0]!;
  const dataRows = matrix.slice(1);

  const ruleByCanonicalHeader = new Map<string, SensitiveFieldPolicyRule>();
  for (const r of applicableRules) {
    const leaf = r.fieldPath.split('.').pop() ?? r.fieldPath;
    ruleByCanonicalHeader.set(canonicalFieldKey(leaf), r);
    ruleByCanonicalHeader.set(canonicalFieldKey(r.fieldPath), r);
  }

  const matchedHeaders = new Set<string>();
  const maskedMatrixRows = dataRows.map((row: readonly string[]) =>
    headers.map((header: string, colIdx: number) => {
      const cellVal = row[colIdx] ?? '';
      const matchedRule = ruleByCanonicalHeader.get(canonicalFieldKey(header));
      if (matchedRule && cellVal !== '') {
        matchedHeaders.add(header);
        return String(maskValueByStrategy(cellVal, matchedRule.maskStrategy));
      }
      return cellVal;
    }),
  );

  if (matchedHeaders.size === 0) {
    return { csvContent, maskedColumns: [] };
  }

  return {
    csvContent: buildCsvContent(headers, maskedMatrixRows),
    maskedColumns: [...matchedHeaders],
  };
}

export function buildPortablePersonalDataCsv(
  sections: readonly PersonalDataModuleSection[],
): string {
  const headers = [
    'module_name',
    'data_type_code',
    'classification_level',
    'record_index',
    'record_json',
  ];

  const rows: Array<Array<string | number>> = [];
  for (const section of sections) {
    section.records.forEach((rec, idx) => {
      rows.push([
        section.moduleName,
        section.dataTypeCode,
        section.classificationLevel,
        idx + 1,
        JSON.stringify(rec),
      ]);
    });
  }

  return buildCsvContent(headers, rows);
}

export function computeSha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
