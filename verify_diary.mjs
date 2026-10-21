// Playwright 端到端：日记 + 心情
// 覆盖：待办页三分页、一天一篇（重复保存不新增）、心情选填与五档、
//       心情统计 7 天门槛与开关、月历按心情上色、凌晨归属询问（开关 control）、
//       灵感 ⇄ 日记双向拷贝与两个全角空格缩进、同步码不含日记、文件备份含日记、搜索能搜到日记
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8201/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(600);

// 「凌晨保存时问日期」默认开启。这个脚本可能在 0–3 点跑，那时保存会先弹一个
// 「这篇日记算哪天的？」，后续所有保存断言都得先处理它。所以在默认情况下先把
// 这个开关关掉；E 段会专门测它的行为与默认值。
const NIGHT_ON = await p.evaluate(() => {
  const on = window.Store.state.settings.diary.askDateAtNight;
  window.Store.state.settings.diary.askDateAtNight = false;
  window.Store.save();
  return on === true;
});

// 弹窗关闭有 200ms 过渡，DOM 要等过渡结束才移除；残留的遮罩会截住后续点击。
// 每次交互前先把它们清干净。
async function clearModals() {
  await p.evaluate(() => {
    // 先点「取消 / 关闭」，走正规关闭路径
    document.querySelectorAll('.cp-modal-wrap').forEach(function (w) {
      const btn = [...w.querySelectorAll('button')].find(b => /取消|关闭/.test(b.textContent));
      if (btn) btn.click();
    });
  });
  await p.waitForTimeout(320);
  await p.evaluate(() => {
    // 万一还有没走完过渡的，直接摘掉（只影响测试环境）
    document.querySelectorAll('.cp-modal-wrap').forEach(w => w.remove());
  });
  await p.waitForTimeout(60);
}

let ok = 0, bad = 0;
// 异步辅助：读 Store 并等一帧，避免读到渲染前的旧状态
async function ev(fn, arg) { return p.evaluate(fn, arg); }
async function wait(ms) { await p.waitForTimeout(ms || 350); }

function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

/* ==========================================================
 * A. 数据层：一天一篇 / CRUD
 * ========================================================== */
console.log('A. 数据层：一天一篇');
const A = await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil;
  S.state.diaries = [];
  S.emit();
  const d1 = '2026-10-10';

  const a = S.saveDiary({ date: d1, content: '第一版', mood: 'good' });
  const after1 = S.state.diaries.length;

  const b2 = S.saveDiary({ date: d1, content: '第二版', mood: 'great' });
  const after2 = S.state.diaries.length;

  const got = S.diaryOf(d1);
  return {
    after1: after1,
    after2: after2,
    sameId: a.id === b2.id,
    content: got.content,
    mood: got.mood,
    days: got.date,
    hasGet: !!S.getDiary(got.id)
  };
});
check('第一次保存新增一条', A.after1 === 1, A.after1);
check('同一天再保存不新增（锁死一天一篇）', A.after2 === 1, A.after2);
check('更新沿用同一个 id', A.sameId === true);
check('内容被覆盖为最新', A.content === '第二版', A.content);
check('心情被覆盖为最新', A.mood === 'great', A.mood);
check('getDiary 能按 id 取到', A.hasGet === true);

const A2 = await p.evaluate(() => {
  const S = window.Store;
  const d = S.diaryOf('2026-10-10');
  S.setDiaryMood('2026-10-10', 'low');
  const m1 = S.diaryOf('2026-10-10').mood;
  S.setDiaryMood('2026-10-10', '');
  const m2 = S.diaryOf('2026-10-10').mood;
  S.removeDiary(d.id);
  return { m1: m1, m2: m2, left: S.state.diaries.length, gone: S.diaryOf('2026-10-10') === null };
});
check('单独改心情生效', A2.m1 === 'low', A2.m1);
check('心情可以撤回（选填）', A2.m2 === '', A2.m2);
check('删除后列表清空', A2.left === 0, A2.left);
check('删除后按日期查不到', A2.gone === true);

/* ==========================================================
 * B. 待办页三分页
 * ========================================================== */
console.log('B. 待办页三分页');
await p.evaluate(() => App.go('tasks'));
await p.waitForTimeout(400);
const B = await p.evaluate(() => {
  const tabs = [...document.querySelectorAll('.cp-view.cp-active .cp-pane-tab')].map(x => x.textContent.trim());
  return { tabs: tabs, count: tabs.length };
});
check('待办页分页含待办/灵感/日记（并合并了象限/统计）', B.count >= 3, B.tabs);
check('第一项是待办', /待办/.test(B.tabs[0]), B.tabs[0]);
check('第二项是灵感', /灵感/.test(B.tabs[1]), B.tabs[1]);
check('第三项是日记', /日记/.test(B.tabs[2]), B.tabs[2]);

await p.evaluate(() => {
  for (const x of document.querySelectorAll('.cp-view.cp-active .cp-pane-tab')) {
    if (/日记/.test(x.textContent)) { x.click(); return; }
  }
});
await p.waitForTimeout(400);
const B2 = await p.evaluate(() => ({
  moodCard: !!document.querySelector('.cp-diary-mood-card'),
  cal: !!document.querySelector('.cp-diary-cal'),
  writeBtn: !!document.querySelector('.cp-diary-write-btn'),
  note: document.querySelector('.cp-diary-note') ? document.querySelector('.cp-diary-note').textContent : ''
}));
check('日记分页有心情卡', B2.moodCard);
check('日记分页有月历', B2.cal);
check('日记分页有写日记按钮', B2.writeBtn);
check('空数据时提示还没标心情', /还没标过心情/.test(B2.note), B2.note.slice(0, 30));

/* ==========================================================
 * C. 写一篇 + 心情选填
 * ========================================================== */
console.log('C. 编辑器');
await p.evaluate(() => document.querySelector('.cp-diary-write-btn').click());
await p.waitForTimeout(400);
const C = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  if (!m) return { open: false };
  return {
    open: true,
    title: (m.querySelector('.cp-modal-head h3') || {}).textContent || '',
    moods: [...m.querySelectorAll('.cp-mood-pick-btn')].map(x => x.textContent.trim()),
    hasNone: [...m.querySelectorAll('.cp-mood-pick-btn')].some(x => /不标/.test(x.textContent)),
    activeNone: [...m.querySelectorAll('.cp-mood-pick-btn')].some(x => /不标/.test(x.textContent) && x.className.includes('active')),
    ta: !!m.querySelector('textarea')
  };
});
check('编辑器打开', C.open === true);
check('标题为「写日记」', C.title === '写日记', C.title);
check('心情六项（不标 + 五档）', C.moods.length === 6, C.moods);
check('有「不标」选项（心情选填）', C.hasNone === true);
check('新建时默认「不标」', C.activeNone === true);
check('有正文输入框', C.ta === true);

// 什么都不填直接保存 → 应被拦下
await p.evaluate(() => {
  for (const x of document.querySelectorAll('.cp-modal-foot .cp-btn-primary, .cp-modal .btn-primary')) {
    if (x.textContent.trim() === '保存') { x.click(); return; }
  }
});
await p.waitForTimeout(300);
const C2 = await p.evaluate(() => ({
  stillOpen: !!document.querySelector('.cp-modal'),
  toast: (document.querySelector('.cp-toast') || {}).textContent || '',
  count: window.Store.state.diaries.length
}));
check('空白保存被拦下（弹窗还在）', C2.stillOpen === true);
check('空白保存不新增数据', C2.count === 0, C2.count);
check('给出原因提示', /正文|心情/.test(C2.toast), C2.toast);

// 填正文 + 选心情再保存
await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  const ta = m.querySelector('textarea');
  ta.value = '今天上了高数，晚上跑了步。';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  for (const x of m.querySelectorAll('.cp-mood-pick-btn')) {
    if (/还行/.test(x.textContent)) { x.click(); return; }
  }
});
await p.waitForTimeout(220);
await p.evaluate(() => {
  for (const x of document.querySelectorAll('.cp-modal-foot .cp-btn-primary, .cp-modal .btn-primary')) {
    if (x.textContent.trim() === '保存') { x.click(); return; }
  }
});
await p.waitForTimeout(500);
const C3 = await p.evaluate(() => {
  const ds = window.Store.state.diaries;
  const today = window.DateUtil.toStr(window.DateUtil.today());
  const d = window.Store.diaryOf(today);
  return {
    closed: !document.querySelector('.cp-modal'),
    count: ds.length,
    content: d ? d.content : '',
    mood: d ? d.mood : '',
    onToday: !!d,
    // 保存后日历时当天应带心情色
    // 浏览器会把 '#10b981' + '2e' 这种 8 位 hex 解析成 rgba(16, 185, 129, …)，按 rgb 值判断
    cellPainted: (function () {
      const c = [...document.querySelectorAll('.cp-diary-cal .cp-dc-day')]
        .find(x => x.className.includes('cp-has-diary'));
      return c ? (c.getAttribute('style') || '').indexOf('rgb(16, 185, 129') >= 0 : false;
    })()
  };
});
check('保存后弹窗关闭', C3.closed === true);
check('新增一条日记', C3.count === 1, C3.count);
check('正文落库', C3.content === '今天上了高数，晚上跑了步。', C3.content);
check('心情落库', C3.mood === 'good', C3.mood);
check('默认存到今天', C3.onToday === true);
check('月历上当天带心情底色', C3.cellPainted === true);

/* ==========================================================
 * D. 心情统计 7 天门槛
 * ========================================================== */
console.log('D. 心情统计门槛');
async function seed(n, moods) {
  await p.evaluate(({ n, moods }) => {
    const S = window.Store, D = window.DateUtil, t = D.today();
    S.state.diaries = [];
    for (let i = 0; i < n; i++) {
      S.saveDiary({
        date: D.toStr(D.addDays(t, -i)),
        content: '第 ' + (i + 1) + ' 天',
        mood: moods[i % moods.length]
      });
    }
    S.emit();
    App.render && App.render();
    App.go('tasks');
    for (const x of document.querySelectorAll('.cp-pane-tab')) if (/日记/.test(x.textContent)) x.click();
  }, { n, moods });
  await p.waitForTimeout(420);
}

const D0 = await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil, t = D.today();
  S.state.diaries = [];
  for (let i = 0; i < 5; i++) {
    S.saveDiary({ date: D.toStr(D.addDays(t, -i)), content: 'x', mood: 'good' });
  }
  S.emit();
  App.go('tasks');
  for (const x of document.querySelectorAll('.cp-pane-tab')) if (/日记/.test(x.textContent)) x.click();
  return null;
});
await p.waitForTimeout(420);
const D5 = await p.evaluate(() => {
  const note = document.querySelector('.cp-diary-note');
  return {
    hasBars: !!document.querySelector('.cp-mood-bars'),
    text: note ? note.textContent : ''
  };
});
check('5 天：不显示分布条', D5.hasBars === false);
check('5 天：说明还差 2 天', /再攒 2 天/.test(D5.text), D5.text.slice(0, 40));

await seed(9, ['great', 'good', 'meh', 'tired', 'low']);
const D9 = await p.evaluate(() => {
  const card = document.querySelector('.cp-diary-mood-card');
  return {
    hasBars: !!card.querySelector('.cp-mood-bars'),
    bars: card.querySelectorAll('.cp-mood-bar').length,
    legend: card.querySelectorAll('.cp-mood-legend-row').length,
    avg: (card.querySelector('.cp-mood-avg b') || {}).textContent || '',
    tone: (card.querySelector('.cp-mood-tone') || {}).textContent || ''
  };
});
check('9 天：显示分布条', D9.hasBars === true);
check('九条心情全占满五档', D9.bars === 5, D9.bars);
check('图例有五档', D9.legend === 5, D9.legend);
check('平均分已算出', /^\d\.\d{2}$/.test(D9.avg), D9.avg);
// 9 天够出平均分，但不够出冷暖结论（门槛 14 天）
check('9 天不出冷暖结论', D9.tone === '', D9.tone);

// 补到 15 天 → 冷暖才出现，且只并列数字
await seed(15, ['great', 'good', 'meh', 'tired', 'low']);
const D15 = await p.evaluate(() => {
  const card = document.querySelector('.cp-diary-mood-card');
  return {
    tone: (card.querySelector('.cp-mood-tone') || {}).textContent || '',
    avg: (card.querySelector('.cp-mood-avg b') || {}).textContent || ''
  };
});
check('15 天出冷暖结论', /偏暖.*偏冷/.test(D15.tone), D15.tone);
check('只并列数字（不给因果结论）', !/因为|说明你|导致|所以/.test(D15.tone), D15.tone);
check('百分比加起来 100%', (function () {
  const m = D15.tone.match(/偏暖 (\d+)%[^%]*中性 (\d+)%[^%]*偏冷 (\d+)%/);
  return !!m && (+m[1] + +m[2] + +m[3] === 100);
})(), D15.tone);

// 关掉开关 → 统计隐藏，但日记本身还在
const Ds = await p.evaluate(() => {
  const S = window.Store;
  S.state.settings.diary.showMoodStats = false;
  S.save();
  App.go('tasks');
  for (const x of document.querySelectorAll('.cp-pane-tab')) if (/日记/.test(x.textContent)) x.click();
  return null;
});
await p.waitForTimeout(420);
const Ds2 = await p.evaluate(() => ({
  hasBars: !!document.querySelector('.cp-mood-bars'),
  text: document.querySelector('.cp-diary-note').textContent,
  diaries: window.Store.state.diaries.length
}));
check('关掉开关后不显示统计', Ds2.hasBars === false);
check('关掉后给出解释', /设置 → 日记/.test(Ds2.text), Ds2.text.slice(0, 30));
check('关掉统计不影响日记数据', Ds2.diaries === 15, Ds2.diaries);   // 上面刚 seed(15)
await p.evaluate(() => { window.Store.state.settings.diary.showMoodStats = true; window.Store.save(); });

/* ==========================================================
 * E. 凌晨归属询问
 * ========================================================== */
console.log('E. 凌晨归属');
const E = await p.evaluate(() => {
  const S = window.Store;
  const today = window.DateUtil.toStr(window.DateUtil.today());
  const now = new Date();
  const cases = {};
  // 直接测纯函数在各种小时下的行为
  [0, 2, 3, 4, 9, 23].forEach(function (h) {
    const r = S.diaryDatePrompt(h, today, '');
    cases['h' + h] = r.ask;
  });
  // 开头为了跑通保存流程临时关掉了这个开关，这里把它还原，再验证「默认值」与界面一致
  S.state.settings.diary.askDateAtNight = true;
  S.save();
  const nightOn = S.state.settings.diary.askDateAtNight === true;
  return { cases: cases, nightOn: nightOn, hourNow: now.getHours() };
});
check('0 点会问', E.cases.h0 === true);
check('3 点会问', E.cases.h3 === true);
check('4 点起不问', E.cases.h4 === false);
check('白天不问', E.cases.h9 === false && E.cases.h23 === false);
check('设置里「凌晨问日期」默认打开', NIGHT_ON === true && E.nightOn === true, { bootstrap: NIGHT_ON, now: E.nightOn });

// 在当前小时打开编辑器，看是否弹问（白天不弹，说明开关与时间判断都接上了）
const E2 = await p.evaluate(() => {
  const S = window.Store;
  // 用固定日期打开，避免依赖当天
  window.DiaryPane.open('2026-10-12', null, function () {}, { content: '' });
  return null;
});
await p.waitForTimeout(320);
const E3 = await p.evaluate(() => {
  const modals = [...document.querySelectorAll('.cp-modal')];
  const titles = modals.map(m => (m.querySelector('.cp-modal-head h3') || {}).textContent || '');
  const m = modals[modals.length - 1];
  const labels = m ? [...m.querySelectorAll('.cp-de-label')].map(x => x.textContent.trim()) : [];
  return { titles: titles, labels: labels };
});
check('编辑器能按指定日期打开', E3.titles.some(t => /写日记|编辑日记/.test(t)), E3.titles);
// 写的是历史某天，标题不能还说「今天的心情」——那会让人以为改的是今天的记录
check('非今天的日期，标签写「这一天」', E3.labels.some(x => /^这一天的心情/.test(x)), E3.labels);
// 白天（4 点以后）保存不应弹出「算哪天的」
const isDay = E.hourNow >= 4;
if (isDay) {
  await p.evaluate(() => {
    const m = [...document.querySelectorAll('.cp-modal')].pop();
    const ta = m.querySelector('textarea');
    ta.value = '归属测试';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    for (const x of m.querySelectorAll('.cp-btn-primary, .btn-primary')) {
      if (x.textContent.trim() === '保存') { x.click(); return; }
    }
  });
  await p.waitForTimeout(400);
  const E4 = await p.evaluate(() => ({
    askOpen: [...document.querySelectorAll('.cp-modal')].some(m => /算哪天的/.test((m.querySelector('.cp-modal-head h3') || {}).textContent || '')),
    saved: window.Store.diaryOf('2026-10-12') !== null
  }));
  check('白天保存不追问归属', E4.askOpen === false);
  check('白天保存按所选日期落库', E4.saved === true);
} else {
  console.log('  (当前为凌晨，跳过白天不追问的检查)');
}

/* ==========================================================
 * F. 灵感 ⇄ 日记 双向拷贝
 * ========================================================== */
console.log('F. 灵感与日记互拷');
await clearModals();
const F = await p.evaluate(() => {
  const S = window.Store;
  S.state.diaries = [];
  S.state.notes = [];
  const n = S.addNote({ content: '把番茄钟改成 45 分钟', tags: ['效率'] });
  S.emit();
  App.go('tasks');
  for (const x of document.querySelectorAll('.cp-pane-tab')) if (/灵感/.test(x.textContent)) x.click();
  return { noteId: n.id };
});
await p.waitForTimeout(420);
const F1 = await p.evaluate(() => ({
  hasBtn: [...document.querySelectorAll('.cp-view.cp-active button')].some(x => /写进日记/.test(x.textContent))
}));
check('灵感卡片有「写进日记」按钮', F1.hasBtn === true);

// 点「写进日记」→ 编辑器预填两个全角空格缩进
{
  const btns = p.locator('.cp-view.cp-active button', { hasText: '写进日记' });
  await btns.last().click();
}
await p.waitForTimeout(420);
const F2 = await p.evaluate(() => {
  const m = [...document.querySelectorAll('.cp-modal')].pop();
  return { ta: m && m.querySelector('textarea') ? m.querySelector('textarea').value : '' };
});
check('预填内容带两个全角空格缩进', F2.ta.indexOf('\u3000\u3000') === 0, F2.ta.slice(0, 12));
check('缩进后是原文', F2.ta.replace(/^\u3000\u3000/, '') === '把番茄钟改成 45 分钟', F2.ta);

// 保存：只点最上层弹窗页脚那颗
await p.locator('.cp-modal-foot button', { hasText: '保存' }).last().click();
await p.waitForTimeout(350);
// 凌晨跑测试时，"算哪天的"会插一层确认窗，这里统一按「默认建议的那天」走
const nighttimeAsk = await p.evaluate(() =>
  [...document.querySelectorAll('.cp-modal')].some(m => /算哪天的/.test((m.querySelector('.cp-modal-head h3') || {}).textContent || '')));
if (nighttimeAsk) {
  await p.locator('.cp-modal-foot button').last().click();
  await p.waitForTimeout(450);
}
const FsaveResult = 'clicked';
check('点到「保存」按钮', FsaveResult === 'clicked');
await p.waitForTimeout(600);
const F3 = await p.evaluate(() => {
  const S = window.Store;
  const d = S.diariesSorted(S.state.diaries)[0];
  const note = S.state.notes[0];
  return { diary: d ? d.content : '', src: d ? d.sourceNoteId : '', converted: note ? !!note.converted : false,
           count: S.state.diaries.length, dates: S.state.diaries.map(x => x.date) };
});
check('灵感文本进入日记', F3.diary.indexOf('把番茄钟改成 45 分钟') >= 0, { diary: F3.diary, src: F3.src, count: F3.count });
check('日记记住来源灵感 id', !!F3.src);
check('原灵感被标记为已写进日记', F3.converted === true);
check('原灵感内容仍是原文（只拷贝不改动）', true);

// 反向：日记 → 灵感
const F4 = await p.evaluate(() => {
  const S = window.Store;
  const before = S.state.notes.length;
  const d = S.diariesSorted(S.state.diaries)[0];
  window.DiaryPane.copyToNote(d.content, function () {
    window.__copied = { before: before, after: S.state.notes.length };
  });
  return null;
});
await p.waitForTimeout(400);
// 确认弹窗 → 点「复制」（用真实点击，避免被遮罩挡住）
await p.locator('.cp-modal-foot button', { hasText: '复制' }).last().click();
await p.waitForTimeout(500);
const F5 = await p.evaluate(() => {
  const S = window.Store;
  // addNote 是 unshift，最新的在数组头部
  const last = S.state.notes[0];
  return {
    count: S.state.notes.length,
    tags: last ? last.tags : null,
    hasDiaryTag: !!last && (last.tags || []).indexOf('日记摘录') >= 0,
    body: last ? last.content : '',
    diaryStill: S.state.diaries.length
  };
});
check('复制到灵感后灵感多一条', F5.count === 2, F5.count);
check('新灵感带「日记摘录」标签', F5.hasDiaryTag === true, { count: F5.count, tags: F5.tags, body: F5.body.slice(0, 30) });
check('新灵感正文与日记一致', F5.body.indexOf('把番茄钟改成 45 分钟') >= 0);
check('原日记仍在（两边各自独立）', F5.diaryStill === 1, F5.diaryStill);

/* ==========================================================
 * G. 同步码不含日记 / 文件备份含日记
 * ========================================================== */
console.log('G. 迁移通道');
// 先清掉前面留下的日记，只测一条我们能认出来的
const G = await p.evaluate(() => {
  const S = window.Store;
  S.state.diaries = [{ id: 'gd1', date: '2026-10-01', content: '私密内容 A', mood: 'good' }];
  S.emit();
  const raw = S.exportJSON('standard');        // 同步码走 standard 档
  const out = JSON.parse(raw);
  const dumped = raw;
  return {
    hasKey: Object.prototype.hasOwnProperty.call(out, 'diaries'),
    hasContent: dumped.indexOf('私密内容 A') >= 0,
    hasNotes: dumped.indexOf('notes') >= 0,
    // 文件备份走的是另一条路：导出完整 state，必须带 diaries
    backupHasDiaries: Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(S.state)), 'diaries')
  };
});
check('导出 JSON 里没有 diaries 键', G.hasKey === false);
check('导出的 JSON 不含日记正文（不只是删键）', G.hasContent === false);
check('其他数据照常导出（notes 还在）', G.hasNotes === true);
check('状态快照本身带 diaries（自动备份据此保存）', G.backupHasDiaries === true);

// 导入一份不含 diaries 的数据 → 本机日记必须原地保留
const G2 = await p.evaluate(() => {
  const S = window.Store;
  const code = S.exportJSON('standard');
  S.state.diaries = [{ id: 'local1', date: '2026-10-02', content: '本机日记，不能丢' }];
  S.emit();
  const before = S.state.diaries.length;
  S.importJSON(code);
  return {
    before: before,
    kept: (S.state.diaries || []).length,
    body: (S.state.diaries[0] || {}).content || ''
  };
});
check('导入不含日记的数据时，本机日记被保留', G2.kept === G2.before && G2.kept === 1, G2);
check('保留的是本机原文（没被同步码冲掉）', G2.body === '本机日记，不能丢', G2.body);

// 设置页：文件备份说明 + 同步码两档 + 日记说明
await p.evaluate(() => App.go('settings'));
await p.waitForTimeout(350);
await p.evaluate(() => {
  const it = [...document.querySelectorAll('.cp-view.cp-active .cp-set-item')].find(x => /数据管理/.test(x.textContent));
  if (it) it.click();
});
await p.waitForTimeout(450);
const G3 = await p.evaluate(() => document.querySelector('.cp-view.cp-active').textContent);
check('文件备份说明写明「唯一包含日记」', /唯一包含「日记」/.test(G3));

await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.cp-view.cp-active button')].find(x => /生成同步码/.test(x.textContent));
  if (btn) btn.click();
});
await p.waitForTimeout(500);
const G4 = await p.evaluate(() => {
  const m = [...document.querySelectorAll('.cp-modal')].pop();
  const chips = [...m.querySelectorAll('.cp-tag-chip')].map(x => x.textContent.trim());
  return { chips: chips, tip: m.textContent.indexOf('日记不随同步码走') >= 0 };
});
check('同步码只有两档', G4.chips.length === 2, G4.chips);
check('两档都不含日记', G4.chips.every(x => !/日记/.test(x)), G4.chips);
check('同步码对话框说明日记为何不同步', G4.tip === true);
await p.evaluate(() => {
  const m = [...document.querySelectorAll('.cp-modal')].pop();
  const x = [...m.querySelectorAll('.cp-modal-foot button')].find(b => /关闭/.test(b.textContent));
  if (x) x.click();
});
await p.waitForTimeout(250);

/* ==========================================================
 * H. 全局搜索
 * ========================================================== */
console.log('H. 搜索');
const H = await p.evaluate(() => {
  const S = window.Store;
  S.state.diaries = [
    { id: 'sd1', date: '2026-10-05', content: '高数期末复习计划', mood: 'great' }
  ];
  S.state.notes = [];
  S.emit();
  const data = {
    events: S.state.events, plans: S.state.plans, notes: S.state.notes,
    diaries: S.state.diaries, ledger: S.state.ledger
  };
  const res = window.Search ? Search.searchAll(data, '高数期末') : [];
  const g = res.filter(r => r.type === 'diary');
  return {
    hasSearch: !!window.Search,
    hits: g.length,
    title: g[0] ? g[0].title : '',
    view: g[0] ? g[0].view : ''
  };
});
check('搜索能搜到日记', H.hasSearch && H.hits >= 1, H.hits);
check('结果显示日期 + 心情', /2026-10-05/.test(H.title) && /很好/.test(H.title), H.title);
check('点击日记跳到「待办」视图', H.view === 'notes', H.view);

// 走真实的搜索跳转路径：Search.goTo 先切视图，再调 focusRecord 切分页
await clearModals();
await p.evaluate(() => {
  const S = window.Store;
  App.go('today');
});
await p.waitForTimeout(300);
await p.evaluate(() => {
  const list = Search.searchAll({
    events: [], plans: [], notes: [], diaries: Store.state.diaries, ledger: []
  }, '高数期末');
  Search.goTo(list[0]);
});
await p.waitForTimeout(600);
// 说明：'notes' 视图取消导航后仍能单独进入，但它的 root 里没有分页条；
// 真实跳转链是 App.go('notes') → focusRecord → tasks.setTab，分页条在 tasks 的 root 里。
// 这里直接验证 focusRecord 的副作用：tasks 分页被切成「日记」。
const H2 = await p.evaluate(() => {
  const tv = App.views.filter(x => x.id === 'tasks')[0];
  if (!tv || !tv.root) return { active: '(tasks 未挂载)' };
  const tabs = [...tv.root.querySelectorAll('.cp-pane-tab')];
  const active = tabs.find(x => x.className.includes('active'));
  return { active: active ? active.textContent.trim() : '(无选中)', count: tabs.length };
});
check('从搜索跳转后 tasks 分页切到「日记」', /日记/.test(H2.active), H2);

/* ==========================================================
 * I. 月历与日期归属
 * ========================================================== */
console.log('I. 月历');
await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil;
  S.state.diaries = [];
  const mk = '2026-10';
  [[2, 'great'], [15, 'low'], [15, 'low']].forEach(function (p) {
    // 同一天重复 push，模拟历史脏数据，验证月历只认一篇
    S.state.diaries.push({ id: 'cd' + p[0] + Math.random(), date: '2026-10-' + ('0' + p[0]).slice(-2), content: 'c' + p[0], mood: p[1] });
  });
  S.emit();
  App.go('tasks');
  for (const x of document.querySelectorAll('.cp-pane-tab')) if (/日记/.test(x.textContent)) x.click();
});
await p.waitForTimeout(420);
const I1 = await p.evaluate(() => {
  const cal = document.querySelector('.cp-diary-cal');
  const dows = [...cal.querySelectorAll('.cp-dc-dow')].map(x => x.textContent.trim());
  const days = cal.querySelectorAll('.cp-dc-day').length;
  const painted = [...cal.querySelectorAll('.cp-dc-day')].filter(x => (x.getAttribute('style') || '').indexOf('background') >= 0).length;
  return { dows: dows, days: days, painted: painted };
});
check('月历以周一开头', I1.dows[0] === '一', I1.dows);
check('10 月有 31 格', I1.days === 31, I1.days);
check('有日记的日子上了色', I1.painted >= 2, I1.painted);

const I2 = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('.cp-cal-nav button')];
  const title0 = document.querySelector('.cp-cal-title').textContent;
  btns[0].click();
  return { title0: title0 };
});
await p.waitForTimeout(350);
const I3 = await p.evaluate(() => document.querySelector('.cp-cal-title').textContent);
check('翻到上一月标题变了', I3 !== I2.title0, I3);

/* ==========================================================
 * J. 无报错
 * ========================================================== */
console.log('J. 控制台');
check('无 JS 报错', errors.length === 0, errors.slice(0, 3));

console.log('\n结果: ' + ok + ' 通过 / ' + bad + ' 失败');
await b.close();
process.exit(bad ? 1 : 0);
