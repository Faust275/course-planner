// 单测：白噪音睡眠定时 + 入睡时刻回写（Store.logSleepOnset / onsetStats + WhiteNoise.setTimer）
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { storeSource } from '../store-src.mjs';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* 受控计时器：能手动触发 setTimeout 的回调，把「等 30 分钟」压成一步 */
const timers = [];
const sandbox = {};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.setTimeout = function (fn, ms) { timers.push({ fn, ms, cancelled: false }); return timers.length; };
sandbox.clearTimeout = function (id) { if (timers[id - 1]) timers[id - 1].cancelled = true; };
sandbox.console = console; sandbox.indexedDB = undefined;
sandbox.document = { hidden: false, addEventListener: function () {} };
const ls = {
  _m: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; },
  key(i) { return Object.keys(this._m)[i] || null; }, get length() { return Object.keys(this._m).length; }
};
sandbox.localStorage = ls;

const toasts = [];
sandbox.UI = {
  el: () => ({}), svg: () => ({}), $: () => null,
  toast: (t) => { toasts.push(String(t)); }
};

/* 最小 Web Audio 桩，让 play() 真的能跑起来 */
sandbox.AudioContext = function () {
  this.currentTime = 0; this.state = 'running'; this.sampleRate = 4000; this.destination = {};
  this.resume = () => Promise.resolve();
  this.createBuffer = (ch, len) => ({ getChannelData: () => new Float32Array(len) });
  this.createBufferSource = () => ({ buffer: null, loop: false, connect() {}, start() {}, stop() {}, disconnect() {} });
  this.createGain = () => ({
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
    connect() {}, disconnect() {}
  });
};

vm.createContext(sandbox);
vm.runInContext(read('assets/js/sleep-model.js'), sandbox);
vm.runInContext(storeSource(root), sandbox);
vm.runInContext(read('assets/js/white-noise.js'), sandbox);

const Store = sandbox.Store;
const WN = sandbox.WhiteNoise;
const DateUtil = sandbox.DateUtil;
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

const today = DateUtil.toStr(DateUtil.today());
Store.state.sleepOnsets.length = 0;

/* ---------- 1. store：记账规则 ---------- */
let o = Store.logSleepOnset('23:35', { min: 30 });
check('记一条入睡时刻', o.at === '23:35' && o.date === today && o.min === 30, JSON.stringify(o));

o = Store.logSleepOnset('23:50', { min: 60 });
check('同一天再记：保留更早的时刻', o.at === '23:35', o.at);
check('同一天再记：定时取更长的一档', o.min === 60, o.min);
check('同一天再记：次数累计', o.n === 2, o.n);
check('一天只留一条', Store.state.sleepOnsets.length === 1, Store.state.sleepOnsets.length);

/* 凌晨那次应被认作「更晚」，不该覆盖 23:35 */
Store.logSleepOnset('01:10', { min: 15 });
check('凌晨 01:10 不覆盖 23:35（夜晚轴上更晚）', Store.state.sleepOnsets[0].at === '23:35', Store.state.sleepOnsets[0].at);

/* ---------- 2. 统计 ---------- */
Store.state.sleepOnsets.length = 0;
Store.logSleepOnset('23:40', { date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2)) });
Store.logSleepOnset('00:20', { date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1)) });
Store.logSleepOnset('23:30', { date: today });
const st = Store.onsetStats(7);
check('样本数正确', st.n === 3 && st.has === true, st.n);
check('跨午夜平均 = 23:50', st.avgHHMM === '23:50', st.avgHHMM);
check('最早 23:30', st.earliest === '23:30', st.earliest);
check('最晚 00:20', st.latest === '00:20', st.latest);
check('波动 50 分钟', st.spread === 50, st.spread);
check('avgMin 落在夜晚轴（>18:00）', st.avgMin > 18 * 60, st.avgMin);

check('只统计窗口内的记录', Store.onsetStats(1).n === 1, Store.onsetStats(1).n);
check('窗口外不算', Store.onsetStats(2).n === 2, Store.onsetStats(2).n);
check('无记录时 has=false', Store.onsetStats(1).n === 1 && (Store.state.sleepOnsets.length = 0, !Store.onsetStats(7).has));

check('latestOnset 取最近一天', (Store.state.sleepOnsets = [
  { date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1)), at: '23:00', min: 15 },
  { date: today, at: '00:40', min: 15 }
], Store.latestOnset() === '00:40'));

check('onsetAxisOf 把 00:30 归到 24:30', Store.onsetAxisOf('00:30') === 24 * 60 + 30, Store.onsetAxisOf('00:30'));

/* 超过 120 天的记录会被裁掉 */
Store.state.sleepOnsets = [{ date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -200)), at: '23:00', min: 15 }];
Store.logSleepOnset('23:10', {});
check('120 天前的记录被清理', Store.state.sleepOnsets.length === 1 && Store.state.sleepOnsets[0].date === today,
  JSON.stringify(Store.state.sleepOnsets.map((x) => x.date)));

/* ---------- 3. WhiteNoise 定时 ---------- */
check('初始没有定时', WN.state().timerMin === 0 && WN.state().timerLeft === 0);
check('没播放时设定时无效', WN.setTimer(30) === 0 && WN.state().timerMin === 0);

check('播放成功', WN.play() === true && WN.state().playing === true);
check('设定时返回分钟', WN.setTimer(30) === 30 && WN.state().timerMin === 30, WN.state().timerMin);
check('timerLeft 约 1800 秒', Math.abs(WN.state().timerLeft - 1800) <= 2, WN.state().timerLeft);

/* 触发到点：应该停播 + 清掉定时 + 回调 + 提示 */
let endedMin = null;
WN.onTimerEnd = (m) => { endedMin = m; };
const timerIdx = timers.length - 1;
check('确实排了一个 30 分钟的定时器', timers[timerIdx].ms === 30 * 60000, timers[timerIdx].ms);
timers[timerIdx].fn();
check('到点后停止播放', WN.state().playing === false);
check('到点后定时归零', WN.state().timerMin === 0 && WN.state().timerLeft === 0);
check('到点回调带上原定分钟', endedMin === 30, endedMin);
check('到点给出提示', toasts.some((t) => /睡眠定时/.test(t)), toasts[toasts.length - 1]);

/* 手动停止也应清掉定时 */
WN.play();
WN.setTimer(45);
check('再开一次定时生效', WN.state().timerMin === 45);
WN.stop();
check('手动停止会清掉定时', WN.state().timerMin === 0);

/* 取消定时 */
WN.play();
WN.setTimer(60);
WN.setTimer(0);
check('setTimer(0) 取消定时', WN.state().timerMin === 0);

const fail = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fail) + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
