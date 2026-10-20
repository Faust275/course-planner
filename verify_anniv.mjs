// Playwright 端到端：倒数纪念日
// 验证：公历/农历年度重复、届数、今日命中、卡片渲染、弹窗三个类型、
//       农历换算预览、删除
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8183/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 980 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { const e = document.querySelector('.ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

const out = await p.evaluate(() => {
  const S = window.Store, D = window.DateUtil, L = window.Lunar;
  const today = D.toStr(D.today());
  const y = D.today().getFullYear();

  // 1) 今天就是纪念日
  S.addEvent({ title: '在一起纪念日', date: y + '-10-21', repeat: 'yearly', kind: 'anniversary' });
  // 2) 未来 5 天
  const d5 = D.toStr(D.addDays(D.today(), 5));
  S.addEvent({ title: '妈妈生日', date: d5.slice(0, 4) + '-01-01', repeat: 'yearly', kind: 'birthday', lunar: false });
  // 3) 农历生日（农历八月十五）
  S.addEvent({
    title: '农历中秋生日', date: '1990-06-15', repeat: 'yearly', kind: 'birthday',
    lunar: true, lunarMonth: 8, lunarDay: 15
  });
  // 4) 每月还款
  S.addEvent({ title: '房贷', date: '2024-01-01', repeat: 'monthly', kind: 'countdown' });
  // 5) 普通一次性日程（不应进纪念日列表）
  S.addEvent({ title: '班会', date: today, repeat: 'none' });

  S.emit();

  const all = S.anniversaries();
  return {
    count: all.length,
    titles: all.map(a => a.ev.title),
    sorted: all.every((a, i) => i === 0 || all[i - 1].daysLeft <= a.daysLeft),
    todayHit: all.find(a => a.ev.title === '在一起纪念日'),
    lunarHit: all.find(a => a.ev.title === '农历中秋生日'),
    // 农历八月十五：取「今天及以后」的最近一次（今年已过就取明年）
    lunarNextExpect: (function () {
      const ty = L.lunarInYear(y, 8, 15);
      if (ty && ty >= today) return ty;
      return L.lunarInYear(y + 1, 8, 15);
    })()
  };
});

// 6) 今日页渲染
await p.evaluate(() => window.App.go('today'));
await p.waitForTimeout(600);
const todayCard = await p.evaluate(() => {
  const card = document.querySelector('.cp-anniv-card');
  if (!card) return { exists: false };
  return {
    exists: true,
    rows: [...card.querySelectorAll('.cp-anniv-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    hasTodayClass: !!card.querySelector('.cp-anniv-row.cp-is-today')
  };
});

// 7) 日程页「纪念日」按钮 → 弹窗
await p.evaluate(() => window.App.go('agenda'));
await p.waitForTimeout(500);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '纪念日');
  if (btn) btn.click();
});
await p.waitForTimeout(500);
const dialog = await p.evaluate(() => {
  const m = document.querySelector('[class*=modal]');
  if (!m) return { open: false };
  const txt = m.textContent;
  return {
    open: true,
    hasTitle: /新建纪念日/.test(txt),
    kinds: ['生日', '纪念日', '倒数日'].map(k => txt.includes(k)),
    hasLunarToggle: /按公历/.test(txt),
    hasRepeat: /每年/.test(txt) && /每月/.test(txt)
  };
});

// 8) 点农历开关 → 预览出现
const lunarPreview = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => /按公历/.test(x.textContent));
  if (!btn) return { clicked: false };
  btn.click();
  const prev = document.querySelector('.cp-anniv-lunar-preview');
  return { clicked: true, text: prev ? prev.textContent.trim() : null };
});

// 9) 删除一个
const del = await p.evaluate(() => {
  const S = window.Store;
  const target = S.state.events.find(e => e.title === '房贷');
  if (!target) return { ok: false };
  S.removeEvent(target.id);
  return { ok: !S.state.events.some(e => e.title === '房贷'), left: S.anniversaries().length };
});

const checks = [
  ['纪念日 4 条（一次性日程不计）', out.count === 4],
  ...['在一起纪念日', '妈妈生日', '农历中秋生日', '房贷'].map(t => ['列出 ' + t, out.titles.includes(t)]),
  ['按剩余天数升序', out.sorted === true],
  ['今天命中 is-today', !!out.todayHit && out.todayHit.daysLeft === 0],
  ['农历生日换算正确', !!out.lunarHit && out.lunarHit.next === out.lunarNextExpect],
  ['今日页有纪念日卡片', todayCard.exists === true],
  ['卡片最多 4 行', todayCard.exists && todayCard.rows.length <= 4],
  ['卡片含今天标记', todayCard.exists && todayCard.hasTodayClass],
  ['弹窗能打开', dialog.open === true],
  ['弹窗标题正确', dialog.hasTitle === true],
  ['三种类型齐全', dialog.kinds && dialog.kinds.every(Boolean)],
  ['有农历切换', dialog.hasLunarToggle === true],
  ['有每年/每月', dialog.hasRepeat === true],
  ['农历预览有文字', !!(lunarPreview.text && /农历/.test(lunarPreview.text))],
  ['删除生效', del.ok === true && del.left === 3],
  ['无控制台错误', errors.length === 0]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name);
  if (!pass) ok = false;
}
if (!ok) {
  console.log('\n--- 详情 ---');
  console.log(JSON.stringify({ out, todayCard, dialog, lunarPreview, del, errors: errors.slice(0, 5) }, null, 2));
}
await b.close();
process.exit(ok ? 0 : 1);
