// 单测：健康看板总开关（settings.healthOn）——Node vm 加载真实 store.js
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { storeSource } from '../store-src.mjs';

const root = process.cwd();
const src = storeSource(root);

function makeStore(preload) {
  const sandbox = {};
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = function () {};
  sandbox.setTimeout = function () { return 0; }; sandbox.clearTimeout = function () {};
  sandbox.console = console; sandbox.indexedDB = undefined;
  const m = Object.assign({}, preload || {});
  sandbox.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    removeItem(k) { delete m[k]; },
    key(i) { return Object.keys(m)[i] || null; },
    get length() { return Object.keys(m).length; }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

/* ---------- 1) 全新档案：默认关闭、未问过 ---------- */
const sb = makeStore();
const Store = sb.Store;
await Store.init();

check('新档默认未开启', Store.healthEnabled() === false, JSON.stringify(Store.settings.healthOn));
check('新档默认未问过', Store.healthAsked() === false);
check('新档 hasHealthData=false', Store.hasHealthData() === false);

/* ---------- 2) 开关读写 ---------- */
Store.setHealthOn(true);
check('setHealthOn(true) 生效', Store.healthEnabled() === true);
check('开一次即算问过', Store.healthAsked() === true);

Store.setHealthOn(false);
check('setHealthOn(false) 生效', Store.healthEnabled() === false);
check('关掉后仍记着已问过', Store.healthAsked() === true);

/* ---------- 3) 老档迁移：没有 healthOn，但有健康数据 → 自动开启 ---------- */
const sb2 = makeStore();
const S2 = sb2.Store;
await S2.init();
delete S2.state.settings.healthOn;
S2.state.sleeps = [{ id: 's1', date: '2026-10-20', start: '23:00', end: '07:00', total: 480 }];
S2.ensure();
check('老档有睡眠数据 → 自动开启', S2.state.settings.healthOn.enabled === true,
  JSON.stringify(S2.state.settings.healthOn));
check('老档有睡眠数据 → 标记已问过', S2.state.settings.healthOn.asked === true);

/* ---------- 4) 老档迁移：没有 healthOn 也没有健康数据 → 保持关闭待询问 ---------- */
const sb3 = makeStore();
const S3 = sb3.Store;
await S3.init();
delete S3.state.settings.healthOn;
S3.state.sleeps = []; S3.state.metrics = []; S3.state.meals = []; S3.state.weightLog = [];
S3.ensure();
check('无健康数据的老档 → 保持关闭', S3.state.settings.healthOn.enabled === false,
  JSON.stringify(S3.state.settings.healthOn));
check('无健康数据的老档 → 未问过（会弹一次）', S3.state.settings.healthOn.asked === false);

/* ---------- 5) 半截字段：只有 enabled 没有 asked ---------- */
const sb4 = makeStore();
const S4 = sb4.Store;
await S4.init();
S4.state.settings.healthOn = { enabled: true };
S4.ensure();
check('缺 asked 时补 false', S4.state.settings.healthOn.asked === false,
  JSON.stringify(S4.state.settings.healthOn));
check('已有 enabled 保留', S4.state.settings.healthOn.enabled === true);

/* ---------- 6) 关闭后 hasHealthData 仍能反映真实数据 ---------- */
S4.state.sleeps = [{ id: 'x', date: '2026-10-21', start: '23:00', end: '06:00', total: 420 }];
check('hasHealthData 与开关无关', S4.hasHealthData() === true);

const allOk = results.every((r) => r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
