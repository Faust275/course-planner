// 限定专区：限定井（双井并计但不叠加）/ 全勤发券（人人可得）/ 补签 / 月卡 3 倍收益
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8137/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
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

/* ---------- 1. 月卡 5 倍收益（算出来而非写死） ---------- */
const cardGain = await p.evaluate(() => {
  const P = (typeof POMO !== "undefined" ? POMO : Store.POMO);
  const weekWindows = Math.floor(P.CARD_DAYS / 7);           // 30 天内的滚动周数
  return {
    price: P.CARD_PRICE, daily: P.CARD_DAILY, week: P.CARD_WEEK_BONUS, full: P.CARD_FULL_BONUS,
    total: P.CARD_DAILY * P.CARD_DAYS + P.CARD_WEEK_BONUS * weekWindows + P.CARD_FULL_BONUS,
    jadePrice: P.CARD_PRICE_GACHA,
    jadeTotal: (P.CARD_DAILY * P.CARD_DAYS + P.CARD_WEEK_BONUS * weekWindows + P.CARD_FULL_BONUS) * P.JADE_PER_POINT
  };
});
check('月卡单日返还 = 25', cardGain.daily === 25, cardGain.daily);
const ratio = cardGain.total / cardGain.price;
check('森林月卡 30 天全勤总返还 ≈ 售价 3 倍（2.7~3.3）', ratio >= 2.7 && ratio <= 3.3, { total: cardGain.total, ratio: +ratio.toFixed(2) });
const jratio = cardGain.jadeTotal / cardGain.jadePrice;
check('抽卡月卡同样是 3 倍（按 180 折算）', jratio >= 2.7 && jratio <= 3.3, { jade: cardGain.jadeTotal, jratio: +jratio.toFixed(2) });

/* ---------- 2. 全勤：人人可得（无月卡也发券） ---------- */
const ticketFlow = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.card = null;                       // 没有月卡
  sh.validDays = {}; sh.growth = 0; sh.streak = { weekEnd: '', monthEnd: '' };
  sh.tickets = { selection: 0, fish: 0 }; sh.fishLog = [];
  for (let i = 0; i < 30; i++) {
    sh.validDays[DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -i))] = POMO.VALID_DAY_MIN;
  }
  const got = Store.settleStreak();
  return { tickets: { ...sh.tickets }, got };
});
check('普通用户（无月卡）周/月全勤各发 1 张摸鱼券', ticketFlow.tickets.fish === 2, ticketFlow);
check('月全勤发定向券（无需月卡）', ticketFlow.tickets.selection === 1, ticketFlow);

/* ---------- 3. 摸鱼券补签：把漏掉的一天补成有效日 ---------- */
const mend = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.validDays = {}; sh.tickets = { selection: 0, fish: 1 }; sh.fishLog = [];
  const k = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -3));
  const was = Store.isValidDay(k);
  const r = Store.useFishCard('mend', k);
  return { ok: r.ok, was, valid: Store.isValidDay(k), spent: 1 - sh.tickets.fish };
});
check('摸鱼券可以补签漏掉的日子', mend.ok && !mend.was && mend.valid, mend);
check('补签消耗 1 张券', mend.spent === 1, mend);

/* ---------- 4. 限定井：登记 + 攒井 + 兑换 ---------- */
const spark = await p.evaluate(() => {
  const g = Store.state.pomodoro.gacha;
  g.limited = { target: '', count: 0 };
  const target = Store.limitedOps(6)[0];
  const setR = Store.setLimitedTarget(target.n);
  g.limited.count = 150;
  const mid = Store.limitedSparkInfo();
  const early = Store.redeemLimitedSpark();          // 没攒够应失败
  g.limited.count = POMO.LIMITED_SPARK;
  const ready = Store.limitedSparkInfo();
  const before = g.ops.filter(o => o.n === target.n).length;
  const done = Store.redeemLimitedSpark();
  const after = g.ops.filter(o => o.n === target.n).length;
  return {
    need: POMO.LIMITED_SPARK, mid: mid.count, ready: ready.ready,
    earlyOk: early.ok, doneOk: done.ok, before, after, cleared: g.limited.count
  };
});
check(`限定井门槛 = ${spark.need}`, spark.need === 200, spark.need);
check('未攒满时不能兑换', spark.earlyOk === false, spark);
check('攒满后可以兑换登记的限定', spark.doneOk && spark.after === spark.before + 1, spark);
check('兑换后限定井计数清零', spark.cleared === 0, spark.cleared);

/* ---------- 5. 定向券：只能换限定 ---------- */
const sel = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.tickets.selection = 1;
  const lim = Store.limitedOps(6)[0].n;
  const normal = (window.AK_OPS || []).filter(o => !o[6] && o[1] === 6)[0][0];
  const bad = Store.useSelectionTicket(normal);          // 非限定应失败
  const good = Store.useSelectionTicket(lim);            // 限定应成功
  const again = Store.useSelectionTicket(lim);           // 券用完了应失败
  return { badOk: bad.ok, goodOk: good.ok, againOk: again.ok, left: sh.tickets.selection };
});
check('定向券不能换非限定干员', sel.badOk === false, sel);
check('定向券可以换限定干员', sel.goodOk === true, sel);
check('券用完后再兑换失败', sel.againOk === false && sel.left === 0, sel);

/* ---------- 6. 不设新手池：前 10 抽不强制出六星 ---------- */
const newbie = await p.evaluate(() => {
  const pm = Store.state.pomodoro;
  pm.mode = 'gacha'; pm.jade = 500000;
  const g = pm.gacha;
  g.ops = []; g.pity6 = 0; g.total = 0;
  for (let i = 0; i < 10; i++) Store.gachaPull(1);
  return { total: g.total, hasNewbieField: 'newbieDone' in g };
});
check('10 抽内不再强制出六星（无新手池）', newbie.total === 10 && newbie.hasNewbieField === false, newbie);

/* ---------- 7. 每抽都并计限定井（不与 UP 井叠加） ---------- */
const dual = await p.evaluate(() => {
  const g = Store.state.pomodoro.gacha;
  g.limited = { target: '', count: 0 };
  Store.state.pomodoro.jade = 500000;
  const before = { count: g.limited.count, total: g.total };
  Store.gachaPull(10);
  const after = { count: g.limited.count, total: g.total };
  return { before, after };
});
check('十连并计入限定井（+10）', dual.after.count - dual.before.count === 10, dual);

/* ---------- 8. 工厂主题下问候卡白字问题已修复 ---------- */
const hero = await p.evaluate(() => {
  Store.setRewardMode('gacha'); Theme.applyMech(); Theme.setThemeMode('light');
  const h = document.querySelector('.cp-card.cp-hero');
  return h ? getComputedStyle(h).backgroundImage.slice(0, 60) : 'missing';
});
check('问候卡保留主题色渐变（不再被白底覆盖）', /gradient\(/.test(hero) && /rgb/.test(hero), hero);


/* ---------- 9. 补签 = 当天签到；7 天最多用 5 张 ---------- */
const mendEq = await p.evaluate(() => {
  const sh = Store.state.shop;
  const pm = Store.state.pomodoro;
  const start = DateUtil.addDays(DateUtil.today(), -29);
  sh.card = { startDate: DateUtil.toStr(start), endDate: DateUtil.toStr(DateUtil.today()),
    days: {}, weekAwardEnd: '', fullAwarded: false, paid: 300, gained: 0, mode: 'forest' };
  sh.validDays = {};
  for (let i = 0; i < 29; i++) {
    const k = DateUtil.toStr(DateUtil.addDays(start, i));
    sh.card.days[k] = 1;
    sh.validDays[k] = POMO.VALID_DAY_MIN;
  }
  sh.tickets = { selection: 0, fish: 5 }; sh.fishLog = [];
  sh.streak = { weekEnd: '', monthEnd: '' };
  const last = DateUtil.toStr(DateUtil.today());
  const bp = pm.points, bj = pm.jade;
  const r = Store.useFishCard('mend', last);
  return {
    ok: r.ok, cardDay: !!sh.card.days[last], full: !!sh.card.fullAwarded,
    gained: (pm.points - bp) + (pm.jade - bj) / POMO.JADE_PER_POINT,
    selection: sh.tickets.selection, valid: Store.isValidDay(last)
  };
});
check('补签与当天签到等价：写入月卡签到日并返当日积分', mendEq.ok && mendEq.cardDay && mendEq.gained >= 25, mendEq);
check('补签触发 30 天全勤（月卡全勤奖）', mendEq.full, mendEq);
check('补签同样参与全勤发券（定向券）', mendEq.selection === 1, mendEq);

const mendLimit = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.card = null;
  sh.validDays = {};
  sh.tickets = { selection: 0, fish: 12 }; sh.fishLog = [];
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -i));
    out.push(Store.useFishCard('mend', d).ok);
  }
  return { results: out, quota: Store.fishQuota() };
});
check('近 7 天最多用 5 张（第 6 次被拒）',
  mendLimit.results.slice(0, 5).every(Boolean) && mendLimit.results[5] === false, mendLimit);
check('用券额度口径 = 已用 5 / 上限 5', mendLimit.quota.used === 5 && mendLimit.quota.left === 0, mendLimit.quota);

check('无 JS 报错', errors.length === 0, errors.slice(0, 3));
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
