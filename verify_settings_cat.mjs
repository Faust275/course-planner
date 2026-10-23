// 临时验证：设置三级结构 + 移除汉堡
import { chromium } from 'playwright';

const BASE = 'http://localhost:8137/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 980 } });
const errors = [];
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
async function fresh(hash) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.goto(BASE + (hash || ''), { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
  await p.waitForTimeout(400);
  return p;
}

const p = await fresh('#/settings');
const snap = () => p.evaluate(() => ({
  hash: location.hash,
  cats: [...document.querySelectorAll('.cp-set-cat')].map(n => n.textContent.replace(/\s+/g, ' ').trim()),
  items: [...document.querySelectorAll('.cp-set-item')].map(n => n.textContent.replace(/\s+/g, ' ').trim()),
  head: (document.querySelector('.cp-set-head-title b') || {}).textContent || '',
  back: (document.querySelector('.cp-set-head .cp-btn') || {}).textContent || '',
  title: (document.querySelector('#viewTitle') || {}).textContent || ''
}));

let s = await snap();
check('首页有 6 个分类卡', s.cats.length === 6, s.cats);
check('首页不直接列出具体条目', s.items.length === 0, s.items);
check('分类卡带项数', s.cats.every(x => /\d+ 项/.test(x)), s.cats);

// 点基础设置
await p.locator('.cp-set-cat', { hasText: '基础设置' }).click();
await p.waitForTimeout(250);
s = await snap();
check('基础设置分类页 5 项', s.items.length === 5, s.items);
check('分类页地址 #/settings/basic', s.hash === '#/settings/basic', s.hash);
check('分类页标题', s.head === '基础设置', s.head);

// 点外观
await p.locator('.cp-set-item', { hasText: '主题配色' }).click();
await p.waitForTimeout(250);
s = await snap();
check('外观具体页标题', s.head === '外观', s.head);
check('返回按钮写分类名', s.back.indexOf('基础设置') >= 0, s.back);
check('具体页地址 #/settings/look', s.hash === '#/settings/look', s.hash);

// 返回分类
await p.locator('.cp-set-head .cp-btn').click();
await p.waitForTimeout(250);
s = await snap();
check('返回到分类页', s.head === '基础设置' && s.items.length === 5, { head: s.head, n: s.items.length });
check('返回后地址 #/settings/basic', s.hash === '#/settings/basic', s.hash);

// 返回首页
await p.locator('.cp-set-head .cp-btn').click();
await p.waitForTimeout(250);
s = await snap();
check('返回到首页', s.cats.length === 6, s.cats.length);
check('首页地址 #/settings', s.hash === '#/settings', s.hash);

// 遍历 24 项：每个分类都能进入每一项
const groups = [
  ['基础设置', 5], ['首页与模块', 4], ['记录与统计', 6],
  ['奖励与目标', 4], ['识别与数据', 3], ['帮助', 2]
];
let allNames = [];
for (const [name, n] of groups) {
  await p.locator('.cp-set-cat', { hasText: name }).click();
  await p.waitForTimeout(200);
  const items = await p.evaluate(() => [...document.querySelectorAll('.cp-set-item .cp-set-text b')].map(n => n.textContent));
  check(name + ' 有 ' + n + ' 项', items.length === n, items);
  allNames = allNames.concat(items);
  // 逐项点进再返回（帮助里的新手教程会弹引导，单独处理）
  for (let i = 0; i < items.length; i++) {
    const label = items[i];
    if (label === '新手教程') continue;
    const loc = p.locator('.cp-set-item').nth(i);
    await loc.click();
    await p.waitForTimeout(160);
    const head = await p.evaluate(() => (document.querySelector('.cp-set-head-title b') || {}).textContent || '');
    check('  ' + label + ' 能打开', head === label, head);
    await p.locator('.cp-set-head .cp-btn').click();
    await p.waitForTimeout(160);
  }
  const hs = await p.evaluate(() => (document.querySelector('.cp-set-head-title b') || {}).textContent || '');
  check(name + ' 返回后仍在分类页', hs === name, hs);
  await p.locator('.cp-set-head .cp-btn').click();
  await p.waitForTimeout(160);
}
check('合计 24 项无遗漏', allNames.length === 24, allNames);

// 深链
const p2 = await fresh('#/settings/look');
const s2 = await p2.evaluate(() => ({
  head: (document.querySelector('.cp-set-head-title b') || {}).textContent || '',
  back: (document.querySelector('.cp-set-head .cp-btn') || {}).textContent || ''
}));
check('深链 #/settings/look 直达具体页', s2.head === '外观', s2.head);
check('深链进入的返回按钮指向基础设置', s2.back.indexOf('基础设置') >= 0, s2.back);

const p3 = await fresh('#/settings/record');
const s3 = await p3.evaluate(() => ({
  head: (document.querySelector('.cp-set-head-title b') || {}).textContent || '',
  n: document.querySelectorAll('.cp-set-item').length
}));
check('深链 #/settings/record 进分类页', s3.head === '记录与统计' && s3.n === 6, s3);

// 汉堡已移除
const ham = await p.evaluate(() => !!document.querySelector('#btnDrawer'));
check('汉堡按钮已移除', !ham);

// 窄屏：无汉堡、无横向溢出、底部 tabbar 仍在
const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
const m = await ctx2.newPage();
m.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
await m.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
await m.waitForTimeout(700);
await m.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await m.waitForTimeout(400);
const mob = await m.evaluate(() => ({
  ham: !!document.querySelector('#btnDrawer'),
  side: getComputedStyle(document.querySelector('#sidebar')).display,
  tabs: document.querySelectorAll('.cp-tabbar-item').length,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cats: document.querySelectorAll('.cp-set-cat').length,
  cols: getComputedStyle(document.querySelector('.cp-set-cats')).gridTemplateColumns
}));
check('窄屏无汉堡', !mob.ham);
check('窄屏侧边栏隐藏', mob.side === 'none', mob.side);
check('窄屏底部导航仍在', mob.tabs >= 4, mob.tabs);
check('390px 无横向溢出', mob.overflow <= 0, mob.overflow);
check('窄屏分类卡单列', mob.cats === 6 && mob.cols.split(' ').length === 1, mob);
await m.screenshot({ path: '/tmp/set-home-390.png', fullPage: true });
await p.screenshot({ path: '/tmp/set-home-1280.png', fullPage: true });
await p.locator('.cp-set-cat', { hasText: '记录与统计' }).click();
await p.waitForTimeout(250);
await p.screenshot({ path: '/tmp/set-cat-1280.png', fullPage: true });

check('无 JS 报错', errors.length === 0, errors);
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
await b.close();
process.exit(bad ? 1 : 0);
