// 临时 e2e：复盘「计划 vs 实际偏差」——按差距排序、差值与达成率正确、空态不炸
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });

// 两个计划：A 打卡型 计划10/实际4（差 -6），B 累加型 目标100/实际120（超 +20）
await page.evaluate(() => {
  Store.state.plans = [];
  Store.addPlan({ title: '打卡计划A', type: 'checkin', period: 'daily', days: 10 });
  Store.addPlan({ title: '累加计划B', type: 'duration', period: 'once', target: 100, unit: '分钟' });
  const a = Store.state.plans.find((p) => p.title === '打卡计划A');
  const b = Store.state.plans.find((p) => p.title === '累加计划B');
  for (let i = 1; i <= 4; i++) {
    a.records.push({ date: '2026-0' + i + '-01', value: 1, note: '', at: new Date().toISOString() });
  }
  b.records.push({ date: '2026-01-01', value: 120, note: '', at: new Date().toISOString() });
  Store.emit();
});

// 统计/复盘是「待办」视图下的一个分页，不是独立顶层视图
await page.evaluate(() => App.go('tasks', { tab: 'stats' }));
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.cp-card'))
    .find((c) => (c.textContent || '').includes('计划 vs 实际'));
  return card ? card.innerText : null;
});
console.log('卡片内容:\n' + info);

const hasCard = !!info;
const hasA = !!info && info.includes('计划 10 · 实际 4') && info.includes('-6');
const hasB = !!info && info.includes('计划 100 · 实际 120') && info.includes('+20');
const sumOk = !!info && info.includes('合计 计划 110 / 实际 124（+14');
// 差距最大的排前面：A 差 6、B 差 20 → B 在前
const sorted = !!info && info.indexOf('累加计划B') < info.indexOf('打卡计划A');

console.log(hasCard ? 'PASS: 卡片渲染' : 'FAIL: 没有「计划 vs 实际」卡片');
console.log(hasA ? 'PASS: 打卡计划差值 -6 正确' : 'FAIL: 打卡计划差值不对');
console.log(hasB ? 'PASS: 累加计划超出 +20 正确' : 'FAIL: 累加计划差值不对');
console.log(sumOk ? 'PASS: 合计行正确' : 'FAIL: 合计行不对');
console.log(sorted ? 'PASS: 按差距从大到小排序' : 'FAIL: 排序不对');

// 空态：清掉计划后不应报错，且有提示文案
await page.evaluate(() => { Store.state.plans = []; Store.emit(); App.go('tasks', { tab: 'stats' }); });
await page.waitForTimeout(300);
const empty = await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.cp-card'))
    .find((c) => (c.textContent || '').includes('计划 vs 实际'));
  return card ? card.innerText : null;
});
const emptyOk = !!empty && empty.includes('还没有带目标的计划');
console.log(emptyOk ? 'PASS: 空态有提示且未崩' : 'FAIL: 空态异常 -> ' + empty);

if (errors.length) console.log('页面错误:', errors.slice(0, 5));
await browser.close();
close();

const ok = hasCard && hasA && hasB && sumOk && sorted && emptyOk;
console.log(ok ? '\nALL PASS' : '\nHAS FAILURE');
process.exit(ok ? 0 : 1);
