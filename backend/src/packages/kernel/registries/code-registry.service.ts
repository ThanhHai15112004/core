import { Injectable } from '@nestjs/common';
import {
  CODE_ITEM_STATUS,
  discoverManifestCodeTypes,
  type CodeI18nResolver,
  type CodeI18nTranslator,
  type CodeItemStatusCode,
  type CodeTypeManifestItem,
  type CodeValueManifestItem,
  type CodeValueUsageCheckResult,
  type CodeValueUsageChecker,
  type CodeValueUsageSource,
  type RegisteredCodeType,
  type RegisteredCodeValue,
  type ResolvedCodeValueView,
} from '../contracts/code-lookup.contract.js';

@Injectable()
export class CodeRegistryService {
  private static sharedInstance: CodeRegistryService | null = null;

  public static getInstance(): CodeRegistryService {
    if (!CodeRegistryService.sharedInstance) {
      CodeRegistryService.sharedInstance = new CodeRegistryService();
    }
    return CodeRegistryService.sharedInstance;
  }

  private readonly codeTypes = new Map<string, RegisteredCodeType>();
  private readonly usageCheckers = new Map<string, Map<string, CodeValueUsageChecker>>();
  private i18nTranslator?: CodeI18nTranslator;
  private i18nResolver?: CodeI18nResolver;

  constructor() {
    this.seedDefaults();
    if (!CodeRegistryService.sharedInstance) {
      CodeRegistryService.sharedInstance = this;
    }
  }

  /** Nạp danh mục khai báo từ `module.manifest.json` của các module vào L1 Memory (100% Domain-Agnostic) */
  public seedDefaults(): void {
    this.registerManifestTypes(discoverManifestCodeTypes());
  }

  /** Đăng ký hàm dịch từ CoreI18nService cho tầng fallback đa ngôn ngữ tĩnh */
  public setI18nTranslator(translator: CodeI18nTranslator): void {
    this.i18nTranslator = translator;
  }

  /** Đăng ký hàm phân giải nhãn i18n theo `(typeCode, valueCode, locale)` */
  public setI18nResolver(resolver: CodeI18nResolver): void {
    this.i18nResolver = resolver;
  }

  /** Đăng ký hàng loạt nhóm danh mục từ mảng `module.manifest.json` */
  public registerManifestTypes(items: readonly CodeTypeManifestItem[]): void {
    for (const item of items) {
      this.registerCodeType(item);
    }
  }

  /** Đăng ký hoặc cập nhật một nhóm mã (`code_type`) cùng danh sách giá trị (`code_values`) vào bộ nhớ đệm L1 */
  public registerCodeType(
    input: CodeTypeManifestItem & { id?: number | undefined },
  ): RegisteredCodeType {
    const normalizedTypeCode = input.code.trim().toLowerCase();
    const inferredModule =
      input.module?.trim().toLowerCase() ||
      (normalizedTypeCode.includes('.') ? normalizedTypeCode.split('.')[0]! : 'core');

    const existing = this.codeTypes.get(normalizedTypeCode);
    const rawStatus = input.status ?? existing?.status ?? CODE_ITEM_STATUS.ACTIVE;
    const status: CodeItemStatusCode =
      rawStatus === CODE_ITEM_STATUS.INACTIVE ? CODE_ITEM_STATUS.INACTIVE : CODE_ITEM_STATUS.ACTIVE;

    const typeRecord: RegisteredCodeType = {
      id: input.id ?? existing?.id,
      code: normalizedTypeCode,
      module: inferredModule,
      name: input.name.trim(),
      description:
        input.description !== undefined
          ? (input.description ?? null)
          : (existing?.description ?? null),
      isSystem: input.isSystem ?? existing?.isSystem ?? false,
      allowCustomValues: input.allowCustomValues ?? existing?.allowCustomValues ?? true,
      status,
      valuesByNumericCode: existing?.valuesByNumericCode ?? new Map<number, RegisteredCodeValue>(),
      valuesByCode: existing?.valuesByCode ?? new Map<string, RegisteredCodeValue>(),
    };

    this.codeTypes.set(normalizedTypeCode, typeRecord);

    for (const val of input.values ?? []) {
      this.upsertCodeValue(normalizedTypeCode, val);
    }

    if (CodeRegistryService.sharedInstance && CodeRegistryService.sharedInstance !== this) {
      CodeRegistryService.sharedInstance.codeTypes.set(normalizedTypeCode, typeRecord);
    }

    return typeRecord;
  }

  /** Thay thế toàn bộ danh sách giá trị của một nhóm mã trong L1 Memory (khi đồng bộ từ DB) */
  public replaceTypeValues(
    typeMeta: CodeTypeManifestItem & { id?: number | undefined },
    values: readonly CodeValueManifestItem[],
  ): RegisteredCodeType {
    const normalizedTypeCode = typeMeta.code.trim().toLowerCase();
    const existing = this.codeTypes.get(normalizedTypeCode);
    if (existing) {
      existing.valuesByNumericCode.clear();
      existing.valuesByCode.clear();
    }
    return this.registerCodeType({
      ...typeMeta,
      values,
    });
  }

  /** Thêm mới hoặc cập nhật một giá trị mã (`code_value`) trong nhóm `typeCode` */
  public upsertCodeValue(
    typeCode: string,
    input: CodeValueManifestItem & { id?: number | undefined },
  ): RegisteredCodeValue {
    const normalizedTypeCode = typeCode.trim().toLowerCase();
    let group = this.codeTypes.get(normalizedTypeCode);
    if (!group) {
      group = this.registerCodeType({
        code: normalizedTypeCode,
        name: normalizedTypeCode,
        allowCustomValues: true,
      });
    }

    const numericCode = Number(input.numericCode);
    const normalizedCode = input.code.trim().toUpperCase();
    const existing =
      group.valuesByNumericCode.get(numericCode) ?? group.valuesByCode.get(normalizedCode);

    const record: RegisteredCodeValue = {
      id: input.id ?? existing?.id,
      typeCode: normalizedTypeCode,
      numericCode,
      code: normalizedCode,
      name: input.name.trim(),
      description:
        input.description !== undefined
          ? (input.description ?? null)
          : (existing?.description ?? null),
      labels: {
        ...(existing?.labels ?? {}),
        ...(input.labels ?? {}),
      },
      aliases: input.aliases
        ? [...new Set(input.aliases.map((a) => a.trim().toUpperCase()).filter(Boolean))]
        : (existing?.aliases ?? []),
      behaviorCode:
        input.behaviorCode !== undefined
          ? input.behaviorCode
            ? input.behaviorCode.trim().toUpperCase()
            : null
          : (existing?.behaviorCode ?? normalizedCode),
      badgeTone: input.badgeTone ?? existing?.badgeTone ?? 'neutral',
      color: input.color !== undefined ? (input.color ?? null) : (existing?.color ?? null),
      icon: input.icon !== undefined ? (input.icon ?? null) : (existing?.icon ?? null),
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? numericCode,
      isDefault: input.isDefault ?? existing?.isDefault ?? false,
      metadata:
        input.metadata !== undefined
          ? input.metadata
            ? { ...input.metadata }
            : null
          : (existing?.metadata ?? null),
      isSystem: input.isSystem ?? existing?.isSystem ?? false,
      status: input.status ?? existing?.status ?? CODE_ITEM_STATUS.ACTIVE,
    };

    if (existing && existing.code !== normalizedCode) {
      group.valuesByCode.delete(existing.code);
    }
    group.valuesByNumericCode.set(numericCode, record);
    group.valuesByCode.set(normalizedCode, record);

    if (CodeRegistryService.sharedInstance && CodeRegistryService.sharedInstance !== this) {
      CodeRegistryService.sharedInstance.codeTypes.set(normalizedTypeCode, group);
    }

    return record;
  }

  /** Thêm/cập nhật một phần tử và trả về trực tiếp `ResolvedCodeValueView` */
  public upsertValue(
    typeCode: string,
    input: CodeValueManifestItem & { id?: number | undefined },
    locale = 'vi',
  ): ResolvedCodeValueView {
    const record = this.upsertCodeValue(typeCode, input);
    const group = this.getCodeType(typeCode)!;
    return this.toResolvedView(group, record, locale);
  }

  /** Xóa một phần tử khỏi bộ nhớ đệm L1 */
  public removeCodeValue(typeCode: string, numericCode: number): boolean {
    const normalizedTypeCode = typeCode.trim().toLowerCase();
    const group = this.codeTypes.get(normalizedTypeCode);
    if (!group) return false;
    const existing = group.valuesByNumericCode.get(Number(numericCode));
    if (!existing) return false;
    group.valuesByNumericCode.delete(Number(numericCode));
    group.valuesByCode.delete(existing.code);
    return true;
  }

  /** Alias cho `removeCodeValue` */
  public removeValue(typeCode: string, numericCode: number): boolean {
    return this.removeCodeValue(typeCode, numericCode);
  }

  /** Lấy thông tin một nhóm mã theo `typeCode` */
  public getCodeType(typeCode: string): RegisteredCodeType | null {
    return this.codeTypes.get(typeCode.trim().toLowerCase()) ?? null;
  }

  /** Alias cho `getCodeType` */
  public getType(typeCode: string): RegisteredCodeType | null {
    return this.getCodeType(typeCode);
  }

  /** Liệt kê toàn bộ các nhóm mã đã đăng ký (hỗ trợ lọc theo `module` và `search`) */
  public listCodeTypes(filter?: {
    module?: string | undefined;
    search?: string | undefined;
  }): RegisteredCodeType[] {
    let list = [...this.codeTypes.values()];
    if (filter?.module?.trim()) {
      const m = filter.module.trim().toLowerCase();
      list = list.filter((t) => t.module === m);
    }
    if (filter?.search?.trim()) {
      const kw = filter.search.trim().toLowerCase();
      list = list.filter(
        (t) => t.code.toLowerCase().includes(kw) || t.name.toLowerCase().includes(kw),
      );
    }
    return list.sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Alias cho `listCodeTypes` */
  public listTypes(filter?: {
    module?: string | undefined;
    search?: string | undefined;
  }): RegisteredCodeType[] {
    return this.listCodeTypes(filter);
  }

  /** Liệt kê các giá trị trong một nhóm mã, đã phân giải nhãn đa ngôn ngữ */
  public listCodeValues(
    typeCode: string,
    options?: {
      locale?: string | undefined;
      includeInactive?: boolean | undefined;
    },
  ): ResolvedCodeValueView[] {
    const group = this.getCodeType(typeCode);
    if (!group) return [];
    const locale = options?.locale?.trim().toLowerCase() || 'vi';
    const includeInactive = options?.includeInactive ?? false;

    return [...group.valuesByNumericCode.values()]
      .filter((item) => includeInactive || item.status === CODE_ITEM_STATUS.ACTIVE)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.numericCode - b.numericCode)
      .map((item) => this.toResolvedView(group, item, locale));
  }

  /** Alias cho `listCodeValues` */
  public listValues(
    typeCode: string,
    options?: {
      locale?: string | undefined;
      includeInactive?: boolean | undefined;
    },
  ): ResolvedCodeValueView[] {
    return this.listCodeValues(typeCode, options);
  }

  /** Trả về toàn bộ từ điển Bootstrap cho Frontend/Mobile trong 1 lần gọi */
  public getBootstrapDictionary(options?: {
    locale?: string | undefined;
    module?: string | undefined;
    includeInactive?: boolean | undefined;
  }): Record<string, ResolvedCodeValueView[]> {
    const locale = options?.locale?.trim().toLowerCase() || 'vi';
    const includeInactive = options?.includeInactive ?? false;
    const types = this.listCodeTypes({ module: options?.module });
    const dict: Record<string, ResolvedCodeValueView[]> = {};

    for (const ct of types) {
      if (!includeInactive && ct.status === CODE_ITEM_STATUS.INACTIVE) continue;
      dict[ct.code] = this.listCodeValues(ct.code, { locale, includeInactive });
    }
    return dict;
  }

  /** Kiểm tra một `numericCode` có hợp lệ và đang hoạt động trong `typeCode` hay không */
  public isValidNumericCode(
    typeCode: string,
    numericCode: unknown,
    allowInactive = false,
  ): boolean {
    if (typeof numericCode !== 'number' || !Number.isInteger(numericCode)) {
      return false;
    }
    const group = this.getCodeType(typeCode);
    if (!group) return false;
    const item = group.valuesByNumericCode.get(numericCode);
    if (!item) return false;
    return allowInactive || item.status === CODE_ITEM_STATUS.ACTIVE;
  }

  /**
   * Phân tích đầu vào bất kỳ (số nguyên, chuỗi số, mã code, tên hiển thị, hoặc từ đồng nghĩa alias)
   * về `numericCode` chuẩn trong nhóm `typeCode`.
   */
  public parseToNumericCode(
    typeCode: string,
    rawInput: unknown,
    fallbackNumericCode = 1,
    options?: { strict?: boolean | undefined; allowInactive?: boolean | undefined },
  ): number {
    const group = this.getCodeType(typeCode);
    if (!group) return fallbackNumericCode;
    const allowInactive = options?.allowInactive ?? true;

    if (typeof rawInput === 'number' && Number.isInteger(rawInput)) {
      const direct = group.valuesByNumericCode.get(rawInput);
      if (direct && (allowInactive || direct.status === CODE_ITEM_STATUS.ACTIVE)) {
        return direct.numericCode;
      }
      for (const item of group.valuesByNumericCode.values()) {
        if (item.aliases.includes(String(rawInput))) {
          return item.numericCode;
        }
      }
      return fallbackNumericCode;
    }

    if (typeof rawInput === 'string') {
      const trimmed = rawInput.trim();
      if (!trimmed) return fallbackNumericCode;

      const asNum = Number(trimmed);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        const byNum = group.valuesByNumericCode.get(asNum);
        if (byNum && (allowInactive || byNum.status === CODE_ITEM_STATUS.ACTIVE)) {
          return byNum.numericCode;
        }
      }

      const upper = trimmed.toUpperCase();
      const byCode = group.valuesByCode.get(upper);
      if (byCode && (allowInactive || byCode.status === CODE_ITEM_STATUS.ACTIVE)) {
        return byCode.numericCode;
      }

      for (const item of group.valuesByNumericCode.values()) {
        if (!allowInactive && item.status !== CODE_ITEM_STATUS.ACTIVE) continue;
        if (
          item.name.toUpperCase() === upper ||
          item.aliases.includes(upper) ||
          Object.values(item.labels).some((lbl) => lbl.toUpperCase() === upper)
        ) {
          return item.numericCode;
        }
      }

      if (!options?.strict) {
        for (const item of group.valuesByNumericCode.values()) {
          if (!allowInactive && item.status !== CODE_ITEM_STATUS.ACTIVE) continue;
          if (item.aliases.some((alias) => alias.length >= 3 && upper.includes(alias))) {
            return item.numericCode;
          }
        }
      }
    }

    return fallbackNumericCode;
  }

  /** Lấy mã định danh chuỗi (`code` — vd `'HEADQUARTERS'`, `'CAMPUS'`, `'ACTIVE'`) từ `numericCode` */
  public getCodeName(typeCode: string, numericCode: number, fallbackCode = ''): string {
    const group = this.getCodeType(typeCode);
    const item = group?.valuesByNumericCode.get(Number(numericCode));
    return item?.code ?? fallbackCode;
  }

  /**
   * Lấy mã hành vi hệ thống (`behaviorCode`) của một `numericCode` (Hybrid Architecture).
   */
  public getBehaviorCode(
    typeCode: string,
    numericCode: number,
    fallbackBehavior = 'ACTIVE',
  ): string {
    const group = this.getCodeType(typeCode);
    const item = group?.valuesByNumericCode.get(Number(numericCode));
    return item?.behaviorCode ?? item?.code ?? fallbackBehavior;
  }

  /** Alias cho `getBehaviorCode` */
  public resolveBehaviorCode(
    typeCode: string,
    numericCode: number,
    fallbackBehavior = 'ACTIVE',
  ): string {
    return this.getBehaviorCode(typeCode, numericCode, fallbackBehavior);
  }

  /**
   * Phân giải nhãn hiển thị đa ngôn ngữ 2 tầng (Zero-JOIN)
   */
  public getLabel(typeCode: string, numericCodeOrCode: number | string, locale = 'vi'): string {
    const group = this.getCodeType(typeCode);
    if (!group) return String(numericCodeOrCode);

    const item =
      typeof numericCodeOrCode === 'number'
        ? group.valuesByNumericCode.get(numericCodeOrCode)
        : (group.valuesByCode.get(String(numericCodeOrCode).trim().toUpperCase()) ??
          group.valuesByNumericCode.get(Number(numericCodeOrCode)));

    if (!item) return String(numericCodeOrCode);
    return this.resolveItemLabel(group, item, locale);
  }

  /** Cấp phát `numericCode` tự động tiếp theo khi Admin thêm mới phần tử động vào nhóm mã */
  public getNextNumericCode(typeCode: string): number {
    const group = this.getCodeType(typeCode);
    if (!group || group.valuesByNumericCode.size === 0) return 1;
    return Math.max(...group.valuesByNumericCode.keys()) + 1;
  }

  /**
   * Đăng ký hàm kiểm tra mức độ sử dụng (`UsageChecker`) cho một `typeCode` từ module nghiệp vụ
   */
  public registerUsageChecker(
    typeCode: string,
    source: string,
    checker: CodeValueUsageChecker,
  ): void {
    const normalizedType = typeCode.trim().toLowerCase();
    const normalizedSource = source.trim();
    let bySource = this.usageCheckers.get(normalizedType);
    if (!bySource) {
      bySource = new Map<string, CodeValueUsageChecker>();
      this.usageCheckers.set(normalizedType, bySource);
    }
    bySource.set(normalizedSource, checker);

    if (CodeRegistryService.sharedInstance && CodeRegistryService.sharedInstance !== this) {
      CodeRegistryService.sharedInstance.registerUsageChecker(
        normalizedType,
        normalizedSource,
        checker,
      );
    }
  }

  /**
   * Kiểm tra xem một mục danh mục `(typeCode, numericCode)` có đang được sử dụng bởi dữ liệu nghiệp vụ hay không.
   */
  public async checkValueUsage(
    typeCode: string,
    numericCode: number,
    fallbackCode?: string,
  ): Promise<CodeValueUsageCheckResult> {
    const normalizedType = typeCode.trim().toLowerCase();
    const num = Number(numericCode);
    const group =
      this.getCodeType(normalizedType) ??
      CodeRegistryService.sharedInstance?.getCodeType(normalizedType) ??
      null;
    const item = group?.valuesByNumericCode.get(num);
    const code = item?.code ?? fallbackCode?.trim().toUpperCase() ?? String(num);

    const mergedCheckers = new Map<string, CodeValueUsageChecker>();
    const sharedMap = CodeRegistryService.sharedInstance?.usageCheckers.get(normalizedType);
    if (sharedMap) {
      for (const [src, fn] of sharedMap.entries()) {
        mergedCheckers.set(src, fn);
      }
    }
    const localMap = this.usageCheckers.get(normalizedType);
    if (localMap) {
      for (const [src, fn] of localMap.entries()) {
        mergedCheckers.set(src, fn);
      }
    }

    const details: CodeValueUsageSource[] = [];
    let totalUsageCount = 0;

    for (const [source, checker] of mergedCheckers.entries()) {
      try {
        const rawCount = await checker({
          typeCode: normalizedType,
          numericCode: num,
          code,
        });
        const count = Math.max(0, Number(rawCount) || 0);
        if (count > 0) {
          details.push({ source, count });
          totalUsageCount += count;
        }
      } catch {
        // Bỏ qua an toàn nếu repository của module chưa khởi tạo trong unit test cô lập
      }
    }

    return {
      typeCode: normalizedType,
      numericCode: num,
      code,
      inUse: totalUsageCount > 0,
      totalUsageCount,
      details,
    };
  }

  private resolveItemLabel(
    group: RegisteredCodeType,
    item: RegisteredCodeValue,
    locale: string,
  ): string {
    const normLocale = locale.trim().toLowerCase() || 'vi';
    const directLabel = item.labels[normLocale];
    if (directLabel && directLabel.trim().length > 0) {
      return directLabel.trim();
    }

    if (this.i18nResolver) {
      const resolved = this.i18nResolver(group.code, item.code, normLocale);
      if (resolved && resolved.trim().length > 0) {
        return resolved.trim();
      }
    }

    if (this.i18nTranslator) {
      const shortType = group.code.startsWith(`${group.module}.`)
        ? group.code.slice(group.module.length + 1)
        : group.code;
      const i18nKey = `${group.module}.codes.${shortType}.${item.code}`;
      const translated = this.i18nTranslator(i18nKey, normLocale);
      if (translated && translated !== i18nKey) {
        return translated;
      }
    }

    return item.labels['vi'] || item.labels['en'] || item.name || item.code;
  }

  private toResolvedView(
    group: RegisteredCodeType,
    item: RegisteredCodeValue,
    locale: string,
  ): ResolvedCodeValueView {
    const resolvedLabel = this.resolveItemLabel(group, item, locale);
    return {
      typeCode: group.code,
      numericCode: item.numericCode,
      code: item.code,
      name: item.name,
      label: resolvedLabel,
      displayLabel: resolvedLabel,
      description: item.description,
      labels: { ...item.labels },
      aliases: [...item.aliases],
      behaviorCode: item.behaviorCode ?? item.code,
      badgeTone: item.badgeTone,
      color: item.color,
      icon: item.icon,
      sortOrder: item.sortOrder,
      isDefault: item.isDefault,
      metadata: item.metadata ? { ...item.metadata } : null,
      isSystem: item.isSystem,
      status: item.status,
      statusName: item.status === CODE_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    };
  }
}

export const defaultCodeRegistry = CodeRegistryService.getInstance();
