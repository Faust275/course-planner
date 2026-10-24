// 单测：健康 → 待办反向联动（bodyAdvice / deferTaskTo / applySleepToEnergy）
// Node vm 加载真实 store.js + sleep-model.js
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
const yest = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));

// 清掉默认任务/睡眠，保证干净起点
Store.state.tasks.length = 0;
Store.state.sleeps.length = 0;

/* ---------- 1. 开关未开 / 无数据 ---------- */
Store.setHealthOn(false);
let adv = Store.bodyAdvice();
check('健康看板关着 → level=off / has=false', adv.level === 'off' && adv.has === false, adv.level);

Store.setHealthOn(true);
adv = Store.bodyAdvice();
check('开着但没有睡眠记录 → level=unknown / has=false',
  adv.level === 'unknown' && adv.has === false, adv.level);

/* ---------- 2. 欠睡 → low ---------- */
// 23:20 睡、04:20 醒 = 300 分钟（5h），质量也压下去
Store.addSleep({ date: yest, start: '23:20', end: '04:20', deep: 40, rem: 40, awake: 30, efficiency: 70 });
Store.state.sleeps.forEach(function (s) { s.tot = null; });
adv = Store.bodyAdvice();
check('5 小时 → level=low', adv.level === 'low', adv.level + ' / total=' + adv.total);
check('欠睡量按 8h 需求算（约 180 分钟）', adv.shortMin >= 150, adv.shortMin);
check('tomorrow 是明天', adv.tomorrow === DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 1)), adv.tomorrow);

/* ---------- 3. 疲劳时的高耗能任务筛选 ---------- */
const tomorrow = adv.tomorrow;
Store.addTask({ title: '写实验报告', energy: 'high', dueDate: today, priority: 'high' });
Store.addTask({ title: '背单词', energy: 'low', dueDate: today });
Store.addTask({ title: '下周才交的大作业', energy: 'high', dueDate: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 6)) });
Store.addTask({ title: '已完成的难任务', energy: 'high', dueDate: today, status: 'done' });
const parent = Store.addTask({ title: '父任务', energy: 'high', dueDate: today });
Store.addTask({ title: '子任务', energy: 'high', dueDate: today, parentId: parent.id });
Store.addTask({ title: '逾期的难任务', energy: 'high', dueDate: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2)) });

adv = Store.bodyAdvice();
const names = adv.heavy.map((t) => t.title);
check('heavy 只含「今天到期/逾期 + 高耗能 + 顶层 + 未完成」',
  names.length === 2 && names.indexOf('写实验报告') >= 0 && names.indexOf('逾期的难任务') >= 0,
  JSON.stringify(names));
check('heavy 里不含轻松任务', names.indexOf('背单词') < 0);
check('heavy 里不含未来到期任务', names.indexOf('下周才交的大作业') < 0);
check('heavy 里不含已完成任务', names.indexOf('已完成的难任务') < 0);
check('heavy 里不含子任务', names.indexOf('子任务') < 0);
check('高优先级排在最前', adv.heavy[0].title === '写实验报告', adv.heavy[0].title);
check('欠睡 + 有重活 → canDefer=true', adv.canDefer === true);

/* ---------- 4. 挪到明天 ---------- */
const target = Store.state.tasks.find((t) => t.title === '写实验报告');
const moved = Store.deferTaskTo(target.id, tomorrow);
check('deferTaskTo 改掉 dueDate', moved.dueDate === tomorrow, moved.dueDate);
check('deferTaskTo 记了一次推迟', moved.deferredCount === 1, moved.deferredCount);
check('挪走后不再出现在 heavy 里',
  Store.bodyAdvice().heavy.map((t) => t.title).indexOf('写实验报告') < 0);
check('挪走后任务本身没被完成', Store.getTask(target.id).status !== 'done');

/* ---------- 5. 关闭当天提示 ---------- */
check('默认没被关过', Store.bodyAdvice().dismissed === false);
Store.dismissBodyTip(today);
check('关掉后 dismissed=true', Store.bodyAdvice().dismissed === true);
Store.dismissBodyTip(yest);
check('只压当天（关昨天不影响今天）', Store.bodyAdvice().dismissed === false);
Store.dismissBodyTip(today);

/* ---------- 6. 睡够了 → good ---------- */
Store.state.sleeps.length = 0;
Store.addSleep({ date: yest, start: '23:00', end: '07:05', deep: 110, rem: 100, awake: 8, efficiency: 94 });
adv = Store.bodyAdvice();
check('7.9 小时高质量 → level=good', adv.level === 'good', adv.level + ' / q=' + adv.q);
check('睡够了 canDefer=false（不劝你拖延）', adv.canDefer === false);

/* ---------- 7. 中间档 ---------- */
Store.state.sleeps.length = 0;
Store.addSleep({ date: yest, start: '23:40', end: '06:10', deep: 70, rem: 70, awake: 20, efficiency: 84 });
adv = Store.bodyAdvice();
check('6.5 小时 → level=mild', adv.level === 'mild', adv.level + ' / total=' + adv.total);

/* ---------- 8. 精力档位被睡眠修正 ---------- */
const peak = Store._energyByClock('10:00');
check('纯节律：10:00 是 high', peak.level === 'high' && peak.isPeak === true);

Store.state.sleeps.length = 0;
Store.addSleep({ date: yest, start: '23:20', end: '04:20', deep: 40, rem: 40, awake: 30, efficiency: 70 });
const damped = Store.currentEnergyState('10:00');
check('欠睡后黄金期降档为 medium', damped.level === 'medium', damped.level);
check('降档留了标记', damped.sleepDamp === true);
check('降档后 isPeak=false', damped.isPeak === false);
check('文案里带上实际睡眠时长', /5 小时/.test(damped.advice), damped.advice);

Store.state.sleeps.length = 0;
Store.addSleep({ date: yest, start: '23:00', end: '07:05', deep: 110, rem: 100, awake: 8, efficiency: 94 });
const boosted = Store.currentEnergyState('10:00');
check('睡够了黄金期仍是 high', boosted.level === 'high', boosted.level);
check('睡够了文案提示可以加量', /加量/.test(boosted.advice), boosted.advice);

const night = Store.currentEnergyState('23:30');
check('夜间休整期不被睡眠影响', night.level === 'rest', night.level);

/* ---------- 9. 关掉健康看板后，精力回到纯节律 ---------- */
Store.setHealthOn(false);
const plain = Store.currentEnergyState('10:00');
check('关掉健康后不叠加睡眠', plain.level === 'high' && !plain.sleepDamp, plain.level);

const fail = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
