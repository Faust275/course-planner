/* ==========================================================
 * Store 导入导出域（v1.4.11 从 store.js 拆出）
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
  var SCHEMA_VERSION = ctx.SCHEMA_VERSION;
  var stripKeys = ctx.stripKeys;
  var safeImportState = ctx.safeImportState;
  var diffStates = ctx.diffStates;
  var diffLines = ctx.diffLines;
  var inspectImport = ctx.inspectImport;
  var statutoryHoliday = ctx.statutoryHoliday;
  var holidayPaused = ctx.holidayPaused;

  Object.assign(Store, {
  /* ===== 导入导出 ===== */
  /**
   * 导出为 JSON 字符串。
   *
   * 同步码只有**两档**，且两档都**不含日记**：
   *   - 'lite'     : 只带课表相关（学期 / 课程 / 时段），用于「只搬课表」的最小同步码
   *   - 'standard' : 除日记与自定义图片外的全部数据
   *
   * 为什么日记不走同步码：
   *   日记是最私密的内容，而同步码要经过剪贴板、聊天工具、备忘录来回搬运，
   *   中途被谁看到无从控制。日记只走「文件备份 / 恢复」，那个通道本来就是你自己的文件。
   *
   * @param {string} [scope='full'] 导出档位。'full' 仅用于本地备份（含图片与日记），
   *   不再作为同步码档位暴露给用户；老版本的 full 码仍能被 importJSON 识别。
   */
  SCHEMA_VERSION: SCHEMA_VERSION,
  /** 法定放假日信息（没有则 null）；给视图层做「今天放假」提示用。 */
  holidayOf: statutoryHoliday,
  /** 该日是否按停课处理（受设置 pauseOnHoliday 控制）。 */
  holidayPaused: holidayPaused,

  /**
   * 备份版本兼容与数据新鲜度校验：
   * 检查备份文件的 schema 版本是否与当前应用兼容（识别旧版自动升级 / 高版本降级风险），
   * 并扫描本机数据与备份数据的时间戳，识别「误用旧备份覆盖本机新数据」的高危场景。
   */
  validateBackupVersion: function (input) {
    var obj = typeof input === 'string' ? JSON.parse(input) : input;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('数据格式不正确');
    }
    var hasRawVer = obj.version !== undefined && obj.version !== null && obj.version !== '';
    var srcVer = hasRawVer ? Number(obj.version) : 1;
    if (isNaN(srcVer) || srcVer < 1) srcVer = 1;
    var curVer = SCHEMA_VERSION;
    var status = 'compatible';
    var label = 'v' + curVer + ' 结构兼容';
    if (srcVer > curVer) {
      status = 'newer_version';
      label = '⚠️ 备份来自更高版本 (v' + srcVer + ' > 当前 v' + curVer + ')，强行恢复可能丢失新版本字段';
    } else if (srcVer < curVer) {
      status = 'upgrade';
      label = '🔄 旧版备份 (v' + srcVer + ' → v' + curVer + ')，恢复时将自动升级数据结构';
    }
    return {
      sourceVersion: srcVer,
      currentVersion: curVer,
      compatible: srcVer <= curVer,
      needsMigration: srcVer < curVer,
      isNewer: srcVer > curVer,
      status: status,
      label: label,
      exportedAt: obj.exportedAt || '',
      exportScope: obj.exportScope || 'full'
    };
  },

  exportJSON: function (scope, opts) {
    var s = scope || 'full';
    var withKeys = !!(opts && opts.includeKeys);
    var nowIso = new Date().toISOString();
    if (s === 'full') {
      var full = JSON.parse(JSON.stringify(Store.state));
      full.version = SCHEMA_VERSION;
      full.exportedAt = nowIso;
      delete full.sleepSession;   // 进行中的计时是临时状态，不写进备份
      // 密钥默认不带走：备份文件常被存网盘 / 发给别人，泄露会被盗刷，
      // 而重填一次的成本极低。只有不离开本机的自动备份才显式传 includeKeys。
      if (!withKeys) stripKeys(full);
      return JSON.stringify(full, null, 2);
    }

    var out = JSON.parse(JSON.stringify(Store.state));
    out.version = SCHEMA_VERSION;
    out.exportedAt = nowIso;
    delete out.sleepSession;

    // 两档都不带自定义图片：图片 base64 会撑爆同步码，且换设备本就要重选图
    if (out.settings) {
      if (out.settings.background) out.settings.background.dataUrl = '';
      if (out.settings.pet) out.settings.pet.src = '';
      // 密钥属于本机凭据，不随同步码外传
      stripKeys(out);
    }
    // 日记一律不进同步码。用 delete 而不是置空数组：
    // 置空会在导入端被当成「对方没有日记」而覆盖掉本机已有的日记
    delete out.diaries;
    // 归档区不进同步码：它只是历史沉淀，换设备不需要搬；完整备份仍然带走
    delete out.taskArchive;

    if (s === 'standard') {
      out.exportScope = 'standard';
      return JSON.stringify(out, null, 2);
    }

    // lite：只留课表骨架，其余清空（保留空结构，方便导入端直接覆盖）
    var empty = ctx.defaultState();
    out.tasks = [];      out.taskSeq = {};   out.courseLogs = [];
    out.plans = [];      out.goals = [];     out.ledger = [];      out.notes = [];
    out.events = [];     out.activities = [];  out.meals = [];   out.sleeps = [];
    out.metrics = [];    out.workouts = [];    out.weightLog = [];   out.sleepOnsets = [];
    out.grades = {};
    out.achievements = { done: {} };
    out.usage = {};
    out.pomodoro = empty.pomodoro;
    // 设置只保留影响课表展示的项
    var keep = ['theme', 'customColor', 'nav', 'navOrder', 'navLayout', 'background'];
    var ns = {};
    keep.forEach(function (k) { if (out.settings && out.settings[k] !== undefined) ns[k] = out.settings[k]; });
    out.settings = Object.assign({}, empty.settings, ns);
    out.exportScope = 'lite';
    return JSON.stringify(out, null, 2);
  },

  /**
   * 合并导入：保留两边独有的数据，只按 updatedAt 决定同一键谁赢。
   * 与 importJSON（整体覆盖）互补——两台设备都改过时，覆盖必然丢东西。
   * @returns {Array<{key,added,replaced,kept}>} 各模块的合并统计
   */
  mergeJSON: function (input) {
    var obj = typeof input === 'string' ? JSON.parse(input) : input;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('数据格式不正确');
    if (!global.ImportSafe) throw new Error('合并模块未加载');
    var stats = global.ImportSafe.applyMerge(Store.state, obj);
    this.save();
    this.emit();
    return stats;
  },

  /** 覆盖前对比：只算不写。返回各模块的增减、「会被清空」清单、版本兼容校验与新旧覆盖预警，供确认弹窗展示 */
  diffImport: function (input) {
    var obj = typeof input === 'string' ? JSON.parse(input) : input;
    var nextState = safeImportState(Store.state, obj);
    var d = diffStates(Store.state, nextState);
    d.versionInfo = this.validateBackupVersion(obj);
    d.invalid = inspectImport(obj);   // 条目级体检：坏记录数（只报告，不改数据）

    // 计算本机与备份的最新记录时间戳，识别「旧备份覆盖本机新数据」风险
    function collectStamps(st) {
      var list = [];
      if (!st || typeof st !== 'object') return list;
      ['courses', 'tasks', 'events', 'plans', 'goals', 'ledger', 'notes', 'diaries', 'activities', 'meals', 'sleeps'].forEach(function (k) {
        var arr = st[k];
        if (!Array.isArray(arr)) return;
        arr.forEach(function (it) {
          if (!it || typeof it !== 'object') return;
          var ts = it.updatedAt || it.doneAt || it.createdAt || it.date || '';
          if (typeof ts === 'string' && ts.length >= 10) list.push(ts);
        });
      });
      return list;
    }
    var localStamps = collectStamps(Store.state);
    var backupStamps = collectStamps(obj);
    if (obj && typeof obj.exportedAt === 'string' && obj.exportedAt) backupStamps.push(obj.exportedAt);
    var localLatest = localStamps.length ? localStamps.slice().sort().pop() : '';
    var backupLatest = backupStamps.length ? backupStamps.slice().sort().pop() : '';
    var newerLocalCount = 0;
    if (backupLatest) {
      localStamps.forEach(function (ts) {
        if (ts > backupLatest) newerLocalCount++;
      });
    }
    var totalGone = d.rows.reduce(function (s, r) { return s + (r.gone || 0); }, 0);
    d.freshness = {
      localLatest: localLatest,
      backupLatest: backupLatest,
      exportedAt: (obj && obj.exportedAt) || '',
      newerLocalCount: newerLocalCount,
      totalGone: totalGone,
      hasNewerLocal: newerLocalCount > 0 || (d.totalBefore > d.totalAfter && totalGone > 0)
    };
    d.lines = diffLines(d);
    return d;
  },

  importJSON: function (text) {
    var obj = JSON.parse(text);
    var prev = Store.state;
    var next = safeImportState(prev, obj);
    // 先挂上再校验（ensure 读的是模块级 Store.state）；校验失败整体回滚，
    // 绝不让半成品状态留下来被 save() 落盘 —— 否则刷新后连启动都过不去。
    ctx.setState(next);
    try {
      this.ensure();
    } catch (e) {
      ctx.setState(prev);
      throw e;
    }
    this.emit();
  },

  exportSkeleton: function () {
    var sem = this.currentSemester ? this.currentSemester() : Store.state.semesters[0];
    var sid = Store.state.currentSemesterId;
    var wtMap = { all: 0, odd: 1, even: 2 };
    var courses = Store.state.courses.filter(function (c) {
      return !c.semesterId || c.semesterId === sid;
    }).map(function (c) {
      var slots = Store.courseSlots(c).map(function (sl) {
        if (sl.timeMode === "custom") {
          return [sl.day || 1, 1, sl.startTime || "", sl.endTime || "", sl.location || ""];
        }
        return [sl.day || 1, 0, sl.periodId || "p1", sl.location || ""];
      });
      var ex = (c.exam && c.exam.date) ? [c.exam.date, c.exam.start || "", c.exam.end || ""] : null;
      var rots = (Array.isArray(c.rotations) && c.rotations.length) ? c.rotations.map(function (r) {
        return [r.startWeek || 1, r.endWeek || 1, r.location || "", r.topic || ""];
      }) : null;
      var item = [
        c.name || "",
        c.teacher || "",
        c.location || "",
        c.color || "#4f46e5",
        c.startWeek || 1,
        c.endWeek || (sem && sem.weeks) || 20,
        wtMap[c.weekType] || 0,
        Number(c.credit) || 0,
        slots
      ];
      if (ex || rots) item.push(ex);
      if (rots) item.push(rots);
      return item;
    });
    var defP = ctx.defaultState().periods || [];
    var isDefP = (Store.state.periods || []).length === defP.length && (Store.state.periods || []).every(function (pr, i) {
      return defP[i] && pr.id === defP[i].id && pr.start === defP[i].start && pr.end === defP[i].end;
    });
    var out = {
      v: 1,
      s: [sem ? sem.name : "当前学期", sem ? sem.startDate : "", sem ? (sem.weeks || 20) : 20],
      c: courses
    };
    if (!isDefP) {
      out.p = (Store.state.periods || []).map(function (pr) {
        return [pr.id, pr.name, pr.start, pr.end];
      });
    }
    return out;
  },

  importSkeleton: function (data, mode) {
    var obj = typeof data === "string" ? JSON.parse(data) : data;
    if (!obj || !Array.isArray(obj.c)) throw new Error("无效的课表二维码数据");
    var wtRev = ["all", "odd", "even"];
    var sid = Store.state.currentSemesterId;
    var sem = this.currentSemester ? this.currentSemester() : Store.state.semesters[0];
    if (obj.s && Array.isArray(obj.s) && sem) {
      if (obj.s[0] && mode === "replace") sem.name = String(obj.s[0]);
      if (obj.s[1] && /^\d{4}-\d{2}-\d{2}$/.test(obj.s[1]) && mode === "replace") sem.startDate = obj.s[1];
      if (obj.s[2] && Number(obj.s[2]) >= 1 && Number(obj.s[2]) <= 36 && mode === "replace") sem.weeks = Number(obj.s[2]);
    }
    if (mode === "replace" && Array.isArray(obj.p) && obj.p.length >= 4) {
      Store.state.periods = obj.p.map(function (pr, idx) {
        return {
          id: String(pr[0] || ("p" + (idx + 1))),
          name: String(pr[1] || ("第" + (idx + 1) + "节")),
          start: String(pr[2] || "08:00"),
          end: String(pr[3] || "08:45")
        };
      });
    }
    if (mode === "replace") {
      Store.state.courses = Store.state.courses.filter(function (c) {
        return c.semesterId && c.semesterId !== sid;
      });
    }
    var added = 0;
    var self = this;
    obj.c.forEach(function (arr) {
      if (!Array.isArray(arr) || !arr[0]) return;
      var slotsRaw = Array.isArray(arr[8]) ? arr[8] : [];
      var slots = slotsRaw.map(function (sr) {
        if (sr[1] === 1) {
          return { day: Number(sr[0]) || 1, timeMode: "custom", startTime: sr[2] || "08:00", endTime: sr[3] || "09:40", location: sr[4] || "" };
        }
        return { day: Number(sr[0]) || 1, timeMode: "period", periodId: sr[2] || "p1", location: sr[3] || "" };
      });
      var exRaw = arr[9];
      var exam = (Array.isArray(exRaw) && exRaw[0]) ? { date: exRaw[0], start: exRaw[1] || "", end: exRaw[2] || "" } : null;
      var rotRaw = arr[10];
      var rotations = Array.isArray(rotRaw) ? rotRaw.map(function (rr) {
        return { startWeek: Number(rr[0]) || 1, endWeek: Number(rr[1]) || 1, location: rr[2] || "", topic: rr[3] || "" };
      }) : [];
      self.addCourse({
        name: String(arr[0]),
        teacher: String(arr[1] || ""),
        location: String(arr[2] || ""),
        color: String(arr[3] || "#4f46e5"),
        startWeek: Number(arr[4]) || 1,
        endWeek: Number(arr[5]) || (sem && sem.weeks) || 20,
        weekType: wtRev[Number(arr[6])] || "all",
        credit: Number(arr[7]) || 0,
        slots: slots,
        exam: exam,
        rotations: rotations
      });
      added++;
    });
    this.save();
    this.emit();
    return { added: added, semesterName: (obj.s && obj.s[0]) || (sem && sem.name) || "当前学期" };
  },

  /* 智能规划、精力节律、冲突检测与守夜自律子域已拆分至 assets/js/store-planner.js */
  reset: function () {
    ctx.setState(ctx.defaultState());
    this.emit();
  }
  });
})(window);
