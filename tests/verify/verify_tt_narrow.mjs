// Playwright 端到端：手机窄屏 + 隐藏周末 → 周一到周五必须一屏放下
// 覆盖：柱宽不超屏、无横向滚动、5 列等宽、时间列收窄、7 列模式仍可横滑
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8302/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
  await p.waitForTimeout(600);
}

const geom = () => p.evaluate(() => {
  const box = document.querySelector('#view-schedule .cp-grid-scroll');
  const table = document.querySelector('#view-schedule table.cp-tt');
  if (!box || !table) return null;
  const ths = [...table.querySelectorAll('thead th')];
  const cells = [...table.querySelectorAll('tbody tr:first-child td')];
  return {
    boxW: box.clientWidth,
    scrollW: box.scrollWidth,
    tableW: Math.round(table.getBoundingClientRect().width),
    timeW: ths[0] ? Math.round(ths[0].getBoundingClientRect().width) : 0,
    dayW: cells[1] ? Math.round(cells[1].getBoundingClientRect().width) : 0,
    head: ths.length,
    body: cells.length,
    cls: table.className
  };
});

await boot();

/* ---- 1. 隐藏周末 ---- */
await p.evaluate(() => { Store.updateSettings({ showWeekend: false }); });
await p.waitForTimeout(500);
let g = await geom();
check('表格存在', !!g, g);
check('隐藏周末后 6 列（时间 + 周一至周五）', g && g.head === 6 && g.body === 6, g);
check('带 no-weekend 类', g && /no-weekend/.test(g.cls), g && g.cls);
check('表格宽度不超过可视区', g && g.scrollW <= g.boxW + 1, g);
check('没有横向滚动（scrollWidth ≈ clientWidth）', g && Math.abs(g.scrollW - g.boxW) <= 1, g);
check('时间列收窄到 38px', g && g.timeW >= 34 && g.timeW <= 42, g);
check('每天一列 60-80px', g && g.dayW >= 58 && g.dayW <= 82, g);
check('5 列总和基本铺满', g && Math.abs((g.timeW + g.dayW * 5) - g.boxW) <= 6, g);

/* ---- 2. 展开周末：允许横滑，但不该把页面顶宽 ---- */
await p.evaluate(() => { Store.updateSettings({ showWeekend: true }); });
await p.waitForTimeout(500);
g = await geom();
check('展开后恢复 8 列', g && g.head === 8 && g.body === 8, g);
check('7 列模式表格宽于屏幕（可横滑）', g && g.scrollW > g.boxW + 20, g);
const pageOverflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('页面本身没有横向溢出', pageOverflow <= 1, pageOverflow);

/* ---- 3. 刷新后仍是隐藏周末且不溢出 ---- */
await p.evaluate(() => { Store.updateSettings({ showWeekend: false }); });
await p.waitForTimeout(300);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => App.go('schedule'));
await p.waitForTimeout(600);
g = await geom();
check('刷新后仍是 6 列且不溢出', g && g.head === 6 && g.scrollW <= g.boxW + 1, g);

check('无 JS 报错', errors.length === 0, errors);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
await b.close();
process.exit(fail ? 1 : 0);
