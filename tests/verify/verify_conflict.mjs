// 端到端验证：课表时间冲突检测（提示卡 / 批量导入预览标红 / 单双周与周次错开不算）
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8162/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 120)); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => {
  const e = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find(x => x.textContent.trim() === '跳过');
  if (e) e.click();
});
await p.waitForTimeout(500);

const out = {};

// 造数据的工具
const setCourses = (list) => p.evaluate((list) => {
  const j = JSON.parse(window.Store.exportJSON());
  j.courses = list;
  window.Store.importJSON(JSON.stringify(j));
  window.Store.emit();
}, list);

const mk = (id, name, day, periodId, extra) => Object.assign({
  id, name, teacher: '', location: '', color: '#3b82f6', day,
  timeMode: 'period', periodId, semesterId: null, credit: 0, exam: null,
  startWeek: 1, endWeek: 16, weekType: 'all', note: '',
  slots: [{ day, timeMode: 'period', periodId, startTime: '', endTime: '', location: '' }]
}, extra || {});

const card = () => p.evaluate(() => {
  const c = document.querySelector('.cp-conflict-card');
  if (!c) return null;
  return {
    text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
    rows: [...c.querySelectorAll('.cp-conflict-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim())
  };
});

// 1) 同一天同一节 → 应报冲突
await setCourses([
  mk('c1', '高等数学', 1, 'p1'),
  mk('c2', '大学英语', 1, 'p1')
]);
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(600);
out.sameSlot = await card();
out.conflictsFn = await p.evaluate(() => window.App.views.find(v => v.id === 'schedule').conflicts()
  .map(g => ({ day: g.day, periodId: g.periodId, names: g.names, week: g.week })));

// 2) 同一天不同节 → 不该报
await setCourses([mk('c1', '高等数学', 1, 'p1'), mk('c2', '大学英语', 1, 'p3')]);
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(500);
out.diffPeriod = await card();

// 3) 周次错开 → 不该报
await setCourses([
  mk('c1', '高等数学', 1, 'p1', { startWeek: 1, endWeek: 8, slots: [{ day: 1, timeMode: 'period', periodId: 'p1', startTime: '', endTime: '', location: '' }] }),
  mk('c2', '大学英语', 1, 'p1', { startWeek: 9, endWeek: 16, slots: [{ day: 1, timeMode: 'period', periodId: 'p1', startTime: '', endTime: '', location: '' }] })
]);
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(500);
out.weeksApart = await card();

// 4) 单双周错开 → 不该报
await setCourses([
  mk('c1', '高等数学', 1, 'p1', { weekType: 'odd' }),
  mk('c2', '大学英语', 1, 'p1', { weekType: 'even' })
]);
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(500);
out.oddEven = await card();

// 5) 点击冲突行 → 打开课程详情弹窗
await setCourses([mk('c1', '高等数学', 1, 'p1'), mk('c2', '大学英语', 1, 'p1')]);
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(600);
await p.evaluate(() => {
  const r = document.querySelector('.cp-conflict-card .cp-conflict-row');
  r && r.click();
});
await p.waitForTimeout(700);
out.openedDialog = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal.cp-show');
  return m ? m.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null;
});
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// 6) 批量导入预览：撞已排课程的行要标出来
await setCourses([mk('c1', '高等数学', 1, 'p1')]);
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(500);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '批量导入');
  btn && btn.click();
});
await p.waitForTimeout(400);
await p.fill('.cp-textarea', '课程名\t星期\t节次\n大学英语\t周一\t1-2节\n体育\t周五\t7-8节');
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '解析并预览');
  btn && btn.click();
});
await p.waitForTimeout(500);
out.batchPreview = await p.evaluate(() => {
  const h = document.querySelector('#cpBatchPreview');
  return {
    title: h ? (h.querySelector('.cp-section-title') || {}).textContent : null,
    warns: h ? [...h.querySelectorAll('.cp-batch-warn')].map(w => w.textContent.trim()) : []
  };
});
await p.keyboard.press('Escape');

out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await b.close();
process.exit(errs.length ? 1 : 0);
