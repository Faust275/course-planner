// 端到端验证：课表批量导入（粘贴 → 解析预览 → 导入落库）
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8161/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 120)); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => {
  const e = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find(x => x.textContent.trim() === '跳过');
  if (e) e.click();
});
await p.waitForTimeout(500);

// 清空课程，保证计数干净
await p.evaluate(() => {
  const j = JSON.parse(window.Store.exportJSON());
  j.courses = [];
  window.Store.importJSON(JSON.stringify(j));
  window.Store.emit();
});
await p.waitForTimeout(300);

const out = {};

// 1) 打开批量导入弹窗
// 「批量导入」入口挂在课表视图（schedule.js），默认停在今日视图时按钮不存在，必须先导航
await p.evaluate(() => {
  if (window.App && window.App.go) window.App.go('schedule');
});
await p.waitForTimeout(700);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '批量导入');
  btn && btn.click();
});
await p.waitForTimeout(400);
out.dialogOpened = await p.evaluate(() =>
  !!(document.querySelector('#cpBatchPreview') || document.querySelector('.cp-modal, .modal')));

// 2) 粘贴带表头的 TSV
const tsv = [
  '课程名\t教师\t地点\t星期\t节次\t周次',
  '高等数学\t张老师\t教学楼A301\t周一\t1-2节\t1-16周',
  '大学英语\t李老师\t外语楼302\t周三\t3-4节\t1-16周',
  '体育\t王老师\t操场\t周五\t7-8节\t1-16周'
].join('\n');
await p.fill('.cp-textarea', tsv);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '解析并预览');
  btn && btn.click();
});
await p.waitForTimeout(400);

out.previewText = await p.evaluate(() => {
  const h = document.querySelector('#cpBatchPreview');
  return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
});
out.previewRows = await p.evaluate(() =>
  document.querySelectorAll('#cpBatchPreview input').length / 5);

// 3) 点击导入
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('#cpBatchPreview button')]
    .find(x => /导入这\s*\d+\s*门课/.test(x.textContent));
  btn && btn.click();
});
await p.waitForTimeout(900);

out.courses = await p.evaluate(() => {
  const j = JSON.parse(window.Store.exportJSON());
  return (j.courses || []).map(c => ({
    name: c.name, teacher: c.teacher, location: c.location,
    day: c.day, slots: (c.slots || []).map(s => s.day + '/' + s.periodId),
    startWeek: c.startWeek, endWeek: c.endWeek
  }));
});

// 4) 无表头、空格分隔的自由文本
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '批量导入');
  btn && btn.click();
});
await p.waitForTimeout(400);
const plain = [
  '周一 第1-2节 线性代数 陈老师 B201',
  '星期四 5-6节 数据结构 刘老师 机房3号 1-12周'
].join('\n');
await p.fill('.cp-textarea', plain);
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '解析并预览');
  btn && btn.click();
});
await p.waitForTimeout(400);
out.plainPreview = await p.evaluate(() => {
  const h = document.querySelector('#cpBatchPreview');
  return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 100) : null;
});
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('#cpBatchPreview button')]
    .find(x => /导入这\s*\d+\s*门课/.test(x.textContent));
  btn && btn.click();
});
await p.waitForTimeout(900);
out.afterPlain = await p.evaluate(() => {
  const j = JSON.parse(window.Store.exportJSON());
  return (j.courses || []).length;
});

// 5) 缺信息的行要提示跳过
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '批量导入');
  btn && btn.click();
});
await p.waitForTimeout(400);
await p.fill('.cp-textarea', '高等数学\n随便写一行没星期的课');
await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '解析并预览');
  btn && btn.click();
});
await p.waitForTimeout(400);
out.badPreview = await p.evaluate(() => {
  const h = document.querySelector('#cpBatchPreview');
  return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : null;
});
await p.keyboard.press('Escape');

out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await b.close();
process.exit(errs.length ? 1 : 0);
