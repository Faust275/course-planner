// OCR 基准跑分：把「词 → 表格结构 → 课程列表」这条链路跑一遍，和期望结果比对。
//
// 为什么是这一层：
//   Tesseract 本身改不动，能改、也最容易改坏的是后面这段——表头剔除、按几何归格、
//   连堂处理、词库纠偏、周次解析。这里守的就是它。
//
// 两种词表来源：
//   默认      —— layout.mjs 算出的「理想词表」（字都认对了），跑得快、结果稳定，可以当回归门禁用
//   --real    —— cases/*/words.real.json（真 Tesseract 录制的），反映端到端真实水平，不做门禁
//
// 用法：
//   node tests/ocr-bench/run.mjs            跑分
//   node tests/ocr-bench/run.mjs --real     用真机录制的词表跑
//   node tests/ocr-bench/run.mjs --update   把当前成绩写进 baseline.json（改完算法、确认没退步后手动跑）
//   node tests/ocr-bench/run.mjs -v         打印每个 case 的逐条匹配

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildWords, buildExpected } from './layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CASES = path.join(HERE, 'cases');
const BASELINE = path.join(HERE, 'baseline.json');

const argv = process.argv.slice(2);
const useReal = argv.includes('--real');
const update = argv.includes('--update');
const verbose = argv.includes('-v') || argv.includes('--verbose');

/* ---------- 载入真实的 ocr.js（模块级不碰 DOM，可以直接在 Node 里跑） ---------- */
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.document = {
  createElement: () => ({ getContext: () => ({}) }),
  addEventListener() {},
  head: { appendChild() {} }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/ocr.js'), 'utf8'), sandbox);
const Ocr = sandbox.Ocr;

/* ---------- 比对口径 ---------- */
const normName = (s) => String(s || '')
  .replace(/[\s\u3000·•,，、。:：;；()（）[\]【】<>《》\-—_/\\|]/g, '')
  .toLowerCase();

const keyOf = (day, period, name) => day + '|' + period + '|' + normName(name);

/** 从 case 目录读内容；词表按 --real 决定来源 */
function loadCase(dir) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  const realPath = path.join(dir, 'words.real.json');
  let words, source;
  if (useReal) {
    if (!fs.existsSync(realPath)) return { c, skip: '还没有真机词表（先跑 record.mjs）' };
    words = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    source = 'real';
  } else {
    words = buildWords(c);
    source = 'ideal';
  }
  return { c, words, source };
}

function scoreCase(c, words) {
  const grid = Ocr.buildGrid(words, {});
  const items = Ocr.gridToItems(grid, [], 20);
  const expected = buildExpected(c);

  const expKeys = expected.map((e) => keyOf(e.day, e.period, e.name));
  const gotKeys = items.map((it) => keyOf(it.day, it.periodIndex, it.name));

  // 多重集匹配：同名同格只算一次，多出来的算冗余
  const pool = new Map();
  gotKeys.forEach((k) => pool.set(k, (pool.get(k) || 0) + 1));
  let tp = 0;
  const missed = [];
  expKeys.forEach((k) => {
    const n = pool.get(k) || 0;
    if (n > 0) { pool.set(k, n - 1); tp++; }
    else missed.push(k);
  });
  const extra = [];
  pool.forEach((n, k) => { for (let i = 0; i < n; i++) extra.push(k); });

  const P = gotKeys.length ? tp / gotKeys.length : 0;
  const R = expKeys.length ? tp / expKeys.length : 0;
  const F1 = (P + R) ? (2 * P * R) / (P + R) : 0;

  return {
    grid, items, expected, tp, missed, extra,
    P, R, F1,
    counts: { exp: expKeys.length, got: gotKeys.length },
    shape: { rows: grid.rows.length, cols: grid.cols.length }
  };
}

/* ---------- 主流程 ---------- */
const dirs = fs.readdirSync(CASES)
  .filter((d) => fs.existsSync(path.join(CASES, d, 'case.json')))
  .sort();

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const rows = [];
let totalTp = 0, totalExp = 0, totalGot = 0;
let regressions = [];
let skipped = 0;

for (const d of dirs) {
  const loaded = loadCase(path.join(CASES, d));
  if (loaded.skip) {
    console.log(`${d.padEnd(20)} 跳过：${loaded.skip}`);
    skipped++;
    continue;
  }
  const { c, words, source } = loaded;
  const r = scoreCase(c, words);
  totalTp += r.tp; totalExp += r.counts.exp; totalGot += r.counts.got;

  const fmt = (x) => x.toFixed(2);
  console.log(`${d.padEnd(20)} P ${fmt(r.P)}  R ${fmt(r.R)}  F1 ${fmt(r.F1)}   ` +
    `(${r.counts.exp} 期望 / ${r.counts.got} 得到，表格 ${r.shape.rows}×${r.shape.cols})`);

  if (verbose || r.missed.length || r.extra.length) {
    r.missed.forEach((k) => console.log('    ✗ 漏了 ' + k));
    r.extra.forEach((k) => console.log('    ✗ 多了 ' + k));
  }

  const prev = baseline && baseline.cases && baseline.cases[c.id];
  if (prev != null && r.F1 + 1e-9 < prev - 0.005) {
    regressions.push({ id: c.id, now: r.F1, before: prev });
  }
  rows.push({ id: c.id, f1: r.F1, source });
}

const microF1 = (totalTp && totalExp && totalGot)
  ? 2 * totalTp / (totalExp + totalGot) : 0;

console.log('\n' + '='.repeat(64));
console.log((useReal ? '真机词表' : '理想词表') + `  ${rows.length} 个 case，跳过 ${skipped} 个`);
console.log(`整体 F1（micro）: ${microF1.toFixed(3)}`);

if (regressions.length) {
  console.log('\n⚠️  以下 case 相比基线退化了：');
  regressions.forEach((x) => console.log(`   ${x.id}: ${x.before.toFixed(3)} → ${x.now.toFixed(3)}`));
}

if (update) {
  if (useReal) {
    // 真实分受 OCR 模型和图片质量影响，波动大，只适合看趋势，不能拿来当回归门禁
    console.log('\n--real 模式不写基线：真机分数波动大，基线只用理想词表维护。');
    process.exit(0);
  }
  const out = {
    updatedAt: new Date().toISOString().slice(0, 10),
    mode: useReal ? 'real' : 'ideal',
    microF1: Number(microF1.toFixed(4)),
    cases: {}
  };
  rows.forEach((r) => { out.cases[r.id] = Number(r.f1.toFixed(4)); });
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\n已写入基线 ' + path.relative(ROOT, BASELINE));
}

if (regressions.length) {
  console.log('\n如果这次改动本来就是要调整口径，确认无误后跑一次 --update 更新基线。');
  process.exit(1);
}
if (!rows.length) {
  console.log('没有可跑的分例。');
  process.exit(1);
}
