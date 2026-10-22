import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8151/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: ' + m.text().slice(0,110)); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => { const e=document.querySelector('.ob-skip')||[...document.querySelectorAll('button,div,span,a')].find(x=>x.textContent.trim()==='跳过'); if(e)e.click(); });
await p.waitForTimeout(500);

const out = {};
// 造数据
await p.evaluate(() => {
  const S = window.Store; const st = JSON.parse(S.exportJSON());
  st.courses = Array.from({length:8},(_,i)=>({id:'c'+i,name:'课程'+i,day:i%5,start:1,span:2,weeks:[1,16]}));
  st.tasks = Array.from({length:12},(_,i)=>({id:'t'+i,title:'任务'+i,done:false}));
  S.importJSON(JSON.stringify(st)); S.emit();
});
await p.waitForTimeout(400);

// 1) 手动备份
out.afterManual = await p.evaluate(async () => {
  const m = await window.Store.backupNow('测试');
  const list = await window.Store.listBackups();
  return { meta: m ? {ts:m.ts, courses:m.courses, tasks:m.tasks, reason:m.reason} : null, count: list.length };
});

// 2) 清空数据 -> 应自动备份，且能恢复
await p.evaluate(() => {
  const S = window.Store;
  S.backupNow('清空数据前').then(()=>{ S.reset(); });
});
await p.waitForTimeout(700);
out.afterReset = await p.evaluate(() => {
  const j = JSON.parse(window.Store.exportJSON());
  return { courses: (j.courses||[]).length, tasks: (j.tasks||[]).length };
});
out.backupCountAfterReset = await p.evaluate(() => window.Store.listBackups().then(l=>l.length));

// 3) 恢复最新备份
out.afterRestore = await p.evaluate(async () => {
  const list = await window.Store.listBackups();
  const latest = list[0];
  await window.Store.restoreBackup(latest.key);
  const j = JSON.parse(window.Store.exportJSON());
  return { restoredCourses: (j.courses||[]).length, restoredTasks: (j.tasks||[]).length, latestReason: latest.reason };
});

// 4) 备份上限裁剪：连建 8 份，应只留 5
out.trim = await p.evaluate(async () => {
  const S = window.Store;
  for (let i=0;i<8;i++) await S.backupNow('压力'+i);
  const list = await S.listBackups();
  return { count: list.length, max: S.BK_MAX };
});

// 5) 删除单份
out.delete = await p.evaluate(async () => {
  const S = window.Store;
  const before = (await S.listBackups()).length;
  const list = await S.listBackups();
  await S.deleteBackup(list[0].key);
  const after = (await S.listBackups()).length;
  return { before, after };
});

// 6) 空数据不产生备份
out.emptyNoBackup = await p.evaluate(async () => {
  const S = window.Store;
  S.reset();
  const before = (await S.listBackups()).length;
  await S.backupNow('空');
  const after = (await S.listBackups()).length;
  return { before, after, unchanged: before === after };
});

/* ---------- 7) 导出 → 导入往返：商城/摸鱼券/日记/保底一项都不能丢 ----------
 * 背景：importJSON 曾漏掉 shop 字段，恢复后月卡、摸鱼券、定向券、成长值全部归零，
 * 且 ensure 在缺失 shop 时直接抛 TypeError。这里逐字段断言。 */
out.roundTrip = await p.evaluate(() => {
  const S = window.Store;
  S.state.tasks = Array.from({ length: 5 }, (_, i) => ({ id: 't' + i, title: '任务' + i, done: false }));
  S.state.diaries = [{ id: 'd1', date: '2026-10-21', body: '日记正文' }];
  S.state.shop.tickets = { selection: 2, fish: 3 };
  S.state.shop.growth = 7;
  S.state.shop.validDays = { '2026-10-20': 3, '2026-10-21': 2 };
  S.state.shop.streak = { weekEnd: '2026-10-25', monthEnd: '2026-10-31' };
  S.ensure();   // reset() 不跑迁移：先把 gacha.pools 等派生结构补齐再改数
  S.state.pomodoro.gacha.pools.standard.pity6 = 88;
  S.importJSON(S.exportJSON());
  const j = JSON.parse(S.exportJSON());
  const checks = {
    tasks: j.tasks.length === 5,
    diaries: j.diaries.length === 1 && j.diaries[0].body === '日记正文',
    fish: j.shop.tickets.fish === 3,
    selection: j.shop.tickets.selection === 2,
    growth: j.shop.growth === 7,
    validDays: j.shop.validDays['2026-10-20'] === 3,
    streak: j.shop.streak.weekEnd === '2026-10-25',
    pity6: j.pomodoro.gacha.pools.standard.pity6 === 88
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
});

/* ---------- 8) 旧备份（没有 shop）也能导入：shop 落到默认值而不是崩溃 ---------- */
out.oldBackupNoShop = await p.evaluate(() => {
  const S = window.Store;
  const obj = JSON.parse(S.exportJSON());
  delete obj.shop;
  let err = '';
  try { S.importJSON(JSON.stringify(obj)); } catch (e) { err = e.message; }
  const shop = S.state.shop || {};
  return {
    err,
    hasShop: !!S.state.shop,
    ticketsOk: typeof shop.tickets === 'object' && shop.tickets.fish === 0,
    pass: !err && !!S.state.shop && typeof shop.tickets === 'object'
  };
});

/* ---------- 9) ensure 的容错：state.shop 缺失时兜底而不是抛错 ---------- */
out.ensureTolerant = await p.evaluate(() => {
  const S = window.Store;
  S.state.shop = undefined;
  let err = '';
  try { S.ensure(); } catch (e) { err = e.message; }
  const ok = !!S.state.shop && typeof S.state.shop.tickets === 'object';
  return { err, ok, pass: !err && ok };
});

/* ---------- 10) 坏输入必须整体回滚：原状态一个字段都不能少 ---------- */
out.badInputRollback = await p.evaluate(() => {
  const S = window.Store;
  S.state.tasks = Array.from({ length: 4 }, (_, i) => ({ id: 't' + i, title: 'T' + i, done: false }));
  S.state.shop.tickets.fish = 5;
  const before = JSON.stringify({ tasks: 4, fish: 5 });
  let err = '';
  try { S.importJSON('{ 这不是 JSON'); } catch (e) { err = e.message; }
  const after = JSON.stringify({ tasks: S.state.tasks.length, fish: S.state.shop.tickets.fish });
  return { err, before, after, pass: !!err && before === after };
});

/* ---------- 11) 汇总判定 ---------- */
const groups = ['afterManual', 'afterReset', 'afterRestore', 'trim', 'delete', 'emptyNoBackup',
  'roundTrip', 'oldBackupNoShop', 'ensureTolerant', 'badInputRollback'];
let allPass = true;
for (const g of groups) {
  const v = out[g];
  const pass = v && (v.pass === true || (v.pass === undefined));
  console.log((pass ? '  ✓ ' : '  ✗ ') + g + (v && v.pass === false ? '  ' + JSON.stringify(v) : ''));
  if (!pass) allPass = false;
}
console.log(allPass ? 'ALL PASS' : 'FAILED');

console.log(JSON.stringify({ out, errors: errs.slice(0, 6) }, null, 2));
await b.close();
process.exit(allPass ? 0 : 1);
