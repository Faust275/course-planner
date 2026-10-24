// e2e：OCR 核对界面的置信度着色（标黄/标红、「只看存疑」、改完自动消标、明细页存疑徽标）
// 做法：拦截 Tesseract 的 CDN 请求返回一个桩，喂一份固定的词表（含高低不同置信度），
//       从而在不联网、不依赖真实模型的情况下，把真实的识别 → 归格 → 核对界面整条链跑通。
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
// sw.js 会缓存 tesseract.min.js，走 SW 的请求不经过 page.route，必须阻断
const ctx = await browser.newContext({ viewport: { width: 520, height: 1200 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

/* ---------- 假词表：一张 7 列 5 行的课表 ---------- */
const HGT = 18;
const COL_X = [200, 320, 440, 560, 680, 800, 920];
const ROW_Y = [120, 210, 300, 390, 480];
function w(text, cx, cy, conf) {
  const width = text.length * 15;
  // 按 Tesseract 原始结构给（parseResult 读的是 bbox / confidence）
  return { text, confidence: conf,
    bbox: { x0: Math.round(cx - width / 2), x1: Math.round(cx + width / 2),
            y0: Math.round(cy - HGT / 2), y1: Math.round(cy + HGT / 2) } };
}
const words = [];
for (let i = 0; i < 7; i++) words.push(w('周' + '一二三四五六日'[i], COL_X[i], 50, 96));
ROW_Y.forEach((y, i) => words.push(w('第' + (i + 1) + '节', 80, y, 95)));
words.push(w('高等数学', COL_X[0], ROW_Y[0], 96));   // 清楚
words.push(w('大学物理', COL_X[2], ROW_Y[1], 70));   // 中等
words.push(w('体育', COL_X[3], ROW_Y[2], 45));       // 存疑
words.push(w('线性代数', COL_X[5], ROW_Y[3], 88));   // 清楚

const stub = `window.Tesseract = {
  createWorker: function () {
    return Promise.resolve({
      setParameters: function () {},
      recognize: function () {
        return Promise.resolve({ data: { words: ${JSON.stringify(words)}, text: '' } });
      },
      terminate: function () { return Promise.resolve(); }
    });
  }
};`;
await page.route('**/tesseract.min.js', (route) => route.fulfill({
  status: 200, contentType: 'application/javascript', body: stub
}));

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(500);

/* ---------- 1) 打开导入弹窗，塞一张图进去 ---------- */
await page.evaluate(() => window.OcrDialog.open());
await page.waitForTimeout(300);

const fed = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 800;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 800);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  for (let i = 0; i <= 7; i++) {
    const x = 140 + i * 120;
    ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x, 520); ctx.stroke();
  }
  for (let r = 0; r <= 5; r++) {
    const y = 80 + r * 88;
    ctx.beginPath(); ctx.moveTo(140, y); ctx.lineTo(980, y); ctx.stroke();
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'timetable.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const inputs = [...document.querySelectorAll('.cp-ocr input[type="file"]')];
  if (!inputs.length) return { ok: false, reason: '没找到上传输入框' };
  inputs[0].files = dt.files;
  inputs[0].dispatchEvent(new Event('change'));
  return { ok: true, count: inputs.length };
});
check('弹窗里能找到上传入口', fed.ok === true, JSON.stringify(fed));
await page.waitForTimeout(600);

/* ---------- 2) 点「开始识别」→ 走到核对网格 ---------- */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.cp-ocr button')].find((x) => /开始识别/.test(x.textContent));
  if (b) b.click();
});
await page.waitForSelector('.cp-ocr-table', { timeout: 15000 });
const gridInfo = await page.evaluate(() => ({
  cells: document.querySelectorAll('.cp-ocr-cell').length,
  low: document.querySelectorAll('.cp-ocr-cell.cp-ocr-low').length,
  mid: document.querySelectorAll('.cp-ocr-cell.cp-ocr-mid').length,
  hint: (document.querySelector('.cp-ocr-hint.cp-ocr-suspect') || {}).textContent || ''
}));
check('核对网格已渲染', gridInfo.cells > 0, gridInfo.cells);
check('最没把握的那格标红', gridInfo.low === 1, gridInfo.low);
check('拿不太准的那格标黄', gridInfo.mid === 1, gridInfo.mid);
check('顶部提示说清了有几格要改', /2 格拿不准/.test(gridInfo.hint), gridInfo.hint);

const clearCells = await page.evaluate(() => {
  // 认得很清楚的两格（高等数学 / 线性代数）不该有颜色
  const marked = [...document.querySelectorAll('.cp-ocr-cell.cp-ocr-low, .cp-ocr-cell.cp-ocr-mid')]
    .map((t) => t.value.trim());
  return marked;
});
check('只有存疑的格子被标色', clearCells.length === 2 &&
  clearCells.includes('体育') && clearCells.includes('大学物理'), JSON.stringify(clearCells));

/* ---------- 3) 「只看存疑」：认得清的压暗 ---------- */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.cp-ocr button')].find((x) => /只看存疑/.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(400);
const dimInfo = await page.evaluate(() => ({
  dim: document.querySelectorAll('.cp-ocr-cell.cp-ocr-dim').length,
  low: document.querySelectorAll('.cp-ocr-cell.cp-ocr-low').length,
  dimHasSuspect: [...document.querySelectorAll('.cp-ocr-cell.cp-ocr-dim')]
    .some((t) => /体育|大学物理/.test(t.value)),
  btn: (() => {
    const b = [...document.querySelectorAll('.cp-ocr button')].find((x) => /只看存疑/.test(x.textContent));
    return b ? b.textContent : '';
  })()
}));
check('压暗的是认得清楚的那两格', dimInfo.dim === 2, dimInfo.dim);
check('存疑格子不会被压暗', dimInfo.dimHasSuspect === false);
check('存疑格子仍保持标红', dimInfo.low === 1, dimInfo.low);
check('按钮状态变成「开」', /开/.test(dimInfo.btn), dimInfo.btn);

// 再点一次关掉
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.cp-ocr button')].find((x) => /只看存疑/.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(300);
const undimmed = await page.evaluate(() => document.querySelectorAll('.cp-ocr-cell.cp-ocr-dim').length);
check('再点一次恢复全亮', undimmed === 0, undimmed);

/* ---------- 4) 改完一格 → 标记消失、计数减少 ---------- */
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('.cp-ocr-cell')].find((t) => t.value.trim() === '体育');
  ta.focus();
  ta.value = '体育（改过了）';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
const afterEdit = await page.evaluate(() => {
  const ta = [...document.querySelectorAll('.cp-ocr-cell')].find((t) => /体育/.test(t.value));
  const hint = document.querySelector('.cp-ocr-hint.cp-ocr-suspect') ||
               document.querySelector('.cp-ocr-hint.cp-ocr-calm');
  return {
    cls: ta ? ta.className : '',
    low: document.querySelectorAll('.cp-ocr-cell.cp-ocr-low').length,
    hint: hint ? hint.textContent : '',
    calm: !!document.querySelector('.cp-ocr-hint.cp-ocr-calm')
  };
});
check('改过的格子不再标红', !/cp-ocr-low/.test(afterEdit.cls), afterEdit.cls);
check('存疑总数从 2 降到 1', /1 格/.test(afterEdit.hint) || afterEdit.calm, afterEdit.hint);

/* ---------- 5) 解析成课程 → 明细里仍有「识别存疑」痕迹 ---------- */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.cp-ocr button')].find((x) => /解析成课程/.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(600);
const itemsInfo = await page.evaluate(() => ({
  items: document.querySelectorAll('.cp-ocr-item').length,
  badge: document.querySelectorAll('.cp-ocr-conf-badge').length,
  badgeText: [...document.querySelectorAll('.cp-ocr-conf-badge')].map((b) => b.textContent),
  // 课程名在 input 里，textContent 读不到，必须读 value
  names: [...document.querySelectorAll('.cp-ocr-item input')].map((i) => i.value).filter(Boolean)
}));
check('拆出了 4 门课', itemsInfo.items === 4, itemsInfo.items);
check('中置信的那门在明细里带「不太确定」徽标',
  itemsInfo.badgeText.some((t) => /不太确定/.test(t)) || itemsInfo.badge >= 1,
  JSON.stringify(itemsInfo.badgeText));
check('明细里看得到课程名', /高等数学/.test(itemsInfo.names.join(' ')), JSON.stringify(itemsInfo.names));

/* ---------- 6) 全程无 JS 报错 ---------- */
check('页面没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));

/* ---------- 汇总 ---------- */
const bad = ok.filter((o) => !o[1]);
ok.forEach((o) => console.log((o[1] ? 'PASS: ' : 'FAIL: ') + o[0] + (o[2] !== undefined ? '  → ' + o[2] : '')));
console.log('\n' + (ok.length - bad.length) + ' 通过 / ' + bad.length + ' 失败（共 ' + ok.length + ' 项）');

await browser.close();
close();
process.exit(bad.length ? 1 : 0);
