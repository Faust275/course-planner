// Playwright 端到端：桌面与快捷（PWA 深链接）
// 覆盖：hash 路由解析、深链接落地（含 #/diary 别名、非法地址回退）、
//       页面内切换时地址栏同步、手改地址切视图、manifest / shortcuts / 图标、
//       设置页「桌面与快捷」分区与复制链接、file:// 单文件模式下不挂 manifest 且 0 报错
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const BASE = process.env.URL || 'http://localhost:8301/index.html';
const FILE_URL = process.env.FILE_URL ||
  pathToFileURL(new globalThis.URL('./index.html', import.meta.url).pathname).href;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 980 } });
const errors = [];

let ok = 0, bad = 0;
function check(label, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

/** 新开一页（同一 context，localStorage 共享）：深链接必须是真的重新加载 */
async function fresh(hash, url) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto((url || BASE) + (hash || ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const e = document.querySelector('.cp-ob-skip, .ob-skip'); if (e) e.click(); });
  await page.waitForTimeout(450);
  return page;
}

/** 当前界面状态：标题 / 地址 / 高亮导航 / 待办分页 */
function snapshot(page) {
  return page.evaluate(() => {
    const act = document.querySelector('.cp-nav-item.cp-active');
    const pane = document.querySelector('.cp-pane-tab.cp-active');
    return {
      title: (document.querySelector('#viewTitle') || {}).textContent,
      hash: location.hash,
      nav: act ? act.textContent.trim() : null,
      pane: pane ? pane.textContent.trim() : null
    };
  });
}

/* ==========================================================
 * A. 纯函数：parse / build / resolve
 * ========================================================== */
console.log('A. 路由解析');
let p0 = await fresh('');
const A = await p0.evaluate(() => {
  const R = window.Router;
  const ids = window.App.views.map(v => v.id);
  const P = h => R.parse(h);
  return {
    ids,
    today: P('#/today'),
    plain: P('/today'),
    diary: P('#/diary'),
    notes: P('#/notes'),
    insp: P('#/inspiration'),
    sub: P('#/tasks/diary'),
    upper: P('#/tasks/DIARY'),
    slash: P('#/tasks/'),
    empty: P(''),
    hashOnly: P('#'),
    noSlash: P('#today'),
    root: P('#/'),
    b1: R.build('today'),
    b2: R.build('tasks', 'diary'),
    b3: R.build('tasks', null),
    rt: R.parse(R.build('ledger')),
    badResolve: R.resolve('#/nope', ids),
    okResolve: R.resolve('#/diary', ids),
    missResolve: R.resolve('#/today', ['ledger'])
  };
});

check('parse(#/today) → today', A.today && A.today.id === 'today' && !A.today.tab, A.today);
check('parse 允许省略 #（/today）', A.plain && A.plain.id === 'today', A.plain);
check('#/diary 别名 → tasks/diary', A.diary && A.diary.id === 'tasks' && A.diary.tab === 'diary', A.diary);
check('#/notes 别名 → tasks/notes', A.notes && A.notes.id === 'tasks' && A.notes.tab === 'notes', A.notes);
check('#/inspiration 别名 → tasks/notes', A.insp && A.insp.tab === 'notes', A.insp);
check('#/tasks/diary 两段式', A.sub && A.sub.id === 'tasks' && A.sub.tab === 'diary', A.sub);
check('分页大小写不敏感', A.upper && A.upper.tab === 'diary', A.upper);
check('末尾斜杠不产生空分页', A.slash && A.slash.tab === null, A.slash);
check('空地址 → null', A.empty === null);
check('裸 # → null', A.hashOnly === null);
check('没有 #/ 的锚点不接管', A.noSlash === null);
check('#/ → null', A.root === null);
check('build(today)', A.b1 === '#/today', A.b1);
check('build(tasks, diary)', A.b2 === '#/tasks/diary', A.b2);
check('build(tasks, null) 不带尾巴', A.b3 === '#/tasks', A.b3);
check('parse∘build 往返一致', A.rt && A.rt.id === 'ledger' && !A.rt.tab, A.rt);
check('不存在的视图 resolve → null', A.badResolve === null, A.badResolve);
check('别名解析后 id 是真实视图', A.okResolve && A.okResolve.id === 'tasks', A.okResolve);
check('视图列表里没有就拒绝', A.missResolve === null, A.missResolve);

const FIRST = A.ids[0];

/* ==========================================================
 * B. 深链接落地（每次都是真正的重新加载）
 * ========================================================== */
console.log('B. 深链接落地');

let pg = await fresh('#/today');
let s = await snapshot(pg);
check('#/today → 今日页', s.title === '今日' && s.nav === '今日', s);
check('#/today 地址原样保留', s.hash === '#/today', s.hash);
await pg.close();

pg = await fresh('#/tasks/diary');
s = await snapshot(pg);
check('#/tasks/diary → 待办页的日记分页', s.title === '作业与待办' && /日记/.test(s.pane || ''), s);
await pg.close();

pg = await fresh('#/diary');
s = await snapshot(pg);
check('#/diary 别名直接进日记', s.title === '作业与待办' && /日记/.test(s.pane || ''), s);
check('别名进来自动归一成规范地址', s.hash === '#/tasks/diary', s.hash);
await pg.close();

pg = await fresh('#/notes');
s = await snapshot(pg);
check('#/notes 别名进灵感分页', /灵感/.test(s.pane || ''), s);
await pg.close();

pg = await fresh('#/nope');
s = await snapshot(pg);
check('非法地址回退到第一个视图', s.nav === (await pg.evaluate(() => {
  const v = window.App.views[0];
  return v ? v.name : null;
})), s);
check('非法地址被修回合法地址', s.hash === '#/' + FIRST, { hash: s.hash, FIRST });
await pg.close();

pg = await fresh('#/settings/desktop');
s = await pg.evaluate(() => ({
  hash: location.hash,
  head: (document.querySelector('.cp-set-head-title b') || {}).textContent
}));
check('#/settings/desktop 落到设置的二级页', s.head === '桌面与快捷', s);
await pg.close();

/* ==========================================================
 * C. 会话内同步：点导航改地址 / 改地址切视图
 * ========================================================== */
console.log('C. 地址栏同步');
pg = await fresh('');
s = await snapshot(pg);
check('不带地址进来会补上默认视图', s.hash === '#/' + FIRST, s);

await pg.locator('#nav-ledger').click();
await pg.waitForTimeout(400);
s = await snapshot(pg);
check('点导航后地址跟着变', s.hash === '#/ledger', s);

await pg.evaluate(() => { location.hash = '#/quadrant'; });
await pg.waitForTimeout(500);
s = await snapshot(pg);
check('手改地址能切视图', s.nav === '待办' && /象限/.test(s.pane || ''), s);

await pg.evaluate(() => { location.hash = '#/task nope'; });
await pg.waitForTimeout(400);
s = await snapshot(pg);
check('手改错字不会白屏，地址被修回当前页', s.nav === '待办' && s.hash === '#/tasks/quadrant', s);

// 新开一页直接落 #/tasks，验证默认任务分页（同一会话内导航会「记住上次分页」）
pg = await fresh('#/tasks');
s = await snapshot(pg);
check('进待办默认是任务分页', /待办/.test(s.pane || '') && !/灵感|日记/.test(s.pane || ''), s);
check('默认分页不写进地址', s.hash === '#/tasks', s.hash);

await pg.locator('.cp-pane-tab', { hasText: '日记' }).first().click();
await pg.waitForTimeout(450);
s = await snapshot(pg);
check('切到日记分页 → 地址变 #/tasks/diary', s.hash === '#/tasks/diary', s);

await pg.locator('#nav-today').click();
await pg.waitForTimeout(400);
s = await snapshot(pg);
check('换页后地址换成新页', s.hash === '#/today', s);

await pg.locator('#nav-tasks').click();
await pg.waitForTimeout(450);
s = await snapshot(pg);
check('回到待办时保留上次的日记分页', /日记/.test(s.pane || ''), s);
check('保留的分页也写进地址', s.hash === '#/tasks/diary', s.hash);
await pg.close();

/* ==========================================================
 * D. manifest / shortcuts / 图标
 * ========================================================== */
console.log('D. manifest 与图标');
pg = await fresh('#/today');
const D = await pg.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  let mf = null, err = null;
  try {
    const res = await fetch('manifest.webmanifest', { cache: 'no-store' });
    mf = await res.json();
    const heads = await Promise.all(mf.icons.map(async i => {
      const r = await fetch(i.src, { method: 'HEAD' });
      return { src: i.src, ok: r.ok };
    }));
    return { link: link ? link.getAttribute('href') : null, mf, heads, ids: window.App.views.map(v => v.id) };
  } catch (e) { err = String(e); }
  return { link: link ? link.getAttribute('href') : null, err };
});
check('http 下挂上了 manifest link', D.link === 'manifest.webmanifest', D.link);
check('manifest 能取到并解析', !!D.mf && !D.err, D.err);
check('name / short_name 齐全', !!D.mf && !!D.mf.name && !!D.mf.short_name, D.mf && D.mf.name);
check('display 是 standalone', D.mf && D.mf.display === 'standalone', D.mf && D.mf.display);
check('start_url 指向 index.html', D.mf && /index\.html/.test(D.mf.start_url), D.mf && D.mf.start_url);
check('三条快捷方式', D.mf && D.mf.shortcuts && D.mf.shortcuts.length === 3, D.mf && D.mf.shortcuts && D.mf.shortcuts.length);
check('图标都取得到', D.heads && D.heads.every(h => h.ok), D.heads);
const shortOk = await pg.evaluate(async (ids) => {
  const mf = await (await fetch('manifest.webmanifest', { cache: 'no-store' })).json();
  return mf.shortcuts.map(s => {
    const h = '#' + s.url.split('#')[1];
    const r = window.Router.resolve(h, ids);
    return { url: s.url, hash: h, id: r && r.id, tab: r && r.tab };
  });
}, D.ids);
check('快捷方式的地址都能被路由认出来',
  shortOk.length === 3 && shortOk.every(x => !!x.id), shortOk);
check('「今日课表」指向 #/today', shortOk[0] && shortOk[0].hash === '#/today', shortOk[0]);
check('「写日记」指向 #/diary', shortOk[1] && shortOk[1].hash === '#/diary', shortOk[1]);

/* ==========================================================
 * E. 设置页「桌面与快捷」
 * ========================================================== */
console.log('E. 设置页分区');
await pg.evaluate(() => { window.App.go('settings'); });
await pg.waitForTimeout(500);
const E0 = await pg.evaluate(() => {
  const cats = [...document.querySelectorAll('.cp-set-cat')].map(n => n.textContent.replace(/\s+/g, ' ').trim());
  return cats;
});
check('设置首页有「首页与模块」分类', E0.some(t => /首页与模块/.test(t)), E0);

await pg.locator('.cp-set-cat', { hasText: '首页与模块' }).first().click();
await pg.waitForTimeout(350);
const E0b = await pg.evaluate(() =>
  [...document.querySelectorAll('.cp-set-item')].map(n => n.textContent.replace(/\s+/g, ' ').trim()));
check('分类页有「桌面与快捷」入口', E0b.some(t => /桌面与快捷/.test(t)), E0b);

await pg.locator('.cp-set-item', { hasText: '桌面与快捷' }).first().click();
await pg.waitForTimeout(450);
const E = await pg.evaluate(() => {
  const root = document.querySelector('#view-settings');
  const rows = [...root.querySelectorAll('code')].map(c => c.textContent.trim());
  const btns = [...root.querySelectorAll('button')].map(b => b.textContent.trim());
  return {
    head: (document.querySelector('.cp-set-head-title b') || {}).textContent,
    hash: location.hash,
    rows,
    copies: btns.filter(t => t === '复制').length,
    text: root.innerText,
    title: document.querySelector('#viewTitle').textContent
  };
});
check('二级页标题正确', E.head === '桌面与快捷', E.head);
check('进二级页后地址带上是哪个二级页', E.hash === '#/settings/desktop', E.hash);
check('三个直达链接都列出来', E.rows.join(',') === '#/today,#/tasks,#/diary', E.rows);
check('每条都有复制按钮', E.copies === 3, E.copies);
check('讲到长按图标的快捷方式', /长按/.test(E.text) && /今日课表/.test(E.text), E.text.slice(0, 60));
check('http 下提到安装入口而不是「本地文件」限制', /安装/.test(E.text) && !/本地文件（file:\/\/）/.test(E.text));

// 复制链接：授权后读剪贴板，没授权就退化为「有提示」即可
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
await pg.locator('button', { hasText: '复制' }).first().click();
await pg.waitForTimeout(400);
const C = await pg.evaluate(async () => {
  let clip = null;
  try { clip = await navigator.clipboard.readText(); } catch (e) { clip = null; }
  return { clip, toast: !!document.querySelector('.cp-toast') };
});
check('复制出来的是带 #/today 的完整地址',
  (C.clip && /#\/today$/.test(C.clip)) || C.toast, C);
await pg.close();

/* ==========================================================
 * F. file:// 单文件模式
 * ========================================================== */
console.log('F. file:// 单文件');
pg = await fresh('#/today', FILE_URL);
s = await snapshot(pg);
check('file:// 下深链接同样生效', s.title === '今日', s);
check('file:// 下不挂 manifest（避免 404）',
  (await pg.evaluate(() => !document.querySelector('link[rel="manifest"]'))));
await pg.close();

/* ==========================================================
 * 收尾
 * ========================================================== */
// 关掉所有页面后统一收错误（含被关页面上的 pageerror）
const realErrors = errors.filter(e => !/favicon/.test(e));
await b.close();

console.log('');
if (realErrors.length) {
  bad++;
  console.log('  ✗ 控制台 / 页面报错 ' + realErrors.length + ' 条：');
  realErrors.slice(0, 6).forEach(e => console.log('    · ' + e));
} else {
  ok++;
  console.log('  ✓ 无控制台报错');
}
console.log('\n通过 ' + ok + ' 项，失败 ' + bad + ' 项');
process.exit(bad ? 1 : 0);
