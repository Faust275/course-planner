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

console.log(JSON.stringify({ out, errors: errs.slice(0,6) }, null, 2));
await b.close();
