// 临时 e2e：验证「日历月视图·事件拖到别的日格改期」
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 1400 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 10000 });
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  // 建一个本月事件
  var ev = Store.addEvent({ title: '测试日程', date: '2026-10-10', start: '10:00', end: '11:00' });
  window.__evId = ev.id;
});
await page.evaluate(() => App.go('calendar'));
await page.waitForSelector('#view-calendar', { timeout: 5000 });
await page.waitForTimeout(150);
// 选中源日（让 dayDetail 列出该事件）
await page.click('#view-calendar [data-date="2026-10-10"]');
await page.waitForTimeout(150);
const row = page.locator('#view-calendar .cp-cal-line', { hasText: '测试日程' });
await row.waitFor({ timeout: 5000 });
const rb = await row.boundingBox();
// 目标日格
await page.waitForSelector('#view-calendar [data-date="2026-10-20"]', { timeout: 5000 });
const tb = await (await page.$('#view-calendar [data-date="2026-10-20"]')).boundingBox();

await page.mouse.move(rb.x + rb.width / 2, rb.y + 12);
await page.mouse.down();
await page.mouse.move(rb.x + rb.width / 2 + 14, rb.y + 12, { steps: 3 });
const mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.cp-drag-ghost'), source: !!document.querySelector('.cp-cal-line.cp-drag-source') }));
console.log('拖动中:', JSON.stringify(mid));
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 10 });
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 + 2, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(250);

const newDate = await page.evaluate(() => {
  var ev = Store.state.events.find(function (e) { return e.id === window.__evId; });
  return ev ? ev.date : null;
});
console.log('事件改期后 date:', newDate);
const ok = newDate === '2026-10-20';
console.log(ok ? 'PASS: 日历事件拖到别的日格改期生效' : 'FAIL: 改期未生效');
if (errors.length) console.log('页面错误:', errors.slice(0, 5));

await browser.close();
close();
process.exit(ok ? 0 : 1);
