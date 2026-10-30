// 验证 save-file.js 的「picker/分享被取消或自动 Abort 时回落兜底」修复。
// 场景：浏览器存在 showSaveFilePicker（如桌面 Chrome / 本地 file:// 打开），
// 但调用即被浏览器 AbortError（非用户主动取消）。旧逻辑会回报「已取消」且无兜底；
// 新逻辑应回落到下载 + 复制兜底面板，保证用户能拿到文件。
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:8137/index.html';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

const b = await chromium.launch();
const p = await b.newPage();
const pageErrors = [];
p.on('pageerror', e => pageErrors.push(String(e)));

// 关键：把 navigator.webdriver 改成 false（否则自动化环境会跳过 picker 直接走下载，
// 测不到 picker 被 Abort 的回落路径），并让 showSaveFilePicker 调用即抛 AbortError。
await p.addInitScript(() => {
  Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', { get: () => false });
  window.showSaveFilePicker = function () {
    return Promise.reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
  };
});

await p.goto(URL, { waitUntil: 'networkidle' });

// 确认环境确实进入了 picker 分支（showSaveFilePicker 存在、webdriver 已被覆盖为 false）
const env = await p.evaluate(() => ({
  hasPicker: typeof window.showSaveFilePicker === 'function',
  webdriver: navigator.webdriver
}));
check('测试环境进入 picker 分支（showSaveFilePicker 存在且 webdriver=false）',
  env.hasPicker && env.webdriver === false, env);

// 调用 SaveFile.save，模拟 picker 被 Abort
const result = await p.evaluate(() => window.SaveFile.save(
  '课表备份-test.json', '{"hello":"world"}',
  { mime: 'application/json', ext: 'json', panelTitle: '备份已生成', panelHint: '备份文件包含…' }
));
check('save 成功 resolve（未抛错）', !!result, result);
check('返回 canceled 不为 true（不再「已取消」）', result && result.canceled !== true, result);
check('method 为 download 或 copy-fallback（已回落兜底）',
  result && (result.method === 'download' || result.method === 'copy-fallback'), result && result.method);
check('ok 为 true', result && result.ok === true, result && result.ok);

// 复制兜底面板应当出现（含可复制内容的 textarea）
await p.waitForTimeout(150);
const panel = await p.evaluate(() => {
  const m = document.querySelector('.cp-modal-wrap');
  if (!m) return null;
  const ta = m.querySelector('textarea');
  const title = (m.querySelector('.modal-title, .cp-modal-title') || {}).textContent || '';
  const copyBtn = [...m.querySelectorAll('button')].find(x => /复制内容/.test(x.textContent));
  return { title, hasTextarea: !!ta, taLen: ta ? ta.value.length : 0, hasCopyBtn: !!copyBtn };
});
check('出现兜底面板', !!panel, panel);
check('面板含可复制内容（textarea）', panel && panel.hasTextarea && panel.taLen > 0, panel);
check('面板含「复制内容」按钮', panel && panel.hasCopyBtn, panel);

check('无控制台 pageerror', pageErrors.length === 0, pageErrors);

await b.close();
console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAIL ' + fail) + '  (pass=' + pass + ', fail=' + fail + ')');
process.exit(fail === 0 ? 0 : 1);
