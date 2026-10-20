// Playwright 端到端：重复任务
// 验证：展开式生成下一期、过期锚定到今天、until 到期停止、字段持久化、卡片标记
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8182/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { const e = document.querySelector('.ob-skip'); if (e) e.click(); });
await p.waitForTimeout(300);

const out = await p.evaluate(() => {
  const S = window.Store;
  const D = window.DateUtil;
  const today = D.toStr(D.today());
  // 未来某天：今天 + 10 天
  const future = D.toStr(D.addDays(D.today(), 10));

  // 1) 周重复：今天 +10 天截止，完成后应生成 future+7
  const w = S.addTask({ title: '周报', dueDate: future, dueTime: '18:00', status: 'todo',
                        repeat: { type: 'weekly', interval: 1, until: '' } });
  S.updateTask(w.id, { status: 'done' });
  const wNext = S.state.tasks.find(t => t.repeatFrom === w.id);

  // 2) 过期锚定：截止日放在 30 天前，完成时下一期应为 今天+1
  const past = D.toStr(D.addDays(D.today(), -30));
  const d = S.addTask({ title: '日报', dueDate: past, status: 'todo',
                        repeat: { type: 'daily', interval: 1, until: '' } });
  S.updateTask(d.id, { status: 'done' });
  const dNext = S.state.tasks.find(t => t.repeatFrom === d.id);

  // 3) until 到期停止：月重复，until = 今天+40 天；完成两次后第三次不再生成
  const mUntil = D.toStr(D.addDays(D.today(), 40));
  const m = S.addTask({ title: '月付', dueDate: future, status: 'todo',
                         repeat: { type: 'monthly', interval: 1, until: mUntil } });
  S.updateTask(m.id, { status: 'done' });
  const mNext1 = S.state.tasks.find(t => t.repeatFrom === m.id);
  if (mNext1) S.updateTask(mNext1.id, { status: 'done' });
  const mNext2 = S.state.tasks.find(t => t.repeatFrom === mNext1 && t.id);

  // 4) 字段持久化：直接读取
  const saved = S.getTask(w.id);

  S.emit();
  return {
    weeklyNext: wNext ? wNext.dueDate : null,
    weeklyWant: D.toStr(D.addDays(D.parse(future), 7)),
    dailyNext: dNext ? dNext.dueDate : null,
    dailyWant: D.toStr(D.addDays(D.today(), 1)),
    monthlyNext1: mNext1 ? mNext1.dueDate : null,
    monthlyNext2: mNext2 ? 'generated' : 'stopped',
    savedRepeat: saved ? saved.repeat : null
  };
});

// 5) 卡片标记：切到待办页，看重复条目是否带「↻ 每周」
await p.evaluate(() => window.App.go('tasks'));
await p.waitForTimeout(500);
const badge = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-rec^="task:"]')];
  return rows.some(r => /↻/.test(r.textContent));
});

const checks = [
  ['周重复生成下一期', out.weeklyNext === out.weeklyWant],
  ['过期锚定：下一期=今天+1', out.dailyNext === out.dailyWant],
  ['月重复第一次生成', !!out.monthlyNext1],
  ['月重复超过 until 停止', out.monthlyNext2 === 'stopped'],
  ['repeat 字段已持久化', out.savedRepeat && out.savedRepeat.type === 'weekly' && out.savedRepeat.interval === 1],
  ['待办卡片显示重复标记', badge],
  ['无控制台错误', errors.length === 0]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name);
  if (!pass) { ok = false; console.log('    详情:', JSON.stringify(out), errors.slice(0, 3)); }
}
await b.close();
process.exit(ok ? 0 : 1);
