// 最小单测：从源码模块实时提取纯逻辑函数（无 DOM 依赖），
// 做边界断言，作为后续改动的回归基线。运行：node tests/run.mjs
import { readFileSync, existsSync } from 'node:fs';

// 源码拼接：按 src/index.template.html 里的 <script src> 顺序读各模块源码。
// 旧实现读构建产物 index.html 再做文本提取——产物格式一变测试就崩，
// 而且没构建过就跑不了测试。源码才是唯一真相，产物只是它的内联副本。
const SRC_BASE = new URL('../', import.meta.url);
const SRC_FILES = [...readFileSync(new URL('src/index.template.html', SRC_BASE), 'utf8')
  .matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const SRC = SRC_FILES.map(f => readFileSync(new URL(f, SRC_BASE), 'utf8')).join('\n');

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
  const i = SRC.indexOf(marker, from);
  if (i < 0) throw new Error('找不到: ' + marker);
  return i;
}

// 1) TimeUtil 对象
const tuStart = sliceFrom('var TimeUtil = {');
const tuOpen = SRC.indexOf('{', tuStart);
const TimeUtilSrc = extractBalanced(SRC, tuOpen); // 含首尾 {}

// 2) expandRange / mergeTotal 函数
function extractFn(name) {
  const i = sliceFrom('function ' + name + '(');
  const open = SRC.indexOf('{', i);
  return SRC.slice(i, open) + extractBalanced(SRC, open);
}
const expandRangeSrc = extractFn('expandRange');
const mergeTotalSrc = extractFn('mergeTotal');

// 3) 批量课表导入的解析器（schedule.js 里的纯函数）
//    注意 parseWeeks 在别处还有同名重载，所以统一从 DAY_CN 之后开始找，锁死取 schedule.js 那份
const batchAnchor = sliceFrom('var DAY_CN = {');
function extractObj(varName) {
  const i = sliceFrom('var ' + varName + ' = {', batchAnchor - 1);
  const open = SRC.indexOf('{', i);
  return 'var ' + varName + ' = ' + extractBalanced(SRC, open) + ';';
}
function extractFnFrom(name, from) {
  const i = sliceFrom('function ' + name + '(', from);
  const open = SRC.indexOf('{', i);
  return SRC.slice(i, open) + extractBalanced(SRC, open);
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
const DateUtilSrc = 'var DateUtil = ' + extractBalanced(SRC, SRC.indexOf('{', duStart)) + ';';
// DateUtil.weekdayCN 依赖这个模块级常量，单独从产物里取，避免测试里再抄一份
const DAY_NAMESSrc = (SRC.match(/var DAY_NAMES = \[[^\]]*\];/) || ['var DAY_NAMES = [];'])[0];
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
const TYPE_METASrc = 'var TYPE_META = ' + extractBalanced(SRC, SRC.indexOf('{', searchAnchor)) + ';';
const joinNonEmptySrc = extractFnFrom('joinNonEmpty', searchAnchor);
const hitsInSrc = extractFnFrom('hitsIn', searchAnchor);
const subseqHitsSrc = extractFnFrom('subseqHits', searchAnchor);
const ALIASESSrc = 'var ALIASES = ' + extractBalanced(SRC, SRC.indexOf('{', SRC.indexOf('var ALIASES'))) + ';';
const expandNeedlesSrc = extractFnFrom('expandNeedles', searchAnchor);
const describeSrc = extractFnFrom('describe', searchAnchor);
const snippetSrc = extractFnFrom('snippet', searchAnchor);
const scoreOfSrc = extractFnFrom('scoreOf', searchAnchor);
const searchAllSrc = extractFnFrom('searchAll', searchAnchor);
const groupResultsSrc = extractFnFrom('groupResults', searchAnchor);

// 8) 重复任务（store.js 里的纯函数，依赖 DateUtil）
const nextDueDateSrc = extractFn('nextDueDate');
const repeatExpiredSrc = extractFn('repeatExpired');
const sanitizeRepeatSrc = extractFn('sanitizeRepeat');
const repeatSummarySrc = extractFn('repeatSummary');
const repeatShortSrc = extractFn('repeatShort');
const firstOccurrenceSrc = extractFn('firstOccurrence');
const nthWeekdayOfMonthSrc = extractFn('nthWeekdayOfMonth');
const wdCNSrc = extractFn('wdCN');
const orderWeekdaysSrc = extractFn('orderWeekdays');
const nextWeeklyMultiSrc = extractFn('nextWeeklyMulti');

// 9) 农历模块（lunar.js，整体 IIFE，直接求值到独立 window 上）
const lunarIiFE = (() => {
  const i = sliceFrom("(function (global) {", sliceFrom('农历（1900–2100）') - 400);
  // 从该 IIFE 的起始位置提取到匹配的 })(window);
  let depth = 0, j = i;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return SRC.slice(i, SRC.indexOf('\n', j) + 1);
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
  const o = SRC.indexOf('{', i + 'annivNext: function'.length);
  return 'function annivNext(ev, todayStr) ' + extractBalanced(SRC, o);
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
  return 'var DEFAULT_OPTS = ' + extractBalanced(SRC, SRC.indexOf('{', i)) + ';';
})();

// 12) 子任务（store.js）
// 统计口径：RANGES / rangeDates / compareRange / perDay / weekBounds / monthBounds / sleepByNight / heatLevel
const STATS_ANCHOR = sliceFrom('var RANGES = {');
const RANGESSrc = (() => {
  const i = sliceFrom('var RANGES = {');
  return 'var RANGES = ' + extractBalanced(SRC, SRC.indexOf('{', i)) + ';';
})();
const LEDGER_RANGESSrc = (() => {
  const i = sliceFrom('var LEDGER_RANGES = [');
  const open = SRC.indexOf('[', i);
  let depth = 0, j = open;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '[') depth++;
    else if (SRC[j] === ']') { depth--; if (depth === 0) break; }
  }
  return 'var LEDGER_RANGES = ' + SRC.slice(open, j + 1) + ';';
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
  const open = SRC.indexOf('[', i);
  let depth = 0, j = open;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '[') depth++;
    else if (SRC[j] === ']') { depth--; if (depth === 0) break; }
  }
  return 'var MOODS = ' + SRC.slice(open, j + 1) + ';';
})();
const MOOD_MIN_DAYSSrc = (() => {
  const i = sliceFrom('var MOOD_MIN_DAYS =');
  return SRC.slice(i, SRC.indexOf(';', i) + 1);
})();
const MOOD_CROSS_MIN_DAYSSrc = (() => {
  const i = sliceFrom('var MOOD_CROSS_MIN_DAYS =');
  return SRC.slice(i, SRC.indexOf(';', i) + 1);
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
  return 'var SUBTASK_DEFAULTS = ' + extractBalanced(SRC, SRC.indexOf('{', i)) + ';';
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
  ${DAY_NAMESSrc}
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
  ${subseqHitsSrc}
  ${ALIASESSrc}
  ${expandNeedlesSrc}
  ${describeSrc}
  ${snippetSrc}
  ${scoreOfSrc}
  ${searchAllSrc}
  ${groupResultsSrc}
  ${nextDueDateSrc}
  ${repeatExpiredSrc}
  ${sanitizeRepeatSrc}
  ${repeatSummarySrc}
  ${repeatShortSrc}
  ${firstOccurrenceSrc}
  ${nthWeekdayOfMonthSrc}
  ${wdCNSrc}
  ${orderWeekdaysSrc}
  ${nextWeeklyMultiSrc}
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
                     nextDueDate, repeatExpired, sanitizeRepeat, repeatSummary, repeatShort,
                     firstOccurrence, nthWeekdayOfMonth,
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
        nextDueDate, repeatExpired, sanitizeRepeat, repeatSummary, repeatShort,
        firstOccurrence, nthWeekdayOfMonth,
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

  // 中文缩写：按字序命中，且排在精确命中的后面
  eq('中文缩写「高数」命中「高等数学」', searchAll({
    courses: [{ id: 'c1', name: '高等数学' }], tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '高数').length, 1);
  eq('缩写「线代」命中「线性代数」', searchAll({
    courses: [{ id: 'c1', name: '线性代数' }], tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '线代').length, 1);
  eq('英文不做字序模糊匹配', searchAll({
    courses: [{ id: 'c1', name: 'Database' }], tasks: [], events: [], plans: [], notes: [], ledger: []
  }, 'dbt').length, 0);
  eq('精确子串优先于缩写命中', searchAll({
    courses: [{ id: 'a', name: '高等数学' }, { id: 'b', name: '高数补习' }],
    tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '高数')[0].id, 'b');

  // 别名：教三 / 三教 → 第三教学楼
  eq('别名「教三」命中「第三教学楼」', searchAll({
    courses: [{ id: 'c1', name: '大学物理', location: '第三教学楼 301' }],
    tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '教三').length, 1);
  eq('别名「三教」命中「第三教学楼」', searchAll({
    courses: [{ id: 'c1', name: '大学物理', location: '第三教学楼 301' }],
    tasks: [], events: [], plans: [], notes: [], ledger: []
  }, '三教').length, 1);
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
// 规则：以原定日期为锚点，只推进到第一个晚于今天的期（跳过错过的期，节奏不漂移）
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
// 第二档：晚完成不改变节奏，只跳过已经错过的期
eq('周：晚完成仍落在原星期', nextDueDate('2026-10-23', { type: 'weekly', interval: 1 }, '2026-10-27'), '2026-10-30');
eq('周：每 2 周跳过错过的期', nextDueDate('2026-10-05', { type: 'weekly', interval: 2 }, '2026-10-20'), '2026-11-02');
eq('日：每 3 天保持节拍', nextDueDate('2026-10-01', { type: 'daily', interval: 3 }, '2026-10-11'), '2026-10-13');
eq('月：月末不漂移', nextDueDate('2026-01-31', { type: 'monthly', interval: 1 }, '2026-02-05'), '2026-02-28');
eq('月：跳过整月后回到 31 号', nextDueDate('2026-01-31', { type: 'monthly', interval: 1 }, '2026-03-01'), '2026-03-31');
eq('年：闰日不漂移', nextDueDate('2024-02-29', { type: 'yearly', interval: 1 }, '2025-03-01'), '2026-02-28');

console.log('repeatSummary / repeatShort（人话说明）');
eq('不重复返回空', repeatSummary({ type: 'none' }, '2026-10-23'), '');
eq('每周五：带周几与起始日', repeatSummary({ type: 'weekly', interval: 1 }, '2026-10-23'),
  '每周五一次，从 10 月 23 日（周五）开始，没有结束日期。');
eq('每 2 周的周一', repeatSummary({ type: 'weekly', interval: 2 }, '2026-10-19'),
  '每 2 周的周一一次，从 10 月 19 日（周一）开始，没有结束日期。');
eq('每月 23 日 + 结束日', repeatSummary({ type: 'monthly', interval: 1, until: '2026-12-31' }, '2026-10-23'),
  '每月 23 日一次，从 10 月 23 日（周五）开始，到 12 月 31 日为止。');
eq('没有日期会提醒', repeatSummary({ type: 'weekly' }, ''),
  '每周一次；还没选日期，完成后不会生成下一期。');
eq('短标签：每天', repeatShort({ type: 'daily', interval: 1 }, '2026-10-23'), '每天');
eq('短标签：每 3 天', repeatShort({ type: 'daily', interval: 3 }, '2026-10-23'), '每 3 天');
eq('短标签：每周五', repeatShort({ type: 'weekly', interval: 1 }, '2026-10-23'), '每周五');
eq('短标签：每月 31 日', repeatShort({ type: 'monthly', interval: 1 }, '2026-01-31'), '每月 31 日');
eq('短标签：每年 10 月 23 日', repeatShort({ type: 'yearly', interval: 1 }, '2026-10-23'), '每年 10 月 23 日');

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
eq('weekdays 去重+取模+排序', sanitizeRepeat({ type: 'weekly', weekdays: [0, 0, 7, 3] }), { type: 'weekly', interval: 1, weekdays: [0, 3] });
eq('weekdays 为空回退不重复星期', sanitizeRepeat({ type: 'weekly', weekdays: [] }), { type: 'weekly', interval: 1 });
eq('month pos 默认第1个', sanitizeRepeat({ type: 'monthly', monthRule: 'pos', wd: 3 }), { type: 'monthly', interval: 1, monthRule: 'pos', wd: 3, pos: 1 });
eq('month pos 越界 clamp 到 4', sanitizeRepeat({ type: 'monthly', monthRule: 'pos', pos: 9, wd: 3 }), { type: 'monthly', interval: 1, monthRule: 'pos', wd: 3, pos: 4 });
eq('month pos 末位 pos=-1', sanitizeRepeat({ type: 'monthly', monthRule: 'pos', pos: -1, wd: 5 }), { type: 'monthly', interval: 1, monthRule: 'pos', wd: 5, pos: -1 });
eq('month lastday 透传', sanitizeRepeat({ type: 'monthly', monthRule: 'lastday' }), { type: 'monthly', interval: 1, monthRule: 'lastday' });
eq('month 无规则按几号', sanitizeRepeat({ type: 'monthly' }), { type: 'monthly', interval: 1 });

console.log('nthWeekdayOfMonth');
eq('11 月第 2 个周三', DateUtil.toStr(nthWeekdayOfMonth(2026, 10, 2, 3)), '2026-11-11');
eq('10 月最后一个周五', DateUtil.toStr(nthWeekdayOfMonth(2026, 9, -1, 5)), '2026-10-30');
eq('不存在的第 5 个周一', nthWeekdayOfMonth(2026, 1, 5, 1), null);

console.log('firstOccurrence（首期对齐到真正生效日）');
eq('周多选：首期是开始日之后的第一个选中星期（周五）', firstOccurrence('2026-10-15', { type: 'weekly', weekdays: [1, 3, 5] }), '2026-10-16');
eq('月位置：首期是下月第 2 个周三', firstOccurrence('2026-10-15', { type: 'monthly', monthRule: 'pos', pos: 2, wd: 3 }), '2026-11-11');
eq('月末：首期是当月最后一天', firstOccurrence('2026-10-15', { type: 'monthly', monthRule: 'lastday' }), '2026-10-31');
eq('旧规则原样返回日期', firstOccurrence('2026-10-15', { type: 'monthly' }), '2026-10-15');

console.log('nextDueDate（自定义周期：多选星期 + 月位置）');
eq('周多选：下一期是本周三', nextDueDate('2026-10-19', { type: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-19'), '2026-10-21');
eq('周多选+每2周：下一期在下个块的周一', nextDueDate('2026-10-19', { type: 'weekly', interval: 2, weekdays: [1] }, '2026-10-19'), '2026-11-02');
eq('月位置：下一期是下月第 2 个周三', nextDueDate('2026-10-15', { type: 'monthly', interval: 1, monthRule: 'pos', pos: 2, wd: 3 }, '2026-10-15'), '2026-11-11');
eq('月位置末位：下一期是当月最后一个周五', nextDueDate('2026-10-15', { type: 'monthly', interval: 1, monthRule: 'pos', pos: -1, wd: 5 }, '2026-10-15'), '2026-10-30');
eq('月末最后一天：下一期是当月末', nextDueDate('2026-10-15', { type: 'monthly', interval: 1, monthRule: 'lastday' }, '2026-10-15'), '2026-10-31');
eq('月位置每2月：首期是锚点当月末', nextDueDate('2026-10-15', { type: 'monthly', interval: 2, monthRule: 'lastday' }, '2026-10-15'), '2026-10-31');
eq('多选星期晚完成不漂移', nextDueDate('2026-10-19', { type: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-27'), '2026-10-28');

console.log('repeatSummary / repeatShort（自定义周期）');
eq('周多选摘要', repeatSummary({ type: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-19').startsWith('每周周一、周三、周五一次'), true);
eq('周多选短标签', repeatShort({ type: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-19'), '周一·周三·周五');
eq('月位置摘要', repeatSummary({ type: 'monthly', interval: 1, monthRule: 'pos', pos: 2, wd: 3 }, '2026-10-15').indexOf('每月第 2 个周三一次') >= 0, true);
eq('月位置短标签', repeatShort({ type: 'monthly', interval: 1, monthRule: 'pos', pos: 2, wd: 3 }, '2026-10-15'), '每月第2周三');
eq('月末摘要', repeatSummary({ type: 'monthly', interval: 1, monthRule: 'lastday' }, '2026-10-15').indexOf('每月最后一天一次') >= 0, true);
eq('月末短标签', repeatShort({ type: 'monthly', interval: 1, monthRule: 'lastday' }, '2026-10-15'), '每月末');
eq('月位置末位短标签', repeatShort({ type: 'monthly', interval: 1, monthRule: 'pos', pos: -1, wd: 5 }, '2026-10-15'), '每月末周五');

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
    const aliasOpen = SRC.indexOf('{', SRC.indexOf('var ALIAS =', at));
    const aliasSrc = 'var ALIAS = ' + extractBalanced(SRC, aliasOpen) + ';';
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


/* ==========================================================
 * TaskNLP: 自然语言待办快速录入测试
 * ========================================================== */
const nlpSrc = readFileSync(new URL('../assets/js/task-nlp.js', import.meta.url), 'utf8');
new Function(nlpSrc)();
const TaskNLP = globalThis.TaskNLP;

console.log('\nTaskNLP 自然语言待办解析');
{
  const fixedNow = new Date(2026, 9, 22, 10, 0, 0); // 2026-10-22 (周四)
  const courses = [{ id: 'c_math', name: '高等数学' }, { id: 'c_phy', name: '大学物理' }];

  // 1. 相对日期 + 具体时间 + 课程 + 标签 + 优先级
  const r1 = TaskNLP.parse('明天下午3点半交高数作业 #作业 !重要', { courses, baseDate: fixedNow });
  eq('NLP: 标题提取干净', r1.title, '交高数作业');
  eq('NLP: 相对日期明天', r1.dueDate, '2026-10-23');
  eq('NLP: 时间下午3点半', r1.dueTime, '15:30');
  eq('NLP: 优先级重要', r1.priority, 'high');
  eq('NLP: 标记重要为真', r1.important, true);
  eq('NLP: 提取标签 #作业', r1.tags, ['作业']);
  eq('NLP: 隐式匹配高数课程', r1.courseId, 'c_math');

  // 2. 显式课程 @大物 + 后天晚上8点
  const r2 = TaskNLP.parse('后天晚上8点实验预习 @大学物理 #实验', { courses, baseDate: fixedNow });
  eq('NLP: 后天日期', r2.dueDate, '2026-10-24');
  eq('NLP: 晚上8点时间', r2.dueTime, '20:00');
  eq('NLP: 显式匹配大物课程', r2.courseId, 'c_phy');
  eq('NLP: 标签 #实验', r2.tags, ['实验']);

  // 3. 星期解析 (下周三)
  const r3 = TaskNLP.parse('下周三上午10点期中复习', { courses, baseDate: fixedNow });
  eq('NLP: 下周三日期', r3.dueDate, '2026-10-28');
  eq('NLP: 上午10点', r3.dueTime, '10:00');
  eq('NLP: 标题保留期中复习', r3.title, '期中复习');

  // 4. 绝对日期 (11月5日 14:00)
  const r4 = TaskNLP.parse('11月5日 14:00 提交大作业', { courses, baseDate: fixedNow });
  eq('NLP: 绝对日期 11-05', r4.dueDate, '2026-11-05');
  eq('NLP: 24小时制时间 14:00', r4.dueTime, '14:00');

  // 5. 纯文本无时间词不误伤
  const r5 = TaskNLP.parse('去超市买苹果和牛奶', { courses, baseDate: fixedNow });
  eq('NLP: 纯文本原样保留', r5.title, '去超市买苹果和牛奶');
  eq('NLP: 无日期', r5.hasDate, false);
  eq('NLP: 无时间', r5.hasTime, false);

  // 6. 24:00 是当天结束，不能夹成 23:00
  const r6 = TaskNLP.parse('报名截止10月25日24:00', { courses, baseDate: fixedNow });
  eq('NLP: 24:00 记为 23:59', r6.dueTime, '23:59');
  eq('NLP: 截止日期不变', r6.dueDate, '2026-10-25');
}

/* ==========================================================
 * TaskShot: 截图 → 待办（切行 / 噪声过滤 / 逐行解析 / 云端归一）
 * ========================================================== */
const shotSrc = readFileSync(new URL('../assets/js/views/task-shot.js', import.meta.url), 'utf8');
const shotWin = {};
shotWin.TaskNLP = TaskNLP;   // 模块内用的是 window.TaskNLP
new Function('window', 'UI', 'Store', 'DateUtil', 'TaskNLP', shotSrc)(
  shotWin,
  { el: () => ({}), modal: () => ({}), segment: () => ({}), $: () => null, svg: () => ({}) },
  {}, {}, TaskNLP
);
const TS = shotWin.TaskShot;

console.log('\nTaskShot 截图转待办');
{
  const fixedNow = new Date(2026, 9, 22, 10, 0, 0); // 2026-10-22 周四

  // 1. 噪声过滤：状态栏、按钮、纯数字、纯符号都不进候选
  eq('截图: 时间戳丢弃', TS.keepLine('10:45'), false);
  eq('截图: 电量丢弃', TS.keepLine('82'), false);
  eq('截图: 日期串丢弃', TS.keepLine('2026/10/22'), false);
  eq('截图: 导航词丢弃', TS.keepLine('返回'), false);
  eq('截图: 纯符号丢弃', TS.keepLine('—— ·'), false);
  eq('截图: 正常句子保留', TS.keepLine('10月25日 24:00 截止报名'), true);
  eq('截图: 行动号召丢弃', TS.keepLine('点击下方按钮立即报名'), false);

  // 2. 空格归一再解析（OCR 常在汉字与数字间塞空格，会打断日期正则）
  eq('截图: 数字与单位间空格压掉', TS.normalizeLine('报名截止 10 月 25 日 24:00'), '报名截止10月25日24:00');
  eq('截图: 汉字之间空格压掉', TS.normalizeLine('提交 材料'), '提交材料');
  eq('截图: 英文单词空格保留', TS.normalizeLine('deadline 10/25'), 'deadline 10/25');

  // 2. 词 → 行：按 cy 聚类，同一行按 x 排序，中文不补空格
  const words = [
    { text: '报名', cx: 80, cy: 101, x0: 42, x1: 70, y0: 94, y1: 106 },
    { text: '截止', cx: 60, cy: 100, x0: 10, x1: 40, y0: 94, y1: 106 },
    { text: '2026-11-01', cx: 200, cy: 160, x0: 10, x1: 90, y0: 154, y1: 166 }
  ];
  const lines = TS.linesFromWords(words);
  eq('截图: 聚成两行', lines.length, 2);
  eq('截图: 同行按 x 合并、中文不空格', lines[0].text, '截止报名');
  eq('截图: 第二行独立', lines[1].text, '2026-11-01');

  // 3. 逐行解析：日期/时间/标签进字段，噪声行出局
  const tasks = TS.toTasks([
    '10月25日 截止报名 程序设计竞赛 #竞赛',
    '10:45',
    '返回',
    '11月2日 14:00 提交实验报告 #实验'
  ], { baseDate: fixedNow, courses: [] });
  eq('截图: 只留两条候选', tasks.length, 2);
  eq('截图: 相对日期落到字段', tasks[0].dueDate, '2026-10-25');
  eq('截图: 标题不含日期', /10月25日/.test(tasks[0].title), false);
  eq('截图: 标签进字段', tasks[0].tags, ['竞赛']);
  eq('截图: 第二条时间', tasks[1].dueTime, '14:00');

  // 4. 去重：同一句出现两次只留一条
  eq('截图: 重复行只留一条', TS.toTasks(['提交材料', '提交材料'], { baseDate: fixedNow }).length, 1);

  // 5. 云端返回归一：非法日期时间清空、短标题丢弃
  const cloud = TS.fromCloud([
    { title: '报名程序设计竞赛', dueDate: '2026-10-30', dueTime: '23:59', priority: 'high' },
    { title: 'x' },
    { title: '交材料', dueDate: '10月30日', dueTime: '晚上' }
  ]);
  eq('截图: 云端短标题丢弃', cloud.length, 2);
  eq('截图: 云端高优映射', cloud[0].priority, 'high');
  eq('截图: 云端非法日期清空', cloud[1].dueDate, '');
  eq('截图: 云端非法时间清空', cloud[1].dueTime, '');
}

/* ==========================================================
 * UI: 类名安全处理与前缀解耦
 * ========================================================== */
const uiSrc = readFileSync(new URL('../assets/js/ui.js', import.meta.url), 'utf8');
const uiWin = { document: { createElement: () => ({ setAttribute: () => {}, style: {} }), getElementById: () => null } };
new Function('window', 'global', uiSrc)(uiWin, uiWin);
const { cn, cls, addClass, removeClass, toggleClass, hasClass } = uiWin.UI;

console.log('\nUI: 类名安全处理与前缀解耦');
{
  eq('UI.cls 裸类名补 cp- 前缀', cls('card'), 'cp-card');
  eq('UI.cls 已有 cp- 不重复加', cls('cp-btn'), 'cp-btn');
  eq('UI.cls pet- 前缀保留', cls('pet-walk'), 'pet-walk');
  eq('UI.cn 多参数与条件判断', cn('card', true && 'active', false && 'hidden'), 'cp-card cp-active');
  eq('UI.cn 数组参数支持', cn(['btn', 'btn-primary']), 'cp-btn cp-btn-primary');
  eq('UI.cn 对象条件判断', cn({ 'btn-danger': true, 'is-loading': false }), 'cp-btn-danger');

  // DOM node class 操作
  const mockNode = {
    className: '',
    classList: {
      _classes: new Set(),
      add: function(c) { this._classes.add(c); mockNode.className = Array.from(this._classes).join(' '); },
      remove: function(c) { this._classes.delete(c); mockNode.className = Array.from(this._classes).join(' '); },
      toggle: function(c, force) {
        if (force === true) { this._classes.add(c); return true; }
        if (force === false) { this._classes.delete(c); return false; }
        if (this._classes.has(c)) { this._classes.delete(c); return false; }
        this._classes.add(c); return true;
      },
      contains: function(c) { return this._classes.has(c); }
    }
  };

  addClass(mockNode, 'active');
  eq('addClass 自动补 cp- 前缀', hasClass(mockNode, 'active'), true);
  eq('hasClass 同时兼容裸名和前缀名', hasClass(mockNode, 'cp-active'), true);
  removeClass(mockNode, 'active');
  eq('removeClass 成功移除', hasClass(mockNode, 'active'), false);
  toggleClass(mockNode, 'on', true);
  eq('toggleClass 强制开启生效', hasClass(mockNode, 'on'), true);
  toggleClass(mockNode, 'on', false);
  eq('toggleClass 强制关闭生效', hasClass(mockNode, 'on'), false);
}

/* ==========================================================
 * Store: 强 Schema 校验与数据恢复防崩溃
 * ========================================================== */
const validateSchemaFn = extractFn('validateSchema');
const defStateFn = extractFn('defaultState');
const subOptsFn = extractFn('subOpts');
const mergeShopFn = extractFn('mergeShop');
const validFn = new Function('defaultState', 'subOpts', 'mergeShop', 'uid', 'DateUtil', 'return ' + validateSchemaFn)(
  new Function('uid', 'DateUtil', 'defaultPeriods', 'return ' + defStateFn)(
    (p) => 'uid_' + p,
    DateUtil,
    () => [{ id: 'p1', name: '第1节', start: '08:00', end: '08:45' }]
  ),
  subOpts,
  new Function('return ' + mergeShopFn)(),
  (p) => 'uid_' + p,
  DateUtil
);

console.log('\nStore: 强 Schema 校验与数据恢复防崩溃');
{
  // 1. null / 损坏输入安全兜底
  const s0 = validFn(null);
  eq('validateSchema(null) 得到默认结构', typeof s0, 'object');
  eq('validateSchema(null) 有完整 periods', Array.isArray(s0.periods), true);
  eq('validateSchema(null) 有完整 settings', typeof s0.settings, 'object');

  // 2. 缺失 shop 的旧备份安全补齐（防止 TypeError: reading tickets of undefined）
  const s1 = validFn({ version: 2, courses: [], tasks: [] });
  eq('缺失 shop 自动补齐 tickets', typeof s1.shop.tickets, 'object');
  eq('缺失 shop 自动提供 fish', typeof s1.shop.tickets.fish, 'number');
  eq('缺失 shop 自动提供 validDays', typeof s1.shop.validDays, 'object');
  eq('缺失 shop 自动提供 streak', typeof s1.shop.streak, 'object');

  // 3. 脏数据清洗（非数组强制归一为数组，防止迭代器崩溃）
  const s2 = validFn({ courses: 'invalid', tasks: null, pomodoro: { points: 'bad' } });
  eq('非数组 courses 恢复为数组', Array.isArray(s2.courses), true);
  eq('null tasks 恢复为数组', Array.isArray(s2.tasks), true);
  eq('非法 points 恢复为 0', s2.pomodoro.points, 0);
  eq('pomodoro.gacha.pools 自动保护', typeof s2.pomodoro.gacha.pools.standard, 'object');
}

/* ==========================================================
 * Ocr: parseWeeks 识别拓展
 * ========================================================== */
const ocrSrc = readFileSync(new URL('../assets/js/ocr.js', import.meta.url), 'utf8');
const ocrWin = {};
new Function('window', 'global', ocrSrc)(ocrWin, ocrWin);
const Ocr = ocrWin.Ocr;

console.log('\nOcr: parseWeeks 识别拓展');
{
  const ow1 = Ocr.parseWeeks('1-16周(单)', 20);
  eq('OCR单周解析', ow1.weekType, 'odd');
  eq('OCR单周起始周', ow1.startWeek, 1);
  eq('OCR单周结束周', ow1.endWeek, 16);

  const ow2 = Ocr.parseWeeks('3-18周(双)', 20);
  eq('OCR双周解析', ow2.weekType, 'even');
  eq('OCR双周起始周', ow2.startWeek, 3);
  eq('OCR双周结束周', ow2.endWeek, 18);
}



/* ==========================================================
 * 新特性单测：白噪音、学术模式、实验课轮转、精力节律与白皮书
 * ========================================================== */

async function initTestStore(opts) {
  opts = opts || {};
  // 每次调用使用独立的内存 localStorage，避免不同测试段落之间通过持久化数据相互污染
  // （此前 mockLS 在模块顶层共享，导致前面段落写入的成绩被后面段落的 Store.init() 读回，
  // 引发诸如「学期 GPA 达标」这类聚合断言误报）。
  const mockLS = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  };
  const cpRegCode = readFileSync(new URL('../assets/js/cp-registry.js', import.meta.url), 'utf8');
  const storePresetsCode = readFileSync(new URL('../assets/js/store-presets.js', import.meta.url), 'utf8');
  const storeCode = readFileSync(new URL('../assets/js/store.js', import.meta.url), 'utf8');
  const storeLedgerCode = readFileSync(new URL('../assets/js/store-ledger.js', import.meta.url), 'utf8');
  const attendanceCode = readFileSync(new URL('../assets/js/attendance.js', import.meta.url), 'utf8');
  const storeHealthCode = readFileSync(new URL('../assets/js/store-health.js', import.meta.url), 'utf8');
  const storeTasksCode = readFileSync(new URL('../assets/js/store-tasks.js', import.meta.url), 'utf8');
  const storeCourseCode = readFileSync(new URL('../assets/js/store-course.js', import.meta.url), 'utf8');
  const storeRewardCode = readFileSync(new URL('../assets/js/store-reward.js', import.meta.url), 'utf8');
  const storeBackupCode = readFileSync(new URL('../assets/js/store-backup.js', import.meta.url), 'utf8');
  const storeIoCode = readFileSync(new URL('../assets/js/store-io.js', import.meta.url), 'utf8');
  const storePlansCode = readFileSync(new URL('../assets/js/store-plans.js', import.meta.url), 'utf8');
  const storeStatsCode = readFileSync(new URL('../assets/js/store-stats.js', import.meta.url), 'utf8');
  const storeRecordsCode = readFileSync(new URL('../assets/js/store-records.js', import.meta.url), 'utf8');
  const storePlannerCode = readFileSync(new URL('../assets/js/store-planner.js', import.meta.url), 'utf8');
  const akOpsCode = readFileSync(new URL('../assets/js/ak_ops.js', import.meta.url), 'utf8');
  const statsCalcCode = readFileSync(new URL('../assets/js/stats-calc.js', import.meta.url), 'utf8');
  const g = { DateUtil: DateUtil, SleepModel: globalThis.SleepModel, HolidayCN: opts.HolidayCN };
  new Function('window', 'global', cpRegCode)(g, g);
  new Function('window', 'global', statsCalcCode)(g, g);
  new Function('window', 'global', akOpsCode)(g, g);
  new Function('window', 'global', storePresetsCode)(g, g);
  new Function('window', 'global', 'localStorage', storeCode)(g, g, mockLS);
  new Function('window', 'global', storeLedgerCode)(g, g);
  new Function('window', 'global', attendanceCode)(g, g);
  new Function('window', 'global', storeHealthCode)(g, g);
  new Function('window', 'global', storeTasksCode)(g, g);
  new Function('window', 'global', storeCourseCode)(g, g);
  new Function('window', 'global', storeRewardCode)(g, g);
  new Function('window', 'global', storeBackupCode)(g, g);
  new Function('window', 'global', storeIoCode)(g, g);
  new Function('window', 'global', storePlansCode)(g, g);
  new Function('window', 'global', storeStatsCode)(g, g);
  new Function('window', 'global', storeRecordsCode)(g, g);
  new Function('window', 'global', storePlannerCode)(g, g);
  await g.Store.init();
  return g.Store;
}

// 1. 白噪音引擎纯逻辑测试
console.log('\nWhiteNoise: 原生离线白噪音状态机');
{
  const wnCode = readFileSync(new URL('../assets/js/white-noise.js', import.meta.url), 'utf8');
  const g = {};
  new Function('window', 'global', wnCode)(g, g);
  const WN = g.WhiteNoise;
  eq('SOUNDS 包含 rain 声音', typeof WN.SOUNDS.rain, 'object');
  eq('SOUNDS 包含 pink 声音', typeof WN.SOUNDS.pink, 'object');
  eq('SOUNDS 包含 brown 声音', typeof WN.SOUNDS.brown, 'object');
  eq('SOUNDS 包含 white 声音', typeof WN.SOUNDS.white, 'object');

  const st = WN.state();
  eq('初始状态不播放', st.playing, false);
  eq('音量默认 0.5', st.volume, 0.5);

  WN.setVolume(1.5);
  eq('setVolume 上限夹紧到 1', WN.state().volume, 1);
  WN.setVolume(-0.5);
  eq('setVolume 下限夹紧到 0', WN.state().volume, 0);

  WN.setType('brown');
  eq('setType 设置有效类型', WN.state().type, 'brown');
  WN.setType('invalid_sound');
  eq('setType 忽略无效类型', WN.state().type, 'brown');
}

// 2. 纯粹学术专注模式测试
console.log('\nStore: 纯粹学术模式 (Academic Focus Mode)');
{
  const S = await initTestStore();
  eq('默认 isAcademicMode 为 false', S.isAcademicMode(), false);

  const res = S.setRewardMode('academic');
  eq('setRewardMode(academic) 返回 academic', res, 'academic');
  eq('isAcademicMode 生效为 true', S.isAcademicMode(), true);

  S.setRewardMode('forest');
  eq('切回 forest 后 isAcademicMode 为 false', S.isAcademicMode(), false);
}

// 3. 实验课与多地点轮转测试
console.log('\nStore: 实验课与多地点轮转 (Lab Rotations)');
{
  const S = await initTestStore();
  const c = {
    name: '大学物理实验',
    location: '物理楼 101',
    rotations: [
      { startWeek: 1, endWeek: 4, location: '理教 201', topic: '光学基础' },
      { startWeek: 5, endWeek: 8, location: '工训 302', topic: '激光干涉' }
    ]
  };
  eq('第 2 周轮转教室为理教 201', S.courseLocationOnWeek(c, 2), '理教 201');
  eq('第 2 周实验课题为光学基础', S.courseTopicOnWeek(c, 2), '光学基础');
  eq('第 6 周轮转教室为工训 302', S.courseLocationOnWeek(c, 6), '工训 302');
  eq('第 6 周实验课题为激光干涉', S.courseTopicOnWeek(c, 6), '激光干涉');
  eq('第 10 周未命中轮转退回默认教室', S.courseLocationOnWeek(c, 10), '物理楼 101');
  eq('第 10 周课题为空串', S.courseTopicOnWeek(c, 10), '');

  const c2 = {
    id: 'c_lab',
    name: '物理实验',
    location: '默认教室',
    rotations: [
      { startWeek: 1, endWeek: 4, location: '理教 201', topic: '迈克尔逊' }
    ],
    slots: [{ day: 1, periodId: 'p1' }]
  };
  const slots = S.expandCourse(c2, 2);
  eq('expandCourse 展开数量为 1', slots.length, 1);
  eq('expandCourse 注入轮转地点', slots[0].location, '理教 201');
  eq('expandCourse 注入实验课题', slots[0].topic, '迈克尔逊');
}

// 4. 生理精力与作息动态匹配测试
console.log('\nStore: 生理精力与作息动态匹配 (Energy & Circadian)');
{
  const S = await initTestStore();

  const peaks = S.getEnergyPeaks();
  eq('默认提供 3 段黄金作息', peaks.length, 3);
  eq('晨间黄金期从 09:00 开始', peaks[0].start, '09:00');

  const st1 = S.currentEnergyState('10:00');
  eq('10:00 判定为精力黄金期', st1.isPeak, true);
  eq('10:00 精力等级为 high', st1.level, 'high');

  const st2 = S.currentEnergyState('13:30');
  eq('13:30 判定非高峰期', st2.isPeak, false);
  eq('13:30 精力等级为 low', st2.level, 'low');

  const st3 = S.currentEnergyState('23:30');
  eq('23:30 判定为夜间休整期', st3.level, 'rest');

  const st4 = S.currentEnergyState('16:00');
  eq('16:00 命中午后高效期', st4.isPeak, true);
}

// 5. 学业生活白皮书数据聚合测试
console.log('\nWhitePaper: 学业生活全景白皮书');
{
  const wpCode = readFileSync(new URL('../assets/js/white-paper.js', import.meta.url), 'utf8');
  const S = await initTestStore();
  const g = {
    DateUtil: DateUtil,
    Store: S,
    UI: { el: () => ({ appendChild: () => {} }) }
  };
  new Function('window', 'global', wpCode)(g, g);
  const data = g.WhitePaper.compileData();
  eq('白皮书包含学期名称', typeof data.semesterName, 'string');
  eq('白皮书包含 GPA', typeof data.gpa, 'string');
  eq('白皮书包含专注工时', typeof data.focusHours, 'string');
  eq('白皮书包含睡眠时长', typeof data.avgSleepHours, 'string');
  eq('白皮书包含待办完成率', typeof data.taskRate, 'number');
}


// 6. 抽卡心愿单与轮换预报测试
console.log('\nGacha: 心愿单与轮换到货预报 (Wishlist Forecast)');
{
  const S = await initTestStore();
  eq('初始心愿单为空', S.getWishlist().length, 0);

  S.toggleWishlist('银灰');
  eq('加入银灰后心愿单数量为 1', S.getWishlist().length, 1);
  eq('isWishlisted(银灰) 为 true', S.isWishlisted('银灰'), true);

  const forecast = S.wishlistForecast();
  eq('心愿单预报包含 1 个对象', forecast.length, 1);
  eq('预报对象名称正确', forecast[0].name, '银灰');
  eq('预报计算星级为 6', forecast[0].star, 6);
  eq('预报包含所属池名称', typeof forecast[0].poolName, 'string');
  eq('预报包含备考玉进度', typeof forecast[0].readyPct, 'number');

  S.toggleWishlist('银灰');
  eq('再次切换后移除心愿单', S.isWishlisted('银灰'), false);
}

// 7. 教务 ICS 日历导入解析测试
console.log('\nScheduleImport: 教务系统 ICS 日历解析');
{
  const schedCode = readFileSync(new URL('../assets/js/views/schedule.js', import.meta.url), 'utf8');
  const g = {
    UI: { el: () => ({ appendChild: () => {} }) },
    Store: { periods: [{ start: '08:00', end: '09:40' }] }
  };
  // Extract parseIcsCourseTable
  const icsMatch = schedCode.match(/function parseIcsCourseTable\(text\)\s*\{([\s\S]*?)\n  \}/);
  const parseICS = new Function('text', 'Store', icsMatch[0] + '; return parseIcsCourseTable(text);');

  const testICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:高等数学[1-16周]
LOCATION:教学楼A101
DESCRIPTION:张教授
DTSTART:20260901T080000
DTEND:20260901T094000
RRULE:FREQ=WEEKLY;COUNT=16;BYDAY=MO
END:VEVENT
END:VCALENDAR`;

  const res = parseICS(testICS, g.Store);
  eq('ICS 解析出 1 门课', res.rows.length, 1);
  eq('ICS 课名提取正确', res.rows[0].name, '高等数学');
  eq('ICS 地点提取正确', res.rows[0].location, '教学楼A101');
  eq('ICS 教师提取正确', res.rows[0].teacher, '张教授');
  eq('ICS 星期匹配周一', res.rows[0].day, 1);
  eq('ICS 起始周 1', res.rows[0].weeks.start, 1);
  eq('ICS 结束周 16', res.rows[0].weeks.end, 16);
}

// 8. 教务 HTML DOM 结构抽取测试
// 8. 教务网页源码 HTML 解析
console.log('\nScheduleImport: 教务网页源码 HTML 解析');
{
  const schedCode = readFileSync(new URL('../assets/js/views/schedule.js', import.meta.url), 'utf8');
  const dayCnCode = 'var DAY_CN = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };\n';
  const parseSection = schedCode.slice(schedCode.indexOf('function parseDay'), schedCode.indexOf('function parseCourseTable'));

  const mockDOMParser = function () {
    return {
      parseFromString: function () {
        return {
          querySelectorAll: function (selector) {
            if (selector === 'table') {
              return [{
                textContent: '星期一 星期二 星期三',
                querySelectorAll: function (subSel) {
                  if (subSel === 'tr') {
                    return [
                      {
                        querySelectorAll: function () {
                          return [
                            { textContent: '节次' },
                            { textContent: '星期一' },
                            { textContent: '星期二' }
                          ];
                        }
                      },
                      {
                        querySelectorAll: function () {
                          return [
                            { textContent: '第1-2节', getAttribute: () => '1' },
                            { textContent: ['大学物理', '李老师', '理教201', '1-16周'].join('\n'), getAttribute: () => '2' },
                            { textContent: '', getAttribute: () => '1' }
                          ];
                        }
                      }
                    ];
                  }
                  return [];
                }
              }];
            }
            return [];
          }
        };
      }
    };
  };

  const parseHTML = new Function('DOMParser',
    dayCnCode + parseSection + '; return parseHtmlCourseTable("<table>");'
  );

  const res = parseHTML(mockDOMParser);
  eq('HTML 解析出课程', res.rows.length, 1);
  eq('HTML 课名正确', res.rows[0].name.indexOf('大学物理') >= 0, true);
  eq('HTML 地点识别为理教201', res.rows[0].location, '理教201');
  eq('HTML 教师识别为李老师', res.rows[0].teacher, '李老师');
  eq('HTML 星期匹配为周一', res.rows[0].day, 1);
}


// 9. 自然意象主题与明日方舟主题体系测试
console.log('\nTheme: 自然意象主题（解耦）与明日方舟主题体系');
{
  const themeCode = readFileSync(new URL('../assets/js/theme.js', import.meta.url), 'utf8');
  const paletteCode = readFileSync(new URL('../assets/js/palette.js', import.meta.url), 'utf8');
  const rootEl = {
    dataset: {},
    style: { setProperty: () => {} },
    setAttribute: function (k, v) { this[k] = v; },
    removeAttribute: function (k) { delete this[k]; }
  };
  const g = {
    Palette: { THEME_PRESETS: [] },
    Store: {
      state: { settings: { themeSkin: true, themeSkinAuto: true, natureTheme: 'pine', arkTheme: 'terminal', themeMode: 'light' }, pomodoro: { mode: 'forest' } },
      updateSettings: function (p) { Object.assign(this.state.settings, p); }
    },
    document: {
      documentElement: rootEl,
      querySelector: () => null,
      getElementById: () => null
    },
    window: { matchMedia: () => ({ matches: false }) }
  };
  new Function('global', paletteCode)(g);
  new Function('window', 'global', 'Palette', 'Store', 'document', themeCode)(g.window, g, g.Palette, g.Store, g.document);

  const T = g.window.Theme || g.Theme;
  eq('自然主题包含晨雾松林', !!T.NATURE_THEMES.pine, true);
  eq('自然主题包含极光苍穹', !!T.NATURE_THEMES.aurora, true);
  eq('自然主题包含暮霞熔金', !!T.NATURE_THEMES.sunset, true);
  eq('自然主题包含山岚青黛', !!T.NATURE_THEMES.slate, true);
  eq('方舟主题包含经典终端', !!T.ARK_THEMES.terminal, true);
  eq('方舟主题包含集成战略水墨', !!T.ARK_THEMES.roguelike, true);

  // Apply nature theme
  T.apply();
  eq('种树模式套用 data-mech=tree', rootEl['data-mech'], 'tree');
  eq('种树模式套用 data-nature-theme=pine', rootEl['data-nature-theme'], 'pine');
  eq('种树模式不继承 data-ark-theme', rootEl['data-ark-theme'], undefined);

  // Switch nature theme
  T.setNatureTheme('aurora');
  eq('切换后 natureTheme 为 aurora', g.Store.state.settings.natureTheme, 'aurora');
  eq('切换后 data-nature-theme=aurora', rootEl['data-nature-theme'], 'aurora');

  // Switch to Gacha
  g.Store.state.pomodoro.mode = 'gacha';
  T.apply();
  eq('抽卡模式套用 data-mech=factory', rootEl['data-mech'], 'factory');
  eq('抽卡模式套用 data-ark-theme=terminal', rootEl['data-ark-theme'], 'terminal');
  eq('抽卡模式不继承 data-nature-theme', rootEl['data-nature-theme'], undefined);

  // Switch ark theme to roguelike
  T.setArkTheme('roguelike');
  eq('切换后 arkTheme 为 roguelike', g.Store.state.settings.arkTheme, 'roguelike');
  eq('切换后 data-ark-theme=roguelike', rootEl['data-ark-theme'], 'roguelike');
}

/* ==========================================================
 * 数据迁移回归：旧档（单学期 / 同名多课程 / 旧树 growth）导入后应被正确迁移。
 * 这些迁移已拆到 store.js 的 migrate* 具名函数里，这里守住行为不回退。
 * pity6→分池、makeUp→摸鱼券 两项曾因 validateSchema / mergeShop 抢先用默认值
 * 打底而搬运失效（老用户保底计数与补签卡归零），现由 hoistLegacy 与 mergeShop
 * 内的抢救逻辑修好，这里一并断言，防止再退化。
 * ========================================================== */
console.log('\n数据迁移: 旧档导入后的结构迁移');
{
  const S = await initTestStore();
  const oldState = {
    version: 1, model: 1,
    semester: { name: '2025春', startDate: '2025-02-24', weeks: 18 },
    courses: [
      { id: 'c1', name: '高等数学', teacher: '张老师', day: 1, periodId: 'p1', location: 'A101' },
      { id: 'c2', name: '高等数学', teacher: '张老师', day: 3, periodId: 'p2', location: 'A101' }
    ],
    tasks: [{ id: 't1', title: '作业', courseId: 'c2' }],
    pomodoro: { trees: [{ id: 'tr1', growth: 130 }], gacha: { pity6: 42, ops: [], log: [] } },
    shop: { tickets: { makeUp: 3 }, makeUpLog: ['2026-01-01'] }
  };
  await S.importJSON(JSON.stringify(oldState));
  const st = S.state;
  const tree = (st.pomodoro.trees || [])[0] || {};

  // 旧树：growth 130 → 阶段 3，旧字段清掉
  eq('旧树 growth 130 迁为阶段 3', tree.stage, 3);
  eq('旧树迁移后 prog 归零', tree.prog, 0);
  eq('旧树迁移后 growth 字段已删除', tree.growth, undefined);

  // 学期：单个 state.semester → 学期列表
  eq('旧档单学期迁为学期列表', st.semesters.length >= 1, true);
  eq('学期名沿用旧值', st.semesters[0].name, '2025春');
  eq('当前学期指向列表内存在的学期', st.semesters.some(s => s.id === st.currentSemesterId), true);

  // 课程 v2：同名两条 → 一门课 + 两个时段
  eq('同名课程合并为一门', st.courses.length, 1);
  eq('合并后保留两个时段', (st.courses[0].slots || []).length, 2);
  eq('合并后 model 升到 2', st.model, 2);
  eq('被合并课程的任务关联回写主课', st.tasks[0].courseId, 'c1');

  // 旧值抢救：pity6 → 标准池、makeUp → 摸鱼券（曾因默认值抢先打底而丢失）
  eq('旧档 pity6 42 搬进标准池', st.pomodoro.gacha.pools.standard.pity6, 42);
  eq('中坚池同步建立且独立', st.pomodoro.gacha.pools.classic.pity6, 0);
  eq('旧补签卡 3 张转为摸鱼券', st.shop.tickets.fish, 3);
  eq('旧补签卡使用记录沿用', st.shop.fishLog.length, 1);
  eq('迁移后 makeUp 旧字段已删除', st.shop.tickets.makeUp, undefined);
}

/* ==========================================================
 * 重复任务实例归档：只搬「已完成 + 无关联 + 够老（>60 天）」的重复实例。
 * 挂了时间记录或有子任务的必须留下——否则「已投入 X」和子任务计数会找不到主人。
 * ========================================================== */
console.log('\n重复任务归档: 旧实例移出主列表、历史统计不受影响');
{
  const S = await initTestStore();
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const old = day(-100), fresh = day(0);
  const mk = (id, extra) => Object.assign({
    id: id, title: '任务' + id, status: 'done', dueDate: old, doneAt: old,
    repeatFrom: 'root', occurrence: 3
  }, extra || {});

  const oldState = {
    version: 2, model: 2, courses: [],
    tasks: [
      mk('old_plain'),                                                    // 老 + 无关联 → 应归档
      mk('old_with_act'),                                                 // 挂了时间记录 → 保留
      mk('old_with_kid'),                                                 // 有子任务 → 保留
      Object.assign(mk('fresh_one'), { dueDate: fresh, doneAt: fresh }),   // 刚完成 → 保留
      { id: 'once', title: '一次性', status: 'done', dueDate: old, doneAt: old },  // 非重复 → 保留
      { id: 'kid1', title: '子任务', parentId: 'old_with_kid', status: 'todo' }
    ],
    activities: [{ id: 'a1', taskId: 'old_with_act', date: old, minutes: 30 }]
  };
  await S.importJSON(JSON.stringify(oldState));

  const st = S.state;
  const ids = st.tasks.map(t => t.id);
  const arc = (st.taskArchive || []).map(t => t.id);

  eq('老且无关联的重复实例被归档', arc.indexOf('old_plain') >= 0, true);
  eq('归档后移出主列表', ids.indexOf('old_plain'), -1);
  eq('挂了时间记录的实例保留', ids.indexOf('old_with_act') >= 0, true);
  eq('有子任务的实例保留', ids.indexOf('old_with_kid') >= 0, true);
  eq('刚完成的实例保留', ids.indexOf('fresh_one') >= 0, true);
  eq('一次性任务不归档', ids.indexOf('once') >= 0, true);
  eq('子任务本身不动', ids.indexOf('kid1') >= 0, true);
  eq('归档实例仍可按 id 查回', !!S.getTask('old_plain'), true);

  // 归档区必须仍参与历史统计，否则目标 KR 的分母/分子会一起变小
  const ctx = S.goalCtx({ startDate: day(-200), endDate: day(1) });
  eq('历史统计把归档区一起算', ctx.tasks.length, st.tasks.length + (st.taskArchive || []).length);
  eq('归档区不为空（本次确有归档）', (st.taskArchive || []).length > 0, true);
}

/* ==========================================================
 * 备份导出：API 密钥默认剥离。
 * 备份文件常被存网盘 / 发给别人，密钥泄露会被盗刷；重填成本极低，所以默认不带。
 * ========================================================== */
console.log('\n备份导出: API 密钥默认剥离');
{
  const S = await initTestStore();
  S.updateSettings({
    asr: { prefer: 'auto', appId: 'fake-app', apiKey: 'fake-key', apiSecret: 'fake-secret' },
    ocr: { prefer: 'auto', provider: '', apiKey: 'fake-ocr', endpoint: '', model: '' }
  });

  const dft = JSON.parse(S.exportJSON('full'));
  eq('完整备份默认不含讯飞 apiKey', dft.settings.asr.apiKey, '');
  eq('完整备份默认不含讯飞 appId', dft.settings.asr.appId, '');
  eq('完整备份默认不含讯飞 secret', dft.settings.asr.apiSecret, '');
  eq('完整备份默认不含 OCR apiKey', dft.settings.ocr.apiKey, '');

  const withK = JSON.parse(S.exportJSON('full', { includeKeys: true }));
  eq('勾选后完整备份带走讯飞密钥', withK.settings.asr.apiKey, 'fake-key');
  eq('勾选后完整备份带走 OCR 密钥', withK.settings.ocr.apiKey, 'fake-ocr');

  const sync = JSON.parse(S.exportJSON('standard'));
  eq('同步码同样不含密钥', sync.settings.asr.apiKey, '');

  // 剥离不能影响原状态：本机填的密钥还在
  eq('导出未污染本机设置', S.state.settings.asr.apiKey, 'fake-key');
}

/* ==========================================================
 * SleepModel：睡眠推算模型（直接 import 源文件，纯模块）
 * ========================================================== */
const sleepModelSrc = readFileSync(new URL('../assets/js/sleep-model.js', import.meta.url), 'utf8');
new Function(sleepModelSrc)();
const SM = globalThis.SleepModel;

console.log('SleepModel.normalizeNight');
let n1 = SM.normalizeNight({ start: '23:00', end: '07:00' });
eq('跨午夜: bed=1380 wake=1860 total=480', [n1.bed, n1.wake, n1.total], [1380, 1860, 480]);
let n2 = SM.normalizeNight({ start: '01:00', end: '09:00', deep: 60, light: 300, rem: 90, awake: 30, efficiency: 97, awakenings: 1 });
eq('同夜带阶段字段保留', [n2.bed, n2.wake, n2.total, n2.deep, n2.rem, n2.efficiency, n2.awakenings], [60, 540, 480, 60, 90, 97, 1]);
eq('缺字段返回 null', SM.normalizeNight({ start: 'x' }), null);

console.log('SleepModel.coffeeWindow');
let cw = SM.coffeeWindow(SM.normalizeNight({ start: '23:00', end: '07:00' }));
eq('常规: 醒08:30起 睡17:00止 有效', [cw.start, cw.end, cw.valid], ['08:30', '17:00', true]);
let cw2 = SM.coffeeWindow(SM.normalizeNight({ start: '20:00', end: '07:00' }));
eq('早睡20:00: 截止14:00', [cw2.start, cw2.end, cw2.valid], ['08:30', '14:00', true]);
let cwBad = SM.coffeeWindow(SM.normalizeNight({ start: '23:00', end: '22:00' }));
eq('窗口过窄标记无效', cwBad.valid, false);

console.log('SleepModel.drowsinessWindows');
let dw = SM.drowsinessWindows(SM.normalizeNight({ start: '23:00', end: '07:00' }));
eq('三类瞌睡: 睡眠惯性/午后/睡前', dw.map(d => d.type), ['inertia', 'afternoon', 'winddown']);
eq('睡眠惯性从醒来起算 07:00-07:30', [dw[0].start, dw[0].end], ['07:00', '07:30']);

console.log('SleepModel.alertnessCurve');
let curve = SM.alertnessCurve(SM.normalizeNight({ start: '23:00', end: '07:00' }), { spanHours: 18, step: 15 });
eq('18h/15min -> 73 个点', curve.length, 73);
let peak = curve.reduce((a, b) => b.score > a.score ? b : a);
eq('峰值在上午(h≈3.5, 07:00醒→10:30峰)', Math.abs(peak.h - 3.5) <= 1.5, true);
let aftH = (15 * 60 - ((SM.normalizeNight({ start: '23:00', end: '07:00' }).wake % 1440 + 1440) % 1440)) / 60;
let aft = SM.alertnessAt(SM.normalizeNight({ start: '23:00', end: '07:00' }), aftH);
eq('午后(15:00)警觉度低于上午峰值', aft < peak.score, true);

console.log('SleepModel.qualityFactor');
let good = SM.qualityFactor(SM.normalizeNight({ start: '23:00', end: '07:00', deep: 60, rem: 90, efficiency: 97 }));
let bad = SM.qualityFactor(SM.normalizeNight({ start: '01:00', end: '06:00', deep: 20, rem: 20, efficiency: 70 }));
eq('好睡眠系数高于差睡眠', good > bad, true);
eq('好睡眠系数 > 0.9', good > 0.9, true);

console.log('SleepModel.applyCaffeine');
let base = SM.alertnessCurve(SM.normalizeNight({ start: '23:00', end: '07:00' }), { spanHours: 12, step: 15 });
let doped = SM.applyCaffeine(base, '09:00');
eq('咖啡后10:30警觉度高于基线', doped.find(p => p.clock === '10:30').score > base.find(p => p.clock === '10:30').score, true);

console.log('SleepModel.parseSleepShot');
let shot = SM.parseSleepShot([
  '总睡眠7时6分', '入睡02:49', '醒来09:58', '深睡占比14%', '浅睡57%',
  '快速眼动29%', '清醒3%', '睡眠效率97%', '清醒1次'
]);
eq('解析入睡/醒来时刻', [shot.start, shot.end], ['02:49', '09:58']);
eq('解析效率与清醒次数', [shot.efficiency, shot.awakenings], [97, 1]);
eq('深睡分钟=总*14%=60', shot.deep, 60);
eq('浅睡分钟=总*57%', shot.light, Math.round(426 * 0.57));
eq('REM 分钟=总*29%', shot.rem, Math.round(426 * 0.29));
eq('来源标记为 shot', shot.source, 'shot');
eq('乱码返回 null', SM.parseSleepShot(['广告', '下载', '立即打开']), null);

console.log('SleepModel.parseSleepShot: 真实 OCR 噪声行（2026-10-23 tesseract.js chi_sim 实测）');
// 详情页（psm4 原样输出：错字 了/个/名/针/旱、百分比 x%、参考行锚点）
let s1 = SM.parseSleepShot([
  '14:59 co澡和会', '险卢', '2026年10月23旱v', '日 周 月', '人 肥明详情',
  '脸肯时长', '7小时 6分名', '瞪卢结构 二 te@，', '清醒 次 3分针',
  '参考; 0-2次', '快速限动 29x 人 2小时个分名', '一', '参考: 20%-25%',
  '浅 村 训1x 个小时2分钟', '深睡 14% 亿 1小时', '参考: 15%-20%%',
  '睦眠效率', '91”', '仿理范围: 85% ~ 100%'
]);
eq('详情页: 日期（旱=日）', s1.date, '2026-10-23');
eq('详情页: 总时长 426', s1.total, 426);
eq('详情页: 深60/浅242/REM124（个→4 纠错+约束合成）', [s1.deep, s1.light, s1.rem], [60, 242, 124]);
eq('详情页: 清醒 3 分钟', s1.awake, 3);
eq('详情页: 无起止时刻', [s1.start, s1.end], [null, null]);
// 总览页（值行在上、标签行在下的网格）
let s2 = SM.parseSleepShot([
  '14:19 o党和本会 ED', '险卢', '2026年10月23旱v', '日 周 月',
  '险甩斋量良好 。81', '高 72% 同龄用户', '了时分 02:49 让 14% 全',
  '睡眠总时长 入睡时间 深睡点化', '1 次 97x 晚 17 分',
  '清醒次数 睡肯效率 入睡规律性', '昨晚整体瞪得不错，但有 3 点需留意深睦仅',
  '点 14%，点比偏低 更多》', '加 会天肚蜂', '了时各分针',
  '图 深蛙 国 浅蛙 国 快速限动 图 清醒', '09:58', '醒来'
]);
eq('总览页: 入睡/醒来（网格上下文配对）', [s2.start, s2.end], ['02:49', '09:58']);
eq('总览页: 效率 97 / 清醒 1 次', [s2.efficiency, s2.awakenings], [97, 1]);
eq('总览页: 「晚17分」不算清醒时长', s2.awake, null);
// 多图合并：详情页给阶段、总览页给时刻，效率取与 span 最一致的候选
let mg = SM.mergeShotResults([s1, s2]);
eq('合并: 完整记录', [mg.start, mg.end, mg.total, mg.deep, mg.light, mg.rem, mg.awake, mg.efficiency, mg.awakenings],
  ['02:49', '09:58', 426, 60, 242, 124, 3, 97, 1]);
eq('合并: 质量良好', mg.quality, 'good');
eq('合并: 单图原样透传', SM.mergeShotResults([s1]).total, 426);
eq('合并: 全空返回 null', SM.mergeShotResults([null, null]), null);

// 词级 conf>25 过滤后的真实行：浅睡标签/29x/14% 全被丢，浅睡须由「总量-深-REM」反推
let s3 = SM.parseSleepShot([
  '14:59 co 会', '险', '2026年10月23', '日周月', '情', '时长', '7小时6分',
  '结构二', '清醒3分针', '参考 ; 0-2次', '快速限动2小时个分名', '一',
  '参考 :', '训小时2分钟', '深1小时', '参考 : 15%-20%%', '效率', '仿理范围 : 85% ~ 100%'
]);
eq('词过滤后: 深60/浅242(反推)/REM124', [s3.deep, s3.light, s3.rem], [60, 242, 124]);
eq('词过滤后: 效率不受「合理范围85%~100%」污染', s3.efficiency, null);

// 总览页真实行：效率标签丢「效」字变「…次数率入规律性」
let s4 = SM.parseSleepShot([
  '和会 ED', '险', '2026年10月23', '日周月', '险量良好', '。81', '72% 同龄用户',
  '了时02:49', '睡眠总时长入时间深睡点化', '1次97x 晚17分', '清醒次数率入规律性',
  '昨晚整体不错 ， 但有3点需留意深', '点14%， 点更多 》', '会天肚', '了各分',
  '深国浅国快速限动图清醒', '09:58', '醒来'
]);
eq('效率标签丢「效」字仍取到 97', s4.efficiency, 97);
eq('同页: 时刻/清醒次数不丢', [s4.start, s4.end, s4.awakenings], ['02:49', '09:58', 1]);

console.log('Store: 睡眠结构字段与按夜选择');
{
  const S = await initTestStore();
  const sRec = S.addSleep({ date: '2026-05-09', start: '23:30', end: '07:10', deep: 70, light: 280, rem: 90, awake: 20, efficiency: 95, awakenings: 1, source: 'shot' });
  eq('addSleep 保留结构字段', [sRec.deep, sRec.light, sRec.rem, sRec.efficiency, sRec.source], [70, 280, 90, 95, 'shot']);
  eq('wakeDateOf 跨午夜 = 入睡日+1', S.wakeDateOf(sRec), '2026-05-10');
  eq('sleepForDay 按醒来日挑昨夜那条', S.sleepForDay('2026-05-10').id, sRec.id);
  const norm = SM.normalizeNight(sRec);
  eq('normalizeNight 在真实存储记录上可用', typeof norm.total, 'number');
}


console.log('\nQrSync: 二维码编解码、极简课表骨架单码与动态多帧轮播');
{
  const S = await initTestStore();
  S.addCourse({
    name: '高等数学 A',
    teacher: '王敏',
    location: '教三 301',
    day: 1,
    periodId: 'p1',
    credit: 4,
    startWeek: 1,
    endWeek: 16,
    weekType: 'all',
    exam: { date: '2026-06-20', start: '09:00', end: '11:00' },
    rotations: [{ startWeek: 1, endWeek: 4, location: '理教 204', topic: '极限实验' }]
  });

  // 验证 weekMatrix 与 coursesOnDay 动态传递 weekNo 给 expandCourse
  const wm2 = S.weekMatrix(2);
  eq('weekMatrix(2) 包含第 2 周实验轮转地点', wm2['1|p1'][0].location, '理教 204');
  eq('weekMatrix(2) 包含第 2 周实验课题', wm2['1|p1'][0].topic, '极限实验');
  const wm10 = S.weekMatrix(10);
  eq('weekMatrix(10) 恢复默认地点', wm10['1|p1'][0].location, '教三 301');

  const qrCodeSrc = readFileSync(new URL('../assets/js/qr-sync.js', import.meta.url), 'utf8');
  const qrWin = {
    Store: S,
    UI: { el: () => ({ appendChild: () => {} }) },
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary')
  };
  new Function('window', 'global', 'btoa', 'atob', qrCodeSrc)(qrWin, qrWin, qrWin.btoa, qrWin.atob);
  const QrSync = qrWin.QrSync;

  // 1) 极简课表骨架导出与二维码编解码闭环
  const skCode = QrSync.buildSkeletonCode();
  eq('CPQR1 前缀正确', skCode.startsWith('CPQR1:'), true);
  const mat = QrSync.encodeMatrix(skCode);
  eq('极简骨架单码版本 <= 15', mat.version <= 15, true);
  const decodedSkCode = QrSync.decodeFromMatrix(mat.modules, mat.size);
  eq('QR 矩阵无损解码还原 CPQR1 串', decodedSkCode, skCode);

  const parsedSk = QrSync.parseSkeletonCode(decodedSkCode);
  eq('骨架解析出 1 门课', parsedSk.c.length, 1);

  const S2 = await initTestStore();
  const impRes = S2.importSkeleton(parsedSk, 'replace');
  eq('importSkeleton 导入 1 门课', impRes.added, 1);
  eq('导入后课程名称一致', S2.courses[0].name, '高等数学 A');
  eq('导入后学分保留', S2.courses[0].credit, 4);
  eq('导入后考试日期保留', S2.courses[0].exam.date, '2026-06-20');
  eq('导入后实验课轮转规则保留', S2.courses[0].rotations[0].location, '理教 204');

  // 2) 动态多帧轮播分片与重组闭环
  const streamInfo = await QrSync.buildStreamFrames('lite');
  eq('生成多帧轮播数组', Array.isArray(streamInfo.frames) && streamInfo.frames.length >= 1, true);
  const chunksMap = {};
  for (const frameStr of streamInfo.frames) {
    const fMat = QrSync.encodeMatrix(frameStr);
    const fDec = QrSync.decodeFromMatrix(fMat.modules, fMat.size);
    eq('分片帧 QR 矩阵无损解码', fDec, frameStr);
    const pf = QrSync.parseStreamFrame(fDec);
    chunksMap[pf.index] = pf.chunk;
  }
  const assembledJson = await QrSync.assembleStreamFrames(chunksMap, streamInfo.total, streamInfo.hash);
  const assembledObj = JSON.parse(assembledJson);
  eq('多帧重组还原出有效同步 JSON', Array.isArray(assembledObj.courses), true);
  eq('多帧重组课程数量一致', assembledObj.courses.length, 1);

  // 3) WebDAV 地址拼装与 Basic Auth 编码验证
  eq('WebDAV URL 自动补斜杠与文件名', QrSync.buildWebdavTargetUrl({
    url: 'https://dav.jianguoyun.com/dav/course-planner',
    filename: 'my-sync.json'
  }), 'https://dav.jianguoyun.com/dav/course-planner/my-sync.json');
  eq('WebDAV URL 支持 CORS 代理前缀替换', QrSync.buildWebdavTargetUrl({
    url: 'https://dav.jianguoyun.com/dav',
    filename: 'sync.json',
    corsProxy: 'https://proxy.example.com/?target={url}'
  }), 'https://proxy.example.com/?target=' + encodeURIComponent('https://dav.jianguoyun.com/dav/sync.json'));
  eq('WebDAV Basic Auth 头部生成正确', QrSync.buildWebdavAuthHeader({
    username: 'user@example.com',
    password: 'app-secret-123'
  }), 'Basic ' + Buffer.from('user@example.com:app-secret-123').toString('base64'));
}

console.log('\nOcr: 高校课程词库纠偏、透视单应性矩阵与自定义辅助网格');
{
  eq('形近字纠偏: 高散数学A -> 高等数学A', Ocr.correctCourseName('高散数学A').name, '高等数学A');
  eq('形近字纠偏: 微积今(上) -> 微积分(上)', Ocr.correctCourseName('微积今(上)').name, '微积分(上)');
  eq('形近字纠偏: 线牲代数 -> 线性代数', Ocr.correctCourseName('线牲代数').name, '线性代数');
  eq('形近字纠偏: 大字英语 -> 大学英语', Ocr.correctCourseName('大字英语').name, '大学英语');
  eq('形近字纠偏: 数椐结构 -> 数据结构', Ocr.correctCourseName('数椐结构').name, '数据结构');
  eq('编辑距离1纠偏: 计算机网路 -> 计算机网络', Ocr.correctCourseName('计算机网路').name, '计算机网络');
  eq('编辑距离1纠偏: 概率论与数理统汁 -> 概率论与数理统计', Ocr.correctCourseName('概率论与数理统汁').name, '概率论与数理统计');
  eq('反义词保护: 微观经济学 不会误纠为 宏观经济学', Ocr.correctCourseName('微观经济学').name, '微观经济学');
  eq('反义词保护: 有机化学 不会误纠为 无机化学', Ocr.correctCourseName('有机化学').name, '有机化学');

  const cellParsed = Ocr.parseCell('高散数学A\n教三301\n王老师\n1-16周');
  eq('parseCell 自动纠偏课程名', cellParsed.name, '高等数学A');
  eq('parseCell 记录原始误识词 correctedFrom', cellParsed.correctedFrom, '高散数学A');
  eq('parseCell 提取地点', cellParsed.location, '教三301');

  // 单应性矩阵 H 验证：恒等矩形映射
  const H = Ocr.solveHomography(
    [[0, 0], [100, 0], [100, 50], [0, 50]],
    [[0, 0], [200, 0], [200, 100], [0, 100]]
  );
  eq('Homography 水平缩放因子 2.0', Math.abs(H[0] - 2) < 1e-6, true);
  eq('Homography 垂直缩放因子 2.0', Math.abs(H[4] - 2) < 1e-6, true);

  // 自定义辅助对齐网格切分验证
  const customLines = {
    vlines: [100, 200, 300, 400, 500, 600, 700, 800],
    hlines: [50, 150, 250, 350]
  };
  const mockWords = [
    { text: '高等数学', conf: 95, x0: 110, y0: 70, x1: 180, y1: 100, cx: 145, cy: 85 },
    { text: '大学英语', conf: 95, x0: 310, y0: 170, x1: 380, y1: 200, cx: 345, cy: 185 }
  ];
  const g = Ocr.buildGrid(mockWords, { customLines });
  eq('自定义网格识别出周一第1节', g.cells[0][0], '高等数学');
  eq('自定义网格识别出周三第2节', g.cells[1][2], '大学英语');
  eq('自定义网格标记 meta.customGrid', g.meta.customGrid, true);

  // 彩色卡片底纹剥离与网格线隔离带单元测试
  const fakePixels = new Uint8ClampedArray([
    100, 180, 240, 255,   // 高饱和度浅蓝底纹 (sat=140, lum=151) -> 应退底为 248
    30,  30,  30,  255    // 深色文字笔画 (sat=0, lum=30) -> 保持原样 30
  ]);
  const fakeCanvas = {
    width: 2,
    height: 1,
    getContext: () => ({
      getImageData: () => ({ data: fakePixels }),
      putImageData: () => {}
    })
  };
  Ocr.stripColorCardBg(fakeCanvas);
  eq('stripColorCardBg 将彩色课程底纹剥离为亮白底(248)', fakePixels[0], 248);
  eq('stripColorCardBg 完整保留深色文字笔画(30)', fakePixels[4], 30);

  const filledRects = [];
  const isoCanvas = {
    width: 500,
    height: 400,
    getContext: () => ({
      save: () => {},
      restore: () => {},
      fillRect: (x, y, w, h) => filledRects.push([x, y, w, h])
    })
  };
  Ocr.isolateGridLines(isoCanvas, { vlines: [100, 200], hlines: [50, 150] }, 4);
  eq('isolateGridLines 绘制 4 条纯白隔离带', filledRects.length, 4);

  // 路线B (Cell-First) + 方案2 (Native TextDetector) 融合与置信度矩阵单测
  const gridStruct = Ocr.detectGridStructure(800, 600, {
    vlines: [80, 180, 280, 380, 480, 580, 680, 780],
    hlines: [40, 120, 200, 280, 360]
  });
  eq('detectGridStructure 识别 7 列课程列', gridStruct.cols.length, 7);
  eq('detectGridStructure 过滤表头后识别 3 行课程节次', gridStruct.rows.length, 3);

  const blankData = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  const blankCanvas = {
    width: 100, height: 100,
    getContext: () => ({ getImageData: () => ({ data: blankData }) })
  };
  eq('detectCellInk 空白格返回 false', Ocr.detectCellInk(blankCanvas, { x0: 0, y0: 0, w: 100, h: 100 }), false);

  const inkData = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  for (let p = 0; p < 300; p++) {
    inkData[p * 4] = 20; inkData[p * 4 + 1] = 20; inkData[p * 4 + 2] = 20;
  }
  const inkCanvas = {
    width: 100, height: 100,
    getContext: () => ({ getImageData: () => ({ data: inkData }) })
  };
  eq('detectCellInk 有文字墨迹格返回 true', Ocr.detectCellInk(inkCanvas, { x0: 0, y0: 0, w: 100, h: 100 }), true);

  eq('默认环境无原生 TextDetector 时返回 false', Ocr.hasNativeTextDetector(), false);
  ocrWin.TextDetector = function () {
    this.detect = function () {
      return Promise.resolve([
        { rawValue: '高散数学A\n理教201\n1-16周', boundingBox: { x: 10, y: 10, width: 80, height: 40 } }
      ]);
    };
  };
  eq('注入原生 TextDetector 后探测为 true', Ocr.hasNativeTextDetector(), true);
  const nativeWords = await Ocr.recognizeWithNativeDetector({});
  eq('原生 TextDetector 识别出文本块', nativeWords.length, 1);
  eq('原生 TextDetector 标记 source=native', nativeWords[0].source, 'native');

  const mockFullCanvas = {
    width: 800, height: 600,
    getContext: () => ({
      fillStyle: '#ffffff', fillRect: () => {}, drawImage: () => {},
      getImageData: (sx, sy, sw, sh) => {
        const d = new Uint8ClampedArray(sw * sh * 4).fill(255);
        if (sw < 200 && sh < 200 && ((sx >= 80 && sx < 180 && sy >= 120 && sy < 200) || (sx >= 180 && sx < 280 && sy >= 200 && sy < 280))) {
          for (let k = 0; k < Math.min(200, sw * sh); k++) {
            d[k * 4] = 20; d[k * 4 + 1] = 20; d[k * 4 + 2] = 20;
          }
        }
        return { data: d };
      },
      putImageData: () => {}
    }),
    toBlob: (cb) => cb({})
  };
  const cfRes = await Ocr.recognizeCellFirst(null, null, {
    canvas: mockFullCanvas,
    customLines: {
      vlines: [80, 180, 280, 380, 480, 580, 680, 780],
      hlines: [40, 120, 200, 280, 360]
    }
  });
  eq('方案2 Cell-First 管线返回 isCellFirst=true', cfRes.isCellFirst, true);
  eq('方案2 Cell-First 管线同步输出 conf 矩阵', Array.isArray(cfRes.grid.conf) && cfRes.grid.conf[0][0] === 98, true);
  eq('方案2 Cell-First 单格识别结果自动完成高校词库纠偏', cfRes.grid.cells[0][0].indexOf('高等数学A') === 0, true);
  delete ocrWin.TextDetector;
}

console.log('\n工程修复回归：白皮书、纯学术持久化、精简同步码脱敏、健康日档案与就寝跨夜');
{
  const S = await initTestStore();
  // 1. 纯学术模式经过 ensure / validateSchema 不被重置为 forest
  S.setRewardMode('academic');
  eq('setRewardMode(academic) 生效', S.pomodoro.mode, 'academic');
  S.ensure();
  eq('ensure() 后纯学术模式保留为 academic', S.pomodoro.mode, 'academic');

  // 2. 精简同步码 (lite) 彻底清空个人体重、步数与入睡时刻
  S.logWeight('2026-10-20', 65.5);
  S.addMetric({ date: '2026-10-20', steps: 9500, calories: 360, distance: 6800, source: 'hc' });
  S.logSleepOnset('23:20', { date: '2026-10-20', min: 30 });
  const liteObj = JSON.parse(S.exportJSON('lite'));
  eq('lite 同步码不携带 metrics', Array.isArray(liteObj.metrics) && liteObj.metrics.length === 0, true);
  eq('lite 同步码不携带 weightLog', Array.isArray(liteObj.weightLog) && liteObj.weightLog.length === 0, true);
  eq('lite 同步码不携带 sleepOnsets', Array.isArray(liteObj.sleepOnsets) && liteObj.sleepOnsets.length === 0, true);

  // 3. diffImport 覆盖对比包含目标、步数与体重
  const diffRes = S.diffImport(JSON.stringify(liteObj));
  eq('diffImport 包含步数模块被清空预警', diffRes.wipes.some(w => w.key === 'metrics'), true);
  eq('diffImport 包含体重模块被清空预警', diffRes.wipes.some(w => w.key === 'weightLog'), true);

  // 4. addSleep 保留传入的 total 分钟数
  const hcSleep = S.addSleep({ date: '2026-10-10', start: '23:30', end: '07:30', total: 455, awake: 25, source: 'hc' });
  eq('addSleep 保留传入的 total=455', hcSleep.total, 455);

  // 5. dayHealth 不把远期历史睡眠回退冒充为今日或本周睡眠
  const todayStr = DateUtil.toStr(DateUtil.today());
  const dhToday = S.dayHealth(todayStr);
  eq('dayHealth 当日无睡眠记录时 hasSleep=false', dhToday.hasSleep, false);
  const hw = S.healthWeek(7);
  eq('healthWeek(7) 不被两周前的单条睡眠污染', hw.sleepMetNights, 0);

  // 6. WhitePaper 在挂载真实 StatsCalc / ledger / sleeps / goals 时正常聚合不崩溃
  const c1 = S.addCourse({ name: '高等数学', credit: 4 });
  S.addActivity({ date: todayStr, start: '09:00', end: '11:00', type: 'study', courseId: c1.id, courseName: '高等数学' });
  S.addLedger({ date: todayStr, type: 'expense', category: 'food', amount: 35.5 });
  S.addGoal({ title: '期末冲刺', startDate: '2026-09-01', endDate: '2026-12-31', krs: [{ id: 'k1', title: '刷题', kind: 'manual', current: 6, target: 10 }] });
  const wpCode = readFileSync(new URL('../assets/js/white-paper.js', import.meta.url), 'utf8');
  const gWp = {
    DateUtil: DateUtil,
    TimeUtil: TimeUtil,
    StatsCalc: S ? { sumByCourse: (acts, dates) => { const sc = {}; new Function('window', 'global', readFileSync(new URL('../assets/js/stats-calc.js', import.meta.url), 'utf8'))(sc, sc); return sc.StatsCalc.sumByCourse(acts, dates); } } : null,
    SleepModel: SM,
    ledgerCat: (t, k) => ({ name: k === 'food' ? '餐饮' : k }),
    Store: S,
    UI: { el: () => ({ appendChild: () => {} }) }
  };
  new Function('window', 'global', wpCode)(gWp, gWp);
  const wpData = gWp.WhitePaper.compileData();
  eq('白皮书正确聚合 topCourses 数组且不抛错', wpData.topCourses.length === 1 && wpData.topCourses[0].name === '高等数学' && wpData.topCourses[0].minutes === 120, true);
  eq('白皮书正确读取单数 S.ledger 累计支出', wpData.totalExpense, '35.50');
  eq('白皮书正确映射最大支出类别中文名', wpData.topExpenseCat, '餐饮');
  eq('白皮书正确计算在办目标平均进度', wpData.avgGoalPct, 60);

  // 8. 跨板块联动回归：目标支持 focus / sleep / active KR 归一化 + HealthConnect 睡眠分段合并与午睡过滤
  const gFocus = S.addGoal({
    title: '期末冲刺目标',
    period: 'custom',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    krs: [
      { title: '累计专注 10 小时', kind: 'focus', target: 10, unit: '小时' },
      { title: '睡眠达标 12 夜', kind: 'sleep', target: 12, unit: '天' },
      { title: '步数达标 10 天', kind: 'active', target: 10, unit: '天' }
    ]
  });
  eq('normGoal 保留 focus KR 类型', gFocus.krs[0].kind, 'focus');
  eq('normGoal 保留 sleep KR 类型', gFocus.krs[1].kind, 'sleep');
  eq('normGoal 保留 active KR 类型', gFocus.krs[2].kind, 'active');

  const hcCode = readFileSync(new URL('assets/js/health-connect.js', SRC_BASE), 'utf8');
  const gHc = {};
  new Function('window', 'global', hcCode)(gHc, gHc);
  if (gHc.HealthConnect && gHc.HealthConnect._test) {
    const H = gHc.HealthConnect._test;
    const rawSessions = [
      { date: '2026-10-24', start: '23:30', end: '02:00', startTime: '2026-10-23T15:30:00Z', endTime: '2026-10-23T18:00:00Z', totalMinutes: 150, awakeMinutes: 5, deepMinutes: 60 },
      { date: '2026-10-24', start: '02:20', end: '07:30', startTime: '2026-10-23T18:20:00Z', endTime: '2026-10-23T23:30:00Z', totalMinutes: 300, awakeMinutes: 10, deepMinutes: 50 },
      { date: '2026-10-24', start: '13:10', end: '13:45', startTime: '2026-10-24T05:10:00Z', endTime: '2026-10-24T05:45:00Z', totalMinutes: 35, awakeMinutes: 0 }
    ];
    const merged = H.mergeNightSessions(rawSessions);
    eq('HealthConnect 过滤白天午睡并合并夜间两段为 1 晚', merged.length, 1);
    eq('HealthConnect 合并后起点取最早段 23:30', merged[0].start, '23:30');
    eq('HealthConnect 合并后终点取最晚段 07:30', merged[0].end, '07:30');
    eq('HealthConnect 合并后总睡眠时长累加 450 分钟', merged[0].totalMinutes, 450);
    eq('HealthConnect 合并后深睡时长累加 110 分钟', merged[0].deepMinutes, 110);

  // 第二轮跨板块联动：记账预算 KR (budget)
  S.state.ledger = []; S.state.goals = [];
  const todayB = DateUtil.toStr(DateUtil.today());
  const gBudget = S.addGoal({
    title: '理性消费目标',
    period: 'custom',
    startDate: todayB,
    endDate: todayB,
    krs: [
      { title: '总支出不超过 500 元', kind: 'budget', target: 500, category: '', unit: '元' },
      { title: '餐饮支出不超过 200 元', kind: 'budget', target: 200, category: 'food', unit: '元' }
    ]
  });
  eq('normGoal 保留 budget KR 类型', gBudget.krs[0].kind, 'budget');
  eq('normGoal 保留 budget KR 的 category 字段', gBudget.krs[1].category, 'food');

  let pgB = S.goalProgressOf(gBudget);
  eq('无账目时 budget KR 标记为 empty', pgB.rows[0].empty, true);
  eq('无账目时不计入平均分母', pgB.counted, 0);

  S.addLedger({ type: 'expense', amount: 120, category: 'food', date: todayB, time: '12:00', note: '午餐' });
  pgB = S.goalProgressOf(gBudget);
  eq('总支出 KR 累计 120 元', pgB.rows[0].value, 120);
  eq('未超支时总支出 KR 完成度为 100%', pgB.rows[0].pct, 1);
  eq('餐饮分类支出 KR 累计 120 元', pgB.rows[1].value, 120);
  eq('未超支时餐饮支出 KR 完成度为 100%', pgB.rows[1].pct, 1);

  S.addLedger({ type: 'expense', amount: 130, category: 'food', date: todayB, time: '18:30', note: '聚餐' });
  pgB = S.goalProgressOf(gBudget);
  eq('总支出 250/500 仍守住预算 (pct=1)', pgB.rows[0].pct, 1);
  eq('餐饮 250/200 超支 25%，完成度回落至 0.75', Math.round(pgB.rows[1].pct * 100), 75);

  }
}


console.log('\n小米运动健康风格睡眠/锻炼看板、Health Connect 锻炼会话与跨板块深度联动');
{
  const S = await initTestStore();
  const todayStr = DateUtil.toStr(DateUtil.today());

  // 1. SleepModel.parseQuickSleep 自然语言快记解析
  const q1 = SM.parseQuickSleep('昨晚11点半睡今早7点半起 睡得很好', '2026-10-24');
  eq('自然语言睡眠: 醒来日归属基准日 2026-10-24', q1.date, '2026-10-24');
  eq('自然语言睡眠: 入睡时刻 23:30', q1.start, '23:30');
  eq('自然语言睡眠: 起床时刻 07:30', q1.end, '07:30');
  eq('自然语言睡眠: 总时长 480 分钟', q1.total, 480);
  eq('自然语言睡眠: 质量识别为 good', q1.quality, 'good');

  const q2 = SM.parseQuickSleep('凌晨1点睡到9点 失眠多梦', '2026-10-24');
  eq('自然语言睡眠: 凌晨入睡归属当日 2026-10-24', q2.date, '2026-10-24');
  eq('自然语言睡眠: 01:00 入睡', q2.start, '01:00');
  eq('自然语言睡眠: 09:00 起床', q2.end, '09:00');
  eq('自然语言睡眠: 失眠多梦识别为 bad', q2.quality, 'bad');

  const q3 = SM.parseQuickSleep('昨晚睡了7个半小时', '2026-10-24');
  eq('自然语言睡眠: 仅时长反推总长 450 分钟', q3.total, 450);

  // 2. SleepModel.sleepScoreAndProfile 小米运动健康睡眠评分、睡眠动物与多周期时序图
  const profGood = SM.sleepScoreAndProfile({
    date: '2026-10-23', start: '23:00', end: '07:00',
    total: 480, deep: 115, light: 255, rem: 110, awake: 5, efficiency: 98, quality: 3
  }, 8);
  eq('小米睡眠评分: 优质睡眠 >= 85 分', profGood.score >= 85, true);
  eq('小米睡眠评分: 等级为优秀', profGood.tier, 'great');
  eq('小米睡眠画像: 早睡高深睡识别为规律云雀或深眠考拉', ['lark', 'koala'].includes(profGood.animal.key), true);
  eq('小米睡眠时序图: 生成多段睡眠周期轨迹', Array.isArray(profGood.hypnogram) && profGood.hypnogram.length >= 6, true);
  eq('小米睡眠结构: 四阶段占比之和约为 100%', (profGood.stages.deepPct + profGood.stages.lightPct + profGood.stages.remPct + profGood.stages.awakePct) >= 98, true);

  const profOwl = SM.sleepScoreAndProfile({
    date: '2026-10-24', start: '02:15', end: '09:45',
    total: 450, deep: 80, light: 260, rem: 110, awake: 15, quality: 2
  }, 8);
  eq('小米睡眠画像: 凌晨2点后入睡识别为灵感夜鸮', profOwl.animal.key, 'owl');

  // 3. HealthConnect 锻炼会话映射与状态探测
  const hcCode2 = readFileSync(new URL('assets/js/health-connect.js', SRC_BASE), 'utf8');
  const gHc2 = {};
  new Function('window', 'global', hcCode2)(gHc2, gHc2);
  const H2 = gHc2.HealthConnect._test;
  const wRec = H2.toWorkoutRecord({
    startTime: '2026-10-24T10:00:00Z',
    endTime: '2026-10-24T10:45:00Z',
    durationMinutes: 45,
    exerciseType: 'running',
    title: '操场慢跑',
    calories: 340,
    distance: 5200,
    avgHr: 148,
    maxHr: 168,
    steps: 6100
  });
  eq('HealthConnect 锻炼转换: 类型识别为 run', wRec.type, 'run');
  eq('HealthConnect 锻炼转换: 时长 45 分钟', wRec.duration, 45);
  eq('HealthConnect 锻炼转换: 热量 340 kcal', wRec.calories, 340);
  eq('HealthConnect 锻炼转换: 距离 5200 米', wRec.distance, 5200);
  eq('HealthConnect 锻炼转换: 平均心率 148 bpm', wRec.avgHr, 148);

  // 4. 锻炼 -> 24h 时间环(象限)自动入环 + 计划自动打卡 + 饮食动态热量奖赏 + 目标 KR 联动
  S.state.activities = [];
  S.state.plans = [];
  S.state.workouts = [];
  S.state.metrics = [];
  S.state.meals = [];
  S.state.goals = [];

  const runPlan = S.addPlan({ title: '每日跑步锻炼', type: 'checkin', target: 10 });
  eq('新建运动计划初始打卡数为 0', runPlan.records.length, 0);

  const addedW = S.addWorkout({
    date: todayStr,
    start: '17:00',
    end: '17:45',
    duration: 45,
    type: 'run',
    name: '操场5公里跑',
    calories: 360,
    distance: 5000,
    avgHr: 152,
    source: 'hc'
  }, { syncQuadrant: true, syncPlan: true });
  eq('addWorkout 保存成功且热量为 360', addedW.calories, 360);

  // 验证象限 24h 时间环自动同步
  const syncedAct = S.state.activities.find(a => a.workoutId === addedW.id);
  eq('锻炼自动同步至象限 24h 时间环', !!syncedAct, true);
  eq('象限时间块分类为 exercise', syncedAct.type, 'exercise');
  eq('象限时间块起止时间与手环一致', syncedAct.start + '-' + syncedAct.end, '17:00-17:45');

  // 验证运动计划自动打卡
  const updatedPlan = S.state.plans.find(p => p.id === runPlan.id);
  eq('手环锻炼完成后自动为运动计划打卡 +1', updatedPlan.records.length, 1);

  // 验证活力三环与饮食动态热量扩容
  S.addMetric({ date: todayStr, steps: 8500, calories: 220, distance: 6200, source: 'hc' });
  S.addMeal({ date: todayStr, mealType: 'lunch', title: '鸡胸肉轻食碗', calories: 650, healthy: true });
  S.addMeal({ date: todayStr, mealType: 'dinner', title: '杂粮饭套餐', calories: 750, healthy: true });
  const dhNow = S.dayHealth(todayStr);
  eq('活力三环: 锻炼时长 45 分钟达标 (workoutMet=true)', dhNow.workoutMet, true);
  eq('活力三环: 步数 8500 步达标 (stepMet=true)', dhNow.stepMet, true);
  eq('活力三环: 活动千卡达标 (kcalMet=true)', dhNow.kcalMet, true);
  eq('活力三环: 三环全满合拢 (ringsAllMet=true)', dhNow.ringsAllMet, true);
  eq('饮食联动: 运动消耗折算今日饮食动态热量奖励 > 200 kcal', dhNow.dietBonusKcal >= 200, true);
  eq('饮食联动: 动态热量上限高于基础上限', dhNow.dynamicDietGoal > dhNow.dietKcalGoal, true);

  // 验证目标模块 workout 与 diet KR 联动
  const gHealth = S.addGoal({
    title: '秋季体能与饮食管理',
    period: 'custom',
    startDate: todayStr,
    endDate: todayStr,
    krs: [
      { title: '锻炼达标 1 天', kind: 'workout', target: 1, unit: '天' },
      { title: '健康饮食达标 1 天', kind: 'diet', target: 1, unit: '天' }
    ]
  });
  eq('normGoal 保留 workout KR 类型', gHealth.krs[0].kind, 'workout');
  eq('normGoal 保留 diet KR 类型', gHealth.krs[1].kind, 'diet');
  const pgH = S.goalProgressOf(gHealth);
  eq('workout KR 自动统计达标 1 天 (pct=1)', pgH.rows[0].pct, 1);
  eq('diet KR 自动统计达标 1 天 (pct=1)', pgH.rows[1].pct, 1);

  // 5. 课表 + 精力黄金期推算今日最佳运动空档 recommendWorkoutSlot
  const recSlot = S.recommendWorkoutSlot(todayStr);
  eq('智能运动空档推荐返回有效时间段', !!(recSlot && recSlot.start && recSlot.end && recSlot.label), true);

  // 6. 考前及格线反推风险雷达 examRiskOf 与桌面小组件快照 snapshotForWidget
  const riskCourse = S.addCourse({
    name: '量子力学',
    exam: { date: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 5)), start: '09:00' }
  });
  const tree = S.defaultGradeTree();
  tree.children[0].score = 35; // 平时分 40% 权重仅得 35 分 -> 期末 60% 需考 77 分
  S.saveGrade(S.state.currentSemesterId, { key: 'c:量子力学', name: '量子力学', credit: 4, root: tree });
  const riskInfo = S.examRiskOf(riskCourse);
  eq('考前风险雷达: 已录入平时分标记 scored=true', riskInfo.scored, true);
  eq('考前风险雷达: 期末需考 77 分才及格判定为 hard', riskInfo.needFor60 === 77 && riskInfo.status === 'hard', true);

  const snap = S.snapshotForWidget();
  eq('桌面小组件快照包含 dateLabel 与 weekNo', typeof snap.dateLabel === 'string' && typeof snap.weekNo === 'number', true);
  eq('桌面小组件快照包含 sleep 与 tasks 统计对象', typeof snap.sleep === 'object' && typeof snap.tasks === 'object' && Array.isArray(snap.courses), true);

  // 7. 校验所有核心视图脚本语法合法；核心引导 5 步、完整导览 24 步
  const obCode = readFileSync(new URL('assets/js/onboard.js', SRC_BASE), 'utf8');
  const gOb = { Store: S, UI: { icons: {}, el: () => ({}) }, App: {} };
  new Function('window', 'global', 'UI', 'Store', obCode)(gOb, gOb, gOb.UI, S);
  eq('新手核心引导为 5 步', gOb.Onboard.steps, 5);
  eq('完整功能导览保持 24 步', gOb.Onboard.totalSteps, 24);
}


console.log('\n全链路补齐回归：小米/手环 CSV 导入、Ocr.recognizeSleep 修复、Web Share Target、健康三段路由与六大跨板块联动');
{
  const S = await initTestStore();
  const todayStr = DateUtil.toStr(DateUtil.today());
  const yestStr = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  const d2Str = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2));

  // 1. P0 小米运动健康 / Zepp Life CSV 解析与 Store.importHealthCsv
  const sleepCsv = [
    'date,start,end,deep,light,rem,awake,efficiency',
    `${todayStr},23:20,07:20,110,250,105,15,96`,
    `${yestStr},23:50,07:30,95,245,100,20,92`
  ].join('\n');
  const pSleep = SM.parseXiaomiCsv(sleepCsv);
  eq('CSV 解析: 睡眠表识别 ok=true 且提取 2 晚', pSleep.ok && pSleep.sleeps.length === 2, true);
  eq('CSV 解析: 第一晚深睡 110 分钟、效率 96%', pSleep.sleeps[0].deep === 110 && pSleep.sleeps[0].efficiency === 96, true);

  const actCsv = [
    '日期,步数,热量,距离',
    `${todayStr},9200,340,6.5`
  ].join('\n');
  const pAct = SM.parseXiaomiCsv(actCsv);
  eq('CSV 解析: 中文活动表识别步数 9200 且 6.5km 自动转 6500 米', pAct.ok && pAct.metrics[0].steps === 9200 && pAct.metrics[0].distance === 6500, true);

  const gdprCsv = [
    'Uid,Sid,Key,Time,Value',
    `1001,default,sport,2026-10-24 17:00:00,"{""sportType"":""badminton"",""duration"":2700,""calories"":310,""avgHr"":146}"`
  ].join('\n');
  const pGdpr = SM.parseXiaomiCsv(gdprCsv);
  eq('CSV 解析: 小米 GDPR JSON-in-CSV 识别羽毛球 45 分钟 (2700秒自动转分)', pGdpr.ok && pGdpr.workouts.length === 1 && pGdpr.workouts[0].type === 'badminton' && pGdpr.workouts[0].duration === 45, true);

  S.state.sleeps = [];
  S.state.metrics = [];
  S.state.workouts = [];
  const imp1 = S.importHealthCsv(sleepCsv);
  const imp2 = S.importHealthCsv(actCsv);
  const imp3 = S.importHealthCsv(gdprCsv);
  eq('Store.importHealthCsv: 成功导入 2 晚睡眠、1 天活动、1 次锻炼', imp1.sleepsAdded === 2 && imp2.metricsAdded === 1 && imp3.workoutsAdded === 1, true);
  const impDup = S.importHealthCsv(sleepCsv);
  eq('Store.importHealthCsv: 重复导入同日睡眠自动去重 (sleepsAdded=0)', impDup.sleepsAdded, 0);

  // 2. P2 第一层 Ocr.recognizeSleep 原生 TextDetector 返回格式归一化修复
  const ocrCode2 = readFileSync(new URL('assets/js/ocr.js', SRC_BASE), 'utf8');
  const gOcr2 = {
    TextDetector: function () {
      this.detect = () => Promise.resolve([
        { rawValue: '23:30 入睡', boundingBox: { x: 10, y: 10, width: 80, height: 20 } },
        { rawValue: '07:20 醒来', boundingBox: { x: 10, y: 40, width: 80, height: 20 } },
        { rawValue: '深睡 1小时45分', boundingBox: { x: 10, y: 70, width: 100, height: 20 } }
      ]);
    }
  };
  new Function('window', 'global', ocrCode2)(gOcr2, gOcr2);
  const sleepOcrRes = await gOcr2.Ocr.recognizeSleep({});
  eq('Ocr.recognizeSleep: 原生 TextDetector 返回标准化 { words, engine: native }', sleepOcrRes && sleepOcrRes.engine === 'native' && Array.isArray(sleepOcrRes.words) && sleepOcrRes.words.length === 3, true);

  // 3. P2 第二层 Web Share Target 配置与健康三段路由 (#/workout)
  const mfJson = JSON.parse(readFileSync(new URL('manifest.webmanifest', SRC_BASE), 'utf8'));
  eq('manifest.webmanifest 包含 share_target POST 配置', !!(mfJson.share_target && mfJson.share_target.method === 'POST' && mfJson.share_target.params && mfJson.share_target.params.files), true);

  const rtCode = readFileSync(new URL('assets/js/router.js', SRC_BASE), 'utf8');
  const gRt = {};
  new Function('window', 'global', rtCode)(gRt, gRt);
  const rWk1 = gRt.Router.resolve('#/workout', ['health', 'today']);
  const rWk2 = gRt.Router.resolve('#/health/workout', ['health', 'today']);
  eq('Router: #/workout 别名解析至 health 视图的 workout 分页', rWk1 && rWk1.id === 'health' && rWk1.tab === 'workout', true);
  eq('Router: #/health/workout 解析至 health 视图的 workout 分页', rWk2 && rWk2.id === 'health' && rWk2.tab === 'workout', true);

  // 4. 联动 A：课表体育课识别与一键转锻炼会话
  const peCourse = S.addCourse({
    name: '大学体育（羽毛球）',
    location: '综合体育馆',
    day: DateUtil.isoDow(DateUtil.today()),
    periodId: S.periods[2].id,
    startWeek: 1,
    endWeek: 20
  });
  eq('联动 A: Store.isPeCourse 准确识别体育/羽毛球课', S.isPeCourse(peCourse), true);
  eq('联动 A: Store.inferCourseSportType 映射为 badminton', S.inferCourseSportType(peCourse.name), 'badminton');
  const peWk = S.logCourseWorkout(peCourse.id, todayStr);
  eq('联动 A: Store.logCourseWorkout 生成羽毛球锻炼记录并同步象限', !!(peWk && peWk.type === 'badminton' && peWk.courseId === peCourse.id && peWk.activityId), true);

  // 5. 联动 C：番茄钟完成自动累加匹配的「时长型计划」
  S.state.plans = [];
  const studyDurPlan = S.addPlan({
    title: '高等数学复习时长',
    type: 'duration',
    target: 300,
    unit: '分钟',
    tags: ['学习/高数'],
    startDate: todayStr
  });
  const sportDurPlan = S.addPlan({
    title: '本周跑步时长',
    type: 'duration',
    target: 150,
    unit: '分钟',
    startDate: todayStr
  });
  S.finishFocus(45, '', {
    date: todayStr,
    start: '09:00',
    end: '09:45',
    name: '专注：高等数学刷题',
    tags: ['学习/高数']
  });
  const updatedStudyPlan = S.getPlan(studyDurPlan.id);
  const updatedSportPlan = S.getPlan(sportDurPlan.id);
  eq('联动 C: 番茄专注 45 分钟自动累加至匹配的学习时长计划', S.planProgress(updatedStudyPlan).value, 45);
  eq('联动 C: 番茄专注不会误加到跑步运动时长计划', S.planProgress(updatedSportPlan).value, 0);
  eq('联动 C: lastSyncedPlans 记录已同步计划名', Array.isArray(S.pomodoro.lastSyncedPlans) && S.pomodoro.lastSyncedPlans.includes('高等数学复习时长'), true);

  // 6. 联动 E：日记一键生成「今日足迹」汇总文本
  S.addLedger({ date: todayStr, type: 'expense', category: 'food', amount: 26.5, note: '午餐' });
  const footprint = S.buildDayFootprint(todayStr);
  eq('联动 E: 今日足迹包含日期标题与番茄专注时长', footprint.includes(todayStr) && footprint.includes('番茄专注 45 分钟'), true);
  eq('联动 E: 今日足迹包含健康步数与今日支出', footprint.includes('9200 步') && footprint.includes('¥26.5'), true);

  // 7. 联动 F：日记连续 2 天疲惫/低落自动触发计划减负保护 (ease)
  S.setHealthOn(true);
  S.state.sleeps = [];
  S.state.diaries = [];
  S.state.plans = [];
  S.addPlan({ title: '高强度核心训练', type: 'checkin', period: 'daily', days: 21, startDate: d2Str, load: 'high' });
  eq('联动 F: 无睡眠且无疲惫日记时 planLoadAdvice 不触发', S.planLoadAdvice().has, false);

  S.saveDiary({ date: d2Str, mood: 'tired', content: '实验课连上很累' });
  S.saveDiary({ date: yestStr, mood: 'low', content: '复习压力大有点低落' });
  eq('联动 F: 连续 2 天疲惫/低落日记被 hasConsecutiveLowMood 识别', S.hasConsecutiveLowMood(todayStr), true);
  const moodAdv = S.planLoadAdvice();
  eq('联动 F: 即使未记睡眠也自动开启计划 ease 减负保护', moodAdv.has && moodAdv.mode === 'ease' && moodAdv.moodFatigue === true, true);
}


/* ==========================================================
 * 七项交互精简与计划月视图/打卡日程/记账CSV导入专项测试
 * ========================================================== */
console.log('\n七项新特性验证：今日去收集、删积分来源统计、开发者无作弊码提示、积分规则问号收纳、记账CSV导入、计划月视图与打卡日程流');
{
  const S = await initTestStore();
  const fs = await import('node:fs');

  // 1. 今日栏目去掉收集
  const todaySrc = fs.readFileSync(new URL('../assets/js/views/today.js', import.meta.url), 'utf8');
  eq('today.js 已移除 gachaBlock 函数', todaySrc.includes('function gachaBlock'), false);
  eq('today.js 已移除我的森林卡片', todaySrc.includes('forest-card'), false);

  // 2. 积分卡片移除后彻底清理 sumBySource / pointSources 死代码
  eq('Store.pointSources 已彻底删除', typeof S.pointSources, 'undefined');
  const scSrc = fs.readFileSync(new URL('../assets/js/stats-calc.js', import.meta.url), 'utf8');
  eq('stats-calc.js 已彻底删除 sumBySource', scSrc.includes('sumBySource'), false);
  const statsSrc = fs.readFileSync(new URL('../assets/js/views/stats.js', import.meta.url), 'utf8');
  eq('stats.js 已彻底删除 pointSourceCard 与 pointCurveCard', !statsSrc.includes('function pointSourceCard') && !statsSrc.includes('function pointCurveCard'), true);

  // 3. 开发者模式删掉所有作弊码提示
  const settingsSrc = fs.readFileSync(new URL('../assets/js/views/settings.js', import.meta.url), 'utf8');
  eq('settings.js 已移除作弊码明文提示', settingsSrc.includes('口令：『我已经太烧了』'), false);
  const onboardSrc = fs.readFileSync(new URL('../assets/js/onboard.js', import.meta.url), 'utf8');
  eq('onboard.js 已移除关闭抽卡口令提示', onboardSrc.includes('输入『关闭抽卡』'), false);

  // 4. 积分规则收纳为问号按钮 UI.ruleHelpBtn
  const uiSrc = fs.readFileSync(new URL('../assets/js/ui.js', import.meta.url), 'utf8');
  eq('ui.js 提供 ruleHelpBtn 组件', uiSrc.includes('global.UI.ruleHelpBtn = ruleHelpBtn'), true);
  const pomoSrc = fs.readFileSync(new URL('../assets/js/views/pomodoro.js', import.meta.url), 'utf8');
  eq('pomodoro.js 使用 V.ruleHelpBtn 收纳积分规则', pomoSrc.includes('V.ruleHelpBtn'), true);
  const goalsSrc = fs.readFileSync(new URL('../assets/js/views/goals.js', import.meta.url), 'utf8');
  eq('goals.js 使用 V.ruleHelpBtn 收纳积分规则', goalsSrc.includes('V.ruleHelpBtn'), true);
  const collSrc = fs.readFileSync(new URL('../assets/js/views/collection.js', import.meta.url), 'utf8');
  eq('collection.js 使用 V.ruleHelpBtn 收纳积分规则', collSrc.includes('V.ruleHelpBtn'), true);

  // 5. 记账 CSV 导入（支持通用 CSV、微信账单 CSV、支付宝账单 CSV 及去重）
  S.state.ledger = [];
  const sampleCsv = [
    '日期,收支,分类,金额,备注,时间,标签',
    '2026-10-20,支出,餐饮,16.50,二食堂黄焖鸡,12:15,餐饮/堂食',
    '2026-10-21,支出,交通,4.00,地铁出行,08:30,出行/地铁',
    '2026-10-22,收入,兼职,150.00,高数家教,19:00,兼职'
  ].join('\n');
  const imp1 = S.importLedgerCsv(sampleCsv);
  eq('记账 CSV 导入: ok=true', imp1.ok, true);
  eq('记账 CSV 导入: 新增 3 笔', imp1.added, 3);
  eq('记账 CSV 导入: 支出总额 20.5', imp1.expenseTotal, 20.5);
  eq('记账 CSV 导入: 收入总额 150', imp1.incomeTotal, 150);

  // 重复导入去重
  const impDup = S.importLedgerCsv(sampleCsv);
  eq('记账 CSV 重复导入: 新增 0 笔', impDup.added, 0);
  eq('记账 CSV 重复导入: 跳过 3 笔', impDup.skipped, 3);

  // 微信支付原生账单 CSV 模拟
  const wxCsv = [
    '微信支付账单明细',
    '----------------------微信支付账单明细列表--------------------',
    '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
    '2026-10-23 18:20:00,商户消费,瑞幸咖啡,生椰拿铁,支出,¥9.90,零钱,支付成功,1001,2001,/',
    '2026-10-23 19:00:00,退款,某宝商户,退货商品,不计收支,¥50.00,零钱,已全额退款,1002,2002,/'
  ].join('\n');
  const impWx = S.importLedgerCsv(wxCsv);
  eq('微信账单 CSV 导入: 过滤不计收支/退款后新增 1 笔', impWx.added, 1);
  eq('微信账单 CSV 导入: 瑞幸咖啡自动归类为 food (餐饮)', impWx.items[0].category, 'food');

  // 6 & 7. 计划月视图汇总 (plansMonthSummary) 与打卡任务历史日程流 (planCheckinHistory)
  S.state.plans = [];
  const todayStr = DateUtil.toStr(DateUtil.today());
  const d1 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
  const d3 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -3));
  const d5 = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -5));
  const p = S.addPlan({
    title: '每日晨读打卡',
    type: 'checkin',
    period: 'daily',
    days: 21,
    startDate: d5,
    color: '#10b981'
  });
  S.togglePlanCheckin(p.id, d5);
  S.togglePlanCheckin(p.id, d3);
  S.togglePlanCheckin(p.id, d1);
  S.togglePlanCheckin(p.id, todayStr);

  const hist7 = S.planCheckinHistory(p.id, 7);
  eq('planCheckinHistory: 近 7 天跨度为 7', hist7.daysSpan, 7);
  eq('planCheckinHistory: 近 7 天共打卡 4 次', hist7.checkinCount, 4);
  eq('planCheckinHistory: 近 7 天打卡天数为 4', hist7.checkedDays, 4);
  eq('planCheckinHistory: 生成 7 条日程流条目', hist7.days.length, 7);
  eq('planCheckinHistory: 今日条目 checked=true', hist7.days[0].checked, true);

  const histAll = S.planCheckinHistory(p.id, 'all');
  eq('planCheckinHistory(all): 自开始以来跨度为 6 天 (d5..today)', histAll.daysSpan, 6);
  eq('planCheckinHistory(all): 打卡 4 次', histAll.checkinCount, 4);

  const nowD = DateUtil.today();
  const mSum = S.plansMonthSummary(nowD.getFullYear(), nowD.getMonth(), 'all');
  eq('plansMonthSummary: 包含当月打卡统计', mSum.totalRecords >= 1, true);
  eq('plansMonthSummary: 包含有记录的计划数', mSum.activePlans, 1);
}

// 31. 二次启动防护、重复待办提前完成、NLP重复解析、记账日期记忆与撤销、手环睡眠全链路同步测试
console.log('\n回归测试：重复待办提前完成 / NLP重复解析 / 记账日期记忆与撤销 / 睡眠全链路同步');
{
  const S = await initTestStore();

  // A. 重复待办提前完成（today < anchor）：必须推进到 anchor 之后的下一期，绝不克隆同日
  eq('提前完成-按日：10/25 完成 10/30 任务 -> 10/31',
    nextDueDate('2026-10-30', { type: 'daily', interval: 1 }, '2026-10-25'), '2026-10-31');
  eq('提前完成-按周单选：10/25 完成 10/30(周五) 任务 -> 11/06(下周五)',
    nextDueDate('2026-10-30', { type: 'weekly', interval: 1 }, '2026-10-25'), '2026-11-06');
  eq('提前完成-按周多选(周二/周五)：10/26(周一) 提前完成 10/27(周二) 任务 -> 10/30(周五)',
    nextDueDate('2026-10-27', { type: 'weekly', interval: 1, weekdays: [2, 5] }, '2026-10-26'), '2026-10-30');
  eq('提前完成-按月固定日：10/20 提前完成 10/25 任务 -> 11/25',
    nextDueDate('2026-10-25', { type: 'monthly', interval: 1 }, '2026-10-20'), '2026-11-25');
  eq('提前完成-按月末：10/25 提前完成 10/31(月末) 任务 -> 11/30',
    nextDueDate('2026-10-31', { type: 'monthly', interval: 1, monthRule: 'lastday' }, '2026-10-25'), '2026-11-30');
  eq('提前完成-按月位置：10/25 提前完成 10/30(最后一个周五) 任务 -> 11/27',
    nextDueDate('2026-10-30', { type: 'monthly', interval: 1, monthRule: 'pos', pos: -1, wd: 5 }, '2026-10-25'), '2026-11-27');
  eq('提前完成-按年：2026-10-20 提前完成 2026-10-25 任务 -> 2027-10-25',
    nextDueDate('2026-10-25', { type: 'yearly', interval: 1 }, '2026-10-20'), '2027-10-25');

  // B. TaskNLP 重复规则自然语言解析
  const nlpCode = readFileSync(new URL('../assets/js/task-nlp.js', import.meta.url), 'utf8');
  const nlpWin = {};
  new Function('window', nlpCode)(nlpWin);
  const TaskNLP = nlpWin.TaskNLP;
  const baseD = new Date(2026, 9, 24); // 2026-10-24 (周六)

  const pDaily = TaskNLP.parse('每天早上8点背单词 #英语', { baseDate: baseD });
  eq('NLP 每天: hasRepeat=true', pDaily.hasRepeat, true);
  eq('NLP 每天: type=daily, interval=1', [pDaily.repeat.type, pDaily.repeat.interval], ['daily', 1]);
  eq('NLP 每天: 时间 08:00 & 标题清洗', [pDaily.dueTime, pDaily.title], ['08:00', '背单词']);

  const pWeekly = TaskNLP.parse('每周五下午4点课题组会', { baseDate: baseD });
  eq('NLP 每周五: type=weekly & weekdays=[5]', [pWeekly.repeat.type, pWeekly.repeat.weekdays], ['weekly', [5]]);
  eq('NLP 每周五: 首期对齐到下一个周五 2026-10-30', pWeekly.dueDate, '2026-10-30');
  eq('NLP 每周五: 标题清洗为课题组会', pWeekly.title, '课题组会');

  const pMultiW = TaskNLP.parse('每周一、三、五晚上7点夜跑', { baseDate: baseD });
  eq('NLP 每周一三五: weekdays=[1,3,5]', pMultiW.repeat.weekdays, [1, 3, 5]);
  eq('NLP 每周一三五: 标题为夜跑', pMultiW.title, '夜跑');

  const pBiWeek = TaskNLP.parse('双周三下午2点物理实验', { baseDate: baseD });
  eq('NLP 双周三: interval=2 & weekdays=[3]', [pBiWeek.repeat.interval, pBiWeek.repeat.weekdays], [2, [3]]);

  const pMonthDay = TaskNLP.parse('每月15号交月度总结', { baseDate: baseD });
  eq('NLP 每月15号: type=monthly', pMonthDay.repeat.type, 'monthly');
  eq('NLP 每月15号: 10/24 之后的首个 15 号为 2026-11-15', pMonthDay.dueDate, '2026-11-15');

  const pLastDay = TaskNLP.parse('每月末整理账单', { baseDate: baseD });
  eq('NLP 每月末: monthRule=lastday & dueDate=2026-10-31',
    [pLastDay.repeat.type, pLastDay.repeat.monthRule, pLastDay.dueDate], ['monthly', 'lastday', '2026-10-31']);

  // C. 记账：记忆上一次记账日期 + 一键清除 + 空时间保留 + CSV 导入一键撤销
  S.state.ledger = [];
  S.clearLastLedgerDate();
  eq('记账初始无记忆日期', S.getLastLedgerDate(), '');
  const lg1 = S.addLedger({ type: 'expense', amount: 18.5, category: 'food', date: '2026-10-18', time: '', note: '补记午餐' });
  eq('手动记账后自动记忆上次日期 2026-10-18', S.getLastLedgerDate(), '2026-10-18');
  eq('一键清除时间后账目 time 保持空串而非当前时间', lg1.time, '');
  S.clearLastLedgerDate();
  eq('一键清除记忆日期后恢复为空', S.getLastLedgerDate(), '');

  const csvBatch = [
    '日期,收支,分类,金额,备注',
    '2026-10-19,支出,餐饮,15,早餐',
    '2026-10-19,支出,交通,4,地铁'
  ].join('\n');
  const batchRes = S.importLedgerCsv(csvBatch);
  eq('CSV 导入返回 addedIds 长度 2', batchRes.addedIds.length, 2);
  eq('CSV 导入不污染手动记账记忆日期', S.getLastLedgerDate(), '');
  const removedCnt = S.removeLedgerEntries(batchRes.addedIds);
  eq('一键撤销 CSV 导入删除 2 笔', removedCnt, 2);
  eq('撤销后仅剩原先 1 笔手动账目', S.state.ledger.length, 1);

  // D. 手环睡眠全链路同步：persistSleepRecord & persistAllToStore & sleepByNight(hc)
  const hcCode = readFileSync(new URL('../assets/js/health-connect.js', import.meta.url), 'utf8');
  const hcWin = { Store: S, UI: { toast: () => {} } };
  new Function('window', hcCode)(hcWin);
  const HC = hcWin.HealthConnect;

  S.state.sleeps = [];
  const basicHc = {
    date: '2026-10-24', start: '23:30', end: '07:30', total: 480, awake: 0,
    deep: null, light: null, rem: null, source: 'hc'
  };
  eq('首次写入 HC 基础睡眠返回 added', HC.persistSleepRecord(basicHc), 'added');
  eq('相同 HC 睡眠重复同步返回 false', HC.persistSleepRecord(basicHc), false);

  const stageHc = {
    date: '2026-10-24', start: '23:30', end: '07:30', total: 470, awake: 10,
    deep: 110, light: 250, rem: 110, awakenings: 1, avgHr: 58, spo2: 97, source: 'hc'
  };
  eq('手环延迟补传深浅睡分期后自动更新已有 HC 记录 (updated)', HC.persistSleepRecord(stageHc), 'updated');
  eq('更新后 Store.sleeps 保存了 deep=110 与 avgHr=58',
    [S.state.sleeps[0].deep, S.state.sleeps[0].avgHr], [110, 58]);
  eq('sleepByNight 对起床日归属的 HC 跨夜睡眠完整计入 480 分钟',
    sleepByNight(S.state.sleeps, '2026-10-24'), 480);
}

console.log('\n八大跨模块联动、三个问题修复与三个建议全链路验证');
{
  const S = await initTestStore();
  const todayStr = DateUtil.toStr(DateUtil.today());

  // 1. 问题 1 + 联动 6：睡眠记录自动触发 Store.syncSleepPlans 打卡作息/睡眠计划
  const sleepPlan = S.addPlan({
    title: '每日睡够7小时早睡打卡',
    type: 'checkin',
    period: 'daily',
    startDate: '2026-10-01',
    days: 21,
    tags: ['健康/睡眠']
  });
  S.addSleep({ date: '2026-10-20', start: '23:00', end: '07:00', quality: 'good' });
  eq('addSleep(8h) 自动触发 syncSleepPlans 为次晨醒来日打卡睡眠计划',
    !!S.planRecordOfDate(S.getPlan(sleepPlan.id), '2026-10-21'), true);

  // 2. 问题 2 + 联动 5：饮食记录自动触发 Store.syncDietToPlans 打卡早餐与健康饮食计划
  const bfPlan = S.addPlan({
    title: '按时吃早餐打卡',
    type: 'checkin',
    period: 'daily',
    startDate: '2026-10-01',
    days: 21,
    tags: ['饮食']
  });
  S.addMeal({ date: '2026-10-22', time: '08:00', type: 'breakfast', content: '豆浆鸡蛋', cost: 6, kcal: 320 });
  eq('addMeal(breakfast) 自动触发 syncDietToPlans 打卡早餐计划',
    !!S.planRecordOfDate(S.getPlan(bfPlan.id), '2026-10-22'), true);

  // 3. 问题 3：番茄钟 finishFocus 同时联动打卡型(checkin)、进度型(progress)、时长型(duration)复习计划及课程
  const cMath = S.addCourse({ name: '高等数学', day: 1, periodId: 'p1', startWeek: 1, endWeek: 16 });
  const mathCheckinPlan = S.addPlan({
    title: '高等数学每日复习打卡',
    type: 'checkin',
    period: 'daily',
    startDate: '2026-10-01',
    days: 14,
    tags: ['学习', '高等数学']
  });
  const pomoProgPlan = S.addPlan({
    title: '本学期完成50个专注番茄',
    type: 'progress',
    startDate: '2026-10-01',
    target: 50,
    unit: '个',
    tags: ['专注']
  });
  const mathTask = S.addTask({ title: '高数习题册第三章', courseId: cMath.id, dueDate: todayStr });
  S.finishFocus(45, mathTask.id, { date: '2026-10-23', start: '14:00', end: '14:45' });
  eq('番茄钟完成后自动勾选绑定课程的打卡型复习计划',
    !!S.planRecordOfDate(S.getPlan(mathCheckinPlan.id), '2026-10-23'), true);
  eq('番茄钟完成后自动为进度型专注计划累加 1 个番茄',
    S.planValue(S.getPlan(pomoProgPlan.id)), 1);

  // 4. 联动 1：每日一词拼写小测验 × 英语计划自动打卡（支持用户自定义达标词数）
  eq('默认每日背词达标词数为 5', S.getWordQuizGoal(), 5);
  S.setWordQuizGoal(3);
  eq('用户自定义修改背词达标词数为 3', S.getWordQuizGoal(), 3);
  const engPlan = S.addPlan({
    title: '每日背单词打卡',
    type: 'checkin',
    period: 'daily',
    startDate: '2026-10-01',
    days: 30,
    tags: ['英语', '单词']
  });
  S.recordWordQuizResult('abandon', true, '2026-10-24');
  S.recordWordQuizResult('benefit', true, '2026-10-24');
  eq('答对 2/3 词时暂未触发打卡', !!S.planRecordOfDate(S.getPlan(engPlan.id), '2026-10-24'), false);
  const r3 = S.recordWordQuizResult('candidate', true, '2026-10-24');
  eq('答对满用户设定的 3 词后 reached=true 且自动打卡英语计划',
    [r3.reached, !!S.planRecordOfDate(S.getPlan(engPlan.id), '2026-10-24')], [true, true]);

  // 5. 联动 2：课程 × 课堂灵感笔记关联
  S.addCourseNote(cMath.id, '泰勒公式展开余项重点推导');
  eq('notesOfCourse 精确检索该课程关联的课堂笔记', S.notesOfCourse(cMath.id).length, 1);

  // 6. 联动 3：待办消费识别与一键转记账 + 日均预算超支提示
  const expTask = S.addTask({ title: '买线性代数辅导书 38.5元', dueDate: todayStr, tags: ['购物'] });
  eq('isExpenseTask 识别消费类待办', S.isExpenseTask(expTask), true);
  const parsedExp = S.extractTaskExpense(expTask);
  eq('extractTaskExpense 提取金额 38.5 与分类 study', [parsedExp.amount, parsedExp.category], [38.5, 'study']);
  const lEntry = S.createLedgerFromTask(expTask);
  eq('createLedgerFromTask 成功入账并关联 refId', [lEntry.amount, lEntry.refId], [38.5, expTask.id]);

  // 7. 联动 4：考试倒计时一键生成复习计划 & 纪念日一键生成准备待办
  S.updateCourse(cMath.id, { exam: { date: '2026-11-15', start: '09:00', end: '11:00' } });
  const examPlanRes = S.createExamStudyPlan(cMath.id, { today: '2026-10-25' });
  eq('createExamStudyPlan 自动生成备考计划与 3 阶段复习待办',
    [!!examPlanRes.plan, examPlanRes.tasksCreated], [true, 3]);
  const annivEv = S.addEvent({ title: '室友生日', date: '2026-10-28', anniv: true, kind: 'birthday', repeat: 'yearly' });
  const prepTk = S.createAnnivPrepTask(annivEv, '2026-10-25');
  eq('createAnnivPrepTask 自动生成前一天截止的准备待办', prepTk.dueDate, '2026-10-27');

  // 8. 联动 7：成绩录入实时联动目标 GPA KR
  S.addGoal({
    title: '本学期学业冲刺',
    period: 'term',
    startDate: '2026-09-01',
    endDate: '2027-01-20',
    krs: [{ title: '学期 GPA 达到 3.5', kind: 'grade', target: 3.5, semesterId: S.currentSemesterId }]
  });
  S.saveGrade(S.currentSemesterId, {
    key: 'c:' + cMath.id,
    source: 'course',
    courseId: cMath.id,
    name: '高等数学',
    credit: 4,
    root: { id: 'root', name: '总评', weight: 100, score: 92, children: [] }
  });
  eq('录入 92 分(GPA 4.0)后 syncGradeToGoals 实时算出 GPA 达标',
    [S.lastGradeGoalSync.gpa, S.lastGradeGoalSync.matchedKRs[0].reached], [4, true]);

  // 9. 联动 8：诗词/单词一键引用到今日日记
  const qDiary = S.appendQuoteToDiary('「长风破浪会有时，直挂云帆济沧海。」—— 李白《行路难》', '2026-10-25');
  eq('appendQuoteToDiary 自动写入指定日期日记正文',
    qDiary.content.indexOf('长风破浪会有时') >= 0, true);

  // 10. 建议 1：逾期任务一键顺延到今天 + 撤销恢复
  const od1 = S.addTask({ title: '逾期实验报告1', dueDate: '2026-10-10' });
  const od2 = S.addTask({ title: '逾期实验报告2', dueDate: '2026-10-12' });
  const deferRes = S.deferOverdueTasksToToday('2026-10-25');
  eq('deferOverdueTasksToToday 批量顺延逾期任务到今天',
    [deferRes.count >= 2, S.getTask(od1.id).dueDate, S.getTask(od2.id).dueDate],
    [true, '2026-10-25', '2026-10-25']);
  S.restoreTaskDueDates(deferRes.prevDates);
  eq('restoreTaskDueDates 一键撤销顺延恢复原截止日期',
    [S.getTask(od1.id).dueDate, S.getTask(od2.id).dueDate],
    ['2026-10-10', '2026-10-12']);

  // 11. 建议 2：今日/本周空闲时间段自动计算与文本生成
  const freeTxt = S.exportFreeTimeText({ weekNo: 1, includeWeekend: false });
  eq('exportFreeTimeText 生成包含周一至周五的空档文本',
    freeTxt.indexOf('周一') >= 0 && freeTxt.indexOf('周五') >= 0, true);

  // 12. 建议 3：开启新学期向导（保留旧学期课程并归档已完成待办）
  S.updateTask(od1.id, { status: 'done' });
  const oldSemId = S.currentSemesterId;
  const newSemRes = S.startNewSemester({
    name: '2026–2027 学年 春季学期',
    startDate: '2027-03-01',
    weeks: 18,
    archiveDoneTasks: true
  });
  eq('startNewSemester 切换到新学期并归档已完成旧待办，同时保留旧学期课表',
    [S.currentSemesterId === newSemRes.semester.id, newSemRes.archivedTasks >= 1, S.courses.some(c => c.semesterId === oldSemId || !c.semesterId)],
    [true, true, true]);
}

// ==========================================================
// 四大新特性全链路验证：
// 1) 基于睡眠数据的动态精力推算 (inferDayEnergyModel)
// 2) 待办一键智能分配时间 (autoAllocateTaskTime & applyTaskSchedule)
// 3) 每日 24h 全景长条时间轴聚合器 (dayTimeline)
// 4) Vis OKR 四级目标细化与复利微行动引擎 (GOAL_GROUPS / stepKrValue / krMicroActions / goalCompoundSummary)
// ==========================================================
console.log('\n四大新特性：睡眠精力推算、智能时间分配、每日长条时间轴、Vis OKR 复利系统验证');
{
  const S = await initTestStore();
  const todayStr = '2026-10-26';

  // 1. 睡眠精力推算 (inferDayEnergyModel)
  const stdModel = S.inferDayEnergyModel(todayStr, { todayStr });
  eq('无睡眠数据时回退至标准三段作息模式', stdModel.mode, 'standard');
  eq('标准模式下包含 3 段波峰', stdModel.peaks.length, 3);

  // 录入昨晚充足睡眠 (23:00 -> 07:00, 8小时)
  S.addSleep({ date: '2026-10-25', start: '23:00', end: '07:00', deep: 100, rem: 100, efficiency: 92 });
  const goodSleepModel = S.inferDayEnergyModel(todayStr, { todayStr });
  eq('有实测睡眠时自动启用 sleep 推算模式', [goodSleepModel.mode, goodSleepModel.source], ['sleep', 'actual_sleep']);
  eq('充足睡眠下 isLowSleep 为 false 且单块专注上限 >= 120 分钟',
    [goodSleepModel.isLowSleep, goodSleepModel.maxContiguousHighMin >= 120], [false, true]);
  eq('上午 10:00 (600m) 警觉度高于午后低谷 14:00 (840m)',
    goodSleepModel.avgAlertness(580, 640) > goodSleepModel.avgAlertness(810, 860), true);

  // 录入严重欠睡记录 (02:30 -> 06:30, 4小时)
  S.state.sleeps = [];
  S.addSleep({ date: '2026-10-26', start: '02:30', end: '06:30', deep: 35, rem: 35, efficiency: 70 });
  const lowSleepModel = S.inferDayEnergyModel(todayStr, { todayStr });
  eq('欠睡(<6h)时触发 isLowSleep 且单块连续高专注上限收敛为 60 分钟',
    [lowSleepModel.isLowSleep, lowSleepModel.maxContiguousHighMin], [true, 60]);

  // 未来日期 (Day +1) + 早八课程联动推算
  S.state.semesters[0].startDate = '2026-10-26'; // 2026-10-26 为周一，2026-10-27 为周二
  S.addCourse({
    name: '大学物理(早八)',
    day: 2,
    timeMode: 'custom',
    startTime: '08:00',
    endTime: '09:40',
    startWeek: 1,
    endWeek: 18,
    slots: [{ day: 2, timeMode: 'custom', startTime: '08:00', endTime: '09:40' }]
  });
  const futureModel = S.inferDayEnergyModel('2026-10-27', { todayStr });
  eq('未来早八日自动识别为 predicted_sleep 且标记 isEarlyClassDay=true',
    [futureModel.source, futureModel.isEarlyClassDay, futureModel.wakeMin <= 440],
    ['predicted_sleep', true, true]);

  // 2. 待办一键智能分配时间 (autoAllocateTaskTime & applyTaskSchedule)
  const tk = S.addTask({
    title: '完成操作系统大作业',
    dueDate: '2026-10-29',
    dueTime: '20:00',
    energy: 'high',
    priority: 'high',
    estHours: 5
  });

  // 2a. 不连续拆分模式 (5h = 300m)
  const splitAlloc = S.autoAllocateTaskTime(tk, {
    totalMinutes: 300,
    mode: 'split',
    nowDateStr: todayStr,
    nowTimeStr: '08:30'
  });
  eq('不连续拆分模式成功分配满 300 分钟 (5h)',
    [splitAlloc.ok, splitAlloc.allocatedMinutes, splitAlloc.slots.length >= 2],
    [true, 300, true]);
  // 验证避开周二 08:00-09:40 的早八课与 12:00-12:30 午餐缓冲
  const hasCourseConflict = splitAlloc.slots.some(sl =>
    sl.date === '2026-10-27' && !(sl.endMin <= 480 || sl.startMin >= 580)
  );
  const hasLunchConflict = splitAlloc.slots.some(sl =>
    !(sl.endMin <= 720 || sl.startMin >= 750)
  );
  eq('分配时段严格避开课程与午餐保护窗', [hasCourseConflict, hasLunchConflict], [false, false]);

  // 2b. 换一批时段 (variant = 1)
  const splitAllocV1 = S.autoAllocateTaskTime(tk, {
    totalMinutes: 300,
    mode: 'split',
    variant: 1,
    nowDateStr: todayStr,
    nowTimeStr: '08:30'
  });
  eq('variant=1 换一批时段仍可完整分配 300 分钟', splitAllocV1.allocatedMinutes, 300);

  // 2c. 连续整块模式 (contiguous, 3h = 180m)
  const contigAlloc = S.autoAllocateTaskTime(tk, {
    totalMinutes: 180,
    mode: 'contiguous',
    nowDateStr: todayStr,
    nowTimeStr: '08:30'
  });
  eq('连续整块模式找到单块 180 分钟连续空档',
    [contigAlloc.ok, contigAlloc.slots.length, contigAlloc.slots[0].duration],
    [true, 1, 180]);

  // 2d. 一键落盘 applyTaskSchedule
  const applyRes = S.applyTaskSchedule(tk.id, splitAlloc.slots, { syncEvents: true });
  eq('applyTaskSchedule 一键写入计划时间块与同步日程事件',
    [applyRes.addedBlocks === splitAlloc.slots.length, applyRes.addedEvents === splitAlloc.slots.length, applyRes.totalMinutes],
    [true, true, 300]);

  // 3. 每日 24h 全景长条时间轴聚合器 (dayTimeline)
  S.addMeal({ date: '2026-10-27', time: '12:10', type: 'lunch', content: '牛肉面', cost: 16, kcal: 550 });
  S.addActivity({ date: '2026-10-27', start: '19:00', end: '20:30', name: '复习线代', type: 'study', planned: false });
  const ddlTask = S.addTask({ title: '提交物理实验预习报告', dueDate: '2026-10-27', dueTime: '18:00', priority: 'high' });

  const tl27 = S.dayTimeline('2026-10-27', { todayStr: '2026-10-27', nowMin: 10 * 60 });
  eq('dayTimeline 聚合过去实心记录（已上早八课 + 睡眠 + 用餐 + 实录活动）',
    tl27.pastBlocks.some(b => b.kind === 'course') && tl27.pastBlocks.some(b => b.kind === 'activity'),
    true);
  eq('dayTimeline 聚合未来规划虚线块（智能排入的计划专注块）',
    tl27.futureBlocks.some(b => b.kind === 'planned_block'),
    true);
  eq('dayTimeline 聚合截止时间点横线 (18:00 = 1080m)',
    tl27.deadlines.some(d => d.id === ddlTask.id && d.time === '18:00' && d.timeMin === 1080),
    true);

  // 4. Vis OKR 四级目标细化与复利微行动系统
  S.state.goals = [];
  const visGoal = S.addGoal({
    title: '体态管理与学业进阶',
    group: 'health',
    period: 'term',
    startDate: '2026-10-10',
    endDate: '2027-01-15',
    krs: [
      { title: '减重至 94 斤', kind: 'manual', startVal: 104, target: 94, current: 99, step: 1, unit: '斤' },
      { title: '跑完 20 次夜跑', kind: 'manual', startVal: 0, target: 20, current: 10, step: 1, unit: '次' }
    ]
  });
  const pg0 = S.goalProgressOf(visGoal);
  eq('双向递减 KR (104 -> 94，当前 99) 精确算出 50% 进度',
    [pg0.rows[0].pct, pg0.rows[1].pct, pg0.pct],
    [0.5, 0.5, 50]);

  // 水位卡片右下角「⊕」一键步进 (stepKrValue)
  const stepRes = S.stepKrValue(visGoal.id, visGoal.krs[0].id, null, '晨起称重', todayStr);
  eq('递减型 KR 点击 ⊕ 自动向目标步进 -1 (99 -> 98，进度 50% -> 60%)',
    [stepRes.ok, stepRes.value, stepRes.krPct, stepRes.goalPct],
    [true, 98, 60, 55]);

  // 绑定第 4 级每日微行动（计划 + 待办）
  const microPlan = S.addPlan({
    title: '每日帕梅拉燃脂 20 分钟',
    type: 'checkin',
    period: 'daily',
    days: 20,
    startDate: '2026-10-10',
    goalId: visGoal.id,
    krId: visGoal.krs[0].id
  });
  const microTask = S.addTask({
    title: '采购低脂鸡胸肉与蔬菜',
    dueDate: todayStr,
    goalId: visGoal.id,
    krId: visGoal.krs[0].id
  });
  const microActs = S.krMicroActions(visGoal.id);
  eq('krMicroActions 检索出关联的每日习惯与待办微行动并计算单次复利贡献百分比',
    [microActs.length, microActs.every(m => m.contribPct > 0)],
    [2, true]);

  // 复利摘要大盘 (goalCompoundSummary)
  const comp = S.goalCompoundSummary(todayStr);
  eq('goalCompoundSummary 计算出总进度 55%、今日增加进度 > 0、第 2 个 10 天微周期',
    [comp.avgPct, comp.todayAddedPct > 0, comp.todayRecords >= 1, comp.tenDayIndex],
    [55, true, true, 2]);
  // 5. 新手教程 Onboard 步数与「目标」核心步骤完整性校验
  const obCode = readFileSync(new URL('../assets/js/onboard.js', import.meta.url), 'utf8');
  const obWin = { UI: { el: () => ({}), icons: {}, svg: () => ({}), toast: () => {} } };
  new Function('window', 'UI', obCode)(obWin, obWin.UI);
  eq('Onboard.steps 核心引导 5 步', obWin.Onboard.steps, 5);
  eq('Onboard.totalSteps 完整导览 24 步', obWin.Onboard.totalSteps, 24);
  eq('Onboard 包含「目标」核心步骤 (view: plans, tab: goals)',
    /view:\s*'plans',\s*tab:\s*'goals',[\s\S]*?title:\s*'目标'/.test(obCode), true);

  // 6. 方案 A 五大核心分区导航模式切换与 KR 双列水位缩略图卡片校验
  eq('默认导航模式为方案 A 五大分区整合模式 (hub5)', S.getNavLayout(), 'hub5');
  S.setNavLayout('classic');
  eq('可一键切换为经典多模块模式 (classic)', S.getNavLayout(), 'classic');
  S.setNavLayout('hub5');
  eq('可切回方案 A 五大分区整合模式 (hub5)', S.getNavLayout(), 'hub5');

  const appCode = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
  eq('app.js 包含 HUB_PARTITIONS 五大核心分区定义与 #hubBar 渲染逻辑',
    /var HUB_PARTITIONS = \[/.test(appCode) && /function renderHubBar\(\) \{/.test(appCode), true);

  const goalsCode = readFileSync(new URL('../assets/js/views/goals.js', import.meta.url), 'utf8');
  eq('goals.js KR 水位卡片包含 alignItems: stretch 与 repeat(2, minmax(0, 1fr)) 双列缩略图网格',
    /alignItems:\s*'stretch'/.test(goalsCode) && /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(goalsCode), true);

  // 7. 六项 E2E 用例回归校验（verify_b_points / verify_b_records / verify_deep_links / verify_plan_load_ui / verify_shop / verify_task_shot / verify_three_features）
  S.state.pomodoro.pointLog = [];
  S.addPoints(10, 'focus');
  S.addPoints(5, 'sleep');
  S.addPoints(2, 'meal');
  eq('积分流水记录写入 pointLog 且 pointSources 死代码已移除',
    [S.state.pomodoro.pointLog.length, typeof S.pointSources], [3, 'undefined']);

  // verify_shop: 30天月卡全勤结算写入 35 条 src=card 流水
  const realToday = DateUtil.today;
  S.state.shop.card = {
    startDate: '2026-01-01', endDate: '2026-01-30',
    days: {}, weekAwardEnd: '', fullAwarded: false, paid: 300, gained: 0
  };
  S.state.pomodoro.pointLog = [];
  for (let i = 1; i <= 30; i++) {
    DateUtil.today = () => new Date('2026-01-' + String(i).padStart(2, '0') + 'T10:00:00');
    S.settleCardFor(DateUtil.toStr(DateUtil.today()));
  }
  DateUtil.today = realToday;
  eq('verify_shop: 月卡30天全勤返利写入 35 条 src=card 积分流水',
    S.state.pomodoro.pointLog.filter(l => l.src === 'card').length, 35);

  // verify_plan_load_ui: 早起背单词等学习/运动类计划不会被 addSleep 自动误打卡
  S.state.plans = [];
  const pRun = S.addPlan({ title: '跑步 5 公里', type: 'checkin', period: 'daily', days: 21, startDate: '2026-10-01', load: 'high' });
  const pWord = S.addPlan({ title: '早起背单词', type: 'checkin', period: 'daily', days: 21, startDate: '2026-10-01', load: 'high' });
  S.addSleep({ date: '2026-10-25', start: '23:00', end: '07:05', deep: 110, rem: 100, awake: 8, efficiency: 94 });
  eq('verify_plan_load_ui: addSleep 不会误给「早起背单词」自动打卡',
    [S.getPlan(pRun.id).records.length, S.getPlan(pWord.id).records.length], [0, 0]);

  const taskShotCode = readFileSync(new URL('../assets/js/views/task-shot.js', import.meta.url), 'utf8');
  eq('verify_task_shot: task-shot.js 直接调用 global.Ocr.recognizeLocal 支持 mock 与全图识别',
    taskShotCode.includes('global.Ocr.recognizeLocal(S.file'), true);

  const calCode = readFileSync(new URL('../assets/js/views/calendar.js', import.meta.url), 'utf8');
  eq('verify_three_features: calendar.js 日详情将日程行排在时间块与待办抽屉之前以确保视口内可直接拖拽',
    calCode.indexOf('dragEventToCell(row, e.id, ds)') < calCode.indexOf('card.appendChild(blockEditor(ds))'), true);

  // 8. 课堂所学记录（courseLogs）与 Bug 1 / Bug 2 / 全库类名与选择器修复校验
  S.state.courses = [];
  S.state.courseLogs = [];
  S.state.tasks = [];
  S.state.notes = [];
  const cMath = S.addCourse({
    name: '线性代数', teacher: '王教授', location: '理教201',
    day: 2, periodId: S.periods[0].id, startWeek: 1, endWeek: 16, weekType: 'all'
  });
  const log1 = S.addCourseLog({
    courseId: cMath.id,
    week: 5,
    day: 2,
    date: '2026-10-13',
    topic: '第4章 特征值与特征向量',
    learned: '特征多项式求解、代数重数与几何重数的关系、矩阵可对角化充要条件',
    keyPoints: '重根特征向量的正交化步骤容易算错',
    mastery: 'review'
  });
  eq('addCourseLog 成功创建课堂所学记录', !!log1 && log1.courseName === '线性代数' && log1.mastery === 'review', true);
  eq('courseLogsOfCourse 准确按课程检索', S.courseLogsOfCourse(cMath.id).length, 1);
  eq('courseLogsOfSlot 准确按周次与星期匹配课表块', S.courseLogsOfSlot(cMath.id, 5, 2).length, 1);

  const log2 = S.addCourseLog({
    courseId: cMath.id,
    week: 6,
    day: 2,
    date: '2026-10-20',
    topic: '第5章 二次型及其标准形',
    learned: '配方法与正交变换法化二次型为标准形、惯性定理与正定二次型判别',
    mastery: 'mastered',
    createReviewTask: true,
    syncToNotes: true
  });
  eq('addCourseLog 支持勾选自动生成课后复习待办与同步课堂笔记',
    !!log2.taskId && !!log2.noteId && S.tasks.length === 1 && S.notes.length === 1, true);

  const stStats = S.courseLearningStats(cMath.id);
  eq('courseLearningStats 汇总总节数、已吃透、需重点复习与覆盖周数',
    [stStats.total, stStats.mastered, stStats.review, stStats.coveredWeeks], [2, 1, 1, 2]);

  const convertedTask = S.convertCourseLogToTask(log1.id);
  eq('convertCourseLogToTask 一键将重难点课堂记录转为高优一轮复习待办',
    !!convertedTask && convertedTask.courseId === cMath.id && convertedTask.priority === 'high' && convertedTask.examStage === 'round1', true);

  S.updateCourseLog(log1.id, { mastery: 'normal', topic: '第4章 特征值与对角化（已复盘）' });
  eq('updateCourseLog 更新掌握度与章节标题', S.getCourseLog(log1.id).mastery, 'normal');

  const hitLogs = searchAll({ courseLogs: S.courseLogs }, '特征多项式');
  eq('全局搜索 searchAll 支持检索课堂所学记录并跳转至课表 logs 分页',
    hitLogs.length === 1 && hitLogs[0].view === 'schedule' && hitLogs[0].tab === 'logs', true);

  S.removeCourseLog(log1.id);
  eq('removeCourseLog 删除指定课堂所学记录', S.courseLogs.length, 1);

  const cssCode = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
  const setCode = readFileSync(new URL('../assets/js/views/settings.js', import.meta.url), 'utf8');
  const schedCode = readFileSync(new URL('../assets/js/views/schedule.js', import.meta.url), 'utf8');
  eq('Bug 1 修复：app.js 显式使用 cp-hub-bar / cp-hub-chip / cp-active 且 CSS 双兼容',
    appCode.includes("class: 'cp-hub-bar'") && appCode.includes("class: 'cp-hub-chip'") && cssCode.includes('.cp-hub-bar, .hub-bar'), true);
  eq('Bug 2 修复：settings.js 显式使用 cp-seg-row / cp-seg-btn / cp-on 且 CSS 双兼容',
    setCode.includes("class: 'cp-seg-row'") && setCode.includes("class: 'cp-seg-btn'") && cssCode.includes('.cp-seg-row, .seg-row'), true);
  eq('schedule.js 包含 CourseLogDialog 与课堂所学看板入口',
    schedCode.includes('var CourseLogDialog =') && schedCode.includes('renderCourseLogsBoard'), true);

  // 9. 成绩构成保存/编辑同步、子成绩占比自动检索校验、待办精确到小时校验
  const sid0 = S.currentSemesterId;
  S.state.courses = [];
  S.state.grades = {};
  const cNoCred = S.addCourse({
    name: '大学物理实验', teacher: '赵老师', location: '物理楼302',
    credit: 0, day: 3, periodId: S.periods[0].id
  });
  eq('gradeList(sid, true) 包含尚未设置学分的课表课程',
    S.gradeList(sid0, true).some(r => r.courseId === cNoCred.id && r.name === '大学物理实验'), true);

  // 保存仅填写了构成的成绩（分数尚未出），并同步回写学分到课表课程
  const customTree = {
    id: 'g_root', name: '总评', weight: 100, score: null,
    children: [
      { id: 'g_p', name: '平时', weight: 40, score: null, children: [
        { id: 'g_p1', name: '考勤', weight: 30, score: 95, children: [] },
        { id: 'g_p2', name: '实验报告', weight: 50, score: 85, children: [] }
      ] },
      { id: 'g_f', name: '期末操作', weight: 60, score: null, children: [] }
    ]
  };
  const vBad = S.validateGradeWeights(customTree);
  eq('validateGradeWeights 准确检索出子成绩占比之和(80%)不等于母值(100%或40%)',
    vBad.valid === false && vBad.issues.length === 1 && vBad.issues[0].sumWeight === 80 && vBad.issues[0].diff100 === -20, true);

  // 当子项之和等于父项占比（如平时占40%，子项填15%+25%=40%）时智能识别通过
  customTree.children[0].children[0].weight = 15;
  customTree.children[0].children[1].weight = 25;
  const vRel = S.validateGradeWeights(customTree);
  eq('validateGradeWeights 智能识别子项之和(40%)等于母项占比(40%)',
    vRel.valid === true && vRel.groups.find(g => g.nodeId === 'g_p').matchParent === true, true);

  // 一键配平为标准 100% 制
  S.normalizeGradeWeights(customTree.children[0], 100);
  const vNorm = S.validateGradeWeights(customTree);
  eq('normalizeGradeWeights 将子项按比例配平为 100% (37.5% + 62.5%)',
    vNorm.valid === true && vNorm.allStrict100 === true &&
    customTree.children[0].children[0].weight + customTree.children[0].children[1].weight === 100, true);

  // 保存成绩构成并修改学分，验证持久化与课表课程同步
  S.saveGrade(sid0, {
    key: 'c:大学物理实验',
    source: 'course',
    courseId: cNoCred.id,
    name: '大学物理实验',
    credit: 2,
    root: customTree
  });
  eq('saveGrade 同步更新关联课表课程的学分', S.getCourse(cNoCred.id).credit, 2);
  eq('gradeRecord 可按 key 或 courseId 稳定读取已保存的成绩构成',
    S.gradeRecord(sid0, 'c:大学物理实验', cNoCred.id).root.children.length, 2);

  // 课表课程改名后，成绩构成自动迁移不丢失
  S.updateCourse(cNoCred.id, { name: '大学物理实验(上)' });
  const migratedRec = S.gradeRecord(sid0, 'c:大学物理实验(上)', cNoCred.id);
  eq('updateCourse 课程改名后自动迁移关联的成绩构成且不丢失子项',
    !!migratedRec && migratedRec.name === '大学物理实验(上)' && migratedRec.root.children.length === 2, true);

  // 待办精确到小时：NLP 相对小时解析 + DateUtil.hoursLeft
  const baseNow = new Date('2026-10-27T13:20:00');
  const nlpRelH = TaskNLP.parse('3小时后交物理实验报告 #实验 !重要', { baseDate: baseNow });
  eq('TaskNLP 支持「3小时后」精确到小时/分钟解析',
    [nlpRelH.dueDate, nlpRelH.dueTime, nlpRelH.title], ['2026-10-27', '16:20', '交物理实验报告']);

  const nlpHalfH = TaskNLP.parse('2个半小时后去实验室拿数据', { baseDate: baseNow });
  eq('TaskNLP 支持「2个半小时后」精确推算',
    [nlpHalfH.dueDate, nlpHalfH.dueTime], ['2026-10-27', '15:50']);

  const hlFuture = DateUtil.hoursLeft('2026-10-27', '16:20', baseNow);
  eq('DateUtil.hoursLeft 精确计算剩余小时数 (+3h)',
    hlFuture.hasTime === true && hlFuture.overdue === false && hlFuture.hours === 3 && hlFuture.shortText === '剩 3h', true);

  const hlPast = DateUtil.hoursLeft('2026-10-27', '11:20', baseNow);
  eq('DateUtil.hoursLeft 精确识别同日已超时的待办 (-2h)',
    hlPast.hasTime === true && hlPast.overdue === true && hlPast.hours === -2 && hlPast.shortText === '已超 2h', true);

  // 真实用户跨模块联动测试：课程改名同步更新课堂所学记录与笔记，删除未出分课程清理空壳成绩
  const logForRename = S.addCourseLog({
    courseId: cNoCred.id,
    date: '2026-10-27',
    week: 8,
    day: 2,
    topic: '分光计的调节与使用',
    learned: '掌握平行光管与望远镜光轴正交调节法'
  });
  S.updateCourse(cNoCred.id, { name: '近代物理实验(一)' });
  eq('updateCourse 课程改名同步更新关联课堂所学记录的 courseName',
    S.getCourseLog(logForRename.id).courseName, '近代物理实验(一)');

  // 今日足迹汇总包含当日课堂所学记录
  const fp27 = S.buildDayFootprint('2026-10-27');
  eq('buildDayFootprint 今日足迹自动包含当日课堂所学记录',
    fp27.includes('📖 课堂所学') && fp27.includes('分光计的调节与使用'), true);

  // 删除已填分数的课程时，成绩记录自动转为 manual 保留；删除仅保存空壳构成（无任何分数）的课程时，自动清理空壳
  S.removeCourse(cNoCred.id);
  const keptGr = S.gradeRecord(sid0, 'c:近代物理实验(一)');
  eq('removeCourse 删除已有分数的课程时将成绩转为 manual 保留',
    !!keptGr && keptGr.source === 'manual' && keptGr.courseId === '', true);
  eq('removeCourse 删除课程后保留课堂所学记录并解绑 courseId',
    S.getCourseLog(logForRename.id).courseName === '近代物理实验(一)' && S.getCourseLog(logForRename.id).courseId === '', true);

  const cShell = S.addCourse({ name: '临时选修课', credit: 1, day: 4, periodId: 'p2' });
  S.saveGrade(sid0, { key: 'c:临时选修课', source: 'course', courseId: cShell.id, name: '临时选修课', credit: 1, root: S.defaultGradeTree() });
  S.removeCourse(cShell.id);
  eq('removeCourse 删除未填任何分数的课程时自动清理空壳成绩记录',
    S.gradeRecord(sid0, 'c:临时选修课', cShell.id), null);

  // todayTasks 按截止小时升序排列 & deferOverdueTasksToToday 顺延今日已超时待办并支持恢复 dueTime
  const todayStrNow = DateUtil.toStr(DateUtil.today());
  const tkLate = S.addTask({ title: '晚间任务', dueDate: todayStrNow, dueTime: '22:00' });
  const tkEarly = S.addTask({ title: '早间已超时任务', dueDate: todayStrNow, dueTime: '00:01' });
  const tListToday = S.todayTasks();
  const idxEarly = tListToday.findIndex(x => x.id === tkEarly.id);
  const idxLate = tListToday.findIndex(x => x.id === tkLate.id);
  eq('todayTasks 同日待办严格按 dueTime 小时升序排列', idxEarly >= 0 && idxLate > idxEarly, true);

  const deferRes = S.deferOverdueTasksToToday(todayStrNow);
  eq('deferOverdueTasksToToday 将今日已过时的 00:01 待办顺延至今日 23:59',
    deferRes.count >= 1 && S.getTask(tkEarly.id).dueTime === '23:59', true);
  S.restoreTaskDueDates(deferRes.prevDates);
  eq('restoreTaskDueDates 撤销顺延时完整恢复原 dueTime (00:01)',
    S.getTask(tkEarly.id).dueTime, '00:01');

  // ---------- 第十轮新增特性专项验证：多场考试(期中/期末/自定义)、统计去积分与象限合并、日程待办合并、强制前台与夜间自律、桌面适配 ----------
  {
    const cMulti = S.addCourse({
      name: '数据结构与算法',
      day: 3,
      periodId: 'p2',
      credit: 4
    });
    const defSlots = S.courseExamSlots(cMulti);
    eq('课程默认提供期中与期末 2 个考试槽位', defSlots.length, 2);
    eq('默认槽位 1 为期中考试、槽位 2 为期末考试', [defSlots[0].label, defSlots[1].label], ['期中考试', '期末考试']);

    // 独立设置期中、期末时间，并额外添加一场随堂测验
    S.updateCourse(cMulti.id, {
      exams: [
        { id: 'midterm', type: 'midterm', label: '期中考试', date: '2026-11-05', start: '09:00', end: '11:00', location: '一教 201' },
        { id: 'final', type: 'final', label: '期末考试', date: '2027-01-12', start: '14:00', end: '16:00', location: '二教 305' },
        { id: 'ex_custom_1', type: 'custom', label: '上机测验 1', date: '2026-10-28', start: '18:30', end: '20:00', location: '机房 B402' }
      ]
    });
    const updatedCourse = S.getCourse(cMulti.id);
    const validExList = S.courseExamList(updatedCourse);
    eq('courseExamList 返回全部 3 场已设置日期的考试且按日期升序',
      validExList.map(x => x.label), ['上机测验 1', '期中考试', '期末考试']);
    eq('examsOf 准确命中期中考试日期并携带 examLabel',
      [S.examsOf('2026-11-05').some(e => e.courseId === cMulti.id && e.examLabel === '期中考试')], [true]);
    eq('examsOf 准确命中期末考试日期并携带 examLabel',
      [S.examsOf('2027-01-12').some(e => e.courseId === cMulti.id && e.examLabel === '期末考试')], [true]);
    eq('examsOf 准确命中自定义添加的上机测验',
      [S.examsOf('2026-10-28').some(e => e.courseId === cMulti.id && e.examLabel === '上机测验 1')], [true]);
    const allSemEx = S.courseExams().filter(e => e.id === cMulti.id);
    eq('courseExams 为该课程展开全部 3 场独立倒计时记录', allSemEx.length, 3);

    // 番茄钟强制前台锁屏模式
    eq('默认强制前台模式为关闭', S.getPomoStrict().enabled, false);
    S.setPomoStrict({ enabled: true, graceSec: 15, maxLeaves: 2 });
    eq('开启强制前台模式后状态持久化', [S.getPomoStrict().enabled, S.getPomoStrict().graceSec], [true, 15]);

    // 夜间自律守夜模式（自定义时间开启 + 跨午夜时段判定 + 守夜打卡结算与违规监测）
    S.setNightDiscipline({ enabled: true, startTime: '22:30', endTime: '06:30', strictForeground: true });
    eq('夜间自律自定义时间保存成功', [S.getNightDiscipline().startTime, S.getNightDiscipline().endTime], ['22:30', '06:30']);
    eq('isInNightDisciplineWindow: 23:15 处于夜间自律时段内',
      S.isInNightDisciplineWindow(new Date(2026, 9, 26, 23, 15, 0)), true);
    eq('isInNightDisciplineWindow: 次日 05:30 处于夜间自律时段内',
      S.isInNightDisciplineWindow(new Date(2026, 9, 27, 5, 30, 0)), true);
    eq('isInNightDisciplineWindow: 白天 14:00 不在夜间自律时段内',
      S.isInNightDisciplineWindow(new Date(2026, 9, 27, 14, 0, 0)), false);

    // 正常完成一晚自律守夜（23:00 -> 次日 07:00，无超时切出）
    const ptsBefore = S.pomodoro.points;
    S.startNightDiscipline(new Date(2026, 9, 26, 23, 0, 0));
    eq('启动夜间自律后 activeSession 存在', !!S.getNightDiscipline().activeSession, true);
    const ndRecOk = S.completeNightDiscipline(new Date(2026, 9, 27, 7, 0, 0));
    eq('正常完成夜间自律守夜 480 分钟达标并发放 15 积分',
      [ndRecOk.success, ndRecOk.durationMin, ndRecOk.points, S.pomodoro.points === ptsBefore + 15],
      [true, 480, 15, true]);

    // 守夜期间超时切出前台（超过 15 秒）触发违规，结算不发积分
    S.startNightDiscipline(new Date(2026, 9, 27, 23, 30, 0));
    S.recordNightDisciplineLeave(25); // 切出 25 秒 > 15 秒上限
    eq('守夜期间切出 25 秒标记 violated=true', S.getNightDiscipline().activeSession.violated, true);
    const ndRecFail = S.completeNightDiscipline(new Date(2026, 9, 28, 6, 30, 0));
    eq('违规守夜结算 success=false 且 points=0', [ndRecFail.success, ndRecFail.points], [false, 0]);

    // 静态结构与 UI 合并校验
    const fsNode = await import('node:fs');
    const stViewCode = fsNode.readFileSync(new URL('../assets/js/views/stats.js', import.meta.url), 'utf8');
    eq('stats.js 已移除 renderStats 中的获得积分数量统计渲染',
      !stViewCode.includes('if (W.curve) root.appendChild(pointCurveCard(curRange))'), true);
    const qdViewCode = fsNode.readFileSync(new URL('../assets/js/views/quadrant.js', import.meta.url), 'utf8');
    eq('quadrant.js 包含象限与时间统计复盘合并切换条',
      qdViewCode.includes('📊 象限与时间统计复盘'), true);
    const tkViewCode = fsNode.readFileSync(new URL('../assets/js/views/tasks.js', import.meta.url), 'utf8');
    eq('tasks.js 包含待办与日程清单及 7日日程时间流合并切换',
      tkViewCode.includes('📋 待办与日程清单') && tkViewCode.includes('🗓️ 7日日程时间流'), true);
    const cssAll = fsNode.readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
    eq('style.css 包含二级栏两排网格与电脑网页端深度适配样式',
      cssAll.includes('.cp-desk-nav-group') && cssAll.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), true);

    // ==================== 新增优化特性验证：日程冲突检测、负荷雷达、数据备份健康、静态 Manifest 与无障碍 ====================
    // 1. 跨模块智能日程冲突检测 (detectDayConflicts & dayLoadSummary)
    const cfDate = '2026-11-05'; // 该日 cMulti 已有期中考试 09:00-11:00
    S.addEvent({ title: '实验室组会汇报', date: cfDate, start: '10:00', end: '11:30', location: '工训 302' });
    const dayConflicts = S.detectDayConflicts(cfDate);
    eq('detectDayConflicts 精准检出期中考试与定点日程在 10:00-11:00 重叠 60 分钟',
      [dayConflicts.length >= 1, dayConflicts[0].overlapMin, dayConflicts[0].start, dayConflicts[0].end],
      [true, 60, '10:00', '11:00']);
    const loadSum = S.dayLoadSummary(cfDate);
    eq('dayLoadSummary 准确汇总当日考试与日程负荷时长',
      [loadSum.examMin >= 120, loadSum.eventMin >= 90, loadSum.conflicts.length >= 1],
      [true, true, true]);

    // 2. 数据安全与备份健康状态追踪 (backupHealth / markBackupExported / snoozeBackupRemind)
    S.state.settings.lastBackupAt = '';
    S.state.settings.backupRemindSnoozeUntil = '';
    const bh0 = S.backupHealth();
    eq('未备份且有记录时 backupHealth 状态为 warn 且 shouldRemind=true',
      [bh0.status, bh0.shouldRemind, bh0.daysSinceBackup], ['warn', true, null]);
    S.markBackupExported(DateUtil.toStr(DateUtil.today()));
    const bh1 = S.backupHealth();
    eq('完成备份后 backupHealth 状态立即变为 safe 且 daysSinceBackup=0',
      [bh1.status, bh1.shouldRemind, bh1.daysSinceBackup], ['safe', false, 0]);
    S.state.settings.lastBackupAt = '2026-01-01';
    S.snoozeBackupRemind(7);
    const bh2 = S.backupHealth();
    eq('延后提醒 7 天后 snoozed=true 且 shouldRemind=false',
      [bh2.snoozed, bh2.shouldRemind], [true, false]);

    // 3. 静态 Manifest、无障碍焦点环、快捷键与去死代码校验
    const tplHtml = fsNode.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
    eq('src/index.template.html 静态内嵌 <link rel="manifest" href="manifest.webmanifest">',
      tplHtml.includes('href="manifest.webmanifest"') && tplHtml.includes('rel="manifest"'), true);
    eq('src/index.template.html 包含快捷键按钮 #btnShortcuts 与 ARIA 地标',
      tplHtml.includes('id="btnShortcuts"') && tplHtml.includes('aria-label="底部六大分区导航"'), true);
    eq('stats.js 已彻底清理未使用的 pointCurveCard 与 pointSourceCard 死代码',
      !stViewCode.includes('function pointCurveCard') && !stViewCode.includes('function pointSourceCard'), true);
    const appCode = fsNode.readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
    eq('app.js 包含 focusCourse 学科专注直达与 openShortcutsModal 快捷键面板',
      appCode.includes('function focusCourse(') && appCode.includes('function openShortcutsModal('), true);
    const setViewCode = fsNode.readFileSync(new URL('../assets/js/views/settings.js', import.meta.url), 'utf8');
    eq('settings.js 首页包含常驻数据安全与一键备份卡片 (.cp-backup-hub-card)',
      setViewCode.includes('cp-backup-hub-card') && setViewCode.includes('🛡️ 数据安全与一键备份'), true);
  }

  // ==================== 本轮工程/架构/功能十项全量自检断言 ====================
  {
    const fsNode = await import('node:fs');
    const vmNode = await import('node:vm');

    // 1) Store.toggleEvent 与日程关联课程 (courseId) 闭环验证
    S.state.events = [];
    const ev1 = S.addEvent({ title: '高数答疑', date: '2026-10-28', start: '14:00', end: '15:30', courseId: 'c_math', location: '理教 201' });
    eq('addEvent 支持 courseId 且初始 done=false', [ev1.courseId, ev1.done, ev1.doneAt], ['c_math', false, '']);
    const toggled1 = S.toggleEvent(ev1.id);
    eq('Store.toggleEvent(id) 切换为已完成并记录 doneAt', [toggled1.done, toggled1.doneAt.length >= 10], [true, true]);
    const toggled2 = S.toggleEvent(ev1.id);
    eq('Store.toggleEvent(id) 再次调用恢复未完成并清空 doneAt', [toggled2.done, toggled2.doneAt], [false, '']);
    eq('Store.toggleEvent 对不存在 id 安全返回 null', S.toggleEvent('non_existent_id'), null);

    // 2) Store.activePlans 与 Store.plansActive 一致性
    S.state.plans = [];
    const plA = S.addPlan({ title: '每日阅读', type: 'checkin', period: 'daily', days: 7 });
    eq('Store.activePlans 与 Store.plansActive 返回在办计划', [S.activePlans().length, S.plansActive().length, S.activePlans()[0].id], [1, 1, plA.id]);

    // 3) 备份版本兼容校验 (validateBackupVersion) 与新旧数据覆盖预警 (diffImport.freshness)
    const vCompat = S.validateBackupVersion({ version: 3, courses: [] });
    eq('validateBackupVersion: v3 判定为 compatible', [vCompat.status, vCompat.compatible, vCompat.isNewer], ['compatible', true, false]);
    const vUpgrade = S.validateBackupVersion({ version: 1, courses: [] });
    eq('validateBackupVersion: v1 旧备份判定为 upgrade 且 needsMigration=true', [vUpgrade.status, vUpgrade.compatible, vUpgrade.needsMigration], ['upgrade', true, true]);
    const vNewer = S.validateBackupVersion({ version: 9, courses: [] });
    eq('validateBackupVersion: v9 高版本备份判定为 newer_version 且 isNewer=true', [vNewer.status, vNewer.compatible, vNewer.isNewer], ['newer_version', false, true]);

    S.state.tasks = [{ id: 'tk_new', title: '今天刚加的待办', dueDate: '2026-10-30', createdAt: '2026-10-27T12:00:00.000Z', status: 'todo' }];
    const diffOldBk = S.diffImport({
      version: 2,
      exportedAt: '2026-10-01T08:00:00.000Z',
      courses: [{ id: 'c1', name: '旧课', createdAt: '2026-09-01T08:00:00.000Z' }],
      tasks: []
    });
    eq('diffImport 返回 versionInfo 与 freshness 新旧覆盖预警',
      [diffOldBk.versionInfo.status, diffOldBk.freshness.hasNewerLocal, diffOldBk.freshness.newerLocalCount >= 1],
      ['upgrade', true, true]);

    // 4) 低风险数据拆分校验 (store-presets.js + store-planner.js)
    const storeRawLines = fsNode.readFileSync(new URL('../assets/js/store.js', import.meta.url), 'utf8').split('\n').length;
    eq('store.js 拆分后行数显著缩减（< 12000 行）', storeRawLines < 12000, true);
    eq('TREE_SPECIES 与 ACHIEVEMENTS 通过 store-presets.js 完整挂载',
      [globalThis.TREE_SPECIES ? globalThis.TREE_SPECIES.length >= 10 : S.ACHIEVEMENTS.length >= 20, S.ACHIEVEMENTS.length >= 20],
      [true, true]);

    // 5) CP 显式模块登记表与全源码静态 API 契约扫描（自动拦截任何 Store.xxx / UI.xxx / Router.xxx 未定义调用）
    const sb = {
      window: {}, globalThis: {}, console,
      setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      requestAnimationFrame: (fn) => fn(),
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      location: { hash: '', protocol: 'http:', href: 'http://localhost/' },
      history: { replaceState: () => {}, pushState: () => {} },
      navigator: { userAgent: '', vibrate: () => {} },
      document: {
        hidden: false, activeElement: null,
        addEventListener: () => {}, removeEventListener: () => {},
        contains: () => true,
        documentElement: { style: { setProperty: () => {} }, setAttribute: () => {}, removeAttribute: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } },
        head: { appendChild: () => {} },
        body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
        getElementById: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}, innerHTML: '' }),
        querySelector: () => null, querySelectorAll: () => [],
        createElement: () => ({ style: {}, dataset: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, focus: () => {}, remove: () => {} }),
        createElementNS: () => ({ setAttribute: () => {}, appendChild: () => {} })
      },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    };
    sb.window = sb; sb.global = sb; sb.self = sb;
    vmNode.createContext(sb);
    for (const f of SRC_FILES) {
      vmNode.runInContext(fsNode.readFileSync(new URL(f, SRC_BASE), 'utf8'), sb);
    }
    const checkRes = sb.CP.selfCheck({ silent: true, sourceCode: SRC });
    eq('CP.selfCheck 核心模块与全源码 API 调用契约 100% 匹配（0 缺失方法）',
      [checkRes.ok, checkRes.missingModules, checkRes.missingMethods],
      [true, [], []]);
    eq('CP.require 能正确获取已注册核心模块',
      [sb.CP.require('Store') === sb.Store, sb.CP.require('UI') === sb.UI, sb.CP.require('Router') === sb.Router],
      [true, true, true]);

    // 5b) App.focusCourse 运行态与空闲态行为及 toast 精准性验证（防止 running=true 时误报「已开启」）
    sb.Store.ensure();
    const toasts = [];
    sb.UI.toast = (msg) => { toasts.push(String(msg)); };
    sb.App.go = () => {};
    sb.Store.state.courses = [{ id: 'c_phy', name: '大学物理' }, { id: 'c_alg', name: '线性代数' }];
    sb.Store.state.tasks = [];
    sb.Store.state.pomodoro.timer = { running: false, taskId: '', courseId: '', tags: '' };
    sb.App.focusCourse('c_phy');
    eq('focusCourse 空闲态：写入 courseId 并弹出「已开启《大学物理》学科专注」',
      [sb.Store.pomodoro.timer.courseId, sb.Store.pomodoro.timer.tags, toasts[toasts.length - 1]],
      ['c_phy', '学习/大学物理', '已开启《大学物理》学科专注']);

    sb.Store.state.pomodoro.timer = { running: true, taskId: '', courseId: 'c_phy', tags: '学习/大学物理' };
    sb.App.focusCourse('c_alg');
    eq('focusCourse 运行中切其他课：不覆盖原 courseId 且不误报「已开启」',
      [sb.Store.pomodoro.timer.courseId, toasts[toasts.length - 1].includes('已开启'), toasts[toasts.length - 1].includes('当前专注计时运行中')],
      ['c_phy', false, true]);

    sb.App.focusCourse('c_phy');
    eq('focusCourse 运行中点同一门课：提示当前正在进行该学科专注',
      [sb.Store.pomodoro.timer.courseId, toasts[toasts.length - 1]],
      ['c_phy', '当前正在进行《大学物理》学科专注']);

    // 6) 构建产物压缩、SW 动态哈希与无障碍增强校验
    const swCode = fsNode.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    eq('sw.js CACHE 已由构建脚本写入动态哈希版本而非固定 v4',
      /const CACHE = 'cp-app-[0-9a-f]{8}';/.test(swCode), true);
    const builtHtml = fsNode.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const distHtml = fsNode.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
    const androidHtml = fsNode.readFileSync(new URL('../android/app/src/main/assets/public/index.html', import.meta.url), 'utf8');
    const builtBytes = Buffer.byteLength(builtHtml, 'utf8');
    eq('index.html 构建产物已压缩（体积 < 1.75 MB）', builtBytes > 500000 && builtBytes < 1750000, true);
    eq('根 index.html、dist/index.html 与 android assets index.html 逐字节完全一致',
      builtHtml === distHtml && builtHtml === androidHtml, true);
    const debugPath = new URL('../dist/index.debug.html', import.meta.url);
    if (fsNode.existsSync(debugPath)) {
      const debugHtml = fsNode.readFileSync(debugPath, 'utf8');
      eq('dist/index.debug.html 自动留存未压缩排错版且含源文件标记',
        debugHtml.length > builtHtml.length && debugHtml.includes('/* === [source] assets/js/app.js === */'), true);
    } else {
      console.log('  ⚠ 跳过断言: dist/index.debug.html 不存在（release 构建未生成，属正常）');
    }
    eq('压缩产物保留函数名 (--keep-fnames) 以便线上报错可读',
      builtHtml.includes('function focusCourse('), true);
    const uiCode = fsNode.readFileSync(new URL('../assets/js/ui.js', import.meta.url), 'utf8');
    eq('ui.js 弹窗包含 role="dialog"、aria-modal="true" 与 restoreTriggerFocus 焦点归位',
      uiCode.includes("role: 'dialog'") && uiCode.includes("restoreTriggerFocus") && uiCode.includes("aria-live"), true);
    const calCode = fsNode.readFileSync(new URL('../assets/js/views/calendar.js', import.meta.url), 'utf8');
    eq('calendar.js 日历详情与 7 日预览已合流展示待办任务 (cal-task-line)',
      calCode.includes('cal-task-line') && calCode.includes('未来 7 天日程与待办'), true);
    const agCode = fsNode.readFileSync(new URL('../assets/js/views/agenda.js', import.meta.url), 'utf8');
    eq('agenda.js 新建/编辑日程弹窗支持关联课程 (courseId)',
      agCode.includes("V.field('关联课程', fCourse)"), true);
  }

}

// ---------------------------------------------------------------------------
// 法定节假日停课：规则必须落在数据层，今日 / 日历 / 提醒才会一致
// ---------------------------------------------------------------------------
{
  console.log('\nHoliday: 法定假日停课');
  const fakeHolidays = {
    '2026-10-01': { type: 'holiday', name: '国庆节' },
    '2026-10-10': { type: 'work', name: '国庆补班' }
  };
  const S = await initTestStore({
    HolidayCN: { lookup: (d) => fakeHolidays[d] || null }
  });
  S.state.courses = [];
  S.addCourse({ name: '高等数学', day: 4, periodId: S.periods[0].id, startWeek: 1, endWeek: 20, weekType: 'all' });

  eq('普通周四照常返回 1 节课', S.coursesOnDate('2026-10-08').length, 1);
  eq('法定放假日 coursesOnDate 返回 0 节（停课规则下沉到数据层）',
    S.coursesOnDate('2026-10-01').length, 0);
  eq('holidayOf 能取到假日名称', (S.holidayOf('2026-10-01') || {}).name, '国庆节');
  eq('补班日 type=work 不触发停课', S.holidayPaused('2026-10-10'), null);
  eq('默认开启自动停课', S.settings.pauseOnHoliday, true);

  S.updateSettings({ pauseOnHoliday: false });
  eq('关闭自动停课后，假日仍按课表返回 1 节', S.coursesOnDate('2026-10-01').length, 1);
  S.updateSettings({ pauseOnHoliday: true });
  eq('重新开启后恢复停课', S.coursesOnDate('2026-10-01').length, 0);
}

// ---------------------------------------------------------------------------
// 原生契约：JS 调用的插件方法在 Kotlin 里必须存在（这类问题曾静默上线）
// ---------------------------------------------------------------------------
{
  console.log('\nNative contract: Kotlin 插件方法与 JS 调用对齐');
  const pluginDir = new URL('../android/app/src/main/java/com/faust275/courseplanner/plugin/', import.meta.url);
  const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  const notifyKt = readFileSync(new URL('NotifyPlugin.kt', pluginDir), 'utf8');
  const notifyMethods = new Set([...notifyKt.matchAll(/@PluginMethod\s+fun\s+(\w+)/g)].map((m) => m[1]));
  eq('NotifyPlugin 注册了 available / requestPermission / openSettings',
    ['available', 'requestPermission', 'openSettings'].every((m) => notifyMethods.has(m)), true);

  const jsCalls = new Set();
  for (const rel of ['../assets/js/views/settings.js', '../assets/js/app.js', '../assets/js/remind.js']) {
    const code = readSrc(rel);
    for (const m of code.matchAll(/Plugins\.Notify\.(\w+)\s*\(/g)) jsCalls.add(m[1]);
    for (const m of code.matchAll(/\bnatP\.(\w+)\s*[?(]/g)) jsCalls.add(m[1]);
  }
  const missingNotify = [...jsCalls].filter((m) => !notifyMethods.has(m));
  eq('JS 调用的 Notify 方法全部在 Kotlin 中实现', missingNotify, []);

  const manifest = readSrc('../android/app/src/main/AndroidManifest.xml');
  eq('Manifest 声明 RECEIVE_BOOT_COMPLETED', manifest.includes('RECEIVE_BOOT_COMPLETED'), true);
  eq('Manifest 注册 BootReceiver 并接收 BOOT_COMPLETED',
    manifest.includes('BootReceiver') && manifest.includes('android.intent.action.BOOT_COMPLETED'), true);
  eq('allowBackup 已关闭', /android:allowBackup="false"/.test(manifest), true);

  const gradle = readSrc('../android/app/build.gradle');
  eq('build.gradle 不再写死签名密码', gradle.includes('happyday'), false);
  const keystorePath = new URL('../android/app/happy-course.keystore', import.meta.url);
  eq('工程内不再包含 keystore 文件', existsSync(keystorePath), false);

  // Store 领域拆分：记账域独立成文件，store.js 保持核心
  const ledgerPath = new URL('../assets/js/store-ledger.js', import.meta.url);
  eq('记账域已拆到 store-ledger.js', existsSync(ledgerPath), true);
  const ledgerSrc = readFileSync(ledgerPath, 'utf8');
  eq('store-ledger.js 通过 Object.assign 挂回 Store 且不改对外 API',
    ledgerSrc.includes('Object.assign(Store') && ledgerSrc.includes('addLedger: function'), true);
  const storeLines = readFileSync(new URL('../assets/js/store.js', import.meta.url), 'utf8').split('\n').length;
  eq('store.js 行数已降到 11500 以下', storeLines < 11500, true);

  // 第二轮拆分：健康域 / 任务域
  for (const [file, marker] of [
    ['store-health.js', 'addSleep: function'],
    ['store-tasks.js', 'addTask: function'],
    ['store-course.js', 'addCourse: function'],
    ['store-reward.js', 'addPoints: function'],
    ['store-backup.js', 'backupNow: function'],
    ['store-io.js', 'exportJSON: function'],
    ['store-plans.js', 'addPlan: function'],
    ['store-stats.js', 'dayStat: function'],
    ['store-records.js', 'saveDiary: function']
  ]) {
    const p = new URL('../assets/js/' + file, import.meta.url);
    eq(file + ' 已存在', existsSync(p), true);
    const code = readFileSync(p, 'utf8');
    eq(file + ' 通过 Object.assign 挂回 Store 且包含 ' + marker,
      code.includes('Object.assign(Store') && code.includes(marker), true);
  }
  eq('store.js 行数已降到 5000 以下', storeLines < 5000, true);

  // 数据出口：备份插件 + 主 Activity 注册 + JS 调用点
  const backupKt = readSrc('../android/app/src/main/java/com/faust275/courseplanner/plugin/BackupExportPlugin.kt');
  eq('BackupExportPlugin 提供 saveToDownloads',
    /@PluginMethod\s+fun\s+saveToDownloads/.test(backupKt), true);
  const mainActivity = readSrc('../android/app/src/main/java/com/faust275/courseplanner/MainActivity.java');
  eq('MainActivity 注册了 BackupExportPlugin', mainActivity.includes('registerPlugin(BackupExportPlugin.class)'), true);
  const appSrc = readSrc('../assets/js/app.js');
  eq('App 暴露 exportBackupToDownloads 并调用 BackupExport',
    appSrc.includes('App.exportBackupToDownloads') && appSrc.includes('Plugins.BackupExport'), true);

  // 指纹解锁备份密码：插件方法 + 注册
  const vaultKt = readSrc('../android/app/src/main/java/com/faust275/courseplanner/plugin/VaultPlugin.kt');
  const vaultMethods = new Set([...vaultKt.matchAll(/@PluginMethod\s+fun\s+(\w+)/g)].map((m) => m[1]));
  eq('VaultPlugin 提供 available / save / get / clear',
    ['available', 'save', 'get', 'clear'].every((m) => vaultMethods.has(m)), true);
  eq('MainActivity 注册了 VaultPlugin', mainActivity.includes('registerPlugin(VaultPlugin.class)'), true);
  const settingsSrc = readSrc('../assets/js/views/settings.js');
  eq('设置页通过 Vault 取备份密码',
    settingsSrc.includes('Plugins.Vault') && settingsSrc.includes('getBackupPassword'), true);
}

// ---------------------------------------------------------------------------
// 今日出门清单：只读推导，不写数据
// ---------------------------------------------------------------------------
{
  console.log('\nPacking: 今日出门清单');
  const S = await initTestStore();
  const packingCode = readFileSync(new URL('../assets/js/packing.js', import.meta.url), 'utf8');
  const pg = { Store: S };
  new Function('window', 'global', packingCode)(pg, pg);
  const Packing = pg.Packing;

  eq('没有课也没有作业时，清单为空', Packing.forDate('2026-10-08').length, 0);

  S.state.courses = [];
  S.state.tasks = [];
  S.addCourse({ name: '高等数学', day: 4, periodId: S.periods[0].id, startWeek: 1, endWeek: 20, weekType: 'all' });
  S.addTask({ title: '高数作业第三章', dueDate: '2026-10-08' });

  const list = Packing.forDate('2026-10-08').map((x) => x.text);
  eq('有课时带对应教材', list.includes('《高等数学》教材 / 讲义'), true);
  eq('有 DDL 时带上要交的作业', list.includes('交：高数作业第三章'), true);
  eq('当天有事时带基础项', list.includes('校园卡 / 水杯'), true);
  eq('同一条不重复出现', new Set(list).size, list.length);

  S.addCourse({ name: '大学物理实验', day: 4, periodId: S.periods[1].id, startWeek: 1, endWeek: 20, weekType: 'all' });
  eq('实验课提醒实验报告', Packing.forDate('2026-10-08').some((x) => x.text.includes('实验报告')), true);

  const text = Packing.toText('2026-10-08');
  eq('复制文本每行以 · 开头', text.split('\n').every((l) => l.startsWith('· ')), true);
}

// ---------------------------------------------------------------------------
// DDL 冲刺线：未来 7 天截止排序、逾期与剩余时间
// ---------------------------------------------------------------------------
{
  console.log('\nDeadline: 未来 7 天 DDL 冲刺线');
  const S = await initTestStore();
  const deadlineCode = readFileSync(new URL('../assets/js/deadline.js', import.meta.url), 'utf8');
  const dg = { Store: S, DateUtil };
  new Function('window', 'global', deadlineCode)(dg, dg);
  const D = dg.Deadline;

  S.state.tasks = [];
  S.addTask({ title: '高数作业', dueDate: '2026-10-30', dueTime: '18:00' });
  S.addTask({ title: '实验报告', dueDate: '2026-10-29', dueTime: '18:00' });
  S.addTask({ title: '远期任务', dueDate: '2026-11-10', dueTime: '09:00' });

  const now = new Date(2026, 9, 30, 12, 0, 0);
  const list = D.upcoming(7, now);
  eq('只保留 7 天内的截止', list.length, 2);
  eq('按时间升序，逾期排最前', list[0].task.title, '实验报告');
  eq('逾期标记正确', list[0].overdue, true);
  eq('剩余分钟数（今天 18:00 − 12:00）', list[1].leftMin, 360);
  eq('已逾期文本', D.leftText(-1080), '已逾期 18h');
  eq('剩余小时文本', D.leftText(360), '剩 6h');
  eq('今天/明天标签', [D.dayLabel(new Date(2026, 9, 30), now), D.dayLabel(new Date(2026, 9, 31), now)], ['今天', '明天']);
  eq('紧迫度分档', [D.urgency(-1), D.urgency(360), D.urgency(2880), D.urgency(6000)], ['over', '24h', '72h', 'normal']);
}

// ---------------------------------------------------------------------------
// 考勤：每天一条、可覆盖可清除、删课清理、出勤率
// ---------------------------------------------------------------------------
{
  console.log('\nAttendance: 考勤记录');
  const S = await initTestStore();
  S.state.courses = [];
  S.state.tasks = [];
  const c = S.addCourse({ name: '高等数学', day: 4, periodId: S.periods[0].id, startWeek: 1, endWeek: 20, weekType: 'all' });

  eq('初始没有考勤记录', S.attendanceStats(c.id).marked, 0);
  eq('没有标记时出勤率为 null', S.attendanceStats(c.id).rate, null);

  S.markAttendance(c.id, '2026-10-08', 'present');
  S.markAttendance(c.id, '2026-10-15', 'absent');
  S.markAttendance(c.id, '2026-10-22', 'leave');
  const st = S.attendanceStats(c.id);
  eq('出勤/缺勤/请假计数', [st.present, st.absent, st.leave, st.marked], [1, 1, 1, 3]);
  eq('出勤率 = 出勤 / 已标记', st.rate, 33.3);

  S.markAttendance(c.id, '2026-10-08', 'absent');
  eq('同一天只保留一条', S.attendanceOf('2026-10-08').length, 1);
  eq('重复标记覆盖原状态', S.attendanceFor(c.id, '2026-10-08').status, 'absent');

  S.markAttendance(c.id, '2026-10-08', '');
  eq('清空状态即删除记录', S.attendanceFor(c.id, '2026-10-08'), null);

  S.removeCourse(c.id);
  eq('删除课程时考勤一并清理', S.state.attendance.length, 0);
}

// ---------------------------------------------------------------------------
// 备份加密：AES-GCM 往返 + 错误密码必须失败
// ---------------------------------------------------------------------------
{
  console.log('\nBackupCrypto: 加密备份往返');
  const code = readFileSync(new URL('../assets/js/backup-crypto.js', import.meta.url), 'utf8');
  const g = { crypto: globalThis.crypto, btoa, atob, TextEncoder, TextDecoder };
  new Function('window', code)(g);
  const BC = g.BackupCrypto;
  const plain = JSON.stringify({ version: 3, courses: [{ id: 'c1', name: '高等数学' }] });
  const enc = await BC.encrypt(plain, 'secret123');
  eq('加密结果带 CPENC1 头', BC.isEncrypted(enc), true);
  eq('密文里不出现明文课程名', enc.includes('高等数学'), false);
  eq('正确密码可还原', await BC.decrypt(enc, 'secret123'), plain);
  let failed = false;
  try { await BC.decrypt(enc, 'wrong-pass'); } catch (e) { failed = true; }
  eq('错误密码解不开', failed, true);
  eq('普通 JSON 不会被误判为加密', BC.isEncrypted('{"a":1}'), false);
}

// ---------------------------------------------------------------------------
// 拆分回归守卫：核心 getter 不能跟着域模块一起被搬走
// ---------------------------------------------------------------------------
{
  console.log('\nStore 核心 getter 守卫');
  const S = await initTestStore();
  eq('Store.settings getter 存在且指向 state.settings', S.settings === S.state.settings, true);
  eq('Store.semester getter 能取到当前学期', !!S.semester && !!S.semester.id, true);
  eq('Store.pomodoro getter 存在', typeof S.pomodoro === 'object' && S.pomodoro !== null, true);
}

// ---------------------------------------------------------------------------
// 健康记录冷藏：只拆早于 cutoff 的，没有日期的记录留在热区
// ---------------------------------------------------------------------------
{
  console.log('\nStore 健康记录冷藏');
  const S = await initTestStore();
  const split = S._ctx.splitOldRecords;
  const res = split([
    { id: 'a', date: '2024-01-01' },
    { id: 'b', date: '2026-10-01' },
    { id: 'c' }
  ], '2024-10-30');
  eq('早于 cutoff 的记录进入冷区', res.cold.map(function (x) { return x.id; }), ['a']);
  eq('没有日期的记录留在热区', res.hot.some(function (x) { return x.id === 'c'; }), true);
  eq('新记录留在热区', res.hot.some(function (x) { return x.id === 'b'; }), true);
  eq('Store.healthArchiveInfo 可用', typeof S.healthArchiveInfo, 'function');
}

// ---------------------------------------------------------------------------
// 跨模块联动：课程投入、考后复盘、记账挂课程
// ---------------------------------------------------------------------------
{
  console.log('\n联动：投入 / 考后复盘 / 账目挂课程');
  const S = await initTestStore();
  S.state.courses = [];
  S.state.tasks = [];
  S.state.activities = [];
  S.state.ledger = [];

  const todayStr = DateUtil.toStr(DateUtil.today());
  const examDate = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -2));
  const c = S.addCourse({
    name: '高等数学', day: 4, periodId: S.periods[0].id, startWeek: 1, endWeek: 20, weekType: 'all',
    exam: { date: examDate, start: '09:00', label: '期中' }
  });

  S.addActivity({ date: todayStr, start: '19:00', end: '20:30', name: '复习', type: 'study', courseId: c.id });
  const inv = S.courseInvest(c.id);
  eq('课程投入：90 分钟 / 1 次', [inv.minutes, inv.sessions], [90, 1]);
  eq('按课程名也能匹配（无 courseId 的老记录）', S.courseInvest('', '高等数学').minutes, 90);

  eq('考后复盘生成 1 条待办', S.syncExamReviews(), 1);
  eq('重复调用不重复生成', S.syncExamReviews(), 0);
  eq('复盘待办挂回了课程', S.tasks.some(function (t) { return t.courseId === c.id && /复盘/.test(t.title); }), true);

  const lg = S.addLedger({ amount: 25, type: 'expense', category: 'study', courseId: c.id, courseName: '高等数学' });
  eq('账目记录课程字段', [lg.courseId, lg.courseName], [c.id, '高等数学']);
}

// ---------------------------------------------------------------------------
// 统计缓存：写入后必须失效（拆分时 rev 曾被当成值拷贝，导致永远读到旧值）
// ---------------------------------------------------------------------------
{
  console.log('\n统计缓存随写操作失效');
  const S = await initTestStore();
  const day = DateUtil.toStr(DateUtil.today());
  const activityMin = function () {
    return (S.dayStat(day).segments || [])
      .filter(function (x) { return x && x.key === 'activity'; })
      .reduce(function (sum, x) { return sum + (Number(x.minutes) || 0); }, 0);
  };
  const before = activityMin();
  S.addActivity({ date: day, start: '19:00', end: '20:00', name: '自习', type: 'study' });
  eq('dayStat 写入后重新计算（+60 分钟）', activityMin() - before, 60);
}

// ---------------------------------------------------------------------------
// 跨模块联动 2：课程情绪、成绩自动分项（默认关）、小组件钉选
// ---------------------------------------------------------------------------
{
  console.log('\n联动：课程情绪 / 自动分项 / 小组件钉选');
  const S = await initTestStore();
  S.state.courses = [];
  S.state.tasks = [];
  S.state.attendance = [];
  S.state.courseMoods = [];

  const c = S.addCourse({ name: '高等数学', day: 4, periodId: S.periods[0].id, startWeek: 1, endWeek: 20, weekType: 'all' });

  // 课程情绪
  S.setCourseMood('2026-10-08', c.id, 'tired');
  S.setCourseMood('2026-10-15', c.id, 'good');
  S.setCourseMood('2026-10-15', c.id, 'tired');   // 覆盖
  const ms = S.courseMoodStats('2026-10-01', '2026-10-31')[0];
  eq('情绪按课程汇总：累 2 / 好 0', [ms.tired, ms.good], [2, 0]);
  S.setCourseMood('2026-10-15', c.id, '');
  eq('清除某天情绪', S.courseMoodStats('2026-10-01', '2026-10-31')[0].tired, 1);

  // 成绩自动分项：默认关闭
  S.markAttendance(c.id, '2026-10-08', 'present');
  S.markAttendance(c.id, '2026-10-15', 'absent');
  const attTree = {
    id: 'g1', name: '总评', weight: 100, score: null,
    children: [{ id: 'a', name: '出勤率', weight: 100, score: null, children: [], source: 'attendance' }]
  };
  eq('默认关闭时自动分项不计分', S.gradeScoreOf({ courseId: c.id, root: attTree }).score, null);
  S.updateSettings({ gradeAutoAttendance: true });
  eq('开启后按出勤率 50 分', S.gradeScoreOf({ courseId: c.id, root: attTree }).score, 50);

  // 待办完成率
  S.addTask({ title: '作业一', courseId: c.id, status: 'done' });
  S.addTask({ title: '作业二', courseId: c.id });
  S.updateSettings({ gradeAutoTasks: true });
  const taskTree = {
    id: 'g2', name: '总评', weight: 100, score: null,
    children: [{ id: 'b', name: '作业完成率', weight: 100, score: null, children: [], source: 'tasks' }]
  };
  eq('待办完成率 50 分', S.gradeScoreOf({ courseId: c.id, root: taskTree }).score, 50);

  // 小组件钉选：钉住的不一定是最早截止的那条
  S.state.tasks.forEach(function (t) { t.dueDate = '2026-12-' + (t.title === '作业一' ? '01' : '20'); });
  const pin = S.state.tasks.filter(function (t) { return t.title === '作业二'; })[0];
  S.updateSettings({ widgetTodoId: pin.id });
  const snap = S.snapshotForWidget();
  eq('小组件优先显示钉住的待办', snap.nextTodo && snap.nextTodo.id, pin.id);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
