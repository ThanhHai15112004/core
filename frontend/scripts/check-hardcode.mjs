#!/usr/bin/env node
/**
 * Chặn hardcode trong bộ UI dùng chung và System Console:
 *   1. Mã màu (#hex, rgb(), hsl(), oklch()) ngoài src/core/theme/**
 *   2. Inline style đặt màu (`style={{ color: … }}`)
 *   3. Chữ hiển thị viết thẳng trong JSX / thuộc tính placeholder, title, aria-label, alt (phải qua t())
 *
 * File cũ chưa viết lại nằm trong scripts/hardcode-baseline.json — được bỏ qua tạm thời. Viết lại xong file nào
 * thì script nhắc xoá khỏi baseline. File mới bắt buộc sạch.
 *   node scripts/check-hardcode.mjs                 kiểm tra
 *   node scripts/check-hardcode.mjs --write-baseline ghi lại baseline từ trạng thái hiện tại
 * Bỏ qua một dòng có chủ đích: thêm comment `hardcode-ok` trên cùng dòng.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src/core', 'src/modules/system-console'];
// theme = nơi duy nhất có mã màu; i18n = nơi chứa chữ; ui/kit = trang demo chỉ có ở dev (dữ liệu mẫu).
const SKIP_DIRS = ['src/core/theme', 'src/core/i18n', 'src/core/ui/kit'];
const EXTENSIONS = ['.ts', '.tsx', '.css'];
const BASELINE_FILE = join(ROOT, 'scripts', 'hardcode-baseline.json');
const SUPPRESS = 'hardcode-ok';

const COLOR_LITERAL = /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/;
const INLINE_COLOR = /style=\{\{[^}]*\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:/;
const JSX_TEXT = />\s*([^<>{}\n]*\p{L}[^<>{}\n]*)\s*</u;
const LITERAL_ATTR = /\b(?:placeholder|title|aria-label|alt|label)="([^"]*\p{L}[^"]*)"/u;

const toPosix = (p) => p.split(sep).join('/');

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = toPosix(relative(ROOT, full));
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.includes(rel)) walk(full, out);
    } else if (EXTENSIONS.some((e) => name.endsWith(e)) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(rel);
    }
  }
  return out;
}

/** Bỏ nội dung comment để không bắt nhầm chữ / mã màu trong chú thích. */
function stripComments(line, state) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i);
      if (end === -1) return out;
      state.block = false;
      i = end + 2;
      continue;
    }
    const block = line.indexOf('/*', i);
    const lineC = line.indexOf('//', i);
    const isUrl = lineC > 0 && line[lineC - 1] === ':';
    const next = [block, isUrl ? -1 : lineC].filter((n) => n >= 0).sort((a, b) => a - b)[0];
    if (next === undefined) return out + line.slice(i);
    out += line.slice(i, next);
    if (next === block) {
      state.block = true;
      i = next + 2;
    } else {
      return out;
    }
  }
  return out;
}

function check(rel) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  const isTsx = rel.endsWith('.tsx');
  const problems = [];
  const state = { block: false };
  lines.forEach((raw, idx) => {
    if (raw.includes(SUPPRESS)) return;
    const line = stripComments(raw, state);
    if (!line.trim()) return;
    if (COLOR_LITERAL.test(line)) problems.push({ line: idx + 1, rule: 'color-literal', text: raw.trim() });
    if (isTsx && INLINE_COLOR.test(line)) problems.push({ line: idx + 1, rule: 'inline-color', text: raw.trim() });
    if (isTsx) {
      const m = JSX_TEXT.exec(line);
      // Loại trừ biểu thức TS/JSX bị bắt nhầm: generic, toán tử 3 ngôi giữa hai element (`<A /> : x ? <B`).
      if (m && !/[=;()&|'"`]/.test(m[1]) && !/\s[?:]\s/.test(m[1]) && !/\b(?:typeof|extends|keyof)\b/.test(m[1])) problems.push({ line: idx + 1, rule: 'jsx-text', text: raw.trim() });
      if (LITERAL_ATTR.test(line)) problems.push({ line: idx + 1, rule: 'literal-attr', text: raw.trim() });
    }
  });
  return problems;
}

const files = SCAN_DIRS.flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d), []) : []));
const results = new Map(files.map((f) => [f, check(f)]));

if (process.argv.includes('--write-baseline')) {
  const dirty = [...results].filter(([, p]) => p.length > 0).map(([f]) => f).sort();
  writeFileSync(BASELINE_FILE, `${JSON.stringify(dirty, null, 2)}\n`);
  console.log(`check-hardcode: baseline ghi ${dirty.length} file cũ.`);
  process.exit(0);
}

const baseline = new Set(existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : []);
let failed = 0;
const cleaned = [];
for (const [file, problems] of results) {
  if (baseline.has(file)) {
    if (problems.length === 0) cleaned.push(file);
    continue;
  }
  for (const p of problems) {
    failed++;
    console.error(`${file}:${p.line}  [${p.rule}]  ${p.text.slice(0, 140)}`);
  }
}
const stale = [...baseline].filter((f) => !results.has(f));
if (cleaned.length || stale.length) {
  console.warn(`check-hardcode: ${cleaned.length + stale.length} file trong baseline đã sạch hoặc đã xoá — chạy lại với --write-baseline để thu gọn.`);
}
if (failed > 0) {
  console.error(`\ncheck-hardcode: ${failed} vi phạm. Màu → token theme (src/core/theme), chữ → t(), hoặc thêm "${SUPPRESS}" nếu có chủ đích.`);
  process.exit(1);
}
console.log(`check-hardcode: OK (${files.length} file, ${baseline.size} file cũ trong baseline).`);
