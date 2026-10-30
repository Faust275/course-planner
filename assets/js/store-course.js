/* ==========================================================
 * Store 课程域（v1.4.6 从 store.js 拆出）
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
  var normSlot = ctx.normSlot;
  var holidayPaused = ctx.holidayPaused;
  var goalActive = ctx.goalActive;
  var krProgress = ctx.krProgress;
  var buildCourseExamSlots = ctx.buildCourseExamSlots;
  var normCourseExamsInput = ctx.normCourseExamsInput;
  var extractValidExams = ctx.extractValidExams;
  var pickPrimaryExam = ctx.pickPrimaryExam;
  var COLORS = ctx.COLORS;
  var GPA_LEVEL_RULES = ctx.GPA_LEVEL_RULES;

  Object.assign(Store, {
  /* ===== 学期 & 周次 ===== */
  /* ===== 学期 ===== */
  /** 当前学期对象 */
  currentSemester: function () {
    var id = Store.state.currentSemesterId;
    for (var i = 0; i < Store.state.semesters.length; i++) {
      if (Store.state.semesters[i].id === id) return Store.state.semesters[i];
    }
    return Store.state.semesters[0];
  },

  semesterById: function (id) {
    for (var i = 0; i < Store.state.semesters.length; i++) {
      if (Store.state.semesters[i].id === id) return Store.state.semesters[i];
    }
    return null;
  },

  /** 切换课表/成绩查看的学期 */
  switchSemester: function (id) {
    if (!this.semesterById(id)) return null;
    Store.state.currentSemesterId = id;
    this.emit();
    return this.currentSemester();
  },

  /** 新建学期（默认接着排在当前学期之后，并切换过去） */
  addSemester: function (data) {
    data = data || {};
    var prev = this.currentSemester();
    var start = data.startDate;
    if (!start && prev) {
      var prevStart = DateUtil.parse(prev.startDate);
      if (prevStart) start = DateUtil.toStr(DateUtil.addDays(prevStart, (prev.weeks || 20) * 7));
    }
    if (!start) start = DateUtil.toStr(DateUtil.weekStart(DateUtil.today()));
    var s = {
      id: ctx.uid('sem'),
      name: (data.name || '').trim() || '新学年 新学期的课表',
      startDate: start,
      weeks: Math.max(1, Math.min(30, parseInt(data.weeks, 10) || 20))
    };
    Store.state.semesters.push(s);
    if (data.switchTo !== false) Store.state.currentSemesterId = s.id;
    this.emit();
    return s;
  },

  /**
   * 以某学期课表为模板，把课程整套复制到另一个学期（新建学期时用）。
   * 只复制课程本身（含时段、周次、学分、考试时间），不复制成绩与调课记录。
   * @returns {number} 复制的课程数
   */
  cloneCourses: function (fromSid, toSid) {
    if (!fromSid || !toSid || fromSid === toSid) return 0;
    var firstSem = Store.state.semesters.length ? Store.state.semesters[0].id : null;
    var src = Store.state.courses.filter(function (c) {
      // 旧版无 semesterId 的课程归最早那个学期（当时只有一个学期）
      return c.semesterId === fromSid || (!c.semesterId && fromSid === firstSem);
    });
    src.forEach(function (c) {
      var copy = JSON.parse(JSON.stringify(c));
      copy.id = ctx.uid('c');
      copy.semesterId = toSid;
      Store.state.courses.push(copy);
    });
    if (src.length) this.emit();
    return src.length;
  },

  /** 删除学期：里面的课程和成绩一起删掉 */
  removeSemester: function (id) {
    if (Store.state.semesters.length <= 1) return false;
    var idx = -1;
    Store.state.semesters.forEach(function (s, i) { if (s.id === id) idx = i; });
    if (idx < 0) return false;
    Store.state.semesters.splice(idx, 1);
    Store.state.courses = Store.state.courses.filter(function (c) { return c.semesterId !== id; });
    if (Array.isArray(Store.state.courseLogs)) {
      Store.state.courseLogs = Store.state.courseLogs.filter(function (lg) { return lg && lg.semesterId !== id; });
    }
    delete Store.state.grades[id];
    if (Store.state.currentSemesterId === id) Store.state.currentSemesterId = Store.state.semesters[0].id;
    this.emit();
    return true;
  },

  semesterStart: function () {
    var sem = this.currentSemester();
    return DateUtil.parse(sem.startDate) || DateUtil.weekStart(DateUtil.today());
  },

  /** 第 n 周(1-based) 的周一日期 */
  weekStartDate: function (n) {
    return DateUtil.addDays(this.semesterStart(), (n - 1) * 7);
  },

  /** 某日期属于第几周（可能 <=0 或 > weeks，表示学期外） */
  weekOf: function (d) {
    d = d || DateUtil.today();
    return Math.floor(DateUtil.diffDays(d, this.semesterStart()) / 7) + 1;
  },

  currentWeek: function () { return this.weekOf(DateUtil.today()); },

  /** 第 n 周、星期 dow(1-7) 的日期对象 */
  dateOf: function (weekNo, dow) {
    return DateUtil.addDays(this.weekStartDate(weekNo), dow - 1);
  },

  /** 课程在第 weekNo 周是否上课 */
  courseInWeek: function (course, weekNo) {
    var s = course.startWeek == null ? 1 : course.startWeek;
    var e = course.endWeek == null ? this.currentSemester().weeks : course.endWeek;
    if (weekNo < s || weekNo > e) return false;
    if (course.weekType === 'odd') return weekNo % 2 === 1;
    if (course.weekType === 'even') return weekNo % 2 === 0;
    return true;
  },

  weekTypeText: function (t) {
    return t === 'odd' ? '单周' : (t === 'even' ? '双周' : '每周');
  },

  /* ===== 课程 CRUD ===== */
  addCourse: function (data) {
    var slots = (data.slots && data.slots.length)
      ? data.slots.map(normSlot)
      : [normSlot(data)];
    var s0 = slots[0] || normSlot({});
    var c = {
      id: ctx.uid('c'),
      name: (data.name || '').trim() || '未命名课程',
      teacher: (data.teacher || '').trim(),
      location: (data.location || '').trim() || s0.location || '',
      color: data.color || COLORS[Store.state.courses.length % COLORS.length],
      slots: slots,
      day: s0.day,
      timeMode: s0.timeMode,
      periodId: s0.periodId,
      startTime: s0.startTime,
      endTime: s0.endTime,
      semesterId: data.semesterId || Store.state.currentSemesterId,
      credit: Number(data.credit) > 0 ? Number(data.credit) : 0,
      exams: normCourseExamsInput(data, null),
      exam: pickPrimaryExam(normCourseExamsInput(data, null), data.exam),
      startWeek: data.startWeek == null ? 1 : data.startWeek,
      endWeek: data.endWeek == null ? this.currentSemester().weeks : data.endWeek,
      weekType: data.weekType || 'all',
      note: (data.note || '').trim(),
      rotations: Array.isArray(data.rotations) ? data.rotations.filter(function (r) {
        return r && (r.location || r.topic);
      }).map(function (r) {
        return {
          startWeek: parseInt(r.startWeek, 10) || 1,
          endWeek: parseInt(r.endWeek, 10) || 16,
          location: (r.location || '').trim(),
          topic: (r.topic || '').trim()
        };
      }) : []
    };
    Store.state.courses.push(c);
    this.bumpUsage('course');
    if (this.markAction) this.markAction('course', 1);
    this.emit();
    this.checkAchievements(true);
    return c;
  },

  updateCourse: function (id, data) {
    var c = this.getCourse(id);
    if (!c) return null;
    var oldName = c.name;
    var sid = c.semesterId || Store.state.currentSemesterId;
    var hasSlots = Array.isArray(data.slots);
    Object.keys(data).forEach(function (k) {
      if (k === 'slots' || k === 'exams' || k === 'exam') return;
      if (typeof data[k] === 'string') c[k] = data[k].trim();
      else c[k] = data[k];
    });
    if (data.exams !== undefined || data.exam !== undefined) {
      c.exams = normCourseExamsInput(data, c);
      c.exam = pickPrimaryExam(c.exams, data.exam);
    }
    if (hasSlots) {
      c.slots = data.slots.map(normSlot);
    } else if (c.slots && c.slots.length &&
               (data.day != null || data.periodId != null || data.startTime != null)) {
      // 兼容只传单时段字段的旧调用：更新第一个时段
      var s0 = c.slots[0];
      if (data.day != null) s0.day = data.day || 1;
      if (data.timeMode != null) s0.timeMode = data.timeMode === 'custom' ? 'custom' : 'period';
      if (data.periodId != null) s0.periodId = s0.timeMode === 'custom' ? '' : (data.periodId || '');
      if (data.startTime != null) s0.startTime = s0.timeMode === 'custom' ? (data.startTime || '') : '';
      if (data.endTime != null) s0.endTime = s0.timeMode === 'custom' ? (data.endTime || '') : '';
      if (data.location != null) s0.location = (data.location || '').trim();
    }
    if (c.slots && c.slots.length) {
      var m0 = c.slots[0];
      c.day = m0.day;
      c.timeMode = m0.timeMode;
      c.periodId = m0.periodId;
      c.startTime = m0.startTime;
      c.endTime = m0.endTime;
      if (data.location == null && m0.location) c.location = m0.location;
    }
    if (Array.isArray(data.rotations)) {
      c.rotations = data.rotations.filter(function (r) {
        return r && (r.location || r.topic);
      }).map(function (r) {
        return {
          startWeek: parseInt(r.startWeek, 10) || 1,
          endWeek: parseInt(r.endWeek, 10) || 16,
          location: (r.location || '').trim(),
          topic: (r.topic || '').trim()
        };
      });
    }
    // 同步关联成绩记录（课程改名、改学分、改考试日期时不丢失已有成绩构成）
    if (Store.state.grades && Store.state.grades[sid]) {
      var gmap = Store.state.grades[sid];
      var oldKey = 'c:' + oldName;
      var newKey = 'c:' + c.name;
      var hitKey = null;
      Object.keys(gmap).forEach(function (k) {
        var gr = gmap[k];
        if (gr && (gr.courseId === c.id || k === oldKey || gr.name === oldName)) {
          hitKey = k;
        }
      });
      if (hitKey) {
        var grec = gmap[hitKey];
        grec.courseId = c.id;
        grec.name = c.name;
        if (data.credit != null && Number(c.credit) > 0) grec.credit = Number(c.credit);
        if (data.exam !== undefined) grec.exam = c.exam || null;
        if (hitKey !== newKey && !gmap[newKey]) {
          grec.key = newKey;
          gmap[newKey] = grec;
          delete gmap[hitKey];
        }
      }
    }
    // 同步更新关联课堂所学记录与笔记中的课程名称
    if (oldName && c.name && oldName !== c.name) {
      if (Array.isArray(Store.state.courseLogs)) {
        Store.state.courseLogs.forEach(function (lg) {
          if (lg && (lg.courseId === c.id || (lg.courseName === oldName && (!lg.semesterId || lg.semesterId === sid)))) {
            lg.courseId = c.id;
            lg.courseName = c.name;
          }
        });
      }
      if (Array.isArray(Store.state.notes)) {
        Store.state.notes.forEach(function (nt) {
          if (nt && nt.courseId === c.id) nt.courseName = c.name;
        });
      }
    }
    this.emit();
    return c;
  },

  removeCourse: function (id) {
    var target = this.getCourse(id);
    var sid = target ? (target.semesterId || Store.state.currentSemesterId) : Store.state.currentSemesterId;
    Store.state.courses = Store.state.courses.filter(function (c) { return c.id !== id; });
    // 同步清理关联任务中的课程引用（保留任务，解绑课程）
    Store.state.tasks.forEach(function (t) { if (t.courseId === id) t.courseId = ''; });
    // 考勤记录随课程一起删除（没有课程名的孤儿记录没有意义）
    if (Array.isArray(Store.state.attendance)) {
      Store.state.attendance = Store.state.attendance.filter(function (a) { return a && a.courseId !== id; });
    }
    // 同步保留课堂所学记录（解绑已删除的 courseId，保留 courseName 供复习查看）
    if (Array.isArray(Store.state.courseLogs)) {
      Store.state.courseLogs.forEach(function (lg) {
        if (lg && lg.courseId === id) {
          if (!lg.courseName && target && target.name) lg.courseName = target.name;
          lg.courseId = '';
        }
      });
    }
    // 若成绩记录关联了该课程：若尚未填任何有效分数则清理空壳，若已录成绩则转为 manual 保留
    if (Store.state.grades && Store.state.grades[sid]) {
      var gmap = Store.state.grades[sid];
      var self = this;
      Object.keys(gmap).forEach(function (k) {
        var gr = gmap[k];
        if (gr && (gr.courseId === id || (target && k === 'c:' + target.name))) {
          // 是否真的录入了有效分数：百分制看构成树总评；等级制看 level；通过制看 passed。
          // 仅当完全没有分数（空壳：含只搭了构成树但小分全空）才清理，已录分则转 manual 保留。
          var hasScore;
          if (gr.scale === 'level') {
            hasScore = !!gr.level;
          } else if (gr.scale === 'pass') {
            hasScore = gr.passed !== undefined && gr.passed !== null;
          } else {
            var sc = gr.root ? self.computeGrade(gr.root) : null;
            hasScore = sc != null;
          }
          if (!hasScore) {
            delete gmap[k];
          } else {
            gr.courseId = '';
            gr.source = 'manual';
          }
        }
      });
    }
    this.emit();
  },

  /* ==========================================================
   * 学分
   * ========================================================== */
  /** 某学期的课程学分（同名课程只算一次，避免多节次重复计） */
  creditsOf: function (semesterId) {
    var sid = semesterId || Store.state.currentSemesterId;
    var map = {};
    Store.state.courses.forEach(function (c) {
      if (c.semesterId !== sid || !(c.credit > 0)) return;
      map[c.name] = Math.max(map[c.name] || 0, Number(c.credit) || 0);
    });
    var total = 0;
    Object.keys(map).forEach(function (k) { total += map[k]; });
    return Math.round(total * 100) / 100;
  },

  currentCredits: function () { return this.creditsOf(Store.state.currentSemesterId); },

  historyCredits: function () {
    var self = this, total = 0;
    Store.state.semesters.forEach(function (s) {
      if (s.id === Store.state.currentSemesterId) return;
      total += self.creditsOf(s.id);
    });
    return Math.round(total * 100) / 100;
  },

  /* ==========================================================
   * 考试（默认支持「期中考试 + 期末考试」双独立时间，且可无限添加自定义测验/考试）
   * ========================================================== */
  /** 获取一门课程用于编辑弹窗的考试槽位列表（默认保证有期中考试、期末考试两个独立槽位，外加已添加的自定义考试） */
  courseExamSlots: function (course) {
    return buildCourseExamSlots(course);
  },

  /** 获取一门课程所有已填写有效日期的考试列表（按日期+时间升序） */
  courseExamList: function (course) {
    return extractValidExams(course);
  },

  /** 某一天的考试（当前学期，支持同课程多场考试如期中+期末） */
  examsOf: function (dateStr) {
    var sid = Store.state.currentSemesterId, out = [], seen = {};
    Store.state.courses.forEach(function (c) {
      if (c.semesterId !== sid) return;
      var list = extractValidExams(c);
      list.forEach(function (ex) {
        if (ex.date !== dateStr) return;
        var key = c.name + '|' + (ex.label || '') + '|' + (ex.start || '');
        if (seen[key]) return;
        seen[key] = 1;
        out.push({
          id: ex.id || 'final',
          name: c.name,
          examLabel: ex.label || '期末考试',
          fullTitle: c.name + (ex.label ? '（' + ex.label + '）' : ''),
          courseId: c.id,
          color: c.color,
          date: ex.date,
          start: ex.start || '',
          end: ex.end || '',
          location: ex.location || c.location || ''
        });
      });
    });
    return out.sort(function (a, b) {
      return (a.start || '99:99') < (b.start || '99:99') ? -1 : 1;
    });
  },

  /** 某一周内的考试（课程表用） */
  examsOfWeek: function (weekNo) {
    var start = this.weekStartDate(weekNo);
    var out = [];
    for (var i = 0; i < 7; i++) {
      var d = DateUtil.addDays(start, i);
      var ds = DateUtil.toStr(d);
      this.examsOf(ds).forEach(function (e) {
        out.push(Object.assign({ date: ds, day: i + 1 }, e));
      });
    }
    return out;
  },

  /**
   * 考试及格线风险评估：根据该课程已录入的平时成绩分项，计算期末剩余权重需考多少分才能总评 ≥ 60。
   * @returns {{ scored: boolean, partial?: number, weightDone?: number, weightLeft?: number, needFor60?: number, status?: string }}
   */
  examRiskOf: function (course) {
    if (!course || !course.name) return { scored: false };
    var sid = course.semesterId || Store.state.currentSemesterId;
    var rec = this.gradeRecord(sid, 'c:' + course.name, course.id);
    if (!rec || !rec.root || !Array.isArray(rec.root.children) || !rec.root.children.length) {
      return { scored: false };
    }
    var chs = rec.root.children;
    var totalW = 0, doneW = 0, weightedEarned = 0;
    var self = this;
    chs.forEach(function (ch) {
      var w = Math.max(0, Number(ch.weight) || 0);
      totalW += w;
      var v = self.computeGrade(ch);
      if (v != null) {
        doneW += w;
        weightedEarned += v * w;
      }
    });
    if (totalW <= 0 || doneW <= 0) return { scored: false };
    var partial = Math.round((weightedEarned / doneW) * 10) / 10;
    var normDoneW = Math.round((doneW / totalW) * 100);
    var normLeftW = Math.max(0, 100 - normDoneW);
    if (normLeftW <= 0) {
      return {
        scored: true,
        partial: partial,
        weightDone: 100,
        weightLeft: 0,
        needFor60: 0,
        status: partial >= 60 ? 'safe' : 'impossible'
      };
    }
    var earnedPoints = partial * (normDoneW / 100);
    var needRaw = (60 - earnedPoints) / (normLeftW / 100);
    var needFor60 = Math.max(0, Math.ceil(needRaw));
    var status = needFor60 > 100 ? 'impossible'
      : (needFor60 >= 75 ? 'hard'
      : (needFor60 >= 55 ? 'warn' : 'safe'));
    return {
      scored: true,
      partial: partial,
      weightDone: normDoneW,
      weightLeft: normLeftW,
      needFor60: needFor60,
      status: status
    };
  },

  /* ==========================================================
   * 成绩
   * ========================================================== */
  /** 默认成绩结构：总评 = 平时 40% + 期末 60%（可任意增删嵌套） */
  defaultGradeTree: function () {
    return {
      id: ctx.uid('g'), name: '总评', weight: 100, score: null,
      children: [
        { id: ctx.uid('g'), name: '平时', weight: 40, score: null, children: [] },
        { id: ctx.uid('g'), name: '期末', weight: 60, score: null, children: [] }
      ]
    };
  },

  /**
   * 递归算得分
   * 叶子：直接取填写的分数
   * 父项：把已填写的子项按权重归一化后加权（没填的不拉低）
   */
  computeGrade: function (node, rec) {
    if (!node) return null;
    if (node.children && node.children.length) {
      var sum = 0, w = 0, any = false;
      node.children.forEach(function (ch) {
        var v = Store.computeGrade(ch, rec);
        if (v != null) {
          var cw = Math.max(0, Number(ch.weight) || 0);
          sum += v * cw;
          w += cw;
          any = true;
        }
      });
      if (!any) return null;
      return w > 0 ? Math.round(sum / w * 100) / 100 : null;
    }
    // 自动分项（默认关闭，设置里开启后才生效）
    if (node.source === 'attendance') {
      if (!(Store.settings && Store.settings.gradeAutoAttendance)) return null;
      if (!rec || !rec.courseId || !Store.attendanceStats) return null;
      var att = Store.attendanceStats(rec.courseId);
      return (att && att.rate != null) ? att.rate : null;
    }
    if (node.source === 'tasks') {
      if (!(Store.settings && Store.settings.gradeAutoTasks)) return null;
      return Store.taskCompletionScore ? Store.taskCompletionScore(node, rec) : null;
    }
    if (node.score == null || node.score === '') return null;
    var n = Number(node.score);
    return isNaN(n) ? null : n;
  },

  /**
   * 自动检索并校验成绩构成树中各层子成绩占比之和是否等于母值（100% 或父节点自身权重）
   * @param {Object} rootNode 成绩构成根节点
   * @returns {{ valid: boolean, allStrict100: boolean, issues: Array, groups: Array }}
   */
  validateGradeWeights: function (rootNode) {
    var issues = [];
    var groups = [];
    function checkNode(node, depth, isRoot) {
      if (!node || !Array.isArray(node.children) || !node.children.length) return;
      var sum = 0;
      node.children.forEach(function (ch) {
        var w = Number(ch && ch.weight);
        if (!isNaN(w) && w > 0) sum += w;
      });
      sum = Math.round(sum * 100) / 100;
      var parentW = isRoot ? 100 : (Number(node.weight) > 0 ? Number(node.weight) : 100);
      var match100 = Math.abs(sum - 100) <= 0.15;
      var matchParent = !isRoot && parentW !== 100 && Math.abs(sum - parentW) <= 0.15;
      var ok = match100 || matchParent;
      var diff100 = Math.round((sum - 100) * 100) / 100;
      var diffParent = Math.round((sum - parentW) * 100) / 100;
      var info = {
        nodeId: node.id || '',
        nodeName: node.name || (isRoot ? '总评' : '分项'),
        depth: depth,
        isRoot: !!isRoot,
        childCount: node.children.length,
        sumWeight: sum,
        parentWeight: parentW,
        expected: 100,
        match100: match100,
        matchParent: matchParent,
        ok: ok,
        diff100: diff100,
        diffParent: diffParent,
        message: match100
          ? ('「' + (node.name || '总评') + '」子项占比合计 100%')
          : (matchParent
            ? ('「' + (node.name || '分项') + '」子项占比合计 ' + sum + '%（等于母项占比 ' + parentW + '%，已自动按相对比例折算）')
            : ('「' + (node.name || '总评') + '」子项占比合计 ' + sum + '%，不等于母值 ' + (isRoot ? '100%' : ('100%（或母项占比 ' + parentW + '%）')) + '（差 ' + (diff100 > 0 ? '+' + diff100 : diff100) + '%）'))
      };
      groups.push(info);
      if (!ok) issues.push(info);
      node.children.forEach(function (ch) {
        checkNode(ch, depth + 1, false);
      });
    }
    if (rootNode) checkNode(rootNode, 0, true);
    return {
      valid: issues.length === 0,
      allStrict100: groups.every(function (g) { return g.match100; }),
      issues: issues,
      groups: groups
    };
  },

  /**
   * 将某个父节点的直属子项权重自动配平为 targetSum（默认 100）
   */
  normalizeGradeWeights: function (node, targetSum) {
    if (!node || !Array.isArray(node.children) || !node.children.length) return node;
    var target = Number(targetSum) > 0 ? Number(targetSum) : 100;
    var n = node.children.length;
    var sum = 0;
    node.children.forEach(function (ch) {
      var w = Number(ch && ch.weight);
      if (!isNaN(w) && w > 0) sum += w;
    });
    var acc = 0;
    node.children.forEach(function (ch, idx) {
      if (idx === n - 1) {
        ch.weight = Math.max(0, Math.round((target - acc) * 10) / 10);
      } else {
        var raw = sum > 0 ? ((Math.max(0, Number(ch.weight) || 0) / sum) * target) : (target / n);
        var val = Math.round(raw * 10) / 10;
        ch.weight = val;
        acc += val;
      }
    });
    return node;
  },

  /** 规范化成绩树结构（兜底缺失 id、weight、score、children） */
  sanitizeGradeTree: function (node, isRoot) {
    if (!node || typeof node !== 'object') return isRoot ? this.defaultGradeTree() : null;
    var self = this;
    var w = Number(node.weight);
    var sc = (node.score === '' || node.score == null) ? null : Number(node.score);
    var kids = Array.isArray(node.children)
      ? node.children.map(function (ch) { return self.sanitizeGradeTree(ch, false); }).filter(Boolean)
      : [];
    return {
      id: node.id || ctx.uid('g'),
      name: String(node.name != null ? node.name : (isRoot ? '总评' : '分项')).trim() || (isRoot ? '总评' : '分项'),
      weight: isRoot ? 100 : (isNaN(w) ? 0 : Math.max(0, Math.min(100, Math.round(w * 100) / 100))),
      score: (sc == null || isNaN(sc)) ? null : Math.round(sc * 100) / 100,
      children: kids
    };
  },

  /** 某学期的成绩条目：填了学分的课程自动进来 + 手动添加的课程 */
  gradeList: function (semesterId, includeZeroCreditCourses) {
    var sid = semesterId || Store.state.currentSemesterId;
    var manual = Store.state.grades[sid] || {};
    var out = [], hasKey = {}, hasCourseId = {}, hasCourseName = {};
    Object.keys(manual).forEach(function (k) {
      var r = manual[k];
      if (!r || typeof r !== 'object') return;
      if (!r.key) r.key = k;
      // 若关联了课表课程，自动同步最新学分与考试时间兜底
      var linkedCourse = null;
      if (r.courseId) {
        linkedCourse = Store.state.courses.filter(function (c) { return c.id === r.courseId; })[0] || null;
      }
      if (!linkedCourse && r.name) {
        linkedCourse = Store.state.courses.filter(function (c) { return c.semesterId === sid && c.name === r.name; })[0] || null;
      }
      if (linkedCourse) {
        if (!r.courseId) r.courseId = linkedCourse.id;
        if (!(Number(r.credit) > 0) && Number(linkedCourse.credit) > 0) r.credit = Number(linkedCourse.credit);
        if (!r.exam && linkedCourse.exam) r.exam = linkedCourse.exam;
        hasCourseId[linkedCourse.id] = 1;
        hasCourseName[linkedCourse.name] = 1;
      }
      out.push(r);
      hasKey[r.key] = 1;
      if (r.name) hasCourseName[r.name] = 1;
    });
    var seen = {};
    Store.state.courses.forEach(function (c) {
      if (c.semesterId !== sid || !c.name) return;
      if (!includeZeroCreditCourses && !(c.credit > 0)) return;
      if (seen[c.name]) return;              // 同一门课排好几节，只算一门
      seen[c.name] = 1;
      var key = 'c:' + c.name;
      if (hasKey[key] || hasCourseId[c.id] || hasCourseName[c.name]) return; // 已经录过分了
      out.push({
        key: key, source: 'course', courseId: c.id,
        name: c.name, credit: Number(c.credit) || 0,
        root: null, exam: c.exam || null
      });
    });
    return out.sort(function (a, b) {
      return String(a.name) < String(b.name) ? -1 : 1;
    });
  },

  gradeRecord: function (semesterId, key, courseId) {
    var sid = semesterId || Store.state.currentSemesterId;
    var map = Store.state.grades[sid] || {};
    if (key && map[key]) return map[key];
    var candidates = [];
    var self = this;
    Object.keys(map).forEach(function (k) {
      var r = map[k];
      if (!r) return;
      if (key && (r.key === key || k === key)) candidates.push(r);
      else if (courseId && r.courseId === courseId) candidates.push(r);
      else if (key && key.indexOf('c:') === 0 && r.name === key.slice(2)) candidates.push(r);
    });
    if (!candidates.length) return null;
    // 优先返回具有具体成绩构成结构（或已有得分）的有效记录，避免空壳记录覆盖
    for (var i = 0; i < candidates.length; i++) {
      var cr = candidates[i];
      if (self.hasGradeStructure && self.hasGradeStructure(cr)) return cr;
    }
    return candidates[0];
  },

  saveGrade: function (semesterId, rec) {
    var sid = semesterId || Store.state.currentSemesterId;
    if (!Store.state.grades[sid]) Store.state.grades[sid] = {};
    var gmap = Store.state.grades[sid];
    var cleanRoot = rec.root ? this.sanitizeGradeTree(rec.root, true) : this.defaultGradeTree();
    var rName = String(rec.name || '').trim() || '未命名课程';
    // 若关联了课表课程，确保 courseId 同步匹配
    if (!rec.courseId && rName) {
      var matchC = Store.state.courses.filter(function (c) { return c.semesterId === sid && c.name === rName; })[0];
      if (matchC) rec.courseId = matchC.id;
    }
    var saveKey = rec.key || ('c:' + rName);
    // 若之前存在同 courseId 或同名课程的旧 key（例如课程改名或 manual 转 course），清理旧 key 防止重复出现两条
    Object.keys(gmap).forEach(function (k) {
      if (k !== saveKey) {
        var gr = gmap[k];
        if (gr) {
          if (rec.courseId && gr.courseId === rec.courseId) delete gmap[k];
          else if (rName && gr.name === rName && (k.indexOf('c:') === 0 || saveKey.indexOf('c:') === 0)) delete gmap[k];
        }
      }
    });
    var saved = {
      key: saveKey,
      source: rec.source || (rec.courseId ? 'course' : 'manual'),
      courseId: rec.courseId || '',
      name: rName,
      credit: Math.max(0, Number(rec.credit) || 0),
      root: cleanRoot,
      // 计分方式：percent（默认，走成绩构成树）/ level（五级制）/ pass（通过制）
      scale: rec.scale === 'level' || rec.scale === 'pass' ? rec.scale : 'percent',
      level: rec.scale === 'level' ? String(rec.level || 'B') : '',
      passed: rec.scale === 'pass' ? (rec.passed !== false) : undefined,
      exam: rec.exam || null,
      updatedAt: new Date().toISOString()
    };
    // 同步回写关联的课表全部同名/同ID课程（学分、名称），避免课表旧学分覆盖或未填学分课程无法在成绩汇总生效
    Store.state.courses.forEach(function (c) {
      if (c.semesterId !== sid) return;
      if ((saved.courseId && c.id === saved.courseId) || (!saved.courseId && c.name === saved.name) || (saved.name && c.name === saved.name)) {
        if (!saved.courseId) saved.courseId = c.id;
        if (Number(saved.credit) > 0) c.credit = Number(saved.credit);
        if (saved.name) c.name = saved.name;
      }
    });
    gmap[saveKey] = saved;
    this.bumpUsage('grade');
    this.settleKRs();
    this.settleGoals();
    this.lastGradeGoalSync = this.syncGradeToGoals(sid);
    this.emit();
    this.save(true);
    return saved;
  },

  /** 判断一条成绩记录是否已配置了自定义成绩构成或等级/通过制（即使尚未录入具体小分也应保留） */
  hasGradeStructure: function (gr) {
    if (!gr || typeof gr !== 'object') return false;
    if (gr.scale === 'level' || gr.scale === 'pass') return true;
    if (!gr.root || !Array.isArray(gr.root.children) || !gr.root.children.length) return false;
    return true;
  },

  removeGrade: function (semesterId, key) {
    var sid = semesterId || Store.state.currentSemesterId;
    if (Store.state.grades[sid]) delete Store.state.grades[sid][key];
    this.settleKRs();
    this.lastGradeGoalSync = this.syncGradeToGoals(sid);
    this.emit();
  },

  /** 成绩变动后实时联动检查「学期 GPA」类型的目标关键结果 */
  syncGradeToGoals: function (semesterId) {
    var sid = semesterId || Store.state.currentSemesterId;
    var gsum = this.gradeSummary([sid]);
    var matched = [];
    var todayStr = DateUtil.toStr(DateUtil.today());
    var self = this;
    (Store.state.goals || []).forEach(function (g) {
      if (!g || !goalActive(g, todayStr)) return;
      var ctx = self.goalCtx(g);
      (g.krs || []).forEach(function (kr) {
        if (!kr || kr.kind !== 'grade') return;
        var kSid = kr.semesterId || Store.state.currentSemesterId;
        if (kSid && kSid !== sid) return;
        var r = krProgress(kr, ctx);
        matched.push({
          goalId: g.id,
          goalTitle: g.title,
          krId: kr.id,
          krTitle: kr.title,
          targetGpa: Number(kr.target) || 0,
          currentGpa: gsum.gpa,
          pct: r.pct != null ? Math.round(r.pct * 100) : null,
          reached: r.pct != null && r.pct >= 1
        });
      });
    });
    return {
      semesterId: sid,
      gpa: gsum.gpa,
      avg: gsum.avg,
      gradedCredits: gsum.gradedCredits,
      matchedKRs: matched
    };
  },

  /* ==========================================================
   * 收藏：每日一句 / 每日一词
   * ========================================================== */
  fav: function () {
    var f = (Store.state.settings && Store.state.settings.fav) || null;
    if (!f || typeof f !== 'object') f = { poems: [], words: [] };
    if (!Array.isArray(f.poems)) f.poems = [];
    if (!Array.isArray(f.words)) f.words = [];
    Store.state.settings.fav = f;
    return f;
  },

  isFavPoem: function (idx) { return this.fav().poems.indexOf(Number(idx)) >= 0; },

  isFavWord: function (w) { return this.fav().words.indexOf(String(w)) >= 0; },

  /** @returns {boolean} true = 加入收藏，false = 取消收藏 */
  toggleFavPoem: function (idx) {
    var f = this.fav();
    var n = Number(idx);
    var i = f.poems.indexOf(n);
    if (i >= 0) f.poems.splice(i, 1);
    else f.poems.unshift(n);
    this.emit();
    return i < 0;
  },

  toggleFavWord: function (w) {
    var f = this.fav();
    var k = String(w);
    var i = f.words.indexOf(k);
    if (i >= 0) f.words.splice(i, 1);
    else f.words.unshift(k);
    this.emit();
    return i < 0;
  },

  /** 收藏的诗词（索引 → 内容） */
  favPoems: function () {
    if (!global.Daily && typeof global.__cpLoadDaily === 'function') global.__cpLoadDaily();
    var list = (global.Daily && Daily.poems) || [];
    var out = [];
    this.fav().poems.forEach(function (i) {
      var p = list[i];
      if (p) out.push({ idx: i, item: p });
    });
    return out;
  },

  /** 收藏的单词（按词形查回完整释义） */
  favWords: function () {
    if (!global.Daily && typeof global.__cpLoadDaily === 'function') global.__cpLoadDaily();
    var list = (global.Daily && Daily.words) || [];
    var map = {};
    list.forEach(function (w, i) { if (!map[w.w]) map[w.w] = { idx: i, item: w }; });
    var out = [];
    this.fav().words.forEach(function (k) {
      out.push(map[k] || { idx: -1, item: { w: k, def: '' } });
    });
    return out;
  },

  /** 首页每日卡片的显示开关 */
  dailyOn: function (which) {
    var nav = Store.state.settings.nav || {};
    var v = nav['daily' + (which === 'word' ? 'Word' : 'Poem')];
    return v == null ? true : !!v;
  },

  setDailyOn: function (which, on) {
    var patch = {};
    patch['daily' + (which === 'word' ? 'Word' : 'Poem')] = !!on;
    Object.assign(Store.state.settings.nav, patch);
    this.emit();
  },

  /* ==========================================================
   * GPA 换算规则
   * ========================================================== */
  /** 常见的标准分段（≥90 满分绩点，往下每档递减） */
  defaultGpaRules: function () {
    return [
      { min: 90, gp: 4 }, { min: 85, gp: 3.7 }, { min: 82, gp: 3.3 },
      { min: 78, gp: 3 }, { min: 75, gp: 2.7 }, { min: 72, gp: 2.3 },
      { min: 68, gp: 2 }, { min: 64, gp: 1.5 }, { min: 60, gp: 1 },
      { min: 0, gp: 0 }
    ];
  },

  /** 常见换算方案（rules 按分数下限由高到低排列） */
  GPA_PRESETS: [
    {
      key: 'std4', name: '4.0 制（标准）', scale: 4,
      rules: null        // null = 用 defaultGpaRules()
    },
    {
      key: 'pk4', name: '4.0 制（分段更细）', scale: 4,
      rules: [
        { min: 95, gp: 4 }, { min: 90, gp: 3.9 }, { min: 85, gp: 3.6 },
        { min: 80, gp: 3.2 }, { min: 75, gp: 2.7 }, { min: 70, gp: 2.2 },
        { min: 65, gp: 1.7 }, { min: 60, gp: 1.2 }, { min: 0, gp: 0 }
      ]
    },
    {
      key: 'std5', name: '5.0 制', scale: 5,
      rules: [
        { min: 90, gp: 5 }, { min: 85, gp: 4.5 }, { min: 82, gp: 4.2 },
        { min: 78, gp: 3.8 }, { min: 75, gp: 3.5 }, { min: 72, gp: 3.2 },
        { min: 68, gp: 2.8 }, { min: 64, gp: 2.4 }, { min: 60, gp: 2 },
        { min: 0, gp: 0 }
      ]
    },
    {
      key: 'lin4', name: '4.0 制（线性：分数÷100×4）', scale: 4, linear: true, rules: []
    },
    {
      key: 'lin5', name: '5.0 制（线性：分数÷100×5）', scale: 5, linear: true, rules: []
    }
  ],

  /** 当前 GPA 规则（含合法性兜底） */
  gpaConfig: function () {
    var ds = ctx.defaultState();
    var g = (Store.state.settings && Store.state.settings.gpa) || ds.settings.gpa;
    var rules = (Array.isArray(g.rules) && g.rules.length) ? g.rules : Store.defaultGpaRules();
    rules = rules.map(function (r) {
      return { min: Number(r.min) || 0, gp: Number(r.gp) || 0 };
    }).sort(function (a, b) { return b.min - a.min; });
    return {
      scale: Number(g.scale) > 0 ? Number(g.scale) : 4,
      linear: !!g.linear,
      rules: rules
    };
  },

  /** 保存 GPA 规则 */
  setGpaConfig: function (data) {
    if (!Store.state.settings.gpa) Store.state.settings.gpa = {};
    var cfg = this.gpaConfig();
    var next = {
      scale: data.scale != null ? Math.max(0.1, Number(data.scale) || 4) : cfg.scale,
      linear: data.linear != null ? !!data.linear : cfg.linear,
      rules: data.rules ? data.rules.slice() : cfg.rules
    };
    Store.state.settings.gpa = next;
    this.emit();
    return next;
  },

  /** 分数 → 绩点；没有成绩返回 null */
  gpaOf: function (score) {
    if (score == null || isNaN(score)) return null;
    var cfg = this.gpaConfig();
    var s = Math.max(0, Math.min(100, Number(score)));
    if (cfg.linear) return Math.round(s / 100 * cfg.scale * 100) / 100;
    for (var i = 0; i < cfg.rules.length; i++) {
      if (s >= cfg.rules[i].min) return cfg.rules[i].gp;
    }
    return 0;
  },

  /** 等级制换算表（设置里没自定义就用默认五级制） */
  gradeLevels: function () {
    var g = (Store.state && Store.state.settings && Store.state.settings.gpa) || {};
    var list = Array.isArray(g.levelRules) && g.levelRules.length ? g.levelRules : GPA_LEVEL_RULES;
    return list.map(function (r) {
      return {
        key: String(r.key || 'A'),
        name: String(r.name || r.key || ''),
        score: Math.max(0, Math.min(100, Number(r.score) || 0)),
        gp: Math.max(0, Number(r.gp) || 0)
      };
    });
  },

  gradeLevel: function (key) {
    var list = this.gradeLevels();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0];
  },

  /**
   * 一条成绩记录的展示口径（百分制 / 等级制 / 通过制统一入口）。
   * @returns {{scale, score:number|null, gp:number|null, label:string}}
   */
  gradeScoreOf: function (rec) {
    if (!rec) return { scale: 'percent', score: null, gp: null, label: '' };
    if (rec.scale === 'level') {
      var lv = this.gradeLevel(rec.level);
      return { scale: 'level', score: lv.score, gp: lv.gp, label: lv.name };
    }
    if (rec.scale === 'pass') {
      var ok = rec.passed !== false;
      return { scale: 'pass', score: null, gp: null, label: ok ? '通过' : '未通过' };
    }
    var sc = rec.root ? this.computeGrade(rec.root, rec) : null;
    return {
      scale: 'percent',
      score: sc, gp: sc == null ? null : this.gpaOf(sc),
      label: sc == null ? '' : String(Math.round(sc * 10) / 10)
    };
  },

  /**
   * 汇总若干学期的成绩
   * @param {string[]} semesterIds
   * @param {Array} [overrides] 可选：模拟用覆盖 [{semesterId, key, score}]，
   *        命中则用 score 替换该门课的实际成绩（不写回数据，仅供 what-if 预览）
   * @returns { count, scored, credits, creditsScored, weighted, average, gpa }
   */
  gradeSummary: function (semesterIds, overrides) {
    var self = this;
    var ids = semesterIds || [Store.state.currentSemesterId];
    var ov = {};
    (overrides || []).forEach(function (o) {
      if (o && o.key) ov[o.semesterId + '\u0000' + o.key] = o.score;
    });
    var list = [];
    ids.forEach(function (sid) {
      self.gradeList(sid).forEach(function (r) {
        var disp = self.gradeScoreOf(r);
        var score = disp.score;
        var gp = disp.gp;
        var mk = sid + '\u0000' + r.key;
        // what-if 覆盖的是分数，绩点必须跟着重算——否则 100 分的假设仍会用旧绩点，
        // 「整体 GPA 会变成多少」就是假数字（verify_grade_whatif 守着这条）。
        if (Object.prototype.hasOwnProperty.call(ov, mk)) {
          score = ov[mk];
          gp = self.gpaOf(score);
        }
        list.push({
          name: r.name,
          credit: Number(r.credit) || 0,
          score: score,
          gp: gp,
          scale: disp.scale,
          label: disp.label,
          semesterId: sid
        });
      });
    });
    var cr = 0, crEarned = 0, crDone = 0, wsum = 0, sum = 0, n = 0, gsum = 0, gcr = 0;
    list.forEach(function (r) {
      cr += r.credit;
      // 通过/不通过：只计学分，不进 GPA 与加权均分（P/F 课程的通行做法）
      if (r.scale === 'pass') {
        if (r.label === '通过') crEarned += r.credit;
        return;
      }
      if (r.score != null) {
        crEarned += r.credit;
        sum += r.score;
        n++;
        wsum += r.score * r.credit;
        crDone += r.credit;
        var gp = r.gp != null ? r.gp : self.gpaOf(r.score);
        if (gp != null) { gsum += gp * r.credit; gcr += r.credit; }
      }
    });
    return {
      count: list.length,
      scored: n,
      credits: Math.round(cr * 100) / 100,
      creditsEarned: Math.round(crEarned * 100) / 100,
      creditsScored: Math.round(crDone * 100) / 100,
      weighted: crDone > 0 ? Math.round(wsum / crDone * 100) / 100 : null,
      average: n > 0 ? Math.round(sum / n * 100) / 100 : null,
      gpa: gcr > 0 ? Math.round(gsum / gcr * 100) / 100 : null
    };
  },

  getCourse: function (id) {
    for (var i = 0; i < Store.state.courses.length; i++) {
      if (Store.state.courses[i].id === id) return Store.state.courses[i];
    }
    return null;
  },

  /** 课程的时段列表（兼容旧版单时段数据） */
  courseSlots: function (c) {
    if (!c) return [];
    if (c.slots && c.slots.length) return c.slots;
    var cm = c.timeMode === 'custom';
    return [{
      day: c.day || 1,
      timeMode: cm ? 'custom' : 'period',
      periodId: cm ? '' : (c.periodId || ''),
      startTime: cm ? (c.startTime || '') : '',
      endTime: cm ? (c.endTime || '') : '',
      location: c.location || ''
    }];
  },

      /** 根据周次获取课程的多地点轮转教室 */
  courseLocationOnWeek: function (c, week) {
    if (!c) return '';
    if (Array.isArray(c.rotations) && c.rotations.length && typeof week === 'number') {
      for (var i = 0; i < c.rotations.length; i++) {
        var r = c.rotations[i];
        if (week >= r.startWeek && week <= r.endWeek) {
          return r.location || c.location || '';
        }
      }
    }
    return c.location || '';
  },

  /** 根据周次获取实验课程课题名 */
  courseTopicOnWeek: function (c, week) {
    if (!c || !Array.isArray(c.rotations) || !c.rotations.length || typeof week !== 'number') return '';
    for (var i = 0; i < c.rotations.length; i++) {
      var r = c.rotations[i];
      if (week >= r.startWeek && week <= r.endWeek) {
        return r.topic || '';
      }
    }
    return '';
  },
  /** 把一门课按 slots 展开为「伪记录」：courseId 指向父课程，其余字段取各时段（可按周次动态计算轮转教室） */
  expandCourse: function (c, week) {
    var self = this;
    if (!c) return [];
    return this.courseSlots(c).map(function (s) {
      var p = {};
      Object.keys(c).forEach(function (k) { p[k] = c[k]; });
      p.courseId = c.id;
      p._slot = s;
      p.day = s.day || 1;
      p.timeMode = s.timeMode === 'custom' ? 'custom' : 'period';
      p.periodId = s.timeMode === 'custom' ? '' : (s.periodId || '');
      p.startTime = s.timeMode === 'custom' ? (s.startTime || '') : '';
      p.endTime = s.timeMode === 'custom' ? (s.endTime || '') : '';
      p.location = s.location || c.location || '';
      if (typeof week === 'number') {
        var rotLoc = self.courseLocationOnWeek(c, week);
        if (rotLoc) p.location = rotLoc;
        var topic = self.courseTopicOnWeek(c, week);
        if (topic) p.topic = topic;
      }
      return p;
    });
  },

  getPeriod: function (id) {
    for (var i = 0; i < Store.state.periods.length; i++) {
      if (Store.state.periods[i].id === id) return Store.state.periods[i];
    }
    return null;
  },

  periodIndex: function (id) {
    for (var i = 0; i < Store.state.periods.length; i++) {
      if (Store.state.periods[i].id === id) return i;
    }
    return -1;
  },

  /** 某周的课表数据：返回 'day|periodId' = [伪记录]（一门课的多时段会展开） */
  weekMatrix: function (weekNo) {
    var map = {};
    var sid = Store.state.currentSemesterId;
    Store.state.courses.forEach(function (c) {
      if (c.semesterId && c.semesterId !== sid) return;
      if (!Store.courseInWeek(c, weekNo)) return;
      Store.expandCourse(c, weekNo).forEach(function (p) {
        if ((p.timeMode || 'period') === 'custom') return; // 自定义时间由 customAt 处理
        var key = p.day + '|' + p.periodId;
        (map[key] = map[key] || []).push(p);
      });
    });
    return map;
  },


  /* ===== 单次调课例外（停课 / 换教室 / 调课） =====
   * 周历回答「这门课一般什么时候上」，例外回答「那一天到底上不上、在哪上」。
   * 判定逻辑在 course-exception.js（纯模块），这里只管存取与拼装。 */

  /** 某天的实际课表：基础周历 + 例外（去掉停课/调走的，换教室的带 _exRoom，
   *  调进来的以原课程为模板带 _moveIn/_moveFrom）。今天显示、提醒、统计、
   *  月历时间带全部走这里，别再用 coursesOnDay 直接当日历用。 */
  coursesOnDate: function (dateStr) {
    var d = DateUtil.parse(dateStr);
    if (!d) return [];
    var dow = DateUtil.isoDow(d);
    var base = this.coursesOnDay(dow, this.weekOf(d));
    // 法定放假日停课：规则放在数据层，今日页 / 日历 / 日程 / 提醒 / 小组件才会一致。
    // 调进来的课（moveIns）仍然保留 —— 那是用户显式安排的单次课。
    if (holidayPaused(dateStr)) base = [];
    if (!global.CourseException) return base;
    var out = global.CourseException.dayEffect(base, dateStr, Store.state.courseExceptions).kept;
    var self = this;
    global.CourseException.moveIns(Store.state.courseExceptions, dateStr).forEach(function (e) {
      var src = self.getCourse(e.courseId);
      if (!src) return;
      var inst = {};
      Object.keys(src).forEach(function (k) { inst[k] = src[k]; });
      inst.courseId = src.id;
      inst._slot = null;
      inst.day = dow;
      inst._moveIn = e.id;
      inst._moveFrom = e.date;
      if (e.location) inst.location = e.location;
      if (e.toPeriodId) {
        inst.timeMode = 'period'; inst.periodId = e.toPeriodId;
        inst.startTime = ''; inst.endTime = '';
      } else if (e.toStart) {
        inst.timeMode = 'custom'; inst.startTime = e.toStart;
        inst.endTime = e.toEnd || e.toStart;
      }
      out.push(inst);
    });
    return out.sort(function (a, b) {
      var ta = Store.courseTime(a), tb = Store.courseTime(b);
      return (ta ? ta.start : '99:99') < (tb ? tb.start : '99:99') ? -1 : 1;
    });
  },

  /** 某天被停 / 被调走的课（今日页灰显用，带 _off 与 _moveTo） */
  canceledLessonsOn: function (dateStr) {
    var d = DateUtil.parse(dateStr);
    if (!d || !global.CourseException) return [];
    var base = this.coursesOnDay(DateUtil.isoDow(d), this.weekOf(d));
    return global.CourseException.dayEffect(base, dateStr, Store.state.courseExceptions).removed;
  },

  /** 一门课的全部例外（课程详情弹窗管理用） */
  lessonExceptionsOfCourse: function (courseId) {
    return (Store.state.courseExceptions || []).filter(function (e) { return e.courseId === courseId; });
  },

  /** 写入一条例外；同一门课同一天只留一条（后写的覆盖先写的） */
  addCourseException: function (data) {
    if (!data || !data.courseId || !data.date) return null;
    var type = data.type === 'room' || data.type === 'move' ? data.type : 'cancel';
    Store.state.courseExceptions = (Store.state.courseExceptions || []).filter(function (e) {
      return !(e.courseId === data.courseId && e.date === data.date);
    });
    var ex = {
      id: ctx.uid('cex'),
      courseId: data.courseId,
      date: data.date,
      type: type,
      location: (data.location || '').trim(),
      toDate: data.toDate || '',
      toPeriodId: data.toPeriodId || '',
      toStart: data.toStart || '',
      toEnd: data.toEnd || '',
      createdAt: new Date().toISOString()
    };
    Store.state.courseExceptions.push(ex);
    this.emit();
    return ex;
  },

  removeCourseException: function (id) {
    Store.state.courseExceptions = (Store.state.courseExceptions || []).filter(function (e) { return e.id !== id; });
    this.emit();
  },

  /**
   * 考后复盘：最近 3 天结束的考试，各生成一条「复盘」待办。
   * 同一个考试只生成一次，记录在 settings.examReviewDone 里——删掉待办也不会重生。
   * @returns {number} 本次新建的条数
   */
  syncExamReviews: function () {
    if (typeof this.addTask !== 'function' || typeof this.courseExamList !== 'function') return 0;
    var st = Store.state;
    if (!st.settings) st.settings = {};
    var done = st.settings.examReviewDone;
    if (!done || typeof done !== 'object' || Array.isArray(done)) {
      done = {};
      st.settings.examReviewDone = done;
    }
    var today = DateUtil.toStr(DateUtil.today());
    var cutoff = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -3));
    var self = this;
    var created = 0;
    (this.courses || []).forEach(function (c) {
      var exams = [];
      try { exams = self.courseExamList(c) || []; } catch (e) { exams = []; }
      exams.forEach(function (ex) {
        if (!ex || !ex.date) return;
        if (ex.date >= today || ex.date < cutoff) return;
        var key = c.id + '|' + ex.date + '|' + (ex.label || '期末考试');
        if (done[key]) return;
        done[key] = 1;
        var label = (ex.label && ex.label !== '期末考试') ? ex.label : '考试';
        var t = self.addTask({
          title: '复盘：' + (c.name || '课程') + ' ' + label,
          courseId: c.id,
          dueDate: today,
          note: '考完了，花 5 分钟记一下：哪些真会、哪些是蒙的、下次怎么复习。',
          tags: ['学习/' + (c.name || '课程')]
        });
        if (t) created++;
      });
    });
    if (created) this.save();
    return created;
  },
  });
})(window);
