// 临时 e2e：待办↔日历桥接——把日历「待办抽屉」里的待办拖到日期格，改截止日期
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 2400 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 8000 });

// 建一条 2026-10-10 到期的待办
const taskId = await page.evaluate(() => {
  Store.state.tasks = [];
  return Store.addTask({ title: '交论文初稿', status: 'todo', dueDate: '2026-10-10' });
});
console.log('待办 id:', taskId);

await page.evaluate(() => App.go('calendar'));
await page.waitForSelector('#view-calendar .cp-cal-cell', { timeout: 6000 });
await page.waitForTimeout(200);
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});

// 选中 10-15，让「待办抽屉」出现
await page.evaluate(() => {
  var cell = document.querySelector('#view-calendar .cp-cal-cell[data-date="2026-10-15"]');
  if (cell) cell.click();
});
await page.waitForSelector('#view-calendar .cp-tb-drawer-row', { timeout: 5000 });
await page.waitForTimeout(200);

const diag = await page.evaluate(() => ({
  rows: document.querySelectorAll('#view-calendar .cp-tb-drawer-row').length,
  rowHasDrag: (function(){ var r=document.querySelector('#view-calendar .cp-tb-drawer-row'); return r? r.classList.contains('cp-drag-item'):null; })(),
  due: (Store.state.tasks[0]||{}).dueDate,
  rowText: (function(){ var r=document.querySelector('#view-calendar .cp-tb-drawer-row'); return r? r.innerText.replace(/\s+/g,' ').trim().slice(0,40):''; })()
}));
console.log('抽屉DIAG:', JSON.stringify(diag));

const row = await page.$('#view-calendar .cp-tb-drawer-row');
const rb = await row.boundingBox();
const cellBox = await page.$eval('#view-calendar .cp-cal-cell[data-date="2026-10-20"]', n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });

const sx = rb.x + rb.width / 2, sy = rb.y + rb.height / 2;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx, sy - 14, { steps: 3 });
const mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.cp-drag-ghost') }));
console.log('拖动中:', JSON.stringify(mid));
await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { steps: 12 });
const hot = await page.evaluate(() => !!document.querySelector('#view-calendar .cp-cal-cell.cp-drop-cell'));
console.log('悬停高亮:', hot);
await page.mouse.up();
await page.waitForTimeout(300);

const afterDue = await page.evaluate(() => (Store.state.tasks[0] || {}).dueDate);
console.log('拖动后 dueDate:', afterDue);
const ok = afterDue === '2026-10-20';
console.log(ok ? 'PASS: 待办拖到日期格改截止日生效' : 'FAIL: 截止日未改 / 异常');

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();
process.exit(ok ? 0 : 1);
