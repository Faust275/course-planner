// e2e：做法 / 杯型 / 糖度 / 小料勾选——把看不见的油和糖交给用户勾，而不是让 AI 猜
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

const sumKcal = () => page.evaluate(() => {
  const b = document.querySelector('.cp-food-sum .cp-fs-line b');
  return b ? Number(b.textContent) : null;
});

try {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.Store && window.App && window.DateUtil && window.MealDialog && window.FoodMods, null, { timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove()));
  const today = await page.evaluate(() => window.DateUtil.toStr(window.DateUtil.today()));

  /* ================= 1) 生食材 → 做法勾选 ================= */
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 5000 });
  await page.fill('.cp-modal input[placeholder*="搜食物"]', '茄子');
  await page.waitForSelector('.cp-food-item', { timeout: 5000 });
  await page.click('.cp-food-item');
  await page.waitForSelector('.cp-fp-row', { timeout: 5000 });

  const rawKcal = await sumKcal();
  check('生茄子默认 100 克 = 25 kcal', rawKcal === 25, String(rawKcal));

  // 放大到 200 克
  await page.fill('.cp-fp-row .cp-fp-q', '200');
  await page.waitForTimeout(150);
  check('200 克生茄子 = 50 kcal', (await sumKcal()) === 50, String(await sumKcal()));

  const cookRow = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.cp-fp-mod-line')];
    const line = lines.find((l) => l.querySelector('.cp-fp-mod-key') && l.querySelector('.cp-fp-mod-key').textContent === '做法');
    return line ? [...line.querySelectorAll('.cp-mod-chip')].map((b) => b.textContent) : null;
  });
  check('生食材出现「做法」勾选', !!cookRow && cookRow.length >= 5, JSON.stringify(cookRow));
  check('做法含清炒/家常炒/红烧/油炸', !!cookRow && ['少油清炒', '家常炒', '红烧', '油炸'].every((x) => cookRow.indexOf(x) >= 0), JSON.stringify(cookRow));

  // 家常炒：每 100g +112 kcal → 50 + 224 = 274
  await page.locator('.cp-mod-chip', { hasText: '家常炒' }).first().click();
  await page.waitForTimeout(150);
  const sauteed = await sumKcal();
  check('200g 茄子 + 家常炒 = 274 kcal', Math.abs(sauteed - 274) <= 1, String(sauteed));

  // 单选替换：改少油清炒 → 50 + 108 = 158，且不应叠加
  await page.locator('.cp-mod-chip', { hasText: '少油清炒' }).first().click();
  await page.waitForTimeout(150);
  const light = await sumKcal();
  check('换成少油清炒 = 158 kcal（单选替换不叠加）', Math.abs(light - 158) <= 1, String(light));

  // 切回家常炒并保存
  await page.locator('.cp-mod-chip', { hasText: '家常炒' }).first().click();
  await page.waitForTimeout(150);
  const content = await page.evaluate(() => {
    const i = [...document.querySelectorAll('.cp-modal input')].find((x) => (x.placeholder || '').indexOf('鸡腿饭') >= 0);
    return i ? i.value : '';
  });
  check('「吃了什么」自动带上做法', content.indexOf('家常炒') >= 0, content);

  await page.click('.cp-modal-foot .cp-btn-primary');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 6000 });

  const savedCook = await page.evaluate(() => {
    const ms = window.Store.state.meals;
    const m = ms[ms.length - 1];
    const it = m && m.items && m.items[0];
    if (!it) return null;
    return {
      n: it.n, cat: it.cat, kcal: m.kcal,
      mods: (it.mods || []).map((x) => ({ id: x.id, k: x.k }))
    };
  });
  check('落库保留做法修饰', !!savedCook && savedCook.mods.some((x) => x.id === 'home' && x.k === 'per100'), JSON.stringify(savedCook));
  check('落库整餐热量 274 kcal', !!savedCook && Math.abs(savedCook.kcal - 274) <= 1, savedCook && String(savedCook.kcal));

  /* ================= 2) 重开回显 ================= */
  const mealId = await page.evaluate(() => {
    const ms = window.Store.state.meals;
    return ms[ms.length - 1].id;
  });
  await page.evaluate((a) => window.MealDialog.open(a.d, a.id), { d: today, id: mealId });
  await page.waitForSelector('.cp-fp-mods', { timeout: 5000 });
  const reOn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.cp-mod-chip')].find((x) => x.textContent === '家常炒');
    return !!b && b.className.indexOf('cp-on') >= 0;
  });
  check('重开弹窗「家常炒」保持选中态', reOn);
  const reKcal = await sumKcal();
  check('重开热量仍是 274 kcal', Math.abs(reKcal - 274) <= 1, String(reKcal));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 4000 });

  /* ================= 3) 甜饮 → 杯型 / 糖度 / 小料 ================= */
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 5000 });
  await page.fill('.cp-modal input[placeholder*="搜食物"]', '星冰乐');
  await page.waitForSelector('.cp-food-item', { timeout: 5000 });
  await page.click('.cp-food-item');
  await page.waitForSelector('.cp-fp-mods', { timeout: 5000 });

  const keys = await page.evaluate(() => [...document.querySelectorAll('.cp-fp-mod-key')].map((x) => x.textContent));
  check('甜饮出现 杯型/糖度/小料 三行', ['杯型', '糖度', '小料'].every((k) => keys.indexOf(k) >= 0), JSON.stringify(keys));

  // 大杯 ×1.2：400 → 480
  await page.locator('.cp-mod-chip', { hasText: '大杯' }).first().click();
  await page.waitForTimeout(150);
  check('星冰乐换大杯 = 480 kcal（×1.2）', Math.abs((await sumKcal()) - 480) <= 1, String(await sumKcal()));

  // 加珍珠 +100 → 580
  await page.locator('.cp-mod-chip', { hasText: '珍珠' }).first().click();
  await page.waitForTimeout(150);
  check('大杯 + 珍珠 = 580 kcal', Math.abs((await sumKcal()) - 580) <= 1, String(await sumKcal()));

  // 换无糖 -200 → 380
  await page.locator('.cp-mod-chip', { hasText: '无糖' }).first().click();
  await page.waitForTimeout(150);
  check('大杯 + 珍珠 + 无糖 = 380 kcal', Math.abs((await sumKcal()) - 380) <= 1, String(await sumKcal()));

  // 再挂一个奶盖 +130 → 510
  await page.locator('.cp-mod-chip', { hasText: '奶盖' }).first().click();
  await page.waitForTimeout(150);
  check('小料多选叠加（+奶盖）= 510 kcal', Math.abs((await sumKcal()) - 510) <= 1, String(await sumKcal()));

  await page.click('.cp-modal-foot .cp-btn-primary');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 6000 });
  const savedDrink = await page.evaluate(() => {
    const ms = window.Store.state.meals;
    const m = ms[ms.length - 1];
    return { kcal: m.kcal, content: m.content, ids: (m.items[0].mods || []).map((x) => x.id) };
  });
  check('饮品落库含 大杯/珍珠/无糖/奶盖',
    ['large', 'pearl', 'none', 'cheese'].every((x) => savedDrink.ids.indexOf(x) >= 0), JSON.stringify(savedDrink.ids));
  check('饮品整餐热量 510 kcal', Math.abs(savedDrink.kcal - 510) <= 1, String(savedDrink.kcal));

  /* ================= 4) 已带糖度的奶茶不再给糖度（防重复扣） ================= */
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 5000 });
  await page.fill('.cp-modal input[placeholder*="搜食物"]', '奶茶');
  await page.waitForSelector('.cp-food-item', { timeout: 5000 });
  const teaNames = await page.evaluate(() => [...document.querySelectorAll('.cp-food-item b')].map((b) => b.textContent));
  const idx = teaNames.indexOf('奶茶（无糖）');
  check('库里能找到「奶茶（无糖）」', idx >= 0, JSON.stringify(teaNames));
  await page.evaluate((i) => document.querySelectorAll('.cp-food-item')[i].click(), idx);
  await page.waitForSelector('.cp-fp-mods', { timeout: 5000 });
  const teaKeys = await page.evaluate(() => [...document.querySelectorAll('.cp-fp-mod-key')].map((x) => x.textContent));
  check('已含糖度的奶茶不再显示「糖度」行', teaKeys.indexOf('糖度') < 0, JSON.stringify(teaKeys));
  check('但仍可调杯型与小料', teaKeys.indexOf('杯型') >= 0 && teaKeys.indexOf('小料') >= 0, JSON.stringify(teaKeys));
  const teaBase = await sumKcal();
  check('奶茶（无糖）标准杯 = 200 kcal', Math.abs(teaBase - 200) <= 1, String(teaBase));

  /* ================= 5) 成品菜不追问做法 ================= */
  await page.keyboard.press('Escape');
  await page.waitForSelector('.cp-modal', { state: 'detached', timeout: 4000 });
  await page.evaluate((d) => window.MealDialog.open(d), today);
  await page.waitForSelector('.cp-modal', { timeout: 5000 });
  await page.fill('.cp-modal input[placeholder*="搜食物"]', '宫保鸡丁');
  await page.waitForSelector('.cp-food-item', { timeout: 5000 });
  await page.click('.cp-food-item');
  await page.waitForSelector('.cp-fp-row', { timeout: 5000 });
  const cookedHasMods = await page.evaluate(() => !!document.querySelector('.cp-fp-mods'));
  check('「宫保鸡丁」这类成品菜不再追问做法', !cookedHasMods);

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
