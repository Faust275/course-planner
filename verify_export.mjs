// Playwright 端到端：课表导出图片
// 验证：布局复用、单双周过滤、撞课堆叠、预览弹窗、下载、空周提示
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const URL = process.env.URL || 'http://localhost:8191/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { const e = document.querySelector('.ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

/* ---------- 1) 造数据 ---------- */
const setup = await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil;
  const sem = S.currentSemester();
  sem.startDate = D.toStr(D.weekStart(D.today()));
  sem.weeks = 20;
  sem.name = '2026 秋';

  const mk = (id, name, slots, wt, color) => ({
    id, name, teacher: '王老师', location: 'A301', color: color || '#4f46e5',
    credit: 3, note: '', semesterId: null,
    startWeek: 1, endWeek: 16, weekType: wt || 'all', exam: null, slots
  });

  S.state.courses = [
    mk('c1', '高等数学', [
      { day: 1, timeMode: 'period', periodId: S.periods[0].id, location: 'A301' },
      { day: 1, timeMode: 'period', periodId: S.periods[1].id, location: 'A301' }
    ], 'all', '#4f46e5'),
    mk('c2', '大学物理', [{ day: 3, timeMode: 'period', periodId: S.periods[2].id, location: 'B204' }], 'all', '#12b76a'),
    mk('c5', '形势与政策', [{ day: 3, timeMode: 'period', periodId: S.periods[2].id, location: 'C101' }], 'all', '#f79009'),
    mk('c3', '体育', [{ day: 4, timeMode: 'period', periodId: S.periods[4].id, location: '操场' }], 'odd', '#f04438'),
    mk('c4', '心理健康', [{ day: 5, timeMode: 'period', periodId: S.periods[4].id, location: 'D202' }], 'even', '#2e90fa')
  ];
  S.emit();
  return { week: S.currentWeek(), periods: S.periods.length };
});

/* ---------- 2) 布局：连堂合并 / 撞课堆叠 / 单双周 ---------- */
const layout = await p.evaluate(() => {
  const L = window.ScheduleLayout.build(1);
  const blocks = [], stacks = [];
  Object.keys(L).forEach(k => {
    if (L[k].type === 'block') blocks.push({ key: k, span: L[k].span, name: L[k].item.name });
    if (L[k].type === 'stack') stacks.push({ key: k, names: L[k].items.map(i => i.name) });
  });
  return { blocks, stacks };
});

/* ---------- 3) 渲染一张图，检查像素 ---------- */
const img = await p.evaluate(() => {
  const data = window.ScheduleExport.collect(1);
  const m = window.ScheduleExport.measure(7, data.rows.length, {});
  const cv = document.createElement('canvas');
  cv.width = m.w * 2;
  cv.height = m.h * 2;
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  window.ScheduleExport.paint(ctx, data, {});

  // 采样：课程块内应是非白非背景色（有色底）
  const px = (x, y) => {
    const d = ctx.getImageData(x * 2, y * 2, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  // 周一第 1 节块的内部（格子起点：pad22+timeW62=84，第一行 y=22+46+62=130）
  const inBlock = px(84 + 40, 130 + 30);
  // 空白格子（周六第 8 节）
  const empty = px(84 + 132 * 5 + 40, 130 + 68 * 7 + 30);

  return {
    w: cv.width, h: cv.height,
    url: cv.toDataURL('image/png'),
    inBlock, empty,
    isAllWhite: inBlock[0] === 255 && inBlock[1] === 255 && inBlock[2] === 255
  };
});
writeFileSync('/tmp/verify_export.png', Buffer.from(img.url.split(',')[1], 'base64'));

/* ---------- 4) 预览弹窗 ---------- */
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(600);
const btn = await p.evaluate(() =>
  [...document.querySelectorAll('button')].some(x => x.textContent.trim() === '导出图片'));

await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '导出图片');
  if (btn) btn.click();
});
await p.waitForTimeout(600);

const dlg = await p.evaluate(() => {
  const m = [...document.querySelectorAll('[class*=modal]')].find(x => /导出课表图片/.test(x.textContent));
  if (!m) return { open: false };
  const cv = m.querySelector('canvas');
  return {
    open: true,
    hasCanvas: !!cv,
    canvasW: cv ? cv.width : 0,
    canvasH: cv ? cv.height : 0,
    hint: (m.textContent.match(/\d+×\d+ 逻辑像素[^）]*）/) || [''])[0],
    hasSaveBtn: [...m.querySelectorAll('button')].some(x => /保存 PNG/.test(x.textContent))
  };
});

/* ---------- 5) 空周：切到没课的一周 ---------- */
const emptyWeek = await p.evaluate(() => {
  const S = window.Store;
  // 第 19 周（课程只到 16 周）
  const L = window.ScheduleLayout.build(19);
  return { keys: Object.keys(L).length };
});

const checks = [
  ['连堂合并为 1 块', layout.blocks.some(x => x.span === 2 && x.name === '高等数学')],
  ['撞课进入堆叠', layout.stacks.length === 1 && layout.stacks[0].names.length === 2],
  ['单周课在第 1 周出现', layout.blocks.some(x => x.name === '体育')],
  ['双周课在第 1 周不出现', !layout.blocks.some(x => x.name === '心理健康')],
  ['图片按 2 倍导出', img.w > 2000 && img.h > 1600],
  ['课程块有底色（非纯白）', !img.isAllWhite],
  ['空白格子是白/浅色', img.empty[0] > 245],
  ['顶栏有导出图片按钮', btn === true],
  ['预览弹窗打开', dlg.open === true],
  ['弹窗内有 canvas', dlg.hasCanvas === true],
  ['canvas 尺寸正确', dlg.canvasW === img.w && dlg.canvasH === img.h],
  ['有尺寸说明文字', /逻辑像素/.test(dlg.hint || '')],
  ['有保存按钮', dlg.hasSaveBtn === true],
  ['空周没有可导出内容', emptyWeek.keys === 0],
  ['无控制台错误', errors.length === 0]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name);
  if (!pass) ok = false;
}
if (!ok) {
  console.log('\n--- 详情 ---');
  console.log(JSON.stringify({ setup, layout, img: { w: img.w, h: img.h, inBlock: img.inBlock, empty: img.empty }, dlg, emptyWeek, errors: errors.slice(0, 5) }, null, 2));
}
await b.close();
process.exit(ok ? 0 : 1);
