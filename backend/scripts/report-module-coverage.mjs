import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDir, '..');
const summaryPath = path.join(backendRoot, 'coverage', 'coverage-summary.json');
const outputJsonPath = path.join(backendRoot, 'coverage', 'module-coverage-summary.json');
const outputMdPath = path.join(backendRoot, 'coverage', 'module-coverage-report.md');

function createBucket() {
  return { total: 0, covered: 0, skipped: 0 };
}

function addMetric(target, source) {
  if (!source) return;
  target.total += Number(source.total) || 0;
  target.covered += Number(source.covered) || 0;
  target.skipped += Number(source.skipped) || 0;
}

function finalizeBucket(bucket) {
  const pct = bucket.total > 0 ? Math.round((bucket.covered / bucket.total) * 10000) / 100 : 100;
  return { ...bucket, pct };
}

function classifySourceFile(filePath) {
  const normalized = path.relative(backendRoot, filePath).replace(/\\/g, '/');
  const srcIdx = normalized.indexOf('src/');
  const relFromSrc = srcIdx >= 0 ? normalized.slice(srcIdx + 4) : normalized;
  const parts = relFromSrc.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const top = parts[0];
  const second = parts[1];
  if (
    (top === 'packages' || top === 'modules' || top === 'project-modules' || top === 'apps') &&
    second
  ) {
    return { key: `${top}/${second}`, category: top, name: second };
  }
  if (top === 'database') {
    return { key: 'database/core', category: 'database', name: 'core' };
  }
  return { key: `other/${top}`, category: 'other', name: top };
}

async function main() {
  const raw = await fs.readFile(summaryPath, 'utf8');
  const summaryJson = JSON.parse(raw);

  const groups = new Map();
  const overall = {
    statements: createBucket(),
    branches: createBucket(),
    functions: createBucket(),
    lines: createBucket(),
  };
  let totalFiles = 0;

  for (const [filePath, entry] of Object.entries(summaryJson)) {
    if (filePath === 'total' || !entry) continue;
    const info = classifySourceFile(filePath);
    if (!info) continue;

    totalFiles += 1;
    addMetric(overall.statements, entry.statements);
    addMetric(overall.branches, entry.branches);
    addMetric(overall.functions, entry.functions);
    addMetric(overall.lines, entry.lines);

    let g = groups.get(info.key);
    if (!g) {
      g = {
        ...info,
        fileCount: 0,
        statements: createBucket(),
        branches: createBucket(),
        functions: createBucket(),
        lines: createBucket(),
      };
      groups.set(info.key, g);
    }
    g.fileCount += 1;
    addMetric(g.statements, entry.statements);
    addMetric(g.branches, entry.branches);
    addMetric(g.functions, entry.functions);
    addMetric(g.lines, entry.lines);
  }

  const order = { packages: 1, modules: 2, 'project-modules': 3, apps: 4, database: 5, other: 6 };
  const items = [...groups.values()]
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
    .sort((a, b) => (order[a.category] - order[b.category]) || a.key.localeCompare(b.key));

  const report = {
    generatedAt: new Date().toISOString(),
    totalFiles,
    overall: {
      statements: finalizeBucket(overall.statements),
      branches: finalizeBucket(overall.branches),
      functions: finalizeBucket(overall.functions),
      lines: finalizeBucket(overall.lines),
    },
    items,
  };

  await fs.writeFile(outputJsonPath, JSON.stringify(report, null, 2), 'utf8');

  const mdLines = [
    '# Báo Cáo Độ Phủ Kiểm Thử Theo Module & Package (Module Coverage Report)',
    '',
    `- **Tổng số tệp nguồn**: ${report.totalFiles}`,
    `- **Độ phủ tổng thể**: Statements **${report.overall.statements.pct.toFixed(2)}%** | Branches **${report.overall.branches.pct.toFixed(2)}%** | Functions **${report.overall.functions.pct.toFixed(2)}%** | Lines **${report.overall.lines.pct.toFixed(2)}%**`,
    '',
    '| Phân nhóm / Module | Số tệp | Statements (%) | Branches (%) | Functions (%) | Lines (%) |',
    '| :--- | :---: | :---: | :---: | :---: | :---: |',
    ...items.map(
      (i) =>
        `| \`${i.key}\` | ${i.fileCount} | ${i.statements.pct.toFixed(2)}% (${i.statements.covered}/${i.statements.total}) | ${i.branches.pct.toFixed(2)}% (${i.branches.covered}/${i.branches.total}) | ${i.functions.pct.toFixed(2)}% (${i.functions.covered}/${i.functions.total}) | ${i.lines.pct.toFixed(2)}% (${i.lines.covered}/${i.lines.total}) |`,
    ),
    '',
  ];
  await fs.writeFile(outputMdPath, mdLines.join('\n'), 'utf8');

  console.log('\n=========================================================================================');
  console.log(' MODULE & PACKAGE COVERAGE SUMMARY');
  console.log('=========================================================================================');
  console.log(
    `${'Module / Package'.padEnd(32)} | ${'Files'.padStart(5)} | ${'Stmts %'.padStart(9)} | ${'Branch %'.padStart(9)} | ${'Funcs %'.padStart(9)} | ${'Lines %'.padStart(9)}`,
  );
  console.log('-----------------------------------------------------------------------------------------');
  for (const item of items) {
    console.log(
      `${item.key.padEnd(32)} | ${String(item.fileCount).padStart(5)} | ${(item.statements.pct.toFixed(2) + '%').padStart(9)} | ${(item.branches.pct.toFixed(2) + '%').padStart(9)} | ${(item.functions.pct.toFixed(2) + '%').padStart(9)} | ${(item.lines.pct.toFixed(2) + '%').padStart(9)}`,
    );
  }
  console.log('-----------------------------------------------------------------------------------------');
  console.log(
    `${'TOTAL (ALL MODULES)'.padEnd(32)} | ${String(report.totalFiles).padStart(5)} | ${(report.overall.statements.pct.toFixed(2) + '%').padStart(9)} | ${(report.overall.branches.pct.toFixed(2) + '%').padStart(9)} | ${(report.overall.functions.pct.toFixed(2) + '%').padStart(9)} | ${(report.overall.lines.pct.toFixed(2) + '%').padStart(9)}`,
  );
  console.log('=========================================================================================');
  console.log(`Saved reports: ${path.relative(backendRoot, outputMdPath)} & ${path.relative(backendRoot, outputJsonPath)}\n`);
}

main().catch((err) => {
  console.error('[ModuleCoverageReporter] Failed to generate module coverage report:', err);
  process.exit(1);
});
