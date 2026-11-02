// e2e：饮食照片——选图→压缩→存 IndexedDB→保存→重开回显→删餐清理
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

try {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.Store && window.App && window.DateUtil && window.Media, null, { timeout: 15000 });
  await page.evaluate(() => {
    document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove());
  });

  const today = await page.evaluate(() => window.DateUtil.toStr(window.DateUtil.today()));

  // 打开记饮食弹窗
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 5000 });

  // 选图（隐藏的拍照 input）
  await page.setInputFiles('input[type="file"][capture]', { name: 'meal.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.cp-mp-item', { timeout: 8000 });
  const thumbOk = await page.evaluate(() => {
    const img = document.querySelector('.cp-mp-item img');
    return !!(img && img.src && img.src.indexOf('blob:') === 0);
  });
  check('选图后出现缩略图（blob URL）', thumbOk);

  // 填写必填项并保存
  await page.fill('.cp-modal input[placeholder*="鸡腿饭"]', '测试餐');
  await page.click('.cp-modal-foot .cp-btn-primary');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 6000 });

  const saved = await page.evaluate(() => {
    const ms = window.Store.state.meals;
    const m = ms[ms.length - 1];
    return m && m.photos && m.photos.length === 1 ? { id: m.id, key: m.photos[0].k } : null;
  });
  check('保存后餐记录带 1 张照片', !!saved);
  if (!saved) throw new Error('没有拿到保存后的照片记录');

  // IDB 里确实有 blob
  const inDb = await page.evaluate(async (key) => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('cp-media', 1);
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) { resolve(false); return; }
        const r = db.transaction('photos', 'readonly').objectStore('photos').get(key);
        r.onsuccess = () => resolve(!!r.result && r.result.size > 0);
        r.onerror = () => resolve(false);
      };
    });
  }, saved.key);
  check('照片已写入 cp-media/photos', inDb);

  // 重开弹窗，能回显
  await page.evaluate((args) => window.MealDialog.open(args.d, args.id), { d: today, id: saved.id });
  await page.waitForSelector('.cp-modal', { timeout: 5000 });
  await page.waitForSelector('.cp-mp-item img', { timeout: 5000 });
  const reopenOk = await page.evaluate(() => {
    const img = document.querySelector('.cp-mp-item img');
    return !!(img && img.src && img.src.indexOf('blob:') === 0);
  });
  check('重开弹窗照片回显', reopenOk);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 4000 });

  // 删餐后照片从 IDB 清掉
  await page.evaluate((id) => window.Store.removeMeal(id), saved.id);
  const gone = await page.evaluate(async (key) => {
    await new Promise((r) => setTimeout(r, 400));
    return await new Promise((resolve) => {
      const req = indexedDB.open('cp-media', 1);
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        const r = db.transaction('photos', 'readonly').objectStore('photos').get(key);
        r.onsuccess = () => resolve(!r.result);
        r.onerror = () => resolve(false);
      };
    });
  }, saved.key);
  check('删餐后照片已清理', gone);

  check('无页面异常', errors.length === 0, errors[0]);
} catch (e) {
  fail++;
  console.log('  ✗ 异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
} finally {
  await browser.close();
  close();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
