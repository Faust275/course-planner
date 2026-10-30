// e2e：今日页「昨晚睡成什么样 → 今天怎么安排」卡片（健康 → 待办反向联动）
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
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(600);

/* ---------- 1) 欠睡 + 有重活 → 出现「别硬扛」卡 ---------- */
const setup = await page.evaluate(() => {
  Store.state.sleeps.length = 0;
  Store.state.tasks.length = 0;
  Store.setHealthOn(true);

  const y = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  Store.addSleep({ date: y, start: '23:20', end: '04:20', deep: 40, rem: 40, awake: 30, efficiency: 70 });
  const t = Store.addTask({ title: '写实验报告', energy: 'high', dueDate: DateUtil.toStr(DateUtil.today()), priority: 'high' });
  Store.addTask({ title: '背单词', energy: 'low', dueDate: DateUtil.toStr(DateUtil.today()) });
  App.go('today');
  return { taskId: t.id, tomorrow: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 1)) };
});
await page.waitForTimeout(500);

const card1 = await page.evaluate(() => {
  const c = document.querySelector('.cp-body-advice');
  return c ? { text: c.innerText.replace(/\s+/g, ' ').trim(), buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null;
});
check('今日页出现身体状态卡', !!card1);
check('标题说明欠睡', card1 && /今天先别扛/.test(card1.text), card1 && card1.text.slice(0, 40));
check('列出了高耗能任务', card1 && /写实验报告/.test(card1.text), card1 && card1.text);
check('没有把轻松任务列进去', card1 && !/背单词/.test(card1.text));
check('有「→ 明天」按钮', card1 && card1.buttons.some((b) => b.indexOf('明天') >= 0), JSON.stringify(card1 && card1.buttons));

/* 精力匹配也降档了：10:00 的黄金期该被降成平稳期 */
const energy = await page.evaluate(() => Store.currentEnergyState('10:00'));
check('欠睡后黄金期降档（health → 待办联动）', energy.level === 'medium' && energy.sleepDamp === true,
  energy.level + '/' + energy.sleepDamp);

/* ---------- 2) 点「→ 明天」真的挪走 ---------- */
await page.evaluate(() => {
  const c = document.querySelector('.cp-body-advice');
  const b = [...c.querySelectorAll('button')].find((x) => x.textContent.trim().indexOf('明天') >= 0);
  b.click();
});
await page.waitForTimeout(400);
const afterMove = await page.evaluate((id) => {
  const t = Store.getTask(id);
  const c = document.querySelector('.cp-body-advice');
  return { due: t.dueDate, status: t.status, card: c ? c.innerText.replace(/\s+/g, ' ') : '' };
}, setup.taskId);
check('任务截止日被改到明天', afterMove.due === setup.tomorrow, afterMove.due);
check('任务没有被标记完成', afterMove.status !== 'done', afterMove.status);
check('卡片里不再出现这条任务', afterMove.card.indexOf('写实验报告') < 0, afterMove.card.slice(0, 60));

/* ---------- 3) 关闭今天的提示 ---------- */
const beforeDismiss = await page.evaluate(() => !!document.querySelector('.cp-body-advice'));
await page.evaluate(() => {
  const c = document.querySelector('.cp-body-advice');
  const b = [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === '×');
  b.click();
});
await page.waitForTimeout(400);
const afterDismiss = await page.evaluate(() => ({
  card: !!document.querySelector('.cp-body-advice'),
  flag: Store.settings.bodyTipDay
}));
check('点 × 后卡片消失', beforeDismiss === true && afterDismiss.card === false);
check('记下今天不再提示', afterDismiss.flag === new Date().toISOString().slice(0, 10) ||
  /^\d{4}-\d{2}-\d{2}$/.test(afterDismiss.flag), afterDismiss.flag);

await page.evaluate(() => { App.go('tasks'); App.go('today'); });
await page.waitForTimeout(400);
check('切走再回来仍不打扰', await page.evaluate(() => !document.querySelector('.cp-body-advice')));

/* ---------- 4) 睡够了 → 「状态在线」 ---------- */
await page.evaluate(() => {
  Store.state.sleeps.length = 0;
  Store.settings.bodyTipDay = '';        // 上一步关掉了今天的提示，这里复位（当天关了就不该再弹）
  const y = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  Store.addSleep({ date: y, start: '23:00', end: '07:05', deep: 110, rem: 100, awake: 8, efficiency: 94 });
  Store.addTask({ title: '啃高数真题', energy: 'high', dueDate: DateUtil.toStr(DateUtil.today()), priority: 'high' });
  App.go('tasks'); App.go('today');
});
await page.waitForTimeout(500);
const card2 = await page.evaluate(() => {
  const c = document.querySelector('.cp-body-advice');
  return c ? { text: c.innerText.replace(/\s+/g, ' '), buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null;
});
check('睡够了 → 出现「状态在线」', card2 && /状态在线/.test(card2.text), card2 && card2.text.slice(0, 40));
check('睡够了指向一个攻坚目标', card2 && /啃高数真题/.test(card2.text), card2 && card2.text.slice(0, 80));
check('睡够了给的是「去开始专注」而不是劝拖延',
  card2 && card2.buttons.some((b) => b.indexOf('专注') >= 0) && !card2.buttons.some((b) => b.indexOf('明天') >= 0),
  JSON.stringify(card2 && card2.buttons));

/* ---------- 5) 没记录 / 关掉健康 → 完全不出现 ---------- */
await page.evaluate(() => {
  Store.state.sleeps.length = 0;
  App.go('tasks'); App.go('today');
});
await page.waitForTimeout(400);
check('无睡眠记录 → 不出现（不瞎猜）', await page.evaluate(() => !document.querySelector('.cp-body-advice')));

await page.evaluate(() => {
  Store.state.sleeps.length = 0;
  const y = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  Store.addSleep({ date: y, start: '23:20', end: '04:20', deep: 40, rem: 40, awake: 30, efficiency: 70 });
  Store.setHealthOn(false);
  App.go('tasks'); App.go('today');
});
await page.waitForTimeout(400);
check('关掉健康看板 → 不出现', await page.evaluate(() => !document.querySelector('.cp-body-advice')));

/* ---------- 6) 无 JS 报错 ---------- */
check('页面无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
await close();

let bad = 0;
for (const [n, pass, extra] of ok) {
  if (!pass) bad++;
  console.log((pass ? 'PASS: ' : 'FAIL: ') + n + (extra !== undefined && !pass ? '  → ' + extra : ''));
}
console.log('\n' + (ok.length - bad) + ' 通过 / ' + bad + ' 失败');
process.exit(bad ? 1 : 0);
