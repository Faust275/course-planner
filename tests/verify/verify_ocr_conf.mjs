// 单测：OCR 结构识别输出置信度矩阵（buildGrid / buildFromLines 的 conf 字段）
// Node vm 直接加载真实 assets/js/ocr.js（模块级不碰 DOM，可裸跑）
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = process.cwd();
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
vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/ocr.js'), 'utf8'), sandbox);
const Ocr = sandbox.Ocr;

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

/* ---------- 造一张规整课表的「词表」（等价于 Tesseract 的输出） ---------- */
const HGT = 18;
const COL_X = [200, 320, 440, 560, 680, 800, 920];
const ROW_Y = [120, 210, 300, 390, 480];

function word(text, cx, cy, conf) {
  const width = String(text).length * 15;
  const o = {
    text: String(text),
    x0: cx - width / 2, x1: cx + width / 2,
    y0: cy - HGT / 2, y1: cy + HGT / 2,
    cx, cy
  };
  if (conf !== undefined) o.conf = conf;
  return o;
}

/** content: 二维数组，每格 { t: 文本, c: 置信度 } 或 null */
function makeWords(content) {
  const words = [];
  for (let i = 0; i < 7; i++) words.push(word('周' + '一二三四五六日'[i], COL_X[i], 50, 96));
  ROW_Y.forEach((y, i) => words.push(word('第' + (i + 1) + '节', 80, y, 95)));
  content.forEach((row, ri) => row.forEach((cell, ci) => {
    if (!cell || !cell.t) return;
    words.push(word(cell.t, COL_X[ci], ROW_Y[ri], cell.c));
  }));
  return words;
}

/* ========== 1. 基本形状：conf 与 cells 行列对齐 ========== */
const content = [
  [{ t: '高等数学', c: 96 }, null, null, null, null, null, null],
  [null, null, { t: '大学物理', c: 70 }, null, null, null, null],
  [null, null, null, { t: '体育', c: 45 }, null, null, null],
  [null, null, null, null, null, null, null]
];
let g = Ocr.buildGrid(makeWords(content), {});
check('网格识别出 7 列', g.cols.length === 7, g.cols.length);
// 第 4 行整行是空的，会被「尾部空行丢掉」裁掉，所以只剩 3 行
check('尾部空行被裁掉，剩 3 行', g.rows.length === 3, g.rows.length);
check('返回了 conf 矩阵', Array.isArray(g.conf), typeof g.conf);
check('conf 行数与 cells 一致', g.conf.length === g.cells.length, g.conf.length + ' vs ' + g.cells.length);
check('conf 列数与 cells 一致',
  g.conf.every((row, i) => row.length === g.cells[i].length));

/* ========== 2. 置信度取值 ========== */
check('高置信格 conf 约等于 96', Math.abs(g.conf[0][0] - 96) <= 1, g.conf[0][0]);
check('中置信格 conf 约等于 70', Math.abs(g.conf[1][2] - 70) <= 1, g.conf[1][2]);
check('低置信格 conf 约等于 45', Math.abs(g.conf[2][3] - 45) <= 1, g.conf[2][3]);
check('空格 conf 为 null', g.conf[0][1] === null, g.conf[0][1]);
check('空格文本也为空', g.cells[0][1] === '', JSON.stringify(g.cells[0][1]));

/* ========== 3. 一格多词取平均（取平均才有区分度） ========== */
const multi = [[
  { t: '高等数学', c: 92 }, { t: '张老师', c: 52 }, null, null, null, null, null
], [null, null, null, null, null, null, null]];
// 两个词在同一格：一个高一个低，平均应落在中间档而不是被打成最低
const gw = makeWords(multi);
// 手动把「张老师」挪到第一格第二行（否则会落到别的格子）
const zhang = gw.find((w) => w.text === '张老师');
zhang.cx = COL_X[0];
zhang.x0 = COL_X[0] - zhang.text.length * 7.5;
zhang.x1 = COL_X[0] + zhang.text.length * 7.5;
zhang.cy = ROW_Y[0] + 22;
zhang.y0 = zhang.cy - HGT / 2;
zhang.y1 = zhang.cy + HGT / 2;
const gm = Ocr.buildGrid(gw, {});
check('同格两词都进了同一格', /高等数学/.test(gm.cells[0][0]) && /张老师/.test(gm.cells[0][0]),
  JSON.stringify(gm.cells[0][0]));
check('同格两词置信度取平均（(92+52)/2 ≈ 72）',
  Math.abs(gm.conf[0][0] - 72) <= 2, gm.conf[0][0]);

/* ========== 4. 没有 conf 字段的老词表：不崩，全部 null ========== */
const noConf = makeWords([[{ t: '数据结构' }, null, null, null, null, null, null]]);
const gn = Ocr.buildGrid(noConf, {});
check('无 conf 字段时仍能识别出课程', /数据结构/.test(gn.cells[0][0]), JSON.stringify(gn.cells[0][0]));
check('无 conf 字段时 conf 为 null 而不是 NaN/0', gn.conf[0][0] === null, gn.conf[0][0]);

/* ========== 5. 空输入不炸 ========== */
const ge = Ocr.buildGrid([], {});
check('空词表返回空 conf 数组', Array.isArray(ge.conf) && ge.conf.length === 0, JSON.stringify(ge.conf));

/* ========== 6. 走 customLines 分支（手动画的辅助网格）也带 conf ========== */
const customContent = [
  [{ t: '线性代数', c: 88 }, null, null, null, null, null, null],
  [null, null, null, null, null, null, null]
];
const cw = makeWords(customContent);
// 手画 8 条竖线、5 条横线：竖直方向涵盖 7 列，水平方向涵盖 2 行
const vlines = [140, 260, 380, 500, 620, 740, 860, 980];
const hlines = [100, 165, 255];
const gc = Ocr.buildGrid(cw, { customLines: { vlines, hlines } });
check('手画网格走的是 customLines 分支', !!(gc.meta && gc.meta.customGrid), JSON.stringify(gc.meta));
check('手画网格也返回 conf 矩阵', Array.isArray(gc.conf) && gc.conf.length === gc.cells.length,
  Array.isArray(gc.conf) ? gc.conf.length + ' vs ' + gc.cells.length : typeof gc.conf);
check('手画网格里内容格带置信度',
  gc.cells.some((row, ri) => row.some((t, ci) => /线性代数/.test(t) && gc.conf[ri][ci] > 80)),
  JSON.stringify(gc.cells));

/* ========== 7. 阈值边界的语义（与界面分档同源，直接用 Ocr.confLevel） ========== */
const bound = [[
  { t: '甲', c: 61 }, { t: '乙', c: 62 }, { t: '丙', c: 81 }, { t: '丁', c: 82 },
  null, null, null
], [null, null, null, null, null, null, null]];
const gb = Ocr.buildGrid(makeWords(bound), {});
check('61% → low', Ocr.confLevel(gb.conf[0][0]) === 'low', gb.conf[0][0]);
check('62% → mid（临界值算不清但不算红）', Ocr.confLevel(gb.conf[0][1]) === 'mid', gb.conf[0][1]);
check('81% → mid', Ocr.confLevel(gb.conf[0][2]) === 'mid', gb.conf[0][2]);
check('82% → 不标（临界值算清楚）', Ocr.confLevel(gb.conf[0][3]) === '', gb.conf[0][3]);
check('null → 不标', Ocr.confLevel(null) === '', Ocr.confLevel(null));
check('阈值常量对外可见', Ocr.CONF_LOW === 62 && Ocr.CONF_MID === 82, Ocr.CONF_LOW + '/' + Ocr.CONF_MID);

/* ========== 8. confStats：数一数到底几格要核对 ========== */
const st = Ocr.confStats(gb);
check('存疑统计：low 1 格', st.low === 1, st.low);
check('存疑统计：mid 2 格', st.mid === 2, st.mid);
check('存疑统计：合计 3 格', st.suspect === 3, st.suspect);
check('存疑统计：有内容的格 4 个（空格不数）', st.filled === 4, st.filled);

// 用户改过第 1 格后，那一格不再计入存疑
const stTouched = Ocr.confStats(gb, { '0,0': 1 });
check('改过的格子不再算存疑（low 归零）', stTouched.low === 0, stTouched.low);
check('改过的格子也没被当成空（filled 仍是 4）', stTouched.filled === 4, stTouched.filled);
check('剩下的存疑数随之减少', stTouched.suspect === 2, stTouched.suspect);

// 全空网格
const gEmpty = Ocr.buildGrid([], {});
const stEmpty = Ocr.confStats(gEmpty);
check('空网格：filled / suspect 都是 0', stEmpty.filled === 0 && stEmpty.suspect === 0,
  stEmpty.filled + '/' + stEmpty.suspect);

/* ---------- 汇总 ---------- */
const bad = results.filter((r) => !r.ok);
console.log('\n' + (results.length - bad.length) + ' 通过 / ' + bad.length + ' 失败（共 ' + results.length + ' 项）');
if (bad.length) {
  bad.forEach((r) => console.log('  ✗ ' + r.name));
  process.exit(1);
}
