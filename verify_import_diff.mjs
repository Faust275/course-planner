// 单测：导入覆盖前的 diff 摘要（Store.diffImport / diffStates / diffLines）
// Node vm 加载真实 store.js
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
await Store.init();

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra !== undefined ? '  → ' + extra : ''));
}

const row = (d, key) => d.rows.find(function (r) { return r.key === key; }) || {};

/* ---------- 1. 空库 + 完整备份 ---------- */
Store.state.tasks.length = 0;
Store.state.ledger.length = 0;
Store.state.notes.length = 0;
Store.state.courses.length = 0;

const full = {
  courses: [
    { id: 'a1', name: '高等数学', teacher: '张老师', location: 'A101', startWeek: 1, endWeek: 16, weekType: 'all', credit: 4 },
    { id: 'a2', name: '大学英语', teacher: '李老师', location: 'B202', startWeek: 1, endWeek: 16, weekType: 'all', credit: 2 }
  ],
  tasks: [{ id: 't1', title: '写作业', dueDate: '2026-10-30', done: false }],
  ledger: [{ id: 'l1', amount: 12, cat: '吃饭' }],
  notes: [{ id: 'n1', text: '灵感一条' }]
};

let d = Store.diffImport(JSON.stringify(full));
check('空库导入 → 课程新增 2', row(d, 'courses').add === 2, JSON.stringify(row(d, 'courses')));
check('空库导入 → 课程消失 0', row(d, 'courses').gone === 0);
check('空库导入 → 待办新增 1', row(d, 'tasks').add === 1);
check('空库导入 → 没有会被清空的模块', d.wipes.length === 0, d.wipes.map(w => w.name).join(','));
check('空库导入 → 备份不为空', d.empty === false);
check('空库导入 → totalBefore=0 / totalAfter=5', d.totalBefore === 0 && d.totalAfter === 5,
  d.totalBefore + '→' + d.totalAfter);

/* ---------- 2. 精简档：本地有、备份没有 → 会被清空 ---------- */
// 注意 diffImport 只读不写，所以上一步导入的内容并没有真的进到本机；
// 这里手动给本机塞数据，才能测出「备份里没有 → 会被清空」。
Store.state.ledger.push({ id: 'm1', amount: 22, cat: '吃饭' }, { id: 'm2', amount: 8, cat: '交通' });
Store.state.notes.push({ id: 'q1', text: '本机灵感' });
d = Store.diffImport({ courses: [] });
const ledgerRow = row(d, 'ledger');
check('精简档导入 → 记账 after=0', ledgerRow.after === 0, ledgerRow.after);
check('精简档导入 → 记账被列为「会被清空」', d.wipes.some(function (w) { return w.key === 'ledger'; }),
  d.wipes.map(w => w.key).join(','));
check('精简档导入 → 灵感也被列为会被清空', d.wipes.some(function (w) { return w.key === 'notes'; }));
check('diffLines 出现「会被清空」字样', d.lines.some(function (l) { return l.indexOf('会被清空') >= 0; }),
  d.lines.join(' / '));

/* ---------- 3. 课程：新增 / 消失 / 改动 ---------- */
Store.state.courses.length = 0;
Store.state.courses.push(
  { id: 'x1', semesterId: 'semA', name: '线性代数', teacher: '王老师', location: 'C301', startWeek: 1, endWeek: 16, weekType: 'all', credit: 3 },
  { id: 'x2', semesterId: 'semA', name: '体育', teacher: '赵老师', location: '操场', startWeek: 1, endWeek: 16, weekType: 'all', credit: 1 }
);
const incoming = {
  courses: [
    // 同一门课，只是换了教室 + 学分 → 改动
    { id: 'y1', semesterId: 'semB', name: '线性代数', teacher: '王老师', location: 'D401', startWeek: 1, endWeek: 16, weekType: 'all', credit: 4 },
    // 新加的一门
    { id: 'y2', semesterId: 'semB', name: '概率论', teacher: '孙老师', location: 'E101', startWeek: 1, endWeek: 16, weekType: 'all', credit: 2 },
    // 「体育」在备份里没有 → 消失
    // 颜色/备注变了不算改动（这里加个 color 验证不误报）
    { id: 'y3', semesterId: 'semB', name: '体育', teacher: '赵老师', location: '操场', startWeek: 1, endWeek: 16, weekType: 'all', credit: 1, color: '#ff0000' }
  ]
};
d = Store.diffImport(incoming);
let c = row(d, 'courses');
check('课程 2 → 3', c.before === 2 && c.after === 3, c.before + '→' + c.after);
check('课程新增 1（概率论）', c.add === 1, c.add);
check('课程消失 0（体育仍在，只改了颜色）', c.gone === 0, c.gone);
check('课程改动 1（线性代数换教室+学分）', c.mod === 1, c.mod);

/* ---------- 4. 跨设备 semesterId 不同，不该全判成删+增 ---------- */
check('semesterId 不同不影响同一门课的识别（没有全员新增）', c.add === 1, c.add);

/* ---------- 5. 待办：完成状态变化算改动 ---------- */
Store.state.tasks.length = 0;
Store.state.tasks.push(
  { id: 'k1', title: '交实验报告', dueDate: '2026-10-28', done: false },
  { id: 'k2', title: '背单词', dueDate: '2026-10-28', done: true }
);
d = Store.diffImport({
  tasks: [
    { id: 'z1', title: '交实验报告', dueDate: '2026-10-28', done: true },   // 打勾了
    { id: 'z2', title: '背单词', dueDate: '2026-10-28', done: true }        // 没变
  ]
});
let t = row(d, 'tasks');
check('待办 2 → 2', t.before === 2 && t.after === 2);
check('待办改动 1（只有打勾那条）', t.mod === 1, t.mod);
check('待办新增 0 / 消失 0', t.add === 0 && t.gone === 0);

/* ---------- 6. 几乎是空壳的备份 ---------- */
Store.state.tasks.length = 1;
d = Store.diffImport({ courses: [], tasks: [], ledger: [], notes: [], plans: [] });
check('空壳备份 → empty=true', d.empty === true, 'totalAfter=' + d.totalAfter);

/* ---------- 7. diffImport 只读，不改当前状态 ---------- */
Store.state.courses.length = 0;
Store.state.courses.push({ id: 'keep', name: '保留课', teacher: '某老师' });
const snapBefore = JSON.stringify(Store.state.courses);
const snapCount = Store.state.courses.length;
Store.diffImport({ courses: [] });
check('diffImport 不修改本机课程', JSON.stringify(Store.state.courses) === snapBefore,
  Store.state.courses.length + ' vs ' + snapCount);
check('diffImport 不修改日记数组引用', Array.isArray(Store.state.diaries));

/* ---------- 8. 无效输入 ---------- */
let threw = '';
try { Store.diffImport({ foo: 1 }); } catch (e) { threw = e.message; }
check('无关内容 → 抛「没有找到可恢复的数据」', threw === '没有找到可恢复的数据', threw);

threw = '';
try { Store.diffImport('{不是 json'); } catch (e) { threw = e.message; }
check('非法 JSON → 抛错', !!threw);
threw = '';
try { Store.diffImport(null); } catch (e) { threw = e.message; }
check('null → 抛错', !!threw);

/* ---------- 9. 同步码会删掉日记：本地日记默认保留 ---------- */
Store.state.diaries = [{ id: 'd1', date: '2026-10-01', text: '本机日记' }];
d = Store.diffImport({ courses: [], tasks: [] });
check('同步码没带 diaries → 本机日记不算「会被清空」', row(d, 'diaries').after === 1, row(d, 'diaries').after);

const failed = results.filter(r => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) {
  console.log('失败项：\n' + failed.map(f => ' - ' + f.name).join('\n'));
  process.exit(1);
}
