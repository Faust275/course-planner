/* ==========================================================
 * 今日出门清单
 * ----------------------------------------------------------
 * 只读 Store，不写任何数据：按当天课程 + 当天到期任务，推出一份
 * 「今天带什么」。规则刻意保守，宁可少提醒，也不塞一堆没用的东西。
 * 纯函数，方便单测。
 * ========================================================== */
(function (global) {
  'use strict';

  function uniqPush(list, seen, text, why) {
    if (!text) return;
    if (seen[text]) return;
    seen[text] = 1;
    list.push({ text: text, why: why || '' });
  }

  /**
   * @param {string} dateStr YYYY-MM-DD
   * @returns {Array<{text: string, why: string}>}
   */
  function forDate(dateStr) {
    var out = [], seen = {};
    try {
      var Store = global.Store;
      if (!Store) return [];
      var courses = Store.coursesOnDate ? Store.coursesOnDate(dateStr) : [];
      var tasks = Store.pendingTasks ? Store.pendingTasks() : [];
      var dueToday = tasks.filter(function (t) { return t && t.dueDate === dateStr; });

      // 考试优先：当天有考试，证件比教材重要
      courses.forEach(function (c) {
        if (c && c.exam && c.exam.date === dateStr) {
          uniqPush(out, seen, '学生证 / 准考证', '今天有考试');
        }
      });

      // 特殊课型
      courses.forEach(function (c) {
        var n = (c && c.name) || '';
        if (/实验|实训/.test(n)) uniqPush(out, seen, '实验报告 / 实验服', n);
        if (/体育|体测|游泳/.test(n)) uniqPush(out, seen, '运动鞋 / 水', n);
      });

      // 教材：最多列 4 门，剩下的合并
      var names = courses.map(function (c) { return (c && c.name) || ''; }).filter(Boolean);
      names.slice(0, 4).forEach(function (n) {
        uniqPush(out, seen, '《' + n + '》教材 / 讲义', '今天有课');
      });
      if (names.length > 4) {
        uniqPush(out, seen, '其余 ' + (names.length - 4) + ' 门课的讲义', '今天有课');
      }

      // 今天要交的东西
      dueToday.forEach(function (t) {
        uniqPush(out, seen, '交：' + (t.title || '作业'), '今天到期');
      });

      // 基础项：只在当天有事（有课或有 DDL）时提醒，空白天不打扰
      if (courses.length || dueToday.length) {
        uniqPush(out, seen, '校园卡 / 水杯', '日常');
      }
    } catch (e) {
      return [];
    }
    return out;
  }

  /** 一行文本，方便复制 */
  function toText(dateStr) {
    return forDate(dateStr).map(function (it) { return '· ' + it.text; }).join('\n');
  }

  global.Packing = { forDate: forDate, toText: toText };
})(typeof window !== 'undefined' ? window : globalThis);
