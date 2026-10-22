import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
await p.goto('http://127.0.0.1:8137/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => { const s = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '跳过'); if (s) s.click(); });
await p.waitForTimeout(300);
const r = await p.evaluate(async () => {
  const out = {};
  // 复刻测试前置：加一条 10-21 的手动活动
  Store.addActivity({ date: '2026-10-21', start: '14:00', end: '16:00', name: '刷题', type: 'study', taskId: '' });
  window.App.go('calendar');
  await new Promise(r => setTimeout(r, 700));
  out.view = document.body.innerText.slice(0, 80).replace(/\n/g, '|');
  // 找时间块：测试里怎么找的？
  return out;
});
console.log(JSON.stringify({ r, errs }, null, 2));
await b.close();
