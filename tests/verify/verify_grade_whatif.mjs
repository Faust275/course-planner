// 单测：成绩 what-if（gradeSummary 的 overrides 覆盖）—— Node vm 加载真实 store.js
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { storeSource } from '../store-src.mjs';

const root = process.cwd();
const src = storeSource(root);

const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = function () {};
sandbox.setTimeout = function () { return 0; };
sandbox.clearTimeout = function () {};
sandbox.console = console;
sandbox.indexedDB = undefined;
const ls = { _m: {}, getItem(k){return Object.prototype.hasOwnProperty.call(this._m,k)?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];}, key(i){return Object.keys(this._m)[i]||null;}, get length(){return Object.keys(this._m).length;} };
sandbox.localStorage = ls;

vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Store = sandbox.Store;
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}
const near = (a, b) => a != null && Math.abs(a - b) < 0.011;

const sid = Store.currentSemesterId;
const leaf = (id, score) => ({ id, name: '总评', weight: 100, score, children: [] });
Store.state.grades[sid] = {
  'c:高数': { key: 'c:高数', source: 'manual', name: '高数', credit: 4, root: leaf('r1', 80) },
  'c:英语': { key: 'c:英语', source: 'manual', name: '英语', credit: 2, root: leaf('r2', 90) },
  'c:物理': { key: 'c:物理', source: 'manual', name: '物理', credit: 3, root: null } // 未出分
};

const base = Store.gradeSummary([sid]);
// 加权 = (80*4 + 90*2)/6 = 83.33；GPA = (3*4 + 4*2)/6 = 3.33（默认分段 80→3, 90→4）
check('base 加权均分≈83.33', near(base.weighted, 83.33), base.weighted);
check('base GPA≈3.33', near(base.gpa, 3.33), base.gpa);
check('base 已出分 2/3', base.scored === 2 && base.count === 3, base.scored + '/' + base.count);

// 假设高数考 100 → 加权 (100*4+90*2)/6=96.67，GPA (4*4+4*2)/6=4.00
const after = Store.gradeSummary([sid], [{ semesterId: sid, key: 'c:高数', score: 100 }]);
check('what-if 高数=100 加权≈96.67', near(after.weighted, 96.67), after.weighted);
check('what-if 高数=100 GPA=4.00', near(after.gpa, 4), after.gpa);

// 假设未出分的物理考 60 → 参与计算（此前被忽略），GPA 应下降
const after2 = Store.gradeSummary([sid], [{ semesterId: sid, key: 'c:物理', score: 60 }]);
// (3*4 + 4*2 + 1*3)/9 = (12+8+3)/9 = 2.56
check('what-if 物理=60 计入分母', after2.scored === 3 && near(after2.gpa, 23 / 9), after2.gpa);

// 覆盖不命中任何课 → 等于 base
const noHit = Store.gradeSummary([sid], [{ semesterId: sid, key: 'c:不存在', score: 100 }]);
check('覆盖不命中 → 与 base 相同', near(noHit.gpa, base.gpa) && near(noHit.weighted, base.weighted), noHit.gpa + '/' + noHit.weighted);

// 兼容：不传 overrides 仍正常
check('兼容：单参调用正常', near(Store.gradeSummary([sid]).gpa, base.gpa));

const allOk = results.every(r => r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
