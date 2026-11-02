// e2e：照片管理（统计 / 清理无主 / 清空 / 导出包可读回）
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/**
 * 点掉 V.confirm 的确认按钮。
 * danger 模式下确认键是红色 cp-btn-danger（不是 btn-primary），
 * 所以统一取页脚里最后一个按钮。
 */
async function confirmOK() {
  await page.waitForSelector('.cp-modal .cp-modal-foot', { timeout: 6000 });
  await page.evaluate(() => {
    const foot = document.querySelector('.cp-modal .cp-modal-foot');
    const btns = [...foot.querySelectorAll('button')];
    btns[btns.length - 1].click();
  });
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 6000 });
}

try {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.Store && window.App && window.Media && window.Zip, null, { timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove()));

  // ---------- 造两张有主的照片 + 一张孤儿 ----------
  const seeded = await page.evaluate(async () => {
    await window.Media.clearAll();
    const D = window.DateUtil;
    const today = D.toStr(D.today());
    const keys = [];
    for (let i = 0; i < 2; i++) {
      const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, i, 7, 7, 7]);
      keys.push(await window.Media.put(new Blob([bytes], { type: 'image/jpeg' })));
    }
    window.Store.addMeal({
      date: today, time: '12:00', type: 'lunch', content: '照片管理测试', kcal: 300,
      photos: keys.map((k) => ({ k: k, n: '' }))
    });
    // 孤儿：入库但没有任何记录引用
    const orphan = await window.Media.put(new Blob([new Uint8Array([0xFF, 0xD8, 9, 9])], { type: 'image/jpeg' }));
    const u = await window.Media.usage();
    return { keys: keys, orphan: orphan, count: u.count };
  });
  check('准备了 3 张照片（2 有主 + 1 孤儿）', seeded.count === 3 && seeded.keys.every(Boolean), JSON.stringify(seeded));

  // ---------- 打开设置 → 识别与数据 → 数据管理 ----------
  // 必须等 boot 收尾，否则它会在 go() 之后把视图切回首页
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.App.go('settings'));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const cat = [...document.querySelectorAll('.cp-view.cp-active .cp-set-cat')].find((x) => /识别与数据/.test(x.textContent));
    if (cat) cat.click();
  });
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.cp-view.cp-active .cp-set-item')].find((x) => /数据管理/.test(x.textContent));
    if (it) it.click();
  });
  await page.waitForTimeout(700);

  const card = await page.evaluate(() => {
    const view = document.querySelector('.cp-view.cp-active');
    if (!view) return null;
    const title = [...view.querySelectorAll('.cp-section-title')].find((x) => x.textContent.trim() === '照片管理');
    const box = title && title.parentElement;
    return box ? { text: box.textContent, buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null;
  });
  check('设置里有「照片管理」卡片', !!card, JSON.stringify(card && card.buttons));
  check('统计显示共 3 张、其中 1 张无主',
    !!card && /共 3 张/.test(card.text) && /其中 1 张已无对应记录/.test(card.text), card && card.text.slice(0, 90));
  check('三个操作按钮齐全',
    !!card && ['导出到相册', '清理无主照片', '清空照片'].every((x) => card.buttons.indexOf(x) >= 0),
    JSON.stringify(card && card.buttons));

  // ---------- 清理无主 ----------
  await page.evaluate(() => {
    const view = document.querySelector('.cp-view.cp-active');
    const b = [...view.querySelectorAll('button')].find((x) => /清理无主照片/.test(x.textContent));
    if (b) b.click();
  });
  await confirmOK();
  const afterClean = await page.evaluate(async () => {
    const u = await window.Media.usage();
    const all = await window.Media.all();
    return { count: u.count, keys: all.map((x) => x.key) };
  });
  check('清理后只剩 2 张有主照片', afterClean.count === 2, JSON.stringify(afterClean));
  check('孤儿照片确实被删掉', afterClean.keys.indexOf(seeded.orphan) < 0, JSON.stringify(afterClean.keys));

  await page.waitForTimeout(400);
  const cardAfter = await page.evaluate(() => {
    const view = document.querySelector('.cp-view.cp-active');
    const title = [...view.querySelectorAll('.cp-section-title')].find((x) => x.textContent.trim() === '照片管理');
    return title && title.parentElement ? title.parentElement.textContent : '';
  });
  check('卡片统计跟着刷新（不再提无主）',
    /共 2 张/.test(cardAfter) && cardAfter.indexOf('已无对应记录') < 0, cardAfter.slice(0, 90));

  // ---------- 导出包能被自己的解包器读回 ----------
  const roundTrip = await page.evaluate(async () => {
    const all = await window.Media.all();
    const files = [];
    for (const p of all) {
      const buf = await p.blob.arrayBuffer();
      files.push({ name: 'photos/' + p.key + '.jpg', bytes: new Uint8Array(buf) });
    }
    const zipped = window.Zip.create(files);
    const back = await window.Zip.read(zipped);
    const sizes = back.map((e) => e.bytes.length).sort();
    return {
      isZip: window.Zip.looksLikeZip(zipped),
      names: back.map((e) => e.name).sort(),
      sizes: sizes,
      expected: all.map((p) => p.blob.size).sort()
    };
  });
  check('照片能打包成合法 zip', roundTrip.isZip === true);
  check('包内条目数与照片数一致', roundTrip.names.length === 2, JSON.stringify(roundTrip.names));
  check('包内每张字节数与原始一致', JSON.stringify(roundTrip.sizes) === JSON.stringify(roundTrip.expected),
    JSON.stringify(roundTrip));

  // ---------- 清空 ----------
  await page.evaluate(() => {
    const view = document.querySelector('.cp-view.cp-active');
    const b = [...view.querySelectorAll('button')].find((x) => /清空照片/.test(x.textContent));
    if (b) b.click();
  });
  await confirmOK();
  const afterClear = await page.evaluate(() => window.Media.usage());
  check('清空后照片库为空', afterClear.count === 0, JSON.stringify(afterClear));

  const mealPhotos = await page.evaluate(() => {
    const ms = window.Store.state.meals || [];
    const m = ms[ms.length - 1];
    return { meals: ms.length, photoKeys: (m.photos || []).length };
  });
  check('清空照片不影响餐记录本身', mealPhotos.meals >= 1 && mealPhotos.photoKeys === 2, JSON.stringify(mealPhotos));

  await page.waitForTimeout(400);
  const cardEmpty = await page.evaluate(() => {
    const view = document.querySelector('.cp-view.cp-active');
    const title = [...view.querySelectorAll('.cp-section-title')].find((x) => x.textContent.trim() === '照片管理');
    return title && title.parentElement ? title.parentElement.textContent : '';
  });
  check('空状态下给出引导文案', cardEmpty.indexOf('还没有照片') >= 0, cardEmpty.slice(0, 80));

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
