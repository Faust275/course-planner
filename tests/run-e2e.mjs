// e2e 聚合运行器：逐个执行仓库根目录下的 verify_*.mjs（每个脚本自带服务器与断言、以退出码 0/1 表示成败）。
// 用法：node tests/run-e2e.mjs            # 跑全部
//      node tests/run-e2e.mjs drag        # 只跑文件名含 drag 的
// 任一脚本失败即整体非零退出，方便 CI 直接 `npm run e2e`。
import { readdirSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filter = process.argv[2] || '';
const specs = readdirSync(ROOT)
  .filter((f) => f.startsWith('verify_') && f.endsWith('.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!specs.length) { console.log('没有匹配的 verify_*.mjs'); process.exit(0); }

let pass = 0, fail = 0;
const failed = [];
for (const spec of specs) {
  process.stdout.write(`▶ ${spec} ... `);
  let out = '';
  const code = await new Promise((resolve) => {
    const p = spawn('node', [spec], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (c) => resolve(c ?? 1));
  });
  if (code === 0) { pass++; console.log('PASS'); }
  else {
    fail++; failed.push(spec);
    const tail = out.trim().split('\n').slice(-6).join('\n');
    console.log('FAIL (' + code + ')');
    if (tail) console.log('   ' + tail.replace(/\n/g, '\n   '));
  }
}

console.log(`\ne2e 结果：${pass} 通过 / ${fail} 失败（共 ${specs.length}）`);
if (fail) { console.log('失败用例：', failed.join(', ')); process.exit(1); }
