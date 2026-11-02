// e2e：填克数自动算热量 + 自适应消耗（体重趋势反推 TDEE）
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

try {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.Store && window.App && window.DateUtil && window.MealDialog, null, { timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove()));
  const today = await page.evaluate(() => window.DateUtil.toStr(window.DateUtil.today()));

  // ---------- 1) 克数输入 → 自动热量 ----------
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 5000 });

  await page.fill('.cp-modal input[placeholder*="搜食物"]', '米饭');
  await page.waitForSelector('.cp-food-item', { timeout: 5000 });
  await page.click('.cp-food-item');

  await page.waitForSelector('.cp-fp-row', { timeout: 5000 });
  const picked = await page.evaluate(() => {
    const row = document.querySelector('.cp-fp-row');
    const q = row && row.querySelector('.cp-fp-q');
    const unit = row && row.querySelector('.cp-fp-x');
    return { q: q ? Number(q.value) : null, unit: unit ? unit.textContent : '' };
  });
  check('选「米饭」默认填入 200 克', picked.q === 200, JSON.stringify(picked));
  check('单位显示为「克」', picked.unit === '克', picked.unit);

  // 改成 100 克 → 232/200*100 ≈ 116 kcal
  await page.fill('.cp-fp-row .cp-fp-q', '100');
  await page.waitForTimeout(150);
  const sumTxt = await page.evaluate(() => {
    const b = document.querySelector('.cp-food-sum .cp-fs-line b');
    return b ? b.textContent : '';
  });
  const kcal100 = Number(sumTxt);
  check('100 克米饭 ≈ 116 kcal', Math.abs(kcal100 - 116) <= 1, '实际 ' + sumTxt);

  // 保存并核对落库
  await page.fill('.cp-modal input[placeholder*="鸡腿饭"]', '克数测试');
  await page.click('.cp-modal-foot .cp-btn-primary');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 6000 });
  const saved = await page.evaluate(() => {
    const ms = window.Store.state.meals;
    const m = ms[ms.length - 1];
    return m && m.items && m.items[0] ? { u: m.items[0].u, q: m.items[0].q, kcal: m.kcal } : null;
  });
  check('明细按克存储（u=g, q=100）', saved && saved.u === 'g' && saved.q === 100, JSON.stringify(saved));
  check('整餐热量 ≈ 116 kcal', saved && Math.abs(saved.kcal - 116) <= 1, saved && String(saved.kcal));

  // ---------- 2) 自适应消耗 ----------
  const adaptive = await page.evaluate(() => {
    const D = window.DateUtil;
    const t = D.today();
    const wl = [], ms = [];
    for (let i = 20; i >= 0; i--) {
      const ds = D.toStr(D.addDays(t, -i));
      wl.push({ id: 'w' + i, date: ds, kg: 70 - (20 - i) * 0.05 });
      ms.push({ id: 'm' + i, date: ds, time: '12:00', type: 'lunch', content: '测试', kcal: 2000, cost: 0, items: [], tags: [], note: '' });
    }
    window.Store.state.weightLog = wl;
    window.Store.state.meals = ms;
    const a = window.Store.estimateTDEEAdaptive();
    const h = window.Store.dayHealth(D.toStr(t));
    return { a, source: h.tdeeSource, tdeeAdaptive: h.tdeeAdaptive, tdeeFormula: h.tdeeFormula };
  });
  check('自适应 TDEE 有结果', !!adaptive.a, JSON.stringify(adaptive.a));
  check('每天 2000 kcal、21 天掉 1kg → TDEE 约 2200~2550',
    adaptive.a && adaptive.a.tdee >= 2200 && adaptive.a.tdee <= 2550,
    adaptive.a && String(adaptive.a.tdee));
  check('dayHealth 采用实测消耗', adaptive.source === 'adaptive', adaptive.source);
  check('同时保留公式值做对照', adaptive.tdeeFormula == null || typeof adaptive.tdeeFormula === 'number', String(adaptive.tdeeFormula));

  // ---------- 3) 健康看板联动卡片渲染 ----------
  await page.evaluate(() => window.App.go('health'));
  await page.waitForTimeout(700);
  const healthOk = await page.evaluate(() => {
    const root = document.querySelector('#view-health');
    return !!root && root.textContent.indexOf('饮食 × 睡眠 × 体重') >= 0;
  });
  check('健康看板渲染「饮食 × 睡眠 × 体重」卡片', healthOk);

  check('无页面异常', errors.length === 0, errors[0]);
} catch (e) {
  fail++;
  console.log('  ✗ 异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
} finally {
  await browser.close();
  close();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
