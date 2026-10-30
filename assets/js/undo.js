/* ==========================================================
 * 撤销栈：破坏性操作的回滚点
 * ----------------------------------------------------------
 * 误删一个学期课表的代价太大，而项目里原来只有「批量删除」带整份快照，
 * 单条删除、删课程、删目标、删学期都是点了就没了。
 *
 * 设计取舍：
 *   · 只快照「会被改动的那几个顶层集合」，不整份 state 克隆
 *     （背景图 / 宠物 sprite 都在 settings 里，整份克隆一次就上 MB）；
 *   · 上限 20 步，超出丢最旧；
 *   · 只包删除类操作。拖动 / 输入这类高频操作不要进来，否则栈会被刷爆。
 * 用法：在 boot 里 Undo.attach(Store)，之后 Store.undo() / canUndo() 可用。
 * ========================================================== */
(function (global) {
  'use strict';

  var MAX = 20;
  var stack = [];

  /** 删除函数 → 需要快照的顶层键（顺序即恢复顺序） */
  var TARGETS = {
    removeCourse: { keys: ['courses', 'grades', 'tasks', 'courseLogs', 'courseExceptions'], label: '删除课程' },
    removeTask: { keys: ['tasks'], label: '删除待办' },
    removePlan: { keys: ['plans'], label: '删除计划' },
    removeGoal: { keys: ['goals'], label: '删除目标' },
    removeEvent: { keys: ['events', 'taskArchive'], label: '删除日程' },
    removeCourseLog: { keys: ['courseLogs'], label: '删除课堂所学' },
    removeActivity: { keys: ['activities'], label: '删除活动记录' },
    removeMeal: { keys: ['meals', 'ledger'], label: '删除饮食记录' },
    removeSleep: { keys: ['sleeps'], label: '删除睡眠记录' },
    removeWorkout: { keys: ['workouts', 'activities'], label: '删除锻炼记录' },
    removeGrade: { keys: ['grades'], label: '删除成绩' },
    removeNote: { keys: ['notes'], label: '删除灵感' },
    removeDiary: { keys: ['diaries'], label: '删除日记' },
    removeLedger: { keys: ['ledger'], label: '删除账目' },
    removeSemester: { keys: ['semesters', 'currentSemesterId', 'courses', 'grades', 'courseLogs'], label: '删除学期' }
  };

  function clone(v) {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }

  function attach(Store) {
    if (!Store || Store.__undoAttached) return false;
    Store.__undoAttached = true;

    Store.canUndo = function () { return stack.length > 0; };
    Store.undoLabel = function () {
      return stack.length ? stack[stack.length - 1].label + '（' + stack[stack.length - 1].ago + '）' : '';
    };
    Store.clearUndo = function () { stack.length = 0; };

    Store.undo = function () {
      var e = stack.pop();
      if (!e) return null;
      Object.keys(e.snap).forEach(function (k) { Store.state[k] = e.snap[k]; });
      // 恢复后要把「当前学期」指针也校验一遍：删学期时一起存了
      if (Store.ensure) { try { Store.ensure(); } catch (err) { /* 兜底失败不阻断撤销 */ } }
      Store.save();
      Store.emit();
      return { label: e.label, keys: e.keys };
    };

    Object.keys(TARGETS).forEach(function (name) {
      var orig = Store[name];
      if (typeof orig !== 'function') return;
      var cfg = TARGETS[name];
      Store[name] = function () {
        var snap = {};
        cfg.keys.forEach(function (k) { snap[k] = clone(Store.state[k]); });
        var res = orig.apply(this, arguments);
        stack.push({
          label: cfg.label, keys: cfg.keys, snap: snap,
          at: Date.now(), ago: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        });
        if (stack.length > MAX) stack.shift();
        return res;
      };
    });
    return true;
  }

  var Undo = { attach: attach, max: MAX };
  global.Undo = Undo;
  if (global.CP && global.CP.register) global.CP.register('Undo', Undo);
})(typeof window !== 'undefined' ? window : globalThis);
