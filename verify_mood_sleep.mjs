// 单测：日记心情 × 睡眠相关性 moodSleepCorr —— Node vm 加载真实 store.js
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const src = fs.readFileSync(path.join(process.cwd(), 'assets/js/store.js'), 'utf8');
const smSrc = fs.readFileSync(path.join(process.cwd(), 'assets/js/sleep-model.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.setTimeout = function () { return 0; }; sandbox.clearTimeout = function () {};
sandbox.console = console; sandbox.indexedDB = undefined;
const ls = { _m:{}, getItem(k){return Object.prototype.hasOwnProperty.call(this._m,k)?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];}, key(i){return Object.keys(this._m)[i]||null;}, get length(){return Object.keys(this._m).length;} };
sandbox.localStorage = ls;
vm.createContext(sandbox);
vm.runInContext(smSrc, sandbox);      // 真实 SleepModel：夜里质量要用它算
vm.runInContext(src, sandbox);

const Store = sandbox.Store;
const DateUtil = sandbox.DateUtil;
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}
const day = (n) => DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -n));

/* 空数据：样本不足 */
const empty = Store.moodSleepCorr(60);
check('无数据 has=false', empty.has === false && empty.n === 0, JSON.stringify(empty));
check('提示需要 7 天', empty.need === 7, empty.need);

/* 造 10 天数据：好夜配好心情，差夜配差心情
   好夜：记录日=前一天，23:00→07:00（跨午夜，醒来日=当天）
   差夜：记录日=当天，03:00→05:30（不跨午夜，醒来日=当天），并压低效率/深睡 */
const goodMoods = ['great', 'good', 'great', 'good', 'great'];
const badMoods = ['low', 'tired', 'low', 'tired', 'low'];
for (let i = 0; i < 10; i++) {
  const d = day(i);
  const good = i % 2 === 0;
  if (good) {
    Store.state.sleeps.push({ id: 'g' + i, date: day(i + 1), start: '23:00', end: '07:00' });
    Store.state.diaries.push({ id: 'd' + i, date: d, mood: goodMoods[i / 2], content: '' });
  } else {
    // 差夜要真的差：短睡 + 低效率 + 深睡/REM 少，质量系数才会掉到 0.5 以下
    Store.state.sleeps.push({ id: 'b' + i, date: d, start: '03:00', end: '05:30',
      efficiency: 55, deep: 10, rem: 10 });
    Store.state.diaries.push({ id: 'd' + i, date: d, mood: badMoods[(i - 1) / 2], content: '' });
  }
}

const r = Store.moodSleepCorr(60);
check('样本 10 天', r.has === true && r.n === 10, r.n);
check('强正相关 r>0.9', r.r > 0.9, r.r);
check('睡好当天心情=4.6', r.moodGood === 4.6, r.moodGood);
check('睡差当天心情=1.4', r.moodBad === 1.4, r.moodBad);
check('心情好的人前一晚睡 480 分', r.sleepHappy === 480, r.sleepHappy);
check('心情差的人前一晚睡 150 分', r.sleepLow === 150, r.sleepLow);
check('睡好样本 5 天 / 睡差 5 天', r.nGood === 5 && r.nBad === 5, r.nGood + '/' + r.nBad);
check('心情好 5 天 / 心情差 5 天', r.nHappy === 5 && r.nLow === 5, r.nHappy + '/' + r.nLow);

/* 打乱心情 → 相关性应明显下降 */
Store.state.diaries.forEach((d, i) => { d.mood = ['great', 'low', 'meh', 'tired', 'good'][i % 5]; });
const r2 = Store.moodSleepCorr(60);
check('打乱后 |r| 明显变小', Math.abs(r2.r) < 0.6, r2.r);

/* 窗口限制：只看最近 4 天 → 样本不足 */
const r3 = Store.moodSleepCorr(4);
check('窗口 4 天 → has=false', r3.has === false && r3.n === 4, JSON.stringify(r3));

/* 没标心情的日记不参与 */
Store.state.diaries.forEach((d) => { d.mood = ''; });
const r4 = Store.moodSleepCorr(60);
check('全部未标心情 → has=false', r4.has === false && r4.n === 0, r4.n);

/* 有心情但没睡眠的日期也不参与 */
Store.state.diaries.forEach((d) => { d.mood = 'good'; });
Store.state.sleeps.length = 0;
const r5 = Store.moodSleepCorr(60);
check('有日记无睡眠 → has=false', r5.has === false && r5.n === 0, r5.n);

const allOk = results.every((x) => x.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
