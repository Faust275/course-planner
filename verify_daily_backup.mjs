// 临时 e2e：每日自动快照——空数据不备份、当天只备份一次、按来源分层裁剪
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();


const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS: ' : 'FAIL: ') + name + (extra ? '  ' + extra : ''));
}

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.evaluate(() => { document.querySelectorAll('.cp-ob-mask,.ob-mask').forEach(n => n.remove()); });

// 清空所有已有备份
await page.evaluate(async () => {
  var list = await Store.listBackups();
  for (var i = 0; i < list.length; i++) await Store.deleteBackup(list[i].key);
});
const dailyCount = async () => page.evaluate(async () => (await Store.listBackups()).filter(m => m.reason === '每日自动').length);
const allCounts = async () => page.evaluate(async () => {
  var list = await Store.listBackups();
  return { daily: list.filter(m => m.reason === '每日自动').length, other: list.filter(m => m.reason !== '每日自动').length, total: list.length };
});

// 空数据：不应产生备份
await page.evaluate(() => {
  Store.state.courses = []; Store.state.tasks = []; Store.state.ledger = [];
  Store.state.notes = []; Store.state.plans = []; Store.state.events = [];
  Store.state.goals = [];
});
const c0 = (await page.evaluate(() => Store.maybeDailyBackup()), await dailyCount());
check('空数据不生成每日备份', c0 === 0, 'daily=' + c0);

// 有数据：第一次生成，第二次不重复
await page.evaluate(() => Store.addTask({ title: '每日备份测试', status: 'todo' }));
await page.evaluate(() => Store.maybeDailyBackup());
const c1 = await dailyCount();
check('跨天首次生成每日备份', c1 === 1, 'daily=' + c1);
await page.evaluate(() => Store.maybeDailyBackup());
const c2 = await dailyCount();
check('同一天不重复备份', c2 === 1, 'daily=' + c2);

// 分层裁剪：再造 3 份每日 + 3 份手动，每日应只剩 2，手动应全留
await page.evaluate(async () => {
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  for (var i = 0; i < 3; i++) { await wait(40); await Store.backupNow('每日自动'); }
  for (var j = 0; j < 3; j++) { await wait(40); await Store.backupNow('手动'); }
});
const counts = await allCounts();
check('每日自动最多保留 2 份', counts.daily === 2, JSON.stringify(counts));
check('手动备份不被每日挤掉', counts.other >= 3, JSON.stringify(counts));

if (errors.length) console.log('页面错误:', errors.slice(0, 6));
await browser.close();
close();
const allOk = results.every(r => r.ok);
console.log(allOk ? 'ALL PASS' : 'SOME FAIL');
process.exit(allOk ? 0 : 1);
