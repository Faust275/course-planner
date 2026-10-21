/* ==========================================================
 * 统计计算：积分流水的纯聚合（数据拆分自 store.js）
 * 无状态、无 DOM，接收流水数组即可，便于单测与复用。
 * 依赖：无（仅纯函数）
 * ========================================================== */
(function (global) {
  'use strict';

  /** 两个 HH:MM 之间的分钟数（跨午夜按 +24h） */
  function diffMin(start, end) {
    var s = String(start || '00:00').split(':');
    var e = String(end || '00:00').split(':');
    var sm = (+s[0] || 0) * 60 + (+s[1] || 0);
    var em = (+e[0] || 0) * 60 + (+e[1] || 0);
    if (em < sm) em += 1440;
    return Math.max(0, em - sm);
  }

  var StatsCalc = {
    /**
     * 按来源汇总积分流水
     * @param {Array} log [{date, n, src}]
     * @returns {Object} { focus: 120, task: 40, ... }
     */
    sumBySource: function (log) {
      var map = {};
      (log || []).forEach(function (l) {
        if (!l) return;
        map[l.src] = (map[l.src] || 0) + (Number(l.n) || 0);
      });
      return map;
    },

    /**
     * 按给定日期序列聚合每日积分（区间外的流水自然不在 dates 里）
     * @param {Array} log  [{date, n, src}]
     * @param {Array} dates ['2024-01-01', ...] 连续日期
     * @returns {Array} [{date, n}]
     */
    seriesFromLog: function (log, dates) {
      var byDay = {};
      (log || []).forEach(function (l) {
        if (!l) return;
        byDay[l.date] = (byDay[l.date] || 0) + (Number(l.n) || 0);
      });
      return (dates || []).map(function (d) {
        return { date: d, n: byDay[d] || 0 };
      });
    },

    /**
     * 账本聚合：按分类构成 + 每日支出（仅统计 type=expense）
     * @param {Array} entries 账本流水 [{type, amount, category, date}]
     * @param {Array} dates   连续日期（区间内）
     * @param {string} type   'expense' | 'income'
     * @returns {{ byCategory:Object, total:number, daily:Object }}
     */
    ledgerBreakdown: function (entries, dates, type) {
      type = type || 'expense';
      var inRange = null;
      if (dates && dates.length) {
        inRange = {};
        dates.forEach(function (d) { inRange[d] = true; });
      }
      var byCategory = {}, daily = {}, total = 0;
      (entries || []).forEach(function (e) {
        if (!e || e.type !== type) return;
        if (inRange && !inRange[e.date]) return;
        var amt = Number(e.amount) || 0;
        byCategory[e.category] = (byCategory[e.category] || 0) + amt;
        daily[e.date] = (daily[e.date] || 0) + amt;
        total += amt;
      });
      return {
        byCategory: byCategory,
        total: Math.round(total * 100) / 100,
        daily: daily
      };
    },

    /**
     * 按课程聚合投入时长（只算已发生、挂了课程的记录）
     * @param {Array} activities [{date, start, end, courseName, courseId, planned}]
     * @param {Array} dates 连续日期（区间内）
     * @returns {Object} { 课程名: 分钟数 }
     */
    sumByCourse: function (activities, dates) {
      var inRange = null;
      if (dates && dates.length) {
        inRange = {};
        dates.forEach(function (d) { inRange[d] = true; });
      }
      var map = {};
      (activities || []).forEach(function (a) {
        if (!a || a.planned) return;
        if (inRange && !inRange[a.date]) return;
        var key = a.courseName || a.courseId || '';
        if (!key) return;
        map[key] = (map[key] || 0) + diffMin(a.start, a.end);
      });
      return map;
    }
  };

  global.StatsCalc = StatsCalc;
})(typeof window !== 'undefined' ? window : this);
