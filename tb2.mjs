import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:8137/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => { const s = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '跳过'); if (s) s.click(); });
await p.waitForTimeout(300);
await p.evaluate(() => { App.go('calendar'); });
await p.waitForTimeout(700);
await p.locator('.cp-tb-cell').nth(38).click();
await p.waitForTimeout(500);
const info = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  return {
    modal: !!m,
    text: m ? m.innerText.replace(/\n/g, ' | ').slice(0, 300) : 'none',
    segs: [...document.querySelectorAll('.cp-modal .cp-segment button')].map(b => b.textContent.trim())
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
