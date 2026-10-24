// 单测：记账 × 饮食（foodSpend 汇总 + addMeal 自动入账本）
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.setTimeout = function () { return 0; }; sandbox.clearTimeout = function () {};
sandbox.console = console; sandbox.indexedDB = undefined;
sandbox.document = { hidden: false, addEventListener: function () {} };
const ls = {
  _m: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; },
  key(i) { return Object.keys(this._m)[i] || null; }, get length() { return Object.keys(this._m).length; }
};
sandbox.localStorage = ls;
sandbox.UI = { el: () => ({}), svg: () => ({}), $: () => null, toast: () => {} };

vm.createContext(sandbox);
vm.runInContext(read('assets/js/sleep-model.js'), sandbox);
vm.runInContext(read('assets/js/store.js'), sandbox);

const Store = sandbox.Store;
const DateUtil = sandbox.DateUtil;
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

const today = DateUtil.toStr(DateUtil.today());
const d1 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
const d2 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2));
const old = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -40));

Store.state.meals.length = 0;
Store.state.ledger.length = 0;

/* ---------- 1. 空状态 ---------- */
let f = Store.foodSpend(30);
check('没有饮食记录 → has=false', f.has === false, f.has);

/* ---------- 2. 基本汇总 ---------- */
Store.addMeal({ date: today, type: 'lunch', content: '食堂', cost: 15, kcal: 700 });
Store.addMeal({ date: today, type: 'dinner', content: '外卖', cost: 25, kcal: 900 });
Store.addMeal({ date: d1, type: 'breakfast', content: '包子', cost: 5, kcal: 300 });
Store.addMeal({ date: d2, type: 'lunch', content: '自带', cost: 0, kcal: 600 });
Store.addMeal({ date: old, type: 'dinner', content: '上个月', cost: 99, kcal: 800 });

f = Store.foodSpend(30);
check('窗口内 4 顿', f.count === 4, f.count);
check('合计花费 45', f.cost === 45, f.cost);
check('合计热量 2500', f.kcal === 2500, f.kcal);
check('有花费的天数 2', f.costDays === 2, f.costDays);
check('日均花费按「有花费的天」算 = 22.5', f.perDayCost === 22.5, f.perDayCost);
check('有热量的天数 3（今天两顿算一天）', f.kcalDays === 3, f.kcalDays);
check('日均热量 833', f.perDayKcal === 833, f.perDayKcal);
check('每千卡 18 元（45 元 / 2.5 千卡）', f.costPer1k === 18, f.costPer1k);
check('没记花费的顿数 1', f.freeMeals === 1, f.freeMeals);
check('最贵的一天是今天（40）', f.top && f.top.date === today && f.top.cost === 40, JSON.stringify(f.top));
check('40 天前那顿不进窗口', f.cost === 45);

/* ---------- 3. 按餐型拆分 ---------- */
check('午餐 2 顿 / 15 元', f.byType.lunch && f.byType.lunch.n === 2 && f.byType.lunch.cost === 15,
  JSON.stringify(f.byType.lunch));
check('晚餐 1 顿 / 25 元（不含 40 天前那笔）',
  f.byType.dinner && f.byType.dinner.n === 1 && f.byType.dinner.cost === 25,
  JSON.stringify(f.byType.dinner));

/* ---------- 4. addMeal 自动记账（写入链路） ---------- */
const foodEntries = Store.state.ledger.filter((e) => e.category === 'food');
check('有花费的饮食自动进账本（含窗口外那笔）', foodEntries.length === 4, foodEntries.length);
check('自动账目金额与饮食一致',
  foodEntries.reduce((s, e) => s + e.amount, 0) === 144,
  foodEntries.map((e) => e.amount).join(','));
check('自动账目带 source=meal 与 refId', foodEntries.every((e) => e.source === 'meal' && e.refId));
check('0 元那顿不产生账目',
  foodEntries.every((e) => e.amount > 0) &&
  Store.state.ledger.filter((e) => e.amount === 0).length === 0);
check('自动账目日期与饮食一致',
  foodEntries.some((e) => e.date === d1) && foodEntries.filter((e) => e.date === today).length === 2);

/* ---------- 5. 不同窗口 ---------- */
check('窗口 1 天只算今天 2 顿', Store.foodSpend(1).count === 2, Store.foodSpend(1).count);
check('窗口 3 天算 4 顿', Store.foodSpend(3).count === 4, Store.foodSpend(3).count);
check('窗口 60 天能看到 40 天前那顿', Store.foodSpend(60).count === 5, Store.foodSpend(60).count);

const fail = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
