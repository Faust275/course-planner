// e2e：按体重目标反推建议摄入（实测消耗 + 目标缺口）
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
  await page.waitForFunction(() => window.Store && window.App && window.DateUtil, null, { timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove()));

  // ---------- 1) 没开目标时不应该有建议 ----------
  const off = await page.evaluate(() => {
    window.Store.setDiet({ target: { mode: '', rate: 0.5 } });
    return window.Store.dietSuggest();
  });
  check('未启用目标时不给建议', off === null, JSON.stringify(off));

  // ---------- 2) 只有公式数据时的建议 ----------
  const formula = await page.evaluate(() => {
    window.Store.setDiet({
      target: { mode: 'lose', rate: 0.5 },
      profile: { sex: 'male', age: 25, height: 175, weight: 70, activity: '1.375' }
    });
    window.Store.state.weightLog = [];
    window.Store.state.meals = [];
    return window.Store.dietSuggest();
  });
  check('只有公式时也给出建议', !!formula && formula.source === 'formula', JSON.stringify(formula && formula.source));
  check('公式来源下目标缺口为 −550 kcal/天',
    !!formula && formula.gapKcal === -550, formula && String(formula.gapKcal));
  check('公式建议 = 公式消耗 − 550',
    !!formula && Math.abs(formula.suggestedKcal - (formula.tdee - 550)) <= 0, JSON.stringify(formula));

  // ---------- 3) 记满两周后改用实测消耗 ----------
  const adaptive = await page.evaluate(() => {
    const D = window.DateUtil;
    const t = D.today();
    const wl = [], ms = [];
    for (let i = 20; i >= 0; i--) {
      const ds = D.toStr(D.addDays(t, -i));
      wl.push({ id: 'w' + i, date: ds, kg: 70 - (20 - i) * 0.05 });   // 21 天掉 1kg
      ms.push({ id: 'm' + i, date: ds, time: '12:00', type: 'lunch', content: '测试', kcal: 2000, cost: 0, items: [], tags: [], note: '' });
    }
    window.Store.state.weightLog = wl;
    window.Store.state.meals = ms;
    const s = window.Store.dietSuggest();
    const h = window.Store.dayHealth(D.toStr(t));
    return {
      s: s,
      dayGoal: h.dietKcalGoal,
      daySuggest: h.dietSuggest,
      bonus: h.dietBonusKcal,
      source: h.tdeeSource
    };
  });
  // TDEE = 2000 + 1×7700/21 ≈ 2367；减脂 0.5kg/周 → −550 → 约 1817
  check('实测消耗 ≈ 2367 kcal',
    adaptive.s && adaptive.s.tdee >= 2340 && adaptive.s.tdee <= 2400, adaptive.s && String(adaptive.s.tdee));
  check('建议摄入 ≈ 1817 kcal（实测 − 550）',
    adaptive.s && adaptive.s.suggestedKcal >= 1790 && adaptive.s.suggestedKcal <= 1845,
    adaptive.s && String(adaptive.s.suggestedKcal));
  check('来源标记为实测', adaptive.s && adaptive.s.source === 'adaptive', adaptive.s && adaptive.s.source);
  check('算出最近实际速率约 −0.33 kg/周',
    adaptive.s && Math.abs(adaptive.s.actualRate + 0.33) <= 0.05, adaptive.s && String(adaptive.s.actualRate));

  // ---------- 4) dayHealth 采用建议值 ----------
  check('dayHealth 的每日目标等于建议值',
    adaptive.dayGoal === (adaptive.s && adaptive.s.suggestedKcal), JSON.stringify({ goal: adaptive.dayGoal, s: adaptive.s && adaptive.s.suggestedKcal }));
  check('实测模式下不再叠加运动加成（避免重复）', adaptive.bonus === 0, String(adaptive.bonus));

  // ---------- 5) 换目标模式，建议跟着变 ----------
  const modes = await page.evaluate(() => {
    const out = {};
    ['maintain', 'gain'].forEach((m) => {
      window.Store.setDiet({ target: { mode: m, rate: 0.5 } });
      out[m] = window.Store.dietSuggest();
    });
    return out;
  });
  check('维持模式建议 = 实测消耗（缺口 0）',
    modes.maintain && modes.maintain.gapKcal === 0 && modes.maintain.suggestedKcal === modes.maintain.tdee,
    JSON.stringify(modes.maintain));
  check('增肌模式建议 = 实测消耗 + 550',
    modes.gain && modes.gain.gapKcal === 550, modes.gain && String(modes.gain.gapKcal));

  // ---------- 6) 健康页渲染建议 ----------
  await page.evaluate(() => {
    window.Store.setDiet({ target: { mode: 'lose', rate: 0.5 } });
    window.App.go('health');
  });
  await page.waitForTimeout(800);
  const cardText = await page.evaluate(() => {
    const root = document.querySelector('#view-health');
    return root ? root.textContent : '';
  });
  check('健康页出现「今日建议」', cardText.indexOf('今日建议') >= 0, cardText.slice(0, 120));
  check('健康页标明目标模式（减脂）', cardText.indexOf('减脂') >= 0);
  check('健康页给出实测消耗依据', cardText.indexOf('实测消耗') >= 0);

  // ---------- 7) 关掉目标后回到手设值 ----------
  const back = await page.evaluate(() => {
    const D = window.DateUtil;
    window.Store.setDiet({ goal: 2000, target: { mode: '', rate: 0.5 } });
    const h = window.Store.dayHealth(D.toStr(D.today()));
    return { goal: h.dietKcalGoal, suggest: h.dietSuggest };
  });
  check('关闭联动后回到手设的 2000', back.goal === 2000 && back.suggest === null, JSON.stringify(back));

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
