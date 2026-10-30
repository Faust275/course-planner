// e2e：计划页「昨晚睡成什么样 → 今天该推哪个 / 该缓哪个」
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(600);

/* ---------- 1) 欠睡 + 有「吃力」计划 → 出现建议卡 ---------- */
const setup = await page.evaluate(() => {
  Store.state.plans.length = 0;
  Store.state.sleeps.length = 0;
  Store.setHealthOn(true);
  const y = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  const today = DateUtil.toStr(DateUtil.today());
  Store.addSleep({ date: y, start: '23:20', end: '04:20', deep: 40, rem: 40, awake: 30, efficiency: 70 });

  const a = Store.addPlan({ title: '跑步 5 公里', type: 'checkin', period: 'daily', days: 21, startDate: today, load: 'high' });
  const b = Store.addPlan({ title: '早起背单词', type: 'checkin', period: 'daily', days: 21, startDate: today, load: 'high' });
  const c = Store.addPlan({ title: '散步 20 分钟', type: 'checkin', period: 'daily', days: 21, startDate: today, load: 'low' });
  App.go('plans');
  return { a: a.id, b: b.id, c: c.id, today: today, pending: Store.planStats().todayPending };
});
await page.waitForTimeout(500);

const card1 = await page.evaluate(() => {
  const c = document.querySelector('.cp-plan-advice');
  return c ? {
    text: c.innerText.replace(/\s+/g, ' ').trim(),
    buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim())
  } : null;
});
check('计划页出现状态建议卡', !!card1);
check('标题说明「今天先缓一缓」', card1 && /今天先缓一缓/.test(card1.text), card1 && card1.text.slice(0, 46));
check('列出两个吃力的计划', card1 && /跑步 5 公里/.test(card1.text) && /早起背单词/.test(card1.text));
check('没把轻松的计划列进「缓一缓」', card1 && !/散步 20 分钟/.test(card1.text.split('今天做')[0]));
check('提示里指向轻松的那个', card1 && /散步 20 分钟/.test(card1.text));
check('有「今天缓一缓」按钮', card1 && card1.buttons.filter((b) => b === '今天缓一缓').length === 2,
  JSON.stringify(card1 && card1.buttons));
check('有两个以上时给「全部缓一缓」', card1 && card1.buttons.some((b) => /全部缓一缓/.test(b)));

/* 卡片上的「吃力 · 今天缓」标记 */
const chip = await page.evaluate(() => {
  const card = document.querySelector('.cp-plan-card[data-id="' + Store.state.plans.find((p) => p.title === '跑步 5 公里').id + '"]');
  return card ? card.innerText.replace(/\s+/g, ' ') : '';
});
check('吃力计划的角标变成「今天缓」', /吃力 · 今天缓/.test(chip), chip.slice(0, 60));

/* ---------- 2) 点「今天缓一缓」→ 记下豁免、格子变斜纹 ---------- */
await page.evaluate((id) => {
  const row = document.querySelector('.cp-plan-advice [data-id="' + id + '"]');
  row.querySelector('button').click();
}, setup.a);
await page.waitForTimeout(500);

const exempted = await page.evaluate((id) => {
  const p = Store.getPlan(id);
  const card = document.querySelector('.cp-plan-card[data-id="' + id + '"]');
  return {
    on: Store.planExemptedOn(p),
    streak: Store.planStreak(p),
    cell: !!card.querySelector('.cp-plan-cell.cp-exempt'),
    btn: card.innerText.replace(/\s+/g, ' '),
    pending: Store.planStats().todayPending,
    cardLeft: (document.querySelector('.cp-plan-advice') || {}).innerText || ''
  };
}, setup.a);

check('豁免被记在计划上', exempted.on === true);
check('打卡格子里出现豁免格', exempted.cell === true);
check('卡片按钮变成「今天已缓 · 仍要打卡」', /今天已缓 · 仍要打卡/.test(exempted.btn), exempted.btn.slice(0, 80));
check('今日待打卡少了一个', exempted.pending === setup.pending - 1, exempted.pending);
check('建议卡里不再列这一条', exempted.cardLeft.indexOf('跑步 5 公里') < 0, exempted.cardLeft.slice(0, 50));

/* ---------- 3) 「仍要打卡」能反悔回来 ---------- */
await page.evaluate((id) => {
  const card = document.querySelector('.cp-plan-card[data-id="' + id + '"]');
  [...card.querySelectorAll('button')].find((b) => /仍要打卡/.test(b.textContent)).click();
}, setup.a);
await page.waitForTimeout(400);
const restored = await page.evaluate((id) => ({
  on: Store.planExemptedOn(Store.getPlan(id)),
  text: document.querySelector('.cp-plan-card[data-id="' + id + '"]').innerText.replace(/\s+/g, ' ')
}), setup.a);
check('反悔后豁免被撤销', restored.on === false);
check('按钮回到「今日打卡」', /今日打卡/.test(restored.text));

/* ---------- 4) 「全部缓一缓」→ 吃力的全缓、卡片自动收起 ---------- */
const allBtn = await page.evaluate(() => {
  const c = document.querySelector('.cp-plan-advice');
  if (!c) return null;
  const btn = [...c.querySelectorAll('button')].find((b) => /全部缓一缓/.test(b.textContent));
  if (!btn) return null;
  btn.click();
  return true;
});
await page.waitForTimeout(500);
const allDone = await page.evaluate((ids) => ({
  a: Store.planExemptedOn(Store.getPlan(ids.a)),
  b: Store.planExemptedOn(Store.getPlan(ids.b)),
  c: Store.planExemptedOn(Store.getPlan(ids.c)),
  card: !!document.querySelector('.cp-plan-advice')
}), setup);
check('两个吃力计划都缓了', allBtn === true && allDone.a === true && allDone.b === true,
  JSON.stringify(allDone));
check('轻松的计划没被连带缓掉', allDone.c === false);
check('没有要缓的了，卡片自动收起', allDone.card === false);

/* ---------- 5) 睡够了 → 换成「今天适合推」 ---------- */
const push = await page.evaluate((ids) => {
  Store.state.plans.forEach((p) => { p.exemptDays = []; });
  Store.state.sleeps.length = 0;
  const y = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  Store.addSleep({ date: y, start: '23:00', end: '07:05', deep: 110, rem: 100, awake: 8, efficiency: 94 });
  App.go('plans');
  const c = document.querySelector('.cp-plan-advice');
  return c ? { text: c.innerText.replace(/\s+/g, ' '), buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null;
}, setup);
check('睡够后换成「今天适合推」', push && /今天适合推/.test(push.text), push && push.text.slice(0, 40));
check('给了「去打卡」按钮', push && push.buttons.some((b) => b === '去打卡'), JSON.stringify(push && push.buttons));

await page.evaluate(() => {
  const c = document.querySelector('.cp-plan-advice');
  [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === '去打卡').click();
});
await page.waitForTimeout(500);
const checked = await page.evaluate(() => ({
  done: Store.state.plans.filter((p) => Store.planDoneToday(p)).length,
  recs: Store.state.plans.reduce((n, p) => n + p.records.length, 0),
  exempt: Store.state.plans.filter((p) => Store.planExemptedOn(p)).length
}));
check('点「去打卡」真的记了一笔', checked.done === 1, checked.done);
check('打卡记录只落在被点的那一个计划上', checked.recs === 1, checked.recs);
check('打卡不会顺带清掉别的计划的豁免状态', checked.exempt === 0, checked.exempt);

/* ---------- 6) 一个档位都没标 → 只给一句「怎么用」 ---------- */
const untagged = await page.evaluate(() => {
  Store.state.plans.forEach((p) => { p.load = ''; });
  App.go('plans');
  const c = document.querySelector('.cp-plan-advice');
  return { has: !!c, body: document.body.innerText.replace(/\s+/g, ' ') };
});
check('没标档位时不出建议卡', untagged.has === false);
check('改成一句怎么用的提示', /耗能档位/.test(untagged.body), untagged.body.slice(0, 80));

/* ---------- 7) 今日页也认这个豁免，不再催 ---------- */
const todayView = await page.evaluate((ids) => {
  Store.setHealthOn(true);
  Store.state.plans.forEach((p) => { p.exemptDays = []; });
  Store.togglePlanExempt(ids.c, DateUtil.toStr(DateUtil.today()));
  App.go('today');
  return { body: document.body.innerText.replace(/\s+/g, ' ') };
}, setup);
check('今日页把缓过的计划标成「不算断签」', /今天缓一缓 · 不算断签/.test(todayView.body),
  todayView.body.slice(0, 80));

/* ---------- 8) 健康看板关着 → 全静默 ---------- */
const off = await page.evaluate(() => {
  Store.setHealthOn(false);
  App.go('plans');
  return {
    card: !!document.querySelector('.cp-plan-advice'),
    body: document.body.innerText.replace(/\s+/g, ' ')
  };
});
check('健康关着时不出现任何身体提示', off.card === false && !/耗能档位/.test(off.body));

/* ---------- 结果 ---------- */
if (errors.length) { console.log('\n页面报错：\n' + errors.slice(0, 4).join('\n')); }
ok.forEach(([n, pass, extra]) => console.log((pass ? 'PASS: ' : 'FAIL: ') + n + (extra !== undefined ? '  → ' + extra : '')));
const fail = ok.filter((x) => !x[1]).length;
console.log('\n' + (ok.length - fail) + ' 通过 / ' + fail + ' 失败');
await browser.close();
await close();
process.exit(fail || errors.length ? 1 : 0);
