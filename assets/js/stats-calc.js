/* ==========================================================
 * 统计与区间计算：无状态、无 DOM 的纯函数（数据拆分自 store.js）
 * 依赖注入：日期 / 时间工具通过参数传入，缺省回退全局 DateUtil / TimeUtil，
 * 这样单测可以只喂字符串与日期，不需要整份 Store。
 * 交易与时间聚合（seriesFromLog / ledgerBreakdown / sumByCourse）
 * 与时间口径（expandRange / rangeDates / dayStat 汇总）都在这里。
 * ========================================================== */
(function (global) {
  'use strict';

  function D(u) { return u || (typeof DateUtil !== 'undefined' ? DateUtil : null); }
  function T(u) { return u || (typeof TimeUtil !== 'undefined' ? TimeUtil : null); }

  /** 两个 HH:MM 之间的分钟数（跨午夜按 +24h） */
  function diffMin(start, end) {
    var s = String(start || '00:00').split(':');
    var e = String(end || '00:00').split(':');
    var sm = (+s[0] || 0) * 60 + (+s[1] || 0);
    var em = (+e[0] || 0) * 60 + (+e[1] || 0);
    if (em < sm) em += 1440;
    return Math.max(0, em - sm);
  }

  /** 把 (start, end) 拆成 0–1440 内的区间，跨午夜拆为两段 */
  function expandRange(start, end, tu) {
    var t = T(tu);
    var a = t.toMin(start), b = t.toMin(end);
    if (b <= a) return [[a, 1440], [0, b]];
    return [[a, b]];
  }

  /** 合并重叠区间后返回总分钟数（避免重复计时） */
  function mergeTotal(ranges) {
    if (!ranges || !ranges.length) return 0;
    var arr = ranges.slice().sort(function (x, y) { return x[0] - y[0]; });
    var total = 0, cs = arr[0][0], ce = arr[0][1];
    for (var i = 1; i < arr.length; i++) {
      if (arr[i][0] > ce) { total += ce - cs; cs = arr[i][0]; ce = arr[i][1]; }
      else if (arr[i][1] > ce) ce = arr[i][1];
    }
    total += ce - cs;
    return Math.max(0, total);
  }

  /**
   * 某一天「实际睡了多少分钟」。
   * 睡眠记录挂在入睡那天（date），所以一天真正睡着的时间由两段拼成：
   *   1. 昨晚（date-1）睡下、跨过午夜、今天早上醒来 —— 取 [00:00, end]
   *   2. 今晚（date）睡下、可能跨到明天 —— 取 [start, 24:00]
   * 这样「1/1 睡 23:00–7:00」不会在 1/1 记 8 小时、1/2 记 0 小时，
   * 而是 1/1 记 1 小时、1/2 记 7 小时，日内分布才和现实一致。
   * 同一夜的多段记录先合并，避免两段重叠被重复计时。
   */
  function sleepByNight(sleeps, dateStr, du, tu) {
    var d = D(du), t = T(tu);
    var day = d.parse(dateStr);
    if (!day) return 0;
    var prev = d.toStr(d.addDays(day, -1));
    var ranges = [];
    var hasPrevOvernight = (sleeps || []).some(function (r) {
      if (!r || !r.start || !r.end || r.date !== prev) return false;
      var isWakeIdx = r.source === 'hc' || r.source === 'csv' || r.source === 'shot';
      return !isWakeIdx && t.toMin(r.end) <= t.toMin(r.start);
    });
    (sleeps || []).forEach(function (r) {
      if (!r || !r.start || !r.end) return;
      var a = t.toMin(r.start), b = t.toMin(r.end);
      var overnight = b <= a;
      var isWakeIdx = r.source === 'hc' || r.source === 'csv' || r.source === 'shot';
      if (r.date === dateStr) {
        if (overnight && isWakeIdx) {
          ranges.push([a, 1440]);
          if (!hasPrevOvernight) ranges.push([0, b]);
        } else {
          // 今晚这一段：只取今天之内能落下的部分
          ranges.push([a, overnight ? 1440 : b]);
        }
      } else if (r.date === prev && overnight && !isWakeIdx) {
        // 昨晚跨过来：只取今天早上那半截
        ranges.push([0, b]);
      }
    });
    return mergeTotal(ranges);
  }

  /** 自然周起止（周一为一周之始） */
  function weekBounds(d, du) {
    var u = D(du);
    d = d || u.today();
    var s = u.weekStart(d);
    return { from: s, to: u.addDays(s, 6) };
  }

  /** 自然月起止 */
  function monthBounds(d, du) {
    var u = D(du);
    d = d || u.today();
    var s = new Date(d.getFullYear(), d.getMonth(), 1);
    var e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: s, to: e };
  }

  /**
   * 日期区间（含两端）。
   * 「今天 / 本周 / 本月」的 to 一律截到今天——统计不该把未来的空白天算进分母。
   * @param {string} key RANGES 的 key
   * @param {Object} opts { today, semester, ranges, util }
   */
  function rangeDates(key, opts) {
    opts = opts || {};
    var u = D(opts.util);
    var ranges = opts.ranges || {};
    var R = ranges[key] || ranges.week || { key: 'week', mode: 'cal', days: 7 };
    var today = opts.today || u.today();

    if (R.mode === 'win') {
      var wf = u.addDays(today, -(R.days - 1));
      return { from: u.toStr(wf), to: u.toStr(today), days: R.days, key: R.key, mode: 'win' };
    }

    var from = today, to = today;
    if (R.key === 'day') {
      from = today; to = today;
    } else if (R.key === 'week') {
      var wb = weekBounds(today, u);
      from = wb.from; to = to < wb.to ? today : wb.to;
    } else if (R.key === 'month') {
      var mb = monthBounds(today, u);
      from = mb.from; to = today < mb.to ? today : mb.to;
    } else if (R.key === 'year') {
      // 自然年：1 月 1 日 → 今天。年初那几天区间很短，调用方按 days 显示
      from = new Date(today.getFullYear(), 0, 1);
      to = today;
    } else if (R.key === 'term') {
      var s = opts.semester;
      var start = (s && u.parse(s.startDate)) || u.weekStart(today);
      var weeks = (s && s.weeks) || 20;
      var end = u.addDays(start, weeks * 7 - 1);
      from = start;
      // 学期还没开学：空区间，由调用方显示提示
      if (today < start) { from = today; to = today; }
      else to = today < end ? today : end;
    }
    var n = u.diffDays(to, from) + 1;
    return { from: u.toStr(from), to: u.toStr(to), days: Math.max(1, n), key: R.key, mode: 'cal' };
  }

  /**
   * 参照区间：拿同样的口径往前挪一个周期，用来做「比上次」。
   * 今天 → 昨天；本周 → 上周；本月 → 上月；本学期 → 无（返回 null）；
   * 滑动窗口 → 等长的上一段，保证天数一致，可以直接比总量。
   * 自然口径的上月天数可能与本月不同，比较时请统一换成日均。
   */
  function compareRange(key, r, opts) {
    opts = opts || {};
    var u = D(opts.util);
    r = r || rangeDates(key, opts);
    if (!r) return null;
    var from = u.parse(r.from), to = u.parse(r.to);
    if (!from || !to) return null;
    if (r.key === 'day') {
      var y = u.addDays(from, -1);
      return { from: u.toStr(y), to: u.toStr(y), days: 1, key: 'day', mode: 'cal' };
    }
    if (r.key === 'week') {
      var pw = weekBounds(u.addDays(from, -1), u);
      return { from: u.toStr(pw.from), to: u.toStr(pw.to), days: 7, key: 'week', mode: 'cal' };
    }
    if (r.key === 'month') {
      var pm = monthBounds(u.addDays(from, -1), u);
      // 参照月同样截到「同一天数」，避免月末几天没得比
      var span = u.diffDays(to, from);
      var pmTo = u.addDays(pm.from, span);
      if (pmTo > pm.to) pmTo = pm.to;
      return {
        from: u.toStr(pm.from), to: u.toStr(pmTo),
        days: u.diffDays(pmTo, pm.from) + 1, key: 'month', mode: 'cal'
      };
    }
    if (r.key === 'term') return null;   // 没有「上一学期」的可靠数据，不做比较
    if (r.key === 'year') {
      // 去年同期：去年 1 月 1 日 → 去年的「今天」（2/29 遇平年落到 2/28）
      var py = new Date(from.getFullYear() - 1, 0, 1);
      var pyTo = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
      if (pyTo.getDate() !== to.getDate()) pyTo = new Date(to.getFullYear() - 1, to.getMonth() + 1, 0);
      return {
        from: u.toStr(py), to: u.toStr(pyTo),
        days: u.diffDays(pyTo, py) + 1, key: 'year', mode: 'cal'
      };
    }
    // 滑动窗口：紧邻的等长区间
    var n = r.days;
    var pf = u.addDays(from, -n);
    var pt = u.addDays(from, -1);
    return { from: u.toStr(pf), to: u.toStr(pt), days: n, key: r.key, mode: 'win' };
  }

  /** 日均（保留一位小数），供跨长度区间比较 */
  function perDay(total, days) {
    if (!days) return 0;
    return Math.round(total / days * 10) / 10;
  }

  /** 区间内每天的日期字符串 */
  function eachDate(from, to, du) {
    var u = D(du);
    var out = [];
    var d = u.parse(from);
    var end = u.parse(to);
    var guard = 0;
    while (d && end && d <= end && guard < 400) {
      out.push(u.toStr(d));
      d = u.addDays(d, 1);
      guard++;
    }
    return out;
  }

  /**
   * 单日时间去向：把各类区间合并成 5 段 + 未记录。
   * @param {Object} parts { sleep:分钟, course:[[a,b]], event:[], activity:[], meal:[] }
   * @returns {{segments:Array, recorded:number, idle:number}}
   */
  function sumDaySegments(parts) {
    parts = parts || {};
    var segs = [
      { key: 'sleep', label: '睡眠', minutes: Math.max(0, Number(parts.sleep) || 0), color: '#6366f1' },
      { key: 'course', label: '上课', minutes: mergeTotal(parts.course), color: '#f59e0b' },
      { key: 'event', label: '日程', minutes: mergeTotal(parts.event), color: '#ec4899' },
      { key: 'activity', label: '活动记录', minutes: mergeTotal(parts.activity), color: '#10b981' },
      { key: 'meal', label: '用餐', minutes: mergeTotal(parts.meal), color: '#ef4444' }
    ];
    var recorded = 0;
    segs.forEach(function (s) { recorded += s.minutes; });
    var idle = Math.max(0, 1440 - recorded);
    segs.push({ key: 'idle', label: '未记录', minutes: idle, color: '#e8eaf0' });
    return { segments: segs, recorded: recorded, idle: idle };
  }

  /**
   * 区间汇总：把每天的 dayStat 合起来。
   * @param {Array} list [{date, segments}]
   * @returns {{segments, daily, recorded, total, pct, days}}
   */
  function rangeSummary(list, du) {
    var u = D(du);
    var keys = ['sleep', 'course', 'event', 'activity', 'meal', 'idle'];
    var labels = { sleep: '睡眠', course: '上课', event: '日程', activity: '活动', meal: '用餐', idle: '未记录' };
    var colors = { sleep: '#6366f1', course: '#f59e0b', event: '#ec4899', activity: '#10b981', meal: '#ef4444', idle: '#e8eaf0' };
    var sum = {}, daily = [];
    keys.forEach(function (k) { sum[k] = 0; });

    (list || []).forEach(function (st) {
      var per = 0;
      (st.segments || []).forEach(function (seg) {
        if (sum[seg.key] == null) sum[seg.key] = 0;
        sum[seg.key] += seg.minutes;
        if (seg.key !== 'idle') per += seg.minutes;
      });
      daily.push({ date: st.date, d: u.parse(st.date), recorded: per, idle: Math.max(0, 1440 - per) });
    });

    var segments = keys.map(function (k) {
      return { key: k, label: labels[k], minutes: Math.round(sum[k] || 0), color: colors[k] };
    });
    var recorded = segments.reduce(function (a, b) {
      return a + (b.key === 'idle' ? 0 : b.minutes);
    }, 0);
    var total = (list || []).length * 1440;
    return {
      segments: segments, daily: daily,
      recorded: recorded, total: total,
      pct: total ? Math.round(recorded / total * 100) : 0,
      days: (list || []).length
    };
  }

  var StatsCalc = {
    /* ---- 区间与时间口径 ---- */
    expandRange: expandRange,
    mergeTotal: mergeTotal,
    sleepByNight: sleepByNight,
    weekBounds: weekBounds,
    monthBounds: monthBounds,
    rangeDates: rangeDates,
    compareRange: compareRange,
    perDay: perDay,
    eachDate: eachDate,
    sumDaySegments: sumDaySegments,
    rangeSummary: rangeSummary,

    /* ---- 积分 / 账本 / 课程聚合 ---- */
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
  if (global.CP && global.CP.register) global.CP.register('StatsCalc', StatsCalc);
})(typeof window !== 'undefined' ? window : this);
