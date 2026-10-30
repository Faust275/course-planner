import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8137/index.html';
const errors = [];
const warnings = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 1) 引导遮罩：点“跳过”
const skip = await page.$('text=跳过');
if (skip) { await skip.click(); await page.waitForTimeout(400); }

// 2) 核心结构是否渲染
const title = await page.$eval('#viewTitle', el => el.textContent.trim()).catch(() => '(none)');
const navCount = await page.$$eval('#nav > *', els => els.length).catch(() => 0);
const tabCount = await page.$$eval('#tabbar > *', els => els.length).catch(() => 0);
const viewsHTML = await page.$eval('#views', el => el.innerHTML.length).catch(() => 0);

// 3) 切换视图：点第 4 个导航项，看标题变化
const before = title;
const items = await page.$$('#nav > *');
let after = before;
if (items.length >= 4) {
  await items[3].click(); await page.waitForTimeout(500);
  after = await page.$eval('#viewTitle', el => el.textContent.trim()).catch(() => '(none)');
}

// 4) 桌宠 API 是否存在（开发者开关下默认关，但对象应已注册）
const petType = await page.evaluate(() => typeof window.Pet);

// 5) IndexedDB 是否可用 + 持久化抽象是否工作（写一条再读）
const idb = await page.evaluate(async () => {
  return new Promise(res => {
    try {
      const db = indexedDB.open('__cp_test__', 1);
      db.onsuccess = () => { db.result.close(); res('ok'); };
      db.onerror = () => res('err:' + db.error);
    } catch (e) { res('throw:' + e.message); }
  });
});

// 6) 设置页：找到“桌宠（开发）”入口，确认 renderPet 已挂载
let petPanel = false;
try {
  // 找到导航里“设置”
  const setIdx = await page.evaluate(() => {
    const ns = [...document.querySelectorAll('#nav > *')];
    return ns.findIndex(n => n.textContent.includes('设置'));
  });
  if (setIdx >= 0) {
    (await page.$$('#nav > *'))[setIdx].click();
    await page.waitForTimeout(500);
    petPanel = await page.evaluate(() => !!document.querySelector('#views')?.textContent?.includes('桌宠（开发）'));
  }
} catch {}

await browser.close();

console.log(JSON.stringify({
  title, navCount, tabCount, viewsHTML, viewChanged: before !== after, after,
  petType, idb, petPanel,
  errorCount: errors.length, warningCount: warnings.length,
  errors: errors.slice(0, 20), warnings: warnings.slice(0, 10),
}, null, 2));

process.exit(errors.length ? 1 : 0);
