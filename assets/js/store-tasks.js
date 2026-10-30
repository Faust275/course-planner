/* ==========================================================
 * Store 任务域（v1.4.6 从 store.js 拆出）
 * ----------------------------------------------------------
 * 只通过 Object.assign 挂回 Store，对外 API 不变。
 * 依赖 store.js 暴露的内部上下文 Store._ctx。
 * ========================================================== */
(function (global) {
  'use strict';
  var Store = global.Store;
  if (!Store || !Store._ctx) return;
  var ctx = Store._ctx;
  var DateUtil = global.DateUtil;
  var firstOccurrence = ctx.firstOccurrence;
  var sanitizeRepeat = ctx.sanitizeRepeat;
  var repeatSummary = ctx.repeatSummary;
  var repeatShort = ctx.repeatShort;
  var genNextTask = ctx.genNextTask;
  var subOpts = ctx.subOpts;
  var isChild = ctx.isChild;
  var childrenOf = ctx.childrenOf;
  var subtaskProgress = ctx.subtaskProgress;
  var POMO = ctx.POMO;
  var compareDue = ctx.compareDue;

  Object.assign(Store, {
  /* ===== 作业 / 待办 CRUD ===== */
  /** 重复规则的人话摘要（弹窗提示、chip 的 title 共用） */
  repeatSummary: function (repeat, dueDate) { return repeatSummary(repeat, dueDate); },
  /** 由「开始日期 + 规则」算出第一期的实际日期（对齐到规则真正生效的那天） */
  firstOccurrence: function (startStr, repeat) { return firstOccurrence(startStr, repeat); },
  /** 规范化 repeat 字段（白名单 + 越界 clamp），供 UI 复用 */
  sanitizeRepeat: function (raw) { return sanitizeRepeat(raw); },

  /** 重复规则的极简标签（列表 chip 用） */
  repeatShort: function (repeat, dueDate) { return repeatShort(repeat, dueDate); },

  addTask: function (data) {
    var t = {
      id: ctx.uid('t'),
      title: (data.title || '').trim() || '未命名待办',
      courseId: data.courseId || '',
      dueDate: data.dueDate || '',
      dueTime: data.dueTime || '',
      status: data.status || 'todo',
      priority: data.priority || 'normal',
      important: !!data.important,
      tags: ctx.normalizeTags(data.tags),
      note: (data.note || '').trim(),
      repeat: sanitizeRepeat(data.repeat),
      parentId: this.validParentId(data.parentId),
      energy: data.energy || 'medium',
      examStage: data.examStage || '',
      goalId: data.goalId || '',
      krId: data.krId || '',
      estHours: Math.max(0, Number(data.estHours) || 0),
      createdAt: new Date().toISOString(),
      doneAt: ''
    };
    Store.state.tasks.push(t);
    // 维护一个单调自增的 order，作为「手动排序」字段的默认值
    (function () { var m = 0; Store.state.tasks.forEach(function (x) { if (typeof x.order === 'number' && x.order > m) m = x.order; }); t.order = m + 1; })();
    // 新增子任务后，父任务的进度可能变了；若设置要求「全完成自动完成父」，这里也要生效
    if (t.parentId) this.syncParent(t.parentId);
    if (this.markAction) this.markAction('task', 1);
    this.emit();
    this.save(true);
    return t;
  },

  /**
   * 校验父任务 id：父必须存在、且自己不能是子任务（只允许一层）
   * @returns {string} 合法的父 id，或 '' 表示顶层任务
   */
  validParentId: function (pid, selfId) {
    if (!pid || pid === selfId) return '';
    var p = this.getTask(pid);
    if (!p || p.parentId) return '';
    return pid;
  },

  updateTask: function (id, data) {
    var t = this.getTask(id);
    if (!t) return null;
    var wasDone = t.status === 'done';
    var wasParentId = t.parentId || '';
    Object.keys(data).forEach(function (k) {
      t[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
    });
    // 父子关系单独校验：不允许挂到子任务下面（只做一层）
    if (Object.prototype.hasOwnProperty.call(data, 'parentId')) {
      t.parentId = this.validParentId(data.parentId, id);
    }
    // 重复规则单独规范化，避免脏数据（weekdays/pos 越界、多余字段）
    if (Object.prototype.hasOwnProperty.call(data, 'repeat')) {
      t.repeat = sanitizeRepeat(t.repeat);
    }
    // 首次标记为完成 → 奖励积分
    if (!wasDone && t.status === 'done') {
      this.addPoints(POMO.TASK_DONE, 'task');
      if (this.markAction) this.markAction('taskdone', 1);
      // 重复任务：完成时生成下一期实例（保留 repeat 链条）
      if (t.repeat && t.repeat.type !== 'none') {
        var nt = genNextTask(t);
        if (nt) Store.state.tasks.push(nt);
      }
    }
    this.checkAchievements(true);
    if (t.status === 'done' && !t.doneAt) t.doneAt = new Date().toISOString();
    if (t.status !== 'done') t.doneAt = '';

    /* ---- 子任务联动 ---- */
    var o = subOpts(Store.state.settings);
    if (!wasDone && t.status === 'done') {
      if (isChild(t)) {
        // ① 子任务全完成 → 视设置决定是否自动完成父任务
        if (wasParentId) this.syncParent(wasParentId);
      } else if (o.cascadeDone) {
        // ② 父任务完成 → 视设置决定是否连带勾选未完成的子任务
        childrenOf(Store.state.tasks, t.id).forEach(function (c) {
          if (c.status !== 'done') {
            c.status = 'done';
            c.doneAt = new Date().toISOString();
          }
        });
      }
    }
    // 父任务从「完成」改回未完成时，子任务不动（不做事后回滚，避免误伤手动改过的）
    if (wasDone && t.status !== 'done' && isChild(t) && wasParentId) this.syncParent(wasParentId);

    this.emit();
    this.save(true);
    return t;
  },

  /**
   * 子任务变动后同步父任务状态。
   * 只有在「子任务全部完成」且设置允许时才自动完成父任务；
   * 不做反方向的「子任务没完成就把父任务退回」，否则改一个子任务会把父任务反复拉扯。
   */
  syncParent: function (pid) {
    var p = this.getTask(pid);
    if (!p) return;
    var o = subOpts(Store.state.settings);
    var pr = subtaskProgress(Store.state.tasks, pid);
    if (!o.autoDoneParent) return;
    if (pr.allDone && p.status !== 'done') {
      p.status = 'done';
      p.doneAt = new Date().toISOString();
      this.addPoints(POMO.TASK_DONE, 'task');
    }
  },

  /** 当前设置下的子任务行为（带默认值兜底） */
  subtaskOpts: function () {
    return subOpts(Store.state.settings);
  },

  /** 某任务的直属子任务（按创建顺序） */
  subtasksOf: function (id) {
    return childrenOf(Store.state.tasks, id);
  },

  /** 某任务的子任务进度 { total, done, pct, allDone } */
  subtaskProgress: function (id) {
    return subtaskProgress(Store.state.tasks, id);
  },

  /**
   * 删除待办。父任务按设置处理子任务：
   *   orphanKeep = true  → 子任务保留，parentId 清空，变成顶层任务
   *   orphanKeep = false → 子任务一并删除
   * @returns {{ removed: number, kept: number }}
   */
  removeTask: function (id) {
    var t = this.getTask(id);
    if (!t) return { removed: 0, kept: 0 };
    var o = subOpts(Store.state.settings);
    var removed = 1, kept = 0;
    var kill = {};
    var isParent = !t.parentId;     // 必须在改动之前判断，下面会动 t.parentId 之外的记录
    var parentId = t.parentId;

    if (isParent) {
      var kids = childrenOf(Store.state.tasks, id);
      if (kids.length) {
        if (o.orphanKeep) {
          kids.forEach(function (c) { c.parentId = ''; });
          kept = kids.length;
        } else {
          kids.forEach(function (c) { kill[c.id] = 1; removed++; });
        }
      }
    }

    Store.state.tasks = Store.state.tasks.filter(function (x) { return x.id !== id && !kill[x.id]; });
    if (parentId) this.syncParent(parentId);
    this.emit();
    return { removed: removed, kept: kept };
  },

  /**
   * 批量删除（单事务）：遵循与 removeTask 相同的 orphanKeep 规则。
   * 返回 { removed, kept, snapshot, ids }；snapshot 用于「撤销」整份恢复。
   */
  removeTasks: function (ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return { removed: 0, kept: 0, snapshot: null, ids: [] };
    var set = {};
    ids.forEach(function (id) { set[id] = 1; });
    var o = subOpts(Store.state.settings);
    var snapshot = JSON.parse(JSON.stringify(Store.state.tasks));
    var removeSet = {};
    Store.state.tasks.forEach(function (t) { if (set[t.id]) removeSet[t.id] = 1; });

    var kept = 0;
    if (o.orphanKeep) {
      // 保留子任务：选中父任务的子任务提升为顶层（子任务自己被选中时仍删除）
      Store.state.tasks.forEach(function (t) {
        if (t.parentId && set[t.parentId] && !set[t.id]) { t.parentId = ''; kept++; }
      });
    } else {
      // 一并删除：选中父任务的全部直属子任务
      Store.state.tasks.forEach(function (t) {
        if (t.parentId && set[t.parentId]) removeSet[t.id] = 1;
      });
    }

    // 被删掉子任务、但父任务还在的，父任务联动一次（与单条删除一致）
    var affectedParents = {};
    Store.state.tasks.forEach(function (t) {
      if (removeSet[t.id] && t.parentId && !removeSet[t.parentId]) affectedParents[t.parentId] = 1;
    });

    var removedIds = [];
    Store.state.tasks = Store.state.tasks.filter(function (t) {
      if (removeSet[t.id]) { removedIds.push(t.id); return false; }
      return true;
    });
    var self = this;
    Object.keys(affectedParents).forEach(function (pid) { self.syncParent(pid); });
    this.emit();
    return { removed: removedIds.length, kept: kept, snapshot: snapshot, ids: removedIds };
  },

  /** 从删除快照整份恢复，用于撤销 */
  restoreTasks: function (snapshot) {
    if (!Array.isArray(snapshot)) return false;
    Store.state.tasks = JSON.parse(JSON.stringify(snapshot));
    this.emit();
    return true;
  },

  getTask: function (id) {
    for (var i = 0; i < Store.state.tasks.length; i++) {
      if (Store.state.tasks[i].id === id) return Store.state.tasks[i];
    }
    // 已归档的旧实例不在主列表里，但统计 / 时间投入可能仍按 id 找过来
    var _arc = Store.state.taskArchive || [];
    for (var j = 0; j < _arc.length; j++) {
      if (_arc[j].id === id) return _arc[j];
    }
    return null;
  },

  /** 顶层任务（不含子任务）。「今日」、四象限、导航角标只看这些 */
  rootTasks: function () {
    return Store.state.tasks.filter(function (t) { return !t.parentId; });
  },

  /** 顶层待完成任务，按截止时间升序 */
  rootPending: function () {
    return this.rootTasks().filter(function (t) { return t.status !== 'done'; }).sort(compareDue);
  },

  /** 任务状态循环：todo -> doing -> done -> todo */
  cycleTask: function (id) {
    var t = this.getTask(id);
    if (!t) return;
    var next = t.status === 'todo' ? 'doing' : (t.status === 'doing' ? 'done' : 'todo');
    this.updateTask(id, { status: next });
  },

  toggleTask: function (id) {
    var t = this.getTask(id);
    if (!t) return null;
    return this.updateTask(id, { status: t.status === 'done' ? 'todo' : 'done' });
  },

  /** 未完成任务，按截止时间升序（无日期的排最后） */
  pendingTasks: function () {
    return Store.state.tasks.filter(function (t) { return t.status !== 'done'; }).sort(compareDue);
  },

  todayTasks: function () {
    var today = DateUtil.toStr(DateUtil.today());
    return this.pendingTasks().filter(function (t) { return t.dueDate === today; }).sort(function (a, b) {
      if (!!a.important !== !!b.important) return a.important ? -1 : 1;
      var ta = a.dueTime || '23:59', tb = b.dueTime || '23:59';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  },

  overdueTasks: function () {
    return this.pendingTasks().filter(function (t) {
      return t.dueDate && DateUtil.daysLeft(t.dueDate) < 0;
    });
  },

  /** 某天的课程（按节次排序） */
  /**
   * 课程的时间区间（按节次，或自己划定的时间）
   * @returns { start, end, label, mode } 没有时间信息返回 null
   */
  courseTime: function (c) {
    if (!c) return null;
    if (c.timeMode === 'custom' && c.startTime) {
      var end = c.endTime || c.startTime;
      return { start: c.startTime, end: end, label: c.startTime + '-' + end, mode: 'custom' };
    }
    var p = c.periodId ? this.getPeriod(c.periodId) : null;
    if (!p) return null;
    return { start: p.start, end: p.end, label: p.name, mode: 'period' };
  },

  coursesOnDay: function (day, weekNo) {
    weekNo = weekNo == null ? this.currentWeek() : weekNo;
    var sid = Store.state.currentSemesterId;
    var out = [];
    Store.state.courses.forEach(function (c) {
      if (c.semesterId && c.semesterId !== sid) return;
      if (!Store.courseInWeek(c, weekNo)) return;
      Store.expandCourse(c, weekNo).forEach(function (p) { if (p.day === day) out.push(p); });
    });
    return out.sort(function (a, b) {
      var ta = Store.courseTime(a), tb = Store.courseTime(b);
      return (ta ? ta.start : '99:99') < (tb ? tb.start : '99:99') ? -1 : 1;
    });
  },
  });
})(window);
