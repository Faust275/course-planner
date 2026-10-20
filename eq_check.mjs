import { chromium } from 'playwright';

const A_URL = process.env.A || 'http://localhost:8138/index.html';  // 工作区成品
const B_URL = process.env.B || 'http://localhost:8137/index.html';  // 构建产物

const PROPS = ['display','position','color','backgroundColor','backgroundImage','fontSize',
  'fontWeight','paddingTop','paddingLeft','marginTop','marginLeft','borderRadius','width',
  'height','flexDirection','alignItems','justifyContent','gap','boxShadow','opacity',
  'lineHeight','textAlign','gridTemplateColumns','borderTopWidth','borderTopColor','overflow'];

const VIEWS = ['今日','课程表','日程','象限','日历','待办','专注','收集','计划','记账','成绩','设置'];

const browser = await chromium.launch();

async function prep(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const skip = await page.$('.ob-skip');
  if (skip) { try { await skip.click(); } catch {} await page.waitForTimeout(300); }
  else {
    // 兜底：尝试按文本找「跳过」
    const s2 = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,div,span,a')]
        .find(e => e.textContent.trim() === '跳过');
      if (el) { el.click(); return true; } return false;
    });
    if (s2) await page.waitForTimeout(300);
  }
  // 引导跳过会弹一条 toast；等它自然消失，避免把瞬时提示误判为样式差异
  await page.waitForFunction(() => {
    const r = document.getElementById('toastRoot');
    return !r || (r.children.length === 0 && !r.textContent.trim());
  }, null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(200);
}

async function goView(page, label) {
  const ok = await page.evaluate((label) => {
    const items = [...document.querySelectorAll('#nav > *')];
    const it = items.find(n => n.textContent.trim() === label);
    if (!it) return false;
    it.click(); return true;
  }, label);
  if (ok) await page.waitForTimeout(500);
  return ok;
}

// 扫描 DOM：对每个出现的类名，取第一个元素的全部计算样式
async function snapshot(page) {
  return await page.evaluate((PROPS) => {
    const out = {};
    document.querySelectorAll('*').forEach((el) => {
      const cl = el.classList;
      if (!cl || !cl.length) return;
      const cs = getComputedStyle(el);
      for (const c of cl) {
        if (out[c]) continue;            // 每个类名只取首个元素，保证两侧可比
        const o = {};
        for (const p of PROPS) o[p] = cs[p];
        out[c] = o;
      }
    });
    return out;
  }, PROPS);
}

const pa = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const pb = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
pa.on('pageerror', e => errs.push('A:' + e.message));
pb.on('pageerror', e => errs.push('B:' + e.message));

await prep(pa, A_URL);
await prep(pb, B_URL);

let totalCompared = 0, totalMismatch = 0;
const report = [];

for (const v of VIEWS) {
  await goView(pa, v);
  await goView(pb, v);
  const a = await snapshot(pa);
  const b = await snapshot(pb);
  const ta = await pa.evaluate(() => (document.getElementById('toastRoot')?.textContent || '').trim().slice(0, 80));
  const tb = await pb.evaluate(() => (document.getElementById('toastRoot')?.textContent || '').trim().slice(0, 80));
  const common = Object.keys(a).filter(k => b[k]);
  const onlyA = Object.keys(a).filter(k => !b[k]);
  const onlyB = Object.keys(b).filter(k => !a[k]);
  const mm = [];
  for (const c of common) {
    for (const p of PROPS) {
      if (a[c][p] !== b[c][p]) mm.push(`${c}.${p}: ${a[c][p]} != ${b[c][p]}`);
    }
  }
  totalCompared += common.length;
  totalMismatch += mm.length;
  report.push({
    view: v, compared: common.length, mismatchCount: mm.length,
    onlyInA: onlyA.length, onlyInB: onlyB.length,
    toastA: ta, toastB: tb,
    mismatches: mm.slice(0, 6),
  });
}

await browser.close();
console.log(JSON.stringify({ totalCompared, totalMismatch, report, errors: errs.slice(0, 10) }, null, 2));
