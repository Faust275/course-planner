// 端到端验证：全局搜索（跨模块检索 / 关键词高亮 / 跳转定位描边 / 快捷键）
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8181/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => {
  const e = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find(x => x.textContent.trim() === '跳过');
  if (e) e.click();
});
await p.waitForTimeout(500);

const out = {};

// ---------- 造数据：六类记录各有一条含「数学」 ----------
await p.evaluate(() => {
  const S = window.Store;
  const D = window.DateUtil;
  const mon = D.weekStart(D.today());
  const sem = S.currentSemester();
  sem.startDate = D.toStr(mon); sem.weeks = 20; sem.name = '2025 秋';

  S.state.courses = [{
    id: 'c1', name: '高等数学', teacher: '张老师', location: 'A301', color: '#3b82f6',
    credit: 3, note: '', semesterId: null, startWeek: 1, endWeek: 16, weekType: 'all', exam: null,
    slots: [{ day: 1, timeMode: 'period', periodId: 'p1', startTime: '', endTime: '', location: 'A301' }]
  }];
  S.state.tasks = [{
    id: 't1', title: '交数学作业', courseId: 'c1', dueDate: D.toStr(D.today()), dueTime: '',
    status: 'todo', priority: 'normal', important: false, tags: ['学习'], note: '',
    createdAt: '', doneAt: ''
  }];
  S.state.events = [{ id: 'e1', title: '数学竞赛', date: D.toStr(D.addDays(mon, 3)), start: '09:00', end: '11:00', location: '', note: '', done: false, important: false, createdAt: '' }];
  S.state.plans = [{
    id: 'pl1', title: '数学每日一题', note: '', tags: [], type: 'checkin', period: 'daily',
    startDate: D.toStr(D.today()), days: 21, target: 21, unit: '天', color: '#4f46e5',
    records: [], done: false, important: false, doneAt: '', createdAt: ''
  }];
  S.state.notes = [{ id: 'n1', content: '记得复习数学第三章', tags: [], converted: false, createdAt: '' }];
  S.state.ledger = [{
    id: 'lg1', type: 'expense', amount: 58, category: 'book', note: '买数学辅导书',
    date: D.toStr(D.today()), time: '10:00', source: 'manual', refId: '', tags: [], createdAt: ''
  }];
  S.emit();
});
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(400);

// ---------- 1) 顶栏搜索按钮存在 ----------
out.searchBtn = await p.evaluate(() => !!document.getElementById('btnSearch'));

// ---------- 2) Ctrl+K 打开弹窗 ----------
await p.keyboard.press('Control+k');
await p.waitForTimeout(500);
out.openedByHotkey = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal.cp-show');
  return m ? m.textContent.slice(0, 20).replace(/\s+/g, ' ') : null;
});

// ---------- 3) 输入关键词 → 六类都命中 ----------
async function type(q) {
  await p.fill('.cp-s-input', q);
  await p.waitForTimeout(450);   // debounce 200ms + 余量
}
await type('数学');
out.result = await p.evaluate(() => {
  const box = document.querySelector('.cp-s-list');
  return {
    groups: [...box.querySelectorAll('.cp-s-group-title')].map(x => x.textContent),
    rows: box.querySelectorAll('.cp-s-result').length,
    types: [...box.querySelectorAll('.cp-s-result-type')].map(x => x.textContent)
  };
});

// ---------- 4) 关键词高亮：命中处是 <mark> ----------
out.mark = await p.evaluate(() => {
  const marks = [...document.querySelectorAll('.cp-s-list .cp-s-result mark.cp-hit')];
  const first = marks[0];
  return {
    count: marks.length,
    firstText: first ? first.textContent : null,
    tag: first ? first.tagName : null,
    bg: first ? getComputedStyle(first).backgroundColor : null
  };
});

// ---------- 5) 笔记长文本截摘要 + 高亮 ----------
await type('第三章');
out.snippet = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-s-result')];
  const r = rows[rows.length - 1];
  const sub = r ? r.querySelector('.cp-s-result-sub') : null;
  return {
    text: sub ? sub.textContent : null,
    hasMark: sub ? !!sub.querySelector('mark.cp-hit') : false,
    ellipsis: sub ? /…/.test(sub.textContent) : false
  };
});

// ---------- 6) 无命中 ----------
await type('绝不可能出现的词zzz');
out.noHit = await p.evaluate(() => {
  const e = document.querySelector('.cp-s-empty');
  return e ? e.textContent.trim() : null;
});

// ---------- 7) ↑↓ 选择 ----------
await type('数学');
out.kbd = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-s-result')];
  const sel0 = rows.findIndex(r => r.classList.contains('cp-sel'));
  return { sel0, total: rows.length };
});
await p.keyboard.press('ArrowDown');
await p.waitForTimeout(150);
out.kbdAfterDown = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-s-result')];
  return rows.findIndex(r => r.classList.contains('cp-sel'));
});

// ---------- 8) 点结果 → 跳转 + 定位描边（课程） ----------
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-s-result')];
  const course = rows.find(r => r.querySelector('.cp-s-result-type').textContent === '课程');
  course && course.click();
});
await p.waitForTimeout(1200);
out.jumpCourse = await p.evaluate(() => ({
  view: window.App.currentId,
  flashed: !!document.querySelector('.cp-flash'),
  recId: (document.querySelector('.cp-flash') || {}).dataset?.rec || null
}));

// ---------- 9) 跳转待办：被筛选挡住时要自动放宽筛选 ----------
await p.evaluate(() => {
  window.App.go('tasks');
  // 故意把状态筛到「已完成」，目标待办是 todo，正常情况下会被筛掉
  const done = [...document.querySelectorAll('.cp-filter-tab')].find(x => x.textContent.indexOf('已完成') >= 0);
  done && done.click();
});
await p.waitForTimeout(400);
out.filteredAway = await p.evaluate(() => !document.querySelector('[data-rec="task:t1"]'));
await p.keyboard.press('Control+k');
await p.waitForTimeout(400);
await type('数学作业');
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-s-result')];
  const t = rows.find(r => r.querySelector('.cp-s-result-type').textContent === '待办');
  t && t.click();
});
await p.waitForTimeout(1200);
out.jumpTask = await p.evaluate(() => ({
  view: window.App.currentId,
  flashed: !!document.querySelector('.cp-flash'),
  recId: (document.querySelector('.cp-flash') || {}).dataset?.rec || null,
  activeTab: (document.querySelector('.cp-filter-tab.cp-active') || {}).textContent || null
}));

// ---------- 10) 跳转笔记 ----------
await p.keyboard.press('Control+k');
await p.waitForTimeout(400);
await type('复习数学');
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-s-result')];
  const n = rows.find(r => r.querySelector('.cp-s-result-type').textContent === '笔记');
  n && n.click();
});
await p.waitForTimeout(1200);
out.jumpNote = await p.evaluate(() => ({
  view: window.App.currentId,
  flashed: !!document.querySelector('.cp-flash'),
  recId: (document.querySelector('.cp-flash') || {}).dataset?.rec || null
}));

// ---------- 11) 描边 2 秒后自动消失 ----------
await p.waitForTimeout(2200);
out.flashGone = await p.evaluate(() => !document.querySelector('.cp-flash'));

out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await b.close();
process.exit(errs.length ? 1 : 0);
