// Playwright 端到端：第三档「自定义重复周期」（多选星期 + 月位置）
// 覆盖：周重复·多选星期、月重复·第几个星期几、月重复·月末最后一天
//       的弹窗配置、保存后列表 chip 的短标签与完整规则 title
// 运行：先起服务 `python3 -m http.server 8183`，再 `URL=http://localhost:8183/index.html node verify_repeat_custom.mjs`
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8183/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1200 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

async function closeModals() {
  await p.evaluate(() => {
    document.querySelectorAll('.cp-modal-wrap').forEach(function (w) {
      const btn = [...w.querySelectorAll('button')].find(x => /知道了|关闭|取消/.test(x.textContent));
      if (btn) btn.click();
    });
  });
  await p.waitForTimeout(400);
}

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);
await p.evaluate(() => App.go('tasks'));

/* ---------- 弹窗辅助：选重复类型 / 月规则 / 第几个 / 星期 / 日期 / 标题 / 保存 ---------- */
async function setType(type) {
  await p.evaluate((t) => {
    const w = document.querySelector('.cp-modal-wrap');
    const sel = [...w.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === t));
    sel.value = t; sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, type);
  await p.waitForTimeout(250);
}
async function setMonthRule(rule) {
  await p.evaluate((r) => {
    const w = document.querySelector('.cp-modal-wrap');
    const sel = [...w.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === r));
    sel.value = r; sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, rule);
  await p.waitForTimeout(200);
}
async function setPos(v) {
  await p.evaluate((val) => {
    const w = document.querySelector('.cp-modal-wrap');
    const sel = [...w.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === val));
    if (sel) { sel.value = val; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, v);
  await p.waitForTimeout(150);
}
async function setWeekdays(list) {
  await p.evaluate((wanted) => {
    const w = document.querySelector('.cp-modal-wrap');
    // 当前可见的星期选择器（周重复 or 月位置二选一显示）
    const pick = [...w.querySelectorAll('.cp-chip-pick.cp-days')].find(p => p.offsetParent !== null);
    [...pick.querySelectorAll('.cp-item')].forEach(it => {
      it.classList.toggle('cp-on', wanted.indexOf(it.textContent.trim()) >= 0);
    });
  }, list);
  await p.waitForTimeout(150);
}
async function setDate(d) {
  await p.evaluate((v) => {
    const w = document.querySelector('.cp-modal-wrap');
    const date = [...w.querySelectorAll('input[type=date]')][0];
    date.value = v; date.dispatchEvent(new Event('change', { bubbles: true }));
  }, d);
  await p.waitForTimeout(150);
}
async function fillTitle(t) {
  await p.evaluate((title) => {
    const w = document.querySelector('.cp-modal-wrap');
    const inp = [...w.querySelectorAll('input')].find(i => /例如/.test(i.placeholder || ''));
    inp.value = title; inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await p.waitForTimeout(120);
}
async function save() {
  await p.evaluate(() => {
    [...document.querySelector('.cp-modal-wrap').querySelectorAll('button')]
      .find(x => x.textContent.trim() === '保存').click();
  });
  await p.waitForTimeout(600);
}
async function lastRow(title) {
  return p.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-rec^="task:"]')];
    const hit = rows.filter(r => /↻/.test(r.textContent) && new RegExp(t).test(r.textContent)).pop();
    if (!hit) return { exists: false };
    const chip = hit.querySelector('.cp-chip[title]');
    const rep = (Store.tasks.find(x => x.title === t) || {}).repeat || {};
    return {
      exists: true,
      text: hit.innerText.replace(/\s+/g, ' ').trim(),
      title: chip ? chip.title : '',
      repeat: rep
    };
  }, title);
}

/* ---------- 1) 周重复·多选星期：周一/周三/周五 ---------- */
await p.evaluate(() => TaskDialog.open());
await p.waitForTimeout(400);
await setType('weekly');
await setDate('2099-10-19');              // 周一
await setWeekdays(['周一', '周三', '周五']);
await fillTitle('周多选');
await save();
await closeModals();
const r1 = await lastRow('周多选');
check('周多选：保存后列表出现', r1.exists === true, r1);
check('周多选：数据层 weekdays=[1,3,5]', JSON.stringify((r1.repeat || {}).weekdays) === '[1,3,5]', r1.repeat);
check('周多选：chip 短标签含「周一·周三·周五」', /↻ 周一·周三·周五/.test(r1.text), r1.text);
check('周多选：chip title 含「每周周一、周三、周五一次」', /每周周一、周三、周五一次/.test(r1.title), r1.title);

/* ---------- 2) 月重复·第几个星期几：第 2 个周三 ---------- */
await p.evaluate(() => TaskDialog.open());
await p.waitForTimeout(400);
await setType('monthly');
await setDate('2099-10-15');
await setMonthRule('pos');
await setPos('2');
await setWeekdays(['周三']);              // 月位置用星期选择器
await fillTitle('月位置');
await save();
await closeModals();
const r2 = await lastRow('月位置');
check('月位置：保存后列表出现', r2.exists === true, r2);
check('月位置：数据层 monthRule=pos/pos=2/wd=3',
  (r2.repeat || {}).monthRule === 'pos' && (r2.repeat || {}).pos === 2 && (r2.repeat || {}).wd === 3, r2.repeat);
check('月位置：chip 短标签「每月第2周三」', /↻ 每月第2周三/.test(r2.text), r2.text);
check('月位置：chip title 含「每月第 2 个周三一次」', /每月第 2 个周三一次/.test(r2.title), r2.title);

/* ---------- 3) 月重复·月末最后一天 ---------- */
await p.evaluate(() => TaskDialog.open());
await p.waitForTimeout(400);
await setType('monthly');
await setDate('2099-10-15');
await setMonthRule('lastday');
await fillTitle('月末');
await save();
await closeModals();
const r3 = await lastRow('月末');
check('月末：保存后列表出现', r3.exists === true, r3);
check('月末：数据层 monthRule=lastday', (r3.repeat || {}).monthRule === 'lastday', r3.repeat);
check('月末：chip 短标签「每月末」', /↻ 每月末/.test(r3.text), r3.text);
check('月末：chip title 含「每月最后一天一次」', /每月最后一天一次/.test(r3.title), r3.title);

check('无控制台报错', errors.length === 0, errors.slice(0, 3));

await b.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
