import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8201/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const skip = await page.$('text=跳过');
if (skip) { await skip.click(); await page.waitForTimeout(300); }

await page.evaluate(() => {
  const st = Store.state;
  st.sleeps.length = 0; st.meals.length = 0; st.activities.length = 0; st.goals.length = 0;
  st.pomodoro.pointLog.length = 0; st.pomodoro.points = 0; st.pomodoro.jade = 0;
  st.pomodoro.earned = 0; st.pomodoro.mode = 'forest';
});

const out = {};
out.sleepAward = await page.evaluate(() => {
  Store.addSleep({ date: '2024-05-01' }); Store.addSleep({ date: '2024-05-01' });
  return (Store.state.pomodoro.pointLog.reduce((m, r) => { m[r.src] = (m[r.src] || 0) + r.n; return m; }, {})).sleep || 0;          // 期望 4（同日只记一次）
});
out.mealAward = await page.evaluate(() => {
  for (let i = 0; i < 4; i++) Store.addMeal({ date: '2024-05-01', cost: 0 });
  return (Store.state.pomodoro.pointLog.reduce((m, r) => { m[r.src] = (m[r.src] || 0) + r.n; return m; }, {})).meal || 0;            // 期望 6（封顶 3 餐 ×2）
});
out.actAward = await page.evaluate(() => {
  Store.addActivity({ date: '2024-05-01', start: '09:00', end: '10:00' });
  return (Store.state.pomodoro.pointLog.reduce((m, r) => { m[r.src] = (m[r.src] || 0) + r.n; return m; }, {})).activity || 0;        // 期望 15（60 分 ×0.25）
});
out.actCap = await page.evaluate(() => {
  for (let i = 0; i < 10; i++) Store.addActivity({ date: '2024-05-01', start: '10:00', end: '12:00' });
  return (Store.state.pomodoro.pointLog.reduce((m, r) => { m[r.src] = (m[r.src] || 0) + r.n; return m; }, {})).activity || 0;        // 期望 60（每日上限）
});
out.krAward = await page.evaluate(() => {
  const g = Store.addGoal({ title: 't', startDate: '2024-01-01', endDate: '2024-06-30',
    krs: [{ id: 'k1', title: 'kr', kind: 'manual', target: 10, current: 0, unit: '' }] });
  if (!g) return 'no-goal';
  Store.updateGoal(g.id, { krs: [{ id: 'k1', title: 'kr', kind: 'manual', target: 10, current: 10, unit: '' }] });
  return (Store.state.pomodoro.pointLog.reduce((m, r) => { m[r.src] = (m[r.src] || 0) + r.n; return m; }, {})).goal || 0;            // 期望 15（KR 达成）
});
out.errorCount = errors.length;
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 2));
await browser.close();
