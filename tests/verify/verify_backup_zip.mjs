// e2e：带照片的备份包（zip）——打包、解包、照片写回
import { chromium } from 'playwright';
import { startServer } from '../../test-utils.mjs';

// 用 Python zipfile 以 DEFLATE 压缩生成的包（模拟用户用系统压缩工具重打包过）
const DEFLATE_ZIP_B64 = 'UEsDBBQAAAAIAFqzYl28dIhdKAAAACMAAAALAAAAYmFja3VwLmpzb24BIwDc/3siY29udGVudCI6IuiMhOWtkO+8iOWutuW4uOeCku+8iSJ9UEsDBBQAAAAIAFqzYl2cqUC0CQAAAAcAAAAUAAAAcGhvdG9zL21fZGVmbGF0ZS5qcGf7f+P/A04OdgBQSwECFAAUAAAACABas2JdvHSIXSgAAAAjAAAACwAAAAAAAAAAAAAAgAEAAAAAYmFja3VwLmpzb25QSwECFAAUAAAACABas2JdnKlAtAkAAAAHAAAAFAAAAAAAAAAAAAAAgAFRAAAAcGhvdG9zL21fZGVmbGF0ZS5qcGdQSwUGAAAAAAIAAgB7AAAAjAAAAAAA';

const { base, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

try {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.Store && window.Media && window.Zip && window.BackupPhotos && window.DateUtil,
    null, { timeout: 15000 }
  );
  await page.evaluate(() => document.querySelectorAll('.cp-ob-mask, .ob-mask').forEach((n) => n.remove()));

  // ---------- 造一条带两张照片的饮食记录 ----------
  const seeded = await page.evaluate(async () => {
    const D = window.DateUtil;
    const today = D.toStr(D.today());
    const keys = [];
    for (let i = 0; i < 2; i++) {
      // 造两个内容不同的 JPEG 头，验证字节能原样回来
      const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, i, 10 + i, 100 + i, 200]);
      const k = await window.Media.put(new Blob([bytes], { type: 'image/jpeg' }));
      keys.push(k);
    }
    window.Store.addMeal({
      date: today, time: '12:00', type: 'lunch', content: '备份测试餐', kcal: 420,
      photos: keys.map((k) => ({ k: k, n: '' }))
    });
    return { today: today, keys: keys, meals: window.Store.state.meals.length };
  });
  check('照片已写入媒体库', seeded.keys.length === 2 && seeded.keys.every(Boolean), JSON.stringify(seeded.keys));

  // ---------- 打包 ----------
  const packed = await page.evaluate(async () => {
    const text = window.Store.exportJSON('full', { includeKeys: false });
    const p = await window.BackupPhotos.pack(text);
    window.__zip = p.bytes;            // 留住打包结果，清空照片库后再用它验证
    const entries = await window.Zip.read(p.bytes);
    return {
      count: p.count,
      photoBytes: p.photoBytes,
      total: p.bytes.length,
      looksZip: window.Zip.looksLikeZip(p.bytes),
      names: entries.map((e) => e.name),
      manifest: new TextDecoder().decode(entries[0].bytes),
      // 取一张图的字节做比对
      one: Array.from(entries.find((e) => e.name.indexOf('photos/') === 0).bytes)
    };
  });
  check('打包结果是合法 zip（PK 头）', packed.looksZip === true);
  check('zip 内含 backup.json 与 2 张照片',
    packed.names[0] === 'backup.json' && packed.names.filter((n) => n.indexOf('photos/') === 0).length === 2,
    JSON.stringify(packed.names));
  check('照片文件名用原 key', packed.names.some((n) => n === 'photos/' + seeded.keys[0] + '.jpg'),
    JSON.stringify(packed.names));
  check('backup.json 里带着这条记录', packed.manifest.indexOf('备份测试餐') >= 0, packed.manifest.slice(0, 80));
  check('照片字节与写入时一致', JSON.stringify(packed.one) === JSON.stringify([255, 216, 255, 224, 0, 10, 100, 200]),
    JSON.stringify(packed.one));
  check('照片体积被正确统计', packed.photoBytes === 16, String(packed.photoBytes));

  // ---------- 清空照片库（模拟换设备 / 重装） ----------
  await page.evaluate(() => window.Media.clearAll());
  const afterClear = await page.evaluate(() => window.Media.usage());
  check('清空后媒体库为空', afterClear.count === 0, JSON.stringify(afterClear));

  // ---------- 解包并写回 ----------
  const restored = await page.evaluate(async () => {
    const pack = await window.BackupPhotos.unpack(window.__zip);
    const r = await window.BackupPhotos.restore(pack.photos);
    const usage = await window.Media.usage();
    const url = await window.Media.getUrl(pack.photos[0] && pack.photos[0].key);
    let diffOK = false, diffErr = '';
    try { window.Store.diffImport(pack.json); diffOK = true; } catch (e) { diffErr = String(e && e.message); }
    return {
      jsonHasMeal: pack.json.indexOf('备份测试餐') >= 0,
      photoKeys: pack.photos.map((x) => x.key),
      restored: r.restored, failed: r.failed, unavailable: r.unavailable,
      usage: usage, url: url, diffOK: diffOK, diffErr: diffErr
    };
  });
  check('解包后 backup.json 完整', restored.jsonHasMeal === true);
  check('解包出 2 张照片且 key 未变',
    JSON.stringify(restored.photoKeys.sort()) === JSON.stringify(seeded.keys.slice().sort()),
    JSON.stringify(restored.photoKeys));
  check('照片全部写回媒体库', restored.restored === 2 && restored.failed === 0, JSON.stringify(restored));
  check('媒体库统计恢复到 2 张', restored.usage.count === 2, JSON.stringify(restored.usage));
  check('恢复后能取到可用的 blob URL', typeof restored.url === 'string' && restored.url.indexOf('blob:') === 0, restored.url);
  check('解包出的 JSON 能通过导入体检', restored.diffOK === true, restored.diffErr);

  // ---------- 兼容性：纯 JSON / 空包 ----------
  const compat = await page.evaluate(async () => {
    const text = window.Store.exportJSON('full', {});
    let jsonImportOK = false;
    try { window.Store.diffImport(text); jsonImportOK = true; } catch (e) {}
    const emptyZip = window.Zip.create([]);
    const emptyBack = await window.Zip.read(emptyZip);
    return { jsonImportOK: jsonImportOK, emptyOK: emptyBack.length === 0 };
  });
  check('旧的纯 JSON 备份仍可导入', compat.jsonImportOK === true);
  check('空 zip 解包不报错', compat.emptyOK === true);

  // ---------- 无照片时不应打空包 ----------
  await page.evaluate(() => window.Media.clearAll());
  const noPhoto = await page.evaluate(async () => {
    const text = window.Store.exportJSON('full', {});
    const p = await window.BackupPhotos.pack(text);
    return { count: p.count, size: p.bytes.length };
  });
  check('没有照片时不产生照片条目（只剩 backup.json）', noPhoto.count === 0, JSON.stringify(noPhoto));

  // ---------- 兼容：DEFLATE 压缩的包也能读（用户可能用系统工具重打包过） ----------
  const deflate = await page.evaluate(async (b64) => {
    const raw = window.atob(b64);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    const pack = await window.BackupPhotos.unpack(u8);
    const img = pack.photos[0] && pack.photos[0].bytes;
    return {
      names: pack.photos.map((p) => p.key),
      jsonOk: pack.json.indexOf('茄子（家常炒）') >= 0,
      img: img ? Array.from(img) : null
    };
  }, DEFLATE_ZIP_B64);
  check('DEFLATE 压缩的备份包能正确解出 JSON', deflate.jsonOk === true);
  check('DEFLATE 包里的照片字节无损', JSON.stringify(deflate.img) === JSON.stringify([255, 216, 255, 224, 9, 8, 7]),
    JSON.stringify(deflate.img));

  check('无页面异常', errors.length === 0, errors[0]);
} catch (e) {
  fail++;
  console.log('  ✗ 异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
} finally {
  await browser.close();
  close();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
