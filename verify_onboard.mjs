// Playwright 端到端：新手教程（非核心关闭按钮 + 首屏提醒）、20 色板、合成玉换算 600
// 覆盖：自动弹出教程、步骤数、首个非核心步骤高亮提醒、非核心卡片「关闭这些介绍」、
//       关闭后 guided=true 且回到原页、Store.COLORS 与 THEME_PRESETS 均为 20、JADE_PER_POINT=600
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

const total = await p.evaluate(() => Onboard.steps);
check('步骤数 = 24（16 核心 + 8 非核心 + 收尾）', total === 24, total);

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
check('JADE_PER_POINT 已勘误为 600', pal.jade === 600, pal);

// 找到第一个非核心步骤（切到它）
const firstNonCoreIdx = await p.evaluate(() => {
  // 非核心步骤里带「关闭这些介绍」按钮；逐个前进直到出现
  function next() {
    const btn = document.querySelector('.cp-ob-close-hint');
    return !!btn;
  }
  // 从 0 前进，找带 close-hint 的步骤
  let guard = 0;
  while (!next() && guard < 40) {
    const nb = [...document.querySelectorAll('.cp-ob-foot .cp-btn-primary')][0];
    if (nb) nb.click();
    guard++;
  }
  return guard;
});
await wait(500);
const onNonCore = await p.evaluate(() => {
  const hasClose = !!document.querySelector('.cp-ob-close-hint');
  const hasBtn = !!([...document.querySelectorAll('.cp-ob-foot .cp-btn')].find(b => /关闭这些介绍/.test(b.textContent)));
  const hasNotice = !!document.querySelector('.cp-ob-notice');
  const title = document.querySelector('.cp-ob-title b') ? document.querySelector('.cp-ob-title b').textContent : '';
  return { hasClose, hasBtn, hasNotice, title };
});
check('非核心功能卡片显示「关闭这些介绍」按钮', onNonCore.hasBtn, onNonCore);
check('非核心卡片下方有「关闭后可在设置再看」提示', onNonCore.hasClose, onNonCore);
check('第一个非核心步骤高亮提醒「之后在设置也能打开」', onNonCore.hasNotice, onNonCore);

// 点「关闭这些介绍」→ 结束教程
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.cp-ob-foot .cp-btn')].find(b => /关闭这些介绍/.test(b.textContent));
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
