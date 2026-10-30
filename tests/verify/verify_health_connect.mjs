// 纯逻辑单测：加载 health-connect.js（无 DOM 依赖），校验「会话 -> 睡眠记录」「每日活动量 -> 记录」映射与降级行为。
// 运行：node verify_health_connect.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../assets/js/health-connect.js', import.meta.url), 'utf8');
const g = {};
// health-connect.js 用 (function(global){...})(typeof window!=='undefined'?window:this)
// 这里用 new Function 注入一个假的 window，使其挂到 g 上
new Function('window', src)(g);
const HC = g.HealthConnect;

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error('FAIL: ' + msg + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual)); }
}

// ---- 睡眠映射 ----
const rec = HC._test.toSleepRecord({ date: '2026-10-23', start: '23:30', end: '07:10', totalMinutes: 430, awakeMinutes: 25 });
eq(rec.date, '2026-10-23', 'date 透传');
eq(rec.start, '23:30', 'start 透传');
eq(rec.end, '07:10', 'end 透传');
eq(rec.total, 430, 'totalMinutes 映射');
eq(rec.awake, 25, 'awakeMinutes 映射');
eq(rec.source, 'hc', 'source=hc');
eq(rec.deep, null, '深睡留空');
eq(rec.light, null, '浅睡留空');
eq(rec.rem, null, 'REM 留空');
eq(rec.efficiency, null, '效率留空');
eq(HC._test.toSleepRecord(null), null, 'null -> null');
eq(HC._test.toSleepRecord({}), null, '缺 date -> null');

const sessions = [
  { startTime: '2026-10-23T23:00:00Z' },
  { startTime: '2026-10-24T23:00:00Z' },
  { startTime: '2026-10-22T23:00:00Z' }
];
eq(HC._test.latest(sessions).startTime, '2026-10-24T23:00:00Z', 'latest 取最近一晚');

// ---- 活动量映射 ----
const mrec = HC._test.toMetricRecord({ date: '2026-10-23', steps: 8200, calories: 320, distance: 6100 });
eq(mrec.date, '2026-10-23', 'metric date');
eq(mrec.steps, 8200, 'metric steps');
eq(mrec.calories, 320, 'metric calories');
eq(mrec.distance, 6100, 'metric distance');
eq(mrec.source, 'hc', 'metric source=hc');
eq(HC._test.toMetricRecord(null), null, 'metric null -> null');
eq(HC._test.toMetricRecord({}), null, 'metric 缺 date -> null');
eq(HC._test.mapMetrics({ days: [{ date: '2026-10-23', steps: 5 }, null, {}] }).length, 1, 'mapMetrics 过滤无效项');

// 无 Capacitor 环境：available() 安全降级为 false，不抛错
const av = await HC.available();
eq(av, false, '无 Capacitor 时 available 降级为 false');

// ---- 选项 A：autoSync / getCached / getCachedMetrics（用假插件驱动）----
function mockPlugin(beh) {
  g.Capacitor = { Plugins: { HealthConnect: {
    isAvailable: () => Promise.resolve({ available: beh.available }),
    readSleep: beh.fail
      ? () => Promise.reject(new Error('security'))
      : () => Promise.resolve({ sessions: beh.sessions || [] }),
    readMetrics: beh.metricsFail
      ? () => Promise.reject(new Error('no-permission'))
      : () => Promise.resolve({ days: beh.days || [] })
  } } };
}
const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const todayStr = new Date().toISOString().slice(0, 10);

// 1) 已授权 + 有数据：autoSync 同时缓存睡眠与每日活动量
mockPlugin({ available: true, sessions: [
  { startTime: '2026-10-24T23:00:00Z', date: yest, start: '23:00', end: '07:00', totalMinutes: 470, awakeMinutes: 20 }
], days: [
  { date: yest, steps: 8200, calories: 320, distance: 6100 },
  { date: todayStr, steps: 1200, calories: 50, distance: 900 }
] });
const synced = await HC.autoSync();
eq(synced, true, 'autoSync 已授权且有数据 -> true');
const cached = HC.getCached();
eq(cached && cached.date, yest, 'getCached 命中刚同步的日期');
eq(cached && cached.source, 'hc', 'getCached 来源为 hc');
const mcache = HC.getCachedMetrics();
eq(Array.isArray(mcache) && mcache.length, 2, 'getCachedMetrics 命中 2 天');
eq(HC.getMetricForDate(todayStr).steps, 1200, 'getMetricForDate 命中今日步数');
HC.clearCache();
eq(HC.getCached(), null, 'clearCache 后 getCached 为 null');
eq(HC.getCachedMetrics(), null, 'clearCache 后 getCachedMetrics 为 null');

// 2) 睡眠权限失败：readSleep 抛异常被接住，autoSync 静默返回 false（不抛错、不弹窗）
mockPlugin({ available: true, fail: true });
eq(await HC.autoSync(), false, 'autoSync 未授权(读抛异常) -> false');

// 3) 睡眠成功但活动量权限缺失：readMetrics 抛异常被接住，autoSync 仍 true，活动量缓存为 null
mockPlugin({ available: true, sessions: [
  { startTime: '2026-10-24T23:00:00Z', date: yest, start: '23:00', end: '07:00', totalMinutes: 470, awakeMinutes: 20 }
], metricsFail: true });
eq(await HC.autoSync(), true, 'autoSync 睡眠成功但 metrics 失败 -> true');
eq(HC.getCachedMetrics(), null, 'metrics 失败 -> getCachedMetrics 为 null');
HC.clearCache();

// 4) 不可用：autoSync 直接 false
mockPlugin({ available: false });
eq(await HC.autoSync(), false, 'autoSync 不可用 -> false');

console.log(`\nhealth-connect: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
