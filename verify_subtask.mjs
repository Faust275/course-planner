// Playwright 端到端：子任务 / 清单分组
// 覆盖：只一层、展开折叠、进度徽章、四条设置项的正反向、删除时子任务去向、
//       「今日」与导航角标只算父任务、设置页开关与互斥提示、新手提示只弹一次
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8192/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { const e = document.querySelector('.ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

/* ==========================================================
 * A. 数据层：store 的行为
 * ========================================================== */
const A = await p.evaluate(() => {
  const S = window.Store;
  const D = window.DateUtil;
  const today = D.toStr(D.today());
  const out = {};

  // 干净的起点
  S.state.tasks = [];

  const parent = S.addTask({ title: '期末复习', dueDate: today, status: 'todo' });
  const c1 = S.addTask({ title: '高数第三章', parentId: parent.id, status: 'todo' });
  const c2 = S.addTask({ title: '英语单词', parentId: parent.id, status: 'todo' });

  // 1) parentId 落库
  out.childHasParent = S.getTask(c1.id).parentId === parent.id;

  // 2) 只允许一层：给子任务再挂父任务应被拒
  const g = S.addTask({ title: '孙任务', parentId: c1.id, status: 'todo' });
  out.grandchildRejected = !S.getTask(g.id).parentId;

  // 3) 父任务不能挂到子任务下面
  S.updateTask(parent.id, { parentId: c1.id });
  out.parentCantNest = !S.getTask(parent.id).parentId;

  // 4) 进度 0/2
  out.prog0 = S.subtaskProgress(parent.id);

  // 5) 默认设置下：子任务全完成，父任务不自动完成
  S.cycleTask(c1.id); S.cycleTask(c1.id);   // todo -> doing -> done
  S.cycleTask(c2.id); S.cycleTask(c2.id);
  out.parentAfterAllDone = S.getTask(parent.id).status;

  // 6) 默认设置下：勾父任务，子任务不被连带（子任务此时已全完成，先重置一个）
  S.updateTask(c2.id, { status: 'todo' });
  S.updateTask(parent.id, { status: 'done' });
  out.childAfterParentDone = S.getTask(c2.id).status;

  // 7) 打开「自动完成父任务」：子任务全完成 -> 父任务自动完成
  S.state.settings.subtask = Object.assign({}, S.subtaskOpts(), { autoDoneParent: true });
  S.updateTask(parent.id, { status: 'todo' });
  S.updateTask(c2.id, { status: 'done' });
  out.autoDoneParent = S.getTask(parent.id).status;

  // 8) 打开「一并完成子任务」：勾父任务 -> 子任务全勾上
  S.updateTask(parent.id, { status: 'todo' });
  S.updateTask(c1.id, { status: 'todo' });
  S.state.settings.subtask = Object.assign({}, S.subtaskOpts(), { autoDoneParent: false, cascadeDone: true });
  S.updateTask(parent.id, { status: 'done' });
  out.cascadeDone = S.getTask(c1.id).status;

  // 9) 删除父任务：orphanKeep=true -> 子任务保留并提升为顶层
  S.state.settings.subtask = Object.assign({}, S.subtaskOpts(), { cascadeDone: false, orphanKeep: true });
  const before = S.subtasksOf(parent.id).length;
  const r1 = S.removeTask(parent.id);
  out.orphanBefore = before;
  out.orphanKept = r1.kept;
  out.orphanStillThere = !!S.getTask(c1.id) && !S.getTask(c1.id).parentId;

  // 10) 删除父任务：orphanKeep=false -> 连子任务一起删
  const p2 = S.addTask({ title: '搬家', status: 'todo' });
  const d1 = S.addTask({ title: '订车', parentId: p2.id, status: 'todo' });
  const d2 = S.addTask({ title: '打包', parentId: p2.id, status: 'todo' });
  S.state.settings.subtask = Object.assign({}, S.subtaskOpts(), { orphanKeep: false });
  const r2 = S.removeTask(p2.id);
  out.cascadeRemoved = r2.removed;
  out.cascadeGone = !S.getTask(d1.id) && !S.getTask(d2.id);

  // 11) 恢复默认
  S.state.settings.subtask = Object.assign({}, window.SUBTASK_DEFAULTS);

  // 12) 「今日」与角标只算顶层任务
  S.state.tasks = [];
  const tp = S.addTask({ title: '写报告', dueDate: today, status: 'todo' });
  S.addTask({ title: '查资料', parentId: tp.id, dueDate: today, status: 'todo' });
  S.addTask({ title: '写初稿', parentId: tp.id, dueDate: today, status: 'todo' });
  out.todayTasks = S.todayTasks().filter(t => !t.parentId).length;
  out.rootPending = S.rootPending().length;
  out.allPending = S.tasks.filter(t => t.status !== 'done').length;

  // 13) 旧备份恢复后 subtask 字段被补齐
  const json = S.exportJSON();
  const obj = JSON.parse(json);
  delete obj.settings.subtask;
  S.importJSON(JSON.stringify(obj));
  out.subtaskAfterImport = S.subtaskOpts();

  return out;
});

/* ==========================================================
 * B. UI：列表、徽章、展开、设置页
 * ========================================================== */
// 造一组稳定的数据
await p.evaluate(() => {
  const S = window.Store;
  S.state.tasks = [];
  S.state.settings.subtask = Object.assign({}, window.SUBTASK_DEFAULTS);
  const pa = S.addTask({ title: '期末复习', status: 'todo' });
  S.addTask({ title: '高数第三章', parentId: pa.id, status: 'done' });
  S.addTask({ title: '英语单词', parentId: pa.id, status: 'todo' });
  S.addTask({ title: '专业课背诵', parentId: pa.id, status: 'todo' });
  S.addTask({ title: '一个没有子任务的待办', status: 'todo' });
  S.emit();
});
await p.evaluate(() => window.App.go('tasks'));
await p.waitForTimeout(500);

const B = await p.evaluate(() => {
  const rows = () => [...document.querySelectorAll('.cp-task-row')];
  const out = {};
  const parentRow = rows().find(r => /期末复习/.test(r.textContent));

  // 默认折叠：列表里看不到子任务标题
  out.collapsedByDefault = !rows().some(r => /高数第三章/.test(r.textContent));
  // 子任务行不占顶层列表位置：只有 2 个顶层行
  out.rootRowCount = rows().length;
  // 进度徽章 1/3
  out.badge = parentRow ? (parentRow.querySelector('.cp-subtask-prog') || {}).textContent : null;
  // 有箭头
  out.hasToggle = !!(parentRow && parentRow.querySelector('.cp-subtask-toggle'));

  return out;
});

// 点箭头展开
await p.evaluate(() => {
  const r = [...document.querySelectorAll('.cp-task-row')].find(x => /期末复习/.test(x.textContent));
  r.querySelector('.cp-subtask-toggle').click();
});
await p.waitForTimeout(400);

const C = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-task-row')];
  return {
    expandedShowsKids: rows.some(r => /高数第三章/.test(r.textContent)),
    kidCount: rows.filter(r => r.classList.contains('cp-is-child')).length,
    hasAddBtn: !!document.querySelector('.cp-subtask-add')
  };
});

// 关闭进度徽章后应消失
await p.evaluate(() => {
  window.Store.updateSettings({ subtask: Object.assign({}, window.Store.subtaskOpts(), { showProgress: false }) });
});
await p.waitForTimeout(300);
const D = await p.evaluate(() => ({
  badgeGone: !document.querySelector('.cp-subtask-prog')
}));
await p.evaluate(() => {
  window.Store.updateSettings({ subtask: Object.assign({}, window.Store.subtaskOpts(), { showProgress: true }) });
});

// 设置页：子任务分区（先切到设置页，再从卡片点进去）
await p.evaluate(() => window.App.go('settings'));
await p.waitForTimeout(400);
await p.evaluate(() => {
  const item = [...document.querySelectorAll('.cp-set-item')].find(x => /子任务/.test(x.textContent));
  if (item) item.click();
});
await p.waitForTimeout(500);

const E = await p.evaluate(() => {
  const txt = document.body.textContent;
  return {
    pageOpened: /子任务怎么用/.test(txt),
    fourRows: document.querySelectorAll('.cp-subtask-state').length,
    hasSwitches: document.querySelectorAll('#view-settings .cp-switch').length,
    noWarnByDefault: !document.querySelector('.cp-subtask-warn'),
    hasReset: /恢复默认/.test(txt)
  };
});

// 打开两项冲突组合，应出现警告
await p.evaluate(() => {
  window.Store.updateSettings({ subtask: Object.assign({}, window.Store.subtaskOpts(),
    { autoDoneParent: true, cascadeDone: true }) });
  const item = [...document.querySelectorAll('.cp-set-item')].find(x => /子任务/.test(x.textContent));
  if (item) { item.click(); } else { window.SettingsView.go('subtask'); }
});
await p.waitForTimeout(400);
const F = await p.evaluate(() => ({
  warnShown: !!document.querySelector('.cp-subtask-warn'),
  warnMentionsLoop: /整组就会全绿/.test(document.body.textContent)
}));

// 恢复默认按钮
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('#view-settings button')].find(x => /恢复默认/.test(x.textContent));
  if (btn) btn.click();
});
await p.waitForTimeout(400);
const G = await p.evaluate(() => {
  const o = window.Store.subtaskOpts();
  return { resetOk: !o.autoDoneParent && !o.cascadeDone && o.orphanKeep && o.showProgress };
});

/* ==========================================================
 * H. 新手提示：第一次加子任务时弹一次，第二次不再弹
 * ========================================================== */
const H = await p.evaluate(async () => {
  const S = window.Store;
  S.updateSettings({ subtaskHinted: false });
  window.TaskDialog.hintIfFirstSubtask();
  await new Promise(r => setTimeout(r, 500));
  const first = !!document.querySelector('#modalRoot .cp-modal');
  const text = first ? document.querySelector('#modalRoot .cp-modal').textContent : '';
  // 关掉
  const ok = [...document.querySelectorAll('#modalRoot button')].find(b => /知道了/.test(b.textContent));
  if (ok) ok.click();
  await new Promise(r => setTimeout(r, 400));

  window.TaskDialog.hintIfFirstSubtask();
  await new Promise(r => setTimeout(r, 500));
  const second = !!document.querySelector('#modalRoot .cp-modal');
  if (second) {
    const k = [...document.querySelectorAll('#modalRoot button')].find(b => /知道了/.test(b.textContent));
    if (k) k.click();
  }
  return {
    firstShown: first,
    explainsFold: /折叠/.test(text),
    explainsOneLevel: /只支持一层/.test(text),
    explainsDefault: /不会自动完成/.test(text),
    secondHidden: !second
  };
});

/* ==========================================================
 * I. 导航角标只算顶层任务
 * ========================================================== */
const I = await p.evaluate(() => {
  const S = window.Store;
  S.state.tasks = [];
  const pa = S.addTask({ title: '写论文', status: 'todo' });
  S.addTask({ title: '查文献', parentId: pa.id, status: 'todo' });
  S.addTask({ title: '写提纲', parentId: pa.id, status: 'todo' });
  S.emit();
  return { rootPending: S.rootPending().length, totalPending: S.tasks.filter(t => t.status !== 'done').length };
});

// 截图留档
await p.evaluate(() => {
  const S = window.Store;
  S.state.tasks = [];
  S.state.settings.subtask = Object.assign({}, window.SUBTASK_DEFAULTS);
  const pa = S.addTask({ title: '期末复习', note: '第 18 周考试', priority: 'high', status: 'doing' });
  S.addTask({ title: '高数第三章习题', parentId: pa.id, status: 'done' });
  S.addTask({ title: '英语作文模板', parentId: pa.id, status: 'done' });
  S.addTask({ title: '专业课背诵第 5 章', parentId: pa.id, status: 'todo' });
  S.addTask({ title: '整理课堂笔记', parentId: pa.id, status: 'todo' });
  const pb = S.addTask({ title: '交实验报告', status: 'todo' });
  S.addTask({ title: '补数据', parentId: pb.id, status: 'todo' });
  S.addTask({ title: '画图表', parentId: pb.id, status: 'todo' });
  S.addTask({ title: '取快递', status: 'todo' });
  S.emit();
  window.App.go('tasks');
});
await p.waitForTimeout(600);
await p.evaluate(() => {
  const r = [...document.querySelectorAll('.cp-task-row')].find(x => /期末复习/.test(x.textContent));
  if (r) r.querySelector('.cp-subtask-toggle').click();
});
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/subtask-list.png', fullPage: false });

await p.evaluate(() => {
  const item = [...document.querySelectorAll('.cp-set-item')].find(x => /子任务/.test(x.textContent));
  if (item) item.click();
});
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/subtask-settings.png', fullPage: false });

const checks = [
  ['parentId 落库', A.childHasParent],
  ['拒绝第三层（孙任务）', A.grandchildRejected],
  ['父任务不能挂到子任务下', A.parentCantNest],
  ['进度 0/2', A.prog0.total === 2 && A.prog0.done === 0 && A.prog0.pct === 0],
  ['默认：子任务全完成，父任务不自动完成', A.parentAfterAllDone === 'todo'],
  ['默认：勾父任务不连带子任务', A.childAfterParentDone === 'todo'],
  ['开启后：自动完成父任务', A.autoDoneParent === 'done'],
  ['开启后：父任务完成连带子任务', A.cascadeDone === 'done'],
  ['删除父任务：子任务保留', A.orphanBefore === 2 && A.orphanKept === 2],
  ['删除父任务：子任务提升为顶层', A.orphanStillThere === true],
  ['关闭后：子任务一起删', A.cascadeRemoved === 3 && A.cascadeGone === true],
  ['「今日」只算父任务', A.todayTasks === 1],
  ['pending 只数顶层', A.rootPending === 1 && A.allPending === 3],
  ['旧备份补齐 subtask 字段', A.subtaskAfterImport && A.subtaskAfterImport.orphanKeep === true],

  ['列表默认折叠，看不到子任务', B.collapsedByDefault === true],
  ['列表只渲染 2 个顶层行', B.rootRowCount === 2],
  ['父任务有 1/3 进度徽章', B.badge === '1/3'],
  ['父任务有展开箭头', B.hasToggle === true],

  ['点箭头后子任务可见', C.expandedShowsKids === true],
  ['子任务共 3 行', C.kidCount === 3],
  ['展开后有「添加子任务」', C.hasAddBtn === true],

  ['关闭后进度徽章消失', D.badgeGone === true],

  ['设置页打不开子任务分区', E.pageOpened === true],
  ['四行开关都有「当前：」说明', E.fourRows === 4],
  ['默认状态下不报警告', E.noWarnByDefault === true],
  ['有「恢复默认」按钮', E.hasReset === true],

  ['互斥组合出现警告', F.warnShown === true],
  ['警告说明闭环（整组全绿）', F.warnMentionsLoop === true],
  ['恢复默认确实生效', G.resetOk === true],

  ['首次加子任务弹说明', H.firstShown === true],
  ['说明讲了默认折叠', H.explainsFold === true],
  ['说明讲了只一层', H.explainsOneLevel === true],
  ['说明讲了父任务不自动完成', H.explainsDefault === true],
  ['第二次不再弹', H.secondHidden === true],

  ['导航角标只算顶层', I.rootPending === 1 && I.totalPending === 3],

  ['无控制台错误', errors.length === 0]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name);
  if (!pass) ok = false;
}
if (!ok) {
  console.log('\n详情 A:', JSON.stringify(A, null, 1));
  console.log('详情 B:', JSON.stringify(B), '\nC:', JSON.stringify(C), '\nD:', JSON.stringify(D));
  console.log('详情 E:', JSON.stringify(E), '\nF:', JSON.stringify(F), '\nG:', JSON.stringify(G));
  console.log('详情 H:', JSON.stringify(H), '\nI:', JSON.stringify(I));
  if (errors.length) console.log('错误:', errors.slice(0, 5));
}
console.log(`\n${checks.filter(c => c[1]).length} / ${checks.length} 通过`);
await b.close();
process.exit(ok ? 0 : 1);
