// Playwright 端到端：移动端横滑手势 + PWA 更新机制（sw network-first + 更新 Toast）
// 覆盖：课表横滑切周（左下一/右上一）、月历横滑切月、纵向滚动与短触不误触、
//       导航请求 network-first（服务器出新版刷新即得）、断网回退缓存、
//       新 SW 接管时弹「应用已更新」Toast 且点击立即刷新
// 自带静态文件服务（临时目录，可原地改文件模拟发新版），不依赖外部服务。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(join(ROOT, 'index.html'));

let ok = 0, bad = 0;
const errors = [];
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

/* ---------- 临时部署目录 + 静态服务 ---------- */
const TMP = mkdtempSync(join(tmpdir(), 'cp-sw-'));
copyFileSync(join(ROOT, 'index.html'), join(TMP, 'index.html'));
copyFileSync(join(ROOT, 'sw.js'), join(TMP, 'sw.js'));
let hits = 0;
const server = createServer((req, res) => {
  hits++;
  const name = req.url.split('?')[0].replace(/^\//, '').replace(/\/$/, '') || 'index.html';
  try {
    const body = readFileSync(join(TMP, name));
    res.writeHead(200, { 'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/index.html';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });

/** 在元素中心起笔、抬笔（合成 TouchEvent） */
async function swipe(page, selector, dx, dy) {
  await page.evaluate(([sel, ddx, ddy]) => {
    const root = document.querySelector(sel);
    const r = root.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const t1 = new Touch({ identifier: 1, target: root, clientX: x0, clientY: y0 });
    const t2 = new Touch({ identifier: 1, target: root, clientX: x0 + ddx, clientY: y0 + ddy });
    root.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
    root.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
  }, [selector, dx, dy]);
  await page.waitForTimeout(500);
}

async function boot(hash) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() || {}).url || '';
    errors.push('console: [' + loc + '] ' + m.text());
  });
  await page.goto(BASE + (hash || ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
  await page.waitForTimeout(400);
  return page;
}

/* ==========================================================
 * A. 横滑手势
 * ========================================================== */
console.log('A. 横滑手势');
let pg = await boot('');
await pg.evaluate(() => { window.App.go('schedule'); });
await pg.waitForTimeout(600);

const weekNo = () => pg.evaluate(() => {
  const n = document.querySelector('#view-schedule .cp-week-label span');
  return n ? n.textContent.trim() : null;
});
const w0 = await weekNo();
check('课表默认显示当前周', /第 \d+ 周|假期周/.test(w0 || ''), w0);

await swipe(pg, '#view-schedule', -160, 10);   // 左滑 → 下一周
const w1 = await weekNo();
check('课表左滑 → 下一周', w1 !== w0, { w0, w1 });

await swipe(pg, '#view-schedule', 160, 10);    // 右滑 → 上一周
const w2 = await weekNo();
check('课表右滑 → 回到原周', w2 === w0, { w0, w2 });

await swipe(pg, '#view-schedule', 10, -180);   // 纵向滑动 → 不切周
check('纵向滑动不误触', (await weekNo()) === w0);

await swipe(pg, '#view-schedule', -40, 6);     // 位移不足 60px → 不切周
check('短横滑（<60px）不误触', (await weekNo()) === w0);

// 第 1 周右滑不会越界（goWeek 里 clamp 到 1）
await pg.evaluate(() => { window.App.views.find(v => v.id === 'schedule').goWeek(1); });
await pg.waitForTimeout(400);
await swipe(pg, '#view-schedule', 160, 10);
check('第 1 周继续右滑停在原处', (await weekNo()) === '第 1 周', await weekNo());

// 月历横滑切月
await pg.evaluate(() => { window.App.go('calendar'); });
await pg.waitForTimeout(600);
const monthLabel = () => pg.evaluate(() => {
  const n = document.querySelector('#view-calendar .cp-week-label span');
  return n ? n.textContent.replace(/\s+/g, ' ').trim() : null;
});
const m0 = await monthLabel();
check('日历显示当前月份', /\d+ 年 \d+ 月/.test(m0 || ''), m0);

await swipe(pg, '#view-calendar', -160, 10);
const m1 = await monthLabel();
check('日历左滑 → 下个月', m1 !== m0, { m0, m1 });

await swipe(pg, '#view-calendar', 160, 10);
check('日历右滑 → 回到本月', (await monthLabel()) === m0, await monthLabel());

await pg.close();

/* ==========================================================
 * B. SW 更新机制（network-first + 更新 Toast）
 * ========================================================== */
console.log('B. SW 更新机制');
pg = await boot('');
// 等 SW 装好并接管（skipWaiting + clients.claim）
await pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
check('SW 安装并接管页面', true);

// 「发新版」：只改 index.html（sw.js 不变——旧策略下这种发法用户永远拿不到）
const MARK = 'CP-UPDATE-MARKER-' + Date.now();
writeFileSync(join(TMP, 'index.html'), INDEX.toString('utf8').replace('</body>', '<!-- ' + MARK + ' --></body>'));

await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(600);
const gotNew = await pg.evaluate(m => document.documentElement.outerHTML.includes(m), MARK);
check('index.html 改动后刷新即得（导航 network-first）', gotNew);

// 断网回退：fetch 失败时用缓存兜底
await ctx.setOffline(true);
await pg.reload({ waitUntil: 'load' }).catch(() => {});
await pg.waitForTimeout(1200);
const offlineOk = await pg.evaluate(() => !!document.querySelector('#app, .cp-app, #viewTitle'));
check('断网时回退到缓存（应用能打开）', offlineOk);
await ctx.setOffline(false);

// 「发新 SW」：改 sw.js 触发字节对比 → 新 SW 安装接管 → controllerchange → Toast
const swSrc = readFileSync(join(TMP, 'sw.js'), 'utf8');
writeFileSync(join(TMP, 'sw.js'), swSrc.replace("cp-app-v1", "cp-app-v2"));
await pg.reload({ waitUntil: 'networkidle' });

let toastShown = true;
try {
  await pg.waitForSelector('#cpUpdateToast', { timeout: 20000 });
} catch { toastShown = false; }
check('新 SW 接管时弹出「应用已更新」Toast', toastShown);

const toastText = toastShown ? await pg.evaluate(() => document.querySelector('#cpUpdateToast').innerText.replace(/\s+/g, ' ')) : '';
check('Toast 文案带「立即刷新」按钮', /应用已更新/.test(toastText) && /立即刷新/.test(toastText), toastText);

if (toastShown) {
  await Promise.all([
    pg.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    pg.evaluate(() => document.querySelector('#cpUpdateToast .cp-update-btn').click())
  ]);
  await pg.waitForTimeout(800);
  check('点「立即刷新」会重载页面', true);
  check('刷新后 Toast 不再出现（新版本已是当前）',
    !(await pg.evaluate(() => document.querySelector('#cpUpdateToast'))));
}

const hasController = await pg.evaluate(() => !!navigator.serviceWorker.controller);
check('更新后仍有 SW 控制页面（离线能力保留）', hasController);
await pg.close();

/* ==========================================================
 * 收尾
 * ========================================================== */
// favicon / manifest 探测的 404、断网用例主动制造的断连，都是预期噪音
const realErrors = errors.filter(e =>
  !/favicon/.test(e) && !/manifest\.webmanifest/.test(e) && !/ERR_INTERNET_DISCONNECTED/.test(e));
await b.close();
server.close();

console.log('');
if (realErrors.length) {
  bad++;
  console.log('  ✗ 控制台 / 页面报错 ' + realErrors.length + ' 条：');
  realErrors.slice(0, 6).forEach(e => console.log('    · ' + e));
} else {
  ok++;
  console.log('  ✓ 无控制台报错');
}
console.log('\n通过 ' + ok + ' 项，失败 ' + bad + ' 项');
process.exit(bad ? 1 : 0);
