// 临时 e2e：专注队列——菜单/拖放入队、移除、开始下一个、刷新后仍在
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1400 } });
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

const ids = await page.evaluate(() => {
  Store.state.tasks = [];
  Store.saveTimer({ running: false, endAt: 0, left: 0, duration: 45, taskId: '', tags: '', treeId: '', queue: [] });
  return ['队列甲', '队列乙', '队列丙'].map(t => Store.addTask({ title: t, status: 'todo' }));
});
await page.evaluate(() => App.go('pomodoro'));
await page.waitForSelector('#view-pomodoro .cp-pomo-chip', { timeout: 6000 });
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});

const qCount = () => page.$$eval('#view-pomodoro .cp-pomo-qchip', ns => ns.length);
const timerQueue = () => page.evaluate(() => (Store.state.pomodoro.timer.queue || []).slice());

// 菜单入队：甲、乙
async function enqueueByMenu(title) {
  const chip = page.locator('#view-pomodoro .cp-pomo-chip', { hasText: title }).first();
  await chip.click({ button: 'right' });
  await page.waitForSelector('.cp-modal .cp-move-item', { timeout: 4000 });
  await page.click('.cp-modal .cp-move-item:has-text("加入专注队列")');
  await page.waitForTimeout(350);
}
await enqueueByMenu('队列甲');
await enqueueByMenu('队列乙');
check('菜单入队 2 条', (await qCount()) === 2, 'q=' + await qCount());
check('队列写入 timer 状态', (await timerQueue()).length === 2, JSON.stringify(await timerQueue()));

// 拖放入队：丙
const chipC = page.locator('#view-pomodoro .cp-pomo-chip', { hasText: '队列丙' }).first();
const cb = await chipC.boundingBox();
const qb = await page.$eval('#view-pomodoro .cp-pomo-queue', n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const sx = cb.x + cb.width / 2, sy = cb.y + cb.height / 2;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx, sy - 14, { steps: 3 });
await page.mouse.move(qb.x + qb.width / 2, qb.y + qb.height / 2, { steps: 10 });
const hot = await page.evaluate(() => !!document.querySelector('#view-pomodoro .cp-pomo-queue.cp-drop-active'));
await page.mouse.up();
await page.waitForTimeout(350);
check('拖进队列高亮', hot);
check('拖放入队后 3 条', (await qCount()) === 3, 'q=' + await qCount());

// 移除第一条
await page.click('#view-pomodoro .cp-pomo-qchip .cp-pomo-qchip-x');
await page.waitForTimeout(300);
check('移除后剩 2 条', (await qCount()) === 2, 'q=' + await qCount());

// 开始下一个
const beforeQueue = await timerQueue();
await page.click('#view-pomodoro button:has-text("开始下一个")');
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  taskId: (Store.state.pomodoro.timer || {}).taskId || '',
  queue: (Store.state.pomodoro.timer.queue || []).slice(),
  bar: (function () { var n = document.querySelector('#view-pomodoro .cp-timer-task'); return n ? n.innerText.trim() : ''; })(),
  running: !!(Store.state.pomodoro.timer || {}).running
}));
check('开始下一个切换当前任务', after.taskId === beforeQueue[0] && /正在专注/.test(after.bar), JSON.stringify(after));
check('开始后队列减一', after.queue.length === beforeQueue.length - 1, JSON.stringify(after.queue));
check('计时已启动', after.running === true);

// 刷新后队列仍在
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1600);
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.evaluate(() => App.go('pomodoro'));
await page.waitForTimeout(500);
const restored = await page.evaluate(() => ({
  queue: (Store.state.pomodoro.timer.queue || []).slice(),
  chips: document.querySelectorAll('#view-pomodoro .cp-pomo-qchip').length
}));
check('刷新后队列恢复', restored.queue.length === after.queue.length && restored.chips === after.queue.length, JSON.stringify(restored));

if (errors.length) console.log('页面错误:', errors.slice(0, 6));
await browser.close();
close();
const allOk = results.every(r => r.ok);
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exit(allOk ? 0 : 1);
