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

// 3) 批量课表导入的解析器（schedule.js 里的纯函数）
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

// 7) 全局搜索（search.js 里的纯函数）
const searchAnchor = sliceFrom('var TYPE_META = {');
const TYPE_METASrc = 'var TYPE_META = ' + extractBalanced(html, html.indexOf('{', searchAnchor)) + ';';
const joinNonEmptySrc = extractFnFrom('joinNonEmpty', searchAnchor);
const hitsInSrc = extractFnFrom('hitsIn', searchAnchor);
const describeSrc = extractFnFrom('describe', searchAnchor);
const snippetSrc = extractFnFrom('snippet', searchAnchor);
const scoreOfSrc = extractFnFrom('scoreOf', searchAnchor);
const searchAllSrc = extractFnFrom('searchAll', searchAnchor);
const groupResultsSrc = extractFnFrom('groupResults', searchAnchor);

// 8) 重复任务（store.js 里的纯函数，依赖 DateUtil）
const nextDueDateSrc = extractFn('nextDueDate');
const repeatExpiredSrc = extractFn('repeatExpired');
const sanitizeRepeatSrc = extractFn('sanitizeRepeat');

// 9) 农历模块（lunar.js，整体 IIFE，直接求值到独立 window 上）
const lunarIiFE = (() => {
  const i = sliceFrom("(function (global) {", sliceFrom('农历（1900–2100）') - 400);
  // 从该 IIFE 的起始位置提取到匹配的 })(window);
  let depth = 0, j = i;
  for (; j < html.length; j++) {
    const c = html[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return html.slice(i, html.indexOf('\n', j) + 1);
})();
const lunarWin = {};
// lunar.js 现依赖共享工具 UI.b64ToBytes（见 ui.js），单测隔离环境需注入等价实现
const b64ToBytesForTest = function (b64) {
  var bin = atob(String(b64 == null ? '' : b64).replace(/\s+/g, ''));
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
new Function('window', 'UI', lunarIiFE)(lunarWin, { b64ToBytes: b64ToBytesForTest });
const Lunar = lunarWin.Lunar;

// 10) 纪念日顺延（store.js，依赖 DateUtil + global.Lunar）
const clampDayOfMonthSrc = extractFn('clampDayOfMonth');
const clampFeb29Src = extractFn('clampFeb29');
const annivNextSrc = (() => {
  const i = sliceFrom('annivNext: function (ev, todayStr) {');
  const o = html.indexOf('{', i + 'annivNext: function'.length);
  return 'function annivNext(ev, todayStr) ' + extractBalanced(html, o);
})();

// 11) 课表导出图片的纯函数（schedule-export.js）
const expAnchor = sliceFrom('function wrapText(');
const wrapTextSrc = extractFnFrom('wrapText', expAnchor);
const measureSrc = extractFnFrom('measure', expAnchor);
const hexToRgbSrc = extractFnFrom('hexToRgb', expAnchor);
const tintSrc = extractFnFrom('tint', expAnchor);
const roundRectSrc = extractFnFrom('roundRect', expAnchor);
const DEFAULT_OPTSSrc = (() => {
  const i = sliceFrom('var DEFAULT_OPTS = {');
  return 'var DEFAULT_OPTS = ' + extractBalanced(html, html.indexOf('{', i)) + ';';
})();

// 12) 子任务（store.js）
// 统计口径：RANGES / rangeDates / compareRange / perDay / weekBounds / monthBounds / sleepByNight / heatLevel
const STATS_ANCHOR = sliceFrom('var RANGES = {');
const RANGESSrc = (() => {
  const i = sliceFrom('var RANGES = {');
  return 'var RANGES = ' + extractBalanced(html, html.indexOf('{', i)) + ';';
})();
const LEDGER_RANGESSrc = (() => {
  const i = sliceFrom('var LEDGER_RANGES = [');
  const open = html.indexOf('[', i);
  let depth = 0, j = open;
  for (; j < html.length; j++) {
    if (html[j] === '[') depth++;
    else if (html[j] === ']') { depth--; if (depth === 0) break; }
  }
  return 'var LEDGER_RANGES = ' + html.slice(open, j + 1) + ';';
})();
const weekBoundsSrc = extractFn('weekBounds');
const monthBoundsSrc = extractFn('monthBounds');
// 统计口径的纯实现已搬到 stats-calc.js（模板里排在 store.js 之前），
// 从文件头取第一份；rangeDates/compareRange 在沙箱里再包一层，补 RANGES 与当前学期
const rangeDatesPureSrc = extractFn('rangeDates').replace('function rangeDates(', 'function rangeDatesPure(');
const compareRangePureSrc = extractFn('compareRange').replace('function compareRange(', 'function compareRangePure(');
const perDaySrc = extractFn('perDay');
const eachDateSrc = extractFn('eachDate');
const sumDaySegmentsSrc = extractFn('sumDaySegments');
const rangeSummarySrc = extractFn('rangeSummary');
// sleepByNight 也在 stats-calc.js
const sleepByNightSrc = extractFn('sleepByNight');
const heatLevelSrc = extractFn('heatLevel');   // stats.js 已改为 StatsPane，全局唯一

// 日记 / 心情：MOODS 枚举 + 归属判定 + 统计
const MOODS_ANCHOR = sliceFrom('var MOODS = [');
const MOODSSrc = (() => {
  const i = sliceFrom('var MOODS = [');
  const open = html.indexOf('[', i);
  let depth = 0, j = open;
  for (; j < html.length; j++) {
    if (html[j] === '[') depth++;
    else if (html[j] === ']') { depth--; if (depth === 0) break; }
  }
  return 'var MOODS = ' + html.slice(open, j + 1) + ';';
})();
const MOOD_MIN_DAYSSrc = (() => {
  const i = sliceFrom('var MOOD_MIN_DAYS =');
  return html.slice(i, html.indexOf(';', i) + 1);
})();
const MOOD_CROSS_MIN_DAYSSrc = (() => {
  const i = sliceFrom('var MOOD_CROSS_MIN_DAYS =');
  return html.slice(i, html.indexOf(';', i) + 1);
})();
const moodOfSrc = extractFnFrom('moodOf', MOODS_ANCHOR);
const moodToneSrc = extractFnFrom('moodTone', MOODS_ANCHOR);
const diaryDatePromptSrc = extractFnFrom('diaryDatePrompt', MOODS_ANCHOR);
const moodStatsSrc = extractFnFrom('moodStats', MOODS_ANCHOR);
const diaryOnSrc = extractFnFrom('diaryOn', MOODS_ANCHOR);
const diariesSortedSrc = extractFnFrom('diariesSorted', MOODS_ANCHOR);

const SUBTASK_ANCHOR = sliceFrom('var SUBTASK_DEFAULTS = {');
const SUBTASK_DEFAULTSSrc = (() => {
  const i = sliceFrom('var SUBTASK_DEFAULTS = {');
  return 'var SUBTASK_DEFAULTS = ' + extractBalanced(html, html.indexOf('{', i)) + ';';
})();
const subOptsSrc = extractFnFrom('subOpts', SUBTASK_ANCHOR);
const krProgressSrc = extractFn('krProgress');
const goalProgressSrc = extractFn('goalProgress');
const goalExpiredSrc = extractFn('goalExpired');
const goalActiveSrc = extractFn('goalActive');
const goalReviewDueSrc = extractFn('goalReviewDue');
const goalReviewTextSrc = extractFn('goalReviewText');
const goalDaysSrc = extractFn('goalDays');
const isChildSrc = extractFnFrom('isChild', SUBTASK_ANCHOR);
const childrenOfSrc = extractFnFrom('childrenOf', SUBTASK_ANCHOR);
const subtaskProgressSrc = extractFnFrom('subtaskProgress', SUBTASK_ANCHOR);
const childIdsSrc = extractFnFrom('childIds', SUBTASK_ANCHOR);

// 在隔离作用域里求值并导出
const mod = `var TimeUtil = ${TimeUtilSrc};
  ${DateUtilSrc}
  var BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  ${DAY_CNSrc}
  ${headKeysSrc}
  ${expandRangeSrc}
  ${mergeTotalSrc}
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
  ${TYPE_METASrc}
  var TYPES = Object.keys(TYPE_META);
  ${joinNonEmptySrc}
  ${hitsInSrc}
  ${describeSrc}
  ${snippetSrc}
  ${scoreOfSrc}
  ${searchAllSrc}
  ${groupResultsSrc}
  ${nextDueDateSrc}
  ${repeatExpiredSrc}
  ${sanitizeRepeatSrc}
  ${clampDayOfMonthSrc}
  ${clampFeb29Src}
  ${annivNextSrc}
  ${DEFAULT_OPTSSrc}
  ${wrapTextSrc}
  ${measureSrc}
  ${hexToRgbSrc}
  ${tintSrc}
  ${roundRectSrc}
  ${RANGESSrc}
  ${LEDGER_RANGESSrc}
  ${weekBoundsSrc}
  ${monthBoundsSrc}
  ${perDaySrc}
  ${eachDateSrc}
  ${sumDaySegmentsSrc}
  ${rangeSummarySrc}
  ${sleepByNightSrc}
  ${heatLevelSrc}
  ${MOODSSrc}
  ${MOOD_MIN_DAYSSrc}
  ${MOOD_CROSS_MIN_DAYSSrc}
  ${moodOfSrc}
  ${moodToneSrc}
  ${diaryDatePromptSrc}
  ${moodStatsSrc}
  ${diaryOnSrc}
  ${diariesSortedSrc}
  // rangeDates('term') 会读全局 state，这里给一个空壳，避免 ReferenceError
  var state = { semesters: [{ id: 's1', startDate: '2026-08-24', weeks: 20 }], currentSemesterId: 's1' };
  var Store = {
    currentSemester: function () {
      for (var i = 0; i < state.semesters.length; i++) {
        if (state.semesters[i].id === state.currentSemesterId) return state.semesters[i];
      }
      return state.semesters[0];
    }
  };
  ${rangeDatesPureSrc}
  ${compareRangePureSrc}
  // 模拟 store.js 的薄封装：把 RANGES / 当前学期注入纯函数
  function rangeDates(key, sem) {
    return rangeDatesPure(key, {
      util: DateUtil, ranges: RANGES, today: DateUtil.today(),
      semester: sem || Store.currentSemester()
    });
  }
  function compareRange(key, r) {
    return compareRangePure(key, r || rangeDates(key), { util: DateUtil, ranges: RANGES });
  }
  ${SUBTASK_DEFAULTSSrc}
  ${subOptsSrc}
  ${isChildSrc}
  ${childrenOfSrc}
  ${subtaskProgressSrc}
  ${childIdsSrc}
  ${krProgressSrc}
  ${goalProgressSrc}
  ${goalExpiredSrc}
  ${goalActiveSrc}
  ${goalReviewDueSrc}
  ${goalReviewTextSrc}
  ${goalDaysSrc}
  // stats-calc.js 的依赖注入助手：不传就用测试里已提取的 DateUtil / TimeUtil
  function D(u) { return u || DateUtil; }
  function T(u) { return u || TimeUtil; }
  var global = { Lunar: __LUNAR__ };
  globalThis.__T = { TimeUtil, DateUtil, expandRange, mergeTotal,
                     parseDay, parsePeriodNums, parseWeeks, splitRow, parseCourseTable,
                     inWeekOf, weekOverlap, timeOverlap, findConflicts,
                     icsEscape, icsFold, icsDT, icsStamp, slotOccurrences, icsTrigger, buildICS,
                     hitsIn, describe, snippet, searchAll, groupResults,
                     nextDueDate, repeatExpired, sanitizeRepeat,
                     annivNext, wrapText, measure, hexToRgb, tint,
                     subOpts, isChild, childrenOf, subtaskProgress, childIds, SUBTASK_DEFAULTS,
                     krProgress, goalProgress, goalExpired, goalActive, goalReviewDue, goalReviewText, goalDays,
                     RANGES, LEDGER_RANGES, rangeDates, compareRange, perDay, eachDate,
                     sumDaySegments, rangeSummary,
                     weekBounds, monthBounds, sleepByNight, heatLevel,
                     MOODS, MOOD_MIN_DAYS, MOOD_CROSS_MIN_DAYS, moodOf, moodTone,
                     diaryDatePrompt, moodStats, diaryOn, diariesSorted };
`;
new Function('__LUNAR__', mod)(Lunar);
const { TimeUtil, DateUtil, expandRange, mergeTotal,
        parseDay, parsePeriodNums, parseWeeks, splitRow, parseCourseTable,
        inWeekOf, weekOverlap, timeOverlap, findConflicts,
        icsEscape, icsFold, icsDT, icsStamp, slotOccurrences, icsTrigger, buildICS,
        hitsIn, describe, snippet, searchAll, groupResults,
        nextDueDate, repeatExpired, sanitizeRepeat,
        annivNext, wrapText, measure, hexToRgb, tint,
        subOpts, isChild, childrenOf, subtaskProgress, childIds, SUBTASK_DEFAULTS,
        RANGES, LEDGER_RANGES, rangeDates, compareRange, perDay, eachDate,
        sumDaySegments, rangeSummary,
        weekBounds, monthBounds, sleepByNight, heatLevel,
        MOODS, MOOD_MIN_DAYS, MOOD_CROSS_MIN_DAYS, moodOf, moodTone,
        diaryDatePrompt, moodStats, diaryOn, diariesSorted,
        krProgress, goalProgress, goalExpired, goalActive, goalReviewDue, goalReviewText,
        goalDays } = globalThis.__T;

// 断言
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

/* ==========================================================
 * CourseException（直接 import 源文件——纯模块拆分后的新测法，
 * 不再需要用括号平衡正则从 index.html 里掏代码）
 * ========================================================== */
const ceSrc = readFileSync(new URL('../assets/js/course-exception.js', import.meta.url), 'utf8');
new Function(ceSrc)();
const CE = globalThis.CourseException;

const BASE = [
  { courseId: 'c1', id: 'c1', day: 2, name: '高数', location: '教三 301' },
  { courseId: 'c2', id: 'c2', day: 2, name: '英语', location: '外语楼 204' }
];

console.log('CourseException.normalize');
eq('剔除缺 courseId 的', CE.normalize([{ type: 'cancel', date: '2026-10-01' }]), []);
eq('剔除坏日期的', CE.normalize([{ courseId: 'c1', type: 'cancel', date: '10-01' }]), []);
eq('保留合法的', CE.normalize([{ courseId: 'c1', type: 'cancel', date: '2026-10-01' }]).length, 1);

console.log('CourseException.dayEffect');
let r = CE.dayEffect(BASE, '2026-10-06', [
  { courseId: 'c1', type: 'cancel', date: '2026-10-06' }
]);
eq('停课：kept 只剩另一门', r.kept.map(c => c.courseId), ['c2']);
eq('停课：removed 带标记', r.removed.map(c => c.courseId + ':' + c._off), ['c1:cancel']);

r = CE.dayEffect(BASE, '2026-10-06', [
  { courseId: 'c1', type: 'room', date: '2026-10-06', location: '三教 402' }
]);
eq('换教室：kept 保留且覆盖地点', r.kept[0].location, '三教 402');
eq('换教室：带 _exRoom 标记', r.kept[0]._exRoom, '三教 402');
eq('换教室：不进 removed', r.removed, []);

r = CE.dayEffect(BASE, '2026-10-06', [
  { courseId: 'c2', type: 'move', date: '2026-10-06', toDate: '2026-10-10' }
]);
eq('调走：原日期移除', r.kept.map(c => c.courseId), ['c1']);
eq('调走：removed 带 _moveTo', r.removed[0]._moveTo, '2026-10-10');

eq('没例外的日子原样返回', CE.dayEffect(BASE, '2026-10-07', []).kept.length, 2);

console.log('CourseException.moveIns');
eq('调进目标日期', CE.moveIns([
  { courseId: 'c1', type: 'move', date: '2026-10-06', toDate: '2026-10-10' },
  { courseId: 'c2', type: 'move', date: '2026-10-07', toDate: '2026-10-11' }
], '2026-10-10').length, 1);
eq('停课不算调进', CE.moveIns([
  { courseId: 'c1', type: 'cancel', date: '2026-10-06', toDate: '2026-10-10' }
], '2026-10-10').length, 0);

console.log('CourseException.forCourse');
let fc = CE.forCourse([
  { courseId: 'c1', type: 'cancel', date: '2026-10-06' },
  { courseId: 'c1', type: 'room', date: '2026-10-13', location: '三教 402' },
  { courseId: 'c1', type: 'move', date: '2026-10-08', toDate: '2026-10-11' },
  { courseId: 'c2', type: 'cancel', date: '2026-10-06' }
], 'c1');
eq('excludes 去重收集三个原日期', fc.excludes, ['2026-10-06', '2026-10-13', '2026-10-08']);
eq('rooms 一条', fc.rooms.length, 1);
eq('moves 一条且带 toDate', fc.moves[0].toDate, '2026-10-11');

/* ==========================================================
 * Palette（直接 import 源文件——store.js 数据拆分的第一类：颜色/主题外置）
 * ========================================================== */
const palSrc = readFileSync(new URL('../assets/js/palette.js', import.meta.url), 'utf8');
new Function(palSrc)();
const Pal = globalThis.Palette;

console.log('Palette');
eq('预设数量为 20（课程+外观共用）', Pal.count, 20);
eq('COURSE_COLORS 与 THEME_PRESETS 同源', Pal.COURSE_COLORS, Pal.THEME_PRESETS.map(p => p.c));
eq('COURSE_COLORS 长度 20', Pal.COURSE_COLORS.length, 20);
eq('颜色均为 #RRGGBB', Pal.COURSE_COLORS.every(c => /^#[0-9a-fA-F]{6}$/.test(c)), true);
eq('key 不重复', new Set(Pal.THEME_PRESETS.map(p => p.key)).size, 20);
eq('每个预设都带 name 与 c', Pal.THEME_PRESETS.every(p => p.name && /^#[0-9a-fA-F]{6}$/.test(p.c)), true);

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

// ---- 全局搜索 ----
console.log('hitsIn（命中区间）');
eq('单个命中', hitsIn('高等数学', '数学'), [[2, 4]]);
eq('多个命中', hitsIn('数学与数学', '数学'), [[0, 2], [3, 5]]);
eq('大小写无关', hitsIn('JavaScript', 'java'), [[0, 4]]);
eq('英文小写化后位置不变', hitsIn('ABCabc', 'bc'), [[1, 3], [4, 6]]);
eq('重叠不嵌套', hitsIn('aaa', 'aa'), [[0, 2]]);
eq('没命中 -> []', hitsIn('高等数学', '英语'), []);
eq('空关键词 -> []', hitsIn('高等数学', ''), []);
eq('空文本 -> []', hitsIn('', '数学'), []);
eq('null 不炸', hitsIn(null, null), []);

console.log('snippet（长文本截摘要）');
{
  const long = 'x'.repeat(50) + '目标' + 'y'.repeat(50);
  const s = snippet(long, '目标', 30);
  eq('命中在中间：前面截断', s.head, true);
  eq('命中在中间：后面截断', s.tail, true);
  eq('窗口不超 4 倍 pad', s.text.length <= 30 * 4, true);
  eq('命中偏移归零后正确', s.hits.length, 1);
  eq('截取位置正确', ['x', 'y'].every(c => s.text.indexOf(c) >= 0), true);

  const headHit = '目标' + 'y'.repeat(50);
  const s2 = snippet(headHit, '目标', 30);
  eq('命中在开头：不补前导省略号', s2.head, false);
  eq('命中在开头：偏移为 0', s2.hits[0][0], 0);

  const s3 = snippet('abc', 'zzz', 30);
  eq('无命中时返回前 60 字', s3.text, 'abc');
  eq('无命中不标省略', s3.head, false);
}

console.log('describe（记录 → 标题/副标题/正文）');
eq('课程', describe('course', { name: '高等数学', teacher: '张老师', location: 'A301', note: '难' }),
   { title: '高等数学', sub: '张老师 · A301', body: '难' });
eq('笔记标题取首行', describe('note', { content: '第一行\n第二行' }).title, '第一行');
eq('笔记正文是全文', describe('note', { content: '第一行\n第二行' }).body, '第一行\n第二行');
eq('账目无备注用类别', describe('ledger', { category: 'food', amount: 12, date: '2025-03-03' }).title, 'food');
eq('账目副标题带金额', describe('ledger', { category: 'food', amount: 12, date: '2025-03-03' }).sub, '2025-03-03 · ¥12');
eq('未知类型不炸', describe('nope', {}), { title: '', sub: '', body: '' });
eq('null 不炸', describe('task', null), { title: '', sub: '', body: '' });

console.log('searchAll（跨集合检索）');
{
  const data = {
    courses: [{ id: 'c1', name: '高等数学', teacher: '张老师', location: 'A301', note: '' }],
    tasks: [{ id: 't1', title: '交数学作业', note: '', tags: ['学习'] }],
    events: [],
    plans: [],
    notes: [{ id: 'n1', content: '记得复习数学', tags: [] }],
    ledger: []
  };

  const r = searchAll(data, '数学');
  eq('命中 3 条', r.length, 3);
  eq('类型顺序：课程在前', [r[0].type, r[1].type], ['course', 'task']);
  eq('待办标题命中带区间', r[1].titleHits.length > 0, true);
  eq('目标视图正确', [r[0].view, r[1].view, r[2].view], ['schedule', 'tasks', 'notes']);

  // 只搜老师也能命中课程
  eq('副标题也参与匹配', searchAll(data, '张老师').length, 1);
  // 标题命中优先于正文命中
  const both = searchAll({
    courses: [{ id: 'a', name: '数学' }, { id: 'b', name: '无关', note: '数学' }],
    tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '数学');
  eq('标题命中排前面', both[0].id, 'a');

  eq('空关键词返回空', searchAll(data, '   '), []);
  eq('无命中返回空', searchAll(data, 'zzz不存在zzz'), []);
  eq('缺集合不炸', searchAll({ courses: [{ id: 'c1', name: '数学' }] }, '数学').length, 1);
  eq('limit 生效', searchAll({
    courses: [1, 2, 3, 4, 5].map(i => ({ id: 'c' + i, name: '数学' + i })),
    tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '数学', 3).length, 3);
  eq('跳过空记录', searchAll({ courses: [null, { id: 'c1', name: '数学' }] , tasks: [], events: [], plans: [], notes: [], ledger: [] }, '数学').length, 1);
}

console.log('groupResults（按类型分组）');
{
  const data = {
    courses: [{ id: 'c1', name: '数学' }, { id: 'c2', name: '数学' }],
    tasks: [{ id: 't1', title: '数学作业' }],
    events: [], plans: [], notes: [], ledger: []
  };
  const g = groupResults(searchAll(data, '数学'));
  eq('分成 2 组', g.length, 2);
  eq('第一组是课程且 2 条', [g[0].type, g[0].items.length], ['course', 2]);
  eq('第二组是待办且 1 条', [g[1].type, g[1].items.length], ['task', 1]);
  eq('空结果分组为空', groupResults([]), []);
}

console.log('nextDueDate（重复任务）');
// 传 todayStr = dueDate，验证「从原日期后推」的纯逻辑（不过滤过期）
eq('无 repeat 返回 null', nextDueDate('2026-01-01', { type: 'none' }, '2026-01-01'), null);
eq('日：+1 天', nextDueDate('2026-01-01', { type: 'daily', interval: 1 }, '2026-01-01'), '2026-01-02');
eq('日：每 3 天', nextDueDate('2026-01-01', { type: 'daily', interval: 3 }, '2026-01-01'), '2026-01-04');
eq('周：+7 天', nextDueDate('2026-01-05', { type: 'weekly', interval: 1 }, '2026-01-05'), '2026-01-12');
eq('周：每 2 周', nextDueDate('2026-01-05', { type: 'weekly', interval: 2 }, '2026-01-05'), '2026-01-19');
eq('月：1/31 + 1 -> 2/28', nextDueDate('2026-01-31', { type: 'monthly', interval: 1 }, '2026-01-31'), '2026-02-28');
eq('月：3/31 + 1 -> 4/30', nextDueDate('2026-03-31', { type: 'monthly', interval: 1 }, '2026-03-31'), '2026-04-30');
eq('月：闰年 2/29 + 1 -> 3/29（目标月够长不夹紧）', nextDueDate('2024-02-29', { type: 'monthly', interval: 1 }, '2024-02-29'), '2024-03-29');
eq('月：每 2 月', nextDueDate('2026-01-15', { type: 'monthly', interval: 2 }, '2026-01-15'), '2026-03-15');
eq('年：2024-02-29 + 1 -> 2025-02-28', nextDueDate('2024-02-29', { type: 'yearly', interval: 1 }, '2024-02-29'), '2025-02-28');
eq('年：2025-03-01 + 4 -> 2029-03-01', nextDueDate('2025-03-01', { type: 'yearly', interval: 4 }, '2025-03-01'), '2029-03-01');
eq('过期基准：从今天起算', nextDueDate('2000-01-01', { type: 'daily', interval: 1 }, '2026-10-21'), '2026-10-22');
eq('未过期基准：按原日期后推', nextDueDate('2026-12-25', { type: 'daily', interval: 1 }, '2026-10-21'), '2026-12-26');

console.log('repeatExpired');
eq('无 until 不过期', repeatExpired({ type: 'daily' }, '2099-01-01'), false);
eq('等于 until 不过期（含当天）', repeatExpired({ type: 'daily', until: '2026-12-31' }, '2026-12-31'), false);
eq('超过 until 到期', repeatExpired({ type: 'daily', until: '2026-12-31' }, '2027-01-01'), true);

console.log('sanitizeRepeat');
eq('无输入 -> 不重复', sanitizeRepeat(undefined), { type: 'none' });
eq('type=none -> 不重复', sanitizeRepeat({ type: 'none' }), { type: 'none' });
eq('非法 type -> 不重复', sanitizeRepeat({ type: 'bogus' }), { type: 'none' });
eq('正常 weekly', sanitizeRepeat({ type: 'weekly', interval: 2 }), { type: 'weekly', interval: 2 });
eq('interval 非法 -> 1', sanitizeRepeat({ type: 'daily', interval: 0 }), { type: 'daily', interval: 1 });
eq('until 非法被丢弃', sanitizeRepeat({ type: 'monthly', until: 'abc' }), { type: 'monthly', interval: 1 });

console.log('农历数据自检');
eq('selfTest 全过', Lunar.selfTest().bad, []);
eq('段数 2486', Lunar.decode().lens.length, 2486);
eq('闰月年数 74', Object.keys(Lunar.decode().leap).length, 74);

console.log('农历：春节');
eq('1900 春节', JSON.stringify(Lunar.lunarToSolar(1900, 1, 1)), '{"y":1900,"m":1,"d":31}');
eq('2023 春节', JSON.stringify(Lunar.lunarToSolar(2023, 1, 1)), '{"y":2023,"m":1,"d":22}');
eq('2024 春节', JSON.stringify(Lunar.lunarToSolar(2024, 1, 1)), '{"y":2024,"m":2,"d":10}');
eq('2025 春节', JSON.stringify(Lunar.lunarToSolar(2025, 1, 1)), '{"y":2025,"m":1,"d":29}');
eq('2026 春节', JSON.stringify(Lunar.lunarToSolar(2026, 1, 1)), '{"y":2026,"m":2,"d":17}');
eq('2100 春节', JSON.stringify(Lunar.lunarToSolar(2100, 1, 1)), '{"y":2100,"m":2,"d":9}');

console.log('农历：节日与闰月');
eq('2024 中秋 八月十五', JSON.stringify(Lunar.lunarToSolar(2024, 8, 15)), '{"y":2024,"m":9,"d":17}');
eq('2023 闰二月初一', JSON.stringify(Lunar.lunarToSolar(2023, 2, 1, true)), '{"y":2023,"m":3,"d":22}');
eq('2024 无闰二月 -> null', Lunar.lunarToSolar(2024, 2, 1, true), null);
eq('2024 闰四月不存在 -> null', Lunar.lunarToSolar(2024, 4, 1, true), null);
eq('2020 闰四月初一', JSON.stringify(Lunar.lunarToSolar(2020, 4, 1, true)), '{"y":2020,"m":5,"d":23}');
eq('2025 闰六月初一', JSON.stringify(Lunar.lunarToSolar(2025, 6, 1, true)), '{"y":2025,"m":7,"d":25}');

console.log('农历：反向转换');
eq('2024-09-17 -> 八月十五', JSON.stringify(Lunar.solarToLunar(2024, 9, 17)), '{"year":2024,"month":8,"day":15,"isLeap":false}');
eq('2023-03-22 -> 闰二月初一', JSON.stringify(Lunar.solarToLunar(2023, 3, 22)), '{"year":2023,"month":2,"day":1,"isLeap":true}');
eq('2024-02-10 -> 正月初一', JSON.stringify(Lunar.solarToLunar(2024, 2, 10)), '{"year":2024,"month":1,"day":1,"isLeap":false}');

console.log('农历：边界');
eq('超出上限 2101 -> null', Lunar.lunarToSolar(2101, 1, 1), null);
eq('超出下限 1899 -> null', Lunar.lunarToSolar(1899, 1, 1), null);
eq('月号 13 -> null', Lunar.lunarToSolar(2024, 13, 1), null);
eq('日 31 -> null', Lunar.lunarToSolar(2024, 1, 31), null);
eq('小月要 30 日 -> null', (() => {
  // 找一个 29 天的月
  for (let m = 1; m <= 12; m++) {
    const a = Lunar.lunarToSolar(2024, m, 29);
    const b = Lunar.lunarToSolar(2024, m, 30);
    if (a && !b) return true;
  }
  return false;
})(), true);

console.log('lunarInYear（纪念日顺延用）');
eq('2024 农历八月十五 -> 2024-09-17', Lunar.lunarInYear(2024, 8, 15), '2024-09-17');
eq('2025 农历八月十五 -> 2025-10-06', Lunar.lunarInYear(2025, 8, 15), '2025-10-06');
eq('闰月不存在时退回常规月', LuaNCheck(), LuaNExpect());

function LuaNCheck() {
  // 2024 没有闰二月，preferLeap=true 应退回常规二月
  return Lunar.lunarInYear(2024, 2, 1, true);
}
function LuaNExpect() { return '2024-03-10'; }

console.log('annivNext（纪念日）');
const T = '2026-10-21';
eq('无 repeat -> 原日期', annivNext({ date: '2020-05-01', repeat: 'none' }, T).next, '2020-05-01');
eq('每年：今年已过 -> 明年', annivNext({ date: '2000-05-01', repeat: 'yearly' }, T).next, '2027-05-01');
eq('每年：今年未到 -> 今年', annivNext({ date: '2000-12-25', repeat: 'yearly' }, T).next, '2026-12-25');
eq('每年：正好今天 -> 今天', annivNext({ date: '2000-10-21', repeat: 'yearly' }, T).next, '2026-10-21');
eq('每年：届数（2000 为第 1 届，2027 为第 28 届）', annivNext({ date: '2000-05-01', repeat: 'yearly' }, T).nth, 28);
eq('每年：今天算第几届', annivNext({ date: '2000-10-21', repeat: 'yearly' }, T).nth, 27);
eq('闰日 2/29 平年 -> 2/28', annivNext({ date: '2024-02-29', repeat: 'yearly' }, '2025-01-01').next, '2025-02-28');
eq('闰日 2/29 闰年 -> 2/29', annivNext({ date: '2024-02-29', repeat: 'yearly' }, '2028-01-01').next, '2028-02-29');
eq('每月：本月已过 -> 下月同日', annivNext({ date: '2024-01-05', repeat: 'monthly' }, '2026-10-21').next, '2026-11-05');
eq('每月：本月未到 -> 本月同日', annivNext({ date: '2024-01-31', repeat: 'monthly' }, '2026-10-21').next, '2026-10-31');
eq('每月：末日夹紧 11 月无 31 日', annivNext({ date: '2024-01-31', repeat: 'monthly' }, '2026-11-01').next, '2026-11-30');
eq('daysLeft 计算', annivNext({ date: '2000-10-25', repeat: 'yearly' }, T).daysLeft, 4);
eq('农历生日：今年已过 -> 明年', annivNext({ date: '1990-06-15', repeat: 'yearly', lunar: true, lunarMonth: 8, lunarDay: 15 }, T).next, '2027-09-15');
eq('农历生日：今年未到 -> 今年', annivNext({ date: '1990-06-15', repeat: 'yearly', lunar: true, lunarMonth: 8, lunarDay: 15 }, '2026-01-01').next, '2026-09-25');

console.log('课表导出：measure');
{
  const m = measure(7, 10, {});
  // pad22*2 + timeW62 + cellW132*7 = 44+62+924 = 1030
  eq('宽度 7 天 10 节', m.w, 1030);
  // pad22*2 + 标题46 + 表头62 + 行高68*10 = 44+46+62+680 = 832
  eq('高度 7 天 10 节', m.h, 832);
  const m2 = measure(7, 10, { title: false });
  eq('关标题少 46', m2.h, 832 - 46);
  const m3 = measure(5, 4, { cellW: 100, rowH: 50, pad: 10, timeW: 40, headH: 30, title: false });
  eq('自定义尺寸', [m3.w, m3.h], [10 * 2 + 40 + 100 * 5, 10 * 2 + 30 + 50 * 4]);
}

console.log('课表导出：hexToRgb / tint');
eq('hex 6 位', hexToRgb('#4f46e5'), [79, 70, 229]);
eq('hex 3 位', hexToRgb('#fff'), [255, 255, 255]);
eq('非法退回主色', hexToRgb('nope'), [79, 70, 229]);
eq('空值退回主色', hexToRgb(''), [79, 70, 229]);
eq('tint 11% 到白', tint('#4f46e5', 0.11, [255, 255, 255]), 'rgb(236,235,252)');
eq('tint 50% 到白', tint('#000000', 0.5, [255, 255, 255]), 'rgb(128,128,128)');
eq('tint 100% 保持原色', tint('#4f46e5', 1, [255, 255, 255]), 'rgb(79,70,229)');

console.log('课表导出：wrapText');
{
  // 假 ctx：每个字宽 10px，宽度 100 时每行正好 10 个字
  const ctx = { measureText: s => ({ width: s.length * 10 }) };

  eq('空字符串', wrapText(ctx, '', 100, 2), []);
  eq('短文本一行', wrapText(ctx, '高等数学', 100, 2), ['高等数学']);
  eq('刚好放下一行', wrapText(ctx, '十个字刚好放一行啊啊', 100, 2), ['十个字刚好放一行啊啊']);
  eq('超出则换行', wrapText(ctx, '十一个字刚好放一行的了', 100, 2), ['十一个字刚好放一行的', '了']);

  const long = '这是一门名字特别长的课程用于测试换行逻辑是否正常工作';
  const r = wrapText(ctx, long, 100, 2);
  eq('最多 2 行', r.length, 2);
  eq('末行有省略号', r[1].slice(-1), '…');
  eq('每行不超宽', r.every(l => l.length * 10 <= 100), true);

  const r3 = wrapText(ctx, long, 100, 3);
  eq('最多 3 行', r3.length, 3);

  // 不超 1 行时不该加省略号
  const exact = wrapText(ctx, '正好十个字啊啊啊啊', 100, 1);
  eq('恰好放满不加省略号', exact[0].slice(-1), '啊');

  // 换行符按硬换行处理
  eq('\\n 强制换行', wrapText(ctx, '第一行\n第二行', 200, 3), ['第一行', '第二行']);

  // maxLines 截断后末行收缩
  const tight = wrapText(ctx, '一二三四五六七八九十一二三四五六七八九十', 55, 2);
  eq('截断后仍不超宽', tight.every(l => l.length * 10 <= 55), true);
}


console.log('子任务：subOpts 默认值与兜底');
{
  eq('默认值', SUBTASK_DEFAULTS, { autoDoneParent: false, cascadeDone: false, orphanKeep: true, showProgress: true });

  eq('空设置回落默认', subOpts({}), SUBTASK_DEFAULTS);
  eq('settings 为 undefined 也安全', subOpts(undefined), SUBTASK_DEFAULTS);
  eq('subtask 为 undefined', subOpts({ subtask: undefined }), SUBTASK_DEFAULTS);

  // 缺字段逐项补，不能整块被覆盖
  eq('只给一项，其余补默认', subOpts({ subtask: { cascadeDone: true } }),
    { autoDoneParent: false, cascadeDone: true, orphanKeep: true, showProgress: true });

  // 脏值一律回落到默认（默认不是 false 的项要特别验）
  eq('字符串 true 不算布尔', subOpts({ subtask: { orphanKeep: 'false' } }).orphanKeep, true);
  eq('数字 1 不算布尔', subOpts({ subtask: { orphanKeep: 1 } }).orphanKeep, true);
  eq('null 回落默认', subOpts({ subtask: { orphanKeep: null } }).orphanKeep, true);
  eq('显式 false 生效', subOpts({ subtask: { orphanKeep: false } }).orphanKeep, false);
  eq('多给字段被丢掉', Object.keys(subOpts({ subtask: { foo: 1, orphanKeep: false } })).sort(),
    ['autoDoneParent', 'cascadeDone', 'orphanKeep', 'showProgress']);
}

console.log('子任务：isChild / childrenOf / subtaskProgress / childIds');
{
  eq('无 parentId 不是子任务', isChild({ id: 'a' }), false);
  eq('空字符串 parentId 不是子任务', isChild({ id: 'a', parentId: '' }), false);
  eq('有 parentId 是子任务', isChild({ id: 'a', parentId: 'p' }), true);
  eq('null 安全', isChild(null), false);

  const list = [
    { id: 'p', title: '期末复习' },
    { id: 'c1', parentId: 'p', status: 'done' },
    { id: 'c2', parentId: 'p', status: 'todo' },
    { id: 'c3', parentId: 'p', status: 'doing' },
    { id: 'q', title: '另一件事' },
    { id: 'd1', parentId: 'q', status: 'done' }
  ];
  eq('childrenOf 保持顺序', childrenOf(list, 'p').map(t => t.id), ['c1', 'c2', 'c3']);
  eq('childrenOf 无子任务返回空', childrenOf(list, 'zzz'), []);

  eq('进度 1/4 的 done 计数', subtaskProgress(list, 'p'), { total: 3, done: 1, pct: 33, allDone: false });
  eq('全完成 pct=100', subtaskProgress(list, 'q'), { total: 1, done: 1, pct: 100, allDone: true });
  eq('无子任务不算 allDone', subtaskProgress(list, 'zzz'), { total: 0, done: 0, pct: 0, allDone: false });

  // pct 向下取整：2/3 -> 66，不是 67
  const l2 = [{ id: 'p' }, { id: 'a', parentId: 'p', status: 'done' },
              { id: 'b', parentId: 'p', status: 'done' }, { id: 'c', parentId: 'p', status: 'todo' }];
  eq('2/3 取整为 66', subtaskProgress(l2, 'p').pct, 66);

  eq('childIds 只收子任务', Object.keys(childIds(list)).sort(), ['c1', 'c2', 'c3', 'd1']);
  eq('childIds 不含父任务', childIds(list)['p'], undefined);
}


console.log('统计口径：RANGES / weekBounds / monthBounds / rangeDates');
{
  eq('今天口径是单日', RANGES.day.days, 1);
  eq('本周是自然周（cal）', RANGES.week.mode, 'cal');
  eq('本月是自然月（cal）', RANGES.month.mode, 'cal');
  eq('本学期是 cal 口径', RANGES.term.mode, 'cal');
  eq('最近 30 天是滑动窗口', RANGES.recent30.mode, 'win');
  eq('记账四档', LEDGER_RANGES, ['day', 'week', 'month', 'recent30']);
  eq('记账不再有 season', LEDGER_RANGES.indexOf('season'), -1);

  // 2026-10-21 是周三
  const wed = new Date(2026, 9, 21);
  const wb = weekBounds(wed);
  eq('自然周从周一开始', DateUtil.toStr(wb.from), '2026-10-19');
  eq('自然周到周日结束', DateUtil.toStr(wb.to), '2026-10-25');

  // 周日属于「本周」而不是下一周
  const sun = new Date(2026, 9, 25);
  eq('周日仍属本周', DateUtil.toStr(weekBounds(sun).from), '2026-10-19');

  const mb = monthBounds(wed);
  eq('自然月从 1 号开始', DateUtil.toStr(mb.from), '2026-10-01');
  eq('自然月到月末', DateUtil.toStr(mb.to), '2026-10-31');

  // 2 月闰年
  eq('闰年 2 月 29 天', DateUtil.toStr(monthBounds(new Date(2028, 1, 10)).to), '2028-02-29');
  eq('平年 2 月 28 天', DateUtil.toStr(monthBounds(new Date(2026, 1, 10)).to), '2026-02-28');
}

console.log('统计口径：rangeDates 的 to 截到今天，不把未来算进分母');
{
  // 期望按「今天」动态计算：写死具体日期会在跨天后必然失败（今天 = D，周从周一起算）
  const today = DateUtil.today();
  const td = DateUtil.toStr(today);
  const wbNow = weekBounds(today);
  const dayCount = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

  const rw = rangeDates('week');
  eq('本周 from', rw.from, DateUtil.toStr(wbNow.from));
  eq('本周 to 今天（不是周日）', rw.to, td);
  eq('本周天数 = 周一到今天', rw.days, dayCount(rw.from, td));

  const rm = rangeDates('month');
  const firstOfMonth = td.slice(0, 8) + '01';
  eq('本月 from 1 号', rm.from, firstOfMonth);
  eq('本月 to 今天', rm.to, td);
  eq('本月天数 = 1 号到今天', rm.days, dayCount(firstOfMonth, td));

  const rt = rangeDates('term');
  eq('本学期 from 开学日', rt.from, '2026-08-24');
  eq('本学期 to 今天', rt.to, td);

  const r30 = rangeDates('recent30');
  const d30 = DateUtil.addDays(today, -29);
  eq('最近 30 天含今天', r30.days, 30);
  eq('最近 30 天 to', r30.to, td);
  eq('最近 30 天 from', r30.from, DateUtil.toStr(d30));

  const rd = rangeDates('day');
  eq('今天 from=to', rd.from, rd.to);

  // 未知 key 回落 week，且不炸
  eq('未知 key 回落本周', rangeDates('nope').key, 'week');
}

console.log('统计口径：compareRange 往前挪一个周期');
{
  const today = DateUtil.today();
  const td = DateUtil.toStr(today);
  const rw = rangeDates('week');
  const pw = compareRange('week', rw);
  const prevWeekFrom = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(rw.from), -7));
  eq('上周 from（往前一周）', pw.from, prevWeekFrom);
  eq('上周 to 周日（完整一周）', pw.to, DateUtil.toStr(DateUtil.addDays(DateUtil.parse(rw.from), -1)));
  eq('上周 7 天', pw.days, 7);

  const rd = compareRange('day');
  const yesterday = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  eq('今天 → 昨天', [rd.from, rd.to, rd.days], [yesterday, yesterday, 1]);

  // 本月只过了 N 天 → 上月也截到 N 天，否则「本月 vs 上月」永远输
  const rm = rangeDates('month');
  const pm = compareRange('month', rm);
  const prevMonthFirst = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  eq('上月 from', pm.from, DateUtil.toStr(prevMonthFirst));
  eq('上月截到与本月的天数一致', pm.to.slice(8), rm.to.slice(8));
  eq('上月比较段天数与本月一致', pm.days, rm.days);

  // 1 月的上月是去年 12 月
  const jan = { from: '2027-01-01', to: '2027-01-15', days: 15, key: 'month', mode: 'cal' };
  const pjan = compareRange('month', jan);
  eq('1 月的上月是去年 12 月', pjan.from, '2026-12-01');
  eq('跨年上月截到 15 号', pjan.to, '2026-12-15');

  // 本学期没有可比的上一段
  eq('本学期不比较', compareRange('term', rangeDates('term')), null);

  // 滑动窗口：紧邻的等长区间
  const r30 = rangeDates('recent30');
  const p30 = compareRange('recent30', r30);
  eq('滑动窗口参照段等长', p30.days, 30);
  eq('滑动窗口参照段紧邻前一段', p30.to, DateUtil.toStr(DateUtil.addDays(today, -30)));
  eq('滑动窗口参照段 from', p30.from, DateUtil.toStr(DateUtil.addDays(today, -59)));
}

console.log('统计口径：eachDate 区间展开');
{
  eq('三天含两端', eachDate('2026-10-01', '2026-10-03').length, 3);
  eq('首日正确', eachDate('2026-10-01', '2026-10-03')[0], '2026-10-01');
  eq('末日正确', eachDate('2026-10-01', '2026-10-03')[2], '2026-10-03');
  eq('跨月连续', eachDate('2026-08-30', '2026-09-02').join(','), '2026-08-30,2026-08-31,2026-09-01,2026-09-02');
  eq('反向区间为空', eachDate('2026-10-03', '2026-10-01').length, 0);
  eq('非法输入为空', eachDate('xx', 'yy').length, 0);
}

console.log('统计口径：sumDaySegments 单日汇总');
{
  // 23:00–07:00 的课跨午夜，expandRange 会拆成两段；合并后仍是 480 分钟
  const s = sumDaySegments({
    sleep: 420,
    course: expandRange('23:00', '07:00'),
    event: [],
    activity: [[9 * 60, 10 * 60]],
    meal: [[12 * 60, 12 * 60 + 30]]
  });
  const by = {};
  s.segments.forEach(x => { by[x.key] = x.minutes; });
  eq('睡眠原样', by.sleep, 420);
  eq('跨午夜课程合并为 480', by.course, 480);
  eq('活动 60', by.activity, 60);
  eq('用餐 30', by.meal, 30);
  eq('未记录 = 1440 - 已记', by.idle, 1440 - (420 + 480 + 60 + 30));
  eq('recorded 不含 idle', s.recorded, 420 + 480 + 60 + 30);
  eq('段数固定 6 段', s.segments.length, 6);
  eq('末段是 idle', s.segments[5].key, 'idle');

  // 全都为空：整天未记录
  const empty = sumDaySegments({});
  eq('空输入 idle = 1440', empty.idle, 1440);
  eq('空输入 recorded = 0', empty.recorded, 0);

  // 重叠区间只算一次
  const overlap = sumDaySegments({ activity: [[600, 660], [630, 720]] });
  eq('重叠活动合并为 120', overlap.segments.filter(x => x.key === 'activity')[0].minutes, 120);

  // 超过 1440 不出现负的未记录
  const over = sumDaySegments({ sleep: 1500 });
  eq('超额时 idle 不为负', over.idle, 0);
}

console.log('统计口径：rangeSummary 区间汇总');
{
  const d1 = sumDaySegments({ sleep: 420, activity: [[600, 660]] });
  const d2 = sumDaySegments({ sleep: 480, activity: [[600, 720]] });
  const r = rangeSummary([
    { date: '2026-10-20', segments: d1.segments },
    { date: '2026-10-21', segments: d2.segments }
  ], DateUtil);
  const by = {};
  r.segments.forEach(x => { by[x.key] = x.minutes; });
  eq('天数 = 2', r.days, 2);
  eq('总容量 = 2 × 1440', r.total, 2880);
  eq('睡眠累加', by.sleep, 900);
  eq('活动累加', by.activity, 180);
  eq('recorded 不含 idle', r.recorded, 900 + 180);
  eq('pct 按总容量算', r.pct, Math.round((900 + 180) / 2880 * 100));
  eq('daily 每天一条', r.daily.length, 2);
  eq('daily 带 date', r.daily[1].date, '2026-10-21');
  eq('daily 的 recorded', r.daily[0].recorded, 420 + 60);
  eq('daily 的 idle', r.daily[0].idle, 1440 - 480);

  const zero = rangeSummary([], DateUtil);
  eq('空区间 pct = 0', zero.pct, 0);
  eq('空区间 days = 0', zero.days, 0);
}

console.log('统计口径：perDay 日均');
{
  eq('0 天安全', perDay(100, 0), 0);
  eq('7 天 700 分钟 = 100', perDay(700, 7), 100);
  eq('保留一位小数', perDay(100, 3), 33.3);
  eq('四舍五入到一位', perDay(100, 7), 14.3);
  eq('结果为 0', perDay(0, 30), 0);
}

console.log('统计口径：sleepByNight 跨午夜按实际归属拆到两天');
{
  const sleeps = [
    { id: 'a', date: '2026-10-20', start: '23:00', end: '07:00' }   // 1 号睡、2 号醒
  ];
  // 入睡当天只算 23:00–24:00 = 60 分钟
  eq('入睡当晚算 60 分钟', sleepByNight(sleeps, '2026-10-20'), 60);
  // 次日算 00:00–07:00 = 420 分钟
  eq('次晨算 420 分钟', sleepByNight(sleeps, '2026-10-21'), 420);
  // 第三天不该再有
  eq('第三天归零', sleepByNight(sleeps, '2026-10-22'), 0);
  // 两天合起来必须等于整觉 8 小时，不能多也不能少
  eq('两段相加等于整觉', sleepByNight(sleeps, '2026-10-20') + sleepByNight(sleeps, '2026-10-21'), 480);

  // 不跨午夜：当天全算
  const day = [{ id: 'b', date: '2026-10-21', start: '13:00', end: '14:30' }];
  eq('白天的午睡全算当天', sleepByNight(day, '2026-10-21'), 90);
  eq('午睡不影响次日', sleepByNight(day, '2026-10-22'), 0);

  // 两晚各一段，不能串
  const two = [
    { id: 'c', date: '2026-10-19', start: '23:30', end: '06:30' },  // 30 + 390
    { id: 'd', date: '2026-10-20', start: '23:00', end: '07:00' }   // 60 + 420
  ];
  eq('连住两晚，第 2 天 = 前夜余下 390 + 当晚 60', sleepByNight(two, '2026-10-20'), 390 + 60);
  eq('连住两晚，第 3 天 = 420', sleepByNight(two, '2026-10-21'), 420);

  // 缺失 / 脏数据不炸
  eq('空数组', sleepByNight([], '2026-10-20'), 0);
  eq('缺 end 跳过', sleepByNight([{ date: '2026-10-20', start: '23:00' }], '2026-10-20'), 0);
  eq('非法日期返回 0', sleepByNight(sleeps, 'xx'), 0);

  // 同一晚两段重叠，合并后不重复计时
  const dup = [
    { id: 'e', date: '2026-10-20', start: '23:00', end: '07:00' },
    { id: 'f', date: '2026-10-20', start: '23:30', end: '06:00' }
  ];
  eq('同晚重叠段只算一次', sleepByNight(dup, '2026-10-20'), 60);
}

console.log('统计口径：heatLevel 绝对刻度');
{
  eq('0 分钟 = 0 级', heatLevel(0), 0);
  eq('负数也当 0 级', heatLevel(-10), 0);
  eq('1 小时 = 1 级', heatLevel(60), 1);
  eq('3 小时 = 1 级', heatLevel(180), 1);
  eq('4 小时（<20% 的 16h）', heatLevel(4 * 60), 2);
  // 分级阈值：16h 的 20% / 40% / 65% → 3.2h / 6.4h / 10.4h
  eq('6.4 小时刚好进 3 级', heatLevel(6.4 * 60), 3);
  eq('6.3 小时还在 2 级', heatLevel(6.3 * 60), 2);
  eq('10.4 小时刚好满格', heatLevel(10.4 * 60), 4);
  eq('10.3 小时还是 3 级', heatLevel(10.3 * 60), 3);
  eq('16 小时满格', heatLevel(16 * 60), 4);
  eq('超过 16 小时仍封顶 4 级', heatLevel(20 * 60), 4);
  // 关键回归：各周都是 9.9 小时时，旧实现（按本次最大值归一化）会全部顶到最深一档
  eq('9.9 小时不是满格', heatLevel(9.9 * 60), 3);
  eq('两档有明显区分', heatLevel(9.9 * 60) < heatLevel(11.9 * 60), true);
}

console.log('\n日记心情：MOODS 枚举与映射');
{
  eq('五档心情', MOODS.length, 5);
  eq('顺序固定（分数 5→1）', MOODS.map(m => m.key), ['great', 'good', 'meh', 'tired', 'low']);
  eq('每档都有名字', MOODS.every(m => m.name && m.emoji), true);
  eq('每档都有颜色', MOODS.every(m => /^#[0-9a-f]{6}$/i.test(m.color)), true);
  eq('颜色互不相同', new Set(MOODS.map(m => m.color)).size, 5);
  eq('冷暖只三档', MOODS.every(m => ['warm', 'neutral', 'cold'].includes(m.tone)), true);
  eq('首档偏暖', moodTone('great'), 'warm');
  eq('末档偏冷', moodTone('low'), 'cold');
  eq('中间是中性', moodTone('meh'), 'neutral');
  eq('未知心情归类为空', moodTone('nope'), '');
  eq('moodOf 未知返回 null', moodOf('nope'), null);
  eq('moodOf 命中返回对象', moodOf('tired').name, '疲惫');
  eq('样本门槛 7', MOOD_MIN_DAYS, 7);
  eq('交叉门槛更严', MOOD_CROSS_MIN_DAYS > MOOD_MIN_DAYS, true);
}

console.log('日记心情：凌晨归属判定');
{
  // 0–3 点才问，4 点起不再问
  eq('0 点要问', diaryDatePrompt(0, '2026-10-21', '').ask, true);
  eq('3 点要问', diaryDatePrompt(3, '2026-10-21', '').ask, true);
  eq('4 点不问', diaryDatePrompt(4, '2026-10-21', '').ask, false);
  eq('白天不问', diaryDatePrompt(14, '2026-10-21', '').ask, false);
  eq('23 点不问', diaryDatePrompt(23, '2026-10-21', '').ask, false);
  eq('不问时 suggest 就是今天', diaryDatePrompt(14, '2026-10-21', '').suggest, '2026-10-21');
  eq('不问时两个选项相同', diaryDatePrompt(14, '2026-10-21', '').other, '2026-10-21');

  // 凌晨新建：默认今天，另一个是昨天
  const a = diaryDatePrompt(1, '2026-10-21', '');
  eq('凌晨新建默认今天', a.suggest, '2026-10-21');
  eq('凌晨新建另一个是昨天', a.other, '2026-10-20');
  // 已经在写「昨天」那篇：默认继续昨天，不能把用户改回今天
  const b2 = diaryDatePrompt(1, '2026-10-21', '2026-10-20');
  eq('在写昨天则默认昨天', b2.suggest, '2026-10-20');
  eq('此时另一个是今天', b2.other, '2026-10-21');
  // 两个选项永远不同（否则弹窗问了等于没问）
  ['2026-10-21', '2026-10-20', '2026-10-19'].forEach(function (d) {
    eq('选项必有差异 @' + d, diaryDatePrompt(2, '2026-10-21', d).suggest !== diaryDatePrompt(2, '2026-10-21', d).other, true);
  });
  // 跨月 / 跨年边界
  eq('跨月：10-01 凌晨的昨天是 09-30', diaryDatePrompt(2, '2026-10-01', '').other, '2026-09-30');
  eq('跨年：01-01 凌晨的昨天是上一年', diaryDatePrompt(2, '2027-01-01', '').other, '2026-12-31');
}

console.log('日记心情：moodStats 统计');
{
  const ds = [
    { id: '1', date: '2026-10-01', content: 'a', mood: 'great' },
    { id: '2', date: '2026-10-02', content: 'b', mood: 'good' },
    { id: '3', date: '2026-10-03', content: '',    mood: 'good' },
    { id: '4', date: '2026-10-04', content: 'c', mood: 'meh' },
    { id: '5', date: '2026-10-05', content: 'd' },            // 没标心情
    { id: '6', date: '2026-10-06', content: 'e', mood: 'tired' },
    { id: '7', date: '2026-10-07', content: 'f', mood: 'low' },
    { id: '8', date: '2026-10-08', content: 'g', mood: 'great' },
    { id: '9', date: '2026-10-09', content: 'h', mood: 'good' },
    { id: '10', date: '2026-11-02', content: '范围外', mood: 'low' }
  ];
  const st = moodStats(ds, '2026-10-01', '2026-10-31');
  eq('区间内天数', st.days, 9);
  eq('标了心情的天数', st.rated, 8);
  eq('有正文的天数', st.withText, 8);
  eq('great 计数', st.counts.great, 2);
  eq('good 计数', st.counts.good, 3);
  eq('low 计数', st.counts.low, 1);
  eq('区间外的日记不算进来', st.counts.low, 1);
  // 分数：5*2 + 4*3 + 3*1 + 2*1 + 1*1 = 10+12+3+2+1 = 28 / 8 = 3.5
  eq('平均分（按 1–5 映射）', st.avg, 3.5);
  eq('够 7 天可展示', st.eligible, true);
  eq('还差 0 天', st.need, 0);
  eq('最常出现的是还行', st.top, 'good');
  eq('冷暖归类：暖', st.tones.warm, 2);
  eq('冷暖归类：中性', st.tones.neutral, 4);
  eq('冷暖归类：冷', st.tones.cold, 2);
  eq('选项计数字段齐全', Object.keys(st.counts).sort(), ['good', 'great', 'low', 'meh', 'tired']);

  // 不满 7 天：不展示，但要告诉用户还差几天
  const few = moodStats(ds.slice(0, 3), '2026-10-01', '2026-10-31');
  eq('只标 3 天不给统计', few.eligible, false);
  eq('提示还差 4 天', few.need, 4);
  const none = moodStats([], '2026-10-01', '2026-10-31');
  eq('空数据不炸', none.days, 0);
  eq('空数据平均分 0', none.avg, 0);
  eq('空数据也提示差 7 天', none.need, 7);
  eq('空数据 top 为空', none.top, '');

  // 脏数据：未知心情键不算，缺 content 不算有正文
  const dirty = moodStats([
    { date: '2026-10-01', mood: 'unknown', content: 'x' },
    { date: '2026-10-02', mood: 'good' },
    null,
    { mood: 'good' }
  ], '2026-10-01', '2026-10-31');
  eq('未知心情键被忽略', dirty.rated, 1);
  eq('缺少 date 的条目被跳过', dirty.days, 2);

  // 并列时取顺序靠前的，保证渲染稳定
  const tie = moodStats([
    { date: '2026-10-01', mood: 'low' },
    { date: '2026-10-02', mood: 'great' }
  ], '2026-10-01', '2026-10-31');
  eq('并列取靠前档', tie.top, 'great');
}

console.log('日记：一天一篇相关');
{
  const ds = [
    { id: 'a', date: '2026-10-03', content: 'x' },
    { id: 'b', date: '2026-10-01', content: 'y' },
    { id: 'c', date: '2026-10-02', content: 'z' }
  ];
  eq('按日期找得到', diaryOn(ds, '2026-10-02').id, 'c');
  eq('找不到返回 null', diaryOn(ds, '2026-10-09'), null);
  eq('空数组返回 null', diaryOn([], '2026-10-01'), null);
  eq('倒序：最新在前', diariesSorted(ds).map(d => d.date), ['2026-10-03', '2026-10-02', '2026-10-01']);
  eq('倒序不改原数组', ds[0].date, '2026-10-03');
  eq('同一天出现两条时取第一条（防历史脏数据）', diaryOn([
    { id: 'x1', date: '2026-10-01' }, { id: 'x2', date: '2026-10-01' }
  ], '2026-10-01').id, 'x1');
}


/* ==========================================================
 * 14) hash 深链接（router.js 的纯函数）
 *    地址是「装到桌面后一键直达」的载体，写错一个字符就会落到别的页，
 *    所以解析、拼装、校验三条都得单独盯住。
 * ========================================================== */
console.log('Router：地址解析与拼装');
{
  const routerSrc = (() => {
    const at = sliceFrom('Router：URL hash 深链接');
    const aliasOpen = html.indexOf('{', html.indexOf('var ALIAS =', at));
    const aliasSrc = 'var ALIAS = ' + extractBalanced(html, aliasOpen) + ';';
    const parts = ['segOf', 'parse', 'build', 'resolve'].map(n => extractFnFrom(n, at)).join('\n');
    return '(function(){' + aliasSrc + '\n' + parts + '\nreturn { parse: parse, build: build, resolve: resolve };})()';
  })();
  const R = new Function('return ' + routerSrc)();

  eq('parse #/today', R.parse('#/today'), { id: 'today', tab: null });
  eq('parse 允许省略 #', R.parse('/today'), { id: 'today', tab: null });
  eq('parse 大小写归一', R.parse('#/TODAY'), { id: 'today', tab: null });
  eq('parse 带分页', R.parse('#/tasks/diary'), { id: 'tasks', tab: 'diary' });
  eq('parse 分页大小写归一', R.parse('#/tasks/DIARY'), { id: 'tasks', tab: 'diary' });
  eq('parse 末尾斜杠不算分页', R.parse('#/tasks/'), { id: 'tasks', tab: null });
  eq('别名 diary → tasks/diary', R.parse('#/diary'), { id: 'tasks', tab: 'diary' });
  eq('别名 notes → tasks/notes', R.parse('#/notes'), { id: 'tasks', tab: 'notes' });
  eq('别名 inspiration → tasks/notes', R.parse('#/inspiration'), { id: 'tasks', tab: 'notes' });
  eq('别名后面再挂分页也按别名走', R.parse('#/diary/whatever'), { id: 'tasks', tab: 'diary' });
  eq('空串 → null', R.parse(''), null);
  eq('裸 # → null', R.parse('#'), null);
  eq('只有 #/ → null', R.parse('#/'), null);
  eq('没有 #/ 的锚点不接管', R.parse('#section'), null);
  eq('undefined → null', R.parse(undefined), null);
  eq('空白串 → null', R.parse('   '), null);

  eq('build 单段', R.build('today'), '#/today');
  eq('build 两段', R.build('tasks', 'diary'), '#/tasks/diary');
  eq('build 无分页不带斜杠', R.build('tasks', null), '#/tasks');
  eq('build(空分页) 不带斜杠', R.build('tasks', ''), '#/tasks');
  eq('parse∘build 往返', R.parse(R.build('tasks', 'diary')), { id: 'tasks', tab: 'diary' });

  eq('resolve 命中', R.resolve('#/today', ['today', 'tasks']), { id: 'today', tab: null });
  eq('resolve 别名折回真实视图', R.resolve('#/diary', ['today', 'tasks']), { id: 'tasks', tab: 'diary' });
  eq('resolve 视图不存在 → null', R.resolve('#/nope', ['today', 'tasks']), null);
  eq('resolve 非法地址 → null', R.resolve('#nope', ['today']), null);
  eq('resolve 空地址 → null', R.resolve('', ['today']), null);
}


/* ==========================================================
 * 15) 目标与关键结果（store.js 的纯函数）
 *    进度算法是这个功能唯一「算数」的地方，错一点整页都是假数据。
 * ========================================================== */
console.log('目标：关键结果与总进度');
{
  const ctx = {
    from: '2026-09-01', to: '2027-01-15', today: '2026-10-21',
    plans: [
      { id: 'p1', target: 20, unit: '次', records: [
        { date: '2026-08-20', value: 5 },   // 周期前，不该算
        { date: '2026-09-10', value: 2 },
        { date: '2026-10-10', value: 3 },
        { date: '2026-12-10', value: 4 }    // 未来，不该算
      ] },
      { id: 'p2', target: 2, unit: '', records: [
        { date: '2026-09-02', value: 1 }, { date: '2026-09-03', value: 1 }
      ] }
    ],
    tasks: [
      { id: 't1', title: 'a', status: 'done', dueDate: '2026-09-10', tags: ['学习/数学'] },
      { id: 't2', title: 'b', status: 'todo', dueDate: '2026-09-20', tags: ['学习/数学'] },
      { id: 't3', title: 'c', status: 'done', dueDate: '2026-09-25', tags: ['生活'] },
      { id: 't4', title: 'd', status: 'todo', dueDate: '2026-09-26', tags: ['学习/数学'], parentId: 't1' },
      { id: 't5', title: 'e', status: 'done', dueDate: '2026-02-01', tags: ['学习/数学'] },  // 周期外
      { id: 't6', title: 'f', status: 'done', tags: ['学习/数学'] },                        // 没有截止日期
      { id: 't7', title: 'g', status: 'done', dueDate: '2026-09-30', tags: ['学习/数学'], courseId: 'c9' }
    ]
  };

  /* --- 自己填 --- */
  eq('自填：8/20 = 40%', krProgress({ kind: 'manual', target: 20, current: 8 }, ctx).pct, 0.4);
  eq('自填：超过目标按 100% 封顶', krProgress({ kind: 'manual', target: 10, current: 13 }, ctx).pct, 1);
  eq('自填：负数按 0', krProgress({ kind: 'manual', target: 10, current: -5 }, ctx).pct, 0);
  eq('自填：目标为 0 时按 1 兜底', krProgress({ kind: 'manual', target: 0, current: 0 }, ctx).pct, 0);
  eq('自填：没填过就是 0%', krProgress({ kind: 'manual', target: 10 }, ctx).pct, 0);

  /* --- 挂计划 --- */
  const kp = krProgress({ kind: 'plan', planId: 'p1' }, ctx);
  eq('挂计划：只算周期内的打卡', kp.value, 5);
  eq('挂计划：目标是计划自己的目标', kp.target, 20);
  eq('挂计划：5/20 = 25%', kp.pct, 0.25);
  eq('挂计划：单位跟随计划', kp.unit, '次');
  eq('挂计划：目标被删了标 missing', krProgress({ kind: 'plan', planId: 'gone' }, ctx).missing, true);
  eq('挂计划：目标被删了 pct 为 null（不参与平均）', krProgress({ kind: 'plan', planId: 'gone' }, ctx).pct, null);
  eq('挂计划：已完成时封顶 100%', krProgress({ kind: 'plan', planId: 'p2' }, ctx).pct, 1);

  /* --- 挂待办 --- */
  const kt = krProgress({ kind: 'task', tags: ['学习/数学'] }, ctx);
  eq('挂待办：子任务不重复计', kt.target, 3);          // t1/t2/t7；t4 是子任务，t5 周期外，t6 无截止
  eq('挂待办：完成数对', kt.value, 2);                 // t1/t7 完成
  eq('挂待办：2/3', Math.round(kt.pct * 100), 67);
  eq('挂待办：不限标签时含全部周期内顶层任务',
    krProgress({ kind: 'task' }, ctx).target, 4);      // t1/t2/t3/t7
  eq('挂待办：按课程过滤',
    krProgress({ kind: 'task', tags: ['学习/数学'], courseId: 'c9' }, ctx).target, 1);
  eq('挂待办：没有命中时标 empty', krProgress({ kind: 'task', tags: ['不存在'] }, ctx).empty, true);
  eq('挂待办：没有命中时 pct 为 null', krProgress({ kind: 'task', tags: ['不存在'] }, ctx).pct, null);

  /* --- 总进度：等权平均 --- */
  const g1 = { krs: [
    { id: 'k1', title: 'A', kind: 'manual', target: 20, current: 8 },   // 0.40
    { id: 'k2', title: 'B', kind: 'manual', target: 100, current: 72 }  // 0.72
  ] };
  eq('总进度：(40+72)/2 = 56%', goalProgress(g1, ctx).pct, 56);
  eq('总进度：counted 是参与平均的条数', goalProgress(g1, ctx).counted, 2);
  eq('总进度：rows 保持顺序', goalProgress(g1, ctx).rows.map(r => r.id), ['k1', 'k2']);

  const g2 = { krs: [
    { id: 'k1', title: 'A', kind: 'manual', target: 10, current: 5 },
    { id: 'k2', title: 'B', kind: 'plan', planId: 'gone' },             // null，不进分母
    { id: 'k3', title: 'C', kind: 'task', tags: ['不存在'] }             // null，不进分母
  ] };
  eq('总进度：没有数据的 KR 不进分母', goalProgress(g2, ctx).pct, 50);
  eq('总进度：总数仍显示 3 条', goalProgress(g2, ctx).total, 3);
  eq('总进度：可统计只有 1 条', goalProgress(g2, ctx).counted, 1);
  eq('总进度：全都没数据时是 0% 而不是崩', goalProgress({ krs: [{ kind: 'plan', planId: 'x' }] }, ctx).pct, 0);
  eq('总进度：没有 KR 时是 0%', goalProgress({ krs: [] }, ctx).pct, 0);

  /* --- 到期与归档 --- */
  eq('到期：结束当天仍在办', goalExpired({ endDate: '2026-10-21' }, '2026-10-21'), false);
  eq('到期：第二天算过期', goalExpired({ endDate: '2026-10-21' }, '2026-10-22'), true);
  eq('到期：没有结束日不算过期', goalExpired({}, '2026-10-22'), false);
  eq('在办：普通目标', goalActive({ endDate: '2027-01-01' }, '2026-10-21'), true);
  eq('在办：归档后不算', goalActive({ endDate: '2027-01-01', archivedAt: '2026-10-01' }, '2026-10-21'), false);
  eq('在办：过期后不算', goalActive({ endDate: '2026-09-01' }, '2026-10-21'), false);

  /* --- 月末复盘 --- */
  const cfg = { goals: { monthlyReview: true, reviewDismissed: '' } };
  eq('复盘：10/31 是月底', goalReviewDue(cfg, '2026-10-31'), true);
  eq('复盘：10/29 已进最后三天', goalReviewDue(cfg, '2026-10-29'), true);
  eq('复盘：10/28 还差一天（31 天的月）', goalReviewDue(cfg, '2026-10-28'), false);
  eq('复盘：2 月按实际天数算（28 天月）', goalReviewDue(cfg, '2026-02-26'), true);
  eq('复盘：2 月 25 号还不提醒', goalReviewDue(cfg, '2026-02-25'), false);
  eq('复盘：闰年 2/29 也认得', goalReviewDue(cfg, '2028-02-27'), true);
  eq('复盘：当月点过不再提醒', goalReviewDue({ goals: { monthlyReview: true, reviewDismissed: '2026-10' } }, '2026-10-31'), false);
  eq('复盘：上个月点过不影响这个月',
    goalReviewDue({ goals: { monthlyReview: true, reviewDismissed: '2026-09' } }, '2026-10-31'), true);
  eq('复盘：开关关掉就不提醒', goalReviewDue({ goals: { monthlyReview: false } }, '2026-10-31'), false);
  eq('复盘：设置缺字段时默认开', goalReviewDue({}, '2026-10-31'), true);

  const txt = goalReviewText([{ title: '把高数补上来', pct: 62 }], '2026-10-21');
  eq('复盘文案：标题带月份', txt.split('\n')[0], '【10 月目标复盘】');
  eq('复盘文案：每条一行百分比', txt.split('\n')[1], '· 把高数补上来：62%');
}


console.log('目标：周期天数（决定发不发积分）');
{
  eq('同一天算 1 天', goalDays({ startDate: '2026-10-01', endDate: '2026-10-01' }), 1);
  eq('一周正好 7 天', goalDays({ startDate: '2026-10-01', endDate: '2026-10-07' }), 7);
  eq('6 天不够发分门槛', goalDays({ startDate: '2026-10-01', endDate: '2026-10-06' }), 6);
  eq('跨月也对', goalDays({ startDate: '2026-09-28', endDate: '2026-10-04' }), 7);
  eq('跨年也对', goalDays({ startDate: '2026-12-30', endDate: '2027-01-02' }), 4);
  eq('缺字段返回 0', goalDays({ startDate: '2026-10-01' }), 0);
  eq('空对象返回 0', goalDays({}), 0);
}


console.log('统计：今年档（自然年口径）');
{
  const nowD = new Date();
  const Y = nowD.getFullYear();
  const yr = rangeDates('year');
  eq('year 从 1 月 1 日起', yr.from, Y + '-01-01');
  eq('year 截到今天（不把未来空白天算进分母）', yr.to, DateUtil.toStr(nowD));
  const cr = compareRange('year', yr);
  eq('year 的参照是去年同长区间', cr.days, yr.days);
  eq('year 参照从去年 1 月 1 日起', cr.from, (Y - 1) + '-01-01');
  eq('month 档不受影响', rangeDates('month').key, 'month');
  eq('term 档仍不做对比', compareRange('term', rangeDates('term')), null);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
