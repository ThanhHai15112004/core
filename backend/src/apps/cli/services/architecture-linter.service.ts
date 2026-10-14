import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ManifestService } from './manifest.service.js';

export interface ArchitectureViolation {
  rule:
    | 'RULE_1_CROSS_MODULE'
    | 'RULE_2_PACKAGES_PURITY'
    | 'RULE_3_NO_TEST_IN_SRC'
    | 'RULE_4_CIRCULAR_DEPENDENCY'
    | 'RULE_5_ENTITY_EXPOSURE'
    | 'RULE_6_FOREIGN_KEY_AND_CASCADE';
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

    // Kiểm tra Rule 1, Rule 2, Rule 5 & Rule 6
    for (const file of files) {
      const relativePath = path.relative(srcDir, file).replace(/\\/g, '/');

      // Đọc nội dung file
      let content = '';
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      const isPackageFile = relativePath.startsWith('packages/');
      const currentModule = this.extractModuleName(relativePath);
      const isModuleIndexFile =
        Boolean(currentModule) &&
        (relativePath === `modules/${currentModule}/index.ts` ||
          relativePath === `project-modules/${currentModule}/index.ts`);
      const isControllerFile = Boolean(currentModule) && relativePath.includes('/controllers/');
      const isEntityFile = Boolean(currentModule) && relativePath.includes('/entities/');
      const isMigrationFile = relativePath.includes('/migrations/');

      if (currentModule && !moduleDependencies.has(currentModule)) {
        moduleDependencies.set(currentModule, new Set<string>());
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const prevLine = i > 0 ? lines[i - 1]! : '';

        // Rule 6b: Cấm onDelete: 'CASCADE' trong Entity hoặc Migration nếu không có @allow-cascade-delete
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

        const importMatch = line.match(/(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/);
        if (!importMatch) continue;

        const importPath = importMatch[1]!;

        // Rule 2: Package không được import module
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

        // Rule 5: Không để lộ ORM Entity hoặc Repository ra ngoài index.ts của module hoặc trực tiếp vào Controller
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

        // Rule 1 & Rule 6a: Module không được import file nội bộ của module khác; Entity tuyệt đối không import từ module khác
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

            // Kiểm tra xem có import sâu vào internal không
            // Hợp lệ: @modules/<target>, @modules/<target>/index.js, @modules/<target>/contracts, @modules/<target>/contracts/index.js
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
}
