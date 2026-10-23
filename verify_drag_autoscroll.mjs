// 临时 e2e：验证拖动边缘自动滚动——短视口下，把日历待办抽屉的行拖到「屏幕外」的日期格
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
// 故意用矮视口，让「日期格」和「待办抽屉」不可能同时可见
const page = await browser.newPage({ viewport: { width: 480, height: 600 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 8000 });

await page.evaluate(() => {
  Store.state.tasks = [];
  Store.addTask({ title: '交论文初稿', status: 'todo', dueDate: '2026-10-10' });
});

await page.evaluate(() => App.go('calendar'));
await page.waitForSelector('#view-calendar .cp-cal-cell', { timeout: 6000 });
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});
await page.evaluate(() => {
  var cell = document.querySelector('#view-calendar .cp-cal-cell[data-date="2026-10-15"]');
  if (cell) cell.click();
});
await page.waitForSelector('#view-calendar .cp-tb-drawer-row', { timeout: 5000 });
// 把抽屉行滚到视口中部，此时月份网格基本在屏幕外
await page.$eval('#view-calendar .cp-tb-drawer-row', n => n.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(200);

const stBefore = await page.$eval('.cp-view-wrap', n => n.scrollTop);
const row = await page.$('#view-calendar .cp-tb-drawer-row');
const rb = await row.boundingBox();
const viewRect = await page.$eval('.cp-view-wrap', n => { const r = n.getBoundingClientRect(); return { top: r.top, height: r.height }; });
// 确认目标格此刻在视口外
const cellVisibleBefore = await page.$eval('#view-calendar .cp-cal-cell[data-date="2026-10-20"]', n => {
  const r = n.getBoundingClientRect(); const vh = window.innerHeight;
  return r.bottom > 0 && r.top < vh;
});
console.log('起始 scrollTop:', stBefore, '目标格可见:', cellVisibleBefore);

const sx = rb.x + rb.width / 2, sy = rb.y + rb.height / 2;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx, sy - 14, { steps: 3 });
// 移动到视口上边缘并保持不动，让 rAF 自动向上滚
await page.mouse.move(sx, viewRect.top + 8, { steps: 6 });
await page.waitForTimeout(1100);
const stMid = await page.$eval('.cp-view-wrap', n => n.scrollTop);
const cellVisibleMid = await page.$eval('#view-calendar .cp-cal-cell[data-date="2026-10-20"]', n => {
  const r = n.getBoundingClientRect(); const vh = window.innerHeight;
  return r.bottom > 0 && r.top < vh;
});
console.log('边缘停留后 scrollTop:', stMid, '目标格可见:', cellVisibleMid, '已上滚:', stMid < stBefore);

// 滚到目标格可见后，移过去落下
const cb = await page.$eval('#view-calendar .cp-cal-cell[data-date="2026-10-20"]', n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);

const due = await page.evaluate(() => (Store.state.tasks[0] || {}).dueDate);
console.log('拖动后 dueDate:', due);
const scrolled = stMid < stBefore - 30;
const ok = scrolled && cellVisibleMid && due === '2026-10-20';
console.log(ok ? 'PASS: 边缘自动滚动 + 跨屏拖放生效' : 'FAIL: 自动滚动未生效 / 落点失败');

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();
process.exit(ok ? 0 : 1);
