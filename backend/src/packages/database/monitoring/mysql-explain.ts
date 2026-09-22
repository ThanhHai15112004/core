import {
  toNumber,
  type ExplainFlag,
  type ExplainResult,
  type ExplainStep,
} from './monitoring.types.js';

/** Số dòng phải đọc mỗi lần quét từ mức này trở lên thì đánh dấu "nhiều dòng" (chỉ là dữ kiện, không phải khuyến nghị). */
export const HIGH_ROWS = 10_000;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const ACCESS_LABEL: Record<string, string> = {
  ALL: 'Full table scan',
  index: 'Full index scan',
  range: 'Index range scan',
  ref: 'Index lookup',
  eq_ref: 'Unique index lookup',
  const: 'Constant lookup',
  system: 'System table',
  fulltext: 'Fulltext lookup',
  index_merge: 'Index merge',
};

/**
 * Chuyển `EXPLAIN FORMAT=JSON` của MySQL 8 thành danh sách bước theo cây (depth).
 * Chỉ trình bày dữ liệu của database — không tự kết luận phải tạo index.
 */
export function parseMysqlExplain(raw: unknown): ExplainResult {
  const root = typeof raw === 'string' ? (JSON.parse(raw) as Json) : (raw as Json);
  const steps: ExplainStep[] = [];
  const block = isObj(root?.['query_block']) ? root['query_block'] : null;
  const totalCost =
    block && isObj(block['cost_info']) ? toNumber(block['cost_info']['query_cost']) : null;

  const operation = (name: string, depth: number, flags: ExplainFlag[] = []) =>
    steps.push({
      depth,
      operation: name,
      table: null,
      accessType: null,
      key: null,
      possibleKeys: [],
      rows: null,
      filteredPercent: null,
      cost: null,
      condition: null,
      flags,
    });

  const table = (t: Json, depth: number) => {
    const accessType = typeof t['access_type'] === 'string' ? t['access_type'] : null;
    const rows = toNumber(t['rows_examined_per_scan']);
    const key = typeof t['key'] === 'string' ? t['key'] : null;
    const cost = isObj(t['cost_info'])
      ? toNumber(t['cost_info']['prefix_cost'] ?? t['cost_info']['read_cost'])
      : null;
    const flags: ExplainFlag[] = [];
    if (accessType === 'ALL') flags.push('full_scan');
    if (accessType === 'ALL' && !key) flags.push('no_index');
    if (rows !== null && rows >= HIGH_ROWS) flags.push('high_rows');
    if (t['using_filesort'] === true) flags.push('filesort');
    if (t['using_temporary_table'] === true) flags.push('temporary');
    steps.push({
      depth,
      operation: (accessType && ACCESS_LABEL[accessType]) ?? accessType ?? 'Table',
      table: typeof t['table_name'] === 'string' ? t['table_name'] : null,
      accessType,
      key,
      possibleKeys: Array.isArray(t['possible_keys']) ? t['possible_keys'].map(String) : [],
      rows,
      filteredPercent: toNumber(t['filtered']),
      cost,
      condition: typeof t['attached_condition'] === 'string' ? t['attached_condition'] : null,
      flags,
    });
    if (isObj(t['materialized_from_subquery'])) walk(t['materialized_from_subquery'], depth + 1);
    if (Array.isArray(t['attached_subqueries']))
      for (const s of t['attached_subqueries']) walk(s, depth + 1);
  };

  const walk = (node: unknown, depth: number): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth);
      return;
    }
    if (!isObj(node)) return;
    if (isObj(node['query_block'])) walk(node['query_block'], depth);
    if (isObj(node['table'])) table(node['table'], depth);
    if (Array.isArray(node['nested_loop'])) walk(node['nested_loop'], depth);
    const wrappers: [string, string, ExplainFlag[]][] = [
      [
        'ordering_operation',
        'ORDER BY',
        node['ordering_operation'] &&
        isObj(node['ordering_operation']) &&
        node['ordering_operation']['using_filesort'] === true
          ? ['filesort']
          : [],
      ],
      [
        'grouping_operation',
        'GROUP BY',
        node['grouping_operation'] &&
        isObj(node['grouping_operation']) &&
        node['grouping_operation']['using_temporary_table'] === true
          ? ['temporary']
          : [],
      ],
      ['duplicates_removal', 'DISTINCT', []],
      ['windowing', 'WINDOW', []],
    ];
    for (const [key, label, flags] of wrappers) {
      if (!isObj(node[key])) continue;
      operation(label, depth, flags);
      walk(node[key], depth + 1);
    }
    if (isObj(node['union_result'])) {
      operation('UNION', depth);
      walk(node['union_result']['query_specifications'], depth + 1);
    }
    if (Array.isArray(node['optimized_away_subqueries']))
      walk(node['optimized_away_subqueries'], depth + 1);
  };

  walk(block, 0);
  return { steps, totalCost };
}
