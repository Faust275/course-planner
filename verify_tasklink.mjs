// Playwright 端到端：待办 ↔ 时间投入 双向关联 + 月历时间块 + 统计「今年」档
// 覆盖：待办弹窗空项回归（arrayify）、番茄钟自动计入、活动手动关联、
//       任务行与详情的「已投入」、反查跳转、月历 48 格时间块（涂 / 合并 / 清除 / 清空）、
//       只读层（睡眠 / 用餐 / 课程）、统计「今年」档与按月热力
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8301/index.html';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const wait = (ms) => p.waitForTimeout(ms || 350);

async function clearModals() {
  await p.evaluate(() => {
    document.querySelectorAll('.cp-modal-wrap').forEach(w => {
      // 编辑类弹窗没有「取消」，只有右上角的 ✕；得走正规关闭路径，openCount 才会减
      const x = w.querySelector('.cp-modal-head .cp-icon-btn');
      if (x) { x.click(); return; }
      const btn = [...w.querySelectorAll('button')].find(b => /取消|关闭/.test(b.textContent));
      if (btn) btn.click();
    });
  });
  await p.waitForTimeout(320);
  await p.evaluate(() => document.querySelectorAll('.cp-modal-wrap').forEach(w => w.remove()));
  await p.waitForTimeout(60);
}

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip'); if (e) e.click(); });
await p.waitForTimeout(500);

/* ==========================================================
 * A. 回归：没有子任务的待办也能打开编辑弹窗
 *    （modal 的 body 里有条件项时，空项曾把 appendChild 打断）
 * ========================================================== */
console.log('A. 回归：待办弹窗');
const A = await p.evaluate(() => {
  Store.state.tasks = [];
  Store.state.activities = [];
  Store.state.pomodoro.sessions = [];
  const t = Store.addTask({ title: '普通待办（没有子任务）', dueDate: '2026-10-25' });
  Store.emit();
  App.go('tasks');
  return t.id;
});
await wait(500);
await p.locator('.cp-task-row').first().click();
await wait(600);
const A1 = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  const inp = m ? m.querySelector('input') : null;
  // 标题在输入框的 value 里，innerText 看不到
  return { open: !!m, title: inp ? inp.value : '', hasSave: /保存/.test(m ? m.innerText : '') };
});
check('没有子任务的待办，编辑弹窗能打开', A1.open && /普通待办/.test(A1.title) && A1.hasSave, A1);
await clearModals();

/* ==========================================================
 * B. 待办 ↔ 时间投入
 * ========================================================== */
console.log('B. 待办与时间投入');
const B = await p.evaluate(() => {
  const t = Store.addTask({ title: '高数第三章习题', dueDate: '2026-10-25' });
  // 番茄钟结束时会自动写一条活动记录（这里直接调 Store 模拟）
  Store.finishFocus(90, t.id, {
    date: '2026-10-20', start: '09:00', end: '10:30',
    name: '专注：高数第三章习题', tags: ['学习/数学']
  });
  const inv = Store.taskInvest(t.id);
  return { id: t.id, minutes: inv.minutes, pomos: inv.pomodoros, count: inv.count, last: inv.last };
});
check('番茄钟关联待办后自动计入投入', B.minutes === 90 && B.count === 1, B);
check('番茄数单独计（不重复算分钟）', B.pomos === 1, B);
check('最近投入日期记得住', B.last === '2026-10-20', B.last);

await p.evaluate(() => { window.App.go('tasks'); });
await wait(500);
const B2 = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-task-row')];
  const hit = rows.find(r => /高数第三章习题/.test(r.innerText));
  return hit ? hit.innerText : '';
});
check('任务行上直接显示「已投入」', /已投入 1 小时 30 分/.test(B2), B2.slice(0, 120));

await p.locator('.cp-task-row', { hasText: '高数第三章习题' }).first().click();
await wait(600);
const B3 = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  const rows = [...m.querySelectorAll('.cp-task-invest-row')].map(r => r.innerText.replace(/\s+/g, ' '));
  return { open: !!m, has: /已投入/.test(m.innerText), hasPomo: /1 个番茄/.test(m.innerText), rows };
});
check('编辑弹窗里有「已投入」区块', B3.open && B3.has, B3.has);
check('显示番茄数', B3.hasPomo, B3);
check('列出最近的记录', B3.rows.length === 1 && /09:00–10:30/.test(B3.rows[0]), B3.rows);

// 点一条记录 → 跳到象限页那一天
await p.locator('.cp-task-invest-row').first().click();
await wait(600);
const B4 = await p.evaluate(() => ({
  view: window.App.currentId,
  pane: (document.querySelector('#view-tasks .cp-pane-tab.cp-active') || {}).textContent,
  label: (document.querySelector('#view-tasks .cp-week-label span') || {}).textContent
}));
check('点记录跳到象限页', B4.view === 'tasks' && /象限/.test(B4.pane || '') && B4.label === '10 月 20 日', B4);
await clearModals();

// 手动关联：象限里记一段活动，挂到这条待办上
const B5 = await p.evaluate(() => {
  const t = Store.tasks.find(x => x.title === '高数第三章习题');
  Store.addActivity({ date: '2026-10-21', start: '14:00', end: '16:00', name: '刷题', type: 'study', taskId: t.id });
  const inv = Store.taskInvest(t.id);
  return { minutes: inv.minutes, count: inv.count };
});
check('手动关联的记录也计入', B5.minutes === 210 && B5.count === 2, B5);

/* ==========================================================
 * C. 月历时间块
 * ========================================================== */
console.log('C. 月历时间块');
await p.evaluate(() => {
  // 只读层：睡眠 + 一条手动记的活动（时间块只管「补录」这一层）
  const day = '2026-10-21';
  Store.addSleep({ date: day, start: '23:00', end: '07:00' });
  Store.addActivity({ date: day, start: '10:00', end: '11:00', name: '手动记的自习', type: 'study' });
  App.go('calendar');
});
await wait(700);
const C0 = await p.evaluate(() => ({
  cells: document.querySelectorAll('.cp-tb-cell').length,
  painted: document.querySelectorAll('.cp-tb-cell.cp-has').length
}));
check('时间带是 48 个半小时格', C0.cells === 48, C0.cells);
check('已有的记录会画出来（睡眠 + 手动活动，只读）', C0.painted >= 4, C0.painted);

// 涂半小时（挑一个空格子：18:00）
await p.locator('.cp-tb-cell').nth(36).click();
await wait(400);
await p.locator('.cp-tb-type', { hasText: '学习' }).click();
await wait(600);
const C1 = await p.evaluate(() => ({
  blocks: Store.activitiesOf('2026-10-21').filter(a => a.from === 'block').map(a => a.start + '-' + a.end + ':' + a.type),
  info: (document.querySelector('.cp-tb-info') || {}).textContent
}));
check('涂一格 = 生成半小时的活动记录', C1.blocks.length === 1 && C1.blocks[0] === '18:00-18:30:study', C1.blocks);
check('提示行更新', /时间块已记 30 分钟/.test(C1.info || ''), C1.info);

// 再涂 2 小时（从 19:00 起；B 段的 14:00–16:00 已被手动记录占着，正好验证「不冲掉」）
await p.locator('.cp-tb-cell').nth(38).click();
await wait(400);
await p.locator('.cp-modal .cp-segment button', { hasText: '2 小时' }).click();
await wait(250);
await p.locator('.cp-tb-type', { hasText: '运动' }).click();
await wait(600);
const C2 = await p.evaluate(() => Store.activitiesOf('2026-10-21').filter(a => a.from === 'block').map(a => a.start + '-' + a.end + ':' + a.type));
check('多格自动合并成一条记录', C2.some(x => x === '19:00-21:00:exercise'), C2);

// 象限/统计口径能看到时间块
const C3 = await p.evaluate(() => Store.dayStat('2026-10-21').segments.find(s => s.key === 'activity'));
check('时间块进入当日统计', C3 && C3.minutes >= 210, C3);

// 清除一段
await p.locator('.cp-tb-cell').nth(36).click();
await wait(400);
await p.locator('.cp-modal-foot button', { hasText: '清除这段' }).click();
await wait(600);
const C4 = await p.evaluate(() => Store.activitiesOf('2026-10-21').filter(a => a.from === 'block').map(a => a.start + '-' + a.end));
check('清除后只剩另一段', C4.length === 1 && C4[0] === '19:00-21:00', C4);

// 手动记录不被时间块冲掉
const C5 = await p.evaluate(() => {
  Store.addActivity({ date: '2026-10-21', start: '18:00', end: '19:00', name: '手动记的跑步', type: 'exercise' });
  App.go('calendar');
  return true;
});
await wait(700);
await p.locator('.cp-tb-cell').nth(44).click();     // 22:00
await wait(400);
await p.locator('.cp-tb-type', { hasText: '学习' }).click();
await wait(600);
const C6 = await p.evaluate(() => {
  const acts = Store.activitiesOf('2026-10-21');
  return {
    manual: acts.some(a => a.name === '手动记的跑步'),
    blocks: acts.filter(a => a.from === 'block').length
  };
});
check('补录不会冲掉手动记的活动', C6.manual === true && C6.blocks >= 2, C6);

// 清空这天的时间块
await p.locator('.cp-tb-acts button', { hasText: '清空这天的时间块' }).click();
await wait(400);
await p.locator('.cp-modal-foot button', { hasText: '清空' }).click();
await wait(600);
const C7 = await p.evaluate(() => {
  const acts = Store.activitiesOf('2026-10-21');
  return { blocks: acts.filter(a => a.from === 'block').length, manual: acts.some(a => a.name === '手动记的跑步') };
});
check('清空只动时间块那一层', C7.blocks === 0 && C7.manual === true, C7);

/* ==========================================================
 * D. 统计「今年」档
 * ========================================================== */
console.log('D. 统计今年档');
await p.evaluate(() => {
  for (let i = 1; i <= 3; i++) {
    Store.addActivity({ date: '2026-0' + i + '-15', start: '09:00', end: '11:00', name: '学习', type: 'study' });
  }
  window.App.go('tasks', { tab: 'stats' });
});
await wait(700);
await p.locator('.cp-dim-tab', { hasText: '今年' }).click();
await wait(900);
const D = await p.evaluate(() => ({
  active: (document.querySelector('#view-tasks .cp-dim-tab.cp-active') || {}).textContent,
  title: [...document.querySelectorAll('.cp-section-title')].map(n => n.textContent).find(t => /每月|每周|每天/.test(t)) || '',
  cells: document.querySelectorAll('.cp-heat-week').length,
  note: [...document.querySelectorAll('.cp-stats-note-inline')].map(n => n.textContent).join(' ')
}));
check('统计页多出「今年」档', D.active === '今年', D.active);
check('半年以上的热力条改按月分组', /每月/.test(D.title) && D.cells <= 12 && D.cells >= 9, D);
check('说明文案跟着换成按月口径', /一格一个月/.test(D.note), D.note.slice(0, 60));

/* ==========================================================
 * 收尾
 * ========================================================== */
const realErrors = errors.filter(e => !/favicon/.test(e));
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
