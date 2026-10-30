// e2e：「我的活动」界面——今日进度、7 天趋势、汇总、14 天明细、手动补录、空态
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.waitForTimeout(400);

// 跳过新手引导（若还在）
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(300);

const result = await page.evaluate(() => {
  const out = {};
  const today = DateUtil.toStr(DateUtil.today());
  const twoAgo = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2));

  Store.state.metrics = [];
  Store.addMetrics([
    { date: today, steps: 10000, calories: 320, distance: 7000 },
    { date: twoAgo, steps: 3000, calories: 90, distance: 2100 }
  ]);

  out.rows = Store.state.metrics.length;
  out.todayRec = Store.getMetric(today);

  // 老档没有 metrics 字段时要能补回来（否则 getMetric 会 filter undefined 抛错）
  delete Store.state.metrics;
  Store.ensure();
  out.metricsRestored = Array.isArray(Store.state.metrics);
  // ensure 可能重置数据，重新灌一遍
  Store.state.metrics = [];
  Store.addMetrics([
    { date: today, steps: 10000, calories: 320, distance: 7000 },
    { date: twoAgo, steps: 3000, calories: 90, distance: 2100 }
  ]);

  // 手动记录必须能覆盖当天 hc 数据，且不会被后续 hc 同步冲掉
  Store.addMetrics([{ date: today, steps: 12000, calories: 400, distance: 8600 }]);  // hc：应覆盖
  out.afterHc = Store.getMetric(today).steps;
  Store.addMetric({ date: today, steps: 4321, calories: 111, distance: 3000, source: 'manual' });
  out.afterManual = Store.getMetric(today).steps;
  Store.addMetrics([{ date: today, steps: 9999, calories: 999, distance: 9999 }]);    // hc：不应覆盖手动
  out.manualKept = Store.getMetric(today).steps;

  // 还原成展示用的数据
  Store.state.metrics = [];
  Store.addMetrics([
    { date: today, steps: 10000, calories: 320, distance: 7000 },
    { date: twoAgo, steps: 3000, calories: 90, distance: 2100 }
  ]);
  return out;
});

await page.evaluate(() => App.go('health', { tab: 'activity' }));
await page.waitForTimeout(500);

const ui = await page.evaluate(() => {
  const view = document.querySelector('#activityPane');
  if (!view) return { missing: true };
  const cards = [...view.querySelectorAll('.cp-card')];
  return {
    missing: false,
    hero: cards[0] ? cards[0].innerText : '',
    bars: view.querySelectorAll('.cp-cb-col').length,
    rowCount: view.querySelectorAll('.cp-rec-row').length,
    full: view.innerText
  };
});

console.log('今日卡:\n' + (ui.hero || '(无)'));
console.log('柱子数:', ui.bars, '明细行数:', ui.rowCount);

const ok = [
  ['Store.addMetrics 落盘两条', result.rows === 2],
  ['老档缺 metrics 会补成数组', result.metricsRestored === true],
  ['hc 同步可覆盖 hc 旧值', result.afterHc === 12000],
  ['手动记录覆盖 hc', result.afterManual === 4321],
  ['hc 同步不覆盖手动', result.manualKept === 4321],
  ['活动视图已挂载', !ui.missing],
  ['今日步数渲染 10,000', (ui.hero || '').includes('10,000')],
  ['超出目标时进度封顶 100% 且提示达成', (ui.hero || '').includes('100%') && (ui.hero || '').includes('已达成')],
  ['三指标含距离公里', (ui.hero || '').includes('7.0')],
  ['7 天趋势柱数正确', ui.bars === 7],
  ['明细 14 行', ui.rowCount === 14],
  ['汇总含最活跃日', (ui.full || '').includes('最活跃是')]
];

// 手动补录：入口在视图右上角工具栏（不在 #activityPane 内），按文本全局找
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === '手动记录');
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const modalOpened = await page.evaluate(() => !!document.querySelector('.cp-modal'));
if (modalOpened) {
  const inputs = await page.$$('.cp-modal input.cp-input');
  if (inputs[0]) { await inputs[0].fill('6500'); }
  if (inputs[1]) { await inputs[1].fill('200'); }
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('.cp-modal button')]
      .find((b) => b.textContent.trim() === '保存');
    if (save) save.click();
  });
  await page.waitForTimeout(400);
}
const afterEdit = await page.evaluate(() => {
  const m = Store.getMetric(DateUtil.toStr(DateUtil.today()));
  return { steps: m && m.steps, source: m && m.source };
});
ok.push(['手动记录弹窗可打开', modalOpened]);
ok.push(['手动保存为 manual 且数值正确', afterEdit.steps === 6500 && afterEdit.source === 'manual']);

await page.screenshot({ path: '/tmp/activity-filled.png', fullPage: true }).catch(() => {});

// 空态：清空后应出现引导卡且不报错
await page.evaluate(() => { Store.state.metrics = []; Store.emit(); App.go('health', { tab: 'activity' }); });
await page.waitForTimeout(400);
const empty = await page.evaluate(() => {
  const v = document.querySelector('#activityPane');
  return v ? v.innerText : '';
});
ok.push(['空态有引导文案', empty.includes('怎么拿到数据')]);

let fail = 0;
for (const [name, pass] of ok) {
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name);
  if (!pass) fail++;
}
if (errors.length) { console.log('页面错误:', errors.slice(0, 5)); fail++; }

await page.screenshot({ path: '/tmp/activity-view.png', fullPage: true }).catch(() => {});
await browser.close();
close();

console.log(fail ? `\nHAS FAILURE (${fail})` : '\nALL PASS');
process.exit(fail ? 1 : 0);
