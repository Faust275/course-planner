/* ==========================================================
 * Store 健康域（v1.4.6 从 store.js 拆出）
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
  var POMO = ctx.POMO;
  var sleepByNight = ctx.sleepByNight;
  var workoutType = ctx.workoutType;
  var mealType = ctx.mealType;
  var sumItems = ctx.sumItems;
  var r1 = ctx.r1;
  var isCheckinLike = ctx.isCheckinLike;
  var normFoodItem = ctx.normFoodItem;

  Object.assign(Store, {
  /* ===== 饮食记录 ===== */
  addMeal: function (data) {
    var m = {
      id: ctx.uid('m'),
      date: data.date || DateUtil.toStr(DateUtil.today()),
      time: data.time || '12:00',
      type: data.type || 'lunch',
      content: (data.content || '').trim(),
      cost: data.cost == null || data.cost === '' ? 0 : Number(data.cost) || 0,
      kcal: data.kcal == null || data.kcal === '' ? 0 : Number(data.kcal) || 0,
      items: Array.isArray(data.items) ? data.items.map(normFoodItem) : [],
      kcalManual: !!data.kcalManual,
      // 饮食默认归到「餐饮」，让记账的标签统计不用堆在「未打标签」
      tags: ctx.normalizeTags(data.tags).length ? ctx.normalizeTags(data.tags) : ['餐饮'],
      note: (data.note || '').trim()
    };
    Store.state.meals.push(m);
    this.bumpUsage('meal');
    // 有花费就自动记一笔账
    if (m.cost > 0) {
      this.addLedger({
        type: 'expense', amount: m.cost, category: 'food',
        note: mealType(m.type).label + (m.content ? '：' + m.content : ''),
        date: m.date, time: m.time, source: 'meal', refId: m.id,
        tags: m.tags
      });
    }
    // 记录类发分：每天封顶 3 餐，每餐 2 分（含本条，第 4 餐起不发）
    var dayCount = Store.state.meals.filter(function (x) { return x.date === m.date; }).length;
    if (dayCount <= POMO.MEAL_MAX_DAY) this.addPoints(POMO.MEAL_EACH, 'meal', m.date);
    if (!Store.state.settings || Store.state.settings.autoPlanDiet !== false) {
      this.syncDietToPlans(m.date, m);
    }
    this.emit();
    return m;
  },

  updateMeal: function (id, data) {
    var m = this.getMeal(id);
    if (!m) return null;
    var d2 = Object.assign({}, data || {});
    if (d2.items) {
      d2.items = d2.items.map(normFoodItem).filter(Boolean);
      if (d2.kcalManual == null) d2.kcalManual = false;
    }
    Object.keys(d2).forEach(function (k) {
      if (k === 'cost' || k === 'kcal') m[k] = Number(d2[k]) || 0;
      else if (k === 'tags') m.tags = ctx.normalizeTags(d2.tags);
      else m[k] = typeof d2[k] === 'string' ? d2[k].trim() : d2[k];
    });
    // 有食物明细且不是手填：热量跟着明细自动算
    if (m.items && m.items.length && !m.kcalManual) {
      m.kcal = r1(sumItems(m.items).kcal);
    }
    this.syncMealLedger(m);
    if (!Store.state.settings || Store.state.settings.autoPlanDiet !== false) {
      this.syncDietToPlans(m.date, m);
    }
    this.emit();
    return m;
  },

  /** 饮食记录联动健康饮食/按时早餐/控卡计划自动打卡 */
  syncDietToPlans: function (dateStr, meal) {
    if (!Array.isArray(Store.state.plans) || !Store.state.plans.length) return [];
    var self = this;
    var dStr = dateStr || (meal && meal.date) || DateUtil.toStr(DateUtil.today());
    var dayMeals = this.mealsOf(dStr);
    if (!dayMeals.length && meal) dayMeals = [meal];
    if (!dayMeals.length) return [];
    var mSum = this.mealSummary(dStr);
    var hasBreakfast = dayMeals.some(function (m) { return m && m.type === 'breakfast'; });
    var dietGoal = Number(Store.state.settings && Store.state.settings.diet && Store.state.settings.diet.goal) || 0;
    var dietRe = /饮食|早饭|早餐|三餐|控糖|减脂|轻食|控卡|热量|健康餐|按时吃饭|少喝奶茶|戒奶茶|不点外卖|自己做饭/;

    var synced = [];
    Store.state.plans.forEach(function (p) {
      if (!p || p.done) return;
      if (p.startDate && dStr < p.startDate) return;
      var title = String(p.title || '');
      var pTags = Array.isArray(p.tags) ? p.tags : [];
      var hasDietTag = pTags.some(function (t) {
        return dietRe.test(t) || t === '饮食' || t === '餐饮' || t.indexOf('健康/饮食') === 0;
      });
      if (!hasDietTag && !dietRe.test(title)) return;

      var needBreakfast = /早饭|早餐/.test(title) || pTags.some(function (t) { return /早饭|早餐/.test(t); });
      if (needBreakfast && !hasBreakfast) return;

      var isKcalControl = /控卡|热量|减脂/.test(title);
      if (isKcalControl && dietGoal > 0 && mSum.kcal > dietGoal * 1.1) return;

      if (!Array.isArray(p.records)) p.records = [];
      if (isCheckinLike(p)) {
        var hasRec = p.records.some(function (r) { return r && r.date === dStr; });
        if (hasRec) return;
        p.records.push({
          date: dStr,
          value: 1,
          note: (needBreakfast ? '早餐已记录' : '今日饮食已记录') + (mSum.kcal ? ' (' + Math.round(mSum.kcal) + ' kcal)' : ''),
          source: 'diet',
          at: new Date().toISOString()
        });
        if (Array.isArray(p.exemptDays)) {
          p.exemptDays = p.exemptDays.filter(function (d) { return d !== dStr; });
        }
      } else {
        var hasProg = p.records.some(function (r) { return r && r.date === dStr && r.source === 'diet'; });
        if (hasProg) return;
        p.records.push({
          date: dStr,
          value: 1,
          note: '饮食记录自动累计',
          source: 'diet',
          at: new Date().toISOString()
        });
      }
      var wasDone = p.done;
      self.refreshPlanDone(p);
      var gain = POMO.PLAN_CHECKIN + ((!wasDone && p.done) ? POMO.PLAN_DONE : 0);
      if (gain > 0) self.addPoints(gain, 'plan', dStr);
      synced.push(p.title);
    });
    this.lastSyncedDietPlans = synced;
    if (synced.length) this.settleKRs();
    return synced;
  },

  /** 把饮食记录的花费同步到记账（增 / 改 / 删） */
  syncMealLedger: function (m) {
    var exist = this.ledgerByRef(m.id);
    var cost = Number(m.cost) || 0;
    if (cost <= 0) {
      if (exist) this.removeLedger(exist.id);
      return;
    }
    var payload = {
      amount: cost,
      note: mealType(m.type).label + (m.content ? '：' + m.content : ''),
      date: m.date, time: m.time,
      tags: ctx.normalizeTags(m.tags)
    };
    if (exist) {
      Object.keys(payload).forEach(function (k) { exist[k] = payload[k]; });
    } else {
      this.addLedger({
        type: 'expense', category: 'food', source: 'meal', refId: m.id,
        amount: payload.amount, note: payload.note, date: payload.date, time: payload.time,
        tags: payload.tags
      });
    }
  },

  removeMeal: function (id) {
    var linked = this.ledgerByRef(id);
    if (linked) this.removeLedger(linked.id);
    Store.state.meals = Store.state.meals.filter(function (m) { return m.id !== id; });
    this.emit();
  },

  getMeal: function (id) {
    for (var i = 0; i < Store.state.meals.length; i++) {
      if (Store.state.meals[i].id === id) return Store.state.meals[i];
    }
    return null;
  },

  /* ==========================================================
   * 饮食：食物库、营养素、每日目标
   * ========================================================== */
  /** 食物库里搜（名称模糊匹配） */
  searchFoods: function (kw, limit) {
    var db = (global.FOOD_DB || []);
    var q = String(kw || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    db.forEach(function (f, i) {
      if (String(f[0]).toLowerCase().indexOf(q) >= 0) {
        out.push({ idx: i, n: f[0], unit: f[1], kcal: f[2], p: f[3], f: f[4], c: f[5], cat: f[6] });
      }
    });
    out.sort(function (a, b) {
      return String(a.n).toLowerCase().indexOf(q) - String(b.n).toLowerCase().indexOf(q);
    });
    return limit ? out.slice(0, limit) : out;
  },

  /** 一餐的热量与营养（手填优先） */
  mealSum: function (m) {
    if (!m) return { kcal: 0, p: 0, f: 0, c: 0, manual: false };
    var s = sumItems(m.items);
    var has = !!(m.items && m.items.length);
    var kcal = (has && !m.kcalManual) ? s.kcal : (Number(m.kcal) || 0);
    return {
      kcal: r1(kcal), p: r1(s.p), f: r1(s.f), c: r1(s.c),
      manual: !!m.kcalManual || !has
    };
  },

  /** 一天的饮食汇总（按餐次分组） */
  dayDiet: function (dateStr) {
    var self = this;
    var list = this.mealsOf(dateStr);
    var out = { kcal: 0, p: 0, f: 0, c: 0, cost: 0, count: list.length, byType: {} };
    MEAL_TYPES.forEach(function (t) { out.byType[t.value] = { kcal: 0, p: 0, f: 0, c: 0, count: 0 }; });
    list.forEach(function (m) {
      var s = self.mealSum(m);
      out.kcal += s.kcal;
      out.p += s.p;
      out.f += s.f;
      out.c += s.c;
      out.cost += Number(m.cost) || 0;
      var b = out.byType[m.type] || (out.byType[m.type] = { kcal: 0, p: 0, f: 0, c: 0, count: 0 });
      b.kcal += s.kcal; b.p += s.p; b.f += s.f; b.c += s.c; b.count++;
    });
    out.kcal = r1(out.kcal); out.p = r1(out.p); out.f = r1(out.f); out.c = r1(out.c);
    out.cost = Math.round(out.cost * 100) / 100;
    return out;
  },

  /** 当前的热量目标配置 */
  dietConfig: function () {
    return (Store.state.settings && Store.state.settings.diet) ||
      { goal: 0, ratio: {}, protein: 0, fat: 0, carb: 0, profile: {} };
  },

  setDiet: function (data) {
    Object.assign(Store.state.settings.diet || {}, data || {});
    this.emit();
  },

  /** 某一餐的目标配额（按配比） */
  mealQuota: function (type) {
    var d = this.dietConfig();
    var goal = Number(d.goal) || 0;
    if (!goal) return 0;
    var pct = Number((d.ratio || {})[type]) || 0;
    return Math.round(goal * pct / 100);
  },

  /** Mifflin-St Jeor 估算基础代谢，再乘活动系数 */
  estimateTDEE: function () {
    var pf = (this.dietConfig().profile) || {};
    var w = Number(pf.weight), h = Number(pf.height), a = Number(pf.age);
    var act = Number(pf.activity) || 1.375;
    if (!(w > 0) || !(h > 0) || !(a > 0)) return null;
    var bmr = 10 * w + 6.25 * h - 5 * a + (pf.sex === 'male' ? 5 : -161);
    return { bmr: Math.round(bmr), tdee: Math.round(bmr * act) };
  },

  mealsOf: function (dateStr) {
    return Store.state.meals.filter(function (m) { return m.date === dateStr; })
      .sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  },

  /** 某日饮食汇总：总消费、总卡路里 */
  mealSummary: function (dateStr) {
    var list = this.mealsOf(dateStr);
    return {
      count: list.length,
      cost: list.reduce(function (s, m) { return s + (m.cost || 0); }, 0),
      kcal: list.reduce(function (s, m) { return s + (m.kcal || 0); }, 0)
    };
  },

  /**
   * 饮食开销：把「吃了多少」和「花了多少」放到一起看。
   *
   * 数据全部来自 meals（记饮食时填的花费会由 addMeal 自动进账本），
   * 这里只做汇总，不重复记账。
   *
   * 平均口径分两种，别混：
   *   perDayCost —— 只除以「真的有花费记录的天数」，没记账的日子不算 0 元
   *   perDayKcal —— 只除以「有热量记录的天数」，同理
   */
  foodSpend: function (n) {
    n = n || 30;
    var from = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -n + 1));
    var meals = (Store.state.meals || []).filter(function (m) { return m && m.date && m.date >= from; });
    var out = {
      has: false, days: n, from: from, count: 0, cost: 0, kcal: 0,
      costDays: 0, kcalDays: 0, perDayCost: 0, perDayKcal: 0,
      costPer1k: null, byType: {}, top: null, freeMeals: 0
    };
    if (!meals.length) return out;

    var costDays = {}, kcalDays = {}, byDay = {}, byType = {};
    var cost = 0, kcal = 0, free = 0;

    meals.forEach(function (m) {
      var c = Number(m.cost) || 0;
      var k = Number(m.kcal) || 0;
      cost += c; kcal += k;
      if (c > 0) costDays[m.date] = 1; else free++;
      if (k > 0) kcalDays[m.date] = 1;

      var t = m.type || 'other';
      if (!byType[t]) byType[t] = { cost: 0, kcal: 0, n: 0 };
      byType[t].cost += c; byType[t].kcal += k; byType[t].n++;
      byDay[m.date] = (byDay[m.date] || 0) + c;
    });

    out.has = true;
    out.count = meals.length;
    out.cost = Math.round(cost * 100) / 100;
    out.kcal = kcal;
    out.freeMeals = free;
    out.costDays = Object.keys(costDays).length;
    out.kcalDays = Object.keys(kcalDays).length;
    out.byType = byType;
    out.perDayCost = out.costDays ? Math.round(cost / out.costDays * 100) / 100 : 0;
    out.perDayKcal = out.kcalDays ? Math.round(kcal / out.kcalDays) : 0;
    out.costPer1k = kcal > 0 ? Math.round(cost / (kcal / 1000) * 100) / 100 : null;

    Object.keys(byDay).forEach(function (d) {
      if (!out.top || byDay[d] > out.top.cost) out.top = { date: d, cost: Math.round(byDay[d] * 100) / 100 };
    });
    return out;
  },

  /* ===== 睡眠记录 ===== */
  addSleep: function (data) {
    var r = {
      id: ctx.uid('s'),
      date: data.date || DateUtil.toStr(DateUtil.today()),   // 记录所属日（入睡日）
      start: data.start || '23:00',                          // 入睡时间
      end: data.end || '07:00',                              // 醒来时间（可跨午夜）
      quality: data.quality || 'normal',                     // good / normal / bad
      note: (data.note || '').trim(),
      total: data.total != null ? Number(data.total) : null, // 实睡总分钟（HC/截图/手动传入时保留）
      // 睡眠结构（深睡/浅睡/REM/清醒时长，分钟）；手环/截图/CSV/HC 可填，手动计时留空
      deep: data.deep != null ? Number(data.deep) : null,
      light: data.light != null ? Number(data.light) : null,
      rem: data.rem != null ? Number(data.rem) : null,
      awake: data.awake != null ? Number(data.awake) : null,
      efficiency: data.efficiency != null ? Number(data.efficiency) : null,  // 睡眠效率 %
      awakenings: data.awakenings != null ? Number(data.awakenings) : null, // 清醒次数
      avgHr: data.avgHr != null ? Number(data.avgHr) : null,
      spo2: data.spo2 != null ? Number(data.spo2) : null,
      source: data.source || 'manual'   // manual | timer | shot | csv | hc
    };
    // 记录类发分：当天首条睡眠记录给 4 分（防重复刷）；push 前判断，避免把自己算进去
    var isFirst = !Store.state.sleeps.some(function (s) { return s.date === r.date; });
    Store.state.sleeps.push(r);
    this.bumpUsage('sleep');
    if (isFirst) this.addPoints(POMO.SLEEP_DAY, 'sleep', r.date);
    if (!Store.state.settings || Store.state.settings.autoPlanSleep !== false) {
      var wakeD = this.wakeDateOf(r) || r.date;
      var sSynced = this.syncSleepPlans(wakeD, r);
      this.lastSyncedSleepPlans = sSynced;
    }
    this.emit();
    return r;
  },

  updateSleep: function (id, data) {
    var r = this.getSleep(id);
    if (!r) return null;
    Object.keys(data).forEach(function (k) {
      r[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
    });
    if (!Store.state.settings || Store.state.settings.autoPlanSleep !== false) {
      var wakeD = this.wakeDateOf(r) || r.date;
      var sSynced = this.syncSleepPlans(wakeD, r);
      this.lastSyncedSleepPlans = sSynced;
    }
    this.emit();
    return r;
  },

  /** 睡眠记录/手环同步/睡眠计时结束联动睡眠与作息计划自动打卡 */
  syncSleepPlans: function (dateStr, hoursOrRec) {
    if (!Array.isArray(Store.state.plans) || !Store.state.plans.length) return [];
    var self = this;
    var rec = (hoursOrRec && typeof hoursOrRec === 'object') ? hoursOrRec : null;
    var dStr = dateStr || (rec && (this.wakeDateOf(rec) || rec.date)) || DateUtil.toStr(DateUtil.today());
    var mins = 0;
    if (typeof hoursOrRec === 'number' && isFinite(hoursOrRec)) {
      mins = hoursOrRec > 24 ? Math.round(hoursOrRec) : Math.round(hoursOrRec * 60);
    } else if (rec) {
      mins = (rec.total != null && Number(rec.total) > 0)
        ? Number(rec.total)
        : TimeUtil.diffMin(rec.start || '23:00', rec.end || '07:00');
    } else {
      var dayRec = this.sleepForDay(dStr) || this.sleepsOf(dStr)[0];
      if (dayRec) {
        rec = dayRec;
        mins = (dayRec.total != null && Number(dayRec.total) > 0)
          ? Number(dayRec.total)
          : TimeUtil.diffMin(dayRec.start || '23:00', dayRec.end || '07:00');
      } else {
        mins = this.sleepMinutes(dStr);
      }
    }
    var hours = Math.round((mins / 60) * 100) / 100;
    if (hours <= 0) return [];

    var defaultMinH = Number((Store.state.settings && Store.state.settings.sleepPlanGoalHours) || 7) || 7;
    var sleepRe = /睡眠|早睡|早起|作息|熬夜|睡够|按时睡|睡觉/;
    var nonSleepActRe = /背单词|背词|单词|读书|阅读|跑步|晨跑|夜跑|散步|运动|健身|刷题|学习|复习|听课|写作|练字/;
    var bedMin = (rec && rec.start) ? TimeUtil.toMin(rec.start) : null;
    var wakeMin = (rec && rec.end) ? TimeUtil.toMin(rec.end) : null;
    var checkDate = dStr;

    var synced = [];
    Store.state.plans.forEach(function (p) {
      if (!p || p.done) return;
      if (p.startDate && checkDate < p.startDate) return;
      var title = String(p.title || '');
      var pTags = Array.isArray(p.tags) ? p.tags : [];
      var hasSleepTag = pTags.some(function (t) {
        return sleepRe.test(t) || t === '睡眠' || t.indexOf('健康/睡眠') === 0 || t === '作息';
      });
      if (!hasSleepTag && (!sleepRe.test(title) || nonSleepActRe.test(title))) return;

      var hm = title.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
      var needH = hm ? Math.max(1, parseFloat(hm[1]) || defaultMinH) : defaultMinH;

      var onlyEarlyBed = /早睡|不熬夜|少熬夜/.test(title) && !/早起|睡眠|睡够|\d/.test(title);
      var onlyEarlyWake = /早起/.test(title) && !/早睡|睡眠|睡够|\d/.test(title);
      var ok = false;
      if (onlyEarlyBed && bedMin != null) {
        ok = (bedMin >= 1140 && bedMin <= 1440) || bedMin <= 30;
      } else if (onlyEarlyWake && wakeMin != null) {
        ok = (wakeMin >= 270 && wakeMin <= 510);
      } else {
        ok = hours >= needH;
      }
      if (!ok) return;

      if (!Array.isArray(p.records)) p.records = [];
      if (isCheckinLike(p)) {
        var hasRec = p.records.some(function (r) { return r && r.date === checkDate; });
        if (hasRec) return;
        p.records.push({
          date: checkDate,
          value: 1,
          note: '睡眠达标 (' + hours + 'h) 自动打卡',
          source: 'sleep',
          at: new Date().toISOString()
        });
        if (Array.isArray(p.exemptDays)) {
          p.exemptDays = p.exemptDays.filter(function (d) { return d !== checkDate; });
        }
      } else if (p.type === 'duration') {
        var hasDur = p.records.some(function (r) { return r && r.date === checkDate && r.source === 'sleep'; });
        if (hasDur) return;
        p.records.push({
          date: checkDate,
          value: Math.round(mins),
          note: '睡眠 ' + hours + ' 小时',
          source: 'sleep',
          at: new Date().toISOString()
        });
      } else {
        var hasProg = p.records.some(function (r) { return r && r.date === checkDate && r.source === 'sleep'; });
        if (hasProg) return;
        var addVal = /小时|h/i.test(p.unit || '') ? hours : 1;
        p.records.push({
          date: checkDate,
          value: addVal,
          note: '睡眠达标 (' + hours + 'h)',
          source: 'sleep',
          at: new Date().toISOString()
        });
      }
      var wasDone = p.done;
      self.refreshPlanDone(p);
      var gain = POMO.PLAN_CHECKIN + ((!wasDone && p.done) ? POMO.PLAN_DONE : 0);
      if (gain > 0) self.addPoints(gain, 'plan', checkDate);
      synced.push(p.title);
    });
    this.lastSyncedSleepPlans = synced;
    if (synced.length) this.settleKRs();
    return synced;
  },

  removeSleep: function (id) {
    Store.state.sleeps = Store.state.sleeps.filter(function (r) { return r.id !== id; });
    this.emit();
  },

  getSleep: function (id) {
    for (var i = 0; i < Store.state.sleeps.length; i++) {
      if (Store.state.sleeps[i].id === id) return Store.state.sleeps[i];
    }
    return null;
  },

  sleepsOf: function (dateStr) {
    return Store.state.sleeps.filter(function (r) { return r.date === dateStr; })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  },

  /* ---------- 健康联动每日活动量（步数 / 卡路里 / 距离） ---------- */
  addMetric: function (data) {
    var date = data.date || DateUtil.toStr(DateUtil.today());
    var r = {
      id: ctx.uid('m'),
      date: date,
      steps: data.steps != null ? Number(data.steps) : 0,
      calories: data.calories != null ? Number(data.calories) : 0,
      distance: data.distance != null ? Number(data.distance) : 0,
      source: data.source || 'hc'   // hc | manual
    };
    // 同日已有记录：hc 源则更新数值；手动源则保留手动（不被自动同步覆盖）
    var exist = Store.state.metrics.filter(function (m) { return m.date === date; })[0];
    if (exist) {
      if (exist.source === 'hc' || r.source === 'manual') {
        exist.steps = r.steps; exist.calories = r.calories; exist.distance = r.distance;
        exist.source = r.source;
      }
      this.emit();
      return exist;
    }
    Store.state.metrics.push(r);
    this.bumpUsage('healthMetric');
    this.emit();
    return r;
  },

  /** 批量并入多天活动量：只 emit 一次（自动同步一次会带 14 天，逐条 emit 会连翻 14 次） */
  addMetrics: function (list) {
    if (!list || !list.length) return 0;
    var changed = 0;
    list.forEach(function (data) {
      if (!data || !data.date) return;
      var steps = data.steps != null ? Number(data.steps) : 0;
      var calories = data.calories != null ? Number(data.calories) : 0;
      var distance = data.distance != null ? Number(data.distance) : 0;
      var source = data.source || 'hc';
      var exist = Store.state.metrics.filter(function (m) { return m.date === data.date; })[0];
      if (exist) {
        // 手动记录优先：非手动来源不覆盖手动；值没变也不写，避免无谓 emit
        if (exist.source !== 'hc' && source !== 'manual') return;
        if (exist.steps === steps && exist.calories === calories && exist.distance === distance) return;
        exist.steps = steps; exist.calories = calories; exist.distance = distance;
        exist.source = source;
        changed++;
        return;
      }
      Store.state.metrics.push({
        id: ctx.uid('m'), date: data.date,
        steps: steps, calories: calories, distance: distance, source: source
      });
      changed++;
    });
    if (changed) { this.bumpUsage('healthMetric'); this.emit(); }
    return changed;
  },

  getMetric: function (dateStr) {
    return Store.state.metrics.filter(function (m) { return m.date === dateStr; })[0] || null;
  },

  /**
   * 睡眠质量分档（供今日要点速览条与桌面小组件使用）
   * @returns {{ tier: 'good'|'warn'|'bad'|'none', label: string, totalMin: number }}
   */
  sleepQualityTier: function (rec) {
    if (!rec) return { tier: 'none', label: '未记录', totalMin: 0 };
    var tot = (rec.total != null && Number(rec.total) > 0)
      ? Math.round(Number(rec.total))
      : ((rec.start && rec.end) ? TimeUtil.diffMin(rec.start, rec.end) : 0);
    if (!(tot > 0)) return { tier: 'none', label: '未记录', totalMin: 0 };
    var eff = rec.efficiency != null ? Number(rec.efficiency) : null;
    var q = rec.quality || 'normal';
    if (tot < 330 || q === 'bad' || (eff != null && eff < 75)) {
      return { tier: 'bad', label: '不足', totalMin: tot };
    }
    if (tot < 400 || (eff != null && eff < 84)) {
      return { tier: 'warn', label: '偏少', totalMin: tot };
    }
    return { tier: 'good', label: '充沛', totalMin: tot };
  },

  /* ---------- 锻炼 / 运动记录（小米运动健康风格 + 跨板块联动） ---------- */
  workoutsOf: function (dateStr) {
    return (Store.state.workouts || []).filter(function (w) { return w && w.date === dateStr; })
      .sort(function (a, b) { return (a.start || '') < (b.start || '') ? -1 : 1; });
  },

  getWorkout: function (id) {
    var list = Store.state.workouts || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  },

  /** 计算配速字符串（如 5'30"/km） */
  calcPace: function (durationMin, distanceMeters) {
    var d = Number(distanceMeters) || 0;
    var m = Number(durationMin) || 0;
    if (d < 100 || m <= 0) return '';
    var secPerKm = Math.round((m * 60) / (d / 1000));
    if (secPerKm <= 60 || secPerKm >= 3600) return '';
    var pm = Math.floor(secPerKm / 60), ps = secPerKm % 60;
    return pm + "'" + (ps < 10 ? '0' : '') + ps + '"/km';
  },

  /**
   * 把一条锻炼记录自动同步到「象限」24h 时间环（activities）
   * 返回关联的 activity 对象
   */
  syncWorkoutToQuadrant: function (w) {
    if (!w || !w.date || !w.start || !w.end) return null;
    var sp = workoutType(w.type);
    var kmTxt = (w.distance && w.distance >= 100) ? (' ' + (Math.round(w.distance / 100) / 10) + 'km') : '';
    var actName = (w.name || sp.label) + kmTxt;
    var noteParts = [];
    if (w.calories > 0) noteParts.push('消耗 ' + w.calories + ' kcal');
    if (w.avgHr > 0) noteParts.push('平均心率 ' + w.avgHr + ' bpm');
    if (w.pace) noteParts.push('配速 ' + w.pace);
    noteParts.push(w.source === 'hc' ? '手环同步' : '锻炼联动');
    var actTags = ctx.normalizeTags(['运动', sp.tag]);

    var exist = null;
    if (w.activityId) exist = this.getActivity(w.activityId);
    if (!exist) {
      exist = (Store.state.activities || []).filter(function (a) {
        return a && a.workoutId === w.id;
      })[0] || null;
    }

    if (exist) {
      exist.date = w.date;
      exist.name = actName;
      exist.type = 'exercise';
      exist.start = w.start;
      exist.end = w.end;
      exist.tags = actTags;
      exist.note = noteParts.join(' · ');
      exist.workoutId = w.id;
      exist.from = 'workout';
      w.activityId = exist.id;
      return exist;
    }

    var act = {
      id: ctx.uid('a'),
      date: w.date,
      name: actName,
      type: 'exercise',
      start: w.start,
      end: w.end,
      note: noteParts.join(' · '),
      tags: actTags,
      taskId: '',
      courseId: '',
      courseName: '',
      from: 'workout',
      workoutId: w.id,
      createdAt: new Date().toISOString()
    };
    Store.state.activities.push(act);
    w.activityId = act.id;
    return act;
  },

  /**
   * 锻炼记录 → 计划自动打卡联动：
   * 查找周期内未完成的运动相关计划（带「运动」标签或标题含跑步/跳绳/骑行/游泳/球/锻炼/健身，或显式开启 autoWorkout），
   * 若当天尚未打卡则自动完成打卡（或累加时长）。
   */
  syncWorkoutToPlans: function (w) {
    if (!w || !w.date) return [];
    var self = this;
    var sp = workoutType(w.type);
    var checked = [];
    var sportRe = /运动|锻炼|健身|跑步|夜跑|晨跑|跳绳|骑行|游泳|球|帕梅拉|有氧|拉伸|瑜伽|减脂|体测/;
    (Store.state.plans || []).forEach(function (p) {
      if (!p || p.done) return;
      if (p.startDate && p.startDate > w.date) return;
      var hasSportTag = (p.tags || []).some(function (t) { return t === '运动' || t.indexOf('运动/') === 0; });
      var isMatch = p.autoWorkout === true || hasSportTag || sportRe.test(p.title || '');
      if (!isMatch) return;
      // 若计划标题明确指定了某项运动（如「跳绳」），则只匹配对应运动或通用运动计划
      if (/跳绳/.test(p.title) && w.type !== 'rope') return;
      if (/游泳/.test(p.title) && w.type !== 'swim') return;
      if (/骑行/.test(p.title) && w.type !== 'cycle') return;

      if (isCheckinLike(p)) {
        if (!self.planRecordOfDate(p, w.date)) {
          p.records.push({
            date: w.date,
            value: 1,
            note: sp.label + ' ' + w.duration + '分钟（锻炼自动打卡）',
            at: new Date().toISOString()
          });
          if (p.exemptDays && p.exemptDays.length) {
            p.exemptDays = p.exemptDays.filter(function (d) { return d !== w.date; });
          }
          var wasDone = p.done;
          self.refreshPlanDone(p);
          var gain = POMO.PLAN_CHECKIN + ((!wasDone && p.done) ? POMO.PLAN_DONE : 0);
          if (gain > 0) self.addPoints(gain, 'plan');
          checked.push(p.title);
        }
      } else if (p.type === 'duration') {
        var already = (p.records || []).some(function (r) { return r.workoutId === w.id; });
        if (!already && w.duration > 0) {
          p.records.push({
            date: w.date,
            value: w.duration,
            workoutId: w.id,
            note: sp.label + ' ' + w.duration + '分钟',
            at: new Date().toISOString()
          });
          var wasDone2 = p.done;
          self.refreshPlanDone(p);
          var gain2 = POMO.PLAN_CHECKIN + ((!wasDone2 && p.done) ? POMO.PLAN_DONE : 0);
          if (gain2 > 0) self.addPoints(gain2, 'plan');
          checked.push(p.title);
        }
      }
    });
    if (checked.length) w.autoCheckedPlans = checked;
    return checked;
  },

  addWorkout: function (data, opts) {
    opts = opts || {};
    if (!Array.isArray(Store.state.workouts)) Store.state.workouts = [];
    var sp = workoutType(data && data.type);
    var date = (data && data.date) || DateUtil.toStr(DateUtil.today());
    var start = (data && data.start) || '17:00';
    var dur = (data && Number(data.duration) > 0) ? Math.round(Number(data.duration)) : 0;
    var end = (data && data.end) || '';
    if (!dur && start && end) {
      dur = TimeUtil.diffMin(start, end);
    }
    if (!dur || dur <= 0) dur = 30;
    if (!end) {
      end = TimeUtil.addMin(start, dur);
    }
    var weight = this.latestWeight() || 62;
    var cal = (data && Number(data.calories) > 0)
      ? Math.round(Number(data.calories))
      : Math.round(sp.met * weight * (dur / 60));
    var dist = (data && Number(data.distance) > 0) ? Math.round(Number(data.distance)) : 0;
    var avgHr = (data && Number(data.avgHr) > 0) ? Math.round(Number(data.avgHr)) : null;
    var maxHr = (data && Number(data.maxHr) > 0) ? Math.round(Number(data.maxHr)) : null;
    var pace = (data && data.pace) || this.calcPace(dur, dist);

    var w = {
      id: ctx.uid('wk'),
      date: date,
      type: sp.value,
      name: (data && data.name ? String(data.name).trim() : '') || sp.label,
      start: start,
      end: end,
      duration: dur,
      calories: cal,
      distance: dist,
      avgHr: avgHr,
      maxHr: maxHr,
      pace: pace,
      steps: (data && Number(data.steps) > 0) ? Math.round(Number(data.steps)) : null,
      note: (data && data.note ? String(data.note).trim() : ''),
      source: (data && data.source) || 'manual',
      activityId: '',
      createdAt: new Date().toISOString()
    };
    Store.state.workouts.push(w);

    var syncQ = opts.syncQuadrant != null ? !!opts.syncQuadrant : (Store.state.settings.syncWorkoutToQuadrant !== false);
    if (syncQ) this.syncWorkoutToQuadrant(w);

    var syncP = opts.syncPlan != null ? !!opts.syncPlan : (Store.state.settings.autoPlanWorkout !== false);
    if (syncP) this.syncWorkoutToPlans(w);

    this.bumpUsage('workout');
    if (this.markAction) this.markAction('workout', 1);
    if (!opts.silent) this.emit();
    return w;
  },

  updateWorkout: function (id, data) {
    var w = this.getWorkout(id);
    if (!w) return null;
    var sp = workoutType((data && data.type) || w.type);
    if (data.date != null) w.date = data.date;
    if (data.type != null) w.type = sp.value;
    if (data.name != null) w.name = String(data.name).trim() || sp.label;
    if (data.start != null) w.start = data.start;
    if (data.duration != null && Number(data.duration) > 0) {
      w.duration = Math.round(Number(data.duration));
      if (!data.end) w.end = TimeUtil.addMin(w.start, w.duration);
    }
    if (data.end != null && data.end) {
      w.end = data.end;
      if (!data.duration) w.duration = Math.max(1, TimeUtil.diffMin(w.start, w.end));
    }
    if (data.calories != null) w.calories = Math.max(0, Math.round(Number(data.calories) || 0));
    if (data.distance != null) w.distance = Math.max(0, Math.round(Number(data.distance) || 0));
    if (data.avgHr !== undefined) w.avgHr = Number(data.avgHr) > 0 ? Math.round(Number(data.avgHr)) : null;
    if (data.maxHr !== undefined) w.maxHr = Number(data.maxHr) > 0 ? Math.round(Number(data.maxHr)) : null;
    if (data.note != null) w.note = String(data.note).trim();
    w.pace = this.calcPace(w.duration, w.distance);

    if (Store.state.settings.syncWorkoutToQuadrant !== false || w.activityId) {
      this.syncWorkoutToQuadrant(w);
    }
    this.emit();
    return w;
  },

  removeWorkout: function (id) {
    var w = this.getWorkout(id);
    if (!w) return false;
    Store.state.workouts = (Store.state.workouts || []).filter(function (x) { return x.id !== id; });
    if (w.activityId) {
      Store.state.activities = (Store.state.activities || []).filter(function (a) { return a.id !== w.activityId && a.workoutId !== id; });
    } else {
      Store.state.activities = (Store.state.activities || []).filter(function (a) { return a.workoutId !== id; });
    }
    this.emit();
    return true;
  },

  /** 批量并入 Health Connect 锻炼会话（去重同日同时段同类型，只 emit 一次） */
  addWorkouts: function (list) {
    if (!Array.isArray(list) || !list.length) return 0;
    if (!Array.isArray(Store.state.workouts)) Store.state.workouts = [];
    var self = this;
    var added = 0;
    list.forEach(function (item) {
      if (!item || !item.date) return;
      var st = item.start || '17:00';
      var tp = item.type || 'run';
      var dup = Store.state.workouts.some(function (w) {
        return w.date === item.date && w.start === st && w.type === tp;
      });
      if (dup) return;
      self.addWorkout(Object.assign({}, item, { source: item.source || 'hc' }), { silent: true });
      added++;
    });
    if (added > 0) this.emit();
    return added;
  },

  /**
   * P0 小米运动健康 / Zepp Life CSV 批量导入：
   * 解析并写入睡眠记录、每日步数/热量/距离、锻炼会话，去重同日已有记录。
   */
  importHealthCsv: function (csvText) {
    var SM = (typeof window !== 'undefined' && window.SleepModel) ||
             (typeof global !== 'undefined' && global.SleepModel) || null;
    if (!SM || !SM.parseXiaomiCsv) {
      return { ok: false, sleepsAdded: 0, metricsAdded: 0, workoutsAdded: 0, totalAdded: 0 };
    }
    var parsed = SM.parseXiaomiCsv(csvText);
    if (!parsed || !parsed.ok) {
      return { ok: false, sleepsAdded: 0, metricsAdded: 0, workoutsAdded: 0, totalAdded: 0 };
    }
    var self = this;
    var sleepsAdded = 0, metricsAdded = 0, workoutsAdded = 0;

    (parsed.sleeps || []).forEach(function (s) {
      if (!s || !s.date) return;
      var exists = (Store.state.sleeps || []).some(function (x) { return x && x.date === s.date; });
      if (exists) return;
      self.addSleep(s);
      sleepsAdded++;
    });

    if (parsed.metrics && parsed.metrics.length) {
      var beforeM = (Store.state.metrics || []).length;
      this.addMetrics(parsed.metrics);
      metricsAdded = Math.max(0, (Store.state.metrics || []).length - beforeM);
    }

    if (parsed.workouts && parsed.workouts.length) {
      workoutsAdded = this.addWorkouts(parsed.workouts);
    }

    var totalAdded = sleepsAdded + metricsAdded + workoutsAdded;
    if (totalAdded > 0) {
      this.save();
      this.emit();
    }
    return {
      ok: true,
      sleepsAdded: sleepsAdded,
      metricsAdded: metricsAdded,
      workoutsAdded: workoutsAdded,
      totalAdded: totalAdded
    };
  },

  /** 联动 A：判断课程是否为体育/运动类课程 */
  isPeCourse: function (c) {
    if (!c || !c.name) return false;
    return /体育|篮球|足球|排球|羽毛球|网球|乒乓|游泳|太极|健美操|体测|健身|武术|瑜伽|慢跑|定向越野|击剑|滑冰|攀岩/.test(c.name);
  },

  /** 根据体育课名称推断手环运动类型 */
  inferCourseSportType: function (name) {
    var s = String(name || '');
    if (/篮球/.test(s)) return 'basketball';
    if (/足球/.test(s)) return 'football';
    if (/排球/.test(s)) return 'volleyball';
    if (/羽毛球/.test(s)) return 'badminton';
    if (/网球/.test(s)) return 'tennis';
    if (/乒乓/.test(s)) return 'pingpong';
    if (/游泳/.test(s)) return 'swim';
    if (/太极|健美操|瑜伽|形体|舞蹈/.test(s)) return 'yoga';
    if (/健身|力量|器械/.test(s)) return 'strength';
    if (/跳绳/.test(s)) return 'rope';
    if (/骑行|单车/.test(s)) return 'cycle';
    return 'run';
  },

  /** 联动 A：将某天的体育课一键记入锻炼会话（同步象限、计划与目标） */
  logCourseWorkout: function (courseId, dateStr) {
    var c = this.getCourse(courseId);
    if (!c) return null;
    var ds = dateStr || DateUtil.toStr(DateUtil.today());
    var t = this.courseTime(c) || { start: '14:00', end: '15:35' };
    var start = t.start && t.start !== '--:--' ? t.start : '14:00';
    var end = t.end && t.end !== '--:--' ? t.end : '15:35';
    var dur = Math.max(15, TimeUtil.diffMin(start, end) || 90);
    var spType = this.inferCourseSportType(c.name);

    var existing = (Store.state.workouts || []).find(function (w) {
      return w && w.date === ds && (w.courseId === c.id || (w.start === start && w.name === c.name));
    });
    if (existing) return existing;

    var w = this.addWorkout({
      date: ds,
      start: start,
      end: end,
      duration: dur,
      type: spType,
      name: c.name,
      note: [c.location, '体育课一键记入锻炼'].filter(Boolean).join(' · '),
      source: 'course'
    });
    if (w) w.courseId = c.id;
    this.save();
    return w;
  },

  /**
   * 课表 × 精力 × 睡眠 → 今日最佳运动时间段推荐
   */
  recommendWorkoutSlot: function (dateStr) {
    dateStr = dateStr || DateUtil.toStr(DateUtil.today());
    var h = this.dayHealth(dateStr);
    var busy = [];
    this.coursesOnDate(dateStr).forEach(function (c) {
      var t = Store.courseTime(c);
      if (t) busy.push([TimeUtil.toMin(t.start) - 15, TimeUtil.toMin(t.end) + 15]);
    });
    this.eventsOf(dateStr).forEach(function (e) {
      if (e.start && e.end) busy.push([TimeUtil.toMin(e.start), TimeUtil.toMin(e.end)]);
    });
    // 候选运动黄金窗：傍晚 16:30–17:30、下午 15:30–16:30、晚间 19:30–20:30、晨间 07:30–08:15
    var cands = [
      { start: '16:30', end: '17:15', sMin: 990, eMin: 1035, reason: '下午下课后、晚餐前，核心体温与心肺耐力处于全天峰值' },
      { start: '15:30', end: '16:15', sMin: 930, eMin: 975, reason: '午后生理低谷刚过，运动能快速激活多巴胺与晚间专注力' },
      { start: '19:40', end: '20:25', sMin: 1180, eMin: 1225, reason: '晚间黄金有氧窗，距入睡超 2.5 小时，有助于提升当晚深睡占比' },
      { start: '09:30', end: '10:15', sMin: 570, eMin: 615, reason: '上午空档期，适合轻快有氧唤醒身体状态' }
    ];
    var pick = cands[0];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var conflict = busy.some(function (b) { return c.sMin < b[1] && c.eMin > b[0]; });
      if (!conflict) { pick = c; break; }
    }
    var lowSleep = h.hasSleep && (h.sleepMin < 360 || h.sleepQ < 0.52);
    return {
      start: pick.start,
      end: pick.end,
      label: pick.start + '–' + pick.end,
      reason: lowSleep
        ? '昨晚睡眠偏少（' + TimeUtil.humanMin(h.sleepMin) + '），建议将强度下调为「健走 / 瑜伽拉伸」25 分钟，促恢复不透支'
        : pick.reason,
      suggestedType: lowSleep ? 'yoga' : 'run',
      suggestedDuration: lowSleep ? 25 : 40,
      lowSleep: lowSleep
    };
  },

  /* ---------- 体重记录（按天一条，供曲线与 TDEE 使用） ---------- */
  /** 记录某天体重（同一天覆盖）；合理范围 20–300kg。返回记录或 null */
  logWeight: function (dateStr, kg) {
    dateStr = dateStr || DateUtil.toStr(DateUtil.today());
    kg = Math.round(Number(kg) * 10) / 10;
    if (!(kg >= 20 && kg <= 300)) return null;
    if (!Array.isArray(Store.state.weightLog)) Store.state.weightLog = [];
    var exist = Store.state.weightLog.filter(function (w) { return w.date === dateStr; })[0];
    var rec;
    if (exist) { exist.kg = kg; rec = exist; }
    else { rec = { id: ctx.uid('w'), date: dateStr, kg: kg }; Store.state.weightLog.push(rec); }
    // 同步最新体重到档案，供 TDEE / BMI 估算
    var diet = Store.state.settings.diet;
    if (diet) { diet.profile = diet.profile || {}; diet.profile.weight = kg; }
    this.emit();
    return rec;
  },

  /** 体重序列（按日期升序）；nDays 可选，只取最近 n 天（含今天） */
  weightSeries: function (nDays) {
    var arr = (Store.state.weightLog || []).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    if (nDays) {
      var from = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -(nDays - 1)));
      arr = arr.filter(function (w) { return w.date >= from; });
    }
    return arr;
  },

  /** 最新体重：优先体重记录，其次档案里的体重 */
  latestWeight: function () {
    var arr = this.weightSeries();
    if (arr.length) return arr[arr.length - 1].kg;
    var pf = (this.dietConfig().profile) || {};
    return Number(pf.weight) || null;
  },

  /** 睡眠总分钟（按实际时刻归属：跨午夜的部分算到后一天） */
  sleepMinutes: function (dateStr) {
    var d = DateUtil.parse(dateStr) || DateUtil.today();
    var next = DateUtil.toStr(DateUtil.addDays(d, 1));
    return sleepByNight(Store.state.sleeps, dateStr, next);
  },

  /** 这条睡眠记录的「醒来日」（跨午夜时比记录日 +1 天）。用于"用昨夜睡眠算今日状态"。 */
  wakeDateOf: function (rec) {
    if (!rec || !rec.date) return '';
    var d = DateUtil.parse(rec.date);
    if (!d) return rec.date;
    var overnight = !!(rec.end && rec.start && rec.end < rec.start);
    return DateUtil.toStr(DateUtil.addDays(d, overnight ? 1 : 0));
  },

  /**
   * 取用于「某天状态推算」的那条睡眠（按夜归属）：
   *   1) 优先：醒来日正好是 dayStr 的（即昨夜睡的、今早醒的）；
   *   2) 退路：记录日就是 dayStr 且不跨午夜；
   *   3) 再退路：最近一条（之前某夜）作为近似。
   * 不改变 sleepByNight 的统计口径（仍按入睡日拆账），只在选择层做按夜归属。
   */
  sleepForDay: function (dayStr) {
    var self = this;
    var list = (Store.state.sleeps || []).slice();
    var exact = list.filter(function (s) { return self.wakeDateOf(s) === dayStr; });
    if (exact.length) {
      return exact.sort(function (a, b) { return a.start < b.start ? 1 : a.start > b.start ? -1 : 0; })[0];
    }
    var sameDay = list.filter(function (s) { return s.date === dayStr; });
    if (sameDay.length) return sameDay[0];
    var sorted = list.slice().sort(function (a, b) {
      var wa = self.wakeDateOf(a), wb = self.wakeDateOf(b);
      return wa < wb ? 1 : wa > wb ? -1 : 0;
    });
    for (var i = 0; i < sorted.length; i++) {
      if (self.wakeDateOf(sorted[i]) <= dayStr) return sorted[i];
    }
    return null;
  },

  /* ===== 睡眠计时：点一下开始，再点一下结束 ===== */
  /**
   * 开始一次睡眠计时，以「现在」为入睡时刻，记录挂在入睡那天。
   * 已经在计时时重复点击不会重置，避免手抖把时长清零。
   */
  startSleep: function () {
    if (Store.state.sleepSession) return Store.state.sleepSession;
    var now = new Date();
    Store.state.sleepSession = {
      date: DateUtil.toStr(now),
      start: DateUtil.pad(now.getHours()) + ':' + DateUtil.pad(now.getMinutes()),
      at: now.getTime()
    };
    this.emit();
    return Store.state.sleepSession;
  },

  /**
   * 结束睡眠计时并写入一条睡眠记录（结束时刻为「现在」）。
   * @returns {{minutes:number, record:object|null, tooShort?:boolean, tooLong?:boolean}|null}
   */
  endSleep: function (data) {
    var s = Store.state.sleepSession;
    if (!s) return null;
    var now = new Date();
    var mins = Math.round((now.getTime() - s.at) / 60000);
    Store.state.sleepSession = null;

    if (mins < 1) { this.emit(); return { minutes: mins, record: null, tooShort: true }; }
    // 超过 24 小时基本是忘了点结束。时钟时间差会绕回同一天，硬记会得到错误时长
    if (mins >= 1440) { this.emit(); return { minutes: mins, record: null, tooLong: true }; }

    var r = this.addSleep({
      date: s.date,
      start: s.start,
      end: DateUtil.pad(now.getHours()) + ':' + DateUtil.pad(now.getMinutes()),
      quality: (data && data.quality) || 'normal',
      note: (data && data.note) || ''
    });
    return { minutes: mins, record: r };
  },

  /** 放弃这次计时，不产生记录 */
  cancelSleep: function () {
    if (!Store.state.sleepSession) return;
    Store.state.sleepSession = null;
    this.emit();
  },
  });
})(window);
