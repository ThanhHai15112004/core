import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  discoverInstalledModules,
  loadProjectManifest,
  safeJsonParse,
  scanModuleManifests,
} from '@packages/kernel/index.js';
import type {
  DeploymentInfoDto,
  InstalledModuleDto,
  InstalledModulesResponseDto,
  SystemInfoResponseDto,
  SystemModulesSummaryDto,
} from '../responses/overview.response.js';

interface PackageJsonMeta {
  name?: string;
  version?: string;
}

/**
 * Đọc git commit SHA trực tiếp từ `.git/HEAD` (tránh spawn tiến trình con lúc runtime).
 * Trả về `null` nếu không có `.git` (vd. chạy trong container đã strip `.git`).
 */
function readGitCommitFromDisk(): string | null {
  let current = process.cwd();
  let gitDir: string | null = null;
  while (true) {
    const candidate = join(current, '.git');
    if (existsSync(candidate)) {
      gitDir = candidate;
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!gitDir) return null;

  try {
    const headPath = join(gitDir, 'HEAD');
    if (!existsSync(headPath)) return null;
    const head = readFileSync(headPath, 'utf8').trim();
    if (!head) return null;
    if (!head.startsWith('ref:')) {
      return /^[0-9a-f]{7,40}$/i.test(head) ? head : null;
    }
    const refPath = head.slice('ref:'.length).trim();
    const looseRef = join(gitDir, refPath);
    if (existsSync(looseRef)) {
      const sha = readFileSync(looseRef, 'utf8').trim();
      return sha || null;
    }
    const packedRefs = join(gitDir, 'packed-refs');
    if (existsSync(packedRefs)) {
      const lines = readFileSync(packedRefs, 'utf8').split('\n');
      for (const line of lines) {
        if (!line || line.startsWith('#') || line.startsWith('^')) continue;
        const [sha, ref] = line.trim().split(/\s+/);
        if (ref === refPath && sha) return sha;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Đọc version từ `package.json` của backend làm fallback cho `coreVersion`. */
function readBackendPackageMeta(): PackageJsonMeta {
  const candidates = [
    resolve(process.cwd(), 'package.json'),
    resolve(process.cwd(), 'backend/package.json'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = safeJsonParse<PackageJsonMeta | null>(readFileSync(file, 'utf8'), null);
      if (parsed?.version) return parsed;
    } catch {
      // Ignore invalid package.json
    }
  }
  return {};
}

@Injectable()
export class SystemInfoService {
  private cachedCommit: string | null | undefined = undefined;

  constructor(private readonly configService: CoreConfigService) {}

  /** Tổng hợp phiên bản Core, phiên bản dự án, deployment và thống kê module đang cài. */
  public getSystemInfo(): SystemInfoResponseDto {
    const manifest = loadProjectManifest();
    const pkgMeta = readBackendPackageMeta();
    const appCfg = this.configService.app;
    const modules = this.getInstalledModules();

    const env = appCfg.env;
    const environment: SystemInfoResponseDto['environment'] =
      env === 'production' || env === 'staging' ? env : 'development';

    return {
      projectName: manifest?.name ?? appCfg.name,
      coreVersion: manifest?.coreVersion ?? pkgMeta.version ?? '1.0.0',
      projectVersion: manifest?.version ?? appCfg.version ?? '1.0.0',
      environment,
      uptimeSeconds: Math.round(process.uptime()),
      deployment: this.getDeploymentInfo(),
      modules: modules.summary,
    };
  }

  /** Danh sách toàn bộ module đã phát hiện kèm tên, version và trạng thái enabled/disabled. */
  public getInstalledModules(): InstalledModulesResponseDto {
    const enabledSet = new Set(discoverInstalledModules().map((m) => m.toLowerCase()));
    const manifests = scanModuleManifests();

    const byName = new Map<string, InstalledModuleDto>();
    for (const entry of manifests) {
      const raw = entry.raw;
      const name = entry.moduleName;
      const type = raw.type === 'project' ? 'project' : 'core';
      const status: InstalledModuleDto['status'] = enabledSet.has(name) ? 'enabled' : 'disabled';

      byName.set(name, {
        name,
        displayName: raw.displayName?.trim() || name,
        version: raw.version?.trim() || '1.0.0',
        type,
        category: raw.category?.trim() || 'general',
        description: raw.description?.trim() || null,
        status,
        dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
        hasMigrations: Boolean(raw.database?.hasMigrations),
        tablesCount: Array.isArray(raw.database?.tables) ? raw.database.tables.length : 0,
      });
    }

    const items = [...byName.values()].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'enabled' ? -1 : 1;
      if (a.type !== b.type) return a.type === 'core' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const summary: SystemModulesSummaryDto = {
      total: items.length,
      enabled: items.filter((m) => m.status === 'enabled').length,
      disabled: items.filter((m) => m.status === 'disabled').length,
      core: items.filter((m) => m.type === 'core').length,
      project: items.filter((m) => m.type === 'project').length,
    };

    return { summary, items };
  }

  /** Thông tin deployment (commit, image, build time) ưu tiên env, fallback `.git/HEAD`. */
  private getDeploymentInfo(): DeploymentInfoDto {
    const deploy = this.configService.app.deployment;
    const commit = deploy?.commit ?? this.resolveGitCommit();
    const shortCommit = commit ? commit.slice(0, 7) : null;

    return {
      commit,
      shortCommit,
      image: deploy?.image ?? null,
      buildTime: deploy?.buildTime ?? null,
      nodeVersion: process.version,
    };
  }

  private resolveGitCommit(): string | null {
    if (this.cachedCommit !== undefined) {
      return this.cachedCommit;
    }
    this.cachedCommit = readGitCommitFromDisk();
    return this.cachedCommit;
  }
}
