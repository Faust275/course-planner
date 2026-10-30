/**
 * 在 Node vm 里构造 Store 时用：把 store.js 和所有域模块按依赖顺序拼起来。
 * 域模块都是 `(function(global){ ... })(window)`，在 vm 里 window 指向 sandbox，
 * 拼在一起执行的效果和在浏览器里按 <script> 顺序加载一致。
 */
import fs from 'node:fs';
import path from 'node:path';

const FILES = [
  'stats-calc.js',
  'store-presets.js',
  'store.js',
  'store-ledger.js',
  'attendance.js',
  'store-health.js',
  'store-tasks.js',
  'store-course.js',
  'store-reward.js',
  'store-backup.js',
  'store-io.js',
  'store-plans.js',
  'store-stats.js',
  'store-records.js'
];

export function storeSource(root = process.cwd()) {
  return FILES
    .map((f) => fs.readFileSync(path.join(root, 'assets', 'js', f), 'utf8'))
    .join('\n;\n');
}
