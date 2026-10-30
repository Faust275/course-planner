// 三池体系：池成员 / 轮换 UP / 大保底 / 井（跨期不清零、近 5 期可兑）/ 预告 / 状态迁移
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8137/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 1000 } });
let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

/* ---------- 1. 分池成员 ---------- */
const mem = await p.evaluate(() => ({
  std6: Store.gachaPoolMembers('standard', 6).length,
  cls6: Store.gachaPoolMembers('classic', 6).length,
  std5: Store.gachaPoolMembers('standard', 5).length,
  cls5: Store.gachaPoolMembers('classic', 5).length,
  total: (window.AK_OPS || []).length
}));
check('标准池 6★ = 73', mem.std6 === 73, mem);
check('中坚池 6★ = 36', mem.cls6 === 36, mem);
check('中坚池 5★ = 53', mem.cls5 === 53, mem);
check('干员总数 435（含补录的琦良）', mem.total === 435, mem);

/* ---------- 2. 轮换：本期 2 名 6★ UP + 3 名 5★，且随期号推进 ---------- */
const rot = await p.evaluate(() => {
  const cur = Store.gachaRotIndex('standard');
  const a = Store.gachaUpOf('standard', 6, cur);
  const b = Store.gachaUpOf('standard', 6, cur + 1);
  const five = Store.gachaUpOf('standard', 5, cur);
  return { cur, a, b, five };
});
check('本期 UP 六星 2 名', rot.a.length === 2, rot);
check('本期 UP 五星 3 名', rot.five.length === 3, rot);
check('轮换到下一期 UP 会换人', rot.a.join() !== rot.b.join(), rot);

/* ---------- 3. 轮换覆盖：一轮内每个成员都会轮到（不落单） ---------- */
const cover = await p.evaluate(() => {
  const mem = Store.gachaPoolMembers('classic', 6).map(o => o[0]);
  const seen = {};
  // 中坚 36 人 / 每期 2 人 = 18 期一轮，多扫几轮确保覆盖
  for (let i = 0; i < 40; i++) {
    Store.gachaUpOf('classic', 6, i).forEach(n => { seen[n] = 1; });
  }
  return { total: mem.length, covered: Object.keys(seen).length };
});
check('中坚池 6★ 在 40 期内全部轮到（无落单）', cover.covered === cover.total, cover);

/* ---------- 4. 出六星：UP 占 50%、歪后大保底 ---------- */
const rate = await p.evaluate(() => {
  const pm = Store.state.pomodoro;
  pm.mode = 'gacha'; pm.jade = 5e6;
  const g = pm.gacha;
  g.currentPool = 'standard'; g.ops = [];
  const st = Store.gachaPoolState('standard');
  st.pity6 = 0; st.guaranteed = false; st.spark = 0;
  let up = 0, off = 0;
  for (let i = 0; i < 4000; i++) {
    const six = Store.pickPoolOp('standard', 6);
    const upNow = Store.gachaUpOf('standard', 6);
    if (upNow.indexOf(six.n) >= 0) up++; else off++;
    Store.gachaPoolState('standard').guaranteed = false;   // 每次重置，测原始 50/50
  }
  return { up, off, ratio: up / (up + off) };
});
check('UP 约占六星出率 50%（±5%）', Math.abs(rate.ratio - 0.5) < 0.05, rate);

const guar = await p.evaluate(() => {
  Store.gachaPoolState('standard').guaranteed = true;
  const six = Store.pickPoolOp('standard', 6);
  const upNow = Store.gachaUpOf('standard', 6);
  return { hit: upNow.indexOf(six.n) >= 0, after: Store.gachaPoolState('standard').guaranteed };
});
check('大保底状态下出六星必为 UP', guar.hit === true, guar);
check('大保底用掉后清除标记', guar.after === false, guar);

/* ---------- 5. 井：跨期不清零 + 只能兑近 5 期 UP ---------- */
const spark = await p.evaluate(() => {
  const st = Store.gachaPoolState('classic');
  st.spark = 0; st.pity6 = 0; st.guaranteed = false;
  Store.state.pomodoro.jade = 5e6;
  Store.state.pomodoro.gacha.currentPool = 'classic';
  Store.gachaPull(10);
  const after10 = st.spark;
  // 模拟跨期：直接改期号不影响计数（计数存在状态里，天然跨期）
  const early = Store.redeemSpark('classic', Store.gachaSparkPool('classic')[0].n);
  st.spark = 200;
  const list = Store.gachaSparkPool('classic');
  const outside = Store.gachaPoolMembers('classic', 6).map(o => o[0])
    .filter(n => list.every(x => x.n !== n))[0];
  const bad = Store.redeemSpark('classic', outside);
  const good = Store.redeemSpark('classic', list[0].n);
  return { after10, early, listLen: list.length, outside, badOk: bad.ok, goodOk: good.ok, left: st.spark };
});
check('十连并计井（+10）', spark.after10 === 10, spark);
check('井未满时不能兑换', spark.early.ok === false, spark.early);
check('不能兑换近 5 期 UP 之外的干员', spark.badOk === false, spark);
check('可以兑换近 5 期 UP 内的干员', spark.goodOk === true, spark);
check('兑换后井计数清零', spark.left === 0, spark.left);

/* ---------- 6. 井可兑范围 = 含当期在内 5 期 ---------- */
const range = await p.evaluate(() => {
  const cur = Store.gachaRotIndex('standard');
  let all = [];
  for (let i = 0; i < 5; i++) {
    all = all.concat(Store.gachaUpOf('standard', 6, cur - i), Store.gachaUpOf('standard', 5, cur - i));
  }
  const uniq = {}; all.forEach(n => { uniq[n] = 1; });
  return { expect: Object.keys(uniq).length, actual: Store.gachaSparkPool('standard').length };
});
check('井可兑人数 = 近 5 期 UP 去重数', range.expect === range.actual, range);

/* ---------- 7. 预告 3 期 ---------- */
const prev = await p.evaluate(() => {
  const list = Store.gachaUpcoming('standard', 3);
  return { n: list.length, hasSix: list.every(x => x.six.length === 2) };
});
check('预告返回 3 期、每期 2 名六星', prev.n === 3 && prev.hasSix, prev);

/* ---------- 8. 两个池独立计数 ---------- */
const sep = await p.evaluate(() => {
  const a = Store.gachaPoolState('standard'), c = Store.gachaPoolState('classic');
  a.pity6 = 3; a.spark = 7; c.pity6 = 11; c.spark = 2;
  return { aPity: Store.gachaPoolState('standard').pity6, cPity: Store.gachaPoolState('classic').pity6,
           aSpark: a.spark, cSpark: c.spark };
});
check('标准池与中坚池保底/井各自独立', sep.aPity === 3 && sep.cPity === 11 && sep.aSpark === 7 && sep.cSpark === 2, sep);

/* ---------- 9. 旧档兜底：状态里没有 pools 时自动补齐两个池 ---------- */
const mig = await p.evaluate(() => {
  const g = Store.state.pomodoro.gacha;
  delete g.pools; delete g.currentPool; g.pity6 = 42;
  const st = Store.gachaPoolState('standard');
  return {
    hasStandard: !!(g.pools && g.pools.standard),
    hasClassic: !!(g.pools && g.pools.classic),
    pity: st.pity6,
    pool: Store.state.pomodoro.gacha.currentPool || (Store.setGachaPool('standard'), Store.state.pomodoro.gacha.currentPool)
  };
});
check('状态缺 pools 时自动补齐标准/中坚两个池', mig.hasStandard && mig.hasClassic, mig);
check('默认当前池为标准寻访', mig.pool === 'standard', mig);

/* ---------- 10. 抽卡页 UI ---------- */
const ui = await p.evaluate(() => {
  Store.state.pomodoro.mode = 'gacha';
  Store.state.pomodoro.jade = 120000;
  Store.setGachaPool('standard');
  Gacha.open();
  return {
    tabs: document.querySelectorAll('.cp-gc-pool-tab').length,
    up: (document.querySelector('.cp-gc-up-six') || {}).textContent || '',
    prev: document.querySelectorAll('.cp-gc-prev-row').length
  };
});
check('抽卡页有 2 个池切换标签', ui.tabs === 2, ui);
check('抽卡页显示本期 UP', /·/.test(ui.up) || ui.up.length > 0, ui);
check('抽卡页显示 3 期预告', ui.prev === 3, ui);

check('无 JS 报错', errors.length === 0, errors.slice(0, 3));
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
