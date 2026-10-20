import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8141/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: ' + m.text().slice(0,110)); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => {
  const el = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find(e => e.textContent.trim() === '跳过');
  if (el) el.click();
});
await p.waitForTimeout(500);

// 造点数据
await p.evaluate(() => {
  const S = window.Store; const st = JSON.parse(S.exportJSON());
  st.courses = Array.from({length:10},(_,i)=>({id:'c'+i,name:'课程名称'+i,day:i%5,start:1,span:2,weeks:[1,16]}));
  st.tasks = Array.from({length:30},(_,i)=>({id:'t'+i,title:'任务标题'+i,done:false}));
  S.importJSON(JSON.stringify(st)); S.emit();
});
await p.waitForTimeout(400);

// 打开 设置 -> 数据管理 -> 生成同步码
await p.evaluate(() => {
  const nav = [...document.querySelectorAll('#nav > *')].find(n => n.textContent.trim() === '设置');
  if (nav) nav.click();
});
await p.waitForTimeout(600);
const opened = await p.evaluate(() => {
  const items = [...document.querySelectorAll('*')].filter(e =>
    e.children.length === 0 && e.textContent.trim() === '数据管理');
  if (!items.length) return false; items[0].click(); return true;
});
await p.waitForTimeout(600);
const gen = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.includes('生成同步码'));
  if (!btn) return false; btn.click(); return true;
});
await p.waitForTimeout(900);

// 读取弹窗状态
async function readState() {
  return await p.evaluate(() => {
    const chips = [...document.querySelectorAll('.cp-tag-chip')].filter(c => ['精简','标准','完整'].includes(c.textContent.trim()));
    const ta = document.querySelector('textarea.sync-code') || [...document.querySelectorAll('textarea')].pop();
    const tip = [...document.querySelectorAll('.cp-ocr-hint')].map(e=>e.textContent).find(t=>t.includes('大小约')) || '';
    return {
      chips: chips.map(c => ({ text: c.textContent.trim(), active: c.classList.contains('cp-active') })),
      codeLen: ta ? ta.value.length : -1,
      tip: tip.slice(0, 60),
    };
  });
}
const s0 = await readState();
// 点「精简」
await p.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-tag-chip')].find(x => x.textContent.trim() === '精简');
  if (c) c.click();
});
await p.waitForTimeout(900);
const s1 = await readState();
// 点「完整」
await p.evaluate(() => {
  const c = [...document.querySelectorAll('.cp-tag-chip')].find(x => x.textContent.trim() === '完整');
  if (c) c.click();
});
await p.waitForTimeout(900);
const s2 = await readState();

console.log(JSON.stringify({ opened, gen, default: s0, lite: s1, full: s2, errors: errs.slice(0,6) }, null, 2));
await b.close();
