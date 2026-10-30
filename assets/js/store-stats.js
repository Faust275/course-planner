/* ==========================================================
 * Store 统计聚合域（v1.4.6 从 store.js 拆出）
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
  var StatsCalc = global.StatsCalc;
  var mealType = ctx.mealType;
  var touch = ctx.touch;
  var expandRange = ctx.expandRange;
  var dayStatCache = ctx.dayStatCache;

  Object.assign(Store, {
    /**
     * 待办完成率（0–100），给成绩构成里的「作业分」自动分项用。
     * 匹配规则：优先按成绩记录挂的课程；没有 courseId 时按 node.tag 匹配标签。
     */
    taskCompletionScore: function (node, rec) {
      var tag = node && node.tag ? String(node.tag) : '';
      var list = (Store.state.tasks || []).filter(function (t) {
        if (!t || t.parentId || t.status === 'archived') return false;
        if (rec && rec.courseId && t.courseId === rec.courseId) return true;
        if (tag && Array.isArray(t.tags) && t.tags.indexOf(tag) >= 0) return true;
        return false;
      });
      if (!list.length) return null;
      var done = list.filter(function (t) { return t.status === 'done'; }).length;
      return Math.round(done / list.length * 1000) / 10;
    },

    /** 给「某天的某门课」标情绪（good / tired）；传空字符串即清除 */
    setCourseMood: function (dateStr, courseId, mood) {
      if (!dateStr || !courseId) return null;
      var st = Store.state;
      if (!Array.isArray(st.courseMoods)) st.courseMoods = [];
      var arr = st.courseMoods, i = -1;
      for (var k = 0; k < arr.length; k++) {
        if (arr[k] && arr[k].date === dateStr && arr[k].courseId === courseId) { i = k; break; }
      }
      if (!mood) {
        if (i >= 0) { arr.splice(i, 1); this.emit(); }
        return null;
      }
      if (mood !== 'good' && mood !== 'tired') return null;
      if (i >= 0) arr[i].mood = mood;
      else arr.push({ date: dateStr, courseId: courseId, mood: mood });
      this.emit();
      return arr[i >= 0 ? i : arr.length - 1];
    },

    /** 某天某门课的情绪记录（没有则 null） */
    courseMoodFor: function (dateStr, courseId) {
      var arr = Store.state.courseMoods || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].date === dateStr && arr[i].courseId === courseId) return arr[i];
      }
      return null;
    },

    /**
     * 区间内按课程汇总情绪：{ courseId, name, good, tired, score }
     * score = good - tired，越大越「上完不累」；按 tired 降序给「最耗神」用。
     */
    courseMoodStats: function (fromStr, toStr) {
      var map = {};
      (Store.state.courseMoods || []).forEach(function (m) {
        if (!m || !m.courseId || !m.date) return;
        if (fromStr && m.date < fromStr) return;
        if (toStr && m.date > toStr) return;
        var it = map[m.courseId] || (map[m.courseId] = { courseId: m.courseId, name: '', good: 0, tired: 0 });
        if (m.mood === 'good') it.good++;
        else if (m.mood === 'tired') it.tired++;
      });
      var out = Object.keys(map).map(function (k) {
        var it = map[k];
        var c = Store.getCourse ? Store.getCourse(it.courseId) : null;
        it.name = (c && c.name) || '已删除课程';
        it.score = it.good - it.tired;
        return it;
      });
      out.sort(function (a, b) { return b.tired - a.tired || a.score - b.score; });
      return out;
    },

    /**
     * 某门课的累计投入：只算已发生、挂了这门课的活动（番茄钟会自动写一条活动，
     * 所以这里不再额外加 sessions，避免重复计数）。
     * @returns {{minutes:number, sessions:number, lastDate:string}}
     */
    courseInvest: function (courseId, courseName) {
      var mins = 0, n = 0, last = '';
      (Store.state.activities || []).forEach(function (a) {
        if (!a || a.planned) return;
        var hit;
        if (courseId) {
          // 有 id 就按 id 匹配；老记录可能只留了课程名，按名字兜底
          hit = a.courseId === courseId || (!a.courseId && courseName && a.courseName === courseName);
        } else {
          hit = !!courseName && a.courseName === courseName;
        }
        if (!hit) return;
        var m = TimeUtil.toMin(a.end) - TimeUtil.toMin(a.start);
        if (!(m > 0)) return;
        mins += m;
        n++;
        if (a.date && a.date > last) last = a.date;
      });
      return { minutes: Math.round(mins), sessions: n, lastDate: last };
    },

  /* ===== 月复盘的健康段 ===== */
  /**
   * 本月身体数据，整理成几行「只列数字、不写评价」的文字，接在目标复盘后面写进日记。
   *
   * 没开健康看板 / 本月什么记录都没有 → 返回空数组，复盘卡完全不提健康，
   * 免得给不用这些功能的人塞一段空话。
   */
  healthReviewLines: function (monthStr) {
    if (!this.healthEnabled()) return [];
    var today = DateUtil.toStr(DateUtil.today());
    var ym = String(monthStr || today).slice(0, 7);
    var from = ym + '-01';
    if (from > today) return [];                       // 看未来月份，没东西可总结

    var needMin = (Store.state.settings.health && Number(Store.state.settings.health.sleepMinH) || 6) * 60;
    var nights = 0, sumMin = 0, met = 0;
    var stepSum = 0, stepDays = 0;

    var cur = DateUtil.parse(from);
    var guard = 0;
    while (cur && DateUtil.toStr(cur) <= today && guard++ < 40) {
      var ds = DateUtil.toStr(cur);
      var st = this.nightStats(ds);
      if (st && st.total > 0) { nights++; sumMin += st.total; if (st.total >= needMin) met++; }
      var m = this.getMetric(ds);
      if (m && Number(m.steps) > 0) { stepSum += Number(m.steps); stepDays++; }
      cur = DateUtil.addDays(cur, 1);
    }

    var lines = [];
    if (nights) {
      lines.push('· 睡眠：平均 ' + TimeUtil.humanMin(sumMin / nights) + '（' + nights + ' 晚有记录），' +
                 '睡够 ' + (needMin / 60) + ' 小时的有 ' + met + ' 晚');
    }
    if (stepDays) {
      lines.push('· 步数：日均 ' + Math.round(stepSum / stepDays) + ' 步（' + stepDays + ' 天有记录）');
    }

    // 体重：本月第一条 vs 最新一条，只算本月内的变化
    var wl = (Store.state.weightLog || []).filter(function (w) { return w && w.date >= from && w.date <= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (wl.length >= 2) {
      var dKg = Math.round((wl[wl.length - 1].kg - wl[0].kg) * 10) / 10;
      if (dKg !== 0) {
        lines.push('· 体重：' + wl[0].kg + ' → ' + wl[wl.length - 1].kg + ' kg（' +
                   (dKg > 0 ? '+' : '') + dKg + '）');
      } else {
        lines.push('· 体重：' + wl[0].kg + ' kg（本月没变）');
      }
    }
    return lines;
  },


  /* ===== 24 小时统计 ===== */
  /**
   * 某天的时间分配
   * @returns {segments:[{key,label,minutes,color}], idle, courses, events}
   * 结果按「日期 + 数据版本号」缓存：一天算一次，翻看整学期也不会重复算 140 遍。
   * 任何写操作都会让版本号 +1（见 touch()），缓存自然失效，不用逐处清缓存。
   */
  dayStat: function (dateStr) {
    dateStr = dateStr || DateUtil.toStr(DateUtil.today());
    var hit = dayStatCache[dateStr];
    if (hit && hit.rev === ctx.getRev()) return hit.val;
    var val = this._dayStat(dateStr);
    dayStatCache[dateStr] = { rev: ctx.getRev(), val: val };
    return val;
  },

  _dayStat: function (dateStr) {
    // 单次例外生效后的课表：停课/调走的当天不再计入「上课」时长
    var courses = this.coursesOnDate(dateStr);
    var cr = [], seen = {};
    courses.forEach(function (c) {
      var key = c.day + '|' + (c.periodId || ('t' + c.startTime + c.endTime));
      if (seen[key]) return;      // 同一格重复排课只算一次
      seen[key] = 1;
      var t = Store.courseTime(c);
      if (t) cr = cr.concat(expandRange(t.start, t.end));
    });

    var activities = this.activitiesOf(dateStr);
    var ar = [];
    activities.forEach(function (a) {
      if (a.planned) return;      // 计划块不是实际投入，不进统计
      ar = ar.concat(expandRange(a.start, a.end));
    });

    var events = this.eventsOf(dateStr);
    var er = [];
    events.forEach(function (e) { er = er.concat(expandRange(e.start, e.end)); });

    var meals = Store.state.settings.trackMeal ? this.mealsOf(dateStr) : [];
    var mr = [];
    meals.forEach(function (m) {
      var dur = mealType(m.type).min;
      mr = mr.concat(expandRange(m.time, TimeUtil.addMin(m.time, dur)));
    });

    var sleepMin = Store.state.settings.trackSleep ? this.sleepMinutes(dateStr) : 0;

    // 合并重叠、算未记录都在 stats-calc.js，Store 只负责把「取了哪些数」摆好
    var sum = StatsCalc.sumDaySegments({
      sleep: sleepMin, course: cr, event: er, activity: ar, meal: mr
    });

    return { segments: sum.segments, idle: sum.idle, courses: courses, events: events };
  },

  /* ===== 健康聚合（联动看板数据源） ===== */
  /**
   * 某天健康档案：把睡眠 / 活动 / 饮食 / 体重收敛成一个对象，
   * 供健康看板与各模块联动读取。睡眠用「昨夜」（按醒来日归属到当天），复用 SleepModel 的质量算法。
   */
  dayHealth: function (dateStr) {
    var SM = (typeof window !== 'undefined' && window.SleepModel) ||
             (typeof global !== 'undefined' && global.SleepModel) || null;
    // 严格取归属当天的昨夜睡眠（醒来日 === dateStr），若无则退回当天不跨午夜的记录；
    // 绝不回退到数天前的历史记录，防止 healthWeek(7) 把旧的一晚睡眠重复计入整周 7 天。
    var rec = this.nightOn(dateStr);
    if (!rec) {
      var sameDay = (Store.state.sleeps || []).filter(function (s) {
        return s && s.date === dateStr && !(s.end && s.start && s.end < s.start);
      });
      if (sameDay.length) rec = sameDay[0];
    }
    var night = rec && SM ? SM.normalizeNight(rec) : null;
    var sleepQ = SM ? SM.qualityFactor(night) : 0.7;     // 0.3–1 睡眠质量系数
    var sleepMin = night ? (night.total || 0)
                         : (rec && Number(rec.total) > 0 ? Number(rec.total)
                            : (Store.state.settings.trackSleep ? this.sleepMinutes(dateStr) : 0));

    var metric = this.getMetric(dateStr);
    var steps = metric ? Number(metric.steps) || 0 : 0;
    var metricKcal = metric ? Number(metric.calories) || 0 : 0;
    var distance = metric ? Number(metric.distance) || 0 : 0;
    var stepGoal = Number(Store.state.settings.stepGoal) || 8000;
    var kcalGoal = Number(Store.state.settings.kcalGoal) || 300;
    var workoutGoal = Number(Store.state.settings.workoutGoal) || 30;

    // 汇总当日锻炼记录（手环同步 + 手动锻炼 + 象限运动）
    var dayWorkouts = this.workoutsOf(dateStr);
    var workoutMin = 0, workoutKcal = 0, manualWorkoutKcal = 0, workoutDist = 0;
    var seenActIds = {};
    dayWorkouts.forEach(function (w) {
      workoutMin += Number(w.duration) || 0;
      workoutKcal += Number(w.calories) || 0;
      if (w.source !== 'hc') manualWorkoutKcal += Number(w.calories) || 0;
      workoutDist += Number(w.distance) || 0;
      if (w.activityId) seenActIds[w.activityId] = 1;
    });
    // 若用户在象限直接记了「运动」类活动，也计入今日锻炼时长
    this.activitiesOf(dateStr).forEach(function (a) {
      if (!a || a.planned || a.type !== 'exercise') return;
      if (a.workoutId || seenActIds[a.id]) return;
      workoutMin += TimeUtil.diffMin(a.start, a.end);
    });
    // 若无专门锻炼记录但步数较多，按每 1000 步折算约 8 分钟中高强度活动（与小米运动健康中高强度口径近似）
    var stepActiveMin = metric && metric.activeMinutes ? Number(metric.activeMinutes) : Math.floor(steps / 1200) * 6;
    var effectiveWorkoutMin = workoutMin > 0 ? workoutMin : stepActiveMin;

    // 活动消耗合并：HC 活动消耗已含手环运动时取较大值，手动录入的锻炼则叠加
    var activeKcal = metricKcal > 0
      ? Math.max(metricKcal + manualWorkoutKcal, workoutKcal)
      : (workoutKcal > 0 ? workoutKcal : Math.round(steps * 0.035));
    var totalDist = Math.max(distance, workoutDist);

    var ms = Store.state.settings.trackMeal ? this.mealSummary(dateStr) : { kcal: 0 };
    var kcalIn = ms.kcal || 0;
    var tdee = this.estimateTDEE();
    // 动态总消耗：基础 TDEE + 当日额外运动热量补偿
    var tdeeVal = tdee ? (tdee.tdee + Math.round(workoutKcal * 0.6)) : null;
    var netKcal = (tdeeVal != null) ? Math.round(kcalIn - tdeeVal) : null;

    var dietGoal = Number((Store.state.settings.diet && Store.state.settings.diet.goal) || 0);
    var dietKcalGoal = dietGoal > 0 ? dietGoal : (tdee ? tdee.tdee : 2000);
    var dietBonusKcal = Math.round(activeKcal * 0.8);
    var dynamicDietGoal = dietKcalGoal + dietBonusKcal;

    var dayWeightRec = (Store.state.weightLog || []).filter(function (w) { return w && w.date === dateStr; })[0];
    var weight = dayWeightRec ? Number(dayWeightRec.kg) : this.latestWeight();
    var sleepMinH = (Store.state.settings.health && Store.state.settings.health.sleepMinH) || 6;

    var stepPct = stepGoal > 0 ? Math.min(200, Math.round(steps / stepGoal * 100)) : 0;
    var kcalPct = kcalGoal > 0 ? Math.min(200, Math.round(activeKcal / kcalGoal * 100)) : 0;
    var workoutPct = workoutGoal > 0 ? Math.min(200, Math.round(effectiveWorkoutMin / workoutGoal * 100)) : 0;

    return {
      date: dateStr,
      sleepRec: rec || null,
      sleepQ: sleepQ, sleepMin: sleepMin, hasSleep: !!(rec || sleepMin > 0),
      steps: steps, activeKcal: activeKcal, distance: totalDist,
      stepGoal: stepGoal, kcalGoal: kcalGoal, workoutGoal: workoutGoal,
      stepPct: stepPct, kcalPct: kcalPct, workoutPct: workoutPct,
      stepMet: stepPct >= 100, kcalMet: kcalPct >= 100, workoutMet: workoutPct >= 100,
      workoutMin: effectiveWorkoutMin, rawWorkoutMin: workoutMin, workoutKcal: workoutKcal,
      workouts: dayWorkouts,
      ringsAllMet: stepPct >= 100 && kcalPct >= 100 && workoutPct >= 100,
      kcalIn: kcalIn, tdee: tdeeVal, netKcal: netKcal,
      dietGoal: dietGoal, dietKcalGoal: dietKcalGoal, dietBonusKcal: dietBonusKcal, dynamicDietGoal: dynamicDietGoal,
      weight: weight, sleepMinH: sleepMinH,
      sleepMet: sleepMin >= sleepMinH * 60
    };
  },

  /** 最近 n 天（含今天）的健康周报聚合，用于看板「本周达成」 */
  healthWeek: function (n) {
    n = n || 7;
    var out = { days: n, sleepMetNights: 0, activeDays: 0, totalSteps: 0,
                sumQ: 0, hasQ: 0, avgQ: 0 };
    var today = DateUtil.today();
    for (var i = n - 1; i >= 0; i--) {
      var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
      var h = this.dayHealth(ds);
      if (h.sleepMet) out.sleepMetNights++;
      if (h.stepPct >= 100) out.activeDays++;
      out.totalSteps += h.steps;
      if (h.hasSleep) { out.sumQ += h.sleepQ; out.hasQ++; }
    }
    out.avgQ = out.hasQ ? Math.round(out.sumQ / out.hasQ * 100) / 100 : 0;
    return out;
  },

  /* ----- 跨夜聚合：债务 / 课表联动 ----- */

  /**
   * 严格按「醒来日」取昨夜睡眠，不含 sleepForDay 的近似退路。
   * 跨夜聚合必须用它：sleepForDay 在缺记录时会回退到「最近一条」，
   * 连续多天聚合会把同一夜重复计入，债务 / 对比结果全错。
   */
  nightOn: function (dateStr) {
    var self = this;
    var list = (Store.state.sleeps || []).filter(function (s) {
      return self.wakeDateOf(s) === dateStr;
    });
    if (!list.length) return null;
    return list.sort(function (a, b) {
      return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
    })[0];
  },

  /** 某夜的总睡眠分钟 + 质量系数；无记录返回 null */
  nightStats: function (dateStr) {
    var SM = (typeof window !== 'undefined' && window.SleepModel) ||
             (typeof global !== 'undefined' && global.SleepModel) || null;
    var rec = this.nightOn(dateStr);
    if (!rec) return null;
    var night = SM ? SM.normalizeNight(rec) : null;
    if (!night) {
      // 只有「总时长」没有起止的手动记录，仍应计入时长
      if (Number(rec.total) > 0) {
        return { total: Number(rec.total), q: 0.7, deep: null, rem: null,
                 efficiency: rec.efficiency != null ? Number(rec.efficiency) : null,
                 bed: null, wake: null };
      }
      return null;
    }
    return {
      total: night.total || 0,
      q: SM ? SM.qualityFactor(night) : 0.7,
      deep: night.deep, rem: night.rem,
      efficiency: night.efficiency,
      bed: night.bed, wake: night.wake
    };
  },
  });
})(window);
