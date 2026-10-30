/* ==========================================================
 * 导入体检（纯函数模块）
 * ----------------------------------------------------------
 * validateSchema 能兜住「整块缺失 / 类型不对」，但兜不住
 * 「数组里混进一个字符串」——那种条目会在后续遍历里变成
 * undefined.title 之类的静默坏数据。
 * 这里只统计、不改数据：把「这份备份有几条坏记录」摆给用户看，
 * 让他决定要不要覆盖本机。
 * ========================================================== */
(function (global) {
  'use strict';

  var CHECK = ['courses', 'tasks', 'events', 'plans', 'goals', 'ledger', 'notes', 'diaries',
    'activities', 'meals', 'sleeps', 'metrics', 'workouts', 'weightLog', 'courseLogs'];

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * @param {Object} obj 待导入的原始对象（备份 / 同步文件 / 扫码结果）
   * @returns {{total:number, bad:number, byModule:Array<{key:string,count:number,total:number}>}}
   */
  function inspect(obj) {
    var out = { total: 0, bad: 0, byModule: [] };
    if (!obj || typeof obj !== 'object') return out;
    CHECK.forEach(function (k) {
      var arr = obj[k];
      if (!Array.isArray(arr)) return;
      var bad = 0;
      arr.forEach(function (it) {
        var ok = it && typeof it === 'object' && !Array.isArray(it) &&
          !!(it.id || it.name || it.title || it.date || it.content || it.start);
        // 日期只认 YYYY-MM-DD：'2026/3/5'、'昨天' 会让所有按字符串比较的逻辑失准
        if (ok && it.date != null && it.date !== '' && !DATE_RE.test(String(it.date))) ok = false;
        if (!ok) bad++;
      });
      out.total += arr.length;
      out.bad += bad;
      if (bad) out.byModule.push({ key: k, count: bad, total: arr.length });
    });
    return out;
  }

  /**
   * 三路合并（其实是两路：本机 + 备份）。规则：
   *   · 列表按「稳定键」对齐：有 id 用 id，没有就用语义键（课程名+教师 / 标题+截止日 / 日期）；
   *   · 同一键两边都有时，比 updatedAt（退化为 at / doneAt / createdAt），新的赢；
   *   · 只有一边有的记录一律保留 —— 这是和「覆盖导入」最大的区别；
   *   · 成绩按学期并集、成就并集、usage/taskSeq 取大；
   *   · settings / pomodoro / shop 这类「本机状态 + 经济」一律以本机为准，
   *     合并积分等于凭空发钱，不做。
   * @returns {Object} 需要写回 state 的补丁（含 __stats）
   */
  function mergeInto(base, incoming) {
    var b = base || {}, inc = incoming || {};
    var patch = {};
    var stats = [];

    var listKeys = ['courses', 'tasks', 'events', 'plans', 'goals', 'notes', 'ledger', 'diaries',
      'activities', 'meals', 'sleeps', 'metrics', 'workouts', 'weightLog', 'courseLogs'];

    function keyOf(k, it) {
      if (!it || typeof it !== 'object') return '';
      if (k === 'diaries') return it.date ? 'd:' + it.date : '';
      if (it.id) return String(it.id);
      if (k === 'courses' && it.name) return 'c:' + it.name + '|' + (it.teacher || '');
      if (k === 'tasks' && it.title) return 't:' + it.title + '|' + (it.dueDate || '');
      return '';
    }

    function stamp(it) {
      return String((it && (it.updatedAt || it.at || it.doneAt || it.createdAt)) || '');
    }

    listKeys.forEach(function (k) {
      var a = Array.isArray(b[k]) ? b[k] : [];
      var c = Array.isArray(inc[k]) ? inc[k] : [];
      if (!c.length) return;
      var map = {}, order = [];
      a.forEach(function (it) {
        var key = keyOf(k, it);
        if (!key) { order.push(it); return; }      // 没有稳定键的本地条目原样留着
        if (!(key in map)) { map[key] = it; order.push(key); }
        else map[key] = it;
      });
      var added = 0, replaced = 0;
      c.forEach(function (it) {
        var key = keyOf(k, it);
        if (!key) return;
        if (!(key in map)) { map[key] = it; order.push(key); added++; return; }
        var local = map[key];
        if (stamp(it) && (!stamp(local) || stamp(it) > stamp(local))) { map[key] = it; replaced++; }
      });
      var out = order.map(function (x) { return typeof x === 'string' ? map[x] : x; }).filter(Boolean);
      patch[k] = out;
      stats.push({ key: k, added: added, replaced: replaced, kept: a.length - replaced });
    });

    // 成绩：按学期 → 按 key 合并，incoming 更新的覆盖
    if (inc.grades && typeof inc.grades === 'object') {
      var grades = JSON.parse(JSON.stringify(b.grades || {}));
      Object.keys(inc.grades).forEach(function (sid) {
        var src = inc.grades[sid] || {};
        if (!grades[sid]) grades[sid] = {};
        Object.keys(src).forEach(function (gk) {
          var local = grades[sid][gk];
          var next = src[gk];
          if (!local || (stamp(next) && (!stamp(local) || stamp(next) > stamp(local)))) grades[sid][gk] = next;
        });
      });
      patch.grades = grades;
    }

    // 成就：并集（谁先拿到都算拿到）
    var incAch = (inc.achievements && inc.achievements.done) || null;
    if (incAch) {
      var done = JSON.parse(JSON.stringify((b.achievements && b.achievements.done) || {}));
      Object.keys(incAch).forEach(function (id) { if (!done[id]) done[id] = incAch[id]; });
      patch.achievements = { done: done };
    }

    // 使用次数 / 重复任务序号：取大，避免合并后成就进度回退
    ['usage', 'taskSeq'].forEach(function (k) {
      var incMap = inc[k];
      if (!incMap || typeof incMap !== 'object') return;
      var out = Object.assign({}, b[k] || {});
      Object.keys(incMap).forEach(function (id) {
        out[id] = Math.max(Number(out[id]) || 0, Number(incMap[id]) || 0);
      });
      patch[k] = out;
    });

    patch.__stats = stats;
    return patch;
  }

  /** 把合并结果写回 state（Store 只负责 save/emit） */
  function applyMerge(state, obj) {
    var patch = mergeInto(state, obj);
    var stats = patch.__stats || [];
    delete patch.__stats;
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    return stats;
  }

  global.ImportSafe = { inspect: inspect, CHECK: CHECK, mergeInto: mergeInto, applyMerge: applyMerge };
  if (global.CP && global.CP.register) global.CP.register('ImportSafe', global.ImportSafe);
})(typeof window !== 'undefined' ? window : globalThis);
