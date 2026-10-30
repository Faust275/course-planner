// 机制主题皮肤：跟随奖励模式 / 手动选色覆盖 / 开关
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8137/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 980 } });
const errors = [];
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const p = await ctx.newPage();
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(650);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);
await p.evaluate(() => Store.setGachaEnabled(true));   // 本测试专验机制皮肤（含抽卡），先开启抽卡系统

const read = () => p.evaluate(() => ({
  skin: Store.state.settings.themeSkin,
  auto: Store.state.settings.themeSkinAuto,
  mech: document.documentElement.getAttribute('data-mech'),
  primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase(),
  mode: Store.state.pomodoro.mode
}));

/* ---------- 默认：开启皮肤，森林模式 → tree，绿色强调 ---------- */
const s0 = await read();
check('默认开启机制皮肤', s0.skin === true, s0);
check('森林模式 → data-mech=tree', s0.mech === 'tree', s0.mech);
check('自动强调色为自然绿 #2e7d32', s0.primary === '#2e7d32', s0.primary);

/* ---------- 切到抽卡 → factory，青色强调 ---------- */
const s1 = await p.evaluate(() => {
  Store.setRewardMode('gacha');
  Theme.applyMech();
  return {
    mech: document.documentElement.getAttribute('data-mech'),
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase()
  };
});
check('抽卡模式 → data-mech=factory', s1.mech === 'factory', s1.mech);
check('自动强调色切换为工厂青 #0099d8', s1.primary === '#0099d8', s1.primary);

/* ---------- 手动选色 → 覆盖机制色，结构仍为 factory ---------- */
const s2 = await p.evaluate(() => {
  Theme.setThemeColor('teal');           // 预设 teal = #14b8a6
  return {
    auto: Store.state.settings.themeSkinAuto,
    mech: document.documentElement.getAttribute('data-mech'),
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase()
  };
});
check('手动选色后关闭自动跟随', s2.auto === false, s2.auto);
check('主色被用户色覆盖（#14b8a6）', s2.primary === '#14b8a6', s2.primary);
check('结构仍保持 factory', s2.mech === 'factory', s2.mech);

/* ---------- 关闭皮肤 → 移除 data-mech，主色回落到用户色 ---------- */
const s3 = await p.evaluate(() => {
  Theme.setThemeSkin(false);
  return {
    skin: Store.state.settings.themeSkin,
    mech: document.documentElement.getAttribute('data-mech'),
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase()
  };
});
check('关闭皮肤后 skin=false', s3.skin === false, s3.skin);
check('关闭皮肤后无 data-mech', !s3.mech, s3.mech);
check('关闭后主色仍为用户选色 #14b8a6', s3.primary === '#14b8a6', s3.primary);

/* ---------- 重新开启 → 恢复自动强调色（factory 青） ---------- */
const s4 = await p.evaluate(() => {
  Theme.setThemeSkin(true);
  return {
    auto: Store.state.settings.themeSkinAuto,
    mech: document.documentElement.getAttribute('data-mech'),
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase()
  };
});
check('重新开启重置为自动跟随', s4.auto === true, s4.auto);
check('重新开启恢复 data-mech=factory', s4.mech === 'factory', s4.mech);
check('重新开启强调色回到 #0099d8', s4.primary === '#0099d8', s4.primary);

/* ---------- 深色：data-mode + 机制专属深色强调色 ---------- */
const darkF = await p.evaluate(() => {
  Theme.setThemeMode('dark');
  return {
    mode: document.documentElement.getAttribute('data-mode'),
    mech: document.documentElement.getAttribute('data-mech'),
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase(),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase()
  };
});
check('深色：data-mode=dark', darkF.mode === 'dark', darkF.mode);
check('深色·抽卡强调色 = 终端青蓝 #00a2d8', darkF.primary === '#00a2d8', darkF.primary);
check('深色·抽卡底色为碳灰终端 #111419', darkF.bg === '#111419', darkF.bg);

const darkT = await p.evaluate(() => {
  Store.setRewardMode('forest');
  Theme.applyMech();
  return {
    mech: document.documentElement.getAttribute('data-mech'),
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase(),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase()
  };
});
check('深色·森林 data-mech=tree', darkT.mech === 'tree', darkT.mech);
check('深色·森林强调色 = 松林亮绿 #4caf50', darkT.primary === '#4caf50', darkT.primary);
check('深色·森林底色 = 墨绿 #0f1712', darkT.bg === '#0f1712', darkT.bg);

// 恢复浅色，避免影响后续设置页断言
await p.evaluate(() => { Theme.setThemeMode('light'); Store.setRewardMode('gacha'); Theme.applyMech(); });
await p.waitForTimeout(150);

/* ---------- 设置页存在开关控件 ---------- */
await p.evaluate(() => { location.hash = '#/settings/look'; });
await p.waitForTimeout(450);
const hasSwitch = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.cp-switch-row')];
  return rows.some(r => /机制主题皮肤/.test(r.textContent));
});
check('设置·外观页有「机制主题皮肤」开关', hasSwitch);
const hasMode = await p.evaluate(() =>
  [...document.querySelectorAll('.cp-seg-btn')].some(b => /深色/.test(b.textContent)));
check('外观页有「明暗模式」分段（含深色）', hasMode);

await p.waitForTimeout(150);
check('无控制台报错', errors.length === 0, errors.slice(0, 3));

console.log('\n结果：' + ok + ' 通过 / ' + bad + ' 失败');
await b.close();
process.exit(bad ? 1 : 0);
