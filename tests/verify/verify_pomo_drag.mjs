// 临时 e2e：验证「待办拖进番茄钟圆环」——把待办 chip 拖到计时器圆环即关联
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1400 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 8000 });

// 清空并建 2 个顶层待办
const ids = await page.evaluate(() => {
  Store.state.tasks = [];
  return ['写报告', '背单词'].map(t => Store.addTask({ title: t, status: 'todo' }));
});
console.log('待办 id:', ids);

await page.evaluate(() => App.go('pomodoro'));
await page.waitForSelector('#view-pomodoro .cp-pomo-chip', { timeout: 6000 });
await page.waitForTimeout(200);
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});

const diag = await page.evaluate(() => ({
  chips: document.querySelectorAll('#view-pomodoro .cp-pomo-chip').length,
  hasRing: !!document.querySelector('#view-pomodoro .cp-timer-ring-wrap'),
  chipFirstHasDragItem: (function(){ var c=document.querySelector('#view-pomodoro .cp-pomo-chip'); return c? c.classList.contains('cp-drag-item'):null; })(),
  beforeTaskBar: !!document.querySelector('#view-pomodoro .cp-timer-task')
}));
console.log('专注页DIAG:', JSON.stringify(diag));

const chips = await page.$$('#view-pomodoro .cp-pomo-chip');
const chipBox = await chips[0].boundingBox();
const ringBox = await page.$eval('#view-pomodoro .cp-timer-ring-wrap', n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });

const cx = chipBox.x + chipBox.width / 2, cy = chipBox.y + chipBox.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx, cy - 14, { steps: 3 });   // 越过阈值启动拖动
const mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.cp-drag-ghost') }));
console.log('拖动中:', JSON.stringify(mid));
const rx = ringBox.x + ringBox.width / 2, ry = ringBox.y + ringBox.height / 2;
await page.mouse.move(rx, ry, { steps: 10 });
const overDrop = await page.evaluate(() => !!document.querySelector('#view-pomodoro .cp-timer-ring-wrap.cp-drop-active'));
console.log('悬停圆环高亮:', overDrop);
await page.mouse.up();
await page.waitForTimeout(300);

const after = await page.evaluate(() => ({
  taskBar: (function(){ var n=document.querySelector('#view-pomodoro .cp-timer-task'); return n? n.innerText.trim():''; })(),
  activeChips: Array.from(document.querySelectorAll('#view-pomodoro .cp-pomo-chip.cp-active')).map(n => n.innerText.trim()),
  dropActive: !!document.querySelector('#view-pomodoro .cp-timer-ring-wrap.cp-drop-active')
}));
console.log('拖动后:', JSON.stringify(after));

const ok = /正在专注/.test(after.taskBar) && after.taskBar.indexOf('写报告') >= 0 &&
           after.activeChips.length === 1 && after.activeChips[0] === '写报告' && !after.dropActive;
console.log(ok ? 'PASS: 待办拖入番茄钟生效' : 'FAIL: 未关联 / 高亮残留');

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();
process.exit(ok ? 0 : 1);
