// 临时 e2e：拖动增强——震动反馈、可撤销、右键/长按/键盘「移动到…」菜单
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1600 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// 震动 spy（在页面脚本执行前注入）
await page.addInitScript(() => {
  window.__vib = [];
  try {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: function (v) { window.__vib.push(v); return true; }
    });
  } catch (e) {
    try { navigator.vibrate = function (v) { window.__vib.push(v); return true; }; } catch (_) {}
  }
});

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 8000 });

await page.evaluate(() => {
  Store.state.tasks = [];
  ['甲', '乙', '丙'].forEach(t => Store.addTask({ title: '待办' + t, status: 'todo', dueDate: '' }));
});
await page.evaluate(() => App.go('tasks'));
await page.waitForSelector('#view-tasks .cp-task-row', { timeout: 5000 });
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});
// 开启手动排序
await page.evaluate(() => {
  var b = Array.from(document.querySelectorAll('#view-tasks .cp-filter-tab')).find(x => /手动排序/.test(x.innerText));
  if (b) b.click();
});
await page.waitForSelector('#view-tasks .cp-task-drag', { timeout: 5000 });
await page.waitForTimeout(150);

const order = () => page.$$eval('#view-tasks .cp-task-drag', ns => ns.map(n => n.dataset.id));
const dueOf = (title) => page.evaluate(t => (Store.state.tasks.find(x => x.title === t) || {}).dueDate, title);

async function clearToasts() {
  await page.evaluate(() => document.querySelectorAll('.cp-toast-action').forEach(n => n.remove()));
}
// 关闭菜单：点弹窗自带的关闭按钮（不要按 Escape——测试环境里的新手引导监听会把它当成「结束引导」并跳回默认视图）
async function esc() {
  await page.evaluate(() => {
    var btns = document.querySelectorAll('.cp-modal-head .cp-icon-btn');
    if (btns.length) btns[btns.length - 1].click();
    else document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  });
  await page.waitForTimeout(280);
}

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra ? '  ' + extra : ''));
}

/* ---------- 1) 拖动 + 震动 + 撤销 ---------- */
const before = await order();
const rows = await page.$$('#view-tasks .cp-task-drag');
const b0 = await rows[0].boundingBox();
const b1 = await rows[1].boundingBox();
const x0 = b0.x + b0.width / 2, y0 = b0.y + 18;
await page.mouse.move(x0, y0);
await page.mouse.down();
await page.mouse.move(x0 + 14, y0, { steps: 3 });
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 6, { steps: 8 });
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 4, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(250);

const afterDrag = await order();
const changed = afterDrag[0] === before[1] && afterDrag[1] === before[0];
check('拖动改变顺序', changed, JSON.stringify(afterDrag));

const vib = await page.evaluate(() => window.__vib || []);
check('拖动开始触发震动反馈', vib.indexOf(8) >= 0, 'vib=' + JSON.stringify(vib));

const hasUndoToast = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
check('落点出现「撤销」提示', !!hasUndoToast);
if (hasUndoToast) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(300);
  const restored = await order();
  check('点击撤销恢复原顺序', restored.join(',') === before.join(','), JSON.stringify(restored));
}
await clearToasts();

/* ---------- 2) 右键菜单 → 移到明天 → 撤销 ---------- */
const tomorrow = await page.evaluate(() => DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 1)));
const row2 = (await page.$$('#view-tasks .cp-task-drag'))[1];
await row2.click({ button: 'right' });
await page.waitForSelector('.cp-modal .cp-move-item', { timeout: 4000 });
const menuLabels = await page.$$eval('.cp-modal .cp-move-item .cp-move-item-label', ns => ns.map(n => n.textContent.trim()));
check('右键打开「移动到…」菜单', menuLabels.length >= 2, JSON.stringify(menuLabels));

await page.click('.cp-modal .cp-move-item:has-text("移到明天")');
await page.waitForTimeout(300);
const due1 = await dueOf('待办乙');
check('菜单「移到明天」改截止日', due1 === tomorrow, 'due=' + due1 + ' expect=' + tomorrow);

const undoBtn = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
check('改期后出现撤销提示', !!undoBtn);
if (undoBtn) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(300);
  const dueBack = await dueOf('待办乙');
  check('撤销恢复截止日', dueBack === '', 'due=' + JSON.stringify(dueBack));
}
await clearToasts();
await esc();

/* ---------- 2b) 菜单排序：下移一位 / 移到最前 + 撤销 ---------- */
const ordBase = await order();
await page.evaluate(() => { var w = document.querySelector('.cp-view-wrap'); if (w) w.scrollTop = 0; });
await page.waitForTimeout(200);
let rr2 = (await page.$$('#view-tasks .cp-task-drag'))[1];
await rr2.click({ button: 'right' });
await page.waitForSelector('.cp-modal .cp-move-item', { timeout: 4000 });
await page.click('.cp-modal .cp-move-item:has-text("下移一位")');
await page.waitForTimeout(300);
const ordDown = await order();
check('菜单「下移一位」生效', ordDown[1] === ordBase[2] && ordDown[2] === ordBase[1], JSON.stringify(ordDown));
let ub2 = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
if (ub2) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(300);
  const back = await order();
  check('撤销恢复排序（下移）', back.join(',') === ordBase.join(','), JSON.stringify(back));
}
await clearToasts();

const ordBase2 = await order();
rr2 = (await page.$$('#view-tasks .cp-task-drag'))[2];
await rr2.click({ button: 'right' });
await page.waitForSelector('.cp-modal .cp-move-item', { timeout: 4000 });
await page.click('.cp-modal .cp-move-item:has-text("移到最前")');
await page.waitForTimeout(300);
const ordTop = await order();
check('菜单「移到最前」生效', ordTop[0] === ordBase2[2], JSON.stringify(ordTop));
ub2 = await page.$('#toastRoot .cp-toast-action .cp-toast-act');
if (ub2) {
  await page.click('#toastRoot .cp-toast-action .cp-toast-act');
  await page.waitForTimeout(300);
  const back2 = await order();
  check('撤销恢复排序（置顶）', back2.join(',') === ordBase2.join(','), JSON.stringify(back2));
}
await clearToasts();
await esc();

/* ---------- 3) 长按不动 → 打开菜单（且不触发拖动） ---------- */
await page.evaluate(() => { var w = document.querySelector('.cp-view-wrap'); if (w) w.scrollTop = 0; });
await page.waitForTimeout(300);
const orderB4Long = await order();
const lr = (await page.$$('#view-tasks .cp-task-drag'))[1];
await lr.scrollIntoViewIfNeeded();
const lb = await lr.boundingBox();
if (!lb) { console.log('FAIL: 长按用例取不到卡片位置'); }
const lx = lb.x + lb.width / 2, ly = lb.y + lb.height / 2;
await page.mouse.move(lx, ly);
await page.mouse.down();
await page.waitForTimeout(800);           // 超过 550ms 长按阈值
const lpMenu = await page.$$eval('.cp-modal .cp-move-item', ns => ns.length).catch(() => 0);
check('长按不动打开菜单', lpMenu > 0, 'items=' + lpMenu);
await page.mouse.up();
await page.waitForTimeout(200);
const orderAfterLong = await order();
check('长按不误触发拖动', orderAfterLong.join(',') === orderB4Long.join(','), JSON.stringify(orderAfterLong));
await esc();

/* ---------- 4) 键盘 Shift+F10 → 打开菜单 ---------- */
await page.focus('#view-tasks .cp-task-drag');
await page.keyboard.down('Shift');
await page.keyboard.press('F10');
await page.keyboard.up('Shift');
await page.waitForTimeout(300);
const kbMenu = await page.$$eval('.cp-modal .cp-move-item', ns => ns.length).catch(() => 0);
check('键盘 Shift+F10 打开菜单', kbMenu > 0, 'items=' + kbMenu);
await esc();

if (errors.length) console.log('页面错误:', errors.slice(0, 6));
await browser.close();
close();
const allOk = results.every(r => r.ok);
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exit(allOk ? 0 : 1);
