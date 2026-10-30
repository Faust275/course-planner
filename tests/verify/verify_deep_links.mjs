// e2e：深度关联 —— 就寝提醒设置 + 健康进统计页
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.waitForTimeout(500);

/* 跳过新手教程 */
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const m = [...document.querySelectorAll('.cp-modal')].pop();
  if (!m) return;
  const b = [...m.querySelectorAll('button')].find((x) => /先不用|不用|知道了|开始/.test(x.textContent.trim()));
  if (b) b.click();
});
await page.waitForTimeout(400);

/* ---------- 1) 就寝提醒设置卡 ---------- */
const clickByText = async (label) => {
  const hit = await page.evaluate((lab) => {
    const all = [...document.querySelectorAll('*')].filter((e) => e.textContent.trim() === lab);
    const el = all[all.length - 1];
    if (!el) return false;
    el.click();
    return true;
  }, label);
  await page.waitForTimeout(450);
  return hit;
};

await page.evaluate(() => App.go('settings'));
await page.waitForTimeout(450);
const openedCat = await clickByText('记录与统计');   // 设置是两级菜单
const openedRemind = await clickByText('上课与待办提醒');
check('设置两级菜单能进到「上课与待办提醒」', openedCat && openedRemind, openedCat + '/' + openedRemind);
const remindText = openedRemind ? await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.cp-card, .card')];
  const c = cards.find((x) => /就寝提醒/.test(x.textContent));
  return c ? c.innerText.replace(/\s+/g, ' ').trim() : null;
}) : null;
check('设置里有「就寝提醒」卡片', !!remindText, remindText && remindText.slice(0, 50));
check('就寝提醒默认关闭', /开启就寝提醒/.test(remindText || ''), remindText && remindText.slice(0, 40));
check('显示今晚建议时刻', /今晚建议 \d\d:\d\d/.test(remindText || ''), (remindText || '').match(/今晚建议[^（]*/)?.[0]);
check('提示当前是关闭状态', /提醒目前是关闭的/.test(remindText || ''), '');

/* 打开开关 → 文案不再提示"关闭" */
await page.evaluate(() => {
  if (!Store.state.settings.remind) Remind.opts();
  Store.state.settings.remind.bedtime = true;
  Store.save();
  App.views.filter((v) => v.id === 'settings')[0].render();
});
await page.waitForTimeout(400);
const afterOn = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-card, .card')].find((x) => /就寝提醒/.test(x.textContent));
  return c ? c.innerText.replace(/\s+/g, ' ') : '';
});
check('打开后不再提示「关闭」', !/提醒目前是关闭的/.test(afterOn), afterOn.slice(0, 60));
check('打开后给出建议时刻', /今晚建议 \d\d:\d\d/.test(afterOn), (afterOn.match(/今晚建议[^（]*/) || [])[0]);

/* ---------- 2) 造健康数据 + 健康进统计 ---------- */
await page.evaluate(() => {
  const D = window.DateUtil;
  const day = (n) => D.toStr(D.addDays(D.today(), -n));
  Store.state.sleeps = [];
  Store.state.metrics = [];
  Store.state.weightLog = [];
  for (let i = 1; i <= 5; i++) {
    Store.state.sleeps.push({ id: 'sg' + i, date: day(i + 1), start: '23:00', end: '07:00' });
    Store.state.metrics.push({ id: 'mt' + i, date: day(i), steps: 9000, calories: 320, distance: 6 });
  }
  Store.settings.stepGoal = 8000;
  Store.logWeight(day(4), 70);
  Store.logWeight(day(1), 69);
  Store.setHealthOn(true);
  Store.save();
});
await page.waitForTimeout(200);

await page.evaluate(() => App.go('tasks', { tab: 'stats' }));
await page.waitForTimeout(700);

const healthCard = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-card, .card')].find((x) => /睡眠与活动/.test(x.textContent));
  return c ? c.innerText.replace(/\s+/g, ' ').trim() : null;
});
check('统计页出现「睡眠与活动」卡', !!healthCard, healthCard && healthCard.slice(0, 80));
check('平均睡眠 8h', /8h/.test(healthCard || ''), (healthCard || '').match(/平均睡眠 ?\S+/)?.[0]);
check('睡眠达标夜 5/5', /5\/5/.test(healthCard || ''), (healthCard || '').match(/\d+\/\d+/)?.[0]);
check('日均步数 9,000', /9,000/.test(healthCard || ''), (healthCard || '').match(/9[,.]?000/)?.[0]);
check('体重变化 -1kg', /-1kg/.test(healthCard || ''), (healthCard || '').match(/[+-]?\d+(\.\d+)?kg/)?.[0]);

/* 关掉 widget → 卡片消失 */
await page.evaluate(() => {
  Store.updateSettings({ statsWidgets: Object.assign({}, Store.settings.statsWidgets, { health: false }) });
  App.go('tasks', { tab: 'stats' });
});
await page.waitForTimeout(600);
const noWidget = await page.evaluate(() =>
  ![...document.querySelectorAll('.cp-card, .card')].some((x) => /睡眠与活动/.test(x.textContent)));
check('关掉「睡眠与活动」开关后不显示', noWidget === true);

/* 关掉健康看板 → 即使 widget 打开也不显示 */
await page.evaluate(() => {
  Store.setHealthOn(false);
  Store.updateSettings({ statsWidgets: Object.assign({}, Store.settings.statsWidgets, { health: true }) });
  App.go('tasks', { tab: 'stats' });
});
await page.waitForTimeout(600);
const noHealth = await page.evaluate(() =>
  ![...document.querySelectorAll('.cp-card, .card')].some((x) => /睡眠与活动/.test(x.textContent)));
check('健康看板关闭时统计页也不显示该卡', noHealth === true);

/* ---------- 3) 无数据时的占位 ---------- */
await page.evaluate(() => {
  Store.state.sleeps = [];
  Store.state.metrics = [];
  Store.state.weightLog = [];
  Store.setHealthOn(true);
  Store.save();
  App.go('tasks', { tab: 'stats' });
});
await page.waitForTimeout(600);
const emptyText = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-card, .card')].find((x) => /睡眠与活动/.test(x.textContent));
  return c ? c.innerText.replace(/\s+/g, ' ') : null;
});
check('无健康数据时给占位说明', /还没有睡眠/.test(emptyText || ''), emptyText && emptyText.slice(0, 60));

/* ---------- 4) 健康页「睡眠 × 心情」 ---------- */
await page.evaluate(() => {
  const D = window.DateUtil;
  const day = (n) => D.toStr(D.addDays(D.today(), -n));
  Store.state.sleeps = [];
  Store.state.diaries = [];
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) {
      Store.state.sleeps.push({ id: 'g' + i, date: day(i + 1), start: '23:00', end: '07:00' });
      Store.state.diaries.push({ id: 'd' + i, date: day(i), mood: i % 4 === 0 ? 'great' : 'good', content: '' });
    } else {
      Store.state.sleeps.push({ id: 'b' + i, date: day(i), start: '03:00', end: '05:30', efficiency: 55, deep: 10, rem: 10 });
      Store.state.diaries.push({ id: 'd' + i, date: day(i), mood: i % 4 === 1 ? 'low' : 'tired', content: '' });
    }
  }
  Store.setHealthOn(true);
  Store.save();
  App.go('health');
});
await page.waitForTimeout(700);

const moodCard = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-card, .card')].find((x) => /睡眠 × 心情/.test(x.textContent));
  return c ? c.innerText.replace(/\s+/g, ' ').trim() : null;
});
check('健康页出现「睡眠 × 心情」卡', !!moodCard, moodCard && moodCard.slice(0, 60));
check('给出相关系数与样本量', /相关系数/.test(moodCard || '') && /样本 10 天/.test(moodCard || ''),
  (moodCard || '').match(/样本 \d+ 天/)?.[0]);
check('睡好/睡差当天心情都算出来了', /睡好\(≥70%\)当天心情/.test(moodCard || '') && /睡差\(<50%\)当天心情/.test(moodCard || ''));
check('心情好/差的前一夜时长都算出来了', /心情好\(≥4\) 前一夜/.test(moodCard || '') && /心情差\(≤2\) 前一夜/.test(moodCard || ''));

/* ---------- 报告 ---------- */
console.log('\n===== 深度关联 e2e =====');
let fail = 0;
for (const [name, pass, extra] of ok) {
  console.log((pass ? '✓ ' : '✗ ') + name + (pass ? '' : '  → ' + (extra == null ? '' : extra)));
  if (!pass) fail++;
}
const pageErrs = errors.filter((e) => !/favicon|ResizeObserver/i.test(e));
if (pageErrs.length) {
  console.log('\n页面错误：');
  pageErrs.slice(0, 6).forEach((e) => console.log('  ' + e.split('\n')[0]));
}
console.log('\n' + (fail === 0 && !pageErrs.length ? 'ALL PASS' : fail + ' FAILED / ' + pageErrs.length + ' 页面错误'));

await browser.close();
await close();
process.exit(fail === 0 && pageErrs.length === 0 ? 0 : 1);
