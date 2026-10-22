// 端到端验证：.ics 导出（内容 / 单双周 / 考试 / 日程）+ 页面内提醒（触发 / 去重）
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8171/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
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

// ---------- 准备数据：学期从「本周一」开始，共 20 周 ----------
await p.evaluate(() => {
  const S = window.Store;
  const mon = window.DateUtil.weekStart(window.DateUtil.today());
  const sem = S.currentSemester();
  sem.startDate = window.DateUtil.toStr(mon);
  sem.weeks = 20;
  sem.name = '2025 秋';
  const mk = (id, name, day, periodId, weekType, sw, ew) => ({
    id, name, teacher: '张老师', location: 'A301', color: '#3b82f6',
    credit: 3, note: '', semesterId: null,
    startWeek: sw, endWeek: ew, weekType,
    exam: id === 'c1' ? { date: window.DateUtil.toStr(window.DateUtil.addDays(mon, 100)),
                          start: '09:00', end: '11:00', location: 'A301' } : null,
    slots: [{ day, timeMode: 'period', periodId, startTime: '', endTime: '', location: 'A301' }]
  });
  // c2 从第 2 周起、单周：首次出现要顺延到第 3 周，次数也要少一次
  S.state.courses = [
    mk('c1', '高等数学', 1, 'p1', 'all', 1, 16),
    mk('c2', '大学英语', 3, 'p2', 'odd', 2, 16),
    mk('c3', '体育', 5, 'p1', 'even', 1, 16)
  ];
  S.state.events = [
    { id: 'e1', title: '毕业答辩', date: window.DateUtil.toStr(window.DateUtil.addDays(mon, 110)),
      start: '14:00', end: '16:00', important: true, note: '带 PPT', location: 'B201' },
    { id: 'e2', title: '普通日程', date: window.DateUtil.toStr(window.DateUtil.addDays(mon, 111)), important: false }
  ];
  S.state.settings.remind = { on: true, lead: 15, sound: false, exams: true, events: true };
  S.emit();
});
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(600);

// 期望值（用页面里的真实数据算，能抓出周次换算的 off-by-one）
const expect = await p.evaluate(() => {
  const S = window.Store;
  const P = {}; S.periods.forEach(x => { P[x.id] = x; });
  const d = (week, dow) => window.DateUtil.toStr(S.dateOf(week, dow)).replace(/-/g, '');
  return {
    startDate: S.currentSemester().startDate,
    p1: P.p1.start.replace(':', '') + '00',
    p1e: P.p1.end.replace(':', '') + '00',
    p2: P.p2.start.replace(':', '') + '00',
    mon1: d(1, 1), wed3: d(3, 3), wed1: d(1, 3), fri2: d(2, 5),
    examDate: S.state.courses[0].exam.date.replace(/-/g, ''),
    evDate: S.state.events[0].date.replace(/-/g, '')
  };
});
out.expect = expect;

// ---------- 1) 课表页出现「导出日历」按钮 ----------
out.exportBtn = await p.evaluate(() =>
  [...document.querySelectorAll('button')].some(x => x.textContent.trim() === '导出日历'));

// ---------- 2) 打开导出弹窗 ----------
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '导出日历');
  btn && btn.click();
});
await p.waitForTimeout(500);
out.dialog = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal.cp-show');
  if (!m) return null;
  return {
    title: (m.querySelector('.cp-modal-head') || m).textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
    selects: m.querySelectorAll('select').length,
    leadValue: m.querySelector('select') ? m.querySelector('select').value : null,
    checks: [...m.querySelectorAll('input[type=checkbox]')].map(c => c.checked),
    hasExport: [...m.querySelectorAll('button')].some(x => x.textContent.trim() === '导出 .ics')
  };
});

// ---------- 3) 导出并读取 .ics 内容 ----------
async function doExport() {
  const [dl] = await Promise.all([
    p.waitForEvent('download', { timeout: 8000 }),
    p.evaluate(() => {
      const btn = [...document.querySelectorAll('.cp-modal.cp-show button')]
        .find(x => x.textContent.trim() === '导出 .ics');
      btn && btn.click();
    })
  ]);
  const fs = await import('node:fs');
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: fs.readFileSync(path, 'utf8') };
}
const f1 = await doExport();
await p.waitForTimeout(400);
const L = f1.text.split('\r\n');
const e = expect;
out.ics1 = {
  fileName: f1.name,
  bytes: Buffer.byteLength(f1.text),
  events: (f1.text.match(/BEGIN:VEVENT/g) || []).length,
  alarms: (f1.text.match(/BEGIN:VALARM/g) || []).length,
  calName: L.includes('X-WR-CALNAME:2025 秋'),
  version: L.includes('VERSION:2.0'),
  endsOk: f1.text.trim().endsWith('END:VCALENDAR'),
  crlf: f1.text.includes('\r\n'),
  // 每周：第 1 周周一 p1
  weeklyStart: L.includes('DTSTART:' + e.mon1 + 'T' + e.p1),
  weeklyEnd: L.includes('DTEND:' + e.mon1 + 'T' + e.p1e),
  weeklyRule: L.includes('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=16'),
  // 单周：首次顺延到第 3 周周三 p2，隔周重复 8 次
  oddStart: L.includes('DTSTART:' + e.wed3 + 'T' + e.p2),
  oddRule: L.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=7'),
  // 单周不该从第 1/2 周开始排
  oddNotWeek1: !L.includes('DTSTART:' + e.wed1 + 'T' + e.p2),
  // 双周：首次是第 2 周周五 p1
  evenStart: L.includes('DTSTART:' + e.fri2 + 'T' + e.p1),
  evenRule: L.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=8'),
  // 考试 / 重要日程
  examStart: L.includes('DTSTART:' + e.examDate + 'T090000'),
  examTitle: L.includes('SUMMARY:高等数学（考试）'),
  examTrigger: L.includes('TRIGGER:-PT30M'),
  evStart: L.includes('DTSTART:' + e.evDate + 'T140000'),
  evNote: L.includes('DESCRIPTION:带 PPT'),
  notImportant: !f1.text.includes('普通日程'),
  // 提前提醒
  courseTrigger: L.includes('TRIGGER:-PT15M'),
  // 折行：没有一行超过 75 字节
  maxLineBytes: Math.max(...L.map(x => Buffer.byteLength(x, 'utf8')))
};
out.ics1.noLongLine = out.ics1.maxLineBytes <= 75;

const toast1 = await p.evaluate(() => {
  const arr = [...document.querySelectorAll('#toastRoot .cp-toast')];
  const t = arr[arr.length - 1];
  return t ? t.textContent.replace(/\s+/g, ' ').trim() : null;
});
out.exportToast = toast1;

// ---------- 4) 只导课程：关掉考试和日程 ----------
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '导出日历');
  btn && btn.click();
});
await p.waitForTimeout(400);
await p.evaluate(() => {
  document.querySelectorAll('.cp-modal.cp-show input[type=checkbox]').forEach(c => {
    if (c.checked) c.click();
  });
});
const f2 = await doExport();
await p.waitForTimeout(300);
out.ics2 = {
  events: (f2.text.match(/BEGIN:VEVENT/g) || []).length,
  hasExam: f2.text.includes('（考试）'),
  hasEvent: f2.text.includes('毕业答辩')
};

// ---------- 5) 空学期：不给文件，只提示 ----------
await p.evaluate(() => {
  window.Store.state.courses = [];
  window.Store.state.events = [];
  window.Store.emit();
  document.querySelectorAll('.cp-modal.cp-show button').forEach(x => { if (x.textContent.trim() === '取消') x.click(); });
});
await p.waitForTimeout(400);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '导出日历');
  btn && btn.click();
});
await p.waitForTimeout(300);
let downloaded = false;
p.once('download', () => { downloaded = true; });
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.cp-modal.cp-show button')].find(x => x.textContent.trim() === '导出 .ics');
  btn && btn.click();
});
await p.waitForTimeout(1200);
out.emptySemester = {
  downloaded,
  toast: await p.evaluate(() => {
    const t = [...document.querySelectorAll('#toastRoot .cp-toast')].map(x => x.textContent.trim());
    return t[t.length - 1] || null;
  })
};
await p.keyboard.press('Escape');
await p.waitForTimeout(300);

// ---------- 6) 设置 → 上课提醒 子页 ----------
await p.evaluate(() => window.App.go('settings'));
await p.waitForTimeout(500);
await p.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-set-cat')].find(x => /记录与统计/.test(x.textContent));
  if (c) c.click();
});
await p.waitForTimeout(350);
out.remindEntry = await p.evaluate(() =>
  [...document.querySelectorAll('.cp-set-item')].some(x => {
    const b = x.querySelector('b');
    return b && b.textContent.trim() === '上课提醒';
  }));
await p.evaluate(() => {
  const hit = [...document.querySelectorAll('.cp-set-item')]
    .find(x => x.querySelector('b') && x.querySelector('b').textContent.trim() === '上课提醒');
  hit && hit.click();
});
await p.waitForTimeout(600);
out.remindPage = await p.evaluate(() => {
  const root = document.querySelector('#view-settings');
  if (!root) return null;
  const txt = root.textContent.replace(/\s+/g, ' ');
  return {
    hasInPage: txt.includes('页面内提醒'),
    hasIcs: txt.includes('导出到系统日历'),
    hasWhy: txt.includes('为什么不直接弹系统通知'),
    hasExportBtn: [...root.querySelectorAll('button')].some(x => x.textContent.trim().indexOf('导出') >= 0),
    switches: root.querySelectorAll('input[type=checkbox]').length
  };
});
await p.keyboard.press('Escape');

// ---------- 7) 页面内提醒：到点触发 ----------
await p.evaluate(() => {
  const S = window.Store;
  const now = new Date();
  const start = new Date(now.getTime() + 8 * 60000);
  const end = new Date(now.getTime() + 60 * 60000);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  S.state.courses = [{
    id: 'r1', name: '提醒测试课', teacher: '', location: 'C101', color: '#3b82f6',
    credit: 0, note: '', semesterId: null, startWeek: 1, endWeek: 16, weekType: 'all', exam: null,
    slots: [{ day: window.DateUtil.isoDow(window.DateUtil.today()), timeMode: 'custom',
              periodId: '', startTime: hhmm(start), endTime: hhmm(end), location: 'C101' }]
  }];
  S.state.settings.remind = { on: true, lead: 15, sound: false, exams: true, events: true };
  S.emit();
});
await p.evaluate(() => window.App.go('schedule'));
await p.waitForTimeout(400);

out.beforeRemind = await p.evaluate(() => ({
  hidden: document.hidden,
  lessons: window.Remind.todayLessons().map(x => x.course.name)
}));

async function fireOnce() {
  return await p.evaluate(() => {
    document.getElementById('toastRoot').innerHTML = '';
    window.Remind.check();
    return [...document.querySelectorAll('#toastRoot .cp-toast')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
  });
}
out.firstCheck = await fireOnce();
out.secondCheck = await fireOnce();          // 同一节不应再弹

// 关掉开关后不再提醒
await p.evaluate(() => {
  window.Store.state.settings.remind.on = false;
  document.getElementById('toastRoot').innerHTML = '';
  window.Remind.check();
});
out.offCheck = await p.evaluate(() =>
  [...document.querySelectorAll('#toastRoot .cp-toast')].map(x => x.textContent.trim()));

// 窗口外的课（还有 40 分钟）不提醒
await p.evaluate(() => {
  const S = window.Store;
  const now = new Date();
  const start = new Date(now.getTime() + 40 * 60000);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  S.state.courses[0].slots[0].startTime = pad(start.getHours()) + ':' + pad(start.getMinutes());
  S.state.settings.remind.on = true;
  S.emit();
  document.getElementById('toastRoot').innerHTML = '';
  window.Remind.check();
});
out.tooEarly = await p.evaluate(() =>
  [...document.querySelectorAll('#toastRoot .cp-toast')].map(x => x.textContent.trim()));

out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await b.close();
process.exit(errs.length ? 1 : 0);
