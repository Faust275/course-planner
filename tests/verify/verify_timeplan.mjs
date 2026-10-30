// Playwright 端到端：待办抽屉 + 计划专注块（Time-Blocking）
// 覆盖：点待办一键划 1 小时计划块（带上 taskId、planned）、计划块虚线样式、
//       时间块编辑弹窗的「关联待办」与「仅作计划」、计划块不进统计与已投入、
//       待办弹窗的「今日计划 / 今日实际」、清空时间块连计划一起清
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8301/index.html';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
// 固定时钟：抽屉「一键划块」从当前时刻起找空档，冻结到 10:00 才能跨时区/时段稳定复现
try {
  const fixed = new Date(); fixed.setHours(10, 0, 0, 0);
  await p.clock.install({ time: fixed });
} catch (e) { console.warn('clock.install 不可用：' + e.message); }
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const wait = (ms) => p.waitForTimeout(ms || 400);

await p.goto(BASE, { waitUntil: 'networkidle' });
await wait(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip'); if (e) e.click(); });
await wait(500);

/* ==========================================================
 * 准备：两条未完成待办；清空今天的时间块层
 * ========================================================== */
const S = await p.evaluate(() => {
  const today = DateUtil.toStr(DateUtil.today());
  Store.state.activities = (Store.state.activities || []).filter(a => !(a.date === today && a.from === 'block'));
  Store.state.tasks = [];
  const t1 = Store.addTask({ title: '写高数作业', dueDate: today });
  const t2 = Store.addTask({ title: '背英语单词', dueDate: today });
  Store.emit();
  return { today, t1: t1.id, t2: t2.id };
});

/* ==========================================================
 * A. 待办抽屉：点待办一键划计划块
 * ========================================================== */
console.log('A. 待办抽屉');
await p.evaluate(() => { App.go('calendar'); });
await wait(700);

const drawerRow = p.locator('.cp-tb-drawer-row', { hasText: '写高数作业' });
check('抽屉里列出未完成待办', await drawerRow.count() === 1);
await drawerRow.first().click();
await wait(600);

const A1 = await p.evaluate((s) => {
  const blocks = (Store.state.activities || []).filter(a => a.date === s.today && a.from === 'block');
  return {
    n: blocks.length,
    planned: blocks.every(a => a.planned),
    taskId: blocks.map(a => a.taskId),
    minutes: blocks.reduce((x, a) => x + (a._m || 0), 0),
    plannedOn: Store.taskPlannedOn(s.t1, s.today),
    span: blocks.map(a => a.start + '-' + a.end)
  };
}, S);
check('点待办划出一块计划', A1.n === 1, A1);
check('计划块带 taskId 且 planned', A1.planned && A1.taskId.join(',') === S.t1, A1);
check('时长是 1 小时', A1.plannedOn === 60, A1.plannedOn);

const A2 = await p.evaluate((s) => {
  // 时间带上的计划格应有 plan 类（虚线）
  const cells = [...document.querySelectorAll('.cp-tb-cell.cp-plan')];
  return cells.length;
});
check('时间带上计划格有虚线样式（cp-plan）', A2 === 2, A2);

const A3 = await p.evaluate((s) => ({
  stat: Store.dayStat(s.today).segments.filter(x => x.key === 'activity')[0].minutes,
  invest: Store.taskInvest(s.t1).minutes
}), S);
check('计划块不进统计的「活动记录」', A3.stat === 0, A3.stat);
check('计划块不计入「已投入」', A3.invest === 0, A3.invest);

/* ==========================================================
 * B. 编辑弹窗：关联待办 + 仅作计划/实际投入
 * ========================================================== */
console.log('B. 时间块编辑弹窗');
// 找一个空格子点开弹窗：直接点时间带中间某个空档
const cellIdx = await p.evaluate(() => {
  const cells = [...document.querySelectorAll('.cp-tb-cell')];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].classList.contains('has') && i % 2 === 0) return i;
  }
  return -1;
});
check('找到空格子', cellIdx >= 0, cellIdx);
await p.locator('.cp-tb-cell').nth(cellIdx).click();
await wait(500);

const B0 = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  if (!m) return false;
  const labels = m.innerText;
  return /关联待办/.test(labels) && /仅作计划/.test(labels) && /实际投入/.test(labels);
});
check('弹窗有「关联待办」与「性质」选择', B0);

// 选「仅作计划」，涂 1 小时（span 默认半小时 → 点 1 小时），类型选学习
await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  const seg = [...m.querySelectorAll('.cp-segment button')].find(b => b.textContent.trim() === '1 小时');
  if (seg) seg.click();
});
await wait(200);
await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  const sel = m.querySelector('select');
  if (sel) {
    const opt = [...sel.options].find(o => o.textContent.includes('背英语单词'));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
  }
});
await wait(150);
await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  const seg = [...m.querySelectorAll('.cp-segment button')].find(b => b.textContent.trim() === '仅作计划');
  if (seg) seg.click();
});
await wait(150);
await p.locator('.cp-modal .cp-tb-type', { hasText: '学习' }).first().click();
await wait(600);

const B1 = await p.evaluate((s) => {
  const blocks = (Store.state.activities || []).filter(a => a.date === s.today && a.from === 'block' && a.taskId === s.t2);
  return { n: blocks.length, planned: blocks.every(a => a.planned), plannedOn: Store.taskPlannedOn(s.t2, s.today) };
}, S);
check('弹窗路径：划出关联 t2 的计划块', B1.n === 1 && B1.planned, B1);
check('t2 的计划分钟 = 60', B1.plannedOn === 60, B1.plannedOn);

// 实际投入路径：默认 segment「实际投入」，不勾计划
const cellIdx2 = await p.evaluate(() => {
  const cells = [...document.querySelectorAll('.cp-tb-cell')];
  for (let i = cells.length - 1; i >= 0; i--) {
    if (!cells[i].classList.contains('has') && i % 2 === 0) return i;
  }
  return -1;
});
await p.locator('.cp-tb-cell').nth(cellIdx2).click();
await wait(450);
await p.locator('.cp-modal .cp-tb-type', { hasText: '其它' }).first().click();
await wait(550);
const B2 = await p.evaluate((s) => {
  const acts = (Store.state.activities || []).filter(a => a.date === s.today && a.from === 'block' && !a.planned);
  return { n: acts.length, stat: Store.dayStat(s.today).segments.filter(x => x.key === 'activity')[0].minutes };
}, S);
check('不勾「仅作计划」时是实际块（进统计）', B2.n === 1 && B2.stat >= 30, B2);

/* ==========================================================
 * C. 待办弹窗：今日计划 / 今日实际
 * ========================================================== */
console.log('C. 待办弹窗的计划 vs 实际');
await p.evaluate((s) => {
  // 先给 t1 记 30 分钟实际投入（模拟番茄钟写入），累计「已投入」才有内容
  Store.addActivity({ date: s.today, start: '21:00', end: '21:30', name: '学习', type: 'study', taskId: s.t1 });
  App.go('tasks');
}, S);
await wait(500);
await p.locator('section.cp-active .cp-task-row', { hasText: '写高数作业' }).first().click();
await wait(600);
const C1 = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  return m ? m.innerText.replace(/\s+/g, ' ') : '';
});
check('弹窗显示「今日计划 1 小时」', /今日计划 1 小时/.test(C1), C1.slice(0, 120));
check('弹窗显示「今日实际」与差值提示', /今日实际/.test(C1) && /还差/.test(C1), /今日实际[^·]*·[^】]*还差/.test(C1));
check('仍显示累计「已投入 30 分钟」', /已投入 30 分钟/.test(C1), C1.slice(0, 160));

/* ==========================================================
 * D. 清空时间块连计划一起清
 * ========================================================== */
console.log('D. 清空回归');
await p.evaluate(() => {
  const x = document.querySelector('.cp-modal-head .cp-icon-btn');
  if (x) x.click();
});
await wait(400);
await p.evaluate(() => { App.go('calendar'); });
await wait(600);
await p.locator('.cp-tb-acts button', { hasText: '清空这天的时间块' }).first().click();
await wait(400);
await p.locator('.cp-modal button', { hasText: '清空' }).last().click();
await wait(600);
const D1 = await p.evaluate((s) => ({
  left: (Store.state.activities || []).filter(a => a.date === s.today && a.from === 'block').length,
  plannedOn: Store.taskPlannedOn(s.t1, s.today)
}), S);
check('清空后计划块一起没了', D1.left === 0 && D1.plannedOn === 0, D1);

/* ==========================================================
 * 收尾
 * ========================================================== */
const realErrors = errors.filter(e => !/favicon/.test(e) && !/manifest\.webmanifest/.test(e));
await b.close();
console.log('');
if (realErrors.length) {
  bad++;
  console.log('  ✗ 控制台 / 页面报错 ' + realErrors.length + ' 条：');
  realErrors.slice(0, 6).forEach(e => console.log('    · ' + e));
} else {
  ok++;
  console.log('  ✓ 无控制台报错');
}
console.log('\n通过 ' + ok + ' 项，失败 ' + bad + ' 项');
process.exit(bad ? 1 : 0);
