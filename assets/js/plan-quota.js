/* ==========================================================
 * 额度型计划的周期窗口（纯函数模块）
 * ----------------------------------------------------------
 * 「每周 3 次」「每月 2 次复盘」这类计划，难点全在窗口边界：
 *   · 周窗口从 startDate 起每 7 天一段，不是自然周（用户可能是周三开始）
 *   · 月窗口按自然月，但日号要用 startDate 的（1/31 起 → 2 月夹到 2/28）
 * 这些函数不依赖 Store、不碰 DOM，DateUtil 由参数注入，单测可以直接喂日期。
 * ========================================================== */
(function (global) {
  'use strict';

  /**
   * 第 idx 个周期（0 起）的起止日期。
   * @returns {{index:number, start:string, end:string}}
   */
  function windowAt(plan, idx, u) {
    var i = Math.max(0, parseInt(idx, 10) || 0);
    var start = u.parse(plan.startDate) || u.today();
    var ws, we;
    if (plan.period === 'monthly') {
      ws = u.addMonths(start, i);
      we = u.addDays(u.addMonths(start, i + 1), -1);
    } else {
      ws = u.addDays(start, i * 7);
      we = u.addDays(ws, 6);
    }
    return { index: i, start: u.toStr(ws), end: u.toStr(we) };
  }

  /** 日期落在第几个周期；早于开始日一律算第 0 个（还没开始时也显示第一格） */
  function indexOn(plan, dateStr, u) {
    var start = u.parse(plan.startDate) || u.today();
    var d = u.parse(dateStr) || u.today();
    if (d < start) return 0;
    if (plan.period === 'monthly') {
      return (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    }
    return Math.floor(u.diffDays(d, start) / 7);
  }

  /** 某个周期窗口内打了几次卡 */
  function countIn(plan, win) {
    var from = win.start, to = win.end, n = 0;
    (plan.records || []).forEach(function (r) {
      if (r && r.date && r.date >= from && r.date <= to) n++;
    });
    return n;
  }

  /**
   * 额度型的当前状态（供 UI 与进度共用）：
   * { n, period, index, start, end, count, reached, doneWindows, totalWindows }
   */
  function stateOf(plan, todayStr, u) {
    var n = Math.max(1, parseInt(plan.quotaN, 10) || 1);
    var total = Math.max(1, parseInt(plan.days, 10) || 1);
    var idx = indexOn(plan, todayStr || u.toStr(u.today()), u);
    var cur = windowAt(plan, idx, u);
    var doneWindows = 0;
    for (var i = 0; i < total; i++) {
      if (countIn(plan, windowAt(plan, i, u)) >= n) doneWindows++;
    }
    var count = countIn(plan, cur);
    return {
      n: n, period: plan.period, index: idx,
      start: cur.start, end: cur.end,
      count: count, reached: count >= n,
      doneWindows: doneWindows, totalWindows: total
    };
  }

  global.PlanQuota = {
    windowAt: windowAt,
    indexOn: indexOn,
    countIn: countIn,
    stateOf: stateOf
  };
  if (global.CP && global.CP.register) global.CP.register('PlanQuota', global.PlanQuota);
})(typeof window !== 'undefined' ? window : globalThis);
