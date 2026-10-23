// 临时 e2e：三个新功能——首次拖动引导、跨视图接力（待办→日历）、拖到月份导航翻月改期
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra ? '  ' + extra : ''));
}

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 8000 });

// 清掉引导标记 & 数据
await page.evaluate(() => {
  try { Object.keys(localStorage).filter(k => k.indexOf('cp_hint_') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
  Store.state.tasks = [];
  ['接力用的待办', '第二条待办'].forEach(t => Store.addTask({ title: t, status: 'todo', dueDate: '' }));
});
await page.evaluate(() => App.go('tasks'));
await page.waitForSelector('#view-tasks .cp-task-row', { timeout: 5000 });
await page.waitForTimeout(150);

/* ---------- 1) 首次拖动引导气泡 ---------- */
await page.evaluate(() => {
  var b = Array.from(document.querySelectorAll('#view-tasks .cp-filter-tab')).find(x => /手动排序/.test(x.innerText));
  if (b) b.click();
});
await page.waitForSelector('#view-tasks .cp-task-drag', { timeout: 5000 });
const hint = await page.waitForSelector('#toastRoot .cp-toast-hint', { timeout: 4000 }).catch(() => null);
const hintText = hint ? await hint.evaluate(n => n.innerText.replace(/\s+/g, ' ').trim()) : '';
check('首次开启手动排序弹出引导', !!hint && /长按待办卡片/.test(hintText), hintText);
if (hint) {
  await page.click('#toastRoot .cp-toast-hint .cp-toast-act');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => { try { return localStorage.getItem('cp_hint_tasks-drag'); } catch (e) { return null; } });
  check('点「知道了」写入本地标记', saved === '1', String(saved));
  const still = await page.$('#toastRoot .cp-toast-hint');
  check('引导气泡点击后关闭', !still);
}

/* ---------- 2) 跨视图接力：把待办拖到「日历」入口 ---------- */
await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(300);
const card = (await page.$$('#view-tasks .cp-task-drag'))[0];
const cb = await card.boundingBox();
const navBox = await page.$eval('#nav-calendar', n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const sx = cb.x + cb.width / 2, sy = cb.y + 18;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx - 14, sy, { steps: 3 });
await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);

const activeAfterRelay = await page.evaluate(() => (document.querySelector('.cp-view.cp-active') || {}).id || 'none');
check('拖到日历入口后切到日历', activeAfterRelay === 'view-calendar', activeAfterRelay);
const hl = await page.$('#view-calendar .cp-relay-hl').catch(() => null);
const hlText = hl ? await hl.evaluate(n => n.innerText.replace(/\s+/g, ' ').trim()) : '';
check('日历高亮接力过来的待办', !!hl && /接力用的待办/.test(hlText), hlText);

/* ---------- 3) 拖到月份导航 → 翻月并改到同日 ---------- */
await page.setViewportSize({ width: 520, height: 1100 });
await page.waitForTimeout(200);
const dates = await page.evaluate(() => {
  var d = DateUtil.today();
  var y = d.getFullYear(), m = d.getMonth();
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  var ds = y + '-' + p2(m + 1) + '-15';
  var ny = y, nm = m + 1; if (nm > 11) { nm = 0; ny++; }
  var dim = new Date(ny, nm + 1, 0).getDate();
  var day = Math.min(15, dim);
  var exp = ny + '-' + p2(nm + 1) + '-' + p2(day);
  Store.state.events = [];
  var ev = Store.addEvent({ title: '翻月测试', date: ds, start: '10:00', end: '11:00' });
  return { ds: ds, exp: exp, id: ev.id, expMonth: nm + 1 };
});
await page.evaluate(() => App.go('calendar'));
await page.waitForSelector('#view-calendar .cp-cal-cell[data-date="' + dates.ds + '"]', { timeout: 6000 });
// 首次建日程可能触发成就弹窗，挡住真实指针；清掉再拖
await page.evaluate(() => {
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});
await page.waitForTimeout(200);
await page.evaluate((ds) => {
  var c = document.querySelector('#view-calendar .cp-cal-cell[data-date="' + ds + '"]');
  if (c) c.click();
}, dates.ds);
await page.waitForTimeout(350);

const evRow = page.locator('#view-calendar .cp-cal-line', { hasText: '翻月测试' }).first();
await evRow.waitFor();
const erb = await evRow.boundingBox();
const nextBox = await page.$eval('#view-calendar [data-cal-nav="next"]', n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const ex = erb.x + erb.width / 2, ey = erb.y + erb.height / 2;
await page.mouse.move(ex, ey);
await page.mouse.down();
await page.mouse.move(ex, ey - 14, { steps: 3 });
await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2, { steps: 10 });
const navHot = await page.evaluate(() => !!document.querySelector('#view-calendar .cp-cal-nav-hot'));
console.log('悬停翻月按钮高亮:', navHot);
await page.mouse.up();
await page.waitForTimeout(500);

const after = await page.evaluate((id) => {
  var e = (Store.state.events || []).filter(x => x.id === id)[0] || {};
  var head = document.querySelector('#view-calendar .cp-week-label span');
  return { date: e.date, head: head ? head.textContent : '' };
}, dates.id);
check('拖到「›」改到相邻月同日', after.date === dates.exp, after.date + ' expect=' + dates.exp);
check('日历已切到目标月', after.head.indexOf(dates.expMonth + ' 月') >= 0, after.head);

if (errors.length) console.log('页面错误:', errors.slice(0, 6));
await browser.close();
close();
const allOk = results.every(r => r.ok);
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exit(allOk ? 0 : 1);
