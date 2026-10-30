// e2e 聚合运行器：逐个执行仓库根目录下的 verify_*.mjs（每个脚本自带服务器与断言、以退出码 0/1 表示成败）。
// 用法：node tests/run-e2e.mjs            # 跑全部
//      node tests/run-e2e.mjs drag        # 只跑文件名含 drag 的
// 任一脚本失败即整体非零退出，方便 CI 直接 `npm run e2e`。
//
// 注意：verify_*.mjs 分两代——
//   新脚本（约 14 个）自己 import test-utils 起服务器；
//   老脚本（约 37 个）不起服务器，读 process.env.URL（默认连 localhost:8183）。
// 因此在 CI/干净环境里必须有一个共享服务器，否则老脚本会全部 ECONNREFUSED。
// 这里统一起一个共享服务器，并把 URL 注入给每个子进程，两代脚本都能跑。
import { readdirSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import path from 'path';
import { startServer } from '../test-utils.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filter = process.argv[2] || '';
const VERIFY_DIR = path.join(ROOT, 'tests', 'verify');
const specs = readdirSync(VERIFY_DIR)
  .filter((f) => f.startsWith('verify_') && f.endsWith('.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort()
  .map((f) => path.join('tests', 'verify', f));

if (!specs.length) { console.log('没有匹配的 verify_*.mjs'); process.exit(0); }

function cleanChromiumTmp() {
  try {
    const td = tmpdir();
    for (const name of readdirSync(td)) {
      if (name.startsWith('.org.chromium.') || name.startsWith('cp-sw-')) {
        try { rmSync(path.join(td, name), { recursive: true, force: true }); } catch {}
      }
    }
  } catch {}
}

// 共享静态服务器：给不起服务器的老脚本用（通过 URL 环境变量注入）
const { base, close } = await startServer();
console.log(`静态服务器: ${base}/index.html\n`);

let pass = 0, fail = 0;
const failed = [];
for (const spec of specs) {
  process.stdout.write(`▶ ${spec} ... `);
  let out = '';
  const code = await new Promise((resolve) => {
    const p = spawn('node', [spec], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, URL: `${base}/index.html` },
    });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (c) => resolve(c ?? 1));
  });
  cleanChromiumTmp();
  if (code === 0) { pass++; console.log('PASS'); }
  else {
    fail++; failed.push(spec);
    // CI 上只靠最后几行看不出根因（错误堆栈被截断），放宽到 40 行
    const tail = out.trim().split('\n').slice(-40).join('\n');
    console.log('FAIL (' + code + ')');
    if (tail) console.log('   ' + tail.replace(/\n/g, '\n   '));
  }
}

close();
console.log(`\ne2e 结果：${pass} 通过 / ${fail} 失败（共 ${specs.length}）`);
if (fail) { console.log('失败用例：', failed.join(', ')); process.exit(1); }
