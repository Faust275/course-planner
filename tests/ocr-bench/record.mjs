// 用真 Tesseract 给基准分例录音：把 case.json 渲染成一张真实的课表截图（DOM 表格 + 系统字体，
// 与教务系统截图同源），跑一遍真实识别，把词表存成 words.real.json（连同 image.png，方便肉眼比对）。
//
// 为什么用 DOM 渲染而不是 canvas 画字：canvas 的 fillText 出来的细笔画，Tesseract 几乎认不出
// （实测「高等数学」被识别成「旨」）。浏览器排版渲染的文字才是用户真实会喂进来的那种。
//
// 为什么要录而不每次都跑：首次要下 1.8MB 中文模型，每张图几秒；录一次、之后离线跑分才能长期用。
//
// 用法：
//   node tests/ocr-bench/record.mjs                  重新渲染并录制全部
//   node tests/ocr-bench/record.mjs c01-clean-grid   只录一个
//   node tests/ocr-bench/record.mjs my-case --from-image
//       直接识别 cases/my-case/image.png（放自己的真实课表截图时用这个）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';
import { DAY_WORDS } from './layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(HERE, 'cases');

const argv = process.argv.slice(2);
const fromImage = argv.includes('--from-image');
const only = argv.find((a) => !a.startsWith('-'));

const dirs = fs.readdirSync(CASES)
  .filter((d) => fs.existsSync(path.join(CASES, d, 'case.json')))
  .filter((d) => !only || d === only)
  .sort();

if (!dirs.length) {
  console.log('没有匹配的分例：' + (only || '(全部)'));
  process.exit(1);
}

const { base, close } = await startServer();
// 不阻断 Service Worker：sw 会缓存 tesseract 的 wasm 与模型，第二张图起明显更快
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERR:', String(e)));

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Ocr && window.Store, null, { timeout: 10000 });
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(400);

/* 把课表渲染成一个真实 DOM 表格，再截图 —— 与用户从教务系统截图是同一类像素 */
async function shotCase(c) {
  await page.evaluate(({ c, DAY }) => {
    const old = document.getElementById('__ocrbench');
    if (old) old.remove();

    const days = c.days || 7;
    const periods = c.periods || 5;
    const fsBase = (c.style && c.style.fontSize) || 20;
    const grid = (c.style && c.style.grid) || '#9aa0ae';
    const textColor = (c.style && c.style.textColor) || '#111';
    const colors = ['#e8f1ff', '#e6f7ef', '#fff6e6', '#fdeef2', '#eef0ff'];
    const cellOf = {};
    (c.cells || []).forEach((cell) => { cellOf[cell.day + ',' + cell.period] = cell; });

    const rows = [];
    let head = '<tr><th></th>';
    for (let i = 0; i < days; i++) head += '<th>周' + DAY[i] + '</th>';
    rows.push(head + '</tr>');

    for (let p = 1; p <= periods; p++) {
      let tr = '<tr><td class="per">第' + p + '节</td>';
      for (let d = 1; d <= days; d++) {
        const cell = cellOf[d + ',' + p];
        const bg = cell && c.style && c.style.cellFill === 'course'
          ? 'background:' + colors[(d + p) % colors.length] + ';' : '';
        const body = cell
          ? (cell.lines || []).map((t, li) =>
              '<div class="' + (li === 0 ? 'name' : 'meta') + '">' + t + '</div>').join('')
          : '';
        tr += '<td style="' + bg + '">' + body + '</td>';
      }
      rows.push(tr + '</tr>');
    }

    const noiseCss = (c.style && c.style.noise)
      ? '#__ocrbench::after{content:"";position:absolute;inset:0;pointer-events:none;' +
        'background-image:radial-gradient(rgba(0,0,0,.28) 1px,transparent 1px);' +
        'background-size:3px 3px;opacity:' + (0.2 + c.style.noise) + ';}'
      : '';

    const el = document.createElement('div');
    el.id = '__ocrbench';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;width:1400px;height:900px;background:#fff;';
    el.innerHTML = '<style>' +
      '#__ocrbench table{width:100%;height:100%;table-layout:fixed;border-collapse:collapse;' +
        'font-family:"Microsoft YaHei","SimHei",sans-serif;color:' + textColor + ';}' +
      '#__ocrbench th{font-size:' + (fsBase + 2) + 'px;font-weight:700;padding:10px 4px;' +
        'border:1px solid ' + grid + ';}' +
      '#__ocrbench td{border:1px solid ' + grid + ';padding:4px;text-align:center;vertical-align:middle;}' +
      '#__ocrbench td.per{font-size:' + (fsBase - 3) + 'px;width:11%;}' +
      '#__ocrbench .name{font-size:' + fsBase + 'px;font-weight:700;line-height:1.4;}' +
      '#__ocrbench .meta{font-size:' + (fsBase - 4) + 'px;line-height:1.4;}' +
      noiseCss +
      '</style><table>' + rows.join('') + '</table>';
    document.body.appendChild(el);
  }, { c, DAY: DAY_WORDS });

  const buf = await page.locator('#__ocrbench').screenshot({ type: 'png' });
  await page.evaluate(() => {
    const el = document.getElementById('__ocrbench');
    if (el) el.remove();
  });
  return buf;
}

let total = 0;
for (const d of dirs) {
  const dir = path.join(CASES, d);
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  const imgPath = path.join(dir, 'image.png');
  const useImage = fromImage && fs.existsSync(imgPath);
  const t0 = Date.now();

  let buf;
  if (useImage) {
    buf = fs.readFileSync(imgPath);
    console.log(`${d}: 用现成图片 image.png`);
  } else {
    buf = await shotCase(c);
    fs.writeFileSync(imgPath, buf);
  }

  const res = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'case.png', { type: 'image/png' });
    try {
      const r = await window.Ocr.recognizeLocal(file, null, {});
      // 只存内部格式（text/conf/x0..y1/cx/cy），与 layout.buildWords 保持一致
      return {
        ok: true,
        words: r.words.map((w) => ({
          text: w.text, conf: Math.round(w.conf),
          x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, cx: w.cx, cy: w.cy
        }))
      };
    } catch (e) { return { ok: false, err: String(e) }; }
  }, buf.toString('base64'));

  if (!res.ok) {
    console.log(`${d}: 识别失败 → ${res.err}`);
    continue;
  }
  fs.writeFileSync(path.join(dir, 'words.real.json'), JSON.stringify(res.words, null, 1) + '\n', 'utf8');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${d}: 录到 ${res.words.length} 个词，耗时 ${secs}s`);
  total++;
}

console.log(`\n完成 ${total} 个。跑分：node tests/ocr-bench/run.mjs --real`);
await browser.close();
close();
