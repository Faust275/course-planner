// e2e：OCR 预处理合并读写后——输出必须与旧的四步逐像素一致，且不能更慢
// 顺带验证「让出主线程」：预处理期间页面能响应一次 rAF
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Ocr && window.Store, null, { timeout: 8000 });

// 造一张 2400×4000 的「彩色表格截图」：白底 + 彩色底纹 + 表格线 + 深色小方块当文字
// 用确定性伪随机，保证两个 canvas 画出来一模一样
const makeCanvas = `(function () {
  var W = 2400, H = 4000;
  var c = document.createElement('canvas');
  c.width = W; c.height = H;
  var x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);

  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  // 彩色课程块
  var palette = ['#ffd6e0', '#cfe8ff', '#d8f5d0', '#e8dcff', '#ffe6c7'];
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 5; col++) {
      if (rnd() < 0.55) {
        x.fillStyle = palette[(row * 5 + col) % palette.length];
        x.fillRect(col * 480 + 2, row * 500 + 2, 476, 496);
      }
    }
  }
  // 深色表头
  x.fillStyle = '#1f3a93';
  x.fillRect(0, 0, W, 120);

  // 表格线
  x.strokeStyle = '#333'; x.lineWidth = 3;
  for (var i = 0; i <= 5; i++) { x.beginPath(); x.moveTo(i * 480, 0); x.lineTo(i * 480, H); x.stroke(); }
  for (var j = 0; j <= 8; j++) { x.beginPath(); x.moveTo(0, j * 500); x.lineTo(W, j * 500); x.stroke(); }

  // 模拟文字：密集的小黑块
  x.fillStyle = '#111';
  for (var k = 0; k < 2600; k++) {
    var bx = 20 + rnd() * (W - 60), by = 140 + rnd() * (H - 180);
    x.fillRect(bx, by, 12 + rnd() * 20, 8 + rnd() * 10);
  }
  return c;
})()`;

/* ---------- 1) 普通增强路径：新旧输出必须一致 ---------- */
const cmp = await page.evaluate(async (mk) => {
  const make = () => eval(mk);

  // 旧路径：四步各自的 canvas 包装，四次全图读写
  const c1 = make();
  const t1 = performance.now();
  Ocr.stripColorCardBg(c1);
  Ocr.enhance(c1);
  const l1 = Ocr.detectLines(c1);
  Ocr.isolateGridLines(c1, l1, 4);
  const oldMs = performance.now() - t1;

  // 新路径：一次读写
  const c2 = make();
  const t2 = performance.now();
  const l2 = await Ocr.preprocessCanvas(c2, {});
  const newMs = performance.now() - t2;

  return {
    oldMs, newMs,
    samePixels: c1.toDataURL() === c2.toDataURL(),
    sameLines: JSON.stringify(l1) === JSON.stringify(l2),
    vlines: (l2.vlines || []).length,
    hlines: (l2.hlines || []).length
  };
}, makeCanvas);

check('输出逐像素一致', cmp.samePixels);
check('检出线条一致', cmp.sameLines, JSON.stringify({ v: cmp.vlines, h: cmp.hlines }));
check('确实检出了表格线（不是两遍都没测出东西）', cmp.vlines >= 4 && cmp.hlines >= 4,
  cmp.vlines + ' 竖 / ' + cmp.hlines + ' 横');
check('合并读写不慢于旧的四步', cmp.newMs <= cmp.oldMs * 1.05,
  `旧 ${cmp.oldMs.toFixed(0)}ms → 新 ${cmp.newMs.toFixed(0)}ms`);
check('实际省下明显时间（至少 10%）', cmp.newMs < cmp.oldMs * 0.9,
  `旧 ${cmp.oldMs.toFixed(0)}ms → 新 ${cmp.newMs.toFixed(0)}ms`);

/* ---------- 2) 二值化分支：同样必须一致 ---------- */
const cmpBin = await page.evaluate(async (mk) => {
  const make = () => eval(mk);
  const c1 = make();
  Ocr.stripColorCardBg(c1);
  Ocr.binarize(c1);
  const l1 = Ocr.detectLines(c1);
  Ocr.isolateGridLines(c1, l1, 4);

  const c2 = make();
  const l2 = await Ocr.preprocessCanvas(c2, { binary: true });
  return {
    samePixels: c1.toDataURL() === c2.toDataURL(),
    sameLines: JSON.stringify(l1) === JSON.stringify(l2)
  };
}, makeCanvas);
check('二值化分支输出一致', cmpBin.samePixels);
check('二值化分支线条一致', cmpBin.sameLines);

/* ---------- 3) 让出主线程：预处理期间能跑一帧 ---------- */
const frames = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 2400;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1600, 2400);
  x.fillStyle = '#888';
  for (let i = 0; i < 400; i++) x.fillRect(Math.random() * 1500, Math.random() * 2300, 20, 12);

  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 0);
  await Ocr.preprocessCanvas(c, {});
  clearInterval(timer);
  return ticks;
});
check('预处理是分段的，中间让出过主线程', frames >= 1, frames + ' 次定时器机会');

/* ---------- 4) 小图 / 异常输入不炸 ---------- */
const edge = await page.evaluate(async () => {
  const tiny = document.createElement('canvas');
  tiny.width = 2; tiny.height = 2;
  const l = await Ocr.preprocessCanvas(tiny, {});
  return { ok: l !== undefined, v: (l && l.vlines) || [], h: (l && l.hlines) || [] };
});
check('2×2 小图不抛错', edge.ok);

check('全程无 JS 报错', errors.length === 0, errors[0] && errors[0].slice(0, 300));

await browser.close();
close();

const bad = ok.filter((r) => !r[1]);
ok.forEach(([n, p, e]) => console.log((p ? 'PASS: ' : 'FAIL: ') + n + (e === undefined ? '' : '  → ' + e)));
console.log('\n' + (ok.length - bad.length) + '/' + ok.length + ' passed');
if (bad.length) process.exit(1);
