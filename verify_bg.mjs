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

const out = {};
const todayStr = await page.evaluate(() => Store.util.toStr(Store.util.today()));

// 准备：清空相关数据 + 造一条带分数的成绩 + 在办目标 + 课程 + 账本 + 活动 + 短睡眠
await page.evaluate((todayStr) => {
  const st = Store.state;
  st.goals.length = 0; st.ledger.length = 0; st.activities.length = 0; st.sleeps.length = 0;
  st.pomodoro.pointLog.length = 0; st.pomodoro.points = 0; st.pomodoro.jade = 0; st.pomodoro.earned = 0;
  const sid = st.currentSemesterId;
  st.grades[sid] = { k1: { key: 'k1', name: '高数', credit: 3,
    root: { id: 'r', name: '总评', weight: 100, score: null, children: [
      { id: 'a', name: '期末', weight: 100, score: 92, children: [] } ] } } };
  st.courses.push({ id: 'c1', name: '测试课', semesterId: sid, exam: { date: todayStr, start: '09:00', end: '11:00' } });
}, todayStr);

// B：目标→今日（在办目标卡片）
await page.evaluate((todayStr) => {
  Store.addGoal({ title: '本月冲 GPA', startDate: '2000-01-01', endDate: '2099-12-31',
    krs: [{ title: '学期 GPA', kind: 'grade', target: 3.5, semesterId: Store.state.currentSemesterId }] });
}, todayStr);
await page.evaluate(() => App.go('today'));
await page.waitForTimeout(300);
out.B_goalCard = await page.evaluate(() => document.body.innerText.includes('在办目标'));
out.C_weekExam = await page.evaluate(() => document.body.innerText.includes('本周考试'));

// A/E：账本 + 活动（挂课程）
await page.evaluate((todayStr) => {
  Store.addLedger({ type: 'expense', amount: 50, category: 'food', date: todayStr });
  Store.addActivity({ date: todayStr, start: '09:00', end: '11:00', name: '自习', courseName: '测试课', courseId: 'c1', noAward: true });
}, todayStr);

// D：GPA KR 计算（92 分 → gpaOf=4，target 3.5 → pct 封顶 1）
out.D_gradeKR = await page.evaluate(() => {
  const g = Store.state.goals[0];
  const row = Store.goalProgressOf(g).rows[0];
  // 再测「待出分」：把分数清空
  const sid = Store.state.currentSemesterId;
  const backup = Store.state.grades[sid];
  Store.state.grades[sid] = { k1: { key: 'k1', name: '高数', credit: 3,
    root: { children: [{ score: null, weight: 100 }] } } };
  const emptyRow = Store.goalProgressOf(g).rows[0];
  Store.state.grades[sid] = backup;
  return { value: row.value, pct: Math.round(row.pct * 100), emptyPct: emptyRow.pct, emptyFlag: emptyRow.empty };
});

// 统计分页：A 消费构成 + E 课程投入
await page.evaluate(() => App.go('tasks', { tab: 'stats' }));
await page.waitForTimeout(400);
const statsText = await page.evaluate(() => document.body.innerText);
out.A_spend = statsText.includes('消费构成') && statsText.includes('¥50');
out.E_course = statsText.includes('课程投入') && statsText.includes('测试课');

// G：健康提示（短睡眠 4h < 6h）
await page.evaluate((todayStr) => Store.addSleep({ date: todayStr, start: '02:00', end: '06:00' }), todayStr);
await page.evaluate(() => App.go('today'));
await page.waitForTimeout(300);
out.G_hintOn = await page.evaluate(() => document.body.innerText.includes('健康提示'));
await page.evaluate(() => Store.updateSettings({ health: Object.assign({}, Store.settings.health, { on: false }) }));
await page.evaluate(() => App.go('today'));
await page.waitForTimeout(300);
out.G_hintOffWhenDisabled = await page.evaluate(() => !document.body.innerText.includes('健康提示'));

// F：专注里程成就
out.F_ach = await page.evaluate(() => {
  Store.state.pomodoro.focusMinutes = 700;   // > 600 (10h)
  Store.checkAchievements(false);
  return !!(Store.state.achievements && Store.state.achievements.done && Store.state.achievements.done.focus_h10);
});

// 统计显示开关：关掉消费/课程
await page.evaluate(() => Store.updateSettings({ statsWidgets: Object.assign({}, Store.settings.statsWidgets, { spend: false, course: false }) }));
await page.evaluate(() => App.go('tasks', { tab: 'stats' }));
await page.waitForTimeout(400);
const t2 = await page.evaluate(() => document.body.innerText);
out.A_spendHidden = !t2.includes('消费构成');
out.E_courseHidden = !t2.includes('课程投入');

// 窄屏无溢出
out.noHOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
out.errorCount = errors.length;
out.errors = errors.slice(0, 6);
console.log(JSON.stringify(out, null, 2));
await browser.close();
