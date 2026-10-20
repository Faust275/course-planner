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

// 5) 时间冲突检测（schedule.js 里另一组纯函数）
const conflictAnchor = sliceFrom('function inWeekOf(');
const inWeekOfSrc = extractFnFrom('inWeekOf', conflictAnchor);
const weekOverlapSrc = extractFnFrom('weekOverlap', conflictAnchor);
const timeOverlapSrc = extractFnFrom('timeOverlap', conflictAnchor);
const findConflictsSrc = extractFnFrom('findConflicts', conflictAnchor);

// 6) 日历导出 .ics（remind.js 里的纯函数）
const duStart = sliceFrom('var DateUtil = {');
const DateUtilSrc = 'var DateUtil = ' + extractBalanced(html, html.indexOf('{', duStart)) + ';';
const icsAnchor = sliceFrom('function icsEscape(');
const icsEscapeSrc = extractFnFrom('icsEscape', icsAnchor);
const icsFoldSrc = extractFnFrom('icsFold', icsAnchor);
const icsDTSrc = extractFnFrom('icsDT', icsAnchor);
const icsStampSrc = extractFnFrom('icsStamp', icsAnchor);
const slotOccSrc = extractFnFrom('slotOccurrences', icsAnchor);
const icsTriggerSrc = extractFnFrom('icsTrigger', icsAnchor);
const valarmSrc = extractFnFrom('valarm', icsAnchor);
const buildICSSrc = extractFnFrom('buildICS', icsAnchor);

// 在隔离作用域里求值并导出
const mod = `var TimeUtil = ${TimeUtilSrc};
  ${DateUtilSrc}
  var PART_HEAD = 'CP1P', PART_SIZE = 700;
  var BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
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
  ${inWeekOfSrc}
  ${weekOverlapSrc}
  ${timeOverlapSrc}
  ${findConflictsSrc}
  ${icsEscapeSrc}
  ${icsFoldSrc}
  ${icsDTSrc}
  ${icsStampSrc}
  ${slotOccSrc}
  ${icsTriggerSrc}
  ${valarmSrc}
  ${buildICSSrc}
  globalThis.__T = { TimeUtil, DateUtil, expandRange, mergeTotal, splitSyncCode, joinSyncParts, PART_HEAD, PART_SIZE,
                     parseDay, parsePeriodNums, parseWeeks, splitRow, parseCourseTable,
                     inWeekOf, weekOverlap, timeOverlap, findConflicts,
                     icsEscape, icsFold, icsDT, icsStamp, slotOccurrences, icsTrigger, buildICS };
`;
new Function(mod)();
const { TimeUtil, DateUtil, expandRange, mergeTotal, splitSyncCode, joinSyncParts, PART_HEAD, PART_SIZE,
        parseDay, parsePeriodNums, parseWeeks, splitRow, parseCourseTable,
        inWeekOf, weekOverlap, timeOverlap, findConflicts,
        icsEscape, icsFold, icsDT, icsStamp, slotOccurrences, icsTrigger, buildICS } = globalThis.__T;

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

// ---- 时间冲突检测 ----
console.log('inWeekOf（周次命中）');
{
  const c = { startWeek: 3, endWeek: 8 };
  eq('第 3 周在内', inWeekOf(c, 3, 20), true);
  eq('第 2 周在外', inWeekOf(c, 2, 20), false);
  eq('第 8 周在内（闭区间）', inWeekOf(c, 8, 20), true);
  const odd = { startWeek: 1, endWeek: 10, weekType: 'odd' };
  eq('单周：第 3 周命中', inWeekOf(odd, 3, 20), true);
  eq('单周：第 4 周不中', inWeekOf(odd, 4, 20), false);
  const even = { startWeek: 1, endWeek: 10, weekType: 'even' };
  eq('双周：第 4 周命中', inWeekOf(even, 4, 20), true);
  eq('双周：第 3 周不中', inWeekOf(even, 3, 20), false);
  eq('缺起止周按整学期算', inWeekOf({}, 20, 20), true);
}

console.log('weekOverlap（周次交集）');
eq('1-16 与 9-20 交于第 9 周', weekOverlap({ startWeek: 1, endWeek: 16 }, { startWeek: 9, endWeek: 20 }, 20), 9);
eq('1-8 与 9-16 不重叠', weekOverlap({ startWeek: 1, endWeek: 8 }, { startWeek: 9, endWeek: 16 }, 20), 0);
eq('单周 vs 双周 永远不重叠', weekOverlap({ startWeek: 1, endWeek: 16, weekType: 'odd' },
                                           { startWeek: 1, endWeek: 16, weekType: 'even' }, 20), 0);
eq('单周 vs 每周 重叠', weekOverlap({ startWeek: 1, endWeek: 16, weekType: 'odd' },
                                    { startWeek: 1, endWeek: 16 }, 20), 1);

console.log('timeOverlap（自定义时段重叠）');
eq('08:00-09:40 与 09:00-10:00 重叠', timeOverlap({ startTime: '08:00', endTime: '09:40' },
                                                  { startTime: '09:00', endTime: '10:00' }), true);
eq('08:00-09:00 与 09:00-10:00 首尾相接不算', timeOverlap({ startTime: '08:00', endTime: '09:00' },
                                                          { startTime: '09:00', endTime: '10:00' }), false);
eq('完全错开', timeOverlap({ startTime: '08:00', endTime: '09:00' },
                           { startTime: '14:00', endTime: '15:00' }), false);

console.log('findConflicts（撞课检测）');
{
  const mk = (id, name, day, periodId, extra) => Object.assign({
    id, name, startWeek: 1, endWeek: 16, weekType: 'all',
    slots: [{ day, timeMode: 'period', periodId }]
  }, extra || {});

  // 1) 同一天同一节 → 冲突
  const a = mk('c1', '高等数学', 1, 'p1');
  const b = mk('c2', '大学英语', 1, 'p1');
  let r = findConflicts([a, b], 20);
  eq('撞同一格：报 1 处', r.length, 1);
  eq('列出两门课', r[0].names, ['高等数学', '大学英语']);
  eq('星期正确', r[0].day, 1);
  eq('节次正确', r[0].periodId, 'p1');

  // 2) 同一天不同节 → 不冲突
  eq('不同节次不冲突', findConflicts([a, mk('c3', '体育', 1, 'p3')], 20).length, 0);

  // 3) 同一节不同天 → 不冲突
  eq('不同天不冲突', findConflicts([a, mk('c4', '体育', 3, 'p1')], 20).length, 0);

  // 4) 周次错开 → 不冲突
  eq('周次错开不冲突', findConflicts([
    mk('c1', '高等数学', 1, 'p1', { startWeek: 1, endWeek: 8 }),
    mk('c2', '大学英语', 1, 'p1', { startWeek: 9, endWeek: 16 })
  ], 20).length, 0);

  // 5) 单双周错开 → 不冲突
  eq('单双周错开不冲突', findConflicts([
    mk('c1', '高等数学', 1, 'p1', { weekType: 'odd' }),
    mk('c2', '大学英语', 1, 'p1', { weekType: 'even' })
  ], 20).length, 0);

  // 6) 同一门课的多时段不算冲突
  eq('同一门课不算冲突', findConflicts([
    { id: 'c9', name: '实验课', startWeek: 1, endWeek: 16, weekType: 'all',
      slots: [{ day: 2, timeMode: 'period', periodId: 'p5' }, { day: 2, timeMode: 'period', periodId: 'p5' }] }
  ], 20).length, 0);

  // 7) 自定义时段重叠
  eq('自定义时段重叠算冲突', findConflicts([
    { id: 'c1', name: '早课', startWeek: 1, endWeek: 16, weekType: 'all',
      slots: [{ day: 1, timeMode: 'custom', startTime: '08:00', endTime: '09:40' }] },
    { id: 'c2', name: '补课', startWeek: 1, endWeek: 16, weekType: 'all',
      slots: [{ day: 1, timeMode: 'custom', startTime: '09:00', endTime: '10:00' }] }
  ], 20).length, 1);

  // 8) 三门撞一格：合成 1 处，列出 3 门
  const three = findConflicts([
    mk('c1', 'A', 1, 'p1'), mk('c2', 'B', 1, 'p1'), mk('c3', 'C', 1, 'p1')
  ], 20);
  eq('三门撞一格合成 1 处', three.length, 1);
  eq('列出 3 门课', three[0].names.length, 3);

  // 9) 空 / 无时段
  eq('空列表', findConflicts([], 20).length, 0);
  eq('没有时段的课', findConflicts([{ id: 'x', name: '无时段' }], 20).length, 0);

  // 10) 排序：按星期再按节次
  const sorted = findConflicts([
    mk('c1', '周五课', 5, 'p2'), mk('c2', '周五撞', 5, 'p2'),
    mk('c3', '周一课', 1, 'p9'), mk('c4', '周一撞', 1, 'p9')
  ], 20);
  eq('按星期排序', [sorted[0].day, sorted[1].day], [1, 5]);
}

// ---- .ics 导出 ----
console.log('icsEscape（RFC 5545 文本转义）');
eq('反斜杠', icsEscape('a\\b'), 'a\\\\b');
eq('分号', icsEscape('a;b'), 'a\\;b');
eq('逗号', icsEscape('a,b'), 'a\\,b');
eq('换行', icsEscape('a\nb'), 'a\\nb');
eq('CRLF', icsEscape('a\r\nb'), 'a\\nb');
eq('null -> 空串', icsEscape(null), '');
eq('不重复转义已有的反斜杠-n', icsEscape('a\\\\b'), 'a\\\\\\\\b');

console.log('icsFold（75 字节折行）');
{
  const short = 'SUMMARY:高等数学';
  eq('短行不折', icsFold(short), short);

  // 24 个中文 = 72 字节，不超 74；第 25 个（75 字节）触发折行
  eq('24 个中文不折行', icsFold('X'.repeat(1) + '中'.repeat(24)).split('\r\n ').length, 1);
  const folded = icsFold('X'.repeat(1) + '中'.repeat(30));
  const segs = folded.split('\r\n ');
  eq('30 个中文折成 2 段', segs.length, 2);
  eq('续行以单个空格开头', segs[1].charAt(0) === '' || folded.indexOf('\r\n ') > 0, true);
  // 每段按字节都不超过 75（74 + 续行的空格）
  eq('每段字节数 <= 75', segs.every(s => Buffer.byteLength(s, 'utf8') <= 75), true);

  // 纯 ASCII 长行
  const ascii = 'DESCRIPTION:' + 'a'.repeat(120);
  const asegs = icsFold(ascii).split('\r\n ');
  eq('ASCII 长行折行', asegs.length > 1, true);
  eq('ASCII 每段 <= 75 字节', asegs.every(s => Buffer.byteLength(s, 'utf8') <= 75), true);
  eq('ASCII 拼接可还原', asegs.join(''), ascii);

  // emoji 是代理对，不能被劈成两半
  const emoji = 'SUMMARY:' + '\u{1F600}'.repeat(30);
  const esegs = icsFold(emoji).split('\r\n ');
  eq('emoji 不被劈开', esegs.every(s => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s)), true);
  eq('emoji 拼接可还原', esegs.join(''), emoji);
}

console.log('icsDT（浮动本地时间）');
eq('日期+时间', icsDT('2025-03-03', '08:00'), '20250303T080000');
eq('去掉横杠与冒号', icsDT('2025-12-31', '23:59'), '20251231T235900');
eq('缺时间补 00:00', icsDT('2025-03-03'), '20250303T000000');
eq('空值不炸', icsDT(null, null), 'T000000');

console.log('icsStamp（UTC + Z）');
eq('固定时刻', icsStamp(new Date(Date.UTC(2025, 2, 3, 12, 34, 56))), '20250303T123456Z');
eq('补零', icsStamp(new Date(Date.UTC(2025, 0, 2, 3, 4, 5))), '20250102T030405Z');
eq('结尾带 Z', /Z$/.test(icsStamp()), true);

console.log('slotOccurrences（周次 -> 首次 + 次数）');
eq('整学期 1-16 周', slotOccurrences(1, 16, null), { first: 1, count: 16 });
eq('单周不写', slotOccurrences(8, null), { first: 8, count: 1 });
eq('单周 1-16 周', slotOccurrences(1, 16, 'odd'), { first: 1, count: 8 });
eq('双周 1-16 周', slotOccurrences(1, 16, 'even'), { first: 2, count: 8 });
eq('单周从双周起', slotOccurrences(2, 16, 'odd'), { first: 3, count: 7 });
eq('双周从单周起', slotOccurrences(1, 15, 'even'), { first: 2, count: 7 });
eq('单双周排不上 -> null', slotOccurrences(2, 2, 'odd'), null);
eq('起止颠倒 -> null', slotOccurrences(5, 3), null);
eq('非法值兜底为 1', slotOccurrences('x', 'y'), { first: 1, count: 1 });

console.log('icsTrigger（提前提醒）');
eq('15 分钟', icsTrigger(15), '-PT15M');
eq('0 分钟', icsTrigger(0), 'PT0S');
eq('undefined -> PT0S', icsTrigger(undefined), 'PT0S');
eq('负数 -> PT0S', icsTrigger(-5), 'PT0S');

console.log('buildICS（整份日历）');
{
  const periods = [
    { id: 'p1', start: '08:00', end: '08:45' },
    { id: 'p2', start: '08:55', end: '09:40' }
  ];
  const base = {
    semesterName: '2025 春',
    semesterStart: '2025-03-03',           // 周一
    periods: periods,
    leadMinutes: 15,
    now: new Date(Date.UTC(2025, 2, 3, 12, 0, 0)),
    include: { courses: true, exams: true, events: true }
  };
  const ics = buildICS(Object.assign({}, base, {
    courses: [{
      id: 'c1', name: '高等数学', teacher: '张老师',
      startWeek: 1, endWeek: 16, weekType: 'all',
      slots: [{ day: 1, timeMode: 'period', periodId: 'p1', location: 'A301' }]
    }]
  }));
  const L = ics.split('\r\n');

  eq('以 VCALENDAR 开头', L[0], 'BEGIN:VCALENDAR');
  eq('声明 VERSION', L.indexOf('VERSION:2.0') > 0, true);
  eq('日历名', L.indexOf('X-WR-CALNAME:2025 春') > 0, true);
  eq('以 END:VCALENDAR 结尾', ics.trim().endsWith('END:VCALENDAR'), true);
  eq('CRLF 结尾', ics.endsWith('\r\n'), true);
  eq('1 条事件', (ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  eq('UID 带课程与时段序号', L.indexOf('UID:c1-0@course-planner') > 0, true);
  eq('DTSTART 落在第 1 周周一', L.indexOf('DTSTART:20250303T080000') > 0, true);
  eq('DTEND 用节次结束时间', L.indexOf('DTEND:20250303T084500') > 0, true);
  eq('RRULE 每周重复', L.indexOf('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=16') > 0, true);
  eq('SUMMARY 是课名', L.indexOf('SUMMARY:高等数学') > 0, true);
  eq('LOCATION', L.indexOf('LOCATION:A301') > 0, true);
  eq('DESCRIPTION 是老师', L.indexOf('DESCRIPTION:张老师') > 0, true);
  eq('VALARM 存在', L.indexOf('BEGIN:VALARM') > 0, true);
  eq('TRIGGER 提前 15 分钟', L.indexOf('TRIGGER:-PT15M') > 0, true);
  eq('DTSTAMP 是 UTC', L.indexOf('DTSTAMP:20250303T120000Z') > 0, true);
  eq('浮动时间不带 Z', /^DTSTART:\d{8}T\d{6}$/.test(L.find(x => x.indexOf('DTSTART:') === 0)), true);

  // 单双周：INTERVAL=2 + 首次出现顺延一周 + COUNT 减半
  const oddIcs = buildICS(Object.assign({}, base, {
    courses: [{
      id: 'c2', name: '大学英语', startWeek: 2, endWeek: 16, weekType: 'odd',
      slots: [{ day: 1, timeMode: 'period', periodId: 'p2' }]
    }]
  })).split('\r\n');
  eq('单周 INTERVAL=2', oddIcs.indexOf('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=7') > 0, true);
  eq('单周首次顺延到第 3 周', oddIcs.indexOf('DTSTART:20250317T085500') > 0, true);

  const evenIcs = buildICS(Object.assign({}, base, {
    courses: [{
      id: 'c3', name: '体育', startWeek: 1, endWeek: 16, weekType: 'even',
      slots: [{ day: 5, timeMode: 'period', periodId: 'p1' }]
    }]
  })).split('\r\n');
  eq('双周首次是第 2 周周五', evenIcs.indexOf('DTSTART:20250314T080000') > 0, true);
  eq('双周 BYDAY=FR', evenIcs.indexOf('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=8') > 0, true);

  // 自定义时段
  const customIcs = buildICS(Object.assign({}, base, {
    courses: [{
      id: 'c4', name: '晚自习', startWeek: 1, endWeek: 8,
      slots: [{ day: 3, timeMode: 'custom', startTime: '19:00', endTime: '20:30' }]
    }]
  })).split('\r\n');
  eq('自定义时段用自身时间', customIcs.indexOf('DTSTART:20250305T190000') > 0, true);
  eq('自定义时段结束', customIcs.indexOf('DTEND:20250305T203000') > 0, true);

  // 单双周排不上 → 不产生事件
  eq('排不上周次时不导课程', (buildICS(Object.assign({}, base, {
    courses: [{ id: 'c5', name: '空课', startWeek: 2, endWeek: 2, weekType: 'odd',
                slots: [{ day: 1, timeMode: 'period', periodId: 'p1' }] }]
  })).match(/BEGIN:VEVENT/g) || []).length, 0);

  // 没设学期开始日期 → 不导课程，但日历骨架还在
  const noBase = buildICS({
    semesterName: 'x', semesterStart: null, periods: periods,
    courses: [{ id: 'c1', name: 'A', slots: [{ day: 1, timeMode: 'period', periodId: 'p1' }] }],
    include: { courses: true }
  }).split('\r\n');
  eq('无学期起始日不导课程', noBase.filter(x => x === 'BEGIN:VEVENT').length, 0);
  eq('无学期起始日仍有骨架', noBase[0] === 'BEGIN:VCALENDAR' && noBase.includes('END:VCALENDAR'), true);

  // 节次 id 对不上（用户自定义过节次表）→ 跳过而不是写出空时间
  eq('节次不存在时跳过', (buildICS(Object.assign({}, base, {
    courses: [{ id: 'c6', name: 'B', slots: [{ day: 1, timeMode: 'period', periodId: 'p99' }] }]
  })).match(/BEGIN:VEVENT/g) || []).length, 0);

  // include 开关
  eq('关掉课程后没有事件', (buildICS(Object.assign({}, base, {
    include: { courses: false, exams: false, events: false },
    courses: [{ id: 'c1', name: 'A', slots: [{ day: 1, timeMode: 'period', periodId: 'p1' }] }]
  })).match(/BEGIN:VEVENT/g) || []).length, 0);
}

console.log('buildICS（考试 / 重要日程）');
{
  const base = {
    semesterName: '2025 春', semesterStart: '2025-03-03',
    periods: [{ id: 'p1', start: '08:00', end: '08:45' }],
    leadMinutes: 0, include: { courses: false, exams: true, events: true },
    now: new Date(Date.UTC(2025, 2, 3, 12, 0, 0))
  };

  const t = buildICS(Object.assign({}, base, {
    exams: [{ courseId: 'c1', name: '高等数学', date: '2025-06-10', start: '09:00', end: '11:00', location: 'A301' }]
  })).split('\r\n');
  eq('考试 DTSTART', t.indexOf('DTSTART:20250610T090000') > 0, true);
  eq('考试 DTEND', t.indexOf('DTEND:20250610T110000') > 0, true);
  eq('考试标题带（考试）', t.indexOf('SUMMARY:高等数学（考试）') > 0, true);
  eq('考试地点', t.indexOf('LOCATION:A301') > 0, true);
  eq('考试至少提前 30 分钟', t.indexOf('TRIGGER:-PT30M') > 0, true);
  eq('考试 UID', t.indexOf('UID:exam-c1-2025-06-10@course-planner') > 0, true);

  // 没写时间 → 全天事件，DTEND 是次日
  const allDay = buildICS(Object.assign({}, base, {
    exams: [{ courseId: 'c2', name: '大学英语', date: '2025-06-12' }]
  })).split('\r\n');
  eq('全天考试 VALUE=DATE', allDay.indexOf('DTSTART;VALUE=DATE:20250612') > 0, true);
  eq('全天考试 DTEND 次日', allDay.indexOf('DTEND;VALUE=DATE:20250613') > 0, true);
  eq('全天考试不写时刻', allDay.some(x => x === 'DTSTART:20250612T000000'), false);

  // 重要日程：只导勾了 important 的
  const ev = buildICS(Object.assign({}, base, {
    events: [
      { id: 'e1', title: '答辩', date: '2025-06-20', start: '14:00', end: '16:00', important: true, note: '带 PPT' },
      { id: 'e2', title: '普通日程', date: '2025-06-21', important: false },
      { id: 'e3', title: '没日期', important: true }
    ]
  })).split('\r\n');
  eq('只导重要日程', (ev.join('\n').match(/BEGIN:VEVENT/g) || []).length, 1);
  eq('重要日程标题', ev.indexOf('SUMMARY:答辩') > 0, true);
  eq('重要日程备注', ev.indexOf('DESCRIPTION:带 PPT') > 0, true);
  eq('重要日程 DTEND', ev.indexOf('DTEND:20250620T160000') > 0, true);
  eq('非重要不导', ev.some(x => x.indexOf('普通日程') >= 0), false);

  // 事件里的时间也要提前至少 30 分钟
  eq('日程至少提前 30 分钟', ev.indexOf('TRIGGER:-PT30M') > 0, true);

  // 组合：课程 + 考试 + 日程一起数
  const all = buildICS({
    semesterName: 'x', semesterStart: '2025-03-03',
    periods: [{ id: 'p1', start: '08:00', end: '08:45' }],
    leadMinutes: 15, include: { courses: true, exams: true, events: true },
    courses: [{
      id: 'c1', name: 'A', startWeek: 1, endWeek: 2,
      slots: [{ day: 1, timeMode: 'period', periodId: 'p1' }, { day: 3, timeMode: 'period', periodId: 'p1' }]
    }],
    exams: [{ courseId: 'c1', name: 'A', date: '2025-06-10', start: '09:00' }],
    events: [{ id: 'e1', title: 'B', date: '2025-06-20', start: '14:00', important: true }]
  });
  eq('两个时段 = 两条重复事件', (all.match(/BEGIN:VEVENT/g) || []).length, 4);
  eq('每条课程事件都有 VALARM', (all.match(/BEGIN:VALARM/g) || []).length, 4);
  eq('两个时段的 UID 不同', /UID:c1-0@/.test(all) && /UID:c1-1@/.test(all), true);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
