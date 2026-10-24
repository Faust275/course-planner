// 单测：记账预算逻辑（在 Node vm 里加载真实 store.js，纯逻辑验证，不依赖浏览器）
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'assets/js/store.js'), 'utf8');

const sandbox = {};
sandbox.window = sandbox;            // store.js 末尾 })(window)
sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};   // 兜底 pagehide 监听
sandbox.setTimeout = function () { return 0; };
sandbox.clearTimeout = function () {};
sandbox.console = console;
sandbox.indexedDB = undefined;       // 触发 localStorage 回退
const ls = { _m: {}, getItem(k){return Object.prototype.hasOwnProperty.call(this._m,k)?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];}, key(i){return Object.keys(this._m)[i]||null;}, get length(){return Object.keys(this._m).length;} };
sandbox.localStorage = ls;

vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const Store = sandbox.Store;
const DateUtil = sandbox.DateUtil;
await Store.init();   // 加载默认 state（localStorage 为空 → defaultState）

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

// 注入一批 2026-10 的账目
Store.state.ledger = [
  { id: 'a1', type: 'expense', category: 'food', amount: 100, date: '2026-10-01', tags: [], note: '' },
  { id: 'a2', type: 'expense', category: 'transport', amount: 50, date: '2026-10-05', tags: [], note: '' },
  { id: 'a3', type: 'expense', category: 'food', amount: 200, date: '2026-10-10', tags: [], note: '' },
  { id: 'a4', type: 'expense', category: 'shopping', amount: 300, date: '2026-10-15', tags: [], note: '' },
  { id: 'a5', type: 'income', category: 'allowance', amount: 1000, date: '2026-10-20', tags: [], note: '' }
];

// 设预算：当月总 800，餐饮 250，交通 100
Store.setBudget({ monthly: 800, categories: { food: 250, transport: 100, shopping: 0 } });
const b = Store.getBudget();
check('getBudget 总预算=800', b.monthly === 800, b.monthly);
check('getBudget 分类只保留正数（shopping 0 被剔除）', !b.categories.shopping && b.categories.food === 250, JSON.stringify(b.categories));

const st = Store.ledgerBudgetStatus('2026-10');
check('当月支出=650', st.spent === 650, st.spent);
check('预算=800', st.budget === 800, st.budget);
check('剩余=150', st.remaining === 150, st.remaining);
check('未超支', st.over === false, st.over);
check('pct≈0.8125', Math.abs(st.pct - 650 / 800) < 1e-9, st.pct);
check('分类进度含 2 项（food/transport）', st.cats.length === 2, st.cats.length);
const food = st.cats.find(c => c.key === 'food');
const trans = st.cats.find(c => c.key === 'transport');
check('餐饮已花 300 > 预算 250 → 超支', food && food.over === true && Math.abs(food.pct - 1.2) < 1e-9, food && food.pct);
check('交通已花 50 < 预算 100 → 未超支', trans && trans.over === false && Math.abs(trans.pct - 0.5) < 1e-9, trans && trans.pct);

// 老数据缺 ledgerBudget 时回退默认
Store.state.settings.ledgerBudget = undefined;
const def = Store.getBudget();
check('缺字段回退默认（总预算 0）', def.monthly === 0 && typeof def.categories === 'object', JSON.stringify(def));
const stDef = Store.ledgerBudgetStatus('2026-10');
check('无预算时 remaining/pct 为 null', stDef.remaining === null && stDef.pct === null && stDef.over === false, JSON.stringify({r: stDef.remaining, p: stDef.pct, o: stDef.over}));

// 设为 0（不限）
Store.setBudget({ monthly: 0, categories: {} });
check('月预算 0 视为不限', Store.getBudget().monthly === 0, Store.getBudget().monthly);

// 报表环比依赖：上月统计 + DateUtil.addMonths/parse
Store.state.ledger.push({ id: 'a6', type: 'expense', category: 'food', amount: 120, date: '2026-09-12', tags: [], note: '' });
const prevYm = DateUtil.toStr(DateUtil.addMonths(DateUtil.parse('2026-10-01'), -1)).slice(0, 7);
check('上月在 2026-09', prevYm === '2026-09', prevYm);
const prevStats = Store.ledgerStats('2026-09');
const prevCats = Store.ledgerByCategory('2026-09');
check('上月支出=120', prevStats.expense === 120, prevStats.expense);
check('上月分类含餐饮 120', prevCats.length === 1 && prevCats[0].key === 'food' && prevCats[0].total === 120, JSON.stringify(prevCats));
check('本月餐饮=300（含 10 月数据）', Store.ledgerByCategory('2026-10').find(c => c.key === 'food').total === 300);

const allOk = results.every(r => r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
