import { Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../errors/not-found.exception.js';
import {
  SEQUENCE_DATE_FORMAT,
  SEQUENCE_RESET_POLICY,
  SEQUENCE_STATUS,
  computeSequencePeriodKey,
  computeSequenceUnitScope,
  discoverManifestSequences,
  formatSequenceCode,
  resolveSequenceDateParts,
  validateSequenceRule,
  type RegisteredSequenceRuleDefinition,
  type SequenceCounterSnapshot,
  type SequenceGenerateContext,
  type SequenceGeneratedResult,
  type SequenceManifestItem,
  type SequencePreviewInput,
  type SequencePreviewResult,
  type SequenceRuleChangeListener,
  type SequenceStatusCode,
} from '../contracts/sequence.contract.js';

export type SequenceBatchAllocator = (params: {
  rule: RegisteredSequenceRuleDefinition;
  periodKey: string;
  organizationUnitId: number | null;
  unitScopeKey: string;
  count: number;
}) => Promise<number[]>;

export type SequenceCodeExistenceChecker = (params: {
  sequenceKey: string;
  module: string;
  code: string;
}) => Promise<boolean>;

/**
 * L1 Sequence Registry & Concurrency-Safe Generator tại `@packages/kernel` (Mục 5.5).
 * Cho phép bất kỳ module nào trong hệ thống tra cứu quy tắc, xem trước mẫu mã hoặc sinh mã tuần tự
 * an toàn khi nhiều request gọi đồng thời.
 */
@Injectable()
export class SequenceRegistryService {
  private readonly rules = new Map<string, RegisteredSequenceRuleDefinition>();
  private readonly counters = new Map<string, SequenceCounterSnapshot>();
  private readonly issuedCodes = new Set<string>();
  private readonly scopeLocks = new Map<string, Promise<void>>();
  private readonly listeners = new Set<SequenceRuleChangeListener>();
  private persistentAllocator: SequenceBatchAllocator | null = null;
  private persistentExistenceChecker: SequenceCodeExistenceChecker | null = null;

  /**
   * Đăng ký bộ cấp phát bền vững (L2 DB `sequence_counters`) và bộ kiểm tra trùng mã tự động
   * để mọi lời gọi `sequenceRegistry.nextCode()` đều tự động lưu vào DB và tự nhảy qua mã đã tồn tại.
   */
  public setPersistentBackend(params: {
    allocator?: SequenceBatchAllocator | null;
    existenceChecker?: SequenceCodeExistenceChecker | null;
  }): void {
    if (params.allocator !== undefined) {
      this.persistentAllocator = params.allocator;
    }
    if (params.existenceChecker !== undefined) {
      this.persistentExistenceChecker = params.existenceChecker;
    }
  }

  /** Đăng ký hoặc cập nhật một quy tắc sinh mã vào L1 Registry */
  public registerRule(
    rule: RegisteredSequenceRuleDefinition,
    options?: { silent?: boolean },
  ): RegisteredSequenceRuleDefinition {
    const normalizedKey = rule.key.trim().toLowerCase();
    const entry: RegisteredSequenceRuleDefinition = {
      ...rule,
      key: normalizedKey,
      module: rule.module.trim().toLowerCase(),
      updatedAt: rule.updatedAt ?? new Date().toISOString(),
    };
    this.rules.set(normalizedKey, entry);

    if (!options?.silent) {
      for (const listener of this.listeners) {
        void Promise.resolve(
          listener({
            key: entry.key,
            module: entry.module,
          }),
        );
      }
    }
    return entry;
  }

  /** Đồng bộ danh sách quy tắc từ `module.manifest.json` vào L1 Registry */
  public registerManifestSequences(items?: readonly SequenceManifestItem[]): number {
    const list = items ?? discoverManifestSequences();
    let count = 0;
    for (const item of list) {
      const validated = validateSequenceRule({
        key: item.key,
        name: item.name,
        prefix: item.prefix,
        suffix: item.suffix,
        separator: item.separator,
        dateFormat: item.dateFormat,
        templatePattern: item.templatePattern,
        paddingLength: item.paddingLength,
        startValue: item.startValue,
        step: item.step,
        resetPolicy: item.resetPolicy,
        scopeByUnit: item.scopeByUnit,
        timezone: item.timezone,
      });
      const existing = this.rules.get(validated.key);
      if (existing) continue;

      this.registerRule(
        {
          key: validated.key,
          module: (item.module ?? validated.key.split('.')[0] ?? 'settings').trim().toLowerCase(),
          name: validated.name,
          description: item.description?.trim() ?? null,
          prefix: validated.prefix,
          suffix: validated.suffix,
          separator: validated.separator,
          dateFormat: validated.dateFormat,
          dateFormatName: validated.dateFormatName,
          templatePattern: validated.templatePattern,
          paddingLength: validated.paddingLength,
          startValue: validated.startValue,
          step: validated.step,
          resetPolicy: validated.resetPolicy,
          resetPolicyName: validated.resetPolicyName,
          scopeByUnit: validated.scopeByUnit,
          timezone: validated.timezone,
          isSystem: item.isSystem ?? true,
          status: (item.status as SequenceStatusCode | undefined) ?? SEQUENCE_STATUS.ACTIVE,
        },
        { silent: true },
      );
      count++;
    }
    return count;
  }

  public getRule(key: string): RegisteredSequenceRuleDefinition | null {
    const normalized = key.trim().toLowerCase();
    let found = this.rules.get(normalized) ?? null;
    if (!found && this.rules.size === 0) {
      this.registerManifestSequences();
      found = this.rules.get(normalized) ?? null;
    }
    return found;
  }

  public listRules(filter?: {
    module?: string | undefined;
    status?: number | undefined;
    search?: string | undefined;
  }): RegisteredSequenceRuleDefinition[] {
    let items = Array.from(this.rules.values());
    if (filter?.module) {
      const mod = filter.module.trim().toLowerCase();
      items = items.filter((r) => r.module === mod);
    }
    if (filter?.status !== undefined) {
      items = items.filter((r) => r.status === filter.status);
    }
    if (filter?.search) {
      const q = filter.search.trim().toLowerCase();
      items = items.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.prefix.toLowerCase().includes(q),
      );
    }
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * 5.5.7: Xem trước mẫu mã trước khi áp dụng (tránh cấu hình sai, tuyệt đối không tăng bộ đếm).
   */
  public preview(input: SequencePreviewInput): SequencePreviewResult {
    const existing = input.key ? this.getRule(input.key) : null;
    const validated = validateSequenceRule({
      key: input.key ?? existing?.key ?? 'preview.sequence',
      name: existing?.name ?? 'Preview Sequence',
      prefix: input.prefix ?? existing?.prefix ?? '',
      suffix: input.suffix ?? existing?.suffix ?? '',
      separator: input.separator ?? existing?.separator ?? '-',
      dateFormat: input.dateFormat ?? existing?.dateFormat ?? SEQUENCE_DATE_FORMAT.YYYY,
      templatePattern:
        input.templatePattern !== undefined
          ? input.templatePattern
          : (existing?.templatePattern ?? null),
      paddingLength: input.paddingLength ?? existing?.paddingLength ?? 6,
      startValue: input.startValue ?? existing?.startValue ?? 1,
      step: input.step ?? existing?.step ?? 1,
      resetPolicy: input.resetPolicy ?? existing?.resetPolicy ?? SEQUENCE_RESET_POLICY.YEARLY,
      scopeByUnit: input.scopeByUnit ?? existing?.scopeByUnit ?? false,
      timezone: input.timezone ?? existing?.timezone ?? 'Asia/Ho_Chi_Minh',
      requireKeyAndName: false,
    });

    const firstSeq =
      input.sampleSequenceNumber !== undefined && input.sampleSequenceNumber >= 1
        ? Math.trunc(input.sampleSequenceNumber)
        : validated.startValue;

    const context: SequenceGenerateContext = {
      organizationUnitId: input.organizationUnitId,
      unitCode: input.unitCode ?? (validated.scopeByUnit ? 'HCM' : undefined),
      at: input.at,
      timezone: validated.timezone,
    };

    const firstFormatted = formatSequenceCode(validated, firstSeq, context);
    const secondFormatted = formatSequenceCode(validated, firstSeq + validated.step, context);
    const thirdFormatted = formatSequenceCode(validated, firstSeq + validated.step * 2, context);
    const periodKey = computeSequencePeriodKey(
      validated.resetPolicy,
      firstFormatted.periodDateParts,
    );

    return {
      sampleCode: firstFormatted.code,
      nextSampleCodes: [firstFormatted.code, secondFormatted.code, thirdFormatted.code],
      resolvedTemplate: firstFormatted.resolvedTemplate,
      dateFormat: validated.dateFormat,
      dateFormatName: validated.dateFormatName,
      resetPolicy: validated.resetPolicy,
      resetPolicyName: validated.resetPolicyName,
      periodKey,
      unitScopeKey: firstFormatted.unitScopeKey,
      dateSegment: firstFormatted.dateSegment,
      paddingLength: validated.paddingLength,
      startValue: validated.startValue,
      step: validated.step,
    };
  }

  /**
   * 5.5.4 -> 5.5.6: Sinh một mã nghiệp vụ tiếp theo an toàn đồng thời (Concurrency-Safe).
   */
  public async nextCode(
    key: string,
    context?: SequenceGenerateContext,
  ): Promise<SequenceGeneratedResult> {
    const batch = await this.nextBatch(key, 1, context);
    return batch[0]!;
  }

  /**
   * Sinh một lô `count` mã nghiệp vụ liên tiếp an toàn đồng thời (Zero Duplicate).
   * Có thể truyền `customAllocator` (ví dụ: DB Atomic Upsert từ `SequencesService`) bên trong khóa tuần tự.
   */
  public async nextBatch(
    key: string,
    count = 1,
    context?: SequenceGenerateContext,
    customAllocator?: (params: {
      rule: RegisteredSequenceRuleDefinition;
      periodKey: string;
      organizationUnitId: number | null;
      unitScopeKey: string;
      count: number;
    }) => Promise<number[]>,
  ): Promise<SequenceGeneratedResult[]> {
    const normalizedKey = key.trim().toLowerCase();
    const rule = this.getRule(normalizedKey);
    if (!rule) {
      throw new NotFoundAppException(`Sequence rule '${normalizedKey}' not found`);
    }

    const safeCount = Math.min(500, Math.max(1, Math.trunc(count)));
    const tz = context?.timezone?.trim() || rule.timezone || 'Asia/Ho_Chi_Minh';
    const dateParts = resolveSequenceDateParts(context?.at, tz);
    const periodKey = computeSequencePeriodKey(rule.resetPolicy, dateParts);
    const unitInfo = computeSequenceUnitScope({
      scopeByUnit: rule.scopeByUnit,
      organizationUnitId: context?.organizationUnitId,
      unitCode: context?.unitCode,
    });

    const counterMapKey = this.buildCounterKey(normalizedKey, periodKey, unitInfo.unitScopeKey);
    const activeAllocator = customAllocator ?? this.persistentAllocator;

    return this.withScopeLock(counterMapKey, async () => {
      const allocateNumbersOnce = async (batchSize: number): Promise<number[]> => {
        if (activeAllocator) {
          return activeAllocator({
            rule,
            periodKey,
            organizationUnitId: unitInfo.organizationUnitId,
            unitScopeKey: unitInfo.unitScopeKey,
            count: batchSize,
          });
        }

        const existingCounter = this.counters.get(counterMapKey);
        let currentVal = existingCounter?.currentValue ?? 0;
        const nums: number[] = [];
        for (let i = 0; i < batchSize; i++) {
          if (currentVal === 0) {
            currentVal = rule.startValue;
          } else {
            currentVal = Math.max(currentVal + rule.step, rule.startValue);
          }
          nums.push(currentVal);
        }
        return nums;
      };

      const acceptedResults: SequenceGeneratedResult[] = [];
      let lastAllocatedNumber = this.counters.get(counterMapKey)?.currentValue ?? rule.startValue;
      const nowIso = new Date().toISOString();
      const maxCollisionProbes = Math.max(200, safeCount * 20);
      let probes = 0;

      while (acceptedResults.length < safeCount && probes < maxCollisionProbes) {
        const needed = safeCount - acceptedResults.length;
        const candidateNumbers = await allocateNumbersOnce(needed);
        probes += candidateNumbers.length;

        for (const seqNum of candidateNumbers) {
          lastAllocatedNumber = seqNum;
          this.counters.set(counterMapKey, {
            sequenceKey: normalizedKey,
            periodKey,
            organizationUnitId: unitInfo.organizationUnitId,
            unitScopeKey: unitInfo.unitScopeKey,
            currentValue: lastAllocatedNumber,
            updatedAt: nowIso,
          });

          const formatted = formatSequenceCode(rule, seqNum, context);
          const issuedToken = `${normalizedKey}::${formatted.code}`;
          if (this.issuedCodes.has(issuedToken)) {
            continue;
          }

          if (this.persistentExistenceChecker) {
            const existsInDb = await this.persistentExistenceChecker({
              sequenceKey: rule.key,
              module: rule.module,
              code: formatted.code,
            }).catch(() => false);
            if (existsInDb) {
              this.issuedCodes.add(issuedToken);
              continue;
            }
          }

          this.issuedCodes.add(issuedToken);
          acceptedResults.push({
            key: rule.key,
            module: rule.module,
            code: formatted.code,
            sequenceNumber: seqNum,
            paddedSequence: formatted.paddedSequence,
            periodKey,
            unitScopeKey: unitInfo.unitScopeKey,
            organizationUnitId: unitInfo.organizationUnitId,
            dateSegment: formatted.dateSegment,
            generatedAt: nowIso,
          });

          if (acceptedResults.length >= safeCount) {
            break;
          }
        }
      }

      return acceptedResults;
    });
  }

  /** Đồng bộ giá trị bộ đếm từ DB vào L1 Registry */
  public setCounterSnapshot(snapshot: SequenceCounterSnapshot): void {
    const mapKey = this.buildCounterKey(
      snapshot.sequenceKey,
      snapshot.periodKey,
      snapshot.unitScopeKey,
    );
    this.counters.set(mapKey, snapshot);
  }

  public getCounters(sequenceKey?: string): SequenceCounterSnapshot[] {
    const items = Array.from(this.counters.values());
    if (!sequenceKey) return items;
    const normalized = sequenceKey.trim().toLowerCase();
    return items.filter((c) => c.sequenceKey === normalized);
  }

  public onRuleChanged(listener: SequenceRuleChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clear(): void {
    this.rules.clear();
    this.counters.clear();
    this.issuedCodes.clear();
    this.scopeLocks.clear();
  }

  private buildCounterKey(sequenceKey: string, periodKey: string, unitScopeKey: string): string {
    return `${sequenceKey.trim().toLowerCase()}::${periodKey}::${unitScopeKey}`;
  }

  private async withScopeLock<T>(lockKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.scopeLocks.get(lockKey) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const chainedLock = previous.then(() => currentLock);
    this.scopeLocks.set(lockKey, chainedLock);

    await previous;
    try {
      return await work();
    } finally {
      releaseLock();
      if (this.scopeLocks.get(lockKey) === chainedLock) {
        this.scopeLocks.delete(lockKey);
      }
    }
  }
}

export const defaultSequenceRegistry = new SequenceRegistryService();
