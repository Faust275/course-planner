// 单测：就寝提醒 bedtimePlan / checkBedtime —— Node vm 加载真实 store.js + remind.js
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const root = process.cwd();
const storeSrc = fs.readFileSync(path.join(root, 'assets/js/store.js'), 'utf8');
const remindSrc = fs.readFileSync(path.join(root, 'assets/js/remind.js'), 'utf8');

// 把"现在"钉在某个晚上，才能稳定测到点触发
const FIXED = new Date();
FIXED.setHours(23, 40, 0, 0);

const toasts = [];
const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.setTimeout = function () { return 0; }; sandbox.clearTimeout = function () {};
sandbox.console = console; sandbox.indexedDB = undefined;
sandbox.document = { hidden: false, addEventListener: function () {} };
const RealDate = Date;
sandbox.Date = class extends RealDate {
  constructor(...a) { if (!a.length) super(FIXED.getTime()); else super(...a); }
  static now() { return FIXED.getTime(); }
};
const ls = { _m:{}, getItem(k){return Object.prototype.hasOwnProperty.call(this._m,k)?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];}, key(i){return Object.keys(this._m)[i]||null;}, get length(){return Object.keys(this._m).length;} };
sandbox.localStorage = ls;
sandbox.UI = {
  el: function () { return {}; }, svg: function () { return {}; }, $: function () { return null; },
  toast: function (t) { toasts.push(String(t)); }
};
sandbox.MODAL = null;

vm.createContext(sandbox);
vm.runInContext(storeSrc, sandbox);
vm.runInContext(remindSrc, sandbox);

const Store = sandbox.Store;
const Remind = sandbox.Remind;
const DateUtil = sandbox.DateUtil;
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

const o = Remind.opts();
check('默认值补齐（bedtime 关 / 23:30 / 7.5h）',
  o.bedtime === false && o.bedtimeAt === '23:30' && Number(o.bedtimeNeed) === 7.5 && o.bedtimeAuto === true,
  JSON.stringify(o));

/* 明早 08:00 有课：08:00−40min−7.5h−30min = 23:20 */
Store.coursesOnDate = () => [{ name: '高等数学', timeMode: 'custom', startTime: '08:00', endTime: '09:40' }];
let plan = Remind.bedtimePlan(o);
check('早八 → 23:20', plan.hhmm === '23:20', plan.hhmm);
check('早八 → 标记为自动提前', plan.auto === true, plan.auto);
check('早八 → 说明里有课程名', /高等数学/.test(plan.reason), plan.reason);

/* 明早 14:00 才有课：倒推出来是凌晨，比默认更晚 → 不采用 */
Store.coursesOnDate = () => [{ name: '下午课', timeMode: 'custom', startTime: '14:00', endTime: '15:40' }];
plan = Remind.bedtimePlan(o);
check('下午才有课 → 保持 23:30', plan.hhmm === '23:30' && plan.auto === false, plan.hhmm + '/' + plan.auto);

/* 明早第一节 10:00，目标 7.5h → 01:20（比 23:30 晚）→ 不采用 */
Store.coursesOnDate = () => [{ name: '十点课', timeMode: 'custom', startTime: '10:00', endTime: '11:40' }];
plan = Remind.bedtimePlan(o);
check('十点课 → 保持 23:30（不往后推）', plan.hhmm === '23:30' && plan.auto === false, plan.hhmm);

/* 明早没课 */
Store.coursesOnDate = () => [];
plan = Remind.bedtimePlan(o);
check('明天没课 → 23:30 且 not auto', plan.hhmm === '23:30' && plan.auto === false, plan.hhmm);

/* 明天放假：即使有课也不提前 */
Store.coursesOnDate = () => [{ name: '早八', timeMode: 'custom', startTime: '08:00', endTime: '09:40' }];
sandbox.HolidayCN = { lookup: () => ({ type: 'holiday', name: '国庆节' }) };
plan = Remind.bedtimePlan(o);
check('明天放假 → 不提前', plan.hhmm === '23:30' && plan.auto === false, plan.hhmm);
check('明天放假 → 说明里点出放假', /放假/.test(plan.reason), plan.reason);
delete sandbox.HolidayCN;

/* 关掉自动提前 */
Store.coursesOnDate = () => [{ name: '高等数学', timeMode: 'custom', startTime: '08:00' }];
o.bedtimeAuto = false;
plan = Remind.bedtimePlan(o);
check('关掉自动提前 → 23:30', plan.hhmm === '23:30' && plan.auto === false, plan.hhmm);
o.bedtimeAuto = true;

/* 目标只睡 6 小时：23:20 的算法不复用，因为 00:50 比 23:30 晚 */
o.bedtimeNeed = 6;
plan = Remind.bedtimePlan(o);
check('目标 6h → 00:50 比默认晚，不采用', plan.hhmm === '23:30', plan.hhmm);
o.bedtimeNeed = 7.5;

/* 默认就寝本身就在凌晨（00:30）→ 23:20 比它早，应该采用 */
o.bedtimeAt = '00:30';
plan = Remind.bedtimePlan(o);
check('默认 00:30 + 早八 → 23:20', plan.hhmm === '23:20' && plan.auto === true, plan.hhmm);
o.bedtimeAt = '23:30';

/* 到了点才提醒：现在 23:40，目标 23:30，应触发一次 */
o.bedtime = true;
toasts.length = 0;
Remind.check();
Remind.check();
const bedToasts = toasts.filter((t) => /该睡了/.test(t));
check('到点提醒一次', bedToasts.length === 1, bedToasts.length + ' 条：' + JSON.stringify(bedToasts));
check('提醒文案含建议时刻', /23:20|23:30/.test(bedToasts[0] || ''), bedToasts[0]);

/* 关掉开关就不提醒（换一天，避免被 fired 记住） */
o.bedtime = false;
toasts.length = 0;
Remind.check();
check('关闭后不提醒', toasts.filter((t) => /该睡了/.test(t)).length === 0, toasts.length);


/* 默认就寝在凌晨 00:30 且明天没课：当前 23:40 还没到 00:30，绝不能提前误报 */
o.bedtime = true;
o.bedtimeAt = '00:30';
Store.coursesOnDate = () => [];
toasts.length = 0;
Remind.check();
check('默认 00:30 且当前 23:40 未到点 → 不提前误报', toasts.filter((t) => /该睡了/.test(t)).length === 0, JSON.stringify(toasts));

const allOk = results.every((r) => r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
