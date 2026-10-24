// e2e：导入备份前先摆出「本机 → 导入后」的对比，而不是干巴巴一句「将覆盖」
import { chromium } from 'playwright';
import { startServer } from './test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(500);

/* ---------- 造本机数据：2 门课 + 3 条记账 + 2 条灵感 ---------- */
await page.evaluate(() => {
  Store.state.courses.length = 0;
  Store.state.ledger.length = 0;
  Store.state.notes.length = 0;
  Store.state.tasks.length = 0;
  Store.state.courses.push(
    { id: 'c1', semesterId: Store.currentSemesterId, name: '高等数学', teacher: '张', location: 'A101', startWeek: 1, endWeek: 16, weekType: 'all', credit: 4 },
    { id: 'c2', semesterId: Store.currentSemesterId, name: '大学英语', teacher: '李', location: 'B202', startWeek: 1, endWeek: 16, weekType: 'all', credit: 2 }
  );
  Store.state.ledger.push(
    { id: 'g1', amount: 12, cat: '吃饭' }, { id: 'g2', amount: 30, cat: '交通' }, { id: 'g3', amount: 5, cat: '零食' }
  );
  Store.state.notes.push({ id: 'n1', text: 'a' }, { id: 'n2', text: 'b' });
  Store.save && Store.save();
  App.go('settings');
});
await page.waitForTimeout(500);

/* ---------- 备份文件：2 门课（其中一门换教室）+ 1 门新课，没有记账/灵感 ---------- */
const backup = {
  version: 3,
  courses: [
    { id: 'x1', semesterId: 'otherSem', name: '高等数学', teacher: '张', location: 'Z999', startWeek: 1, endWeek: 16, weekType: 'all', credit: 4 },
    { id: 'x2', semesterId: 'otherSem', name: '大学英语', teacher: '李', location: 'B202', startWeek: 1, endWeek: 16, weekType: 'all', credit: 2 },
    { id: 'x3', semesterId: 'otherSem', name: '概率论', teacher: '孙', location: 'E101', startWeek: 1, endWeek: 16, weekType: 'all', credit: 2 }
  ],
  tasks: []
};

const clickImport = () => page.evaluate(() => {
  const hit = [...document.querySelectorAll('button')].find((e) => /导入备份/.test(e.textContent));
  if (!hit) return false;
  hit.click();
  return true;
});

// 设置页是三级结构：分类 → 数据管理 → 导入备份。按文本点最近的节点，别点到外层容器
const clickByText = (re) => page.evaluate((src) => {
  const rx = new RegExp(src);
  const cands = [...document.querySelectorAll('button,div,a')].filter((e) => rx.test(e.textContent));
  cands.sort((a, b) => a.textContent.length - b.textContent.length);
  const hit = cands[0];
  if (!hit) return null;
  hit.click();
  return hit.textContent.slice(0, 24);
}, re);
await clickByText('识别与数据');
await page.waitForTimeout(500);
await clickByText('数据管理');
await page.waitForTimeout(600);

let waitChooser = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
const clicked = await clickImport();
const chooser = await waitChooser;

if (!chooser) {
  check('能打开文件选择器', false, '找不到「导入备份」按钮');
} else {
  check('能打开文件选择器', true);
  await chooser.setFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup), 'utf8')
  });
  await page.waitForTimeout(600);

  const panel = await page.evaluate(() => {
    const m = document.querySelector('.cp-modal');
    if (!m) return null;
    const rows = [...m.querySelectorAll('div')]
      .filter((d) => d.children.length === 3 && /^\d+ → \d+$/.test((d.children[1] || {}).textContent || ''))
      .map((d) => d.innerText.replace(/\s+/g, ' ').trim());
    return { text: m.innerText.replace(/\s+/g, ' ').trim(), rows };
  });

  check('弹出对比弹窗', !!panel, panel ? panel.text.slice(0, 40) : 'no modal');
  check('标题写明是「对比」', !!panel && /对比/.test(panel.text));
  check('显示本机与导入后的总条数', !!panel && /本机 \d+ 条/.test(panel.text) && /导入后 \d+ 条/.test(panel.text),
    panel && panel.text.slice(0, 60));
  check('课程行标出新增 1 / 改动 1', !!panel &&
    panel.rows.some((r) => /课程 2 → 3/.test(r) && /\+1/.test(r) && /改 1/.test(r)),
    panel && panel.rows.join(' | '));
  check('记账被标成清空', !!panel && panel.rows.some((r) => /记账 3 → 0/.test(r) && /清空/.test(r)),
    panel && panel.rows.join(' | '));
  check('顶部提示说清有几类会被清空', !!panel && /有 \d+ 类数据会被清空/.test(panel.text));
  check('提示里承诺可回滚（不是以前那句「无法恢复」）', !!panel && /可以回滚/.test(panel.text));
  check('不再出现旧文案「无法恢复」', !!panel && !/无法恢复/.test(panel.text));

  /* ---------- 取消 → 本机数据原样 ---------- */
  await page.evaluate(() => {
    const m = document.querySelector('.cp-modal');
    const btn = m && [...m.querySelectorAll('button')].find((b) => /取消/.test(b.textContent));
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  const afterCancel = await page.evaluate(() => ({
    courses: Store.state.courses.length,
    ledger: Store.state.ledger.length,
    notes: Store.state.notes.length,
    mathLoc: (Store.state.courses.find((c) => c.name === '高等数学') || {}).location
  }));
  check('点取消后课程没变', afterCancel.courses === 2, afterCancel.courses);
  check('点取消后记账没被清空', afterCancel.ledger === 3, afterCancel.ledger);
  check('点取消后教室没被改掉', afterCancel.mathLoc === 'A101', afterCancel.mathLoc);
}

check('全程无 JS 报错', errors.length === 0, errors[0] && errors[0].slice(0, 300));

await browser.close();
close();

const bad = ok.filter((r) => !r[1]);
ok.forEach(([n, p, e]) => console.log((p ? 'PASS: ' : 'FAIL: ') + n + (e === undefined ? '' : '  → ' + e)));
console.log('\n' + (ok.length - bad.length) + '/' + ok.length + ' passed');
if (bad.length) process.exit(1);
