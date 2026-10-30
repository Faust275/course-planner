// Playwright 端到端：课表「是否展示周末」
// 覆盖：默认 7 天 → 隐藏后 5 天、表头/表体列数一致、日期区间改到周五、
//       刷新后保持、设置页同一个开关、周末课程数据不被删除
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8213/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

async function boot() {
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => App.go('schedule'));
  await p.waitForTimeout(500);
}

const cols = () => p.evaluate(() => ({
  head: document.querySelectorAll('#view-schedule thead th').length,
  body: document.querySelectorAll('#view-schedule tbody tr:first-child td').length,
  cls: (document.querySelector('#view-schedule table.cp-tt') || {}).className || '',
  end: (document.querySelector('#view-schedule .cp-week-label small') || {}).textContent || '',
  btn: (() => {
    const b = [...document.querySelectorAll('#view-schedule .cp-week-meta button')]
      .find(x => /周末/.test(x.textContent));
    return b ? b.textContent.trim() : '';
  })(),
  setting: Store.settings.showWeekend
}));

await boot();

// 不写死日期：按当前周算周日的短日期，换一天跑也成立
const want = await p.evaluate(() => {
  const ws = Store.weekStartDate(Store.currentWeek());
  return {
    sunday: DateUtil.mdShort(DateUtil.addDays(ws, 6)),
    friday: DateUtil.mdShort(DateUtil.addDays(ws, 4))
  };
});

/* ---- 1. 默认显示 7 天 ---- */
const d1 = await cols();
check('默认表头 8 列（时间 + 7 天）', d1.head === 8, d1);
check('默认表体 8 列', d1.body === 8, d1);
check('默认没有 no-weekend 类', d1.cls.indexOf('no-weekend') < 0, d1.cls);
check('周区间到周日', d1.end.indexOf(want.sunday) >= 0, d1.end);
check('工具栏按钮是「隐藏周末」', d1.btn === '隐藏周末', d1.btn);

/* ---- 2. 加一门周六的课，确认数据与展示解耦 ---- */
const sat = await p.evaluate(() => {
  const pid = Store.periods[0].id;
  Store.addCourse({
    name: '周六实验', color: '#f59e0b',
    slots: [{ day: 6, timeMode: 'period', periodId: pid, location: '' }], credit: 1
  });
  Store.emit();
  return { pid: pid, courses: Store.courses.length, hasSlot: !!(Store.weekMatrix(1)['6|' + pid]) };
});
check('周六课程已写入', sat.hasSlot === true, sat);

/* ---- 3. 隐藏周末 ---- */
await p.evaluate(() => {
  [...document.querySelectorAll('#view-schedule .cp-week-meta button')]
    .find(x => /周末/.test(x.textContent)).click();
});
await p.waitForTimeout(450);
const d2 = await cols();
check('隐藏后表头 6 列', d2.head === 6, d2);
check('隐藏后表体 6 列', d2.body === 6, d2);
check('表格带 no-weekend 类', d2.cls.indexOf('no-weekend') >= 0, d2.cls);
check('周区间改到周五', d2.end.indexOf(want.friday) >= 0, d2.end);
check('开关状态写入设置', d2.setting === false, d2.setting);
check('按钮变成「显示周末」', d2.btn === '显示周末', d2.btn);

const dataKept = await p.evaluate(() => ({
  courses: Store.courses.length,
  hasSlot: !!Store.weekMatrix(1)['6|' + Store.periods[0].id],
  sleeps: Store.state.sleeps.length
}));
check('周末课程数据没有被删除', dataKept.courses === sat.courses && dataKept.hasSlot === true, dataKept);

/* ---- 4. 刷新后保持 ---- */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => App.go('schedule'));
await p.waitForTimeout(400);
const d3 = await cols();
check('刷新后仍是 5 天', d3.head === 6 && d3.body === 6, d3);
check('刷新后设置仍是关闭', d3.setting === false, d3.setting);

/* ---- 5. 设置页同一个开关 ---- */
await p.evaluate(() => { App.go('settings'); });
await p.waitForTimeout(500);
await p.evaluate(() => SettingsView.go('schedule'));
await p.waitForTimeout(450);
const st = await p.evaluate(() => {
  const sw = document.querySelector('#view-settings .cp-switch');
  return { exists: !!sw, on: sw ? sw.classList.contains('cp-on') : null, text: (document.querySelector('#view-settings') || {}).innerText || '' };
});
check('设置里有「课表显示」开关', st.exists === true, st);
check('设置里的开关与课表同步（当前关闭）', st.on === false, st.on);
check('设置页说明了不影响课程数据', /不会删除或隐藏周末的课程数据/.test(st.text), st.text.slice(0, 80));

await p.evaluate(() => {
  const sw = document.querySelector('#view-settings .cp-switch');
  sw.click();
});
await p.waitForTimeout(450);
const st2 = await p.evaluate(() => ({
  on: document.querySelector('#view-settings .cp-switch').classList.contains('cp-on'),
  setting: Store.settings.showWeekend
}));
check('设置里打开后写入设置', st2.on === true && st2.setting === true, st2);

await p.evaluate(() => App.go('schedule'));
await p.waitForTimeout(450);
const d4 = await cols();
check('回到课表恢复 7 天', d4.head === 8 && d4.body === 8, d4);

check('无控制台报错', errors.length === 0, errors.slice(0, 3));

await b.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
