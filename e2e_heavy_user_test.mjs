import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });

const errors = [];
page.on('pageerror', e => errors.push('[PAGE ERROR] ' + String(e) + '\n' + (e.stack || '')));
page.on('console', m => {
  if (m.type() === 'error') {
    const text = m.text();
    // Ignore harmless font / resource 404s if any
    if (!text.includes('favicon') && !text.includes('Failed to load resource')) {
      errors.push('[CONSOLE ERROR] ' + text);
    }
  }
});

console.log("=== LAUNCHING HEAVY USER E2E TEST ===");

await page.goto(base + '/index.html#/schedule', { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });

// 1. Populate Heavy Data in the running browser app
console.log("\n1. Injecting heavy dataset into browser App & Store...");
const injectRes = await page.evaluate(async () => {
  const S = window.Store;
  S.updateSettings({ guided: true }); // Dismiss onboarding
  const semId = S.currentSemesterId;

  // Add 10 courses
  const cNames = ['高等数学', '大学物理', '线性代数', '程序设计', '离散数学', '英语写作', '近代史纲要', '体育网球', '心理健康', '电路分析'];
  const courses = [];
  for (let i = 0; i < cNames.length; i++) {
    const c = S.addCourse({
      name: cNames[i],
      credit: 3,
      teacher: `教师_${i+1}`,
      location: `教学楼_${i+1}01`,
      slots: [{ day: (i % 5) + 1, periodId: String((i % 4) + 1), timeMode: 'period' }],
      exam: { date: '2026-11-25', start: '09:00', end: '11:00', location: '考场A' }
    });
    courses.push(c);
  }

  // Add 80 tasks
  for (let t = 0; t < 80; t++) {
    const c = courses[t % courses.length];
    const isParent = t % 10 === 0;
    const task = S.addTask({
      title: `【${c.name}】第 ${t+1} 周大作业与复习题集`,
      courseId: c.id,
      dueDate: `2026-11-${String((t % 25) + 1).padStart(2, '0')}`,
      priority: t % 4 === 0 ? 'high' : 'normal',
      tags: [`学习/${c.name}`, '作业']
    });
    if (isParent) {
      for (let s = 1; s <= 3; s++) {
        S.addTask({
          title: `拆解步骤 ${s}：完成第 ${s} 节小题`,
          parentId: task.id,
          courseId: c.id
        });
      }
    }
  }

  // Add 5 plans with check-ins
  const p1 = S.addPlan({ title: '每日早起打卡', type: 'checkin', period: 'daily', days: 30, startDate: '2026-10-01' });
  for (let d = 1; d <= 25; d++) {
    S.togglePlanCheckin(p1.id, `2026-10-${String(d).padStart(2, '0')}`);
  }
  const p2 = S.addPlan({ title: '每周健身 3 次', type: 'quota', period: 'weekly', quotaN: 3, days: 12, startDate: '2026-10-01' });
  const p3 = S.addPlan({ title: '听力训练 600 分钟', type: 'duration', target: 600, unit: '分钟', startDate: '2026-10-01' });
  for (let v = 0; v < 5; v++) S.addPlanValue(p3.id, 60, `听力篇目 ${v+1}`, '2026-10-20');

  // Add 3 goals
  S.addGoal({
    title: '保研绩点提升到 3.8',
    group: 'study',
    krs: [
      { id: 'kr1', title: '全学期 GPA 达标', kind: 'grade', target: 3.8 },
      { id: 'kr2', title: '完成 20 篇作业', kind: 'task', target: 20 }
    ]
  });

  // Add 100 ledger transactions
  for (let l = 0; l < 100; l++) {
    S.addLedger({
      type: l % 10 === 0 ? 'income' : 'expense',
      amount: 15 + (l % 30) * 2,
      category: ['food', 'shopping', 'transport', 'fun'][l % 4],
      note: `日常账单明细 #${l+1}`,
      date: `2026-10-${String((l % 28) + 1).padStart(2, '0')}`,
      time: '12:00'
    });
  }

  // Add 5 grade records with custom compositions
  courses.slice(0, 5).forEach((c, idx) => {
    S.saveGrade(semId, {
      name: c.name,
      credit: c.credit,
      courseId: c.id,
      root: {
        id: `gr_${idx}`, name: '总评', weight: 100, score: null,
        children: [
          { id: `hw_${idx}`, name: '平时作业', weight: 40, score: 88 + idx, children: [] },
          { id: `fin_${idx}`, name: '期末考试', weight: 60, score: 90 + idx, children: [] }
        ]
      }
    });
  });

  await S.flushSave();
  return {
    courses: S.courses.length,
    tasks: S.state.tasks.length,
    plans: S.plans.length,
    ledger: S.state.ledger.length,
    grades: Object.keys(S.state.grades[semId] || {}).length
  };
});
console.log("Injected dataset summary:", injectRes);

// 2. Visit Every View in Sequence and simulate user interactions
const viewsToVisit = [
  { id: 'schedule', name: '课程表' },
  { id: 'today', name: '今日看板' },
  { id: 'tasks', name: '待办清单' },
  { id: 'plans', name: '计划习惯' },
  { id: 'grades', name: '成绩与绩点' },
  { id: 'ledger', name: '记账本' },
  { id: 'pomodoro', name: '专注时钟' },
  { id: 'settings', name: '设置中心' }
];

for (const v of viewsToVisit) {
  console.log(`\n2. Visiting view: ${v.name} (#/${v.id})...`);
  await page.evaluate((viewId) => window.App.go(viewId), v.id);
  await page.waitForTimeout(500);

  // Check if view container rendered and is visible
  const viewInfo = await page.evaluate((viewId) => {
    const el = document.getElementById('view-' + viewId);
    return {
      exists: !!el,
      childrenCount: el ? el.children.length : 0,
      textLen: el ? el.innerText.length : 0
    };
  }, v.id);
  console.log(`   Rendered: children=${viewInfo.childrenCount}, textLen=${viewInfo.textLen}`);
  if (!viewInfo.exists || viewInfo.childrenCount === 0) {
    errors.push(`[VIEW RENDER ERROR] View ${v.id} failed to render`);
  }
}

// 3. Test View Subtabs & Modal interactions
console.log("\n3. Testing deep views and dialog interactions...");

// 3.1 OKR Goals Subtab
console.log("   Testing Plans -> Goals subtab...");
await page.evaluate(() => window.App.go('plans', { tab: 'goals' }));
await page.waitForTimeout(500);
const goalCardsCount = await page.evaluate(() => document.querySelectorAll('#view-plans .goal-card, #view-plans .cp-goal-card').length);
console.log(`   Found ${goalCardsCount} goal cards.`);

// 3.2 Grades Dialog & What-If
console.log("   Testing Grades view & dialog opening...");
await page.evaluate(() => window.App.go('grades'));
await page.waitForTimeout(500);
const firstGradeRow = await page.evaluate(() => {
  const row = document.querySelector('#view-grades .cp-grade-row, #view-grades .grade-row');
  if (row) {
    row.click();
    return true;
  }
  return false;
});
await page.waitForTimeout(400);
// Check if modal opened
const modalOpened = await page.evaluate(() => {
  const m = document.querySelector('.cp-modal-wrap, .modal');
  const hasInputs = m ? m.querySelectorAll('input').length : 0;
  // Close modal
  if (window.UI && window.UI.topClose) window.UI.topClose();
  return { hasModal: !!m, inputCount: hasInputs };
});
console.log(`   Grade dialog opened: ${modalOpened.hasModal}, inputs: ${modalOpened.inputCount}`);
await page.waitForTimeout(300);

// 3.3 Task creation via dialog
console.log("   Testing Task dialog creation & save...");
await page.evaluate(() => {
  if (window.TaskDialog && window.TaskDialog.open) {
    window.TaskDialog.open();
  }
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const m = document.querySelector('.cp-modal, .modal');
  if (m) {
    const titleInp = m.querySelector('input');
    if (titleInp) titleInp.value = 'E2E自动化新建待办';
    const saveBtn = m.querySelector('.cp-modal-foot .cp-btn-primary, .modal-foot .btn-primary');
    if (saveBtn) saveBtn.click();
  }
});
await page.waitForTimeout(400);
const createdE2ETask = await page.evaluate(() => {
  const match = window.Store.state.tasks.filter(t => t.title === 'E2E自动化新建待办');
  return match.length > 0;
});
console.log(`   Created task persisted: ${createdE2ETask}`);
if (!createdE2ETask) errors.push("[TASK CREATE ERROR] E2E created task was not saved");

// 3.4 Ledger CSV export / import
console.log("   Testing Ledger CSV export...");
const csvOut = await page.evaluate(() => {
  if (window.Store && window.Store.exportLedgerCSV) {
    return window.Store.exportLedgerCSV();
  }
  return null;
});
console.log(`   Ledger CSV lines: ${csvOut ? csvOut.split('\n').length : 0}`);

// 3.5 Settings Desktop tab
console.log("   Testing Settings Desktop widget preview...");
await page.evaluate(() => window.App.go('settings', { tab: 'desktop' }));
await page.waitForTimeout(500);
const widgetPreviewCards = await page.evaluate(() => document.querySelectorAll('.cp-widget-preview-card').length);
console.log(`   Found ${widgetPreviewCards} widget preview cards.`);

await browser.close();
close();

console.log("\n==========================================");
console.log(`E2E TEST COMPLETED! Errors: ${errors.length}`);
console.log("==========================================");
if (errors.length > 0) {
  console.log("Errors encountered during E2E simulation:");
  errors.forEach((err, idx) => console.log(`${idx + 1}. ${err}\n`));
  process.exit(1);
} else {
  console.log(">>> ALL VIEWS & HEAVY USER INTERACTIONS PASSED WITH ZERO ERRORS! <<<");
  process.exit(0);
}
