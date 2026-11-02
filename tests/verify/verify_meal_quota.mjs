// e2e：三餐额度滚动预算 + 时段感知（早餐超了午晚收紧；过了点的餐次不再占额度）
// 所有时段断言都显式注入 nowMin，不依赖跑测试时的真实钟点。
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

const pick = (p, t) => (p && p.meals ? p.meals.filter((r) => r.type === t)[0] : null);

try {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.Store && window.App && window.DateUtil, null, { timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove()));

  const today = await page.evaluate(() => window.DateUtil.toStr(window.DateUtil.today()));
  const yesterday = await page.evaluate(() => window.DateUtil.toStr(window.DateUtil.addDays(window.DateUtil.today(), -1)));

  // ---------- 1) 没设目标就不打扰 ----------
  const none = await page.evaluate((d) => {
    window.Store.setDiet({ goal: 0, target: { mode: '', rate: 0.5 }, profile: {} });
    window.Store.state.meals = [];
    return window.Store.mealQuotaPlan(d, { nowMin: 8 * 60 });
  }, today);
  check('没设目标时不生成额度计划', none === null, JSON.stringify(none));

  // ---------- 2) 手设 2000，按 30/40/30 分 ----------
  const empty = await page.evaluate((d) => {
    window.Store.setDiet({
      goal: 2000,
      ratio: { breakfast: 30, lunch: 40, dinner: 30, snack: 0 },
      target: { mode: '', rate: 0.5 }
    });
    window.Store.state.meals = [];
    return window.Store.mealQuotaPlan(d, { nowMin: 8 * 60 });
  }, today);
  check('日预算取手设 2000', empty && empty.dailyGoal === 2000, empty && String(empty.dailyGoal));
  check('早餐计划 600 / 午餐 800 / 晚餐 600',
    pick(empty, 'breakfast').plan === 600 && pick(empty, 'lunch').plan === 800 && pick(empty, 'dinner').plan === 600,
    JSON.stringify(empty && empty.meals.map((r) => r.plan)));
  check('什么都没吃时，建议值等于计划值',
    pick(empty, 'breakfast').advised === 600 && pick(empty, 'lunch').advised === 800,
    JSON.stringify(empty && empty.meals.map((r) => r.advised)));
  check('剩余可分配 2000', empty && empty.rest === 2000, empty && String(empty.rest));

  // ---------- 2.5) 时段感知：过了点的那一餐不再白占额度 ----------
  // 下午 15:30（930）什么都没记：早午餐的时段都过了，额度整笔滚给晚餐
  const afternoon = await page.evaluate((d) => {
    window.Store.state.meals = [];
    return window.Store.mealQuotaPlan(d, { nowMin: 930 });
  }, today);
  check('15:30 未记早餐 → 标记为时段已过', pick(afternoon, 'breakfast').phase === 'past',
    pick(afternoon, 'breakfast').phase);
  check('15:30 未记午餐 → 标记为时段已过', pick(afternoon, 'lunch').phase === 'past',
    pick(afternoon, 'lunch').phase);
  check('15:30 晚餐尚未到点', pick(afternoon, 'dinner').phase === 'later',
    pick(afternoon, 'dinner').phase);
  check('已过的餐次不再分额度', pick(afternoon, 'lunch').advised === 0,
    String(pick(afternoon, 'lunch').advised));
  check('额度整笔滚给晚餐 2000', pick(afternoon, 'dinner').advised === 2000,
    String(pick(afternoon, 'dinner').advised));

  // 吃过午餐 700 但没记早餐 → 剩余 1300 全给晚餐，早餐不会来抢
  const afternoon2 = await page.evaluate((args) => {
    window.Store.state.meals = [];
    window.Store.addMeal({ date: args.d, time: '12:00', type: 'lunch', content: '午餐', kcal: 700 });
    return window.Store.mealQuotaPlan(args.d, { nowMin: 930 });
  }, { d: today });
  check('吃过午餐后剩余 1300 全给晚餐', pick(afternoon2, 'dinner').advised === 1300,
    String(pick(afternoon2, 'dinner').advised));
  check('此时早餐仍不参与分配', pick(afternoon2, 'breakfast').advised === 0,
    String(pick(afternoon2, 'breakfast').advised));

  // 05:00 早餐刚开时段 → 三餐都还在，按原配比分
  const dawn = await page.evaluate((d) => {
    window.Store.state.meals = [];
    return window.Store.mealQuotaPlan(d, { nowMin: 5 * 60 });
  }, today);
  check('05:00 早餐进入时段', pick(dawn, 'breakfast').phase === 'current', pick(dawn, 'breakfast').phase);
  check('05:00 三餐按原配比 600/800/600',
    pick(dawn, 'breakfast').advised === 600 && pick(dawn, 'lunch').advised === 800 && pick(dawn, 'dinner').advised === 600,
    JSON.stringify(dawn.meals.map((r) => r.advised)));

  // 23:00 全部时段已过 → 不再假装还有餐次在等你
  const night = await page.evaluate((d) => {
    window.Store.state.meals = [];
    return window.Store.mealQuotaPlan(d, { nowMin: 23 * 60 });
  }, today);
  check('23:00 三餐都标记为时段已过',
    ['breakfast', 'lunch', 'dinner'].every((t) => pick(night, t).phase === 'past'),
    JSON.stringify(night.meals.map((r) => r.phase)));

  // 补记：时段已过的餐次不给新额度，但保留原始计划当参照
  const backfill = await page.evaluate((args) => {
    window.Store.state.meals = [];
    window.Store.addMeal({ date: args.d, time: '12:00', type: 'lunch', content: '午餐', kcal: 700 });
    const ms = window.Store.state.meals.filter((m) => m.type === 'lunch');
    const id = ms[ms.length - 1].id;
    return { plan: window.Store.mealQuotaPlan(args.d, { nowMin: 930, excludeMealId: id }), id: id };
  }, { d: today });
  check('补记已过餐次：不给新额度（advised 0）但保留计划 800',
    pick(backfill.plan, 'lunch').advised === 0 && pick(backfill.plan, 'lunch').plan === 800,
    JSON.stringify(pick(backfill.plan, 'lunch')));
  check('补记已过餐次后，剩余仍是 2000（那条记录不吃额度）', backfill.plan.rest === 2000,
    String(backfill.plan.rest));

  // 回看历史日期：不滚动，按原始配比给参照
  const pastDay = await page.evaluate((d) => {
    window.Store.state.meals = [];
    return window.Store.mealQuotaPlan(d, { nowMin: 600 });
  }, yesterday);
  check('历史日期不滚动（mode=past-day）', pastDay.mode === 'past-day', pastDay.mode);
  check('历史日期按原始配比给计划值', pick(pastDay, 'lunch').advised === 800,
    String(pick(pastDay, 'lunch').advised));

  // ---------- 3) 早餐吃了 900（超 300）→ 午晚收紧 ----------
  const over = await page.evaluate((d) => {
    window.Store.addMeal({ date: d, time: '08:00', type: 'breakfast', content: '超量早餐', kcal: 900, cost: 0 });
    return window.Store.mealQuotaPlan(d, { nowMin: 8 * 60 });
  }, today);
  check('早餐标记为已吃 900', pick(over, 'breakfast').done === true && pick(over, 'breakfast').actual === 900,
    JSON.stringify(pick(over, 'breakfast')));
  check('剩余降到 1100', over.rest === 1100, String(over.rest));
  // 1100 × 40/70 = 628.6 → 629；1100 × 30/70 = 471.4 → 471
  check('午餐建议收紧到 629', pick(over, 'lunch').advised === 629, String(pick(over, 'lunch').advised));
  check('晚餐建议收紧到 471', pick(over, 'dinner').advised === 471, String(pick(over, 'dinner').advised));
  check('午晚建议之和正好等于剩余', pick(over, 'lunch').advised + pick(over, 'dinner').advised === over.rest,
    pick(over, 'lunch').advised + '+' + pick(over, 'dinner').advised + ' vs ' + over.rest);
  check('晚餐建议明显低于原计划（被早餐拖累）',
    pick(over, 'dinner').advised < pick(empty, 'dinner').plan,
    pick(over, 'dinner').advised + ' < ' + pick(empty, 'dinner').plan);

  // ---------- 4) 编辑早餐时不能把自己算进已吃 ----------
  const bfId = await page.evaluate(() => {
    const ms = window.Store.state.meals.filter((m) => m.type === 'breakfast');
    return ms[ms.length - 1].id;
  });
  const editing = await page.evaluate((args) => window.Store.mealQuotaPlan(args.d, { excludeMealId: args.id, nowMin: 8 * 60 }),
    { d: today, id: bfId });
  check('编辑早餐时把它排除后，早餐回到未完成', pick(editing, 'breakfast').done === false,
    JSON.stringify(pick(editing, 'breakfast')));
  check('排除后剩余仍是 2000（没把自己算进已吃）', editing.rest === 2000, String(editing.rest));
  check('排除后早餐建议回到 600', pick(editing, 'breakfast').advised === 600, String(pick(editing, 'breakfast').advised));

  // ---------- 5) 三餐都记满 → 全部完成，剩余反映真实差额 ----------
  const full = await page.evaluate((d) => {
    window.Store.addMeal({ date: d, time: '12:00', type: 'lunch', content: '午餐', kcal: 700, cost: 0 });
    window.Store.addMeal({ date: d, time: '18:30', type: 'dinner', content: '晚餐', kcal: 500, cost: 0 });
    return window.Store.mealQuotaPlan(d, { nowMin: 8 * 60 });
  }, today);
  check('三餐全部完成', full.doneCount === 3, String(full.doneCount));
  check('总摄入 2100，超出 100', full.eaten === 2100 && full.over === 100,
    JSON.stringify({ eaten: full.eaten, over: full.over }));
  check('没有未完成餐次时不再分配建议',
    full.meals.filter((r) => !r.done).every((r) => r.advised === 0),
    JSON.stringify(full.meals.map((r) => r.advised)));

  // ---------- 6) 健康页渲染 ----------
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.App.go('health'));
  await page.waitForTimeout(900);
  const txt = await page.evaluate(() => {
    const root = document.querySelector('#view-health');
    return root ? root.textContent : '';
  });
  check('健康页出现「今日三餐额度」', txt.indexOf('今日三餐额度') >= 0, txt.slice(0, 100));
  check('健康页列出三餐', ['早餐', '午餐', '晚餐'].every((x) => txt.indexOf(x) >= 0));
  check('健康页给出剩余/超支结论', txt.indexOf('今天已超') >= 0 || txt.indexOf('今天还剩') >= 0);

  // ---------- 7) 记饮食弹窗的提示跟着走 ----------
  await page.evaluate(() => { window.Store.state.meals = []; });
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 6000 });
  const hint = await page.evaluate(() => {
    const box = document.querySelector('.cp-fg-hint');
    const row = document.querySelector('.cp-fg-row');
    const note = document.querySelector('.cp-fg-note');
    return { hint: box ? box.textContent : '', row: row ? row.textContent : '', note: note ? note.textContent : '' };
  });
  check('弹窗显示「这一餐建议」', /这一餐建议/.test(hint.row), hint.row);
  check('弹窗同时给出「记完还剩/会超」', /记完还剩|记完会超/.test(hint.hint), hint.hint);
  check('弹窗说明这一餐按什么时段口径给', /.+–.+|开始/.test(hint.note), hint.note);

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
