import path from 'node:path';

export interface CoverageMetricBucket {
  readonly total: number;
  readonly covered: number;
  readonly skipped: number;
  readonly pct: number;
}

export interface FileCoverageSummaryEntry {
  readonly lines: CoverageMetricBucket;
  readonly statements: CoverageMetricBucket;
  readonly functions: CoverageMetricBucket;
  readonly branches: CoverageMetricBucket;
}

export type IstanbulCoverageSummaryJson = Record<string, FileCoverageSummaryEntry>;

export type ModuleCategory = 'packages' | 'modules' | 'project-modules' | 'apps' | 'database' | 'other';

export interface ModuleCoverageItem {
  readonly key: string;
  readonly category: ModuleCategory;
  readonly name: string;
  readonly fileCount: number;
  readonly statements: CoverageMetricBucket;
  readonly branches: CoverageMetricBucket;
  readonly functions: CoverageMetricBucket;
  readonly lines: CoverageMetricBucket;
}

export interface ModuleCoverageReport {
  readonly generatedAt: string;
  readonly totalFiles: number;
  readonly overall: {
    readonly statements: CoverageMetricBucket;
    readonly branches: CoverageMetricBucket;
    readonly functions: CoverageMetricBucket;
    readonly lines: CoverageMetricBucket;
  };
  readonly items: readonly ModuleCoverageItem[];
}

interface MutableBucket {
  total: number;
  covered: number;
  skipped: number;
}

function createMutableBucket(): MutableBucket {
  return { total: 0, covered: 0, skipped: 0 };
}

function addMetric(target: MutableBucket, source: CoverageMetricBucket | undefined): void {
  if (!source) return;
  target.total += Number(source.total) || 0;
  target.covered += Number(source.covered) || 0;
  target.skipped += Number(source.skipped) || 0;
}

function finalizeBucket(bucket: MutableBucket): CoverageMetricBucket {
  const pct =
    bucket.total > 0 ? Math.round((bucket.covered / bucket.total) * 10000) / 100 : 100;
  return {
    total: bucket.total,
    covered: bucket.covered,
    skipped: bucket.skipped,
    pct,
  };
}

/**
 * Phân loại đường dẫn file nguồn trong `src/` về đúng nhóm Package / Module / App.
 */
export function classifySourceFileToModule(
  filePath: string,
  backendRoot?: string,
): { key: string; category: ModuleCategory; name: string } | null {
  const normalized = (
    backendRoot ? path.relative(backendRoot, filePath) : filePath
  ).replace(/\\/g, '/');

  const srcIdx = normalized.indexOf('src/');
  const relFromSrc = srcIdx >= 0 ? normalized.slice(srcIdx + 4) : normalized;
  const parts = relFromSrc.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const top = parts[0]!;
  const second = parts[1];

  if (
    (top === 'packages' || top === 'modules' || top === 'project-modules' || top === 'apps') &&
    second
  ) {
    return {
      key: `${top}/${second}`,
      category: top,
      name: second,
    };
  }

  if (top === 'database') {
    return {
      key: 'database/core',
      category: 'database',
      name: 'core',
    };
  }

  return {
    key: `other/${top}`,
    category: 'other',
    name: top,
  };
}

/**
 * Tổng hợp báo cáo độ phủ mã nguồn (Coverage) tách theo từng Package, Module và Runtime App.
 */
export function buildModuleCoverageReport(
  summaryJson: IstanbulCoverageSummaryJson,
  backendRoot?: string,
): ModuleCoverageReport {
  const groups = new Map<
    string,
    {
      key: string;
      category: ModuleCategory;
      name: string;
      fileCount: number;
      statements: MutableBucket;
      branches: MutableBucket;
      functions: MutableBucket;
      lines: MutableBucket;
    }
  >();

  const overallStatements = createMutableBucket();
  const overallBranches = createMutableBucket();
  const overallFunctions = createMutableBucket();
  const overallLines = createMutableBucket();
  let totalFiles = 0;

  for (const [filePath, entry] of Object.entries(summaryJson)) {
    if (filePath === 'total' || !entry) continue;

    const classification = classifySourceFileToModule(filePath, backendRoot);
    if (!classification) continue;

    totalFiles += 1;
    addMetric(overallStatements, entry.statements);
    addMetric(overallBranches, entry.branches);
    addMetric(overallFunctions, entry.functions);
    addMetric(overallLines, entry.lines);

    let group = groups.get(classification.key);
    if (!group) {
      group = {
        key: classification.key,
        category: classification.category,
        name: classification.name,
        fileCount: 0,
        statements: createMutableBucket(),
        branches: createMutableBucket(),
        functions: createMutableBucket(),
        lines: createMutableBucket(),
      };
      groups.set(classification.key, group);
    }

    group.fileCount += 1;
    addMetric(group.statements, entry.statements);
    addMetric(group.branches, entry.branches);
    addMetric(group.functions, entry.functions);
    addMetric(group.lines, entry.lines);
  }

  const categoryOrder: Record<ModuleCategory, number> = {
    packages: 1,
    modules: 2,
    'project-modules': 3,
    apps: 4,
    database: 5,
    other: 6,
  };

  const items: ModuleCoverageItem[] = [...groups.values()]
    .map((g) => ({
      key: g.key,
      category: g.category,
      name: g.name,
      fileCount: g.fileCount,
      statements: finalizeBucket(g.statements),
      branches: finalizeBucket(g.branches),
      functions: finalizeBucket(g.functions),
      lines: finalizeBucket(g.lines),
    }))
    .sort((a, b) => {
      const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
      if (catDiff !== 0) return catDiff;
      return a.key.localeCompare(b.key);
    });

  return {
    generatedAt: new Date().toISOString(),
    totalFiles,
    overall: {
      statements: finalizeBucket(overallStatements),
      branches: finalizeBucket(overallBranches),
      functions: finalizeBucket(overallFunctions),
      lines: finalizeBucket(overallLines),
    },
    items,
  };
}

/**
 * Định dạng báo cáo coverage theo module thành bảng Markdown chuẩn.
 */
export function formatModuleCoverageMarkdown(report: ModuleCoverageReport): string {
  const lines: string[] = [
    '# Báo Cáo Độ Phủ Kiểm Thử Theo Module & Package (Module Coverage Report)',
    '',
    `- **Tổng số tệp nguồn**: ${report.totalFiles}`,
    `- **Độ phủ tổng thể**: Statements **${report.overall.statements.pct.toFixed(2)}%** | Branches **${report.overall.branches.pct.toFixed(2)}%** | Functions **${report.overall.functions.pct.toFixed(2)}%** | Lines **${report.overall.lines.pct.toFixed(2)}%**`,
    '',
    '| Phân nhóm / Module | Số tệp | Statements (%) | Branches (%) | Functions (%) | Lines (%) |',
    '| :--- | :---: | :---: | :---: | :---: | :---: |',
  ];

  for (const item of report.items) {
    lines.push(
      `| \`${item.key}\` | ${item.fileCount} | ${item.statements.pct.toFixed(2)}% (${item.statements.covered}/${item.statements.total}) | ${item.branches.pct.toFixed(2)}% (${item.branches.covered}/${item.branches.total}) | ${item.functions.pct.toFixed(2)}% (${item.functions.covered}/${item.functions.total}) | ${item.lines.pct.toFixed(2)}% (${item.lines.covered}/${item.lines.total}) |`,
    );
  }

  return lines.join('\n') + '\n';
}
