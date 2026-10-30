// 单测：计划 × 身体状态联动（planLoadAdvice / 耗能档位 / 豁免日）
// Node vm 加载真实 store.js + sleep-model.js
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { storeSource } from '../store-src.mjs';

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
vm.runInContext(storeSource(root), sandbox);

const Store = sandbox.Store;
const DateUtil = sandbox.DateUtil;
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

const today = DateUtil.toStr(DateUtil.today());
const yest = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
const d2 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2));
const d3 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -3));
const d4 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -4));

/* 干净起点 */
Store.state.plans.length = 0;
Store.state.sleeps.length = 0;
Store.state.tasks.length = 0;

function mkPlan(title, load, extra) {
  const p = Store.addPlan(Object.assign({
    title: title, type: 'checkin', period: 'daily', days: 21,
    startDate: today, load: load
  }, extra || {}));
  return p;
}

/* ---------- 1. 健康关着 → 不参与 ---------- */
const pHigh = mkPlan('跑步 5 公里', 'high');
const pLow = mkPlan('散步 20 分钟', 'low');
const pMid = mkPlan('背单词', 'mid');

Store.setHealthOn(false);
let a = Store.planLoadAdvice();
check('健康看板关着 → has=false / level=off', a.has === false && a.level === 'off', a.level);

/* ---------- 2. 开着但没睡眠记录 ---------- */
Store.setHealthOn(true);
a = Store.planLoadAdvice();
check('没有睡眠记录 → level=unknown / has=false', a.has === false && a.level === 'unknown', a.level);

/* ---------- 3. 欠睡 → 建议缓一缓 ---------- */
// 23:20 睡、04:20 醒 = 5 小时，质量压低
Store.addSleep({ date: yest, start: '23:20', end: '04:20', deep: 40, rem: 40, awake: 30, efficiency: 70 });
Store.state.sleeps.forEach((s) => { s.tot = null; });

a = Store.planLoadAdvice();
check('5 小时 → mode=ease', a.mode === 'ease', a.mode + ' / level=' + a.level);
check('ease 时候选里有 3 个计划', a.todo === 3, a.todo);
check('heavy 只有标了「吃力」的那个',
  a.heavy.length === 1 && a.heavy[0].title === '跑步 5 公里', JSON.stringify(a.heavy.map((p) => p.title)));
check('light 只有标了「轻松」的那个',
  a.light.length === 1 && a.light[0].title === '散步 20 分钟', a.light.length);
check('mid 落在 rest 里', a.rest.length === 1 && a.rest[0].title === '背单词', a.rest.length);
check('tagged 统计有档位的计划数', a.tagged === 3, a.tagged);

/* ---------- 4. 一个档位都没标 → 不给建议 ---------- */
Store.state.plans.forEach((p) => { p.load = ''; });
a = Store.planLoadAdvice();
check('没标档位 → has=false', a.has === false, a.has);
check('没标档位 → tagged=0（UI 给一句怎么用的提示）', a.tagged === 0, a.tagged);
Store.state.plans.forEach((p) => {
  p.load = p.title === '跑步 5 公里' ? 'high' : p.title === '散步 20 分钟' ? 'low' : 'mid';
});

/* ---------- 5. 睡够了 → 适合推 ---------- */
Store.state.sleeps.length = 0;
Store.addSleep({ date: yest, start: '23:00', end: '07:05', deep: 110, rem: 100, awake: 8, efficiency: 94 });
a = Store.planLoadAdvice();
check('7.9 小时高质量 → mode=push', a.mode === 'push', a.mode + ' / level=' + a.level);
check('push 时指向吃力的那个', a.heavy.length === 1 && a.heavy[0].title === '跑步 5 公里');

/* ---------- 6. 打勾过的 / 未来的 / 已完成的都不算候选 ---------- */
Store.togglePlanCheckin(pMid.id, today);            // 今天已打卡
const future = Store.addPlan({ title: '下个月才开始', type: 'checkin', period: 'daily', days: 7, startDate: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 10)), load: 'high' });
a = Store.planLoadAdvice();
const todoNames = a.heavy.concat(a.light, a.rest).map((p) => p.title);
check('今天已打卡的不再催', todoNames.indexOf('背单词') < 0, JSON.stringify(todoNames));
check('还没开始的不算今天的活', todoNames.indexOf('下个月才开始') < 0);

/* ---------- 7. 缓一缓：不打勾、不催、不断签 ---------- */
// 造连续：昨天 + 前天都打卡
Store.togglePlanCheckin(pHigh.id, yest);
Store.togglePlanCheckin(pHigh.id, d2);
check('连打两天 → streak=2', Store.planStreak(pHigh) === 2, Store.planStreak(pHigh));

let r = Store.togglePlanExempt(pHigh.id, today);
check('缓一缓被记下', Store.planExemptedOn(pHigh, today) === true);
check('缓一缓返回 on=true', r.on === true);
check('缓一天后 streak 仍是 2（没断）', Store.planStreak(pHigh) === 2, Store.planStreak(pHigh));
check('缓过的计划不出现在建议里',
  Store.planLoadAdvice().heavy.map((p) => p.title).indexOf('跑步 5 公里') < 0);

const before = Store.planStats().todayPending;
const stats = Store.planStats();
check('今日待打卡不再把缓过的算进去', stats.todayPending === before, stats.todayPending);

r = Store.togglePlanExempt(pHigh.id, today);
check('再点一次取消 → 恢复催', r.on === false && Store.planExemptedOn(pHigh, today) === false);

/* ---------- 8. 打了卡就把豁免清掉 ---------- */
Store.togglePlanExempt(pHigh.id, today);
Store.togglePlanCheckin(pHigh.id, today);
check('打卡后同一天的豁免被清掉', Store.planExemptedOn(pHigh, today) === false);
check('打卡后 streak 变 3', Store.planStreak(pHigh) === 3, Store.planStreak(pHigh));
Store.togglePlanCheckin(pHigh.id, today);   // 撤销，回到未打卡

/* ---------- 9. 豁免上限：连缓 3 天就不再装没事 ---------- */
const pStreak = mkPlan('早起打卡', 'high');
Store.state.plans.forEach((p) => { p.exemptDays = []; });
[ yest, d2, d3 ].forEach((d) => Store.togglePlanExempt(pStreak.id, d));
Store.togglePlanCheckin(pStreak.id, d4);
check('大前天打过卡', Store.planRecordOfDate(Store.getPlan(pStreak.id), d4) ? true : false);
check('连缓 3 天 → 连续天数真的断了', Store.planStreak(Store.getPlan(pStreak.id)) === 0,
  Store.planStreak(Store.getPlan(pStreak.id)));

const pOk = mkPlan('早读', 'low');
Store.state.plans.forEach((p) => { p.exemptDays = []; });
[ yest, d2 ].forEach((d) => Store.togglePlanExempt(pOk.id, d));
Store.togglePlanCheckin(pOk.id, d3);
check('连缓 2 天仍然不算断（豁免额度内）', Store.planStreak(Store.getPlan(pOk.id)) === 1,
  Store.planStreak(Store.getPlan(pOk.id)));

/* ---------- 10. 档位字段的写入与规范化 ---------- */
const bad = Store.addPlan({ title: '乱填档位', type: 'checkin', period: 'daily', days: 7, load: 'whatever' });
check('未知档位被归一成空', bad.load === '', bad.load);
const noLoad = Store.addPlan({ title: '不填档位', type: 'progress', target: 100 });
check('不填档位默认空', noLoad.load === '');
check('新计划带空的豁免数组', Array.isArray(noLoad.exemptDays) && noLoad.exemptDays.length === 0);

Store.updatePlan(noLoad.id, { load: 'high' });
check('updatePlan 能改档位', Store.getPlan(noLoad.id).load === 'high', Store.getPlan(noLoad.id).load);
Store.updatePlan(noLoad.id, { load: 'nope' });
check('updatePlan 传脏值会清空', Store.getPlan(noLoad.id).load === '');

/* ---------- 11. 豁免记录不会无限增长 ---------- */
const pLong = mkPlan('长跑', 'high');
for (let i = 1; i <= 130; i++) {
  Store.togglePlanExempt(pLong.id, DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -i)));
}
check('豁免日只保留最近 120 条', Store.getPlan(pLong.id).exemptDays.length === 120,
  Store.getPlan(pLong.id).exemptDays.length);

const fail = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
