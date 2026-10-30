// 单测：健康 KR 自动打勾（sleep/active）—— Node vm 加载真实 store.js，stub dayHealth
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'assets/js/store.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.setTimeout = function () { return 0; }; sandbox.clearTimeout = function () {};
sandbox.console = console; sandbox.indexedDB = undefined;
const ls = { _m:{}, getItem(k){return Object.prototype.hasOwnProperty.call(this._m,k)?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];}, key(i){return Object.keys(this._m)[i]||null;}, get length(){return Object.keys(this._m).length;} };
sandbox.localStorage = ls;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Store = sandbox.Store;
const DateUtil = sandbox.DateUtil;
await Store.init();

const results = [];
function check(name, cond, extra) { results.push({name, ok:!!cond}); console.log((cond?'PASS: ':'FAIL: ')+name+(extra!==undefined?'  → '+extra:'')); }

const today = DateUtil.toStr(DateUtil.today());
const start = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -6));
const days = [];
(function () { var d = DateUtil.parse(start), e = DateUtil.parse(today); while (d <= e) { days.push(DateUtil.toStr(d)); d = DateUtil.addDays(d, 1); } })();
check('周期共 7 天', days.length === 7, days.length);

// 前 5 天睡够，后 2 天没睡够
const sleepMet = new Set(days.slice(0, 5));
Store.dayHealth = function (ds) { return { sleepMet: sleepMet.has(ds), stepPct: 0 }; };

function goal(kind, target) {
  return { id: 'g1', title: '健康目标', startDate: start, endDate: today,
    krs: [{ id: 'k1', title: 'x', kind: kind, target: target }] };
}

var pg = Store.goalProgressOf(goal('sleep', 5));
var r = pg.rows[0];
check('睡眠 KR 达标天数=5', r.value === 5, r.value);
check('睡眠 KR 目标=5', r.target === 5, r.target);
check('睡眠 KR pct=100%（5/5）', r.pct === 1, r.pct);
check('睡眠 KR 单位=天', r.unit === '天', r.unit);

// 目标 10，只达标 5 → 50%
var pg2 = Store.goalProgressOf(goal('sleep', 10));
check('目标 10 达标 5 → pct≈0.5', Math.abs(pg2.rows[0].pct - 0.5) < 1e-9, pg2.rows[0].pct);

// 目标 3，达标 5 → 封顶 100%
var pg3 = Store.goalProgressOf(goal('sleep', 3));
check('超额达标封顶 100%', pg3.rows[0].pct === 1, pg3.rows[0].pct);

// 运动：前 3 天步数达标
const activeMet = new Set(days.slice(0, 3));
Store.dayHealth = function (ds) { return { sleepMet: false, stepPct: activeMet.has(ds) ? 100 : 40 }; };
var pg4 = Store.goalProgressOf(goal('active', 4));
check('运动 KR 达标日=3', pg4.rows[0].value === 3, pg4.rows[0].value);
check('运动 KR pct=75%（3/4）', Math.abs(pg4.rows[0].pct - 0.75) < 1e-9, pg4.rows[0].pct);

// 只有 sleep/active 计入；混合 KR 平均
var mixed = { id: 'g2', title: '混合', startDate: start, endDate: today, krs: [
  { id: 'a', title: '睡够', kind: 'sleep', target: 5 },   // 5/5 = 1
  { id: 'b', title: '运动', kind: 'active', target: 4 }   // 3/4 = 0.75
] };
Store.dayHealth = function (ds) { return { sleepMet: sleepMet.has(ds), stepPct: activeMet.has(ds) ? 100 : 40 }; };
var pg5 = Store.goalProgressOf(mixed);
check('混合 KR 平均 = round((1+0.75)/2*100)=88', pg5.pct === 88, pg5.pct);

const allOk = results.every(r=>r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
