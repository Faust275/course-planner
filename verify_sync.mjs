import { chromium } from 'playwright';
const URL = process.env.URL || 'http://127.0.0.1:8137/index.html';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 120)); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => {
  const s = [...document.querySelectorAll('button,div,span,a')].find(e => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await p.waitForTimeout(400);

const out = await p.evaluate(() => {
  const S = window.Store;
  S.reset();
  const st = JSON.parse(S.exportJSON());
  st.courses = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, name: '课程' + i, day: i % 5, start: 1, span: 2, weeks: [1, 16] }));
  st.tasks = Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, title: '任务' + i, done: false }));
  st.ledger = Array.from({ length: 10 }, (_, i) => ({ id: 'l' + i, type: 'expense', amount: 10, category: '餐饮', note: 'n' + i, date: '2026-09-01' }));
  st.notes = Array.from({ length: 5 }, (_, i) => ({ id: 'n' + i, title: '笔记' + i, body: '正文' + i, createdAt: Date.now() }));
  st.diaries = [{ id: 'd1', date: '2026-09-01', body: '我的私密日记' }];
  st.settings.background = { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(100), mask: 0.5 };
  st.settings.pet = { src: 'data:image/png;base64,' + 'B'.repeat(100) };
  st.settings.asr = { apiKey: 'SECRET_ASR' };
  st.settings.ocr = { apiKey: 'SECRET_OCR' };
  S.importJSON(JSON.stringify(st));

  const r = {};
  const std = JSON.parse(S.exportJSON('standard'));
  r.std = {
    hasDiary: 'diaries' in std,
    bgImg: !!(std.settings && std.settings.background && std.settings.background.dataUrl),
    pet: !!(std.settings && std.settings.pet && std.settings.pet.src),
    asrKey: !!(std.settings && std.settings.asr && std.settings.asr.apiKey),
    ocrKey: !!(std.settings && std.settings.ocr && std.settings.ocr.apiKey),
    courses: (std.courses || []).length,
    tasks: (std.tasks || []).length
  };
  const lite = JSON.parse(S.exportJSON('lite'));
  r.lite = {
    hasDiary: 'diaries' in lite,
    tasks: (lite.tasks || []).length,
    ledger: (lite.ledger || []).length,
    notes: (lite.notes || []).length,
    courses: (lite.courses || []).length
  };
  const full = JSON.parse(S.exportJSON('full'));
  r.full = {
    hasDiary: !!(full.diaries && full.diaries.length),
    bgImg: !!(full.settings && full.settings.background && full.settings.background.dataUrl),
    asrKey: !!(full.settings && full.settings.asr && full.settings.asr.apiKey)
  };
  // 显式要求带密钥的导出（设置页「导出（含密钥）」走的就是这条路径）
  const fullK = JSON.parse(S.exportJSON('full', { includeKeys: true }));
  r.fullWithKeys = !!(fullK.settings && fullK.settings.asr && fullK.settings.asr.apiKey);
  // 同步往返：标准档导入 -> 本机日记应保留，密钥仍脱敏、图片不带
  const diaryBefore = S.state.diaries.length;
  S.importJSON(S.exportJSON('standard'));
  r.roundtrip = {
    diaryPreserved: S.state.diaries.length === diaryBefore,
    coursesKept: (S.state.courses || []).length === r.std.courses,
    bgStripped: !(S.state.settings.background && S.state.settings.background.dataUrl),
    asrStillClean: !(S.state.settings.asr && S.state.settings.asr.apiKey),
    ocrStillClean: !(S.state.settings.ocr && S.state.settings.ocr.apiKey)
  };
  return r;
});

const checks = [
  ['标准档不含日记键', out.std.hasDiary === false],
  ['标准档不含背景图', out.std.bgImg === false],
  ['标准档不含桌宠', out.std.pet === false],
  ['标准档脱敏 ASR', out.std.asrKey === false],
  ['标准档脱敏 OCR', out.std.ocrKey === false],
  ['标准档含课程', out.std.courses === 8],
  ['标准档含任务', out.std.tasks === 20],
  ['精简档不含日记键', out.lite.hasDiary === false],
  ['精简档清空任务', out.lite.tasks === 0],
  ['精简档清调控账', out.lite.ledger === 0],
  ['精简档清空灵感', out.lite.notes === 0],
  ['精简档保留课程', out.lite.courses === 8],
  ['全量档含日记', out.full.hasDiary === true],
  ['全量档含背景图', out.full.bgImg === true],
  // 备份默认剥离 API 密钥是刻意的安全设计（store.js exportJSON: 仅 includeKeys 才保留）
  ['全量档默认剥离密钥', out.full.asrKey === false],
  ['includeKeys=true 时全量档带密钥', out.fullWithKeys === true],
  ['同步往返日记保留', out.roundtrip.diaryPreserved === true],
  ['同步往返课程保留', out.roundtrip.coursesKept === true],
  ['同步往返背景已剥离', out.roundtrip.bgStripped === true],
  ['同步往返 ASR 仍脱敏', out.roundtrip.asrStillClean === true],
  ['同步往返 OCR 仍脱敏', out.roundtrip.ocrStillClean === true],
  ['无控制台报错', errs.length === 0]
];

let allPass = true;
for (const [name, ok] of checks) {
  if (!ok) allPass = false;
  console.log((ok ? '✓ ' : '✗ ') + name);
}
console.log('\n' + (allPass ? 'ALL PASS' : 'FAILED'));
if (errs.length) console.log('errors:', errs.slice(0, 6));
await b.close();
process.exit(allPass ? 0 : 1);
