// 临时 e2e：验证「计划卡片」长按拖动排序（真实 Pointer 事件 + 落点提交 Store）
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
const diag = await page.evaluate(() => ({
  Store: typeof window.Store, App: typeof window.App, DG: typeof window.DragGesture,
  cards: document.querySelectorAll('#view-plans .cp-plan-card').length,
  bodyLen: document.body.innerHTML.length
}));
console.log('DIAG:', JSON.stringify(diag));
if (errors.length) console.log('早期错误:', errors.slice(0, 8));
await page.waitForFunction(() => window.Store && window.App && window.DragGesture, null, { timeout: 8000 });

// 清空并建 3 个计划
await page.evaluate(() => {
  Store.state.plans = [];
  ['一', '二', '三'].forEach(t => Store.addPlan({ title: '计划' + t, type: 'checkin', period: 'once' }));
});
await page.evaluate(() => App.go('plans'));
await page.waitForSelector('#view-plans .cp-plan-card', { timeout: 5000 });
await page.waitForTimeout(150);
// 关掉首次运行的新手引导遮罩（真实用户引导结束后不影响拖动）
await page.evaluate(() => {
  document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach(n => n.remove());
});

const before = await page.$$eval('#view-plans .cp-plan-card', ns => ns.map(n => n.dataset.id));
console.log('拖动前顺序:', before);

// 把第一张拖到第二张之后（确定性落点）
const cards = await page.$$('#view-plans .cp-plan-card');
const b0 = await cards[0].boundingBox();
const b1 = await cards[1].boundingBox();
const x0 = b0.x + b0.width / 2, y0 = b0.y + 18;
await page.evaluate(() => {
  window.__pe = [];
  document.addEventListener('pointerdown', e => { window.__pe.push('down:' + (e.target.className || '').toString().slice(0, 28)); }, true);
  document.addEventListener('pointermove', e => { window.__pe.push('move'); }, true);
});
await page.mouse.move(x0, y0);
await page.mouse.down();
await page.mouse.move(x0 + 14, y0, { steps: 3 });           // 超过 6px 阈值
const midDrag = await page.evaluate(() => ({
  ghost: !!document.querySelector('.cp-drag-ghost'),
  source: !!document.querySelector('.cp-plan-card.cp-drag-source'),
  pe: (window.__pe || []).slice(0, 6)
}));
console.log('拖动中状态:', JSON.stringify(midDrag));
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 6, { steps: 8 });  // 移到第二张底部
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 4, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(200);

const after = await page.$$eval('#view-plans .cp-plan-card', ns => ns.map(n => n.dataset.id));
console.log('拖动后顺序:', after);
const modalsAfterPlans = await page.evaluate(() => document.querySelectorAll('.cp-modal-wrap').length);
console.log('计划拖动后残留弹窗数:', modalsAfterPlans);

// 断言：第一张从 0 位挪到了第二张之后（index 1）
const ok = after.length === 3 && after[0] === before[1] && after[1] === before[0] && after[2] === before[2];
console.log(ok ? 'PASS: 计划拖动排序生效' : 'FAIL: 顺序未变 / 异常');

// ---- 目标卡片拖动（同引擎，分区内重排） ----
await page.evaluate(() => {
  Store.state.goals = [];
  // 首次建目标会触发「成就解锁」弹窗，模态遮罩会把接下来的拖动整个拦下。
  // 这里按老用户（成就已解锁）来处理，本用例只验证拖动排序；
  // 成就解锁本身的逻辑由 verify_goals 的 K 段覆盖，不会丢。
  Store.state.achievements = Store.state.achievements || {};
  Store.state.achievements.done = Store.state.achievements.done || {};
  (Store.achievementList ? Store.achievementList() : []).forEach(function (a) {
    if (a && a.id) Store.state.achievements.done[a.id] = { at: Date.now() };
  });
  ['甲', '乙', '丙'].forEach(t => Store.addGoal({ title: '目标' + t, period: 'custom', startDate: '2026-01-01', endDate: '2026-12-31' }));
  var v = App.views.find(function (x) { return x.id === 'plans'; });
  if (v && v.setTab) v.setTab('goals');
});
await page.waitForTimeout(300);
const gDiag = await page.evaluate(() => ({
  goals: (Store.state.goals || []).length,
  cards: document.querySelectorAll('#view-plans .cp-goal-card').length,
  activeList: !!document.querySelector('#view-plans .cp-goal-active-list'),
  firstHasDrag: (function(){ var c=document.querySelector('#view-plans .cp-goal-card'); return c? c.classList.contains('cp-drag-item'):null; })(),
  firstClasses: (function(){ var c=document.querySelector('#view-plans .cp-goal-card'); return c? c.className:null; })(),
  elAtTop: (function(){
    var c=document.querySelector('#view-plans .cp-goal-card');
    if(!c) return 'no-card';
    var r=c.getBoundingClientRect();
    var x=r.x+r.width/2, y=r.y+18;
    var e=document.elementFromPoint(x,y);
    return e? (e.className||e.tagName).toString().slice(0,40) : 'null';
  })(),
  modalCount: document.querySelectorAll('.cp-modal-wrap').length,
  modalText: (function(){ var m=document.querySelector('.cp-modal-wrap .cp-modal'); return m? m.innerText.slice(0,80):null; })()
}));
console.log('目标DIAG:', JSON.stringify(gDiag));
await page.waitForSelector('#view-plans .cp-goal-active-list .cp-goal-card', { timeout: 5000 });
await page.waitForTimeout(150);
const gBefore = await page.$$eval('#view-plans .cp-goal-active-list .cp-goal-card', ns => ns.map(n => n.dataset.id));
// 关闭首次建目标触发的「成就解锁」弹窗（真实老用户已解锁，不会弹）
await page.evaluate(() => {
  document.querySelectorAll('.cp-modal-wrap').forEach(n => n.remove());
  var s = document.getElementById('scrim'); if (s) s.classList.remove('cp-show');
});
console.log('目标拖动前:', gBefore);
const gcards = await page.$$('#view-plans .cp-goal-active-list .cp-goal-card');
// 目标卡片高约 245px，第二张默认整块落在视口外（y≈1050 > 视口 950）。
// 不滚进视口就给 mouse.move 喂视口外坐标，落点判定拿不到 drop 指示，顺序自然不变。
await gcards[1].scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
const gb0 = await gcards[0].boundingBox();
const gb1 = await gcards[1].boundingBox();
const gx0 = gb0.x + gb0.width / 2, gy0 = gb0.y + 18;
await page.mouse.move(gx0, gy0);
await page.mouse.down();
await page.mouse.move(gx0 + 14, gy0, { steps: 3 });
const gMid = await page.evaluate(() => ({ ghost: !!document.querySelector('.cp-drag-ghost'), source: !!document.querySelector('.cp-goal-card.cp-drag-source') }));
console.log('目标拖动中:', JSON.stringify(gMid));
await page.mouse.move(gb1.x + gb1.width / 2, gb1.y + gb1.height - 6, { steps: 8 });
await page.mouse.move(gb1.x + gb1.width / 2, gb1.y + gb1.height - 4, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(200);
const gAfter = await page.$$eval('#view-plans .cp-goal-active-list .cp-goal-card', ns => ns.map(n => n.dataset.id));
console.log('目标拖动后:', gAfter);
const gok = gAfter.length === 3 && gAfter[0] === gBefore[1] && gAfter[1] === gBefore[0] && gAfter[2] === gBefore[2];
console.log(gok ? 'PASS: 目标拖动排序生效' : 'FAIL: 目标顺序未变 / 异常');

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();
process.exit(ok && gok ? 0 : 1);
