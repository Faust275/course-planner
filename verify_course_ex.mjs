// Playwright 端到端：单次调课 / 停课 / 调休 + course-exception 纯模块
// 覆盖：LessonDialog 三种标记（停课 / 换教室 / 调课）、今日时间线灰显与徽标、
//       提醒例外过滤、统计不计停课、月历时间带与日详情、
//       .ics 的 EXDATE 与调课/换教室单独事件、同步码带上例外、覆盖写、控制台无报错
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
const wait = (ms) => p.waitForTimeout(ms || 400);

async function evaljs(fn, arg) { return p.evaluate(fn, arg); }

await p.goto(BASE, { waitUntil: 'networkidle' });
await wait(700);
await evaljs(() => { const e = document.querySelector('.cp-ob-skip'); if (e) e.click(); });
await wait(500);

/* ==========================================================
 * 准备：学期从本周一开始，一门课排在今天
 * ========================================================== */
const SETUP = await evaljs(() => {
  const today = DateUtil.today();
  const monday = DateUtil.weekStart(today);
  Store.state.semesters[0].startDate = DateUtil.toStr(monday);
  Store.state.semesters[0].weeks = 20;
  Store.state.courseExceptions = [];
  const c = Store.addCourse({
    name: '数据结构', teacher: '陈昊', location: '信息楼 A105',
    day: DateUtil.isoDow(today), periodId: Store.periods[1].id,
    startWeek: 1, endWeek: 20, weekType: 'all'
  });
  Store.emit();
  return {
    courseId: c.id,
    today: DateUtil.toStr(today),
    dow: DateUtil.isoDow(today),
    baseCount: Store.coursesOnDay(DateUtil.isoDow(today), Store.weekOf(today)).length,
    effCount: Store.coursesOnDate(DateUtil.toStr(today)).length
  };
});
console.log('准备：今天 ' + SETUP.dow + ' · 周历 ' + SETUP.baseCount + ' 节 / 生效 ' + SETUP.effCount + ' 节');
check('周历与生效课表在没有例外时一致', SETUP.baseCount === 1 && SETUP.effCount === 1, SETUP);

/* ==========================================================
 * A. UI 流：今日卡「调整」→ 本次停课
 * ========================================================== */
console.log('A. 本次停课');
await evaljs(() => { App.go('today'); });
await wait(600);
const hasCard = await evaljs(() => !!document.querySelector('.cp-lesson-adj-btn'));
check('今日课程卡出现「调整」入口', hasCard);

await p.locator('.cp-lesson-adj-btn').first().click();
await wait(500);
check('打开「本次课设置」弹窗', await evaljs(() => {
  const m = document.querySelector('.cp-modal');
  return !!m && /本次课设置/.test(m.innerText);
}));
await p.locator('.cp-modal button', { hasText: '本次停课' }).first().click();
await wait(500);

const A1 = await evaljs((s) => ({
  eff: Store.coursesOnDate(s.today).length,
  off: Store.canceledLessonsOn(s.today).map(c => c.courseId + ':' + c._off),
  lessons: Remind.todayLessons().length,
  statCourse: Store.dayStat(s.today).segments.filter(x => x.key === 'course')[0].minutes,
  saved: Store.state.courseExceptions.length
}), SETUP);
check('停课后该天生效课表为空', A1.eff === 0, A1);
check('canceledLessonsOn 标记 cancel', A1.off.join(',') === SETUP.courseId + ':cancel', A1.off);
check('页面内提醒不再包含停课的课', A1.lessons === 0, A1.lessons);
check('统计的「上课」分钟不计停课', A1.statCourse === 0, A1.statCourse);
check('例外已入库', A1.saved === 1, A1.saved);

// 今日时间线灰显
await evaljs(() => { App.go('today'); });
await wait(600);
const A2 = await evaljs(() => {
  const txt = document.body.innerText;
  return { off: /本次停课/.test(txt), adj: document.querySelectorAll('.cp-lesson-adj-btn').length };
});
check('今日时间线出现「本次停课」灰条', A2.off, A2);

// 同一门课同一天覆盖写
const A3 = await evaljs((s) => {
  Store.addCourseException({ courseId: s.courseId, date: s.today, type: 'room', location: '三教 402' });
  const n = Store.state.courseExceptions.length;
  const e = Store.state.courseExceptions[0];
  return { n: n, type: e.type, loc: e.location };
}, SETUP);
check('同课同天覆盖写（停课改换教室）', A3.n === 1 && A3.type === 'room' && A3.loc === '三教 402', A3);

/* ==========================================================
 * B. 换教室：今日卡显示新教室 + ICS 单独事件
 * ========================================================== */
console.log('B. 临时换教室');
await evaljs(() => { App.go('today'); });
await wait(500);
const B1 = await evaljs(() => {
  const courses = Store.coursesOnDate(DateUtil.toStr(DateUtil.today()));
  return { loc: courses[0] && courses[0].location, exRoom: courses[0] && courses[0]._exRoom };
});
check('生效课表换成新教室', B1.loc === '三教 402' && B1.exRoom === '三教 402', B1);

const B2 = await evaljs((s) => {
  const c = Store.getCourse(s.courseId);
  const ics = Remind.ICS.build({
    semesterName: '测试学期', semesterStart: Store.state.semesters[0].startDate,
    periods: Store.periods, courses: [c],
    exceptions: Store.state.courseExceptions,
    include: { courses: true }, leadMinutes: 15, now: new Date()
  });
  return { hasExdate: /EXDATE:/.test(ics), hasNewLoc: /三教 402/.test(ics), hasCexUid: /UID:cex-/.test(ics), raw: ics.split('\n').filter(l => /EXDATE|UID:cex|LOCATION/.test(l)) };
}, SETUP);
check('ICS 带 EXDATE 排掉原日期', B2.hasExdate, B2.raw);
check('ICS 里有换教室的单独事件（新地点）', B2.hasNewLoc && B2.hasCexUid, B2.raw);

/* ==========================================================
 * C. 调课：今天的课调到本周周六
 * ========================================================== */
console.log('C. 调课补课');
const TO_DATE = await evaljs(() =>
  DateUtil.toStr(DateUtil.addDays(DateUtil.weekStart(DateUtil.today()), 5)) // 本周周六
);
const S_C = { ...SETUP, toDate: TO_DATE };
await evaljs((s) => {
  Store.addCourseException({ courseId: s.courseId, date: s.today, type: 'move', toDate: s.toDate });
}, S_C);
const C1 = await evaljs((s) => ({
  todayEff: Store.coursesOnDate(s.today).length,
  toEff: Store.coursesOnDate(s.toDate).map(c => ({ id: c.courseId, mv: !!c._moveIn, from: c._moveFrom })),
  off: Store.canceledLessonsOn(s.today).map(c => c._off + '>' + c._moveTo)
}), S_C);
check('原日期不再有课', C1.todayEff === 0, C1);
check('目标日期出现调进来的课（带 _moveIn）',
  C1.toEff.length === 1 && C1.toEff[0].mv && C1.toEff[0].from === SETUP.today, C1.toEff);
check('原日期灰条显示「已调走」', C1.off.join(',') === 'move>' + TO_DATE, C1.off);

const C2 = await evaljs((s) => {
  const c = Store.getCourse(s.courseId);
  const ics = Remind.ICS.build({
    semesterName: '测试学期', semesterStart: Store.state.semesters[0].startDate,
    periods: Store.periods, courses: [c],
    exceptions: Store.state.courseExceptions,
    include: { courses: true }, leadMinutes: 15, now: new Date()
  });
  return {
    exdate: (ics.match(/EXDATE:.*/g) || []).join('|'),
    moveEvt: /调课/.test(ics) && new RegExp('^DTSTART:' + s.toDate.replace(/-/g, '') + 'T', 'm').test(ics)
  };
}, S_C);
check('ICS 的 EXDATE 排掉原日期', C2.exdate.indexOf(SETUP.today.replace(/-/g, '')) >= 0, C2.exdate);
check('ICS 在目标日期生成「调课」事件', C2.moveEvt, C2);

/* ==========================================================
 * D. 月历：目标日期的课程行带「调自」；时间带只画生效课
 * ========================================================== */
console.log('D. 月历联动');
await evaljs(() => { App.go('calendar'); });
await wait(600);
const D1 = await evaljs((s) => {
  // 选中目标日期：直接调内部状态不可靠，走点击格子
  const cells = [...document.querySelectorAll('.cp-cal-cell')];
  const cell = cells.find(c => c.dataset && c.dataset.date === s.toDate) ||
               cells.find(c => c.textContent.trim().startsWith(String(new Date(s.toDate).getDate())));
  if (cell) cell.click();
  return true;
}, S_C);
await wait(600);
const D2 = await evaljs((s) => {
  const txt = document.querySelector('#view-calendar').innerText;
  return { hasMoveIn: /调自/.test(txt), hasCourse: /数据结构/.test(txt) };
}, S_C);
check('月历日详情显示调进来的课（调自 X/X）', D1 && D2.hasMoveIn && D2.hasCourse, D2);

/* ==========================================================
 * E. 同步与回归
 * ========================================================== */
console.log('E. 同步与回归');
const E1 = await evaljs(() => {
  const std = JSON.parse(Store.exportJSON('standard'));
  const lite = JSON.parse(Store.exportJSON('lite'));
  return { std: (std.courseExceptions || []).length, lite: (lite.courseExceptions || []).length };
});
check('标准同步码带上例外', E1.std === 1, E1.std);
check('lite 档也带（属于课表骨架）', E1.lite === 1, E1.lite);

const E2 = await evaljs(() => {
  // 课程删除后例外变孤儿：coursesOnDate 不应报错
  const ex = Store.state.courseExceptions[0];
  Store.state.courses = Store.state.courses.filter(c => c.id !== ex.courseId);
  Store.emit();
  let ok1 = true;
  try { Store.coursesOnDate(DateUtil.toStr(DateUtil.today())); Store.coursesOnDate(ex.toDate); } catch (e) { ok1 = false; }
  return ok1;
});
check('课程删除后残留例外不报错', E2);

// 撤销入口：详情弹窗
await evaljs(() => {
  // 还原一门课再走详情入口
  const c = Store.addCourse({
    name: '高等数学', teacher: '王敏', location: '教三 301',
    day: DateUtil.isoDow(DateUtil.today()), periodId: Store.periods[2].id,
    startWeek: 1, endWeek: 20, weekType: 'all'
  });
  Store.addCourseException({ courseId: c.id, date: DateUtil.toStr(DateUtil.today()), type: 'cancel' });
  window.__c2 = c.id;
  App.go('schedule');
});
await wait(500);
await evaljs(() => { window.__CourseDialog.detail(window.__c2); });
await wait(500);
const E3 = await evaljs(() => {
  // 页面上可能同时挂着成就弹窗，找含「单次调整」的那个
  const txt = [...document.querySelectorAll('.cp-modal')].map(m => m.innerText).join(' ');
  return { has: /单次调整/.test(txt) && /已有 1 条/.test(txt) };
});
check('课程详情显示「单次调整」与条数', E3.has, E3);

/* ==========================================================
 * 收尾
 * ========================================================== */
const realErrors = errors.filter(e => !/favicon/.test(e) && !/manifest\.webmanifest/.test(e));
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
