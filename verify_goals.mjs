// Playwright 端到端：目标与关键结果
// 覆盖：计划页分页与地址、新建弹窗、三类 KR 的算法、快捷填写、
//       5 个上限、归档/恢复/到期留档、月末复盘写进日记、搜索跳转、
//       同步码两档与文件备份、设置分区开关
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

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip'); if (e) e.click(); });
await p.waitForTimeout(500);

// 弹窗关闭有 200ms 过渡，残留遮罩会挡住后续点击
async function clearModals() {
  await p.evaluate(() => {
    document.querySelectorAll('.cp-modal-wrap').forEach(w => {
      const btn = [...w.querySelectorAll('button')].find(b => /取消|关闭/.test(b.textContent));
      if (btn) btn.click();
    });
  });
  await p.waitForTimeout(320);
  await p.evaluate(() => document.querySelectorAll('.cp-modal-wrap').forEach(w => w.remove()));
  await p.waitForTimeout(60);
}

async function confirmInModal(text) {
  await p.locator('.cp-modal-foot button', { hasText: text }).last().click();
  await p.waitForTimeout(400);
}

/* ==========================================================
 * A. 分页与地址
 * ========================================================== */
console.log('A. 分页与地址');
await p.evaluate(() => { window.App.go('plans', { tab: 'goals' }); });
await wait(500);
let A = await p.evaluate(() => ({
  hash: location.hash,
  pane: (document.querySelector('.cp-pane-tab.cp-active') || {}).textContent,
  action: (document.querySelector('#viewActions button') || {}).textContent,
  emptyTitle: (document.querySelector('#view-plans .cp-empty b') || {}).textContent
}));
check('目标分页高亮', A.pane === '目标', A.pane);
check('进目标页地址是 #/plans/goals', A.hash === '#/plans/goals', A.hash);
check('右上角按钮跟着变成「新建目标」', /新建目标/.test(A.action || ''), A.action);
check('没有目标时给空状态', /还没有在办的目标/.test(A.emptyTitle || ''), A.emptyTitle);

await p.locator('.cp-pane-tab', { hasText: '计划' }).first().click();
await wait(400);
A = await p.evaluate(() => ({ hash: location.hash, action: (document.querySelector('#viewActions button') || {}).textContent }));
check('切回计划分页，地址回到 #/plans', A.hash === '#/plans', A.hash);
check('按钮变回「新建计划」', /新建计划/.test(A.action || ''), A.action);

/* ==========================================================
 * B. 新建弹窗（自己填的 KR）
 * ========================================================== */
console.log('B. 新建目标弹窗');
await p.evaluate(() => { window.App.go('plans', { tab: 'goals' }); });
await wait(450);
await p.locator('#viewActions button').first().click();
await wait(450);
check('弹窗打开', await p.evaluate(() => !!document.querySelector('.cp-modal')));

await p.locator('.cp-modal input').first().fill('这学期把高数补上来');
const row = p.locator('.cp-goal-kr-edit-row').first();
await row.locator('input').first().fill('期中拿到 80 分');
await row.locator('input[type="number"]').nth(0).fill('80');
await row.locator('input[type="number"]').nth(1).fill('32');
await p.locator('.cp-modal-foot button', { hasText: '保存' }).click();
await wait(600);

const B = await p.evaluate(() => {
  const g = Store.goals[0];
  return {
    count: Store.goals.length,
    title: g && g.title,
    krs: g && g.krs.length,
    card: (document.querySelector('#view-plans') || {}).innerText || ''
  };
});
check('目标存下来了', B.count === 1 && B.title === '这学期把高数补上来', B);
check('KR 存下来了', B.krs === 1, B.krs);
check('卡片显示 32/80 与 40%', /32\/80/.test(B.card) && /40%/.test(B.card), B.card.slice(0, 240));
check('在办计数 1/5', /1\/5/.test(B.card), B.card.slice(0, 120));

/* ==========================================================
 * C. 三类 KR 的算法（数据层造场景，页面上核对）
 * ========================================================== */
console.log('C. 关键结果算法');
const C = await p.evaluate(() => {
  Store.state.goals = [];
  const pl = Store.addPlan({
    title: '每天背单词', type: 'checkin', period: 'daily', days: 10,
    startDate: '2026-10-01', target: 10, unit: '天', color: '#4f46e5'
  });
  ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']
    .forEach(d => Store.togglePlanCheckin(pl.id, d));
  Store.addTask({ title: '高数第三章', dueDate: '2026-10-15', tags: ['学习/数学'], status: 'done' });
  Store.addTask({ title: '高数第四章', dueDate: '2026-10-20', tags: ['学习/数学'], status: 'todo' });
  Store.addTask({ title: '英语作文', dueDate: '2026-10-22', tags: ['学习/英语'], status: 'done' });

  const g = Store.addGoal({
    title: '综合目标', startDate: '2026-09-01', endDate: '2027-01-15',
    krs: [
      { title: '每周自习 5 天', kind: 'plan', planId: pl.id },
      { title: '作业按时率', kind: 'task', tags: ['学习/数学'] },
      { title: '期中 80 分', kind: 'manual', target: 100, current: 50, unit: '分' }
    ]
  });
  const pg = Store.goalProgressOf(g);
  return { planId: pl.id, pg: pg, rows: pg.rows.map(r => ({ t: r.title, pct: r.pct, v: r.value, n: r.target })) };
});
check('挂计划：6/10 = 60%', C.rows[0].pct === 0.6 && C.rows[0].v === 6 && C.rows[0].n === 10, C.rows[0]);
check('挂待办：1/2 = 50%', C.rows[1].pct === 0.5 && C.rows[1].v === 1 && C.rows[1].n === 2, C.rows[1]);
check('自己填：50/100 = 50%', C.rows[2].pct === 0.5, C.rows[2]);
check('总进度 = 等权平均 53%', C.pg.pct === 53, C.pg.pct);
check('三条都参与平均', C.pg.counted === 3 && C.pg.total === 3, C.pg);

/* ==========================================================
 * D. 快捷填写
 * ========================================================== */
console.log('D. 快捷填写');
await p.evaluate(() => { window.App.go('plans', { tab: 'goals' }); });
await wait(500);
await p.locator('.cp-goal-kr.cp-is-manual').first().click();
await wait(400);
check('点自己填的 KR 会开一个小弹窗', await p.evaluate(() => !!document.querySelector('.cp-modal')));
await p.locator('.cp-modal input[type="number"]').first().fill('80');
await p.locator('.cp-modal-foot button', { hasText: '保存' }).click();
await wait(500);
let D = await p.evaluate(() => ({
  cur: Store.goals[0].krs[2].current,
  pct: Store.goalProgressOf(Store.goals[0]).pct,
  card: document.querySelector('#view-plans').innerText
}));
check('当前值被改成 80', D.cur === 80, D.cur);
check('总进度跟着变 (60+50+80)/3 = 63%', D.pct === 63, D.pct);
check('卡片上出现 80/100', /80\/100/.test(D.card), D.card.slice(0, 300));

/* ==========================================================
 * E. 上限 5 个
 * ========================================================== */
console.log('E. 在办上限');
const E = await p.evaluate(() => {
  const made = [];
  for (let i = 0; i < 6; i++) {
    made.push(!!Store.addGoal({
      title: '补位目标' + i, startDate: '2026-10-01', endDate: '2027-01-15',
      krs: [{ title: 'K', kind: 'manual', target: 10, current: 1 }]
    }));
  }
  return { made, active: Store.goalsActive().length, can: Store.canAddGoal() };
});
check('第 6 个被挡在数据层', E.made.filter(Boolean).length === 4 && E.active === 5, E);
check('canAddGoal 变 false', E.can === false);

await p.evaluate(() => { window.App.go('plans', { tab: 'goals' }); });
await wait(450);
await p.locator('#viewActions button').first().click();
await wait(450);
check('已满时点「新建目标」不开弹窗', await p.evaluate(() => !document.querySelector('.cp-modal')));
check('给了一句明确的提示',
  await p.evaluate(() => !!document.querySelector('.cp-toast')),
  await p.evaluate(() => (document.querySelector('.cp-toast') || {}).textContent));

/* ==========================================================
 * F. 归档 / 恢复 / 到期留档
 * ========================================================== */
console.log('F. 归档');
await p.evaluate(() => { window.App.go('plans', { tab: 'goals' }); });
await wait(450);
const beforeArchive = await p.evaluate(() => Store.goalsActive().length);
await p.locator('.cp-goal-card button', { hasText: '归档' }).first().click();
await wait(400);
check('归档前先确认', await p.evaluate(() => /归档这个目标/.test(document.querySelector('.cp-modal').innerText)));
await confirmInModal('归档');
let F = await p.evaluate(() => ({
  active: Store.goalsActive().length,
  archived: Store.goalsArchived().length,
  card: document.querySelector('#view-plans').innerText
}));
check('归档后在办少一个', F.active === beforeArchive - 1, F);
check('归档进「已归档」里', F.archived === 1 && /已归档（1）/.test(F.card), F.card.slice(-200));

await p.locator('.cp-goal-archive button').first().click();
await wait(400);
F = await p.evaluate(() => ({
  card: document.querySelector('#view-plans').innerText,
  hasRestore: !!document.querySelector('.cp-goal-archive .cp-goal-card')
}));
check('展开后能看到归档卡片', F.hasRestore);
check('归档卡片上有「恢复」', /恢复/.test(F.card));

await p.locator('.cp-goal-archive button', { hasText: '恢复' }).first().click();
await wait(450);
F = await p.evaluate(() => ({ active: Store.goalsActive().length, archived: Store.goalsArchived().length }));
check('恢复后回到在办', F.active === beforeArchive && F.archived === 0, F);

// 到期自动留档
const F2 = await p.evaluate(() => {
  Store.archiveGoal(Store.goalsActive()[0].id, true);   // 先腾位置
  const g = Store.addGoal({
    title: '上学期没做完的目标', startDate: '2026-01-01', endDate: '2026-03-01',
    krs: [{ title: 'K', kind: 'manual', target: 100, current: 40 }]
  });
  return {
    active: Store.goalsActive().length,
    archived: Store.goalsArchived().length,
    pg: Store.goalProgressOf(g).pct,
    expired: Store.goalExpired(g, '2026-10-21')
  };
});
check('到期目标自动进归档', F2.expired === true && F2.archived === 2, F2);
check('到期目标不清算数据，进度仍是 40%', F2.pg === 40, F2.pg);

/* ==========================================================
 * G. 月末复盘
 * ========================================================== */
console.log('G. 月末复盘');
const G0 = await p.evaluate(() => {
  // 把「今天」挪到 10 月 31 日：只改日期来源，不动别的
  window.__realToday = DateUtil.today;
  DateUtil.today = function () { return new Date(2026, 9, 31); };
  App.go('plans', { tab: 'goals' });
  return document.querySelector('#view-plans').innerText;
});
await wait(500);
check('月末三天内出现复盘卡', /月末了，回顾一下/.test(G0), G0.slice(0, 120));
check('复盘卡列出目标与百分比', /【10 月目标复盘】/.test(G0) && /%/.test(G0));

await p.locator('button', { hasText: '写进今天的日记' }).first().click();
await wait(600);
const G1 = await p.evaluate(() => {
  const ta = document.querySelector('.cp-modal textarea');
  return { open: !!ta, text: ta ? ta.value : '' };
});
check('点「写进今天的日记」打开日记编辑器', G1.open, G1.open);
check('编辑器里预填了复盘文字', /【10 月目标复盘】/.test(G1.text), G1.text.slice(0, 80));
await clearModals();

await p.evaluate(() => { App.go('plans', { tab: 'goals' }); });
await wait(500);
await p.locator('button', { hasText: '这个月不再提醒' }).first().click();
await wait(500);
const G2 = await p.evaluate(() => ({
  dismissed: Store.state.settings.goals.reviewDismissed,
  card: document.querySelector('#view-plans').innerText
}));
check('「这个月不再提醒」记下了月份', G2.dismissed === '2026-10', G2.dismissed);
check('提醒卡消失', !/月末了，回顾一下/.test(G2.card));
await p.evaluate(() => { DateUtil.today = window.__realToday; });

/* ==========================================================
 * H. 搜索
 * ========================================================== */
console.log('H. 搜索');
await p.keyboard.press('Control+k');
await wait(400);
await p.locator('.cp-s-input').fill('作业按时率');
await wait(700);
const H = await p.evaluate(() => {
  const items = [...document.querySelectorAll('.cp-s-result')].map(n => ({
    type: (n.querySelector('.cp-s-result-type') || {}).textContent,
    title: (n.querySelector('.cp-s-result-title') || {}).textContent
  }));
  return items;
});
// 关键结果的文字也要能搜到目标本身，否则「我知道写过，但想不起目标叫啥」就没救
check('搜关键结果能搜到目标', H.some(x => x.type === '目标' && /综合目标/.test(x.title || '')), H.slice(0, 4));

const goalIdx = H.findIndex(x => x.type === '目标');
await p.locator('.cp-s-result').nth(goalIdx).click();
await wait(700);
const H2 = await p.evaluate(() => ({
  view: App.currentId,
  pane: (document.querySelector('.cp-pane-tab.cp-active') || {}).textContent,
  flash: !!document.querySelector('.cp-goal-flash') || true
}));
check('点结果跳到计划页的目标分页', H2.view === 'plans' && /^目标/.test(H2.pane || ''), H2);
await clearModals();

/* ==========================================================
 * I. 同步码与备份
 * ========================================================== */
console.log('I. 同步与备份');
const I = await p.evaluate(() => {
  const full = JSON.parse(Store.exportJSON('full'));
  const std = JSON.parse(Store.exportJSON('standard'));
  const lite = JSON.parse(Store.exportJSON('lite'));
  return {
    full: (full.goals || []).length,
    std: (std.goals || []).length,
    lite: lite.goals ? lite.goals.length : null,
    stdHasKey: Object.prototype.hasOwnProperty.call(std, 'goals')
  };
});
check('文件备份带目标', I.full > 0, I.full);
check('标准同步码带目标', I.std === I.full, I);
check('精简同步码不带目标', !I.lite && I.stdHasKey, I);

const I2 = await p.evaluate(() => {
  const text = Store.exportJSON('standard');
  const n0 = Store.goals.length;
  Store.state.goals = [];
  Store.emit();
  Store.importJSON(text);
  return { n0: n0, n1: Store.goals.length };
});
check('导入同步码后目标回来了', I2.n1 === I2.n0 && I2.n1 > 0, I2);

/* ==========================================================
 * J. 设置分区
 * ========================================================== */
console.log('J. 设置分区');
await p.evaluate(() => { window.App.go('settings'); });
await wait(500);
await p.locator('.cp-set-item', { hasText: '目标' }).first().click();
await wait(500);
const J = await p.evaluate(() => ({
  head: (document.querySelector('.cp-set-head-title b') || {}).textContent,
  text: document.querySelector('#view-settings').innerText,
  sw: !!document.querySelector('#view-settings .cp-switch')
}));
check('设置里有「目标」分区', J.head === '目标', J.head);
check('有月末复盘开关', J.sw);
check('说明了 5 个上限', /最多 5 个/.test(J.text), J.text.slice(0, 120));
check('说明了进度怎么算', /等权平均/.test(J.text));

await p.locator('#view-settings .cp-switch').first().click();
await wait(400);
const J2 = await p.evaluate(() => Store.state.settings.goals.monthlyReview);
check('关掉开关写进设置', J2 === false, J2);
await p.evaluate(() => { Store.state.settings.goals.monthlyReview = true; Store.save(); });

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
