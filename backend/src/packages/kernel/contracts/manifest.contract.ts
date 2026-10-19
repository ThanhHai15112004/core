import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CodeTypeManifestItem } from './code-lookup.contract.js';
import type { SettingGroupManifestItem, SettingManifestItem } from './setting-lookup.contract.js';

export type ModuleType = 'core' | 'project';

export interface ModuleEventsManifest {
  published?: string[];
  subscribed?: string[];
}

export interface ModuleDatabaseManifest {
  hasMigrations?: boolean;
  tables?: string[];
}

export interface ModuleManifest {
  $schema?: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  type: ModuleType;
  category?: string;
  author?: string;
  entryModule: string;
  dependencies?: string[];
  permissions?: string[];
  codeTypes?: CodeTypeManifestItem[];
  settingGroups?: SettingGroupManifestItem[];
  settings?: SettingManifestItem[];
  events?: ModuleEventsManifest;
  database?: ModuleDatabaseManifest;
}

export interface ProjectManifestSettings {
  defaultLocale?: string;
  supportedLocales?: string[];
}

export interface ProjectManifest {
  $schema?: string;
  name: string;
  version: string;
  coreVersion: string;
  description?: string;
  environment?: string;
  enabledModules: string[];
  settings?: ProjectManifestSettings;
}

export interface DiscoveredModuleManifestEntry<T = Record<string, unknown>> {
  readonly moduleName: string;
  readonly directoryName: string;
  readonly manifestPath: string;
  readonly raw: T;
}

/**
 * Quét tập trung toàn bộ các tệp `module.manifest.json` trong `modules/*` và `project-modules/*`.
 * Dùng chung cho `discoverManifestCodeTypes()`, `discoverManifestSettings()` và `RolesService`
 * để tránh lặp code đọc filesystem.
 */
export function scanModuleManifests<
  T extends { name?: string } = ModuleManifest,
>(): DiscoveredModuleManifestEntry<T>[] {
  const results: DiscoveredModuleManifestEntry<T>[] = [];
  const candidateDirs = [
    resolve(process.cwd(), 'src/modules'),
    resolve(process.cwd(), 'src/project-modules'),
    resolve(process.cwd(), 'backend/src/modules'),
    resolve(process.cwd(), 'backend/src/project-modules'),
  ];

  for (const baseDir of candidateDirs) {
    if (!existsSync(baseDir)) continue;
    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(baseDir, entry.name, 'module.manifest.json');
        if (!existsSync(manifestPath)) continue;
        try {
          const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as T;
          const moduleName = (raw.name ?? entry.name).trim().toLowerCase();
          results.push({
            moduleName,
            directoryName: entry.name,
            manifestPath,
            raw,
          });
        } catch {
          // Ignore malformed manifest file
        }
      }
    } catch {
      // Ignore inaccessible directory
    }
  }

  return results;
}
