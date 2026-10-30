// 临时 e2e：待办到期提醒——逾期/今日到期会提醒，明天到期与已完成的不提醒，且每条一天只提醒一次
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.Remind && window.DateUtil, null, { timeout: 8000 });

// 构造：逾期 2 天 / 今日 / 明日 / 已完成（逾期待办应被排除）
await page.evaluate(() => {
  const iso = (off) => DateUtil.toStr(new Date(Date.now() + off * 86400000));
  Store.state.tasks = [];
  Store.addTask({ title: '逾期待办', dueDate: iso(-2) });
  Store.addTask({ title: '今日待办', dueDate: iso(0) });
  Store.addTask({ title: '明日待办', dueDate: iso(1) });
  Store.addTask({ title: '已完成逾期待办', dueDate: iso(-3) });
  Store.state.tasks.forEach((t) => { if (t.title === '已完成逾期待办') t.status = 'done'; });
  Store.state.settings.remind = { on: true, lead: 15, sound: false, taskDue: true, exams: true, events: true };
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.getElementById('toastRoot').innerHTML = '';
  Remind.check();
});

const first = await page.evaluate(() => document.getElementById('toastRoot').innerText);
console.log('第一次 check 的提示:\n' + first);

const hasOverdue = first.includes('待办已逾期') && first.includes('逾期待办');
const hasToday = first.includes('今日到期') && first.includes('今日待办');
const noTomorrow = !first.includes('明日待办');
const noDone = !first.includes('已完成逾期待办');

console.log(hasOverdue ? 'PASS: 逾期待办有提醒' : 'FAIL: 逾期未提醒');
console.log(hasToday ? 'PASS: 今日待办有提醒' : 'FAIL: 今日到期未提醒');
console.log(noTomorrow ? 'PASS: 明天到期的不打扰' : 'FAIL: 误提醒了明天到期的');
console.log(noDone ? 'PASS: 已完成的不提醒' : 'FAIL: 误提醒了已完成的');

// 再 check 一次：同一天不应重复弹
await page.evaluate(() => {
  document.getElementById('toastRoot').innerHTML = '';
  Remind.check();
});
const second = await page.evaluate(() => document.getElementById('toastRoot').innerText.trim());
const oncePerDay = second === '';
console.log(oncePerDay ? 'PASS: 同一天不重复提醒' : 'FAIL: 重复提醒了 -> ' + second);

// 关掉开关后应完全静默
await page.evaluate(() => {
  Store.state.settings.remind.taskDue = false;
  document.getElementById('toastRoot').innerHTML = '';
  Remind.check();
});
const afterOff = await page.evaluate(() => document.getElementById('toastRoot').innerText.trim());
const silentWhenOff = afterOff === '';
console.log(silentWhenOff ? 'PASS: 关闭后静默' : 'FAIL: 关闭后仍在提醒');

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();

const ok = hasOverdue && hasToday && noTomorrow && noDone && oncePerDay && silentWhenOff;
console.log(ok ? '\nALL PASS' : '\nHAS FAILURE');
process.exit(ok ? 0 : 1);
