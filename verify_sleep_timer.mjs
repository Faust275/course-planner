// Playwright 端到端：象限页的睡眠计时（点一下开始，再点一下结束）
// 覆盖：按钮出现 → 开始写入 sleepSession → 刷新后仍在 → 结束落一条记录
//       → 不足 1 分钟不落记录 → 导出备份不含进行中的计时
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8211/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

async function boot() {
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => App.go('tasks', { tab: 'quadrant' }));
  await p.waitForTimeout(500);
}

function findSleepBtn() {
  return p.evaluate(() => {
    const b = [...document.querySelectorAll('#view-tasks button')]
      .find(x => /^(开始睡眠|结束睡眠)$/.test(x.textContent.trim()));
    return b ? b.textContent.trim() : '';
  });
}

await boot();

/* ---- 1. 默认显示「开始睡眠」 ---- */
check('象限睡眠卡有「开始睡眠」按钮', (await findSleepBtn()) === '开始睡眠', await findSleepBtn());

/* ---- 2. 点一下开始 ---- */
await p.evaluate(() => {
  [...document.querySelectorAll('#view-tasks button')]
    .find(x => x.textContent.trim() === '开始睡眠').click();
});
await p.waitForTimeout(450);

const started = await p.evaluate(() => ({
  sess: Store.state.sleepSession,
  today: DateUtil.toStr(new Date()),
  btn: (() => {
    const b = [...document.querySelectorAll('#view-tasks button')]
      .find(x => /^(开始睡眠|结束睡眠)$/.test(x.textContent.trim()));
    return b ? b.textContent.trim() : '';
  })(),
  live: (() => {
    const n = [...document.querySelectorAll('#view-tasks *')]
      .find(x => x.children.length === 0 && /正在睡眠/.test(x.textContent));
    return n ? n.textContent.trim() : '';
  })()
}));
check('开始后有 sleepSession', !!started.sess, started.sess);
check('入睡日 = 今天', started.sess && started.sess.date === started.today, started.sess);
check('入睡时刻是 HH:MM', started.sess && /^\d{2}:\d{2}$/.test(started.sess.start), started.sess);
check('按钮变成「结束睡眠」', started.btn === '结束睡眠', started.btn);
check('卡片显示「正在睡眠」与已睡时长', /正在睡眠/.test(started.live), started.live);

/* ---- 3. 刷新后计时仍在 ---- */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => App.go('tasks', { tab: 'quadrant' }));
await p.waitForTimeout(400);
const afterReload = await p.evaluate(() => ({
  sess: !!Store.state.sleepSession,
  btn: (() => {
    const b = [...document.querySelectorAll('#view-tasks button')]
      .find(x => /^(开始睡眠|结束睡眠)$/.test(x.textContent.trim()));
    return b ? b.textContent.trim() : '';
  })()
}));
check('刷新后计时状态保留', afterReload.sess === true, afterReload);
check('刷新后按钮仍是「结束睡眠」', afterReload.btn === '结束睡眠', afterReload.btn);

/* ---- 4. 把入睡时刻改到 90 分钟前，点结束 ---- */
const expect = await p.evaluate(() => {
  const s = Store.state.sleepSession;
  const at = Date.now() - 90 * 60000;
  const d = new Date(at);
  const pad = n => (n < 10 ? '0' : '') + n;
  s.at = at;
  s.start = pad(d.getHours()) + ':' + pad(d.getMinutes());
  s.date = DateUtil.toStr(d);
  return { date: s.date, start: s.start, today: DateUtil.toStr(new Date()) };
});

await p.evaluate(() => {
  [...document.querySelectorAll('#view-tasks button')]
    .find(x => x.textContent.trim() === '结束睡眠').click();
});
await p.waitForTimeout(600);

const ended = await p.evaluate(() => ({
  sess: Store.state.sleepSession,
  sleeps: Store.state.sleeps.map(x => ({ date: x.date, start: x.start, end: x.end })),
  btn: (() => {
    const b = [...document.querySelectorAll('#view-tasks button')]
      .find(x => /^(开始睡眠|结束睡眠)$/.test(x.textContent.trim()));
    return b ? b.textContent.trim() : '';
  })()
}));
check('结束后清空 sleepSession', ended.sess === null, ended.sess);
check('落了一条睡眠记录', ended.sleeps.length === 1, ended.sleeps);
check('记录挂在入睡那天', ended.sleeps[0] && ended.sleeps[0].date === expect.date, ended.sleeps[0]);
check('记录的开始时刻正确', ended.sleeps[0] && ended.sleeps[0].start === expect.start, ended.sleeps[0]);
check('记录有结束时刻', ended.sleeps[0] && /^\d{2}:\d{2}$/.test(ended.sleeps[0].end), ended.sleeps[0]);
check('按钮恢复为「开始睡眠」', ended.btn === '开始睡眠', ended.btn);

/* ---- 5. 立刻开始又结束：不足 1 分钟，不落记录 ---- */
const short = await p.evaluate(() => {
  const before = Store.state.sleeps.length;
  Store.startSleep();
  const r = Store.endSleep();
  return { r, before, after: Store.state.sleeps.length, sess: Store.state.sleepSession };
});
check('不足 1 分钟返回 tooShort', short.r && short.r.tooShort === true, short.r);
check('不足 1 分钟不新增记录', short.after === short.before, short);
check('不足 1 分钟也会清空计时', short.sess === null, short.sess);

/* ---- 6. 导出备份不含进行中的计时 ---- */
const exp = await p.evaluate(() => {
  Store.startSleep();
  const full = Store.exportJSON('full');
  const std = Store.exportJSON('standard');
  const lite = Store.exportJSON('lite');
  Store.cancelSleep();
  return {
    full: full.indexOf('sleepSession') >= 0,
    std: std.indexOf('sleepSession') >= 0,
    lite: lite.indexOf('sleepSession') >= 0
  };
});
check('文件备份不含 sleepSession', exp.full === false, exp);
check('标准同步文件不含 sleepSession', exp.std === false, exp);
check('轻量同步文件不含 sleepSession', exp.lite === false, exp);

check('无页面报错', errors.length === 0, errors.slice(0, 3));

await b.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
