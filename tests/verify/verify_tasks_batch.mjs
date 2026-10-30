// 临时 e2e：待办多选——整组拖动、批量删除、单条删除撤销
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
await page.addStyleTag({ content: '*{scroll-behavior:auto !important;}' });

await page.evaluate(() => {
  Store.state.tasks = [];
  ['批甲', '批乙', '批丙', '批丁'].forEach(t => Store.addTask({ title: t, status: 'todo' }));
});
await page.evaluate(() => App.go('tasks'));
await page.waitForSelector('#view-tasks .cp-task-row', { timeout: 5000 });
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});
await page.evaluate(() => {
  var b = Array.from(document.querySelectorAll('#view-tasks .cp-filter-tab')).find(x => /手动排序/.test(x.innerText));
  if (b) b.click();
});
await page.waitForSelector('#view-tasks .cp-task-drag', { timeout: 5000 });
await page.evaluate(() => {
  var h = document.querySelector('#toastRoot .cp-toast-hint .cp-toast-act');
  if (h) h.click();
});
await page.waitForTimeout(200);

const order = () => page.$$eval('#view-tasks .cp-task-drag', ns => ns.map(n => n.dataset.id));
const titles = () => page.$$eval('#view-tasks .cp-task-drag .cp-task-title', ns => ns.map(n => n.textContent.trim()));

// 进入多选
await page.evaluate(() => {
  var b = Array.from(document.querySelectorAll('#view-tasks .cp-filter-tab')).find(x => x.innerText.trim() === '多选');
  if (b) b.click();
});
await page.waitForTimeout(250);
check('多选模式出现勾选框', (await page.$$eval('#view-tasks .cp-task-selbox', ns => ns.length)) === 4);

// 勾选前两条
const cards0 = await page.$$('#view-tasks .cp-task-drag');
await cards0[0].click();
await page.waitForTimeout(150);
const cards1 = await page.$$('#view-tasks .cp-task-drag');
await cards1[1].click();
await page.waitForTimeout(250);
const barText = await page.$eval('#view-tasks .cp-task-bulkbar', n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
check('操作条显示已选 2 项', /已选 2 项/.test(barText), barText);
check('选中卡片高亮 2 张', (await page.$$eval('#view-tasks .cp-task-drag.cp-selected', ns => ns.length)) === 2);

// 整组拖动：把第一条拖到最末
const beforeGroup = await order();
const dragCard = page.locator('#view-tasks .cp-task-drag', { hasText: '批甲' }).first();
const dropCard = page.locator('#view-tasks .cp-task-drag', { hasText: '批丁' }).first();
// 落点卡片必须在视口内，否则 mouse.move 收到视口外坐标，落点判定不触发
await dragCard.scrollIntoViewIfNeeded();
await dropCard.scrollIntoViewIfNeeded();

const b0 = await dragCard.boundingBox();
const b3 = await dropCard.boundingBox();
const x0 = b0.x + b0.width / 2, y0 = b0.y + 18;
await page.mouse.move(x0, y0);
await page.mouse.down();
await page.mouse.move(x0, y0 + 14, { steps: 3 });
await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height - 4, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
const afterGroup = await order();
const t2 = await titles();
const groupOk = t2.length === 4 && t2[0] === '批丙' && t2[1] === '批丁' &&
  [t2[2], t2[3]].sort().join(',') === ['批甲', '批乙'].sort().join(',');
check('整组拖动保持相对顺序并落到末尾', groupOk, JSON.stringify(t2));

const toast1 = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
if (toast1) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(350);
}
check('撤销整组移动', (await order()).join(',') === beforeGroup.join(','), JSON.stringify(await order()));

// 批量删除（选择仍在）
check('撤销后选择保留', /已选 2 项/.test(await page.$eval('#view-tasks .cp-task-bulkbar', n => n.innerText).catch(() => '')));
await page.click('#view-tasks .cp-task-bulkbar button:has-text("删除")');
await page.waitForSelector('.cp-modal .cp-btn-danger', { timeout: 4000 });
await page.click('.cp-modal .cp-btn-danger');
await page.waitForTimeout(500);
const afterDel = await titles();
check('批量删除移除选中 2 条', afterDel.length === 2 && afterDel.indexOf('批丙') >= 0 && afterDel.indexOf('批丁') >= 0, JSON.stringify(afterDel));

const toast2 = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
if (toast2) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(400);
}
const restored = await titles();
check('撤销批量删除恢复 4 条', restored.length === 4, JSON.stringify(restored));

// 单条删除 + 撤销
const cardC = page.locator('#view-tasks .cp-task-drag', { hasText: '批丙' }).first();
await cardC.click();
await page.waitForSelector('.cp-modal', { timeout: 4000 });
await page.click('.cp-modal .cp-btn-danger');
await page.waitForTimeout(450);
await page.click('.cp-modal .cp-btn-danger');   // 确认弹窗的「删除」
await page.waitForTimeout(500);
const afterOne = await titles();
check('单条删除移除 1 条', afterOne.length === 3 && afterOne.indexOf('批丙') < 0, JSON.stringify(afterOne));

const toast3 = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
if (toast3) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(400);
}
const finalTitles = await titles();
check('撤销单条删除恢复', finalTitles.length === 4 && finalTitles.indexOf('批丙') >= 0, JSON.stringify(finalTitles));

if (errors.length) console.log('页面错误:', errors.slice(0, 6));
await browser.close();
close();
const allOk = results.every(r => r.ok);
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exit(allOk ? 0 : 1);
