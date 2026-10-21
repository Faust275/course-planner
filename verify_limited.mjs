// 限定专区：限定井（双井并计但不叠加）/ 定向券（月全勤）/ 补签卡（周全勤）/ 新手池 / 月卡 5 倍收益
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

/* ---------- 2. 周全勤发补签卡 / 月全勤发定向券 ---------- */
const ticketFlow = await p.evaluate(() => {
  const sh = Store.state.shop;
  // 月卡周期 = 过去 29 天起 ~ 今天（共 30 天），前 29 天全部已签
  const start = DateUtil.addDays(DateUtil.today(), -29);
  const c = {
    startDate: DateUtil.toStr(start),
    endDate: DateUtil.toStr(DateUtil.today()),
    days: {}, weekAwardEnd: '', fullAwarded: false, paid: true, gained: 0, mode: 'forest'
  };
  sh.card = c;
  sh.tickets = { selection: 0, makeUp: 0 };
  for (let i = 0; i < 29; i++) {
    c.days[DateUtil.toStr(DateUtil.addDays(start, i))] = 1;
  }
  Store.settleCard();               // 结算最后一天（今天）→ 周全勤 + 月全勤同时触发
  return { tickets: { ...sh.tickets } };
});
check('周全勤发放 1 张补签卡', ticketFlow.tickets.makeUp === 1, ticketFlow);

const full = await p.evaluate(() => {
  const sh = Store.state.shop;
  return { tickets: { ...sh.tickets }, fullAwarded: !!sh.card.fullAwarded };
});
check('月全勤发放 1 张定向券', full.tickets.selection === 1, full);
check('月全勤标记已领取', full.fullAwarded === true, full);

/* ---------- 3. 补签卡：补漏签日 ---------- */
const mend = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.tickets.makeUp = 1;
  const c = sh.card;
  // 把第 10 天挖空再补
  const k = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(c.startDate), 9));
  const wasThere = c.days[k];
  delete c.days[k];
  const before = sh.tickets.makeUp;
  const r = Store.useMakeUpCard(k);
  return { ok: r.ok, wasThere: !!wasThere, restored: !!c.days[k], spent: before - sh.tickets.makeUp };
});
check('补签卡可以补漏签日', mend.ok && mend.restored, mend);
check('补签消耗 1 张卡', mend.spent === 1, mend);

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


/* ---------- 9. 补签与当天签到等价 + 7 天限 3 张 ---------- */
const mendEq = await p.evaluate(() => {
  const sh = Store.state.shop;
  const start = DateUtil.addDays(DateUtil.today(), -29);
  sh.card = { startDate: DateUtil.toStr(start), endDate: DateUtil.toStr(DateUtil.today()),
    days: {}, weekAwardEnd: '', fullAwarded: false, paid: 300, gained: 0, mode: 'forest' };
  sh.tickets = { selection: 0, makeUp: 5, makeUpLog: [] };
  for (let i = 0; i < 29; i++) sh.card.days[DateUtil.toStr(DateUtil.addDays(start, i))] = 1;
  const last = DateUtil.toStr(DateUtil.addDays(start, 29));
  const before = sh.tickets.makeUp;
  const r = Store.useMakeUpCard(last);
  return { ok: r.ok, gained: r.gained, full: !!sh.card.fullAwarded,
           selection: sh.tickets.selection, spent: before - sh.tickets.makeUp, last };
});
check('补签触发与当天签到同等的全勤结算（发定向券）', mendEq.ok && mendEq.full && mendEq.selection === 1, mendEq);
check('补签奖励含全勤奖（>日返还）', mendEq.gained > 25, mendEq);

const mendLimit = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.tickets = { selection: 0, makeUp: 9, makeUpLog: [] };
  const start = DateUtil.addDays(DateUtil.today(), -20);
  sh.card = { startDate: DateUtil.toStr(start), endDate: DateUtil.toStr(DateUtil.today()),
    days: {}, weekAwardEnd: '', fullAwarded: true, paid: 300, gained: 0, mode: 'forest' };
  const out = [];
  // 补最近 7 天内的漏签日（today-6 … today-2），第 4 次起应被拒
  for (let i = 6; i >= 2; i--) {
    const d = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -i));
    out.push(Store.useMakeUpCard(d).ok);
  }
  return { results: out, quota: Store.makeUpQuota() };
});
check('近 7 天最多补 3 次（第 4 次被拒）',
  mendLimit.results.slice(0, 3).every(Boolean) && mendLimit.results[3] === false && mendLimit.results[4] === false, mendLimit);
check('补签额度口径 = 已用 3 / 上限 3', mendLimit.quota.used === 3 && mendLimit.quota.left === 0, mendLimit.quota);

check('无 JS 报错', errors.length === 0, errors.slice(0, 3));
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
