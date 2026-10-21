// 商城：月卡结算 / 双币扣款 / 满潜兑换 / 窄屏
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
async function fresh(viewport) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(650);
  await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
  await p.waitForTimeout(350);
  return p;
}
async function openShop(p) {
  await p.evaluate(() => App.go('collection'));
  await p.waitForTimeout(350);
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('.cp-gacha-tab')].find(x => /商店/.test(x.textContent));
    if (t) t.click();
  });
  await p.waitForTimeout(350);
}

const p = await fresh();
await p.evaluate(() => App.go('collection'));
await p.waitForTimeout(400);

/* ---------- 入口 ---------- */
const tabs = await p.evaluate(() => [...document.querySelectorAll('.cp-gacha-tab')].map(n => n.textContent.trim()));
check('收集页有「商店」分页', tabs.some(t => t.indexOf('商店') >= 0), tabs);

await openShop(p);
const s0 = await p.evaluate(() => ({
  bal: [...document.querySelectorAll('.cp-shop-bal-item')].map(n => n.textContent.replace(/\s+/g, ' ').trim()),
  buy: (document.querySelector('.cp-shop-block .cp-btn-primary') || {}).textContent || '',
  statsCards: document.querySelectorAll('#view-collection .cp-task-summary').length,
  hash: location.hash
}));
check('商店页不显示森林/成就概览卡', s0.statsCards === 0, s0.statsCards);
check('余额卡三项（积分 / 合成玉 / 等值）', s0.bal.length === 3, s0.bal);
check('未购买时显示 300 积分购买按钮', /300/.test(s0.buy), s0.buy);

/* ---------- 购买 ---------- */
const buyRes = await p.evaluate(async () => {
  Store.state.pomodoro.points = 1000;
  Store.state.pomodoro.jade = 0;
  Store.state.pomodoro.earned = 0;
  Store.state.shop.card = null;
  Store.save();
  const r = Store.buyCard();
  return {
    ok: r.ok,
    points: Store.state.pomodoro.points,
    gained: Store.state.shop.card && Store.state.shop.card.gained,
    end: Store.state.shop.card && Store.state.shop.card.endDate,
    info: Store.cardInfo()
  };
});
check('购买月卡成功', buyRes.ok === true);
check('扣 300 分并返当天 10 分（1000 → 710）', buyRes.points === 710, buyRes.points);
check('有效期 30 天', buyRes.info.daysLeft === 30 && buyRes.info.daysTotal === 30, buyRes.info);
check('当天记为已签', buyRes.info.todaySigned === true && buyRes.info.signedDays === 1, buyRes.info);

const again = await p.evaluate(() => Store.buyCard());
check('有效期内不能重复购买', again.ok === false, again);

await p.evaluate(() => App.current.render());
await p.waitForTimeout(300);
const afterBuy = await p.evaluate(() => ({
  dots: document.querySelectorAll('.cp-shop-dot').length,
  on: document.querySelectorAll('.cp-shop-dot.cp-on').length,
  rows: [...document.querySelectorAll('.cp-shop-row')].map(n => n.textContent.replace(/\s+/g, ' ').trim()),
  desc: document.querySelector('.cp-shop-desc') ? 1 : 0
}));
check('已购买后露出 7 天签到点', afterBuy.dots === 7, afterBuy.dots);
check('今天一个点高亮', afterBuy.on === 1, afterBuy.on);
check('显示剩余天数', afterBuy.rows.some(t => /剩余 30 天/.test(t)), afterBuy.rows);
await p.screenshot({ path: '/tmp/shop-active-1280.png', fullPage: true });

/* ---------- 30 天结算模拟 ---------- */
const sim = await p.evaluate(() => {
  const real = DateUtil.today;
  const D = s => new Date(s + 'T10:00:00');
  const run = (skip) => {
    Store.state.shop.card = {
      startDate: '2026-01-01', endDate: '2026-01-30',
      days: {}, weekAwardEnd: '', fullAwarded: false, paid: 300, gained: 0
    };
    Store.state.pomodoro.points = 0;
    Store.state.pomodoro.jade = 0;
    Store.state.pomodoro.pointLog = [];
    for (let i = 1; i <= 30; i++) {
      if (skip.indexOf(i) >= 0) continue;
      DateUtil.today = () => D('2026-01-' + String(i).padStart(2, '0'));
      Store.settleCard();
    }
    DateUtil.today = real;
    return {
      points: Store.state.pomodoro.points,
      gained: Store.state.shop.card.gained,
      full: Store.state.shop.card.fullAwarded,
      weekEnd: Store.state.shop.card.weekAwardEnd,
      src: Store.state.pomodoro.pointLog.filter(l => l.src === 'card').length
    };
  };
  return { full: run([]), miss5: run([5]), miss1: run([1]) };
});
check('30 天全勤总返 390（300 + 4×10 + 50）', sim.full.points === 390, sim.full);
check('全勤标记已发', sim.full.full === true);
check('周奖励窗口落在第 28 天', sim.full.weekEnd === '2026-01-28', sim.full.weekEnd);
check('漏第 5 天：只损失当天 + 该窗口（290 + 30 = 320）', sim.miss5.points === 320, sim.miss5);
check('漏签不发 30 天全勤奖', sim.miss5.full === false);
check('漏第 1 天仍能拿 4 次周奖励（290 + 40 = 330）', sim.miss1.points === 330, sim.miss1);
check('月卡返利写入积分流水（30 天 + 5 次奖励 = 35 条）', sim.full.src === 35, sim.full.src);

/* ---------- 双币扣款 ---------- */
const dual = await p.evaluate(() => {
  Store.state.pomodoro.points = 100;
  Store.state.pomodoro.jade = 180 * 250;   // 250 积分
  const ok1 = Store.spendPoints(300);
  const r1 = { p: Store.state.pomodoro.points, j: Store.state.pomodoro.jade };
  Store.state.pomodoro.points = 10;
  Store.state.pomodoro.jade = 180 * 10;    // 不够 300
  const ok2 = Store.spendPoints(300);
  const r2 = { p: Store.state.pomodoro.points, j: Store.state.pomodoro.jade };
  return { ok1, r1, ok2, r2 };
});
check('双币扣款成功（100 分 + 200 分等值玉）', dual.ok1 === true && dual.r1.p === 0 && dual.r1.j === 180 * 50, dual.r1);
check('两池都不够时拒绝且不扣任何币', dual.ok2 === false && dual.r2.p === 10 && dual.r2.j === 1800, dual.r2);

/* ---------- 满潜兑换 ---------- */
const ex = await p.evaluate(() => {
  Store.state.shop.dupPool = [
    { n: 'A', r: 6, pts: 40, at: Date.now() },
    { n: 'B', r: 4, pts: 12, at: Date.now() }
  ];
  Store.state.pomodoro.jade = 0;
  Store.state.pomodoro.points = 500;
  const before = Store.totalPoints();
  const info = Store.dupPoolInfo();
  const r = Store.exchangeDup();
  return {
    info, r,
    jade: Store.state.pomodoro.jade,
    pool: Store.state.shop.dupPool.length,
    before, after: Store.totalPoints()
  };
});
check('待兑换 2 份 / 52 积分 / 9360 玉', ex.info.count === 2 && ex.info.points === 52 && ex.info.jade === 9360, ex.info);
check('一键兑换得到 9360 合成玉', ex.r.ok && ex.jade === 9360, ex);
check('兑换后池子清空', ex.pool === 0);
check('兑换后等值积分 +52（重复奖励在兑换时才入账）', ex.after === ex.before + 52, { before: ex.before, after: ex.after });

const exUi = await p.evaluate(() => {
  Store.state.shop.dupPool = [{ n: 'C', r: 5, pts: 25, at: Date.now() }];
  Store.state.shop.log.unshift({ at: Date.now(), type: 'exchange', text: '测试记录' });
  App.current.render();
  return {
    btn: [...document.querySelectorAll('.cp-shop-block .cp-btn')].map(n => n.textContent.trim()),
    logs: document.querySelectorAll('.cp-shop-log').length
  };
});
check('有重复时显示兑换按钮与玉数', exUi.btn.some(t => /4500/.test(t)), exUi.btn);
check('商店显示最近记录', exUi.logs >= 1, exUi.logs);
await p.screenshot({ path: '/tmp/shop-dup-1280.png', fullPage: true });

/* ---------- 窄屏 ---------- */
const m = await fresh();
await m.setViewportSize({ width: 390, height: 800 });
await openShop(m);
const mob = await m.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  balCells: document.querySelectorAll('.cp-shop-bal-item').length,
  dots: document.querySelectorAll('.cp-shop-dot').length,
  tabs: document.querySelectorAll('.cp-gacha-tab').length
}));
check('390px 无横向溢出', mob.overflow <= 0, mob.overflow);
check('390px 余额三格仍在', mob.balCells === 3, mob.balCells);
check('窄屏 tab 可横向滚动（仍在 DOM）', mob.tabs >= 3, mob.tabs);
await m.screenshot({ path: '/tmp/shop-390.png', fullPage: true });

check('无 JS 报错', errors.length === 0, errors);
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
await b.close();
process.exit(bad ? 1 : 0);
