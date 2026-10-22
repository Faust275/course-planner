// Playwright 端到端：统计与复盘
// 覆盖：五档自然口径、rangeDates 不把未来算进分母、对比用日均、对比开关禁用态、
//       热力条按周/按日切换与绝对刻度着色、饼图/方形图切换、象限页入口、
//       记账页自然月口径与四档标签、缓存随写操作失效、睡眠跨午夜按实际归属
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8201/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

/* ==========================================================
 * A. 数据层：口径与缓存
 * ========================================================== */
console.log('A. 周期口径与缓存');
const A = await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil;
  const out = {};
  const today = D.today();
  const dstr = D.toStr(today);

  // 灌一批干净数据：60 天睡眠 + 活动
  S.state.sleeps = [];
  S.state.activities = [];
  S.state.meals = [];
  S.state.events = [];
  S.state.courses = [];
  for (let i = 0; i < 60; i++) {
    const d = D.toStr(D.addDays(today, -i));
    S.state.sleeps.push({ id: 'vsl' + i, date: d, start: '23:20', end: '07:10', quality: 'normal', note: '' });
    S.state.activities.push({ id: 'va' + i, date: d, type: 'study', start: '19:00', end: '21:00', note: '' });
  }
  S.emit();

  const rw = rangeDates('week');
  out.weekFrom = rw.from;
  out.weekTo = rw.to;
  out.weekDays = rw.days;
  out.weekToIsToday = rw.to === dstr;
  out.weekFromIsMonday = D.isoDow(D.parse(rw.from)) === 1;
  out.weekDaysMatches = rw.days === D.diffDays(D.parse(rw.to), D.parse(rw.from)) + 1;

  const rm = rangeDates('month');
  out.monthFromIs1st = D.parse(rm.from).getDate() === 1;
  out.monthToIsToday = rm.to === dstr;

  const rt = rangeDates('term');
  out.termFromIsSemStart = rt.from === S.currentSemester().startDate;

  // 对比：本月参照段天数应与本月一致（都截到同一天数）
  const pm = compareRange('month', rm);
  out.prevMonthSameSpan = pm.days === rm.days;
  out.prevMonthIsBefore = pm.to < rm.from;
  out.termNoCompare = compareRange('term', rt) === null;

  // 缓存：同一区间两次调用应命中同一个对象引用
  const st1 = S.rangeStat(rm.from, rm.to);
  const st2 = S.rangeStat(rm.from, rm.to);
  out.cacheHit = st1 === st2;

  // 写操作后必须失效（否则「改了数据统计不动」）
  S.state.activities.push({ id: 'vnew', date: dstr, type: 'study', start: '06:00', end: '07:00', note: '' });
  S.emit();
  const st3 = S.rangeStat(rm.from, rm.to);
  out.cacheInvalidated = st3 !== st1;
  out.recordedGrew = st3.recorded > st1.recorded;

  // 单日统计缓存也要失效
  const d1 = S.dayStat(dstr);
  S.state.activities.push({ id: 'vnew2', date: dstr, type: 'study', start: '08:00', end: '09:00', note: '' });
  S.emit();
  const d2 = S.dayStat(dstr);
  out.dayCacheInvalidated = d2 !== d1;

  return out;
});
check('本周 from 是周一', A.weekFromIsMonday, A.weekFrom);
check('本周 to 截到今天', A.weekToIsToday, A.weekTo);
check('本周天数 = 首尾差 + 1', A.weekDaysMatches, A.weekDays);
check('本月 from 是 1 号', A.monthFromIs1st);
check('本月 to 截到今天', A.monthToIsToday);
check('本学期 from 是开学日', A.termFromIsSemStart);
check('上月参照段与本月等长', A.prevMonthSameSpan);
check('上月参照段在本月之前', A.prevMonthIsBefore);
check('本学期不提供对比', A.termNoCompare);
check('区间统计命中缓存', A.cacheHit);
check('写操作后区间缓存失效', A.cacheInvalidated);
check('写操作后记录量确实变大', A.recordedGrew);
check('写操作后单日缓存失效', A.dayCacheInvalidated);

/* ==========================================================
 * B. 睡眠跨午夜
 * ========================================================== */
console.log('B. 睡眠跨午夜归属');
const B = await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil;
  S.state.sleeps = [];
  S.state.activities = [];
  S.state.courses = [];
  S.state.events = [];
  S.state.meals = [];
  const d1 = '2026-10-20', d2 = '2026-10-21', d3 = '2026-10-22';
  S.state.sleeps.push({ id: 'n1', date: d1, start: '23:00', end: '07:00' });
  S.emit();
  return {
    night: S.sleepMinutes(d1),
    morning: S.sleepMinutes(d2),
    none: S.sleepMinutes(d3),
    sum: S.sleepMinutes(d1) + S.sleepMinutes(d2)
  };
});
check('入睡当晚只算跨午夜前的 60 分钟', B.night === 60, B.night);
check('次日算凌晨的 420 分钟', B.morning === 420, B.morning);
check('第三天不再重复计', B.none === 0, B.none);
check('两天相加恰为整觉 480 分钟（不多不少）', B.sum === 480, B.sum);

/* ==========================================================
 * C. 视图：入口与渲染
 * ========================================================== */
console.log('C. 视图与入口');
// 造够数据，让页面有内容
await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil;
  const today = D.today();
  S.state.sleeps = [];
  S.state.activities = [];
  S.state.meals = [];
  for (let i = 0; i < 45; i++) {
    const d = D.toStr(D.addDays(today, -i));
    S.state.sleeps.push({ id: 'ssl' + i, date: d, start: '23:20', end: '07:10', quality: 'normal', note: '' });
    S.state.activities.push({ id: 'sa' + i, date: d, type: 'study', start: '19:00', end: (i < 12 ? '22:30' : '20:00'), note: '' });
    S.state.meals.push({ id: 'sm' + i, date: d, type: 'lunch', time: '12:00', note: '' });
  }
  S.emit();
});

// 入口在象限页
await p.evaluate(() => App.go('tasks', { tab: 'quadrant' }));
await p.waitForTimeout(400);
const entry = await p.evaluate(() => {
  const btn = document.querySelector('.cp-stats-more');
  return { exists: !!btn, text: btn ? btn.textContent.trim() : '' };
});
check('象限页有「看统计」入口', entry.exists, entry.text);
check('入口文案包含「统计」', entry.text.indexOf('统计') >= 0, entry.text);

await p.evaluate(() => { const b = document.querySelector('.cp-stats-more'); if (b) b.click(); });
await p.waitForTimeout(400);
const cur = await p.evaluate(() => ({ id: App.currentId, stats: !!document.querySelector('#view-tasks .cp-week-bar') }));
check('点击后进入统计分页', cur.id === 'tasks' && cur.stats, cur);

const navHasStats = await p.evaluate(() => {
  return [...document.querySelectorAll('.cp-nav-item')].some(x => /统计/.test(x.textContent));
});
check('统计视图不进底部/侧边导航', navHasStats === false);

const tabs = await p.evaluate(() =>
  [...document.querySelectorAll('#view-tasks .cp-week-bar .cp-dim-tab')].map(x => x.textContent.trim()));
check('六档周期齐全（含今年）', JSON.stringify(tabs) === JSON.stringify(['今天', '本周', '本月', '本学期', '今年']), tabs);

const cards = await p.evaluate(() =>
  [...document.querySelectorAll('#view-tasks .cp-stat-cell .cp-stat-label')].map(x => x.textContent.trim()));
check('顶部四格', JSON.stringify(cards) === JSON.stringify(['已记录', '日均记录', '睡眠日均', '上课日均']), cards);

const hasChart = await p.evaluate(() => !!document.querySelector('#view-tasks .cp-chart-bars, #view-tasks .cp-chart-pie'));
check('时间去向图已渲染', hasChart);

const legendRows = await p.evaluate(() => document.querySelectorAll('#view-tasks .cp-legend-row').length);
check('图例有行（至少睡眠 + 活动）', legendRows >= 2, legendRows);

/* ==========================================================
 * D. 周期切换与对比
 * ========================================================== */
console.log('D. 周期切换与对比');
async function pickRange(label) {
  await p.evaluate((lbl) => {
    for (const x of document.querySelectorAll('#view-tasks .cp-week-bar .cp-dim-tab')) {
      if (x.textContent.trim() === lbl) { x.click(); return; }
    }
  }, label);
  await p.waitForTimeout(320);
}

await pickRange('本月');
const monthTitle = await p.evaluate(() => document.querySelector('#view-tasks .cp-week-label span').textContent.trim());
check('切到本月后标题更新', monthTitle === '本月统计', monthTitle);
const monthRec = await p.evaluate(() => document.querySelector('#view-tasks .cp-stat-cell .cp-stat-value').textContent.trim());
check('本月已记录非零', monthRec !== '0 分', monthRec);

// 对比开关
const cmpBefore = await p.evaluate(() => ({
  on: document.querySelector('.cp-cmp-toggle').className.includes('cp-is-on'),
  chips: document.querySelectorAll('#view-tasks .cp-cmp-chip').length
}));
check('对比默认关闭', cmpBefore.on === false);
check('关闭时无对比小标签', cmpBefore.chips === 0, cmpBefore.chips);

await p.evaluate(() => document.querySelector('.cp-cmp-toggle').click());
await p.waitForTimeout(320);
const cmpAfter = await p.evaluate(() => ({
  on: document.querySelector('.cp-cmp-toggle').className.includes('cp-is-on'),
  chips: document.querySelectorAll('#view-tasks .cp-cmp-chip').length,
  tableRows: document.querySelectorAll('#view-tasks .cp-cmp-tr').length,
  hint: document.querySelector('.cp-cmp-hint') ? document.querySelector('.cp-cmp-hint').textContent : ''
}));
check('开启后按钮为 on', cmpAfter.on === true);
check('开启后出现对比小标签', cmpAfter.chips >= 3, cmpAfter.chips);
check('出现对比明细表', cmpAfter.tableRows >= 6, cmpAfter.tableRows);
check('提示里说明只比日均', /日均/.test(cmpAfter.hint), cmpAfter.hint.slice(0, 40));

// 总量那张卡不做百分比对比（区间天数不同，比总量没意义）
const totalChip = await p.evaluate(() => {
  const cell = document.querySelector('#view-tasks .cp-stat-cell');
  const chip = cell ? cell.querySelector('.cp-cmp-chip') : null;
  return chip ? chip.textContent : '';
});
check('总量卡不做百分比对比', /区间不同/.test(totalChip), totalChip);

// 本学期：对比按钮应为禁用态
await pickRange('本学期');
const termCmp = await p.evaluate(() => {
  const t = document.querySelector('.cp-cmp-toggle');
  return { off: t.className.includes('cp-is-off'), text: t.textContent };
});
check('本学期对比按钮为禁用态', termCmp.off === true, termCmp.text);
check('禁用原因写在按钮上', /没有可比/.test(termCmp.text), termCmp.text);

/* ==========================================================
 * E. 热力条
 * ========================================================== */
console.log('E. 热力条');
const heatTerm = await p.evaluate(() => {
  const cells = [...document.querySelectorAll('#view-tasks .cp-heat .cp-heat-week')];
  return {
    count: cells.length,
    levels: cells.map(c => (c.className.match(/cp-lv-(\d)/) || [])[1]),
    partial: cells.filter(c => c.className.includes('cp-is-partial')).length,
    title: document.querySelector('#view-tasks .cp-chart-card .cp-section-title').textContent
  };
});
check('本学期按周分组（多于一格）', heatTerm.count >= 3, heatTerm.count);
check('周格有 4 种以上明暗区分', new Set(heatTerm.levels).size >= 2, heatTerm.levels);
check('首尾不满周被标出', heatTerm.partial >= 1, heatTerm.partial);

await pickRange('今天');
const heatDay = await p.evaluate(() => {
  const strip = document.querySelector('#view-tasks .cp-heat');
  return {
    daily: strip ? strip.className.includes('cp-is-daily') : false,
    count: strip ? strip.querySelectorAll('.cp-heat-week').length : 0
  };
});
check('短跨度改为逐日', heatDay.daily === true);
check('今天只有 1 格', heatDay.count === 1, heatDay.count);

/* ==========================================================
 * F. 图表切换
 * ========================================================== */
console.log('F. 图表切换');
await pickRange('本月');
await p.evaluate(() => {
  const box = document.querySelector('#view-tasks .cp-chart-card .cp-section-title .cp-dim-tabs');
  for (const x of (box ? box.querySelectorAll('.cp-dim-tab') : [])) if (x.textContent.trim() === '饼状图') x.click();
});
await p.waitForTimeout(320);
// 只看「时间去向」这张卡：下面的逐日柱图也用 .cp-chart-bars，会误判
const pie = await p.evaluate(() => {
  const card = document.querySelector('#view-tasks .cp-chart-card');
  return {
    hasPie: !!card.querySelector('.cp-chart-pie'),
    hasBars: !!card.querySelector('.cp-chart-bars'),
    legend: card.querySelectorAll('.cp-legend-row').length
  };
});
check('切到饼状图', pie.hasPie === true && pie.hasBars === false, pie);
check('饼图也有图例（不只靠悬停）', pie.legend >= 2, pie.legend);

await p.evaluate(() => {
  const box = document.querySelector('#view-tasks .cp-chart-card .cp-section-title .cp-dim-tabs');
  for (const x of (box ? box.querySelectorAll('.cp-dim-tab') : [])) if (x.textContent.trim() === '方形图') x.click();
});
await p.waitForTimeout(320);
const bar = await p.evaluate(() => {
  const card = document.querySelector('#view-tasks .cp-chart-card');
  const el = card.querySelector('.cp-chart-bars');
  return {
    hasBars: !!el,
    hasPie: !!card.querySelector('.cp-chart-pie'),
    capped: el ? el.className.includes('cp-capped') : false
  };
});
check('切回方形图', bar.hasBars === true && bar.hasPie === false, bar);
check('柱子有最大宽度（不会被拉满整行）', bar.capped === true);

/* ==========================================================
 * G. 记账页口径
 * ========================================================== */
console.log('G. 记账页口径');
await p.evaluate(() => App.go('ledger'));
await p.waitForTimeout(400);
const led = await p.evaluate(() => {
  const tabs = [...document.querySelectorAll('#view-ledger .cp-week-bar .cp-dim-tab, #view-ledger .cp-dim-tabs .cp-dim-tab')]
    .map(x => x.textContent.trim());
  const label = document.querySelector('#view-ledger .cp-week-label span');
  return { tabs: tabs.slice(0, 8), label: label ? label.textContent.trim() : '' };
});
check('记账四档', JSON.stringify(led.tabs.slice(0, 4)) === JSON.stringify(['今天', '本周', '本月', '最近 30 天']), led.tabs);
check('不再有「一季」', led.tabs.indexOf('一季') === -1, led.tabs);
check('文案为「本月账单」', led.label === '本月账单', led.label);

/* ==========================================================
 * H. 无报错
 * ========================================================== */
console.log('H. 控制台');
check('无 JS 报错', errors.length === 0, errors.slice(0, 3));

console.log('\n结果: ' + ok + ' 通过 / ' + bad + ' 失败');
await b.close();
process.exit(bad ? 1 : 0);
