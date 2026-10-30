import { chromium } from 'playwright';
const URL = process.env.URL || 'http://127.0.0.1:8137/index.html';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 110)); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => {
  const s = [...document.querySelectorAll('button,div,span,a')].find(e => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await p.waitForTimeout(400);

// 造点数据，使标准档同步内容非空
await p.evaluate(() => {
  const S = window.Store;
  const st = JSON.parse(S.exportJSON());
  st.courses = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, name: '课程' + i, day: i % 5, start: 1, span: 2, weeks: [1, 16] }));
  st.tasks = Array.from({ length: 30 }, (_, i) => ({ id: 't' + i, title: '任务' + i, done: false }));
  S.importJSON(JSON.stringify(st));
  S.emit();
});
await p.waitForTimeout(400);

async function openData() {
  // 确保处于设置-数据管理子页
  await p.evaluate(() => {
    if (window.App && window.App.go) {
      window.App.go('settings', { tab: 'data' });
    }
  });
  await p.waitForTimeout(600);
  // 轮询等待「生成同步文件」按钮
  for (let i = 0; i < 15; i++) {
    const ok = await p.evaluate(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('生成同步文件')));
    if (ok) break;
    await p.waitForTimeout(400);
  }
}

const r = {};
await openData();

// 入口按钮
r.hasGenBtn = await p.evaluate(() => !!document.querySelector('button') &&
  [...document.querySelectorAll('button')].some(x => x.textContent.includes('生成同步文件')));
r.hasImpBtn = await p.evaluate(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('导入同步文件')));

// 生成同步文件
const genClicked = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('生成同步文件'));
  if (btn) { btn.click(); return true; }
  return false;
});
if (!genClicked) {
  const dump = await p.evaluate(() => ({
    setCats: [...document.querySelectorAll('.cp-set-cat')].map(c => ({ t: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 22), active: c.className.includes('active') })),
    genBtn: [...document.querySelectorAll('button')].some(x => x.textContent.includes('生成同步文件')),
    impBtn: [...document.querySelectorAll('button')].some(x => x.textContent.includes('导入同步文件')),
    hasTextarea: !!document.querySelector('textarea.cp-sync-code')
  }));
  console.log('DIAG gen:', JSON.stringify(dump));
}
await p.waitForTimeout(genClicked ? 900 : 300);

r.gen = await p.evaluate(() => {
  const ta = document.querySelector('textarea.cp-sync-code');
  if (!ta) return { ok: false };
  const v = ta.value;
  let obj = null, parseOk = false;
  try { obj = JSON.parse(v); parseOk = true; } catch (e) {}
  return {
    ok: true, startsWithBrace: v.charAt(0) === '{', parseOk,
    hasDiary: obj ? ('diaries' in obj) : null,
    courses: obj ? (obj.courses || []).length : null
  };
});

// chip 切换：精简 -> 标准
await p.evaluate(() => { const c = [...document.querySelectorAll('.cp-tag-chip')].find(x => x.textContent.trim() === '精简'); if (c) c.click(); });
await p.waitForTimeout(700);
r.liteLen = await p.evaluate(() => { const ta = document.querySelector('textarea.cp-sync-code'); return ta ? ta.value.length : -1; });
await p.evaluate(() => { const c = [...document.querySelectorAll('.cp-tag-chip')].find(x => x.textContent.trim() === '标准'); if (c) c.click(); });
await p.waitForTimeout(700);
r.stdLen = await p.evaluate(() => { const ta = document.querySelector('textarea.cp-sync-code'); return ta ? ta.value.length : -1; });

// 抓取标准档 JSON 文本，用于后续导入 / 兼容测试
const stdText = await p.evaluate(() => { const ta = document.querySelector('textarea.cp-sync-code'); return ta ? ta.value : ''; });

// 关闭生成弹窗
await p.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '关闭'); if (btn) btn.click(); });
await p.waitForTimeout(400);

// 辅助：在当前导入弹窗里粘贴文本并点同步（处理确认框）
async function importAndSync(text) {
  // 打开导入弹窗
  const opened = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导入同步文件'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!opened) return false;
  await p.waitForTimeout(500);
  await p.evaluate((t) => {
    const ta = document.querySelector('textarea.cp-sync-code');
    if (ta) ta.value = t;
  }, text);
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('同步到这台设备')).click());
  await p.waitForTimeout(500);
  // 点确认「覆盖同步」（若存在）
  const hasConfirm = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('覆盖同步'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(900);
  return hasConfirm;
}

// D. 纯 JSON 文本导入
await importAndSync(stdText);
r.jsonImportCourses = await p.evaluate(() => window.Store.state.courses.length);

// 读回标准档文本（数据可能被覆盖，重新生成一份标准档用于 CP1R）
const stdText2 = await (async () => {
  await openData();
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('生成同步文件')).click());
  await p.waitForTimeout(900);
  const t = await p.evaluate(() => { const ta = document.querySelector('textarea.cp-sync-code'); return ta ? ta.value : ''; });
  await p.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '关闭'); if (btn) btn.click(); });
  await p.waitForTimeout(400);
  return t;
})();

// E. 旧 CP1R 兼容：raw base64 包一层
const cp1r = await p.evaluate((json) => 'CP1R' + btoa(unescape(encodeURIComponent(json))), stdText2);
await importAndSync(cp1r);
r.cp1rImportCourses = await p.evaluate(() => window.Store.state.courses.length);

// F. 非法内容应被拒绝（不覆盖、有错误提示）
const coursesBeforeBad = await p.evaluate(() => window.Store.state.courses.length);
await importAndSync('这啥也不是不是json');
r.badKept = await p.evaluate((n) => window.Store.state.courses.length === n, coursesBeforeBad);

r.errors = errs.slice(0, 6);

const checks = [
  ['存在「生成同步文件」按钮', r.hasGenBtn === true],
  ['存在「导入同步文件」按钮', r.hasImpBtn === true],
  ['生成的同步内容是 JSON', r.gen && r.gen.parseOk === true],
  ['同步内容以 { 开头', r.gen && r.gen.startsWithBrace === true],
  ['同步内容不含日记键', r.gen && r.gen.hasDiary === false],
  ['同步内容含课程', r.gen && r.gen.courses === 8],
  ['精简档比标准档短', r.liteLen >= 0 && r.stdLen > r.liteLen],
  ['纯 JSON 文本导入成功', r.jsonImportCourses === 8],
  ['旧 CP1R 兼容导入成功', r.cp1rImportCourses === 8],
  ['非法内容被拒绝（数据不变）', r.badKept === true],
  ['无控制台报错', errs.length === 0]
];

let allPass = true;
for (const [name, ok] of checks) { if (!ok) allPass = false; console.log((ok ? '✓ ' : '✗ ') + name); }
console.log('\n' + (allPass ? 'ALL PASS' : 'FAILED'));
if (errs.length) console.log('errors:', errs.slice(0, 6));
await b.close();
process.exit(allPass ? 0 : 1);
