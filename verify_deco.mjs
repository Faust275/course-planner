// 装饰层修复回归：inline opacity 移除后按 data-mech 显隐、图层在内容之下、工厂板块切角
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8137/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 980 } });
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(650);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

const decoState = () => p.evaluate(() => {
  const t = document.querySelector('.cp-deco .deco-tree');
  const f = document.querySelector('.cp-deco .deco-factory');
  const o = el => el ? getComputedStyle(el).opacity : 'missing';
  return {
    mech: document.documentElement.getAttribute('data-mech'),
    tree: o(t), factory: o(f),
    decoZ: getComputedStyle(document.querySelector('.cp-deco')).zIndex,
    appZ: getComputedStyle(document.querySelector('.cp-app')).zIndex,
    bgZ: getComputedStyle(document.querySelector('.cp-app-bg')).zIndex
  };
});

/* 1. 默认 tree：藤蔓可见、立方体隐藏 */
let s = await decoState();
check('默认 forest → data-mech=tree', s.mech === 'tree', s.mech);
check('藤蔓可见（opacity>0）', parseFloat(s.tree) > 0, s.tree);
check('立方体隐藏（opacity=0）', parseFloat(s.factory) === 0, s.factory);
check('装饰层在内容之下（decoZ < appZ）', parseFloat(s.decoZ) < parseFloat(s.appZ), s);
check('装饰层在背景之上（decoZ >= bgZ）', parseFloat(s.decoZ) >= parseFloat(s.bgZ), s);

/* 2. 切到抽卡：立方体可见、藤蔓隐藏，卡片为切角板块 */
await p.evaluate(() => { Store.setRewardMode('gacha'); Theme.applyMech(); });
await p.waitForTimeout(550);
s = await decoState();
check('gacha → data-mech=factory', s.mech === 'factory', s.mech);
check('立方体可见', parseFloat(s.factory) > 0, s.factory);
check('藤蔓隐藏', parseFloat(s.tree) === 0, s.tree);
const cardClip = await p.evaluate(() => {
  const c = document.querySelector('.cp-view-wrap .cp-card:not(.cp-hero), .cp-view-wrap .card:not(.cp-hero)');
  return c ? getComputedStyle(c).clipPath : 'none';
});
check('工厂卡片为切角板块（clip-path polygon）', /polygon/.test(cardClip), cardClip);
const cardLine = await p.evaluate(() => {
  const c = document.querySelector('.cp-view-wrap .cp-card:not(.cp-hero), .cp-view-wrap .card:not(.cp-hero)');
  return c ? getComputedStyle(c, '::before').height : '';
});
check('板块顶部强调线存在', cardLine === '3px', cardLine);
const heroBg = await p.evaluate(() => {
  const h = document.querySelector('.cp-card.cp-hero');
  return h ? getComputedStyle(h).backgroundImage : 'missing';
});
check('问候卡保留自身渐变（不被板块白底覆盖）', /rgb/.test(heroBg) && !/0, 0, 0, 0/.test(heroBg), heroBg.slice(0, 60));

/* 3. 关闭皮肤：全部装饰消失 */
await p.evaluate(() => { Theme.setThemeSkin(false); });
await p.waitForTimeout(550);
s = await decoState();
check('关闭皮肤 → data-mech 移除', !s.mech, s.mech);
check('关闭皮肤后藤蔓消失', parseFloat(s.tree) === 0, s.tree);
check('关闭皮肤后立方体消失', parseFloat(s.factory) === 0, s.factory);

/* 4. 切回森林并重新开启皮肤 → 回到 tree */
await p.evaluate(() => { Store.setRewardMode('forest'); Theme.setThemeSkin(true); Theme.applyMech(); });
await p.waitForTimeout(550);
s = await decoState();
check('重新开启 → 回到 tree', s.mech === 'tree' && parseFloat(s.tree) > 0, s);

check('无 JS 报错', errors.length === 0, errors.slice(0, 2));
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
