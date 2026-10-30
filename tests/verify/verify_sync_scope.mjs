import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8141/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 120)); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
// 跳过引导
await page.evaluate(() => {
  const el = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find(e => e.textContent.trim() === '跳过');
  if (el) el.click();
});
await page.waitForTimeout(600);

// 造数据（含图片，用于验证剥离效果）
await page.evaluate(() => {
  const S = window.Store;
  const st = JSON.parse(S.exportJSON());
  st.courses = [];
  for (let i = 0; i < 20; i++) st.courses.push({
    id: 'c' + i, name: '课程示例' + i, teacher: '张老师', location: '教学楼A-30' + (i % 9),
    day: i % 5, start: (i % 4) + 1, span: 2, weeks: [1, 16], color: '#6366f1', note: '带教材'
  });
  st.tasks = [];
  for (let i = 0; i < 60; i++) st.tasks.push({
    id: 't' + i, title: '待办事项标题' + i, done: i % 3 === 0,
    due: '2026-09-' + String((i % 28) + 1).padStart(2, '0'), quadrant: i % 4, note: ''
  });
  st.ledger = [];
  for (let i = 0; i < 40; i++) st.ledger.push({
    id: 'l' + i, type: i % 2 ? 'expense' : 'income', amount: (i * 7) % 500 + 10,
    category: '餐饮', note: '午饭' + i, date: '2026-09-' + String((i % 28) + 1).padStart(2, '0')
  });
  st.notes = [];
  for (let i = 0; i < 20; i++) st.notes.push({
    id: 'n' + i, title: '笔记' + i, body: '正文内容'.repeat(20), createdAt: Date.now()
  });
  // 背景图 200KB + 桌宠 100KB（模拟）
  st.settings = st.settings || {};
  st.settings.background = st.settings.background || { mask: 0.5 };
  st.settings.background.dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(Math.round(200 * 1024 * 4 / 3));
  st.settings.pet = st.settings.pet || {};
  st.settings.pet.src = 'data:image/png;base64,' + 'B'.repeat(Math.round(100 * 1024 * 4 / 3));
  st.settings.asr = st.settings.asr || {};
  st.settings.asr.apiKey = 'SECRET_ASR_KEY';
  st.settings.ocr = st.settings.ocr || {};
  st.settings.ocr.apiKey = 'SECRET_OCR_KEY';

  S.importJSON(JSON.stringify(st));
  S.emit();
});
await page.waitForTimeout(600);

// 三档导出
const result = await page.evaluate(async () => {
  const S = window.Store;
  function b64(u8) {
    let s = '', CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  async function pack(text) {
    const enc = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'undefined') return 'CP1R' + b64(enc);
    const buf = await new Response(new Blob([enc]).stream()
      .pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return 'CP1G' + b64(new Uint8Array(buf));
  }
  const out = {};
  for (const scope of ['lite', 'standard', 'full']) {
    const json = S.exportJSON(scope);
    const obj = JSON.parse(json);
    const code = await pack(json);
    out[scope] = {
      codeLen: code.length,
      jsonBytes: new TextEncoder().encode(json).length,
      hasBgImage: !!(obj.settings && obj.settings.background && obj.settings.background.dataUrl),
      hasPetImage: !!(obj.settings && obj.settings.pet && obj.settings.pet.src),
      hasAsrKey: !!(obj.settings && obj.settings.asr && obj.settings.asr.apiKey),
      hasOcrKey: !!(obj.settings && obj.settings.ocr && obj.settings.ocr.apiKey),
      courses: (obj.courses || []).length,
      tasks: (obj.tasks || []).length,
      ledger: (obj.ledger || []).length,
      notes: (obj.notes || []).length,
      periods: (obj.periods || []).length,
      semesters: (obj.semesters || []).length,
      exportScope: obj.exportScope || '(none)',
    };
  }
  // 旧格式兼容：不传参数 = full，且旧码可解析
  const legacyJson = S.exportJSON();
  const legacyObj = JSON.parse(legacyJson);
  out.legacy = {
    sameAsFull: legacyJson === S.exportJSON('full'),
    hasBgImage: !!(legacyObj.settings && legacyObj.settings.background && legacyObj.settings.background.dataUrl),
  };
  return out;
});

console.log(JSON.stringify({ result, errors: errs.slice(0, 8) }, null, 2));
await browser.close();
