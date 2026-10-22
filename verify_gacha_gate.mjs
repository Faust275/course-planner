import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:8137/index.html';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.Store && window.Store.gachaEnabled);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
}

const r = await p.evaluate(() => {
  const out = {};
  out.defaultEnabled = Store.gachaEnabled();

  // 开启抽卡
  Store.setGachaEnabled(true);
  out.afterOn = Store.gachaEnabled();
  Store.pomodoro.mode = 'forest';
  Store.setRewardMode('gacha');
  out.modeAfterEnable = Store.pomodoro.mode;

  // 关闭抽卡：模式强制回森林，且不能再切到 gacha
  Store.setGachaEnabled(false);
  out.afterOff = Store.gachaEnabled();
  const rejected = Store.setRewardMode('gacha');
  out.rejectedMode = Store.pomodoro.mode;
  out.rejectReturn = rejected;

  // 关闭抽卡时 defaultState 类行为：setRewardMode('gacha') 返回 forest
  out.forestKept = (Store.pomodoro.mode === 'forest');
  return out;
});

console.log('抽卡开发者开关逻辑：');
check('默认关闭（仅种树）', r.defaultEnabled === false, r);
check('输入「明日方舟」后可开启', r.afterOn === true, r);
check('开启后切到抽卡模式成功', r.modeAfterEnable === 'gacha', r);
check('关闭后 gachaEnabled=false', r.afterOff === false, r);
check('关闭后再次请求 gacha 被拒绝（仍为 forest）', r.forestKept === true && r.rejectReturn === 'forest', r);

// DOM 层：关闭抽卡时 collection 不应出现「干员图鉴」tab；开启后出现
await p.evaluate(() => { Store.setGachaEnabled(false); });
await p.evaluate(() => { App.go('collection'); });
await p.waitForTimeout(150);
const offTabs = await p.evaluate(() => {
  return Array.from(document.querySelectorAll('#view-collection .cp-gacha-tab'))
    .map(n => n.textContent);
});
check('关闭抽卡：无「干员图鉴」tab', !offTabs.some(t => /干员图鉴/.test(t)), offTabs);

await p.evaluate(() => { Store.setGachaEnabled(true); Store.setRewardMode('gacha'); App.go('today'); App.go('collection'); });
await p.waitForTimeout(150);
const onTabs = await p.evaluate(() => {
  return Array.from(document.querySelectorAll('#view-collection .cp-gacha-tab'))
    .map(n => n.textContent);
});
check('开启抽卡且切到抽卡模式：出现「干员图鉴」tab', onTabs.some(t => /干员图鉴/.test(t)), onTabs);

// 收尾：恢复默认（关闭抽卡）
await p.evaluate(() => { Store.setGachaEnabled(false); });

await b.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
