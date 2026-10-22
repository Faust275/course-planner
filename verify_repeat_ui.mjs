// Playwright 端到端：重复任务的「第一档」文案
// 覆盖：日期标签随是否重复切换、按周几生成人话摘要、间隔单位、
//       没日期时拦截保存、列表 chip 显示规则与日期、编辑态标签
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8183/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/** 关掉所有弹窗（首次建待办会弹「子任务是这么工作的」提示） */
async function closeModals() {
  await p.evaluate(() => {
    document.querySelectorAll('.cp-modal-wrap').forEach(function (w) {
      const btn = [...w.querySelectorAll('button')].find(x => /知道了|关闭|取消/.test(x.textContent));
      if (btn) btn.click();
    });
  });
  await p.waitForTimeout(500);
}

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(400);
await p.evaluate(() => App.go('tasks'));

/* ---------- 新建：默认 + 选每周 ---------- */
await p.evaluate(() => TaskDialog.open());
await p.waitForTimeout(400);

const initial = await p.evaluate(() => {
  const w = document.querySelector('.cp-modal-wrap');
  return [...w.querySelectorAll('label')].map(x => x.textContent.trim());
});
check('不重复时日期标签是「截止日期」', initial.indexOf('截止日期') >= 0, initial);

const weekly = await p.evaluate(() => {
  const w = document.querySelector('.cp-modal-wrap');
  const sel = [...w.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'weekly'));
  sel.value = 'weekly';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const labels = [...w.querySelectorAll('label')].map(x => x.textContent.trim());
  const lines = w.innerText.split('\n').map(x => x.trim()).filter(Boolean);
  const spans = [...w.querySelectorAll('span')].map(x => x.textContent.trim());
  return {
    labels,
    summary: lines.find(t => /一次，从/.test(t)) || '',
    hasEveryLabel: spans.indexOf('间隔') >= 0,
    hasWeekUnit: spans.indexOf('周') >= 0,
    hasCycleWord: w.innerText.indexOf('周期') >= 0
  };
});
check('选每周后标签变「第一次的日期」', weekly.labels.indexOf('第一次的日期') >= 0, weekly.labels);
check('摘要按周几描述', /^每周[一二三四五六日]一次，从 \d+ 月 \d+ 日（周[一二三四五六日]）开始/.test(weekly.summary), weekly.summary);
check('摘要说明没有结束日期', /没有结束日期。$/.test(weekly.summary), weekly.summary);
check('间隔单位显示为「周」而不是「周期」', weekly.hasEveryLabel && weekly.hasWeekUnit && !weekly.hasCycleWord, weekly);

/* ---------- 没有日期时拦截保存 ---------- */
const noDate = await p.evaluate(() => {
  const w = document.querySelector('.cp-modal-wrap');
  const date = [...w.querySelectorAll('input[type=date]')][0];
  date.value = '';
  date.dispatchEvent(new Event('change', { bubbles: true }));
  const title = [...w.querySelectorAll('input')].find(i => /例如/.test(i.placeholder || ''));
  title.value = '文案测试';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  const lines = w.innerText.split('\n').map(x => x.trim()).filter(Boolean);
  return { warn: lines.find(t => /还没选日期/.test(t)) || '' };
});
check('清空日期后摘要提示不会生成下一期', /还没选日期/.test(noDate.warn), noDate.warn);

await p.evaluate(() => {
  const w = document.querySelector('.cp-modal-wrap');
  [...w.querySelectorAll('button')].find(x => x.textContent.trim() === '保存').click();
});
await p.waitForTimeout(450);
const blocked = await p.evaluate(() => ({
  open: !!document.querySelector('.cp-modal-wrap'),
  toast: (document.querySelector('#toastRoot') || {}).innerText || ''
}));
check('无日期时保存被拦截，弹窗仍打开', blocked.open === true, blocked);
check('拦截提示说明需要第一期日期', /重复任务需要先定第一期日期/.test(blocked.toast), blocked.toast);

/* ---------- 补回日期后保存，检查列表 chip ---------- */
await p.evaluate(() => {
  const w = document.querySelector('.cp-modal-wrap');
  const date = [...w.querySelectorAll('input[type=date]')][0];
  date.value = DateUtil.toStr(new Date());
  date.dispatchEvent(new Event('change', { bubbles: true }));
  [...w.querySelectorAll('button')].find(x => x.textContent.trim() === '保存').click();
});
await p.waitForTimeout(700);
await closeModals();

const row = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-rec^="task:"]')];
  const hit = rows.find(r => /↻/.test(r.textContent) && /文案测试/.test(r.textContent));
  if (!hit) return { exists: false };
  const chip = hit.querySelector('.cp-chip[title]');
  return {
    exists: true,
    text: hit.innerText.replace(/\s+/g, ' ').trim(),
    title: chip ? chip.title : ''
  };
});
check('保存后列表出现该重复任务', row.exists === true, row);
check('chip 显示「每周X · M.D」', /↻ 每周[一二三四五六日] · \d+\.\d+/.test(row.text), row.text);
check('chip 的 title 是完整规则', /一次，从 .*开始，没有结束日期。$/.test(row.title), row.title);

/* ---------- 编辑态：标签变成「这一期的日期」 ---------- */
const opened = await p.evaluate(() => {
  const t = Store.tasks.find(x => x.title === '文案测试');
  if (!t) return { err: 'no task' };
  TaskDialog.open(t.id);
  return { id: t.id, modals: document.querySelectorAll('.cp-modal-wrap').length };
});
await p.waitForTimeout(450);
const editLabels = await p.evaluate(() => {
  const all = [...document.querySelectorAll('.cp-modal-wrap')];
  const w = all[all.length - 1];
  return w ? [...w.querySelectorAll('label')].map(x => x.textContent.trim()) : [];
});
check('编辑弹窗能打开', opened.modals >= 1 && editLabels.length > 0, opened);
check('编辑重复任务时标签是「这一期的日期」', editLabels.indexOf('这一期的日期') >= 0, editLabels);

const off = await p.evaluate(() => {
  const all = [...document.querySelectorAll('.cp-modal-wrap')];
  const w = all[all.length - 1];
  const sel = [...w.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'weekly'));
  sel.value = 'none';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    labels: [...w.querySelectorAll('label')].map(x => x.textContent.trim()),
    text: w.innerText
  };
});
check('改回不重复后标签恢复「截止日期」', off.labels.indexOf('截止日期') >= 0, off.labels);
check('不重复时隐藏间隔与结束日期', !/间隔/.test(off.text) && !/最后一次/.test(off.text), off.text.slice(0, 120));

check('无控制台报错', errors.length === 0, errors.slice(0, 3));

await b.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
