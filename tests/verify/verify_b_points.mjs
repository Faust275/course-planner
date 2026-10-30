import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8201/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });  // 窄屏
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const out = {};
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const skip = await page.$('text=跳过');
if (skip) { await skip.click(); await page.waitForTimeout(300); }

// 0) 发分 + 流水
await page.evaluate(() => { Store.addPoints(10, 'focus'); Store.addPoints(5, 'sleep'); Store.addPoints(2, 'meal'); });
out.pointSourcesRemoved = await page.evaluate(() => typeof Store.pointSources === 'undefined');
out.seriesHas = await page.evaluate(() => Store.pointSeries('week').length > 0);
out.totalPoints = await page.evaluate(() => Store.totalPoints());

// 1) 任务页 → 统计分页
await page.evaluate(() => App.go('tasks', { tab: 'stats' }));
await page.waitForTimeout(400);
out.hasCurve = await page.evaluate(() => document.body.innerText.includes('积分曲线'));
out.hasSources = await page.evaluate(() => document.body.innerText.includes('积分来源'));
out.hasTimeStat = await page.evaluate(() => document.body.innerText.includes('时间去向'));

// 2) 今日卡片总量
await page.evaluate(() => App.go('today'));
await page.waitForTimeout(400);
const todayText = await page.evaluate(() => {
  const v = document.getElementById('view-today');
  return v ? v.innerText : document.body.innerText;
});
out.todayWeekGain = todayText.includes('本周获得积分');
out.todayTotal = todayText.includes('累计总量');

// 3) 设置 → 时间统计 子页
await page.evaluate(() => App.go('settings', { tab: 'stats' }));
await page.waitForTimeout(400);
out.settingsHasToggles = await page.evaluate(() =>
  document.body.innerText.includes('统计分页显示哪些') &&
  document.body.innerText.includes('积分曲线') &&
  document.body.innerText.includes('积分来源'));

// 4) 门控：关掉积分曲线 + 积分来源，统计分页应不显示
await page.evaluate(() => Store.updateSettings({ statsWidgets: { time: true, curve: false, sources: false } }));
await page.evaluate(() => App.go('tasks', { tab: 'stats' }));
await page.waitForTimeout(400);
out.curveHidden = await page.evaluate(() => !document.body.innerText.includes('积分曲线'));
out.sourcesHidden = await page.evaluate(() => !document.body.innerText.includes('积分来源'));
out.timeStillThere = await page.evaluate(() => document.body.innerText.includes('时间去向'));
// 恢复
await page.evaluate(() => Store.updateSettings({ statsWidgets: { time: true, curve: true, sources: true } }));

// 5) 窄屏无横向溢出
out.noHOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

out.errorCount = errors.length;
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 2));
await browser.close();
