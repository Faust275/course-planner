// 临时 e2e：验证「待办手动排序」——开启手动排序后可长按拖动调整顺序
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

// 清空并建 3 个顶层待办（纯叶子，无子任务）
const ids = await page.evaluate(() => {
  Store.state.tasks = [];
  var arr = ['甲', '乙', '丙'].map(t => Store.addTask({ title: '待办' + t, status: 'todo' }));
  return arr;
});
console.log('建好的待办 id:', ids);

await page.evaluate(() => App.go('tasks'));
await page.waitForSelector('#view-tasks .cp-task-row', { timeout: 5000 });
await page.waitForTimeout(200);

// 关新手引导 / 成就弹窗（真实老用户不会弹，仅测试环境清理）
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});

// 点击「手动排序」开关
const toggle = await page.evaluateHandle(() => {
  var btns = Array.from(document.querySelectorAll('#view-tasks .cp-filter-tab'));
  return btns.find(b => /手动排序/.test(b.innerText)) || null;
});
if (!toggle || await toggle.evaluate(n => !n)) { console.log('FAIL: 找不到手动排序开关'); await browser.close(); close(); process.exit(1); }
await toggle.click();
await page.waitForSelector('#view-tasks .cp-task-drag', { timeout: 5000 });
await page.waitForTimeout(150);

const diag = await page.evaluate(() => ({
  dragItems: document.querySelectorAll('#view-tasks .cp-task-drag').length,
  firstIsDragItem: (function(){ var c=document.querySelector('#view-tasks .cp-task-drag'); return c? c.classList.contains('cp-drag-item'):null; })(),
  storeOrder: (Store.state.tasks||[]).map(t => t.id)
}));
console.log('手动模式DIAG:', JSON.stringify(diag));

const before = await page.$$eval('#view-tasks .cp-task-drag', ns => ns.map(n => n.dataset.id));
console.log('拖动前顺序:', before);

const rows = await page.$$('#view-tasks .cp-task-drag');
const b0 = await rows[0].boundingBox();
const b1 = await rows[1].boundingBox();
const x0 = b0.x + b0.width / 2, y0 = b0.y + 18;
await page.mouse.move(x0, y0);
await page.mouse.down();
await page.mouse.move(x0 + 14, y0, { steps: 3 });           // 超过 6px 阈值触发拖动
const mid = await page.evaluate(() => ({
  ghost: !!document.querySelector('.cp-drag-ghost'),
  source: !!document.querySelector('.cp-task-drag.cp-drag-source')
}));
console.log('拖动中状态:', JSON.stringify(mid));
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 6, { steps: 8 });
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 4, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(250);

const afterDom = await page.$$eval('#view-tasks .cp-task-drag', ns => ns.map(n => n.dataset.id));
const afterStore = await page.evaluate(() => (Store.state.tasks||[]).map(t => t.id));
console.log('拖动后 DOM 顺序:', afterDom);
console.log('拖动后 Store 顺序:', afterStore);

// 断言：第一张挪到第二张之后（index 1），DOM 与 Store 一致
const domOk = afterDom.length === 3 && afterDom[0] === before[1] && afterDom[1] === before[0] && afterDom[2] === before[2];
const storeOk = afterStore.length === 3 && afterStore[0] === before[1] && afterStore[1] === before[0] && afterStore[2] === before[2];
console.log(domOk && storeOk ? 'PASS: 待办手动拖动排序生效' : 'FAIL: 待办顺序未变 / 不一致');

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();
process.exit(domOk && storeOk ? 0 : 1);
