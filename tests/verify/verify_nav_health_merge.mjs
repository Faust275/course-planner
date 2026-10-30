// e2e：课表顶栏按钮分组 + 健康系统总开关 + 健康/活动合并
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ok = [];
const check = (name, pass, extra) => ok.push([name, !!pass, extra]);

/* 「装完先问一句」只在装好的环境里弹（安卓壳 / 装到桌面的 PWA），
   浏览器标签页里刻意不问 —— 这里模拟安卓壳，否则断言不成立。 */
await page.addInitScript(() => {
  window.Capacitor = { Plugins: {}, platform: 'android' };
});

await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await page.waitForTimeout(500);

/* ---------- 1) 新手教程结束 → 健康看板首次询问 ---------- */
await page.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await page.waitForTimeout(700);

const askModal = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.cp-modal')].pop();
  if (!m) return null;
  return {
    text: m.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
    hasOpen: !!m.querySelector('button.cp-btn-primary')
  };
});
check('装完弹出「要不要开启健康看板」', askModal && /健康看板/.test(askModal.text), askModal && askModal.text);

const beforeAnswer = await page.evaluate(() => ({
  asked: Store.healthAsked(),
  enabled: Store.healthEnabled(),
  navHealth: !!document.querySelector('#nav-health')
}));
check('回答前：asked=false', beforeAnswer.asked === false);
check('回答前：默认不开启', beforeAnswer.enabled === false);
check('回答前：导航里没有健康', beforeAnswer.navHealth === false);

/* ---------- 2) 选「先不用」→ 隐藏但深链接仍可达 ---------- */
await page.evaluate(() => {
  const m = [...document.querySelectorAll('.cp-modal')].pop();
  const b = [...m.querySelectorAll('button')].find((x) => x.textContent.trim() === '先不用');
  b.click();
});
await page.waitForTimeout(400);
const afterNo = await page.evaluate(() => ({
  asked: Store.healthAsked(),
  enabled: Store.healthEnabled(),
  navHealth: !!document.querySelector('#nav-health'),
  modalLeft: !!document.querySelector('.cp-modal')
}));
check('选「先不用」记下已问过', afterNo.asked === true);
check('选「先不用」后仍关闭', afterNo.enabled === false);
check('选「先不用」导航无健康入口', afterNo.navHealth === false);
check('弹窗已关闭', afterNo.modalLeft === false);

// 深链接 #/health 在关闭状态下也要能进（不把书签弄坏）
await page.evaluate(() => App.go('health'));
await page.waitForTimeout(400);
const deepLinkWhenOff = await page.evaluate(() => !!document.querySelector('#view-health'));
check('关闭状态下 #/health 深链接仍可进', deepLinkWhenOff === true);

/* ---------- 3) 开启后：导航出现 + 两个分页 ---------- */
await page.evaluate(() => { Store.setHealthOn(true); App.rebuildNav(); App.go('health'); });
await page.waitForTimeout(400);
const afterOn = await page.evaluate(() => {
  const v = document.querySelector('#view-health');
  return {
    navHealth: !!document.querySelector('#nav-health'),
    tabs: v ? [...v.querySelectorAll('.cp-pane-tab')].map((b) => b.textContent.trim()) : [],
    cards: v ? v.querySelectorAll('.cp-card').length : 0,
    activityNav: !!document.querySelector('#nav-activity')
  };
});
check('开启后导航出现健康', afterOn.navHealth === true);
check('活动不再是独立导航项', afterOn.activityNav === false);
check('健康页有 概览 / 活动 两个分页', afterOn.tabs.length >= 2 && afterOn.tabs[1].includes('活动'), afterOn.tabs.join('|'));
check('概览分页有卡片', afterOn.cards > 4, afterOn.cards);

/* ---------- 4) 切到「活动」分页，原活动页功能还在 ---------- */
await page.evaluate(() => {
  const v = document.querySelector('#view-health');
  const b = [...v.querySelectorAll('.cp-pane-tab')].find((x) => x.textContent.includes('活动'));
  b.click();
});
await page.waitForTimeout(500);
const actTab = await page.evaluate(() => {
  const pane = document.querySelector('#activityPane');
  return {
    pane: !!pane,
    text: pane ? pane.innerText.replace(/\s+/g, ' ').slice(0, 80) : '',
    hasHero: pane ? /今日活动/.test(pane.innerText) : false,
    actions: [...document.querySelectorAll('#viewActions button')].map((b) => b.textContent.trim())
  };
});
check('活动分页已挂载', actTab.pane === true);
check('活动分页有「今日活动」卡', actTab.hasHero === true);
check('活动分页操作区是 手动记录 / 同步', actTab.actions.join('|') === '手动记录|同步', actTab.actions.join('|'));

/* ---------- 5) 旧深链接 #/activity 落到健康的活动分页 ---------- */
await page.evaluate(() => { location.hash = '#/activity'; });
await page.waitForTimeout(500);
const alias = await page.evaluate(() => ({
  current: App.currentId,
  tab: App.current && App.current.getTab ? App.current.getTab() : null,
  pane: !!document.querySelector('#activityPane'),
  hash: location.hash
}));
check('#/activity 别名落到 health', alias.current === 'health', alias.current);
check('#/activity 落在活动分页', alias.tab === 'activity' && alias.pane === true, alias.hash);

/* ---------- 6) 课表顶栏：3 个分组，月历交给分区胶囊 ---------- */
await page.evaluate(() => App.go('schedule'));
await page.waitForTimeout(600);
const bar = await page.evaluate(() => {
  const host = document.querySelector('#viewActions');
  const menus = [...host.querySelectorAll('.cp-menu-wrap')];
  return {
    menus: menus.length,
    triggerLabels: menus.map((m) => m.querySelector('button').textContent.trim()),
    plainButtons: [...host.querySelectorAll(':scope > button')].map((b) => b.textContent.trim()),
    // 原 8 个动作的文案必须都还在 DOM 里（菜单收起时也渲染）
    all: [...document.querySelectorAll('button')].map((b) => b.textContent.trim())
  };
});
check('顶栏收成 3 个分组', bar.menus === 3, bar.triggerLabels.join('|'));
check('不再有重复的「月历」独立按钮', bar.plainButtons.length === 0, bar.plainButtons.join('|'));
const need = ['按节次添加', '导入课表', '批量导入', '导出日历', '二维码分享', '导出图片', '导出空档', '自定义添加'];
check('原有动作文案都在 DOM 里（月历改由分区胶囊承担）', need.every((n) => bar.all.includes(n)), bar.all.join('|'));

/* 展开「导出与分享」分组 → 面板可见 */
await page.evaluate(() => {
  const menus = [...document.querySelectorAll('#viewActions .cp-menu-wrap')];
  const m = menus.find((x) => x.querySelector('button').textContent.includes('导出与分享'));
  m.querySelector('button').click();
});
await page.waitForTimeout(250);
const opened = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.cp-menu')].find((x) => x.style.display === 'block');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    items: [...p.querySelectorAll('.cp-menu-item')].map((b) => b.textContent.trim()),
    inView: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 1,
    notClipped: r.height > 20
  };
});
check('点分组能展开面板', !!opened);
check('面板里是导出与分享四项（含导出空档）', opened && opened.items.join('|') === '导出图片|导出日历|导出空档|二维码分享', opened && opened.items.join('|'));
check('面板未被顶栏裁切（挂 body + fixed）', opened && opened.inView && opened.notClipped);

/* 「按节次添加」仍能进选择模式，并把标签改成「退出选择」 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '按节次添加');
  if (b) b.click();
});
await page.waitForTimeout(500);
const pick = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
  on: !!document.querySelector('#viewActions .cp-menu-wrap button.cp-btn-on')
}));
check('按节次添加进入选择模式', pick.labels.includes('退出选择'), pick.labels.join('|'));
check('选择模式下分组按钮高亮', pick.on === true);

/* 退出选择模式，回到干净状态 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '退出选择');
  if (b) b.click();
});
await page.waitForTimeout(400);

/* 点「导出日历」→ 弹窗打开（菜单项常驻 DOM，不需要先展开） */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '导出日历');
  if (b) b.click();
});
await page.waitForTimeout(500);
const dlg = await page.evaluate(() => {
  const m = document.querySelector('.cp-modal');
  return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 40) : null;
});
check('导出日历弹窗能打开', !!dlg, dlg);

/* ---------- 7) 老档迁移：已有睡眠数据 → 自动算作已开启 ---------- */
const mig = await page.evaluate(async () => {
  await Store.init();   // 重新 ensure 一遍（当前档已有 healthOn，走 else 分支）
  const keep = { ...Store.state.settings.healthOn };
  delete Store.state.settings.healthOn;
  Store.state.sleeps = [{ id: 's1', date: '2026-10-20', start: '23:00', end: '07:00', total: 480 }];
  Store.ensure();
  return { migrated: Store.state.settings.healthOn, before: keep };
});
check('老档有睡眠数据 → 自动开启且标记已问过',
  mig.migrated && mig.migrated.enabled === true && mig.migrated.asked === true,
  JSON.stringify(mig.migrated));

/* ---------- 8) 浏览器标签页里不弹（只在装好的环境问） ---------- */
const plain = await browser.newPage({ viewport: { width: 480, height: 1000 } });
await plain.goto(base + '/index.html', { waitUntil: 'load' });
await plain.waitForFunction(() => window.Store && window.App, null, { timeout: 8000 });
await plain.evaluate(() => {
  const s = document.querySelector('.ob-skip') ||
    [...document.querySelectorAll('button,div,span,a')].find((e) => e.textContent.trim() === '跳过');
  if (s) s.click();
});
await plain.waitForTimeout(1600);
const plainState = await plain.evaluate(() => ({
  modal: !!document.querySelector('.cp-modal'),
  asked: Store.healthAsked()
}));
check('浏览器标签页不弹询问', plainState.modal === false);
check('浏览器标签页不算问过（下次装了再问）', plainState.asked === false);
await plain.close();

let fail = 0;
for (const [name, pass, extra] of ok) {
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '  → ' + (extra === undefined ? '' : extra)));
  if (!pass) fail++;
}
if (errors.length) {
  console.log('页面错误:');
  errors.slice(0, 5).forEach((e) => console.log('  ' + e.split('\n')[0]));
  fail++;
}

await browser.close();
close();
console.log(fail ? `\nHAS FAILURE (${fail})` : '\nALL PASS');
process.exit(fail ? 1 : 0);
