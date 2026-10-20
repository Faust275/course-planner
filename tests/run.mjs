// 最小单测：从 index.html 实时提取纯逻辑函数（无 DOM 依赖），
// 做边界断言，作为后续改动的回归基线。运行：node tests/run.mjs
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 从 openIdx（指向某个开括号）起，按嵌套括号计数提取到匹配闭括号的片段
function extractBalanced(src, openIdx) {
  let depth = 0, i = openIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  throw new Error('括号不匹配 @' + openIdx);
}
function sliceFrom(marker, from = 0) {
  const i = html.indexOf(marker, from);
  if (i < 0) throw new Error('找不到: ' + marker);
  return i;
}

// 1) TimeUtil 对象
const tuStart = sliceFrom('var TimeUtil = {');
const tuOpen = html.indexOf('{', tuStart);
const TimeUtilSrc = extractBalanced(html, tuOpen); // 含首尾 {}

// 2) expandRange / mergeTotal 函数
function extractFn(name) {
  const i = sliceFrom('function ' + name + '(');
  const open = html.indexOf('{', i);
  return html.slice(i, open) + extractBalanced(html, open);
}
const expandRangeSrc = extractFn('expandRange');
const mergeTotalSrc = extractFn('mergeTotal');

// 3) 同步码分片逻辑（settings.js 里的纯函数）
const splitSyncCodeSrc = extractFn('splitSyncCode');
const joinSyncPartsSrc = extractFn('joinSyncParts');
const pad2Src = extractFn('pad2');

// 4) 批量课表导入的解析器（schedule.js 里的纯函数）
//    注意 parseWeeks 在别处还有同名重载，所以统一从 DAY_CN 之后开始找，锁死取 schedule.js 那份
const batchAnchor = sliceFrom('var DAY_CN = {');
function extractObj(varName) {
  const i = sliceFrom('var ' + varName + ' = {', batchAnchor - 1);
  const open = html.indexOf('{', i);
  return 'var ' + varName + ' = ' + extractBalanced(html, open) + ';';
}
function extractFnFrom(name, from) {
  const i = sliceFrom('function ' + name + '(', from);
  const open = html.indexOf('{', i);
  return html.slice(i, open) + extractBalanced(html, open);
}
const DAY_CNSrc = extractObj('DAY_CN');
const headKeysSrc = extractObj('HEAD_KEYS');
const splitRowSrc = extractFnFrom('splitRow', batchAnchor);
const parseDaySrc = extractFnFrom('parseDay', batchAnchor);
const parsePeriodNumsSrc = extractFnFrom('parsePeriodNums', batchAnchor);
const parseWeeksSrc = extractFnFrom('parseWeeks', batchAnchor);
const looksLikeWeekSrc = extractFnFrom('looksLikeWeekField', batchAnchor);
const parseCourseTableSrc = extractFnFrom('parseCourseTable', batchAnchor);

// 在隔离作用域里求值并导出
const mod = `var TimeUtil = ${TimeUtilSrc};
  var PART_HEAD = 'CP1P', PART_SIZE = 700;
  ${DAY_CNSrc}
  ${headKeysSrc}
  ${expandRangeSrc}
  ${mergeTotalSrc}
  ${pad2Src}
  ${splitSyncCodeSrc}
  ${joinSyncPartsSrc}
  ${splitRowSrc}
  ${parseDaySrc}
  ${parsePeriodNumsSrc}
  ${parseWeeksSrc}
  ${looksLikeWeekSrc}
  ${parseCourseTableSrc}
  globalThis.__T = { TimeUtil, expandRange, mergeTotal, splitSyncCode, joinSyncParts, PART_HEAD, PART_SIZE,
                     parseDay, parsePeriodNums, parseWeeks, splitRow, parseCourseTable };
`;
new Function(mod)();
const { TimeUtil, expandRange, mergeTotal, splitSyncCode, joinSyncParts, PART_HEAD, PART_SIZE,
        parseDay, parsePeriodNums, parseWeeks, splitRow, parseCourseTable } = globalThis.__T;

// 断言
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

console.log('TimeUtil.toMin');
eq('08:30 -> 510', TimeUtil.toMin('08:30'), 510);
eq('00:00 -> 0', TimeUtil.toMin('00:00'), 0);
eq('23:59 -> 1439', TimeUtil.toMin('23:59'), 1439);

console.log('TimeUtil.diffMin（跨午夜）');
eq('23:30→00:10 = 40', TimeUtil.diffMin('23:30', '00:10'), 40);
eq('08:00→10:00 = 120', TimeUtil.diffMin('08:00', '10:00'), 120);

console.log('TimeUtil.humanMin');
eq('90 -> 1 小时 30 分', TimeUtil.humanMin(90), '1 小时 30 分');
eq('60 -> 1 小时', TimeUtil.humanMin(60), '1 小时');
eq('30 -> 30 分钟', TimeUtil.humanMin(30), '30 分钟');
eq('0  -> —', TimeUtil.humanMin(0), '—');

console.log('TimeUtil.addMin（跨午夜回绕）');
eq('23:50 +20 -> 00:10', TimeUtil.addMin('23:50', 20), '00:10');

console.log('expandRange（跨午夜拆分）');
eq('23:00→01:00', expandRange('23:00', '01:00'), [[1380, 1440], [0, 60]]);
eq('08:00→10:00', expandRange('08:00', '10:00'), [[480, 600]]);

console.log('mergeTotal（合并重叠区间）');
eq('不重叠 [0,100]+[100,200] = 200', mergeTotal([[0, 100], [100, 200]]), 200);
eq('重叠 [0,100]+[50,150] = 150', mergeTotal([[0, 100], [50, 150]]), 150);
eq('空 = 0', mergeTotal([]), 0);

// ---- 同步码分片 ----
function mkCode(n) {                       // 造一个长度 n 的伪同步码（CP1G + base64）
  let s = 'CP1G';
  const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < n - 4; i++) s += CH[i % CH.length];
  return s;
}

console.log('splitSyncCode（分片切分）');
eq('短码不分片（保持旧格式）', splitSyncCode(mkCode(700)), null);
eq('空值不分片', splitSyncCode(''), null);
{
  const code = mkCode(1500);
  const parts = splitSyncCode(code);
  eq('1500 字符切成 3 片', parts.length, 3);
  eq('每片以 CP1P 开头', parts.every(p => p.indexOf(PART_HEAD) === 0), true);
  eq('头部带总数与序号', parts[0].slice(0, 8), 'CP1P0301');
  eq('末片序号正确', parts[2].slice(0, 8), 'CP1P0303');
  eq('拼接后等于原码', parts.map(p => p.slice(8)).join(''), code);
}

console.log('joinSyncParts（分片拼回）');
{
  const code = mkCode(1500);
  const parts = splitSyncCode(code);
  const j = joinSyncParts(parts.join('\n'));
  eq('顺序粘贴可拼回', j.code, code);
  eq('无缺片', j.missing, []);

  const j2 = joinSyncParts(parts.slice().reverse().join('\n'));
  eq('乱序粘贴可拼回', j2.code, code);

  // 微信里复制常带「用户名 上午10:30」这类噪音，数字不能被当成内容
  const noisy = parts.map(p => p + '\n小明 上午10:30').join('\n');
  eq('夹带微信噪音仍可拼回', joinSyncParts(noisy).code, code);

  // 带【1/3】标注：标注里的数字不能被拼进内容
  const marked = parts.map((p, i) => '【' + (i + 1) + '/3】' + p).join('\n');
  eq('带【N/M】标注仍可拼回', joinSyncParts(marked).code, code);

  const miss = joinSyncParts(parts.filter((_, i) => i !== 1).join('\n'));
  eq('缺第 2 片时报告缺失', miss.missing, [2]);
  eq('缺片时不给码', miss.code, null);

  eq('非分片内容返回 null', joinSyncParts('CP1Gabc'), null);
}

// ---- 批量导入课表解析 ----
console.log('parseDay（星期识别）');
eq('周一 -> 1', parseDay('周一'), 1);
eq('星期天 -> 7', parseDay('星期天'), 7);
eq('星期三 -> 3', parseDay('星期三'), 3);
eq('周 5 -> 5', parseDay('周 5'), 5);
eq('纯数字 3 -> 3', parseDay('3'), 3);
eq('认不出 -> 0', parseDay('高等数学'), 0);
eq('空 -> 0', parseDay(''), 0);

console.log('parsePeriodNums（节次识别）');
eq('第1-2节 -> [1,2]', parsePeriodNums('第1-2节'), [1, 2]);
eq('3-4 -> [3,4]', parsePeriodNums('3-4'), [3, 4]);
eq('1,2 -> [1,2]', parsePeriodNums('1,2'), [1, 2]);
eq('5 -> [5]', parsePeriodNums('5'), [5]);
eq('教室号不当节次', parsePeriodNums('教学楼A301'), []);
eq('区间不递增 -> []', parsePeriodNums('5-2'), []);

console.log('parseWeeks（周次识别）');
eq('1-16周 -> {1,16}', parseWeeks('1-16周'), { start: 1, end: 16 });
eq('1-16 -> {1,16}', parseWeeks('1-16'), { start: 1, end: 16 });
eq('单周 8 -> {8,8}', parseWeeks('8'), { start: 8, end: 8 });
eq('空 -> null', parseWeeks(''), null);
eq('无关文本 -> null', parseWeeks('张老师'), null);

console.log('splitRow（分隔）');
eq('Tab 分隔', splitRow('a\tb\tc'), ['a', 'b', 'c']);
eq('逗号分隔', splitRow('a,b,c'), ['a', 'b', 'c']);
eq('多空格分隔', splitRow('a   b   c'), ['a', 'b', 'c']);
eq('单空格也拆', splitRow('周一 第1-2节 高等数学'), ['周一', '第1-2节', '高等数学']);

console.log('parseCourseTable（整表解析）');
{
  // Excel 直接复制：带表头、Tab 分隔
  const tsv = [
    '课程名\t教师\t地点\t星期\t节次\t周次',
    '高等数学\t张老师\t教学楼A301\t周一\t1-2节\t1-16周',
    '大学英语\t李老师\t外语楼302\t周三\t3-4节\t1-16周'
  ].join('\n');
  const r1 = parseCourseTable(tsv);
  eq('TSV 解析出 2 门', r1.rows.length, 2);
  eq('认到表头', !!r1.cols, true);
  eq('第 1 门课名', r1.rows[0].name, '高等数学');
  eq('第 1 门教师', r1.rows[0].teacher, '张老师');
  eq('第 1 门地点', r1.rows[0].location, '教学楼A301');
  eq('第 1 门星期', r1.rows[0].day, 1);
  eq('第 1 门节次', r1.rows[0].periods, [1, 2]);
  eq('第 1 门周次', r1.rows[0].weeks, { start: 1, end: 16 });
  eq('第 2 门星期', r1.rows[1].day, 3);

  // 无表头、空格分隔的自由文本
  const plain = [
    '周一 第1-2节 高等数学 张老师 A301',
    '星期三 3-4节 大学英语 李老师 外语楼302 1-16周',
    '周五 第7-8节 体育 操场'
  ].join('\n');
  const r2 = parseCourseTable(plain);
  eq('无表头解析出 3 门', r2.rows.length, 3);
  eq('无表头第 1 门课名', r2.rows[0].name, '高等数学');
  eq('无表头第 1 门星期', r2.rows[0].day, 1);
  eq('无表头第 2 门星期', r2.rows[1].day, 3);
  eq('无表头第 2 门节次', r2.rows[1].periods, [3, 4]);
  eq('无表头第 2 门周次', r2.rows[1].weeks, { start: 1, end: 16 });
  eq('无表头第 3 门地点', r2.rows[2].location, '操场');

  // 缺信息要跳过而不是瞎猜
  const bad = '高等数学\n周一 第1-2节 线性代数';
  const r3 = parseCourseTable(bad);
  eq('缺信息行被跳过', r3.rows.length, 1);
  eq('跳过行数上报', r3.skipped.length, 1);

  // 空输入
  eq('空输入 -> 0 行', parseCourseTable('').rows.length, 0);
  eq('空输入无表头', parseCourseTable('').cols, null);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
