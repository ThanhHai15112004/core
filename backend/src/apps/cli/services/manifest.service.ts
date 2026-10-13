import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import {
  type ModuleManifest,
  type ProjectManifest,
  ModuleManifestSchema,
  ProjectManifestSchema,
} from '@packages/kernel/index.js';

export interface ModuleDiscoveryItem {
  name: string;
  type: 'core' | 'project';
  directory: string;
  manifest: ModuleManifest;
  isEnabled: boolean;
  hasManifestFile: boolean;
}

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  /** Tìm đường dẫn gốc của project backend (nơi chứa project.manifest.json hoặc package.json) */
  public getBackendRoot(): string {
    // __dirname ở dist/apps/cli/services hoặc src/apps/cli/services
    let current = process.cwd();
    // Nếu chạy từ root repo, backend nằm trong backend/
    if (fsExistsSync(path.join(current, 'backend', 'project.manifest.json'))) {
      return path.join(current, 'backend');
    }
    // Nếu đang ở trong thư mục backend
    if (fsExistsSync(path.join(current, 'project.manifest.json'))) {
      return current;
    }
    // Fallback tìm ngược lên
    while (current !== path.dirname(current)) {
      if (fsExistsSync(path.join(current, 'project.manifest.json'))) {
        return current;
      }
      current = path.dirname(current);
    }
    return process.cwd();
  }

  /** Lấy đường dẫn tuyệt đối đến tệp project.manifest.json */
  public getProjectManifestPath(): string {
    return path.join(this.getBackendRoot(), 'project.manifest.json');
  }

  /** Lấy đường dẫn thư mục gốc chứa các core modules hoặc project modules */
  public getModulesRoot(type: 'core' | 'project'): string {
    const backendRoot = this.getBackendRoot();
    return type === 'core'
      ? path.join(backendRoot, 'src', 'modules')
      : path.join(backendRoot, 'src', 'project-modules');
  }

  /** Đọc và validate project.manifest.json */
  public async loadProjectManifest(): Promise<ProjectManifest> {
    const manifestPath = this.getProjectManifestPath();
    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      const raw = JSON.parse(content) as unknown;
      return ProjectManifestSchema.parse(raw) as ProjectManifest;
    } catch (error) {
      this.logger.warn(`Could not read project manifest at ${manifestPath}: ${String(error)}`);
      // Fallback
      return {
        name: 'core-backend',
        version: '1.0.0',
        coreVersion: '1.0.0',
        enabledModules: [],
      };
    }
  }

  /** Lưu project.manifest.json */
  public async saveProjectManifest(manifest: ProjectManifest): Promise<void> {
    const manifestPath = this.getProjectManifestPath();
    const validated = ProjectManifestSchema.parse(manifest);
    await fs.writeFile(manifestPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  }

  /** Đọc module.manifest.json từ một thư mục module */
  public async loadModuleManifest(
    moduleDir: string,
    defaultName: string,
    type: 'core' | 'project',
  ): Promise<{ manifest: ModuleManifest; hasFile: boolean }> {
    const manifestPath = path.join(moduleDir, 'module.manifest.json');
    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      const raw = JSON.parse(content) as unknown;
      return {
        manifest: ModuleManifestSchema.parse(raw) as ModuleManifest,
        hasFile: true,
      };
    } catch {
      // Fallback cho module chưa có file manifest
      return {
        manifest: {
          name: defaultName,
          displayName: defaultName
            .split('-')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' '),
          version: '1.0.0',
          type,
          entryModule:
            defaultName
              .split('-')
              .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
              .join('') + 'Module',
          dependencies: [],
          permissions: [],
          database: { hasMigrations: false, tables: [] },
        },
        hasFile: false,
      };
    }
  }

  /** Quét toàn bộ module trong cả 2 thư mục modules và project-modules */
  public async discoverAllModules(): Promise<ModuleDiscoveryItem[]> {
    const projectManifest = await this.loadProjectManifest();
    const enabledSet = new Set(projectManifest.enabledModules);
    const result: ModuleDiscoveryItem[] = [];

    for (const type of ['core', 'project'] as const) {
      const dir = this.getModulesRoot(type);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const moduleDir = path.join(dir, entry.name);
          const { manifest, hasFile } = await this.loadModuleManifest(moduleDir, entry.name, type);
          result.push({
            name: entry.name,
            type,
            directory: moduleDir,
            manifest,
            isEnabled: enabledSet.has(entry.name),
            hasManifestFile: hasFile,
          });
        }
      } catch {
        // Thư mục chưa tồn tại (ví dụ project-modules trống)
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Thêm module vào danh sách enabledModules của project.manifest.json */
  public async enableModule(
    moduleName: string,
  ): Promise<{ success: boolean; message: string; missingDependencies?: string[] }> {
    const modules = await this.discoverAllModules();
    const target = modules.find((m) => m.name === moduleName);

    if (!target) {
      return {
        success: false,
        message: `Module "${moduleName}" not found in modules/ or project-modules/.`,
      };
    }

    const projectManifest = await this.loadProjectManifest();
    if (projectManifest.enabledModules.includes(moduleName)) {
      return {
        success: true,
        message: `Module "${moduleName}" is already enabled in project.manifest.json.`,
      };
    }

    // Kiểm tra dependencies
    const missing: string[] = [];
    if (target.manifest.dependencies && target.manifest.dependencies.length > 0) {
      for (const dep of target.manifest.dependencies) {
        if (
          !projectManifest.enabledModules.includes(dep) &&
          dep !== 'security' &&
          dep !== 'redis' &&
          dep !== 'database' &&
          dep !== 'runtime' &&
          dep !== 'config' &&
          dep !== 'i18n'
        ) {
          // Chỉ kiểm tra dependency là module nghiệp vụ khác
          missing.push(dep);
        }
      }
    }

    projectManifest.enabledModules.push(moduleName);
    await this.saveProjectManifest(projectManifest);

    return {
      success: true,
      message: `Module "${moduleName}" has been successfully enabled in project.manifest.json.`,
      ...(missing.length > 0 ? { missingDependencies: missing } : {}),
    };
  }
}

/** Kiểm tra đồng bộ sự tồn tại của tệp hoặc thư mục trên đĩa */
function fsExistsSync(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
