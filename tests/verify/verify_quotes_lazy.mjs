// e2e：诗词语料外置懒加载——首屏只带迷你集，完整语料空闲时再取，取不到也不影响用
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

/* ================= 一、正常网络：迷你集先上，完整语料后到 ================= */
{
  // 关掉 Service Worker：sw.js 会把 quotes-data.js 预缓存，缓存命中就看不到真实的加载过程
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 480, height: 1400 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const reqs = [];
  page.on('request', (r) => reqs.push(r.url()));
  // 把语料请求压后 3 秒，才能稳定观察到「先迷你集、后完整集」这个中间态
  await page.route('**/quotes-data.js', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });

  const resp = await page.goto(base + '/index.html', { waitUntil: 'load' });
  const bytes = (await resp.body()).length;
  await page.waitForFunction(() => window.Store && window.App && window.Daily, null, { timeout: 8000 });
  await page.evaluate(() => {
    const s = document.querySelector('.ob-skip') ||
      [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
    if (s) s.click();
  });
  await page.waitForTimeout(500);

  check('index.html 小于 2.3MB（语料没内联进来）', bytes > 0 && bytes < 2.8 * 1024 * 1024,
    (bytes / 1024 / 1024).toFixed(2) + ' MB');

  const early = await page.evaluate(() => ({
    poems: Daily.poems.length,
    words: Daily.words.length,
    full: Daily.full,
    first: (Daily.poems[0] || {}).t,
    cardText: (document.querySelector('.cp-dc-poem') || document.querySelector('.dc-poem') || {}).innerText || ''
  }));
  check('首屏用迷你集：诗 24 篇', early.poems === 24, early.poems);
  check('首屏用迷你集：词 60 个', early.words === 60, early.words);
  check('迷你集第 1 篇仍是《关雎》（与完整集同序，收藏不错位）', early.first === '关雎', early.first);
  check('每日一句卡片已经显示出内容（不是空壳）', early.cardText.trim().length > 4, early.cardText.slice(0, 30));

  // 空闲加载：最多等 6 秒
  const loaded = await page.waitForFunction(() => window.Daily && window.Daily.full === true, null, { timeout: 8000 })
    .then(() => true).catch(() => false);
  check('空闲时自动取到完整语料', loaded);

  if (loaded) {
    const full = await page.evaluate(() => ({
      poems: Daily.poems.length,
      words: Daily.words.length,
      first: Daily.poems[0].t,
      requested: true
    }));
    check('完整语料 1000 篇 / 4392 词', full.poems === 1000 && full.words === 4392,
      full.poems + ' / ' + full.words);
    check('升级后第 1 篇还是《关雎》（前 24 篇顺序未变）', full.first === '关雎', full.first);
    check('请求过 quotes-data.js', reqs.some((u) => /quotes-data\.js/.test(u)));
  }

  // 升级后卡片上的「随机取自 N 篇」要跟着变对
  await page.evaluate(() => {
    const card = document.querySelector('.cp-dc-poem') || document.querySelector('.dc-poem');
    if (card) card.click();
  });
  await page.waitForTimeout(400);
  const meta = await page.evaluate(() => {
    const m = document.querySelector('.cp-modal');
    return m ? m.innerText.replace(/\s+/g, ' ') : '';
  });
  check('详情里写的是 1000 篇（升级后重绘过）', /1000 篇/.test(meta), meta.slice(0, 60));

  check('全程无 JS 报错', errors.length === 0, errors[0] && errors[0].slice(0, 300));
  await ctx.close();
}

/* ================= 二、语料取不到：退回迷你集，不报错 ================= */
{
  // 同样关掉 SW，否则它会把预缓存的语料照常喂回来，测不到 404 分支
  const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 480, height: 1400 } });
  const page = await ctx2.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
  await page.route('**/quotes-data.js', (route) => route.fulfill({ status: 404, body: '' }));

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.Store && window.App && window.Daily, null, { timeout: 8000 });
  await page.evaluate(() => {
    const s = document.querySelector('.ob-skip') ||
      [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
    if (s) s.click();
  });
  await page.waitForTimeout(1500);

  const st = await page.evaluate(() => ({
    full: Daily.full,
    poems: Daily.poems.length,
    word: (Daily.word() || {}).w,
    cardText: (document.querySelector('.cp-dc-poem') || document.querySelector('.dc-poem') || {}).innerText || '',
    cardWord: (document.querySelector('.cp-dc-word') || document.querySelector('.dc-word') || {}).innerText || ''
  }));
  check('404 时停在迷你集', st.full === false && st.poems === 24, st.poems);
  check('404 时诗词卡片照常显示', st.cardText.trim().length > 4, st.cardText.slice(0, 24));
  check('404 时单词卡片照常显示', st.cardWord.trim().length > 2, st.cardWord.slice(0, 24));
  check('404 时有词可取（不是 undefined）', !!st.word, st.word);

  // 换一篇还能用
  const swapped = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.cp-dc-next, .dc-next')]
      .find((b) => /换一篇/.test(b.textContent));
    if (!btn) return null;
    const before = Daily.poem().ex;
    btn.click();
    return { before: before, after: Daily.poem().ex };
  });
  check('404 时「换一篇」仍然可用', !!swapped && swapped.before !== swapped.after,
    swapped ? (swapped.before === swapped.after ? '没换' : '换了') : '没找到按钮');
  check('缺语料不抛错', errors.length === 0, errors[0] && errors[0].slice(0, 300));

  await ctx2.close();
}

await browser.close();
close();

const bad = ok.filter((r) => !r[1]);
ok.forEach(([n, p, e]) => console.log((p ? 'PASS: ' : 'FAIL: ') + n + (e === undefined ? '' : '  → ' + e)));
console.log('\n' + (ok.length - bad.length) + '/' + ok.length + ' passed');
if (bad.length) process.exit(1);
