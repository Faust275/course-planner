// Playwright 端到端：截图 → 候选清单 → 勾选/改标题 → 批量添加
// OCR 用 mock 返回固定词，避免依赖外部模型下载；覆盖 UI 全链路与写库结果。
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

// 自造上传用的 fixture：OCR 在下面被 mock 掉，图片内容不重要，但文件必须存在。
// 原先直接写死 /tmp/shot-test.png，那台机器上有就过、CI 上没有就 ENOENT。
const SHOT = path.join(os.tmpdir(), 'shot-test.png');
writeFileSync(SHOT, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
));

const URL = process.env.URL || 'http://localhost:8303/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
await p.waitForTimeout(400);
await p.evaluate(() => App.go('tasks'));
await p.waitForTimeout(500);

const before = await p.evaluate(() => Store.tasks.length);

/* ---- 1. 入口 ---- */
const shotBtn = p.locator('.cp-quick-task-bar button[title*="截图"]');
const btnCount = await shotBtn.count();
check('待办页快速添加条有截图按钮', btnCount === 1, btnCount);
if (btnCount !== 1) {
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(1);
}
await shotBtn.click();
await p.waitForTimeout(400);

const pageOverflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('加了按钮后待办页无横向溢出', pageOverflow <= 1, pageOverflow);

const dlg = p.locator('.cp-shot');
check('弹出截图待办对话框', await dlg.count() === 1, await dlg.count());
const txt = await dlg.textContent();
check('说明里讲清「不直接写入」', /勾选并确认后才写入/.test(txt), txt.slice(0, 60));

/* ---- 2. 选图 → 预览 ---- */
await dlg.locator('input[type=file]').first().setInputFiles(SHOT);
await p.waitForTimeout(400);
check('选中后有预览图', await dlg.locator('.cp-ocr-preview img').count() === 1);

/* ---- 3. 云端未配置时不可用 ---- */
await dlg.locator('.cp-segment button').filter({ hasText: '云端识别' }).first().click();
await p.waitForTimeout(300);
const hint = await dlg.textContent();
check('未配云端时给出引导', /设置 → 图片识别/.test(hint), hint.slice(-80));
const runBtn = dlg.locator('.cp-ocr-actions .cp-btn-primary').first();
check('未配云端时识别按钮禁用', await runBtn.isDisabled());

/* ---- 4. 本地识别（mock）→ 候选清单 ---- */
await dlg.locator('.cp-segment button').filter({ hasText: '本地识别' }).first().click();
await p.waitForTimeout(250);
await p.evaluate(() => {
  const mk = (text, cx, cy) => ({ text, cx, cy, x0: cx - 10, x1: cx + 10, y0: cy - 6, y1: cy + 6 });
  Ocr.recognizeLocal = () => Promise.resolve({
    words: [
      mk('10月25日', 40, 100), mk('截止报名', 100, 100), mk('程序设计竞赛', 180, 100),
      mk('10:45', 40, 140), mk('返回', 300, 40),
      mk('11月2日', 40, 180), mk('14:00', 110, 180), mk('提交实验报告', 200, 180)
    ],
    lines: {}
  });
});
await runBtn.click();
await p.waitForTimeout(600);

const rows = dlg.locator('.cp-shot-row');
const rowCount = await rows.count();
check('候选清单出现 2 条（噪声行被挡掉）', rowCount === 2, rowCount);
const titles = await dlg.locator('.cp-shot-title').evaluateAll(ns => ns.map(n => n.value));
check('日期从标题里剥离', titles[0].indexOf('10月25日') < 0, titles);
check('标题保留事项本身', /截止报名/.test(titles[0]), titles[0]);

/* ---- 5. 取消一条 + 改标题 → 添加 ---- */
await rows.nth(1).locator('input[type=checkbox]').uncheck();
await p.waitForTimeout(200);
const addText = await dlg.locator('.cp-ocr-actions .cp-btn-primary').first().textContent();
check('按钮实时显示选中条数', /添加选中 1 条/.test(addText), addText);

const titleInput = rows.nth(0).locator('.cp-shot-title');
await titleInput.fill('报名程序设计竞赛');
await p.waitForTimeout(150);
await dlg.locator('.cp-ocr-actions .cp-btn-primary').first().click();
await p.waitForTimeout(600);

const after = await p.evaluate(() => Store.tasks.length);
check('只新增 1 条', after === before + 1, { before, after });
const added = await p.evaluate(() => {
  const t = Store.tasks[Store.tasks.length - 1];
  return { title: t.title, dueDate: t.dueDate, status: t.status };
});
check('标题用改后的值', added.title === '报名程序设计竞赛', added);
check('日期写入 2026-10-25', added.dueDate === '2026-10-25', added);
check('状态是待办', added.status === 'todo', added);
check('对话框已关闭', await p.locator('.cp-shot').count() === 0);

check('无 JS 报错', errors.length === 0, errors);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
await b.close();
process.exit(fail ? 1 : 0);
