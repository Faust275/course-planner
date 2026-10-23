// 临时 e2e：quotes 惰性加载 / 保存去抖 + 大图外置 / schema 迁移
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra ? '  ' + extra : ''));
}

await page.goto(base + '/index.html#/schedule', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.evaluate(() => { document.querySelectorAll('.cp-ob-mask,.ob-mask').forEach(n => n.remove()); });

/* ---------- 1) quotes 惰性加载 ---------- */
// 首次加载时新手引导会遍历视图（其中含今日），先把引导标记为已完成再重载，
// 才能复现「从课表深链接进入」的真实场景
await page.evaluate(async () => { Store.updateSettings({ guided: true }); await Store.flushSave(); });
await page.goto(base + '/index.html?fresh=1#/schedule', { waitUntil: 'load' });
await page.waitForTimeout(1400);
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
const lazyBefore = await page.evaluate(() => typeof window.Daily);
check('从课表进入时不展开语料', lazyBefore === 'undefined', 'typeof Daily=' + lazyBefore);
await page.evaluate(() => App.go('today'));
await page.waitForTimeout(600);
const lazyAfter = await page.evaluate(() => ({
  type: typeof window.Daily,
  poems: (window.Daily && Daily.poems.length) || 0,
  cards: document.querySelectorAll('#view-today .cp-daily-card').length
}));
check('进入今日后才加载语料', lazyAfter.type === 'object' && lazyAfter.poems > 0, JSON.stringify(lazyAfter));
check('今日页每日卡片正常渲染', lazyAfter.cards > 0, 'cards=' + lazyAfter.cards);

/* ---------- 2) 保存去抖 ---------- */
await page.evaluate(() => {
  window.__saves = [];
  var orig = Store.persist.save;
  Store.persist.save = function (k, v) {
    if (k === 'course-planner:v1') window.__saves.push(Date.now());
    return orig.apply(this, arguments);
  };
});
await page.evaluate(() => { for (var i = 0; i < 5; i++) Store.emit(); });
await page.waitForTimeout(120);
const during = await page.evaluate(() => (window.__saves || []).length);
await page.waitForTimeout(350);
const afterDebounce = await page.evaluate(() => (window.__saves || []).length);
check('连续 5 次变更合并为 1 次写入', during === 0 && afterDebounce === 1, 'during=' + during + ' after=' + afterDebounce);

/* ---------- 3) 大图外置 + 重启恢复 ---------- */
const BG_LEN = 300000;
await page.evaluate(async (len) => {
  Store.state.tasks = [];
  Store.addTask({ title: '大图测试', status: 'todo' });
  Store.state.settings.background.dataUrl = 'data:image/png;base64,' + 'A'.repeat(len);
  await Store.flushSave();
}, BG_LEN);
const persisted = await page.evaluate(async () => {
  var raw = await Store.persist.load('course-planner:v1');
  var obj = JSON.parse(raw);
  var blob = await Store.persist.load('cp-blob-background');
  return { bgInState: (obj.settings.background.dataUrl || '').length, blobLen: (blob || '').length, jsonLen: raw.length };
});
check('主状态不再包含大图', persisted.bgInState === 0, JSON.stringify(persisted));
check('大图单独落盘', persisted.blobLen > BG_LEN, 'blob=' + persisted.blobLen);
check('主状态体积保持很小', persisted.jsonLen < 200000, 'jsonLen=' + persisted.jsonLen);

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1600);
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
const restored = await page.evaluate(() => ({
  bgLen: (Store.state.settings.background.dataUrl || '').length,
  blob: null
}));
check('重启后大图从独立存储恢复', restored.bgLen > BG_LEN, 'bg=' + restored.bgLen);

/* ---------- 4) schema 迁移 ---------- */
const mig = await page.evaluate(() => {
  var st = JSON.parse(Store.exportJSON());
  st.version = 2;
  (st.tasks || []).forEach(function (t) { delete t.order; });
  if (st.pomodoro && st.pomodoro.timer) delete st.pomodoro.timer.queue;
  st.settings.background = { dataUrl: '', mask: 0.5 };
  st.settings.pet = { src: '' };
  Store.importJSON(JSON.stringify(st));
  var s = Store.state;
  return {
    version: s.version,
    allOrdered: (s.tasks || []).every(function (t) { return typeof t.order === 'number'; }),
    queueArr: Array.isArray(s.pomodoro.timer.queue)
  };
});
check('v2 数据升级到 v3', mig.version === 3, JSON.stringify(mig));
check('迁移补齐 order 与队列字段', mig.allOrdered && mig.queueArr, JSON.stringify(mig));

if (errors.length) console.log('页面错误:', errors.slice(0, 6));
await browser.close();
close();
const allOk = results.every(r => r.ok);
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exit(allOk ? 0 : 1);
