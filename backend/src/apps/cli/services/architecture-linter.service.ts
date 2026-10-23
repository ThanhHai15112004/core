import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { safeJsonParseObject, scanModuleManifests } from '@packages/kernel/index.js';
import { ManifestService } from './manifest.service.js';

export interface ArchitectureViolation {
  rule:
    | 'RULE_1_CROSS_MODULE'
    | 'RULE_2_PACKAGES_PURITY'
    | 'RULE_3_NO_TEST_IN_SRC'
    | 'RULE_4_CIRCULAR_DEPENDENCY'
    | 'RULE_5_ENTITY_EXPOSURE'
    | 'RULE_6_FOREIGN_KEY_AND_CASCADE'
    | 'RULE_7_I18N_AND_EXCEPTIONS'
    | 'RULE_8_SHARED_UTILS_AND_CLEAN_CODE'
    | 'RULE_9_CONFIG_AND_SETTINGS_HYGIENE';
  file: string;
  line?: number;
  message: string;
}

export interface ArchitectureReport {
  passed: boolean;
  totalFilesScanned: number;
  violations: ArchitectureViolation[];
}

@Injectable()
export class ArchitectureLinterService {
  private readonly logger = new Logger(ArchitectureLinterService.name);

  constructor(private readonly manifestService: ManifestService) {}

  /** Rà soát toàn bộ mã nguồn theo 6 quy tắc kiến trúc và trả về báo cáo vi phạm */
  public async check(): Promise<ArchitectureReport> {
    const backendRoot = this.manifestService.getBackendRoot();
    const srcDir = path.join(backendRoot, 'src');

    const violations: ArchitectureViolation[] = [];
    const files = await this.getAllTsFiles(srcDir);

    // Rule 3: Kiểm tra không có test trong src
    for (const file of files) {
      const fileName = path.basename(file);
      if (
        fileName.endsWith('.spec.ts') ||
        fileName.endsWith('.test.ts') ||
        fileName.endsWith('.feature-spec.ts')
      ) {
        violations.push({
          rule: 'RULE_3_NO_TEST_IN_SRC',
          file: path.relative(backendRoot, file),
          message: `Test file found inside src/. All tests must be placed in test/ directory according to Core Framework guidelines.`,
        });
      }
    }

    // Đồ thị module để kiểm tra circular dependencies (Rule 4)
    const moduleDependencies = new Map<string, Set<string>>();

    // Rule 7a: Kiểm tra đồng bộ khóa dịch đa ngôn ngữ (vi/en) và nạp từ điển toàn cục
    const globalDict = await this.collectAndValidateLocales(srcDir, backendRoot, violations);

    // Rule 9a: Thu thập danh mục khóa cấu hình động & sequences đã khai báo trong module.manifest.json
    const manifestKeys = this.collectManifestConfigKeys();

    // Kiểm tra Rule 1, Rule 2, Rule 5, Rule 6, Rule 7b, Rule 8 & Rule 9
    for (const file of files) {
      await this.lintSingleSourceFile({
        file,
        srcDir,
        backendRoot,
        globalDict,
        manifestKeys,
        moduleDependencies,
        violations,
      });
    }

    // Rule 4: Circular dependencies giữa các module
    const cycles = this.detectCycles(moduleDependencies);
    for (const cycle of cycles) {
      violations.push({
        rule: 'RULE_4_CIRCULAR_DEPENDENCY',
        file: `src/modules/${cycle[0]}`,
        message: `Circular module dependency detected: ${cycle.join(' -> ')}`,
      });
    }

    return {
      passed: violations.length === 0,
      totalFilesScanned: files.length,
      violations,
    };
  }

  private async lintSingleSourceFile(params: {
    file: string;
    srcDir: string;
    backendRoot: string;
    globalDict: { vi: Set<string>; en: Set<string> };
    manifestKeys: { settingKeys: Set<string>; sequenceKeys: Set<string> };
    moduleDependencies: Map<string, Set<string>>;
    violations: ArchitectureViolation[];
  }): Promise<void> {
    const { file, srcDir, backendRoot, globalDict, manifestKeys, moduleDependencies, violations } =
      params;
    const relativePath = path.relative(srcDir, file).replace(/\\/g, '/');

    let content = '';
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      return;
    }

    const lines = content.split('\n');
    const isPackageFile = relativePath.startsWith('packages/');
    const currentModule = this.extractModuleName(relativePath);
    const isModuleIndexFile =
      Boolean(currentModule) &&
      (relativePath === `modules/${currentModule}/index.ts` ||
        relativePath === `project-modules/${currentModule}/index.ts`);
    const isControllerFile = Boolean(currentModule) && relativePath.includes('/controllers/');
    const isServiceFile = Boolean(currentModule) && relativePath.includes('/services/');
    const isRequestFile = Boolean(currentModule) && relativePath.includes('/requests/');
    const isEntityFile = Boolean(currentModule) && relativePath.includes('/entities/');
    const isMigrationFile = relativePath.includes('/migrations/');

    if (currentModule && !moduleDependencies.has(currentModule)) {
      moduleDependencies.set(currentModule, new Set<string>());
    }

    // Rule 9: Kiểm tra cấu hình động, tránh hardcode tham số vận hành trong module nghiệp vụ
    if (currentModule) {
      this.lintDynamicConfigAndHardcodes({
        file,
        backendRoot,
        currentModule,
        isServiceFile,
        isRequestFile,
        content,
        lines,
        manifestKeys,
        violations,
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const prevLine = i > 0 ? lines[i - 1]! : '';

      if (isEntityFile || isMigrationFile) {
        if (
          /onDelete\s*:\s*['"]CASCADE['"]/i.test(line) &&
          !line.includes('@allow-cascade-delete') &&
          !prevLine.includes('@allow-cascade-delete')
        ) {
          violations.push({
            rule: 'RULE_6_FOREIGN_KEY_AND_CASCADE',
            file: path.relative(backendRoot, file),
            line: i + 1,
            message: `Dangerous "onDelete: 'CASCADE'" detected. Prefer RESTRICT/SET NULL with Soft Delete (@DeleteDateColumn), or add "// @allow-cascade-delete" if strictly required.`,
          });
        }
      }

      if (!relativePath.startsWith('packages/kernel/')) {
        const dupHelperMatch = line.match(
          /^\s*private\s+(parseJsonArray|parseJsonObject|parseNumericUserId)\s*\(/,
        );
        if (dupHelperMatch) {
          violations.push({
            rule: 'RULE_8_SHARED_UTILS_AND_CLEAN_CODE',
            file: path.relative(backendRoot, file),
            line: i + 1,
            message: `Duplicated local helper "${dupHelperMatch[1]}()" detected. Reuse shared utilities (safeJsonParse*, parseNumericUserId) from @packages/kernel instead.`,
          });
        }
      }

      if (/throw\s+new\s+\w*Exception\s*\(/.test(line)) {
        const block = lines
          .slice(i, Math.min(lines.length, i + 6))
          .map((l) => l.trim())
          .join(' ');
        const excMatch = block.match(/throw\s+new\s+(\w*Exception)\s*\(\s*['"]([^'"]+)['"]/);
        if (excMatch) {
          const excClass = excMatch[1]!;
          const msgOrKey = excMatch[2]!;
          const looksLikeI18nKey = /^[a-zA-Z0-9_.-]+$/.test(msgOrKey) && msgOrKey.includes('.');
          if (looksLikeI18nKey) {
            const inVi = globalDict.vi.has(msgOrKey);
            const inEn = globalDict.en.has(msgOrKey);
            if (!inVi || !inEn) {
              violations.push({
                rule: 'RULE_7_I18N_AND_EXCEPTIONS',
                file: path.relative(backendRoot, file),
                line: i + 1,
                message: `Missing i18n translation key "${msgOrKey}" in ${excClass} (missing in: ${!inVi && !inEn ? 'vi, en' : !inVi ? 'vi' : 'en'}). Register it in locales/{vi,en}/*.json.`,
              });
            }
          }
        }
      }

      const importMatch = line.match(/(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/);
      if (!importMatch) continue;

      const importPath = importMatch[1]!;

      if (
        (importPath.startsWith('./') || importPath.startsWith('../')) &&
        !importPath.endsWith('.js') &&
        !importPath.endsWith('.json')
      ) {
        violations.push({
          rule: 'RULE_8_SHARED_UTILS_AND_CLEAN_CODE',
          file: path.relative(backendRoot, file),
          line: i + 1,
          message: `Relative import "${importPath}" is missing ".js" extension required by NodeNext ESM.`,
        });
      }

      if (isPackageFile) {
        if (
          importPath.startsWith('@modules/') ||
          importPath.startsWith('@project-modules/') ||
          importPath.includes('/modules/') ||
          importPath.includes('/project-modules/')
        ) {
          violations.push({
            rule: 'RULE_2_PACKAGES_PURITY',
            file: path.relative(backendRoot, file),
            line: i + 1,
            message: `Packages must be domain-agnostic and cannot import from modules or project-modules. Violated import: "${importPath}"`,
          });
        }
      }

      if (isModuleIndexFile && /^\s*export\s+/.test(line)) {
        if (importPath.includes('/entities/') || importPath.includes('/repositories/')) {
          violations.push({
            rule: 'RULE_5_ENTITY_EXPOSURE',
            file: path.relative(backendRoot, file),
            line: i + 1,
            message: `Module "${currentModule}" must not export internal ORM entities or repositories in index.ts. Export Response DTOs and Public Service/Facade contracts instead. Violated export: "${importPath}"`,
          });
        }
      }

      if (isControllerFile) {
        if (importPath.includes('/entities/') || importPath.includes('/repositories/')) {
          violations.push({
            rule: 'RULE_5_ENTITY_EXPOSURE',
            file: path.relative(backendRoot, file),
            line: i + 1,
            message: `Controller in module "${currentModule}" must not directly import ORM entities or repositories. Use Service and Response DTO/Mapper instead. Violated import: "${importPath}"`,
          });
        }
      }

      if (currentModule) {
        const targetModule = this.extractTargetModuleFromImport(importPath, relativePath);
        if (targetModule && targetModule !== currentModule) {
          moduleDependencies.get(currentModule)?.add(targetModule);

          if (isEntityFile) {
            violations.push({
              rule: 'RULE_6_FOREIGN_KEY_AND_CASCADE',
              file: path.relative(backendRoot, file),
              line: i + 1,
              message: `Entity in module "${currentModule}" cannot import from module "${targetModule}". Cross-module physical Foreign Keys are strictly forbidden; store only scalar IDs (e.g. "${targetModule}Id: string").`,
            });
          }

          const isDeepInternalImport = this.isDeepInternalImport(importPath);
          if (isDeepInternalImport) {
            violations.push({
              rule: 'RULE_1_CROSS_MODULE',
              file: path.relative(backendRoot, file),
              line: i + 1,
              message: `Module "${currentModule}" is illegally importing internal file of module "${targetModule}". You must only import via contract or public root index. Violated import: "${importPath}"`,
            });
          }
        }
      }
    }
  }

  /** Quét đệ quy lấy danh sách tất cả các tệp TypeScript trong một thư mục */
  private async getAllTsFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await this.getAllTsFiles(fullPath)));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignored if directory does not exist
    }
    return results;
  }

  /** Trích xuất tên module từ đường dẫn tệp tương đối */
  private extractModuleName(relativePath: string): string | null {
    const parts = relativePath.split('/');
    if (parts[0] === 'modules' && parts[1]) {
      return parts[1];
    }
    if (parts[0] === 'project-modules' && parts[1]) {
      return parts[1];
    }
    return null;
  }

  /** Xác định tên module đích từ câu lệnh import */
  private extractTargetModuleFromImport(
    importPath: string,
    currentRelativePath: string,
  ): string | null {
    if (importPath.startsWith('@modules/')) {
      return importPath.split('/')[1] ?? null;
    }
    if (importPath.startsWith('@project-modules/')) {
      return importPath.split('/')[1] ?? null;
    }
    if (importPath.startsWith('../')) {
      // Xử lý relative import nhảy sang module khác
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(currentRelativePath), importPath),
      );
      return this.extractModuleName(resolved);
    }
    return null;
  }

  /** Kiểm tra xem câu lệnh import có vi phạm truy cập trực tiếp tệp nội bộ của module khác hay không */
  private isDeepInternalImport(importPath: string): boolean {
    const parts = importPath.split('/');
    if (importPath.startsWith('@modules/') || importPath.startsWith('@project-modules/')) {
      // @modules/users -> 2 parts (ok)
      // @modules/users/index.js -> 3 parts (ok)
      // @modules/users/contracts/... -> ok
      if (parts.length <= 2) return false;
      if (
        parts.length === 3 &&
        (parts[2] === 'index.js' || parts[2] === 'index.ts' || parts[2] === 'contracts')
      )
        return false;
      if (parts.length >= 3 && parts[2] === 'contracts') return false;
      return true;
    }
    return false;
  }

  /** Tìm kiếm chu trình phụ thuộc vòng (circular dependency) giữa các module bằng DFS */
  private detectCycles(graph: Map<string, Set<string>>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack: string[] = [];

    /** Duyệt đồ thị theo chiều sâu để phát hiện chu trình phụ thuộc */
    const dfs = (node: string) => {
      visited.add(node);
      recStack.push(node);

      const neighbors = graph.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.includes(neighbor)) {
          const cycleStartIndex = recStack.indexOf(neighbor);
          cycles.push([...recStack.slice(cycleStartIndex), neighbor]);
        }
      }

      recStack.pop();
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /** Làm phẳng đối tượng JSON đa cấp thành Map khóa dạng dot-notation */
  private flattenJsonKeys(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [ck, cv] of this.flattenJsonKeys(v as Record<string, unknown>, next)) {
          map.set(ck, cv);
        }
      } else {
        map.set(next, String(v));
      }
    }
    return map;
  }

  /** Thu thập từ điển đa ngôn ngữ toàn cục và kiểm tra độ khớp khóa vi/en */
  private async collectAndValidateLocales(
    srcDir: string,
    backendRoot: string,
    violations: ArchitectureViolation[],
  ): Promise<{ vi: Set<string>; en: Set<string> }> {
    const globalDict = { vi: new Set<string>(), en: new Set<string>() };
    const localeDirs: Array<{ baseDir: string; namespace: string }> = [
      { baseDir: path.join(srcDir, 'packages', 'i18n', 'locales'), namespace: '' },
    ];

    for (const modRoot of ['modules', 'project-modules']) {
      const fullModRoot = path.join(srcDir, modRoot);
      try {
        const entries = await fs.readdir(fullModRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            localeDirs.push({
              baseDir: path.join(fullModRoot, entry.name, 'locales'),
              namespace: entry.name,
            });
          }
        }
      } catch {
        // Bỏ qua nếu thư mục không tồn tại
      }
    }

    for (const { baseDir, namespace } of localeDirs) {
      const viDir = path.join(baseDir, 'vi');
      const enDir = path.join(baseDir, 'en');
      const viFiles = await fs
        .readdir(viDir)
        .then((list) => list.filter((f) => f.endsWith('.json')))
        .catch(() => [] as string[]);
      const enFiles = await fs
        .readdir(enDir)
        .then((list) => list.filter((f) => f.endsWith('.json')))
        .catch(() => [] as string[]);
      const allFiles = new Set([...viFiles, ...enFiles]);

      for (const fileName of allFiles) {
        const viPath = path.join(viDir, fileName);
        const enPath = path.join(enDir, fileName);
        const viRaw = await fs.readFile(viPath, 'utf8').catch(() => '{}');
        const enRaw = await fs.readFile(enPath, 'utf8').catch(() => '{}');
        const viMap = this.flattenJsonKeys(safeJsonParseObject<Record<string, unknown>>(viRaw));
        const enMap = this.flattenJsonKeys(safeJsonParseObject<Record<string, unknown>>(enRaw));

        for (const k of viMap.keys()) {
          globalDict.vi.add(k);
          if (namespace && !k.startsWith(`${namespace}.`)) {
            globalDict.vi.add(`${namespace}.${k}`);
          }
          if (!enMap.has(k)) {
            violations.push({
              rule: 'RULE_7_I18N_AND_EXCEPTIONS',
              file: path.relative(backendRoot, enPath),
              message: `Missing English ("en") translation for key "${k}" present in Vietnamese ("vi") locale file.`,
            });
          }
        }

        for (const k of enMap.keys()) {
          globalDict.en.add(k);
          if (namespace && !k.startsWith(`${namespace}.`)) {
            globalDict.en.add(`${namespace}.${k}`);
          }
          if (!viMap.has(k)) {
            violations.push({
              rule: 'RULE_7_I18N_AND_EXCEPTIONS',
              file: path.relative(backendRoot, viPath),
              message: `Missing Vietnamese ("vi") translation for key "${k}" present in English ("en") locale file.`,
            });
          }
        }
      }
    }

    return globalDict;
  }

  /** Thu thập tập hợp các khóa setting và sequence đã khai báo trong `module.manifest.json` */
  private collectManifestConfigKeys(): {
    settingKeys: Set<string>;
    sequenceKeys: Set<string>;
  } {
    const settingKeys = new Set<string>();
    const sequenceKeys = new Set<string>();
    const scanned = scanModuleManifests();

    for (const item of scanned) {
      const raw = item.raw;
      if (Array.isArray(raw.settings)) {
        for (const s of raw.settings) {
          if (s && typeof s === 'object' && typeof (s as { key?: unknown }).key === 'string') {
            settingKeys.add((s as { key: string }).key.trim().toLowerCase());
          }
        }
      }
      if (Array.isArray(raw.sequences)) {
        for (const seq of raw.sequences) {
          if (
            seq &&
            typeof seq === 'object' &&
            typeof (seq as { key?: unknown }).key === 'string'
          ) {
            sequenceKeys.add((seq as { key: string }).key.trim().toLowerCase());
          }
        }
      }
    }

    return { settingKeys, sequenceKeys };
  }

  /**
   * Rule 9: Kiểm tra tự động các lỗi hardcode tham số cấu hình phổ biến trong module nghiệp vụ
   * (Thiết kế chính xác, có hỗ trợ `// @allow-hardcode` để tránh false-positive làm sai luồng):
   * 1. Cấm đọc trực tiếp `process.env` trong `modules/` và `project-modules/`.
   * 2. Mọi khóa gọi qua `settingRegistry.get*(key)` hoặc `sequenceRegistry.next*(key)` phải được khai báo trong `module.manifest.json`.
   * 3. Cấm tự ghép mã thực thể nghiệp vụ (`const code = \`PREFIX_\${Date.now().toString(36)}...\``) thay vì dùng `SequenceRegistryService`.
   * 4. Cấm hardcode giới hạn số lượng mảng nhỏ (`.max(<= 50)`) trực tiếp trên schema `uploadBatch*Schema` thay vì đọc từ `SettingRegistryService`.
   */
  private lintDynamicConfigAndHardcodes(params: {
    file: string;
    backendRoot: string;
    currentModule: string;
    isServiceFile: boolean;
    isRequestFile: boolean;
    content: string;
    lines: string[];
    manifestKeys: { settingKeys: Set<string>; sequenceKeys: Set<string> };
    violations: ArchitectureViolation[];
  }): void {
    const {
      file,
      backendRoot,
      currentModule,
      isServiceFile,
      isRequestFile,
      content,
      lines,
      manifestKeys,
      violations,
    } = params;
    const relFile = path.relative(backendRoot, file);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const prevLine = i > 0 ? lines[i - 1]! : '';
      const trimmed = line.trim();

      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        line.includes('@allow-hardcode') ||
        prevLine.includes('@allow-hardcode')
      ) {
        continue;
      }

      // 9.1. Cấm đọc trực tiếp process.env trong module nghiệp vụ
      if (/\bprocess\.env\.[A-Za-z0-9_]+/.test(line)) {
        violations.push({
          rule: 'RULE_9_CONFIG_AND_SETTINGS_HYGIENE',
          file: relFile,
          line: i + 1,
          message: `Direct "process.env" access detected in module "${currentModule}". Use CoreConfigService (@packages/config) for boot-time env or SettingRegistryService for runtime settings.`,
        });
      }

      // 9.2. Cấm tự ghép mã thực thể nghiệp vụ bằng Date.now().toString(36) + randomBytes trong Service
      if (
        isServiceFile &&
        /const\s+code\s*=\s*`[A-Z]{2,6}_\$\{Date\.now\(\)\.toString\(36\)/.test(line)
      ) {
        violations.push({
          rule: 'RULE_9_CONFIG_AND_SETTINGS_HYGIENE',
          file: relFile,
          line: i + 1,
          message: `Hardcoded entity code generation detected in module "${currentModule}". Declare a sequence in module.manifest.json and use SequenceRegistryService (@packages/kernel).`,
        });
      }

      // 9.3. Cấm hardcode giới hạn số lượng mảng nhỏ (.max(<= 50)) trong uploadBatch*Schema
      if (isRequestFile && /uploadBatch\w*Schema\s*=\s*z\.object/.test(line)) {
        const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
        const batchMaxMatch = block.match(
          /files\s*:\s*z\.array\([^)]+\)\.min\(\d+\)\.max\((\d+)\)/,
        );
        if (batchMaxMatch && Number(batchMaxMatch[1]) <= 50) {
          violations.push({
            rule: 'RULE_9_CONFIG_AND_SETTINGS_HYGIENE',
            file: relFile,
            line: i + 1,
            message: `Hardcoded batch upload limit ".max(${batchMaxMatch[1]})" detected in request schema. Validate batch limit dynamically via SettingRegistryService (e.g. "file.upload.max_batch_files") or add "// @allow-hardcode".`,
          });
        }
      }
    }

    // 9.4. Kiểm tra các khóa settingRegistry.get*(key) và sequenceRegistry.next*(key) có khai báo trong module.manifest.json
    if (currentModule !== 'settings') {
      const settingCallRegex =
        /settingRegistry\.(?:getNumber|getString|getBoolean|getJson|resolve)\?:?\s*(?:<[^>]+>)?\s*\(\s*['"]([a-z0-9_.-]+)['"]/gi;
      let match: RegExpExecArray | null = null;
      while ((match = settingCallRegex.exec(content)) !== null) {
        const key = (match[1] ?? '').trim().toLowerCase();
        if (key.includes('.') && !manifestKeys.settingKeys.has(key)) {
          const lineNum = content.slice(0, match.index).split('\n').length;
          violations.push({
            rule: 'RULE_9_CONFIG_AND_SETTINGS_HYGIENE',
            file: relFile,
            line: lineNum,
            message: `Unregistered setting key "${key}" used in module "${currentModule}". Declare it under "settings" in module.manifest.json so Admins can configure it dynamically.`,
          });
        }
      }
    }
  }
}
