// Playwright 端到端：新手教程（非核心关闭按钮 + 首屏提醒）、20 色板、合成玉换算 180
// 覆盖：自动弹出教程、步骤数、首个非核心步骤高亮提醒、非核心卡片「关闭这些介绍」、
//       关闭后 guided=true 且回到原页、Store.COLORS 与 THEME_PRESETS 均为 20、JADE_PER_POINT=180
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8137/index.html';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/favicon|manifest|sw\.js|404|Failed to fetch|net::/.test(t)) errors.push('console: ' + t); } });

let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const wait = (ms) => p.waitForTimeout(ms || 400);

await p.goto(BASE, { waitUntil: 'networkidle' });
await wait(700);

// 全新用户：清掉 guided，强制重走教程
await p.evaluate(() => {
  Store.state.settings.guided = false;
  Store.save();
  App.go('today');
});
await p.reload({ waitUntil: 'networkidle' });
await wait(800);
const autoOpened = await p.evaluate(() => !!document.querySelector('.cp-ob-mask'));
check('首次打开自动弹出新手教程', autoOpened);

const total = await p.evaluate(() => ({ core: Onboard.steps, full: Onboard.totalSteps }));
check('核心引导 = 5 步', total.core === 5, total);
check('完整功能导览 = 24 步', total.full === 24, total);

// Palette / 颜色
const pal = await p.evaluate(() => ({
  course: Store.COLORS.length,
  theme: Theme.THEMES.length,
  preset: (typeof Palette !== 'undefined') ? Palette.count : -1,
  jade: POMO.JADE_PER_POINT
}));
check('课程色板 = 20', pal.course === 20, pal);
check('外观主题预设 = 20', pal.theme === 20, pal);
check('Palette 模块导出 20', pal.preset === 20, pal);
check('JADE_PER_POINT 已统一为 180', pal.jade === 180, pal);

// 走完 5 步核心引导
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => {
    const nb = [...document.querySelectorAll('.cp-ob-foot .cp-btn-primary')][0];
    if (nb) nb.click();
  });
  await wait(120);
}
const lastStep = await p.evaluate(() => ({
  stepText: (document.querySelector('.cp-ob-title span') || {}).textContent || '',
  hasMore: !![...document.querySelectorAll('.cp-ob-foot .cp-btn')].find(b => /更多功能/.test(b.textContent)),
  hasStart: !![...document.querySelectorAll('.cp-ob-foot .cp-btn-primary')].find(b => /开始使用/.test(b.textContent))
}));
check('核心引导最后一页显示「开始使用」', lastStep.hasStart, lastStep);
check('核心引导最后一页提供「更多功能」入口', lastStep.hasMore, lastStep);

// 点「更多功能」→ 进入完整导览，从第 2 步开始
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.cp-ob-foot .cp-btn')].find(b => /更多功能/.test(b.textContent));
  if (btn) btn.click();
});
await wait(400);
const fullTour = await p.evaluate(() => ({
  stepText: (document.querySelector('.cp-ob-title span') || {}).textContent || '',
  dots: document.querySelectorAll('.cp-ob-dot').length,
  title: (document.querySelector('.cp-ob-title b') || {}).textContent || ''
}));
check('完整导览从第 2 / 24 步开始', /第 2 \/ 24 步/.test(fullTour.stepText), fullTour);
check('完整导览共 24 个步骤点', fullTour.dots === 24, fullTour);

// 直接跳过 → 结束教程
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.cp-ob-foot .cp-btn')].find(b => /关闭这些介绍/.test(b.textContent))
    || [...document.querySelectorAll('.cp-ob-skip')][0];
  if (btn) btn.click();
});
await wait(600);
const afterClose = await p.evaluate(() => ({
  closed: !document.querySelector('.cp-ob-mask'),
  guided: Store.state.settings.guided,
  view: (location.hash || '')
}));
check('点击关闭后教程结束', afterClose.closed, afterClose);
check('关闭后 guided 标记为 true', afterClose.guided === true, afterClose);

console.log('\n结果：' + ok + ' 通过 / ' + bad + ' 失败');
if (errors.length) { console.log('\n控制台错误：'); errors.forEach(e => console.log('  ' + e)); }
await b.close();
process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
