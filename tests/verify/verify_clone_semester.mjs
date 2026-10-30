// 单测：多学期模板复制 cloneCourses —— Node vm 加载真实 store.js
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
await Store.init();

const results = [];
function check(name, cond, extra) { results.push({name, ok:!!cond}); console.log((cond?'PASS: ':'FAIL: ')+name+(extra!==undefined?'  → '+extra:'')); }

const oldSid = Store.currentSemesterId;
// 旧学期两门课（其中一门是旧版无 semesterId 的遗留课）
Store.state.courses = [
  { id:'c1', name:'高等数学', credit:4, semesterId: oldSid, slots:[{day:1,start:'08:00',end:'09:40',weeks:[1,2,3]}], exam:{date:'2027-01-10'} },
  { id:'c2', name:'大学英语', credit:2, semesterId: oldSid, slots:[{day:3,start:'10:00',end:'11:40',weeks:[1,2]}] },
  { id:'c3', name:'遗留课', credit:3 } // 无 semesterId
];

const newSem = Store.addSemester({ name:'2026-2027 春季', startDate:'2027-02-22', weeks:18 });
const n = Store.cloneCourses(oldSid, newSem.id);
check('复制门数=3（含遗留无 semesterId 课）', n === 3, n);

const copied = Store.state.courses.filter(c => c.semesterId === newSem.id);
check('新学期课程数=3', copied.length === 3, copied.length);
check('课程名保留', copied.map(c=>c.name).sort().join(',') === '大学英语,遗留课,高等数学', copied.map(c=>c.name).join(','));
check('id 全部换新', copied.every(c => !['c1','c2','c3'].includes(c.id)), copied.map(c=>c.id).join(','));
const math = copied.find(c=>c.name==='高等数学');
check('时段/考试时间随课复制', math && math.slots && math.slots.length===1 && math.exam && math.exam.date==='2027-01-10', JSON.stringify(math && math.exam));
check('原学期课程未被改动', Store.state.courses.filter(c=>c.semesterId===oldSid).length===2, 'still ' + Store.state.courses.filter(c=>c.semesterId===oldSid).length);
check('原课对象未被复用到新学期（深拷贝）', copied.every(c => Store.state.courses.filter(x=>x.id===c.id).length===1), 'ok');

// 边界
check('同学期复制返回 0', Store.cloneCourses(oldSid, oldSid) === 0, Store.cloneCourses(oldSid, oldSid));
check('空参返回 0', Store.cloneCourses('', newSem.id) === 0, Store.cloneCourses('', newSem.id));

const allOk = results.every(r=>r.ok);
console.log(allOk ? '\nALL PASS' : '\nSOME FAIL');
process.exit(allOk ? 0 : 1);
