// 单测：月复盘健康段 healthReviewLines
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
const monthStart = today.slice(0, 7) + '-01';
const prevMonth = DateUtil.toStr(DateUtil.addMonths(DateUtil.parse(monthStart), -1)).slice(0, 7);

Store.state.sleeps.length = 0;
Store.state.metrics.length = 0;
Store.state.weightLog.length = 0;

/* ---------- 1. 开关 / 空数据 ---------- */
Store.setHealthOn(false);
Store.addSleep({ date: today, start: '23:00', end: '07:00' });
check('健康看板关着 → 空数组', Store.healthReviewLines(today).length === 0);

Store.setHealthOn(true);
Store.state.sleeps.length = 0;
check('开着但本月没记录 → 空数组', Store.healthReviewLines(today).length === 0,
  JSON.stringify(Store.healthReviewLines(today)));

/* ---------- 2. 睡眠段 ---------- */
// 注意：addSleep 的 date 是「入睡日」，跨午夜后醒来日 = date + 1，所以三条都要往前挪一天
Store.addSleep({ date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1)), start: '23:00', end: '07:00' }); // 8h → 醒于今天
Store.addSleep({ date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2)), start: '23:00', end: '04:00' }); // 5h → 醒于昨天
Store.addSleep({ date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -3)), start: '23:30', end: '06:30' }); // 7h → 醒于前天

let lines = Store.healthReviewLines(today);
check('有睡眠 → 出现睡眠行', lines.some((l) => /^· 睡眠：平均/.test(l)), JSON.stringify(lines));
check('平均时长正确（20h/3 ≈ 6 小时 40 分）',
  lines.some((l) => /6 小时 40 分/.test(l)), lines[0]);
check('数出 3 晚有记录', lines.some((l) => /3 晚有记录/.test(l)), lines[0]);
check('达标夜按 6 小时阈值数出 2 晚（8h / 7h）',
  lines.some((l) => /睡够 6 小时的有 2 晚/.test(l)), lines[0]);

/* ---------- 3. 步数段 ---------- */
Store.state.metrics.push({ id: 'm1', date: today, steps: 6000, calories: 200, distance: 4 });
Store.state.metrics.push({ id: 'm2', date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1)), steps: 10000, calories: 300, distance: 7 });
lines = Store.healthReviewLines(today);
check('有步数 → 出现步数行', lines.some((l) => /^· 步数：日均 8000 步/.test(l)), JSON.stringify(lines));
check('步数行标注有记录天数', lines.some((l) => /2 天有记录/.test(l)), lines[1]);

/* ---------- 4. 体重段 ---------- */
Store.state.weightLog.push({ id: 'w1', date: monthStart, kg: 62.5 });
Store.state.weightLog.push({ id: 'w2', date: today, kg: 61.8 });
lines = Store.healthReviewLines(today);
check('体重变化行', lines.some((l) => /体重：62\.5 → 61\.8 kg（-0\.7）/.test(l)), JSON.stringify(lines));

Store.state.weightLog = [{ id: 'w3', date: monthStart, kg: 62 }, { id: 'w4', date: today, kg: 62 }];
lines = Store.healthReviewLines(today);
check('体重没变时说「本月没变」', lines.some((l) => /本月没变/.test(l)), 
  lines.filter((l) => /体重/.test(l))[0]);

Store.state.weightLog = [{ id: 'w5', date: today, kg: 61 }];
lines = Store.healthReviewLines(today);
check('只有一条体重记录不编变化', !lines.some((l) => /体重/.test(l)), JSON.stringify(lines));

/* ---------- 5. 月份边界 ---------- */
const prevRec = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(prevMonth + '-01'), 3));
Store.state.sleeps.push({ id: 'old1', date: prevRec, start: '23:00', end: '08:00', deep: null, rem: null, awake: null, efficiency: null, quality: 'normal', note: '', source: 'manual' });
const thisMonthNights = (Store.healthReviewLines(today).join('|').match(/(\d+) 晚有记录/) || [])[1];
check('上月记录不计入本月', thisMonthNights === '3', thisMonthNights);

check('看未来月份 → 空数组', Store.healthReviewLines('2099-01').length === 0);

const fail = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
