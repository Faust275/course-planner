/* ==========================================================
 * Store 计划与目标域（v1.4.6 从 store.js 拆出）
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
  var TimeUtil = global.TimeUtil;
  var quotaWindowAt = ctx.quotaWindowAt;
  var quotaIndexOn = ctx.quotaIndexOn;
  var quotaCountIn = ctx.quotaCountIn;
  var quotaStateOf = ctx.quotaStateOf;
  var compareRange = ctx.compareRange;
  var perDay = ctx.perDay;
  var eachDate = ctx.eachDate;
  var goalExpired = ctx.goalExpired;
  var goalActive = ctx.goalActive;
  var krProgress = ctx.krProgress;
  var goalProgress = ctx.goalProgress;
  var goalReviewDue = ctx.goalReviewDue;
  var goalReviewText = ctx.goalReviewText;
  var goalDays = ctx.goalDays;
  var goalPct = ctx.goalPct;
  var normGoal = ctx.normGoal;
  var rev = ctx.rev;
  var rangeStatCache = ctx.rangeStatCache;
  var PLAN_TYPES = ctx.PLAN_TYPES;
  var PLAN_PERIODS = ctx.PLAN_PERIODS;
  var PLAN_LOADS = ctx.PLAN_LOADS;
  var PLAN_EXEMPT_MAX = ctx.PLAN_EXEMPT_MAX;
  var GOAL_MAX_ACTIVE = ctx.GOAL_MAX_ACTIVE;
  var GOAL_GROUPS = ctx.GOAL_GROUPS;
  var KR_KINDS = ctx.KR_KINDS;
  var GOAL_MIN_DAYS = ctx.GOAL_MIN_DAYS;
  var POMO = ctx.POMO;
  var isCheckinLike = ctx.isCheckinLike;
  var tagParts = ctx.tagParts;

  Object.assign(Store, {
  /* ===== 计划 ===== */

  addPlan: function (data) {
    var type = PLAN_TYPES[data.type] ? data.type : 'checkin';
    var period = PLAN_PERIODS[data.period] ? data.period : 'daily';
    if (type === 'quota') {
      // 额度型只按「周 / 月」计，days 表示总周期数
      period = data.period === 'monthly' ? 'monthly' : 'weekly';
    } else if (type !== 'checkin') {
      period = 'once';   // 累加型不按周期
    }
    var start = data.startDate || DateUtil.toStr(DateUtil.today());
    var days = Math.max(1, parseInt(data.days, 10) || (type === 'quota' ? (period === 'monthly' ? 6 : 12) : 21));
    var quotaN = Math.max(1, parseInt(data.quotaN, 10) || 3);
    var unit = (data.unit || '').trim() || (
      type === 'duration' ? '分钟' :
      type === 'quota' ? (period === 'monthly' ? '月' : '周') :
      type === 'checkin' ? (period === 'daily' ? '天' : period === 'weekly' ? '周' : '次') : ''
    );

    // 打卡型与额度型的目标都是「周期数」；累加型用用户填的目标值
    var target = (type === 'checkin' && period !== 'once') || type === 'quota'
      ? days
      : (type === 'checkin' ? 1 : Math.max(1, parseFloat(data.target) || 1));

    var plan = {
      id: ctx.uid('pl'),
      title: (data.title || '').trim() || '未命名计划',
      note: (data.note || '').trim(),
      tags: ctx.normalizeTags(data.tags),
      type: type,
      period: period,
      startDate: start,
      days: days,
      target: target,
      quotaN: type === 'quota' ? quotaN : 0,
      unit: unit,
      color: data.color || '#4f46e5',
      records: [],
      done: false,
      important: !!data.important,
      load: PLAN_LOADS[data.load] ? data.load : '',
      goalId: data.goalId || '',
      krId: data.krId || '',
      exemptDays: [],   // 「今天缓一缓」的日子：不打勾也不算断签
      doneAt: '',
      createdAt: new Date().toISOString()
    };
    Store.state.plans.unshift(plan);
    if (this.markAction) this.markAction('plan', 1);
    this.emit();
    this.save(true);
    return plan;
  },

  updatePlan: function (id, data) {
    var plan = this.getPlan(id);
    if (!plan) return null;
    // 类型变更：旧记录不再适用，清空重来
    if (data.type && data.type !== plan.type) {
      plan.records = [];
      plan.done = false;
      plan.doneAt = '';
    }
    Object.keys(data).forEach(function (k) {
      if (k === 'tags') plan.tags = ctx.normalizeTags(data.tags);
      else if (k === 'days') plan.days = Math.max(1, parseInt(data[k], 10) || plan.days);
      else if (k === 'target') plan.target = Math.max(1, parseFloat(data[k]) || plan.target);
      else if (k === 'quotaN') plan.quotaN = Math.max(1, parseInt(data[k], 10) || plan.quotaN || 1);
      else if (k === 'load') plan.load = PLAN_LOADS[data.load] ? data.load : '';
      else plan[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
    });
    // 打卡型 / 额度型：目标始终跟随周期数
    if (plan.type === 'checkin' && plan.period !== 'once') plan.target = plan.days;
    if (plan.type === 'quota') plan.target = plan.days;
    this.refreshPlanDone(plan);
    this.emit();
    this.save(true);
    return plan;
  },

  removePlan: function (id) {
    Store.state.plans = Store.state.plans.filter(function (x) { return x.id !== id; });
    this.emit();
  },

  getPlan: function (id) {
    for (var i = 0; i < Store.state.plans.length; i++) {
      if (Store.state.plans[i].id === id) return Store.state.plans[i];
    }
    return null;
  },

  activePlans: function () {
    return (Store.state.plans || []).filter(function (p) { return p && !p.done; });
  },

  plansActive: function () {
    return this.activePlans();
  },

  /* ---------------- 目标 ---------------- */
  GOAL_MAX_ACTIVE: GOAL_MAX_ACTIVE,
  GOAL_GROUPS: GOAL_GROUPS,
  KR_KINDS: KR_KINDS,
  // 纯函数也挂到 Store 上：页面直接用，避免再造一份同样的判断
  goalExpired: goalExpired,
  goalActive: goalActive,
  goalReviewDue: goalReviewDue,
  goalReviewText: goalReviewText,
  goalDays: goalDays,
  goalPct: goalPct,
  GOAL_MIN_DAYS: GOAL_MIN_DAYS,

  getGoal: function (id) {
    var list = Store.state.goals || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  },

  /** 在办：没归档、没到期 */
  goalsActive: function () {
    var today = DateUtil.toStr(DateUtil.today());
    return (Store.state.goals || []).filter(function (g) { return goalActive(g, today); });
  },

  /** 留档：手动归档 + 到期没达成的，原样留着，不删不扣分 */
  goalsArchived: function () {
    var today = DateUtil.toStr(DateUtil.today());
    return (Store.state.goals || []).filter(function (g) { return !goalActive(g, today); });
  },

  canAddGoal: function () {
    return this.goalsActive().length < GOAL_MAX_ACTIVE;
  },

  addGoal: function (data) {
    if (!this.canAddGoal()) return null;     // 上限在数据层也拦一道，别只靠界面
    var g = normGoal(data);
    Store.state.goals.unshift(g);
    this.bumpUsage('goal');
    if (this.markAction) this.markAction('goalnew', 1);
    this.emit();
    this.save(true);
    return g;
  },

  updateGoal: function (id, data) {
    var g = this.getGoal(id);
    if (!g) return null;
    var next = normGoal(Object.assign({}, g, data, { id: g.id, createdAt: g.createdAt }));
    Store.state.goals = Store.state.goals.map(function (x) { return x.id === id ? next : x; });
    this.settleKRs();      // KR 进度变化后结算：达成 100% 的发一次积分
    this.emit();
    return next;
  },

  removeGoal: function (id) {
    Store.state.goals = (Store.state.goals || []).filter(function (x) { return x.id !== id; });
    this.emit();
  },

  /**
   * 列表内手动排序：仅对「当前可见（已筛选）的那批 id」重排，
   * 其余隐藏项保持原位置不变，避免跨筛选串序。
   * 用场景：计划页筛选后拖拽、目标页在办/归档分区内拖拽。
   * @param {string} key   Store.state 上的数组字段名（'plans' | 'goals' | 'tasks'）
   * @param {string[]} visibleIdsNewOrder 落点后可见条目的 id 顺序
   */
  reorderInView: function (key, visibleIdsNewOrder) {
    var arr = Store.state[key];
    if (!arr || !visibleIdsNewOrder || !visibleIdsNewOrder.length) return;
    var set = {};
    visibleIdsNewOrder.forEach(function (id) { set[id] = 1; });
    var ordered = [], seen = {};
    visibleIdsNewOrder.forEach(function (id) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id && !seen[id]) { ordered.push(arr[i]); seen[id] = 1; break; }
      }
    });
    var ptr = 0;
    Store.state[key] = arr.map(function (x) { return set[x.id] ? ordered[ptr++] : x; });
    this.emit();
  },

  /**
   * 在「可见子集」里上移 / 下移一项（用于「移动到…」菜单的无障碍排序）。
   * filterFn 决定哪些项参与排序（如待办只排顶层、目标只排未归档）。
   * 只在数组里交换两项的绝对位置，隐藏项保持原位。
   */
  moveAmong: function (key, id, dir, filterFn) {
    var arr = Store.state[key];
    if (!arr) return false;
    var idxs = [];
    for (var i = 0; i < arr.length; i++) { if (!filterFn || filterFn(arr[i])) idxs.push(i); }
    var pos = -1;
    for (var k = 0; k < idxs.length; k++) { if (arr[idxs[k]].id === id) { pos = k; break; } }
    if (pos < 0) return false;
    var np = pos + dir;
    if (np < 0 || np >= idxs.length) return false;
    var a = idxs[pos], b = idxs[np], tmp = arr[a];
    arr[a] = arr[b]; arr[b] = tmp;
    this.emit();
    return true;
  },

  /** 在「可见子集」里置顶 / 置底（edge: 'top' | 'bottom'） */
  moveEdgeAmong: function (key, id, edge, filterFn) {
    var arr = Store.state[key];
    if (!arr) return false;
    var idxs = [];
    for (var i = 0; i < arr.length; i++) { if (!filterFn || filterFn(arr[i])) idxs.push(i); }
    var pos = -1;
    for (var k = 0; k < idxs.length; k++) { if (arr[idxs[k]].id === id) { pos = k; break; } }
    if (pos < 0) return false;
    var item = arr.splice(idxs[pos], 1)[0];
    if (edge === 'top') arr.unshift(item); else arr.push(item);
    this.emit();
    return true;
  },

  /** 归档 = 留档：不删、不清空数据，只是从「在办」挪到下面 */
  archiveGoal: function (id, on) {
    var g = this.getGoal(id);
    if (!g) return null;
    g.archivedAt = on === false ? '' : new Date().toISOString();
    this.settleGoals();      // 归档时结算：达成 100% 且周期够长的发一次积分
    this.emit();
    return g;
  },

  /**
   * 目标结算：离开「在办」且进度 100%、周期满 GOAL_MIN_DAYS 的，发一次积分。
   * 用 rewardedAt 挡住重复发放——恢复再归档、反复新建都不会重复给。
   * 到期是惰性的（没有写入动作），所以启动与进目标页时各跑一次。
   */
  settleGoals: function () {
    var today = DateUtil.toStr(DateUtil.today());
    var gained = [];
    (Store.state.goals || []).forEach(function (g) {
      if (g.rewardedAt || goalActive(g, today)) return;
      if (goalDays(g) < GOAL_MIN_DAYS) return;
      if (goalPct(g, today) < 100) return;
      g.rewardedAt = new Date().toISOString();
      gained.push(g);
    });
    if (gained.length) {
      this.addPoints(POMO.GOAL_DONE * gained.length, 'goal');
      this.checkAchievements(true);
      if (this.markAction) this.markAction('goal', 2);
      this.save();
    }
    this.settleKRs();
    return gained;
  },

  /**
   * KR 结算：单条 KR 首次推进到 100% 时发一次积分（POMO.KR_DONE）。
   * 用 kr.awarded 挡住重复发放；降低再升高也不会重发。
   * 与 settleGoals 一样惰性地跑——进目标页、改目标、归档时都会触发。
   */
  settleKRs: function () {
    var gained = 0;
    (Store.state.goals || []).forEach(function (g) {
      // 与目标结算一致：周期太短的目标不参与，防止「建个 3 天目标刷 KR 分」
      if (goalDays(g) < GOAL_MIN_DAYS) return;
      (g.krs || []).forEach(function (kr) {
        if (kr.awarded) return;
        // 注意：krProgress().pct 是 0–1 的比例（不是 0–100）
        if (krProgress(kr, Store.goalCtx(g)).pct >= 1) {
          kr.awarded = new Date().toISOString();
          gained += POMO.KR_DONE;
        }
      });
    });
    if (gained) {
      this.addPoints(gained, 'goal');
      this.checkAchievements(true);
      this.save();
    }
    return gained;
  },

  /** 算进度要用的上下文（纯函数的入参，单测里可以自己造） */
  goalCtx: function (g) {
    return {
      from: g.startDate,
      to: g.endDate,
      today: DateUtil.toStr(DateUtil.today()),
      plans: Store.state.plans || [],
      tasks: (Store.state.tasks || []).concat(Store.state.taskArchive || [])
    };
  },

  goalProgressOf: function (g) {
    if (!g) return { pct: 0, counted: 0, total: 0, rows: [] };
    return goalProgress(g, this.goalCtx(g));
  },

  /**
   * 覆写某天由「月历时间块」产生的活动记录。
   * 只动 from === 'block' 的那部分，手动在象限记的活动（有名字、备注）不碰，
   * 否则一次补录会把之前认真填的记录冲掉。
   * @param {string} dateStr
   * @param {Array} runs [{ start:'09:00', end:'10:30', type:'study', name:'学习' }]
   */
  saveTimeBlocks: function (dateStr, runs) {
    Store.state.activities = (Store.state.activities || []).filter(function (a) {
      return !(a.date === dateStr && a.from === 'block');
    });
    var self = this;
    (runs || []).forEach(function (r) {
      self.addActivity({
        date: dateStr,
        start: r.start,
        end: r.end || r.start,
        name: r.name || '时间块',
        type: r.type || 'other',
        from: 'block',
        taskId: r.taskId || '',
        planned: !!r.planned,
        note: r.planned ? '月历计划专注块' : '月历时间块补录'
      });
    });
    this.emit();
    return this.activitiesOf(dateStr).filter(function (a) { return a.from === 'block'; });
  },

  /* ---------------- 待办 ↔ 时间投入 ---------------- */

  /** 挂在某条待办上的活动记录（含番茄钟自动写入的） */
  activitiesOfTask: function (taskId) {
    if (!taskId) return [];
    return (Store.state.activities || []).filter(function (a) { return a.taskId === taskId; });
  },

  /**
   * 这条待办累计投入了多少时间。
   * 只统计活动记录（番茄钟结束时会写一条），分钟数不再从 sessions 里加一遍，
   * 否则同一段专注会被算两次。
   */
  taskInvest: function (taskId) {
    var list = this.activitiesOfTask(taskId).filter(function (a) { return !a.planned; });
    var minutes = 0, last = '';
    list.forEach(function (a) {
      minutes += TimeUtil.diffMin(a.start, a.end);
      if (a.date > last) last = a.date;
    });
    var pomos = (Store.state.pomodoro.sessions || []).filter(function (s) { return s.taskId === taskId; }).length;
    var recent = list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(a.start) < String(b.start) ? 1 : -1;
    }).slice(0, 5);
    return { minutes: minutes, count: list.length, pomodoros: pomos, last: last, recent: recent };
  },

  /** 某条待办在某天的「计划专注块」分钟数（from:'block' 且 planned） */
  taskPlannedOn: function (taskId, dateStr) {
    var min = 0;
    (Store.state.activities || []).forEach(function (a) {
      if (a.taskId === taskId && a.date === dateStr && a.from === 'block' && a.planned) {
        min += TimeUtil.diffMin(a.start, a.end);
      }
    });
    return min;
  },

  /** 打卡型的日期槽位；额度型给「当前周期」的日期槽位 */
  planSlots: function (plan) {
    var slots = [];
    var start = DateUtil.parse(plan.startDate) || DateUtil.today();
    if (plan.type === 'quota') {
      var w = quotaWindowAt(plan, quotaIndexOn(plan, DateUtil.toStr(DateUtil.today())), DateUtil);
      var a = DateUtil.parse(w.start), b = DateUtil.parse(w.end);
      for (var k = 0; k < 62 && a && a <= b; k++) {
        slots.push(DateUtil.toStr(a));
        a = DateUtil.addDays(a, 1);
      }
      return slots;
    }
    if (plan.type !== 'checkin') return slots;
    if (plan.period === 'once') {
      slots.push(DateUtil.toStr(start));
      return slots;
    }
    for (var i = 0; i < plan.days; i++) {
      var d = plan.period === 'weekly'
        ? DateUtil.addDays(start, i * 7)
        : DateUtil.addDays(start, i);
      slots.push(DateUtil.toStr(d));
    }
    return slots;
  },

  planRecordOfDate: function (plan, dateStr) {
    for (var i = 0; i < plan.records.length; i++) {
      if (plan.records[i].date === dateStr) return plan.records[i];
    }
    return null;
  },

  /** 当前累计值 */
  planValue: function (plan) {
    return plan.records.reduce(function (sum, r) { return sum + (Number(r.value) || 0); }, 0);
  },

  planProgress: function (plan) {
    if (plan.type === 'quota') {
      var qs = quotaStateOf(plan);
      var qpct = Math.max(0, Math.min(100, Math.round(qs.doneWindows / qs.totalWindows * 100)));
      return {
        value: qs.doneWindows, target: qs.totalWindows, pct: qpct,
        remain: Math.max(0, qs.totalWindows - qs.doneWindows),
        quota: qs   // 额度型专用：本周 2/3、周期起止等
      };
    }
    var v = this.planValue(plan);
    var t = plan.target || 1;
    var pct = Math.max(0, Math.min(100, Math.round(v / t * 100)));
    return { value: v, target: t, pct: pct, remain: Math.max(0, t - v) };
  },

  /** 额度型当前周期状态；非额度型返回 null */
  planQuotaState: function (plan) {
    return plan && plan.type === 'quota' ? quotaStateOf(plan) : null;
  },

  /** 额度型第 idx 个周期的起止（0 起）；UI 与单测共用同一份窗口算法 */
  quotaWindow: function (plan, idx) {
    return quotaWindowAt(plan, idx, DateUtil);
  },

  /** 连续打卡天数（每日打卡型）/ 连续达标周期数（额度型） */
  planStreak: function (plan) {
    if (!plan) return 0;
    if (plan.type === 'quota') {
      var qs = quotaStateOf(plan);
      var total = qs.totalWindows;
      var i = Math.min(qs.index, total - 1);
      var nq = 0;
      var reachedAt = function (k) {
        return quotaCountIn(plan, quotaWindowAt(plan, k, DateUtil)) >= qs.n;
      };
      // 当前周期还没达标时从上一周期数起：本周不算断签（与每日型「今天没打从昨天算」一致）
      if (!reachedAt(i)) i -= 1;
      for (var g = 0; g < 400 && i >= 0; g++, i--) {
        if (reachedAt(i)) nq++;
        else break;
      }
      return nq;
    }
    if (plan.type !== 'checkin' || plan.period !== 'daily') return 0;
    var doneDay = {};
    plan.records.forEach(function (r) { if (r.date) doneDay[r.date] = 1; });
    var exempt = {};
    (plan.exemptDays || []).forEach(function (d) { exempt[d] = 1; });
    var n = 0, skipped = 0;
    var cur = DateUtil.today();
    // 今天还没打卡时从昨天算起，不打断连续性
    if (!doneDay[DateUtil.toStr(cur)]) cur = DateUtil.addDays(cur, -1);
    // 往前最多翻 700 天，脏数据也拖不死
    for (var guard = 0; guard < 700; guard++) {
      var ds = DateUtil.toStr(cur);
      if (doneDay[ds]) { n++; skipped = 0; cur = DateUtil.addDays(cur, -1); continue; }
      // 豁免日：跨过去但不算断签；连缓超过上限就当真的断了
      if (exempt[ds] && skipped < PLAN_EXEMPT_MAX) {
        skipped++;
        cur = DateUtil.addDays(cur, -1);
        continue;
      }
      break;
    }
    return n;
  },

  /** 计划在某天是否被「缓一缓」过 */
  planExemptedOn: function (plan, dateStr) {
    if (!plan || !plan.exemptDays) return false;
    return plan.exemptDays.indexOf(dateStr || DateUtil.toStr(DateUtil.today())) >= 0;
  },

  /**
   * 标记 / 取消「今天先缓一缓」。
   * 不打勾、不给积分，但连续天数不断（最多连缓两天）。
   */
  togglePlanExempt: function (id, dateStr) {
    var plan = this.getPlan(id);
    if (!plan) return null;
    var ds = dateStr || DateUtil.toStr(DateUtil.today());
    if (!plan.exemptDays) plan.exemptDays = [];
    var i = plan.exemptDays.indexOf(ds);
    var on = i < 0;
    if (on) plan.exemptDays.push(ds);
    else plan.exemptDays.splice(i, 1);
    // 只留最近 120 天，别让豁免记录无限长
    if (plan.exemptDays.length > 120) {
      plan.exemptDays = plan.exemptDays.slice(-120);
    }
    this.save();
    this.emit();
    return { on: on, streak: this.planStreak(plan) };
  },

  /** 今日是否已「完成」：额度型看当前周期是否已满 N 次 */
  planDoneToday: function (plan) {
    var today = DateUtil.toStr(DateUtil.today());
    if (plan.type === 'quota') return quotaStateOf(plan, today).reached;
    if (plan.type === 'checkin') return !!this.planRecordOfDate(plan, today);
    return plan.records.some(function (r) { return r.date === today; });
  },

  /** 打卡 / 取消打卡（打卡型） */
  togglePlanCheckin: function (id, dateStr) {
    var plan = this.getPlan(id);
    if (!plan || !isCheckinLike(plan)) return null;
    dateStr = dateStr || DateUtil.toStr(DateUtil.today());
    var exist = this.planRecordOfDate(plan, dateStr);
    if (exist) {
      plan.records = plan.records.filter(function (r) { return r.date !== dateStr; });
      // 取消打卡：扣回本次打卡分（若因此失去完成态，一并扣回完成奖励）
      var back = POMO.PLAN_CHECKIN;
      if (plan.done) back += POMO.PLAN_DONE;
      plan.done = false; plan.doneAt = '';
      if (this.pomodoro.points >= back) this.spendPoints(back);
    } else {
      plan.records.push({ date: dateStr, value: 1, note: '', at: new Date().toISOString() });
      // 打了卡就没必要再挂「缓一缓」，否则同一格里既是打卡又是豁免，说不清
      if (plan.exemptDays && plan.exemptDays.length) {
        plan.exemptDays = plan.exemptDays.filter(function (d) { return d !== dateStr; });
      }
      this.bumpUsage('plan');
      if (this.markAction) this.markAction('plancheck', 1);
    }
    var wasDone = plan.done;
    this.refreshPlanDone(plan);
    // 积分：打卡 +2，本次促成完成再 +30
    var gain = 0;
    if (!exist) gain += POMO.PLAN_CHECKIN;
    if (!wasDone && plan.done) gain += POMO.PLAN_DONE;
    if (gain) this.addPoints(gain, 'plan');
    this.emit();
    this.checkAchievements(true);
    return { checked: !exist, completed: plan.done && !exist, gain: gain };
  },

  /** 累加型：增加一笔数值 */
  addPlanValue: function (id, amount, note, dateStr) {
    var plan = this.getPlan(id);
    if (!plan || isCheckinLike(plan)) return null;
    var v = parseFloat(amount);
    if (!v || v <= 0) return null;
    plan.records.push({
      date: dateStr || DateUtil.toStr(DateUtil.today()),
      value: v, note: (note || '').trim(), at: new Date().toISOString()
    });
    this.bumpUsage('plan');
    if (this.markAction) this.markAction('planvalue', 1);
    var wasDone = plan.done;
    this.refreshPlanDone(plan);
    var gain = POMO.PLAN_CHECKIN;
    if (!wasDone && plan.done) gain += POMO.PLAN_DONE;
    this.addPoints(gain, 'plan');
    this.emit();
    this.checkAchievements(true);
    return { completed: plan.done, gain: gain };
  },

  removePlanRecord: function (id, at) {
    var plan = this.getPlan(id);
    if (!plan) return null;
    plan.records = plan.records.filter(function (r) { return r.at !== at; });
    this.refreshPlanDone(plan);
    this.emit();
  },

  /** 达标自动标记完成 */
  refreshPlanDone: function (plan) {
    var pg = this.planProgress(plan);
    var nowDone = pg.pct >= 100;
    if (nowDone && !plan.done) {
      plan.done = true;
      plan.doneAt = new Date().toISOString();
    } else if (!nowDone && plan.done) {
      plan.done = false;
      plan.doneAt = '';
    }
  },

  /** 计划总览 */
  planStats: function () {
    var running = 0, finished = 0, todayPending = 0;
    var self = this;
    Store.state.plans.forEach(function (p) {
      if (p.done) { finished++; return; }
      running++;
      // 打卡型/额度型才有「今日待打卡」概念；今天已缓一缓的也不再催
      if ((p.type === 'checkin' || p.type === 'quota') && !self.planDoneToday(p) && !self.planExemptedOn(p)) todayPending++;
    });
    return { running: running, finished: finished, todayPending: todayPending, total: Store.state.plans.length };
  },

  /**
   * 统计某个打卡/计划任务在过去多长时间内打了多少次卡，并生成类似日程（Agenda）的按日时间流数据
   * @param {object|string} planOrId 计划对象或计划 ID
   * @param {number|string} [rangeDays] 统计过去多少天（如 7 / 14 / 30 / 90，或 'all' 表示自开始日期以来）
   */
  planCheckinHistory: function (planOrId, rangeDays) {
    var p = (typeof planOrId === 'string') ? this.getPlan(planOrId) : planOrId;
    if (!p) return null;
    var today = DateUtil.today();
    var todayStr = DateUtil.toStr(today);
    var startStr = p.startDate || todayStr;
    // 若有更早的打卡记录，兼顾最早打卡日
    (p.records || []).forEach(function (r) {
      if (r && r.date && r.date < startStr) startStr = r.date;
    });

    var fromDate;
    var daysSpan;
    if (rangeDays === 'all' || !rangeDays || Number(rangeDays) <= 0) {
      fromDate = DateUtil.parse(startStr) || today;
      if (fromDate > today) fromDate = today;
      daysSpan = Math.max(1, Math.round((today.getTime() - fromDate.getTime()) / 86400000) + 1);
    } else {
      daysSpan = Math.max(1, parseInt(rangeDays, 10) || 30);
      fromDate = DateUtil.addDays(today, -(daysSpan - 1));
    }
    var fromStr = DateUtil.toStr(fromDate);

    var recByDate = {};
    var totalCheckins = 0;
    var totalValue = 0;
    (p.records || []).forEach(function (r) {
      if (!r || !r.date) return;
      if (r.date < fromStr || r.date > todayStr) return;
      if (!recByDate[r.date]) recByDate[r.date] = [];
      recByDate[r.date].push(r);
      totalCheckins++;
      totalValue += (Number(r.value) || 1);
    });

    var exemptMap = {};
    (p.exemptDays || []).forEach(function (d) {
      if (d >= fromStr && d <= todayStr) exemptMap[d] = true;
    });

    var checkedDays = Object.keys(recByDate).length;
    var exemptCount = Object.keys(exemptMap).filter(function (d) { return !recByDate[d]; }).length;
    var denom = Math.max(1, daysSpan - exemptCount);
    var ratePct = Math.min(100, Math.round(checkedDays / denom * 100));

    var days = [];
    for (var i = 0; i < daysSpan; i++) {
      var d = DateUtil.addDays(today, -i);
      var ds = DateUtil.toStr(d);
      var recs = recByDate[ds] || [];
      var isEx = !recs.length && !!exemptMap[ds];
      var lastRec = recs.length ? recs[recs.length - 1] : null;
      var hm = '全天';
      if (lastRec && lastRec.at) {
        var dtAt = new Date(lastRec.at);
        if (!isNaN(dtAt.getTime())) {
          var hh = dtAt.getHours(), mm = dtAt.getMinutes();
          hm = (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm);
        }
      }
      var dayVal = recs.reduce(function (s, r) { return s + (Number(r.value) || 1); }, 0);
      var notes = recs.map(function (r) { return r.note || ''; }).filter(Boolean);
      days.push({
        date: ds,
        d: d,
        weekdayCN: DateUtil.weekdayCN(d),
        isToday: ds === todayStr,
        checked: recs.length > 0,
        count: recs.length,
        value: Math.round(dayVal * 100) / 100,
        exempted: isEx,
        timeStr: recs.length ? hm : (isEx ? '缓一缓' : '未打卡'),
        note: notes.join(' · '),
        records: recs
      });
    }

    return {
      planId: p.id,
      title: p.title,
      type: p.type,
      unit: p.unit || (p.type === 'checkin' ? '次' : ''),
      from: fromStr,
      to: todayStr,
      daysSpan: daysSpan,
      checkinCount: totalCheckins,
      checkedDays: checkedDays,
      totalValue: Math.round(totalValue * 100) / 100,
      exemptCount: exemptCount,
      ratePct: ratePct,
      streak: this.planStreak(p),
      days: days
    };
  },

  /**
   * 计划月视图聚合数据：按指定年月（y, m 为 0-11）和可选 planId 汇总每日打卡/记录
   */
  plansMonthSummary: function (y, m, filterPlanId) {
    var ym = y + '-' + ((m + 1) < 10 ? '0' + (m + 1) : (m + 1));
    var byDate = {};
    var totalRecords = 0;
    var activeDates = {};
    var activePlanIds = {};
    var plans = (Store.state.plans || []).filter(function (p) {
      return !filterPlanId || filterPlanId === 'all' || p.id === filterPlanId;
    });

    plans.forEach(function (p) {
      (p.records || []).forEach(function (r) {
        if (!r || !r.date || r.date.slice(0, 7) !== ym) return;
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push({
          plan: p,
          record: r,
          kind: 'record'
        });
        totalRecords++;
        activeDates[r.date] = true;
        activePlanIds[p.id] = true;
      });
      (p.exemptDays || []).forEach(function (ds) {
        if (!ds || ds.slice(0, 7) !== ym) return;
        var hasRec = (p.records || []).some(function (r) { return r && r.date === ds; });
        if (hasRec) return;
        if (!byDate[ds]) byDate[ds] = [];
        byDate[ds].push({
          plan: p,
          record: null,
          kind: 'exempt'
        });
      });
    });

    return {
      ym: ym,
      byDate: byDate,
      totalRecords: totalRecords,
      activeDays: Object.keys(activeDates).length,
      activePlans: Object.keys(activePlanIds).length
    };
  },

  /**
   * 计划 × 身体状态：今天该推哪些、该缓哪些。
   * 判定完全来自 bodyAdvice（不重算睡眠），这里只负责挑出候选。
   * 只看今天：计划没标耗能档位就不给建议，不按标题猜。
   */
  planLoadAdvice: function () {
    var adv = this.bodyAdvice();
    var today = DateUtil.toStr(DateUtil.today());
    var self = this;
    var out = {
      has: false, level: adv.level, mode: '', total: adv.total, q: adv.q,
      moodFatigue: !!adv.moodFatigue,
      todo: 0, tagged: 0, heavy: [], light: [], rest: []
    };
    if (!adv.has) return out;

    var todo = [];
    Store.state.plans.forEach(function (p) {
      if (!p || p.done) return;
      if (self.planDoneToday(p) || self.planExemptedOn(p, today)) return;
      if (p.startDate && p.startDate > today) return;   // 还没开始的不算今天的活
      todo.push(p);
    });

    var byImp = function (a, b) { return (b.important ? 1 : 0) - (a.important ? 1 : 0); };
    var heavy = todo.filter(function (p) { return p.load === 'high'; });
    var light = todo.filter(function (p) { return p.load === 'low'; });
    var rest  = todo.filter(function (p) { return p.load !== 'high' && p.load !== 'low'; });
    heavy.sort(byImp); light.sort(byImp); rest.sort(byImp);

    out.todo = todo.length;
    out.tagged = todo.filter(function (p) { return !!p.load; }).length;
    out.heavy = heavy;
    out.light = light;
    out.rest = rest;
    if (adv.level === 'low' || adv.level === 'mild') out.mode = heavy.length ? 'ease' : '';
    else if (adv.level === 'good') out.mode = heavy.length ? 'push' : '';
    out.has = !!out.mode;
    return out;
  },

  /** 区间内的时间去向汇总（按 from|to 缓存，整学期的重复渲染不再逐天重算） */
  rangeStat: function (from, to) {
    var ck = from + '|' + to;
    var hit = rangeStatCache[ck];
    if (hit && hit.rev === rev) return hit.val;
    var val = this._rangeStat(from, to);
    // 简单上限：翻很多年后缓存会涨，超过 64 组就清空重来
    if (Object.keys(rangeStatCache).length > 64) rangeStatCache = {};
    rangeStatCache[ck] = { rev: rev, val: val };
    return val;
  },

  _rangeStat: function (from, to) {
    var dates = eachDate(from, to);
    var list = dates.map(function (ds) {
      var st = this.dayStat(ds);
      return { date: ds, segments: st.segments };
    }, this);
    // 汇总口径（合并重叠、算未记录、日均）在 stats-calc.js，Store 只负责取每天的原始数据
    return StatsCalc.rangeSummary(list, DateUtil);
  },

  /**
   * 带参照的区间统计：拿同口径的上一个周期做对比。
   * 两段天数可能不等（2 月和 3 月），所以只输出**日均**，不输出总量差值——
   * 「本月比上月多花了 300」可能只是因为多了一天。
   */
  compareStat: function (key, r) {
    r = r || rangeDates(key);
    var cur = this.rangeStat(r.from, r.to);
    var pr = compareRange(key, r);
    if (!pr) return { cur: cur, prev: null, cmp: null, range: r, prevRange: null };
    var prev = this.rangeStat(pr.from, pr.to);
    var keys = ['sleep', 'course', 'event', 'activity', 'meal'];
    var cmp = {};
    keys.forEach(function (k) {
      var a = 0, b = 0;
      cur.segments.forEach(function (s) { if (s.key === k) a = s.minutes; });
      prev.segments.forEach(function (s) { if (s.key === k) b = s.minutes; });
      var da = perDay(a, cur.days), db = perDay(b, prev.days);
      cmp[k] = {
        cur: a, prev: b,
        curPerDay: da, prevPerDay: db,
        diffPerDay: Math.round((da - db) * 10) / 10,
        // 相对变化：参照期为 0 时不算百分比，返回 null 让界面显示「新增」
        pct: db > 0 ? Math.round((da - db) / db * 100) : null
      };
    });
    cmp.recorded = {
      cur: cur.recorded, prev: prev.recorded,
      curPerDay: perDay(cur.recorded, cur.days),
      prevPerDay: perDay(prev.recorded, prev.days),
      diffPerDay: Math.round((perDay(cur.recorded, cur.days) - perDay(prev.recorded, prev.days)) * 10) / 10,
      pct: prev.recorded > 0
        ? Math.round((perDay(cur.recorded, cur.days) - perDay(prev.recorded, prev.days)) /
                     perDay(prev.recorded, prev.days) * 100)
        : null
    };
    return { cur: cur, prev: prev, cmp: cmp, range: r, prevRange: pr };
  },

  /** 区间内的账目汇总 */
  ledgerRange: function (from, to) {
    var list = Store.state.ledger.filter(function (e) {
      return e.date >= from && e.date <= to;
    });
    var income = 0, expense = 0;
    list.forEach(function (e) {
      if (e.type === 'income') income += e.amount; else expense += e.amount;
    });
    return {
      list: list, count: list.length,
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100
    };
  },

  /** 区间内按分类汇总 */
  ledgerCatRange: function (from, to, type) {
    type = type || 'expense';
    var map = {};
    this.ledgerRange(from, to).list.forEach(function (e) {
      if (e.type !== type) return;
      map[e.category] = (map[e.category] || 0) + e.amount;
    });
    return Object.keys(map).map(function (k) {
      return { key: k, total: Math.round(map[k] * 100) / 100, cat: ctx.ledgerCat(type, k) };
    }).sort(function (a, b) { return b.total - a.total; });
  },

  /** 区间内按标签汇总（一级 + 二级） */
  ledgerTagRange: function (from, to, type) {
    type = type || 'expense';
    var map = {};
    this.ledgerRange(from, to).list.forEach(function (e) {
      if (e.type !== type) return;
      var tags = (e.tags && e.tags.length) ? e.tags : ['未打标签'];
      tags.forEach(function (t) {
        map[t] = (map[t] || 0) + e.amount;
      });
    });
    return Object.keys(map).map(function (k) {
      var parts = tagParts(k);
      return { full: k, lv1: parts.lv1, lv2: parts.lv2, amount: Math.round(map[k] * 100) / 100 };
    }).sort(function (a, b) { return b.amount - a.amount; });
  },

  /** 区间内每天的收支 */
  ledgerDaily: function (from, to) {
    var dates = eachDate(from, to);
    var map = {};
    Store.state.ledger.forEach(function (e) {
      if (e.date < from || e.date > to) return;
      if (!map[e.date]) map[e.date] = { income: 0, expense: 0 };
      if (e.type === 'income') map[e.date].income += e.amount;
      else map[e.date].expense += e.amount;
    });
    return dates.map(function (ds) {
      var v = map[ds] || { income: 0, expense: 0 };
      return {
        date: ds, d: DateUtil.parse(ds),
        income: Math.round(v.income * 100) / 100,
        expense: Math.round(v.expense * 100) / 100
      };
    });
  },
  });
})(window);
