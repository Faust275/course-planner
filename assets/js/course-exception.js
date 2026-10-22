

/* ==========================================================
 * 单次调课例外（纯函数模块）
 * ----------------------------------------------------------
 * 课程表是按周次严格重复的周历，但大学里最常见的现实是：
 * 「国庆把周二的课调到周六上」「第 8 周老师开会停课一次」
 * 「实验课临时改去三教 402」。
 * 本模块负责这些「只影响某一天」的例外判定，不碰学期规则：
 *   - cancel：本次停课（当天不再出现这节课）
 *   - room  ：临时换教室（只覆盖该日期实例的地点）
 *   - move  ：调课补课（原日期移除，目标日期生成一条关联原课程的单次课）
 *
 * 刻意不依赖 Store / DateUtil：输入就是「基础课表实例 + 例外列表 + 日期」，
 * 输出是纯数据。tests/run.mjs 直接 import 本文件测试，无需构建产物。
 * 数据形状（Store 落库时保证）：
 *   { id, courseId, date('YYYY-MM-DD'), type,
 *     location?          // room：新教室
 *     toDate?            // move：调到哪天
 *     toPeriodId?        // move：调到哪节课（与 toStart 二选一，都空 = 时间不变）
 *     toStart?, toEnd? } // move：自定义时间段
 * ========================================================== */
(function (global) {
  'use strict';

  var TYPES = { cancel: '停课', room: '换教室', move: '调课' };

  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  /** 清洗：剔除缺字段的脏数据（导入旧备份 / 手改数据时的兜底） */
  function normalize(list) {
    return (list || []).filter(function (e) {
      return e && e.courseId && isDate(e.date) && TYPES[e.type];
    });
  }

  /** 某课某天的例外（同一门课同一天最多一条，Store 侧写入时保证） */
  function find(list, courseId, dateStr) {
    var l = normalize(list);
    for (var i = 0; i < l.length; i++) {
      if (l[i].courseId === courseId && l[i].date === dateStr) return l[i];
    }
    return null;
  }

  /**
   * 某天的实际课表 = 基础课表 + 例外。
   * @param base   当天按周历算出的课程实例（expandCourse 产物，带 courseId）
   * @returns { kept, removed }
   *   kept    生效的课程；换教室的返回副本并带 _exRoom（新教室）
   *   removed 被停/被调走的课程；带 _off('cancel'|'move')，move 另带 _moveTo
   */
  function dayEffect(base, dateStr, list) {
    var l = normalize(list);
    var kept = [], removed = [];
    (base || []).forEach(function (c) {
      var ex = find(l, c.courseId, dateStr);
      if (ex && (ex.type === 'cancel' || ex.type === 'move')) {
        var off = {};
        Object.keys(c).forEach(function (k) { off[k] = c[k]; });
        off._off = ex.type;
        off._exId = ex.id;
        if (ex.type === 'move') off._moveTo = ex.toDate || '';
        removed.push(off);
      } else if (ex && ex.type === 'room' && ex.location) {
        var cp = {};
        Object.keys(c).forEach(function (k) { cp[k] = c[k]; });
        cp.location = ex.location;
        cp._exRoom = ex.location;
        cp._exId = ex.id;
        kept.push(cp);
      } else {
        kept.push(c);
      }
    });
    return { kept: kept, removed: removed };
  }

  /** 调进某天的例外（Store 据此在目标日期生成关联原课程的单次课） */
  function moveIns(list, dateStr) {
    return normalize(list).filter(function (e) {
      return e.type === 'move' && e.toDate === dateStr;
    });
  }

  /**
   * 一门课的全部例外，按导出 .ics 的需要分组：
   *   excludes 原日期被移除（cancel / move / room 都要 EXDATE——
   *            room 换的教室靠单独 VEVENT 才能带上新地点）
   *   rooms    换教室（生成单独 VEVENT）
   *   moves    调课（在 toDate 生成单独 VEVENT）
   */
  function forCourse(list, courseId) {
    var l = normalize(list).filter(function (e) { return e.courseId === courseId; });
    return {
      excludes: l.map(function (e) { return e.date; })
                 .filter(function (d, i, arr) { return arr.indexOf(d) === i; }),
      rooms: l.filter(function (e) { return e.type === 'room' && e.location; }),
      moves: l.filter(function (e) { return e.type === 'move' && isDate(e.toDate || '') })
    };
  }

  global.CourseException = {
    TYPES: TYPES,
    normalize: normalize,
    find: find,
    dayEffect: dayEffect,
    moveIns: moveIns,
    forCourse: forCourse
  };
})(typeof window !== 'undefined' ? window : globalThis);
