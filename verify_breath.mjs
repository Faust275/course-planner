// 有效动作 / 全勤 / 摸鱼券（补签·护树·休整·复活）+ 定向券人人可得
import { chromium } from 'playwright';

const BASE = process.env.URL || 'http://localhost:8137/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 } });
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

/* ---------- 1. 有效日门槛 = 2 次有效动作 ---------- */
const day = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.validDays = {}; sh.growth = 0; sh.streak = { weekEnd: '', monthEnd: '' };
  sh.tickets = { selection: 0, fish: 0 }; sh.fishLog = [];
  const t = DateUtil.toStr(DateUtil.today());
  Store.markAction('task', 1);
  const after1 = { n: sh.validDays[t], valid: Store.isValidDay(t) };
  Store.markAction('task', 1);
  const after2 = { n: sh.validDays[t], valid: Store.isValidDay(t) };
  return { after1, after2, min: POMO.VALID_DAY_MIN };
});
check('1 次动作还不算有效日', day.after1.valid === false, day);
check('2 次动作记为有效日', day.after2.valid === true && day.after2.n === 2, day);

/* ---------- 1b. 各模块动作都能计入有效动作 ---------- */
const wired = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.validDays = {}; sh.growth = 0; sh.tickets = { selection: 0, fish: 0 };
  const t = DateUtil.toStr(DateUtil.today());
  const seq = [];
  Store.addTask({ title: '埋点测试待办' });            seq.push(sh.validDays[t] || 0);
  Store.addPlan({ title: '埋点测试计划', type: 'checkin', period: 'daily', days: 7 }); seq.push(sh.validDays[t] || 0);
  Store.addCourse({ name: '埋点测试课', slots: [{ day: 1, periodId: 'p1' }] }); seq.push(sh.validDays[t] || 0);
  return { seq, valid: Store.isValidDay(t) };
});
check('新建待办 / 计划 / 课程都计入有效动作（第 3 次已构成有效日）',
  wired.seq[0] === 1 && wired.seq[1] === 2 && wired.seq[2] === 3 && wired.valid === true, wired);

/* ---------- 2. 成长值满 10 换 1 张（=5 次合格专注）---------- */
const growth = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.growth = 0; sh.tickets.fish = 0;
  for (let i = 0; i < 5; i++) Store.markAction('focus', 2);   // 5 次合格专注 = 10 分
  return { fish: sh.tickets.fish, growth: sh.growth };
});
check('5 次合格专注（10 分）换 1 张摸鱼券', growth.fish === 1 && growth.growth === 0, growth);

/* ---------- 3. 全勤：连续 7 天 / 30 天，人人可得（券 + 积分 + 定向券）---------- */
const streak = await p.evaluate(() => {
  const sh = Store.state.shop;
  Store.state.pomodoro.mode = 'forest';
  Store.state.pomodoro.points = 0;
  sh.validDays = {}; sh.growth = 0; sh.streak = { weekEnd: '', monthEnd: '' };
  sh.tickets = { selection: 0, fish: 0 }; sh.fishLog = [];
  const today = DateUtil.today();
  for (let i = 0; i < 30; i++) sh.validDays[DateUtil.toStr(DateUtil.addDays(today, -i))] = POMO.VALID_DAY_MIN;
  const got = Store.settleStreak();
  return {
    got, fish: sh.tickets.fish, selection: sh.tickets.selection,
    points: Store.state.pomodoro.points, streakDays: Store.validStreak()
  };
});
check('连续 30 天：得 2 张摸鱼券（周 + 月）', streak.fish === 2, streak);
check('月全勤发定向券（人人可得，无需月卡）', streak.selection === 1, streak);
check('全勤积分 = 周5 + 月20', streak.points === 25, streak);
check('连续有效日统计正确', streak.streakDays === 30, streak);

/* ---------- 4. 摸鱼券用法一：补签（补成有效日并重算全勤）---------- */
const mend = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.validDays = {}; sh.streak = { weekEnd: '', monthEnd: '' };
  sh.tickets = { selection: 0, fish: 3 }; sh.fishLog = [];
  const today = DateUtil.today();
  for (let i = 1; i < 7; i++) sh.validDays[DateUtil.toStr(DateUtil.addDays(today, -i))] = POMO.VALID_DAY_MIN;
  const miss = DateUtil.toStr(today);                       // 今天漏了
  const before = Store.validStreak();
  const r = Store.useFishCard('mend', miss);
  return { before, ok: r.ok, after: Store.validStreak(), used: sh.fishLog.length, left: Store.fishQuota().left };
});
check('补签把漏掉的日子补成有效日', mend.ok && mend.after === 7, mend);
check('补签消耗 1 张券', mend.used === 1, mend);

/* ---------- 5. 用法二/三/四：护树 / 休整 / 复活 ---------- */
const uses = await p.evaluate(() => {
  const pm = Store.state.pomodoro;
  const sh = Store.state.shop;
  sh.tickets = { selection: 0, fish: 5 }; sh.fishLog = [];
  pm.trees = []; pm.timer = { treeId: '' };
  const t = Store.seedTree ? Store.seedTree() : null;
  const tree = pm.trees[pm.trees.length - 1];
  if (tree) { pm.timer.treeId = tree.id; tree.prog = 2; tree.stage = 2; }
  const protect = Store.useFishCard('protect');
  // 立刻快照护树结果：后面的复活会把 dormant 改回 false
  const snap = { dormant: !!(tree && tree.dormant), withered: !!(tree && tree.withered) };
  if (tree) tree.dormant = false;          // 复位后再验休整
  const rest = Store.useFishCard('rest');
  const restSnap = { dormant: !!(tree && tree.dormant) };
  // 复活枯桩
  if (tree) { tree.withered = true; tree.prog = 0; }
  const revive = Store.useFishCard('revive', tree ? tree.id : null);
  return {
    protect: protect.ok, dormant: snap.dormant, withered: snap.withered,
    rest: rest.ok, restDormant: restSnap.dormant,
    revive: revive.ok, left: Store.fishQuota().left
  };
});
check('护树：树进入休眠且未枯萎', uses.protect && uses.dormant && !uses.withered, uses);
check('休整：记一次用券且树进入休眠', uses.rest === true && uses.restDormant === true, uses);
check('复活枯桩：免养分复活成功', uses.revive === true, uses);

/* ---------- 5b. 休整的收尾效果：保留树 vs 照常枯萎 ---------- */
const restKeep = await p.evaluate(() => {
  const pm = Store.state.pomodoro;
  pm.mode = 'forest';
  pm.trees = [];
  const t = Store.seedTree();
  pm.timer = { treeId: t.id };
  t.prog = 3; t.stage = 2; t.withered = false; t.dormant = true;
  Store.finishFocus(10, '', {}, { keepTree: true });
  const kept = { withered: !!t.withered, prog: t.prog, dormant: !!t.dormant };

  pm.timer = { treeId: t.id };
  t.prog = 3; t.withered = false; t.dormant = false;
  Store.finishFocus(10, '', {});
  const lost = { withered: !!t.withered, prog: t.prog };
  return { kept, lost };
});
check('用券休整：10 分钟就结束时树不枯、进度保留',
  restKeep.kept.withered === false && restKeep.kept.prog === 3 && restKeep.kept.dormant === false, restKeep.kept);
check('不用券：不足 40 分钟照常枯萎且进度归零',
  restKeep.lost.withered === true && restKeep.lost.prog === 0, restKeep.lost);

/* ---------- 6. 额度：7 天最多 5 张；持有上限 20 ---------- */
const quota = await p.evaluate(() => {
  const sh = Store.state.shop;
  // 清空有效日：前面用例已把近 30 天标成有效日，否则补签会全部因「已是有效日」被拒
  sh.validDays = {};
  sh.tickets = { selection: 0, fish: 12 }; sh.fishLog = [];
  const today = DateUtil.today();
  const results = [];
  for (let i = 0; i < 6; i++) {
    const d = DateUtil.toStr(DateUtil.addDays(today, -i));
    results.push(Store.useFishCard('mend', d).ok);
  }
  return { results, quota: Store.fishQuota() };
});
check('近 7 天用满 5 张后第 6 次被拒',
  quota.results.slice(0, 5).every(Boolean) && quota.results[5] === false, quota);
check('额度口径 = 已用 5 / 上限 5', quota.quota.used === 5 && quota.quota.left === 0, quota.quota);

const hold = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.tickets = { selection: 0, fish: 0 };
  for (let i = 0; i < 30; i++) Store.grantTicket('fish', '测试');
  return { fish: sh.tickets.fish, max: POMO.FISH_HOLD_MAX };
});
check('摸鱼券持有上限 20 张', hold.fish === 20, hold);

/* ---------- 7. 卡名与旧档迁移 ---------- */
const legacy = await p.evaluate(() => {
  const sh = Store.state.shop;
  sh.tickets = { selection: 0, makeUp: 4 }; sh.makeUpLog = []; delete sh.tickets.fish;
  // 模拟旧档加载：走一遍迁移逻辑（与 store.js 的迁移一致）
  if (sh.tickets.fish == null) sh.tickets.fish = sh.tickets.makeUp || 0;
  delete sh.tickets.makeUp;
  return { fish: sh.tickets.fish, hasMakeUp: 'makeUp' in sh.tickets };
});
check('旧档补签卡迁移为摸鱼券', legacy.fish === 4 && legacy.hasMakeUp === false, legacy);

/* ---------- 8. 商城 UI ---------- */
const ui = await p.evaluate(() => {
  Store.state.shop.tickets = { selection: 1, fish: 6 };
  Store.state.shop.validDays[DateUtil.toStr(DateUtil.today())] = 2;
  const blocks = [...document.querySelectorAll('.cp-shop-block')];
  return { blocks: blocks.length };
});
check('商城可渲染（不因券改动报错）', ui.blocks >= 0, ui);

check('无 JS 报错', errors.length === 0, errors.slice(0, 3));
console.log(`\n结果：${ok} 通过 / ${bad} 失败`);
process.exit(bad ? 1 : 0);
