// 单测：体重记录 logWeight / weightSeries / latestWeight —— Node vm 加载真实 store.js
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { storeSource } from '../store-src.mjs';

const root = process.cwd();
const src = storeSource(root);
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
const d1 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -4));
const d2 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2));

const r1 = Store.logWeight(d1, 60.5);
check('首次记录返回条目', r1 && r1.kg === 60.5 && r1.date === d1, JSON.stringify(r1));
check('latestWeight=60.5', Store.latestWeight() === 60.5, Store.latestWeight());

Store.logWeight(d1, 61);
check('同日覆盖不新增', Store.state.weightLog.length === 1 && Store.latestWeight() === 61, Store.state.weightLog.length);

Store.logWeight(d2, 60);
check('新增一天后共 2 条', Store.state.weightLog.length === 2, Store.state.weightLog.length);
const ser = Store.weightSeries();
check('序列按日期升序', ser.length === 2 && ser[0].kg === 61 && ser[1].kg === 60, ser.map(x=>x.date+':'+x.kg).join(','));
check('latestWeight=60（最后一天）', Store.latestWeight() === 60, Store.latestWeight());

// 同步到档案（TDEE 用）
check('档案体重同步为最新', Number(Store.settings.diet.profile.weight) === 60, Store.settings.diet.profile.weight);

// 越界拒绝
check('体重<20 拒绝', Store.logWeight(today, 5) === null, Store.logWeight(today, 5));
check('体重>300 拒绝', Store.logWeight(today, 500) === null, Store.logWeight(today, 500));
check('越界后数据未被改动', Store.state.weightLog.length === 2, Store.state.weightLog.length);

// 窗口过滤：90 天外不纳入
const old = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -120));
Store.logWeight(old, 70);
check('weightSeries() 全量含旧记录', Store.weightSeries().length === 3, Store.weightSeries().length);
check('weightSeries(90) 过滤掉 120 天前', Store.weightSeries(90).length === 2, Store.weightSeries(90).length);

const allOk = results.every(r=>r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
