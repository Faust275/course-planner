/* ==========================================================
 * DDL 冲刺线
 * ----------------------------------------------------------
 * 把「未来 N 天所有截止」按小时排成一条线，考试周不用在待办里翻。
 * 只读 Store，纯函数，方便单测。
 * ========================================================== */
(function (global) {
  'use strict';

  function dueDate(t) {
    var DU = global.DateUtil;
    if (!DU || !t || !t.dueDate) return null;
    var d = DU.parse(t.dueDate);
    if (!d) return null;
    var hm = String(t.dueTime || '23:59').split(':');
    var h = parseInt(hm[0], 10);
    var m = parseInt(hm[1], 10);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(),
      isNaN(h) ? 23 : h, isNaN(m) ? 59 : m, 0, 0);
  }

  /**
   * @param {number} [days=7] 往后看几天（含今天）
   * @param {Date} [nowInput] 便于测试
   * @returns {Array<{task:Object, at:Date, leftMin:number, overdue:boolean}>}
   */
  function upcoming(days, nowInput) {
    var Store = global.Store;
    var DU = global.DateUtil;
    if (!Store || !DU) return [];
    var now = (nowInput instanceof Date) ? nowInput : new Date();
    var limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (days || 7), 23, 59, 59);
    var out = [];
    (Store.pendingTasks ? Store.pendingTasks() : []).forEach(function (t) {
      var at = dueDate(t);
      if (!at || at > limit) return;
      out.push({
        task: t,
        at: at,
        leftMin: Math.round((at.getTime() - now.getTime()) / 60000),
        overdue: at.getTime() < now.getTime()
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  /** 今天 / 明天 / 后天 / 周三 */
  function dayLabel(d, nowInput) {
    var DU = global.DateUtil;
    var now = (nowInput instanceof Date) ? nowInput : new Date();
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((target - base) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return '周' + '日一二三四五六'.charAt(d.getDay());
  }

  /** 剩余时间：已逾期 2h / 剩 35m / 剩 6.4h / 剩 3d */
  function leftText(mins) {
    if (mins < 0) {
      var over = -mins;
      return over >= 1440 ? ('已逾期 ' + Math.round(over / 1440) + 'd') : ('已逾期 ' + Math.max(1, Math.round(over / 60)) + 'h');
    }
    if (mins < 60) return '剩 ' + Math.max(1, Math.round(mins)) + 'm';
    if (mins < 1440) return '剩 ' + (Math.round(mins / 6) / 10) + 'h';
    return '剩 ' + Math.round(mins / 1440) + 'd';
  }

  /** 紧迫度：over / 24h / 72h / normal */
  function urgency(mins) {
    if (mins < 0) return 'over';
    if (mins <= 1440) return '24h';
    if (mins <= 4320) return '72h';
    return 'normal';
  }

  global.Deadline = {
    dueDate: dueDate,
    upcoming: upcoming,
    dayLabel: dayLabel,
    leftText: leftText,
    urgency: urgency
  };
})(typeof window !== 'undefined' ? window : globalThis);
