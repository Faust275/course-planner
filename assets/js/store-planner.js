/* ==========================================================
 * Store 智能规划、精力节律、冲突检测与守夜自律子域 (store-planner.js)
 * ----------------------------------------------------------
 * 从 store.js 拆出的高内聚业务扩展域：
 * 1) 睡眠驱动的动态精力曲线推算 (inferDayEnergyModel)
 * 2) 待办一键智能分配时间算法 (autoAllocateTaskTime / applyTaskSchedule)
 * 3) 每日 24h 全景长条时间轴聚合器 (dayTimeline)
 * 4) Vis OKR 四级目标复利与微行动引擎 (stepKrValue / krMicroActions / goalCompoundSummary)
 * 5) 跨模块日程冲突检测与日负荷评估 (detectDayConflicts / dayLoadSummary)
 * 6) 番茄钟强制前台模式、夜间自律守夜与备份健康度评估
 * ========================================================== */
(function (global) {
  'use strict';

  var DateUtil = global.DateUtil;
  var TimeUtil = global.TimeUtil;
  var actType = global.actType;
  var mealType = global.mealType;
  var state = new Proxy({}, {
    get: function (_, k) { return global.Store && global.Store.state ? global.Store.state[k] : undefined; },
    set: function (_, k, v) { if (global.Store && global.Store.state) global.Store.state[k] = v; return true; }
  });
  var DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  var StorePlanner = {
    /* ==========================================================
     * 四大新特性核心引擎：
     * 1) 睡眠驱动的动态精力曲线推算 (inferDayEnergyModel)
     * 2) 待办一键智能分配时间算法 (autoAllocateTaskTime / applyTaskSchedule)
     * 3) 每日 24h 全景长条时间轴聚合器 (dayTimeline)
     * 4) Vis OKR 四级目标复利与微行动引擎 (stepKrValue / krMicroActions / goalCompoundSummary)
     * ========================================================== */

    /**
     * 推算指定日期 24 小时的生理精力与警觉度模型。
     * - 当日或过去日期：优先基于当夜真实睡眠记录（SleepModel.alertnessAt / drowsinessWindows / qualityFactor）
     * - 未来日期（Day +1 ~ DDL）：综合近 14 天作息规律基线（sleepRegularity）、7 天滚动睡眠债（sleepDebt）
     *   以及次日早八/早课时间（courseLoadOn）推算起床锚点、波峰、午休回血窗与单块时长上限。
     */
    inferDayEnergyModel: function (dateStr, opts) {
      opts = opts || {};
      var todayStr = opts.todayStr || DateUtil.toStr(DateUtil.today());
      var ds = dateStr || todayStr;
      var eg = (state && state.settings && state.settings.energy) || {};
      var mode = eg.custom ? 'custom' : (eg.mode || 'sleep');
      var SM = (typeof window !== 'undefined' && window.SleepModel) ||
               (typeof global !== 'undefined' && global.SleepModel) || null;

      var defaultPeaks = [
        { start: '09:00', end: '11:30', startMin: 540, endMin: 690, name: '晨间黄金专注期' },
        { start: '15:00', end: '17:30', startMin: 900, endMin: 1050, name: '午后高效期' },
        { start: '19:30', end: '21:30', startMin: 1170, endMin: 1290, name: '晚间静心期' }
      ];
      var defaultDips = [
        { type: 'afternoon', start: '13:00', end: '14:30', startMin: 780, endMin: 870, note: '午后生理低谷' }
      ];

      // 若用户手动自定义或显式指定固定作息模式，或当前没有任何睡眠数据且非强制模拟
      var hasAnySleeps = Array.isArray(state.sleeps) && state.sleeps.length > 0;
      if (mode === 'custom' || mode === 'standard' || (!hasAnySleeps && !opts.mockNight)) {
        var cPeaks = (mode === 'custom' && Array.isArray(eg.peaks) && eg.peaks.length)
          ? eg.peaks.map(function (p) {
              return {
                start: p.start, end: p.end,
                startMin: TimeUtil.toMin(p.start), endMin: TimeUtil.toMin(p.end),
                name: p.name || '高效专注期'
              };
            })
          : defaultPeaks;
        return {
          date: ds,
          mode: mode === 'custom' ? 'custom' : 'standard',
          source: mode === 'custom' ? 'custom' : 'standard',
          summaryText: mode === 'custom' ? '🛠️ 手动自定义精力时段' : '🕒 高校标准三段作息',
          wakeMin: 450,
          bedMin: 1380,
          wakeTime: '07:30',
          bedTime: '23:00',
          sleepMinutes: 480,
          quality: 0.85,
          maxContiguousHighMin: 120,
          isLowSleep: false,
          isEarlyClassDay: false,
          peaks: cPeaks,
          dips: defaultDips,
          avgAlertness: function (sMin, eMin) {
            var mid = (sMin + eMin) / 2;
            for (var i = 0; i < cPeaks.length; i++) {
              if (mid >= cPeaks[i].startMin && mid <= cPeaks[i].endMin) return 85;
            }
            if (mid >= 780 && mid <= 870) return 45;
            if (mid < 450 || mid >= 1380) return 25;
            return 68;
          }
        };
      }

      // 睡眠智能推算模式 (mode === 'sleep')
      var night = null;
      var sourceType = 'actual_sleep';
      var load = this.courseLoadOn ? this.courseLoadOn(ds, '09:00') : { has: false, isEarly: false, firstStart: '' };
      var debtObj = this.sleepDebt ? this.sleepDebt(7) : { debt: 0 };

      if (opts.mockNight && SM) {
        night = SM.normalizeNight(opts.mockNight);
      } else if (ds <= todayStr) {
        var rec = this.nightOn(ds) || (ds === todayStr ? this.sleepForDay(ds) : null);
        if (rec && SM) {
          night = SM.normalizeNight(rec);
        } else if (rec && Number(rec.total) > 0) {
          night = { bed: 1410, wake: 1410 + Number(rec.total), total: Number(rec.total), quality: rec.quality || 'normal' };
        }
      }

      // 若是未来日期（Day +1 ~ DDL）或当天尚无记录：用 14 天作息规律 + 睡眠债 + 早八课表推算
      if (!night) {
        sourceType = 'predicted_sleep';
        var reg = this.sleepRegularity ? this.sleepRegularity(14) : { hasData: false };
        var fallbackRec = this.sleepForDay ? this.sleepForDay(todayStr) : null;
        var fbNight = (fallbackRec && SM) ? SM.normalizeNight(fallbackRec) : null;

        var baseBed = (reg && reg.hasData && reg.bedMean != null) ? reg.bedMean
          : (fbNight ? (fbNight.bed % 1440) : 1410); // 默认 23:30
        var baseWake = (reg && reg.hasData && reg.wakeMean != null) ? reg.wakeMean
          : (fbNight ? (fbNight.wake % 1440) : 450); // 默认 07:30

        // 若目标日有早课（如 08:00 早八），起床时间锚定为 min(常规起床, 第一节课前 40 分钟)
        var predWake = baseWake;
        if (load && load.has && load.firstStart) {
          var fcMin = TimeUtil.toMin(load.firstStart);
          if (fcMin > 0) predWake = Math.min(baseWake, Math.max(360, fcMin - 40));
        }
        var wakeAbs = predWake <= baseBed ? predWake + 1440 : predWake;
        if (wakeAbs - baseBed > 720) {
          // 防止角度环绕导致跨度异常
          wakeAbs = baseBed + 460;
        }
        var predTotal = Math.max(240, Math.min(600, wakeAbs - baseBed));
        night = {
          bed: baseBed,
          wake: wakeAbs,
          total: predTotal,
          quality: predTotal < 380 ? 'bad' : 'normal'
        };
      }

      var wakeMin = ((night.wake % 1440) + 1440) % 1440;
      var bedMin = ((night.bed % 1440) + 1440) % 1440;
      if (wakeMin < 240 || wakeMin > 780) wakeMin = Math.max(360, Math.min(660, wakeMin));
      if (bedMin > 180 && bedMin < 1200) bedMin = 1380; // 规范化晚间就寝分钟（若跨零点则按 24:00 截断当日）
      var effectiveBedMin = (bedMin < wakeMin) ? 1410 : Math.min(1425, bedMin);

      var q = SM ? SM.qualityFactor(night) : Math.max(0.35, Math.min(1, (night.total || 450) / 480));
      if (sourceType === 'predicted_sleep' && debtObj && debtObj.debt > 60) {
        var debtPenalty = Math.min(0.16, (debtObj.debt / 600) * 0.14);
        q = Math.max(0.35, Math.round((q - debtPenalty) * 100) / 100);
      }

      var isLowSleep = (night.total || 0) < 360 || q < 0.52;
      var maxContiguousHighMin = isLowSleep ? 60 : (q >= 0.80 && (night.total || 0) >= 450 ? 150 : 120);

      // 计算瞌睡/低谷窗口：刚醒睡眠惯性 + 午后低谷（早八缺觉日自动预留午休回血窗） + 睡前收尾
      var dips = [];
      dips.push({
        type: 'inertia',
        startMin: wakeMin,
        endMin: Math.min(1440, wakeMin + 30),
        start: TimeUtil.fromMin(wakeMin),
        end: TimeUtil.fromMin(Math.min(1440, wakeMin + 30)),
        note: '刚醒睡眠惯性，注意力尚未恢复'
      });

      var dipStart = (load && load.isEarly && night.total < 440) ? 750 : Math.max(wakeMin + 270, 795); // 12:30 或 13:15
      var dipEnd = (load && load.isEarly && night.total < 440) ? 840 : Math.min(effectiveBedMin - 180, dipStart + 90);
      if (dipEnd > dipStart) {
        dips.push({
          type: 'afternoon',
          startMin: dipStart,
          endMin: dipEnd,
          start: TimeUtil.fromMin(dipStart),
          end: TimeUtil.fromMin(dipEnd),
          note: (load && load.isEarly && night.total < 440) ? '早课缺觉日 · 午休回血保护窗' : '午后生理警觉度低谷'
        });
      }

      if (effectiveBedMin - 75 > dipEnd) {
        dips.push({
          type: 'winddown',
          startMin: effectiveBedMin - 75,
          endMin: effectiveBedMin,
          start: TimeUtil.fromMin(effectiveBedMin - 75),
          end: TimeUtil.fromMin(effectiveBedMin),
          note: '睡前褪黑素分泌收尾期'
        });
      }

      // 动态推算三段高能波峰（根据醒来时刻与午后低谷自适应平移）
      var peaks = [];
      var mPeakStart = Math.min(700, wakeMin + 45);
      var mPeakEnd = Math.min(720, Math.max(mPeakStart + 60, dipStart - 30));
      if (mPeakEnd - mPeakStart >= 45) {
        peaks.push({
          startMin: mPeakStart,
          endMin: mPeakEnd,
          start: TimeUtil.fromMin(mPeakStart),
          end: TimeUtil.fromMin(mPeakEnd),
          name: isLowSleep ? '晨间轻度专注窗（欠睡降档）' : '晨间高警觉黄金波峰'
        });
      }

      var aPeakStart = Math.max(870, dipEnd + 15);
      var aPeakEnd = Math.min(1080, Math.max(aPeakStart + 60, 1050));
      if (aPeakEnd - aPeakStart >= 45) {
        peaks.push({
          startMin: aPeakStart,
          endMin: aPeakEnd,
          start: TimeUtil.fromMin(aPeakStart),
          end: TimeUtil.fromMin(aPeakEnd),
          name: '午后第二波高效期'
        });
      }

      var ePeakStart = 1140; // 19:00
      var ePeakEnd = Math.min(1305, effectiveBedMin - 75);
      if (ePeakEnd - ePeakStart >= 45) {
        peaks.push({
          startMin: ePeakStart,
          endMin: ePeakEnd,
          start: TimeUtil.fromMin(ePeakStart),
          end: TimeUtil.fromMin(ePeakEnd),
          name: '晚间沉浸复盘波峰'
        });
      }
      if (!peaks.length) peaks = defaultPeaks;

      function scoreAtClockMin(clockMin) {
        if (clockMin < wakeMin || clockMin >= effectiveBedMin) return 15;
        var hFromWake = (clockMin - wakeMin) / 60;
        var baseScore = SM ? SM.alertnessAt(night, hFromWake) : Math.round(75 * q);
        for (var di = 0; di < dips.length; di++) {
          if (clockMin >= dips[di].startMin && clockMin < dips[di].endMin) {
            baseScore = Math.min(baseScore, dips[di].type === 'afternoon' ? Math.round(52 * q) : Math.round(45 * q));
          }
        }
        return Math.max(10, Math.min(100, baseScore));
      }

      function avgAlertness(sMin, eMin) {
        if (!(eMin > sMin)) return scoreAtClockMin(sMin);
        var sum = 0, cnt = 0;
        for (var m = sMin; m < eMin; m += 15) {
          sum += scoreAtClockMin(m + 7.5);
          cnt++;
        }
        return cnt ? Math.round(sum / cnt) : scoreAtClockMin(sMin);
      }

      var durHuman = TimeUtil.humanMin(night.total || 450);
      var summaryText = sourceType === 'actual_sleep'
        ? ('🌙 依据昨夜实测睡眠推算（睡 ' + durHuman + ' · ' + TimeUtil.fromMin(wakeMin) + ' 醒 · 质量系数 ' + Math.round(q * 100) + '%）')
        : ('🔮 依据近14天作息节律与课表推算（预计 ' + TimeUtil.fromMin(wakeMin) + ' 醒' + (load && load.isEarly ? ' · 早八日' : '') + ' · 预估精力 ' + Math.round(q * 100) + '%）');

      return {
        date: ds,
        mode: 'sleep',
        source: sourceType,
        summaryText: summaryText,
        wakeMin: wakeMin,
        bedMin: effectiveBedMin,
        wakeTime: TimeUtil.fromMin(wakeMin),
        bedTime: TimeUtil.fromMin(effectiveBedMin),
        sleepMinutes: night.total || 450,
        quality: Math.round(q * 100) / 100,
        maxContiguousHighMin: maxContiguousHighMin,
        isLowSleep: isLowSleep,
        isEarlyClassDay: !!(load && load.isEarly),
        peaks: peaks,
        dips: dips,
        scoreAt: scoreAtClockMin,
        avgAlertness: avgAlertness
      };
    },

    /**
     * 待办一键智能分配时间引擎（支持「连续整块 contiguous」与「不连续拆分 split」）。
     * 综合精力曲线匹配（40%）、DDL 紧迫度与前倾分布（25%）、每日负载均衡（20%）、整块防碎片契合度（15%）
     * 自动在 [now .. DDL] 之间搜寻最优空闲时段。
     */
    autoAllocateTaskTime: function (taskDraft, opts) {
      opts = opts || {};
      var self = this;
      var t = taskDraft || {};
      var todayStr = opts.nowDateStr || DateUtil.toStr(DateUtil.today());
      var nowObj = new Date();
      var nowMin = opts.nowTimeStr != null
        ? TimeUtil.toMin(opts.nowTimeStr)
        : (nowObj.getHours() * 60 + nowObj.getMinutes());
      var totalMin = Math.max(30, Math.round(Number(opts.totalMinutes) || (Number(t.estHours) > 0 ? Number(t.estHours) * 60 : 120)));
      var mode = opts.mode === 'contiguous' ? 'contiguous' : 'split';
      var taskEnergy = t.energy || 'high';
      var variant = Math.max(0, parseInt(opts.variant, 10) || 0);

      // 确定搜索起止日期 [todayStr .. endDateStr]
      var dueStr = (t.dueDate && t.dueDate >= todayStr) ? t.dueDate : DateUtil.toStr(DateUtil.addDays(DateUtil.parse(todayStr), 6));
      var dueTimeMin = (t.dueDate === dueStr && t.dueTime) ? TimeUtil.toMin(t.dueTime) : 22 * 60 + 30;
      var startD = DateUtil.parse(todayStr);
      var endD = DateUtil.parse(dueStr);
      var spanDays = Math.max(1, Math.min(14, DateUtil.diffDays(endD, startD) + 1));

      var dayModels = [];
      for (var di = 0; di < spanDays; di++) {
        var dObj = DateUtil.addDays(startD, di);
        var ds = DateUtil.toStr(dObj);
        var em = this.inferDayEnergyModel(ds, { todayStr: todayStr });

        // 决定当天可排期的起止边界
        var winStart = Math.max(450, em.wakeMin + 20); // 醒后至少 20 分钟
        var winEnd = Math.min(1380, em.bedMin - 30);   // 睡前至少 30 分钟
        if (ds === todayStr) {
          var roundedNow = Math.ceil((nowMin + 15) / 15) * 15;
          winStart = Math.max(winStart, roundedNow);
        }
        if (ds === t.dueDate && dueTimeMin > 0) {
          winEnd = Math.min(winEnd, dueTimeMin);
        }
        if (winEnd <= winStart + 30) continue;

        // 收集当日硬约束占用区间 + 三餐缓冲窗
        var busy = [];
        function pushBusy(sMin, eMin, label) {
          if (!(eMin > sMin)) return;
          busy.push({ start: Math.max(winStart, sMin), end: Math.min(winEnd, eMin), label: label || '' });
        }

        // 1. 课程与考试
        var courseMinToday = 0;
        this.coursesOnDate(ds).forEach(function (c) {
          var ct = self.courseTime(c);
          if (ct && ct.start && ct.end) {
            var cs = TimeUtil.toMin(ct.start), ce = TimeUtil.toMin(ct.end);
            courseMinToday += Math.max(0, ce - cs);
            pushBusy(cs - 10, ce + 10, c.name); // 课前课后留 10 分钟通勤缓冲
          }
        });
        this.examsOf(ds).forEach(function (ex) {
          if (ex.start && ex.end) pushBusy(TimeUtil.toMin(ex.start) - 15, TimeUtil.toMin(ex.end) + 15, ex.name + '考试');
        });
        // 2. 一次性日程
        this.eventsOf(ds).forEach(function (ev) {
          if (!ev || ev.anniv || ev.done || !ev.start || !ev.end) return;
          if (t.id && ev.taskId === t.id && opts.replaceExisting !== false) return;
          pushBusy(TimeUtil.toMin(ev.start), TimeUtil.toMin(ev.end), ev.title);
        });
        // 3. 已有活动与计划专注块（排除自身旧计划块以便重排）
        var existingPlanMin = 0;
        this.activitiesOf(ds).forEach(function (act) {
          if (!act || !act.start || !act.end) return;
          if (t.id && act.taskId === t.id && act.planned && opts.replaceExisting !== false) return;
          var as = TimeUtil.toMin(act.start), ae = TimeUtil.toMin(act.end);
          existingPlanMin += Math.max(0, ae - as);
          pushBusy(as, ae, act.name);
        });
        // 4. 三餐生理缓冲保护窗（12:00-12:30 午餐，18:00-18:30 晚餐）
        pushBusy(12 * 60, 12 * 60 + 30, '午餐缓冲');
        pushBusy(18 * 60, 18 * 60 + 30, '晚餐缓冲');
        // 5. 早八缺觉日的高耗能任务避开午休回血窗 (12:30-13:30)
        if (taskEnergy === 'high' && em.isEarlyClassDay && em.isLowSleep) {
          pushBusy(12 * 60 + 30, 13 * 60 + 30, '午休回血窗');
        }

        // 合并 busy 并求取空闲区间
        busy = busy.filter(function (b) { return b.end > b.start; });
        busy.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
        var merged = [];
        busy.forEach(function (b) {
          if (!merged.length || b.start > merged[merged.length - 1].end) {
            merged.push({ start: b.start, end: b.end });
          } else if (b.end > merged[merged.length - 1].end) {
            merged[merged.length - 1].end = b.end;
          }
        });

        var freeSlots = [];
        var cur = winStart;
        merged.forEach(function (m) {
          if (m.start - cur >= 30) {
            freeSlots.push({ startMin: cur, endMin: m.start, duration: m.start - cur });
          }
          if (m.end > cur) cur = m.end;
        });
        if (winEnd - cur >= 30) {
          freeSlots.push({ startMin: cur, endMin: winEnd, duration: winEnd - cur });
        }

        dayModels.push({
          dayIdx: di,
          date: ds,
          weekday: DAY_NAMES[DateUtil.isoDow(dObj) - 1],
          energyModel: em,
          busyMinutes: courseMinToday + existingPlanMin,
          freeSlots: freeSlots
        });
      }

      // 四维加权评分函数 (0 - 100 分)
      function scoreWindow(dm, sMin, eMin, freeSlot) {
        var em = dm.energyModel;
        var alertScore = em.avgAlertness(sMin, eMin);
        var hitPeak = null;
        for (var pi = 0; pi < em.peaks.length; pi++) {
          var pk = em.peaks[pi];
          var ov = Math.max(0, Math.min(eMin, pk.endMin) - Math.max(sMin, pk.startMin));
          if (ov >= (eMin - sMin) * 0.45) { hitPeak = pk; break; }
        }
        var hitDip = null;
        for (var dpi = 0; dpi < (em.dips || []).length; dpi++) {
          var dp = em.dips[dpi];
          var dov = Math.max(0, Math.min(eMin, dp.endMin) - Math.max(sMin, dp.startMin));
          if (dov >= 20) { hitDip = dp; break; }
        }

        // 1) 精力匹配度 (40 分)
        var sEnergy = 0;
        if (taskEnergy === 'high') {
          sEnergy = (alertScore / 100) * 34 + (hitPeak ? 6 : 0) - (hitDip ? 12 : 0);
        } else if (taskEnergy === 'low') {
          // 轻松杂务优先放在平稳期/次低谷，把黄金波峰留给高难度任务
          var distFromMid = Math.abs(alertScore - 62);
          sEnergy = Math.max(12, 38 - distFromMid * 0.45) + (hitPeak ? -6 : 4);
        } else {
          sEnergy = (Math.min(85, alertScore) / 85) * 36 - (hitDip ? 6 : 0);
        }
        sEnergy = Math.max(0, Math.min(40, sEnergy));

        // 2) DDL 紧迫度与前倾分布 (25 分)
        var frontRatio = spanDays <= 1 ? 1 : (1 - (dm.dayIdx / (spanDays - 1)) * 0.65);
        var sUrgency = 25 * frontRatio;

        // 3) 当日负载均衡 (20 分)
        var loadRatio = Math.max(0, Math.min(1, 1 - dm.busyMinutes / 480));
        var sBalance = 20 * loadRatio;

        // 4) 整块契合度与防碎片化 (15 分)
        var remBefore = sMin - freeSlot.startMin;
        var remAfter = freeSlot.endMin - eMin;
        var sFit = 8;
        if (remBefore === 0 || remBefore >= 60) sFit += 3.5;
        else if (remBefore < 30) sFit -= 3;
        if (remAfter === 0 || remAfter >= 60) sFit += 3.5;
        else if (remAfter < 30) sFit -= 3;
        if (sMin % 60 === 0 || sMin % 30 === 0) sFit += 1;
        sFit = Math.max(0, Math.min(15, sFit));

        var totalScore = Math.round((sEnergy + sUrgency + sBalance + sFit) * 10) / 10;
        var reasonParts = [];
        if (hitPeak) reasonParts.push('⚡ ' + hitPeak.name);
        else if (taskEnergy === 'low' && !hitPeak) reasonParts.push('☕ 错峰处理轻杂务');
        else reasonParts.push('🌙 警觉度 ' + alertScore + '%');
        if (dm.busyMinutes <= 120) reasonParts.push('当日课业轻松');
        else if (dm.dayIdx === 0) reasonParts.push('今日趁早推进');

        return {
          score: totalScore,
          alertness: alertScore,
          peakName: hitPeak ? hitPeak.name : (hitDip ? hitDip.note : '平稳专注窗'),
          isPeak: !!hitPeak,
          reason: reasonParts.join(' · ')
        };
      }

      var pickedSlots = [];
      var allocatedMin = 0;
      var fallbackUsed = false;
      var fallbackReason = '';

      if (mode === 'contiguous') {
        // 连续整块模式：寻找单块 duration >= totalMin 的空闲段
        var contigCands = [];
        dayModels.forEach(function (dm) {
          dm.freeSlots.forEach(function (fs) {
            if (fs.duration < totalMin) return;
            for (var st = fs.startMin; st + totalMin <= fs.endMin; st += 30) {
              var ev = scoreWindow(dm, st, st + totalMin, fs);
              contigCands.push({
                date: dm.date,
                weekday: dm.weekday,
                startMin: st,
                endMin: st + totalMin,
                start: TimeUtil.fromMin(st),
                end: TimeUtil.fromMin(st + totalMin),
                duration: totalMin,
                score: ev.score,
                alertness: ev.alertness,
                peakName: ev.peakName,
                isPeak: ev.isPeak,
                reason: ev.reason
              });
            }
          });
        });
        contigCands.sort(function (a, b) { return b.score - a.score || (a.date < b.date ? -1 : 1) || (a.startMin - b.startMin); });
        if (contigCands.length) {
          var chosenIdx = variant % contigCands.length;
          pickedSlots.push(contigCands[chosenIdx]);
          allocatedMin = totalMin;
        } else {
          // 降级：DDL 前没有任何单块能塞下 totalMin，自动切换为「最长可用单块 + 拆分剩余」
          fallbackUsed = true;
          fallbackReason = '截止前无连续 ' + TimeUtil.humanMin(totalMin) + ' 的整块空档，已自动匹配最长可用时段并拆分剩余工时';
        }
      }

      if (mode === 'split' || fallbackUsed) {
        var day0Em = dayModels[0] ? dayModels[0].energyModel : { maxContiguousHighMin: 120 };
        var prefChunk = Math.max(30, Math.min(180, Number(opts.chunkMin) || (taskEnergy === 'high' ? Math.min(90, day0Em.maxContiguousHighMin) : 60)));
        var maxPerDay = Math.max(prefChunk, Number(opts.maxPerDayMin) || (spanDays <= 2 ? totalMin : 180));
        var need = totalMin;

        // 构造所有候选分块
        var allChunks = [];
        dayModels.forEach(function (dm) {
          dm.freeSlots.forEach(function (fs) {
            var pos = fs.startMin;
            while (pos + 30 <= fs.endMin) {
              var dur = Math.min(prefChunk, fs.endMin - pos);
              if (dur < 45 && fs.duration >= 45) break;
              var ev = scoreWindow(dm, pos, pos + dur, fs);
              allChunks.push({
                date: dm.date,
                weekday: dm.weekday,
                startMin: pos,
                endMin: pos + dur,
                start: TimeUtil.fromMin(pos),
                end: TimeUtil.fromMin(pos + dur),
                duration: dur,
                score: ev.score,
                alertness: ev.alertness,
                peakName: ev.peakName,
                isPeak: ev.isPeak,
                reason: ev.reason
              });
              pos += 30;
            }
          });
        });

        allChunks.sort(function (a, b) { return b.score - a.score || (a.date < b.date ? -1 : 1) || (a.startMin - b.startMin); });
        // 若用户点了「换一批时段」(variant > 0)，对前几个候选做确定性轮换
        if (variant > 0 && allChunks.length > 1) {
          var shift = (variant * 2) % Math.min(allChunks.length, 8);
          allChunks = allChunks.slice(shift).concat(allChunks.slice(0, shift));
        }

        var perDayUsed = {};
        for (var ci = 0; ci < allChunks.length && need > 0; ci++) {
          var cand = allChunks[ci];
          var dUsed = perDayUsed[cand.date] || 0;
          if (dUsed >= maxPerDay && spanDays > 1) continue;

          // 检查与同日已选时段是否重叠（并在同日两块之间预留至少 15 分钟休息间隔）
          var conflict = pickedSlots.some(function (p) {
            if (p.date !== cand.date) return false;
            return !(cand.endMin + 15 <= p.startMin || cand.startMin >= p.endMin + 15);
          });
          if (conflict) continue;

          var takeMin = Math.min(cand.duration, need, Math.max(30, maxPerDay - dUsed));
          if (takeMin < 30 && need >= 30) continue;
          var actualEnd = cand.startMin + takeMin;
          pickedSlots.push({
            date: cand.date,
            weekday: cand.weekday,
            startMin: cand.startMin,
            endMin: actualEnd,
            start: TimeUtil.fromMin(cand.startMin),
            end: TimeUtil.fromMin(actualEnd),
            duration: takeMin,
            score: cand.score,
            alertness: cand.alertness,
            peakName: cand.peakName,
            isPeak: cand.isPeak,
            reason: cand.reason
          });
          perDayUsed[cand.date] = dUsed + takeMin;
          allocatedMin += takeMin;
          need -= takeMin;
        }

        // 若因单日上限仍未排满，放宽单日上限再补一轮
        if (need > 0) {
          for (var ci2 = 0; ci2 < allChunks.length && need > 0; ci2++) {
            var cand2 = allChunks[ci2];
            var conflict2 = pickedSlots.some(function (p) {
              if (p.date !== cand2.date) return false;
              return !(cand2.endMin <= p.startMin || cand2.startMin >= p.endMin);
            });
            if (conflict2) continue;
            var take2 = Math.min(cand2.duration, need);
            var end2 = cand2.startMin + take2;
            pickedSlots.push({
              date: cand2.date,
              weekday: cand2.weekday,
              startMin: cand2.startMin,
              endMin: end2,
              start: TimeUtil.fromMin(cand2.startMin),
              end: TimeUtil.fromMin(end2),
              duration: take2,
              score: cand2.score,
              alertness: cand2.alertness,
              peakName: cand2.peakName,
              isPeak: cand2.isPeak,
              reason: cand2.reason
            });
            allocatedMin += take2;
            need -= take2;
          }
        }
      }

      pickedSlots.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.startMin - b.startMin;
      });

      var d0Model = dayModels[0] ? dayModels[0].energyModel : this.inferDayEnergyModel(todayStr);
      return {
        ok: allocatedMin >= totalMin,
        partial: allocatedMin > 0 && allocatedMin < totalMin,
        mode: mode,
        requestedMinutes: totalMin,
        allocatedMinutes: allocatedMin,
        unallocatedMinutes: Math.max(0, totalMin - allocatedMin),
        fallbackUsed: fallbackUsed,
        fallbackReason: fallbackReason,
        energyMode: d0Model.mode,
        energySummary: d0Model.summaryText,
        maxContiguousHighMin: d0Model.maxContiguousHighMin,
        slots: pickedSlots
      };
    },

    /**
     * 将智能分配的时间段一键落盘写入「计划时间块」(activities 中 planned:true, from:'block')
     * 及可选同步写入「日程事件」(events)。
     */
    applyTaskSchedule: function (taskId, slots, opts) {
      opts = opts || {};
      var t = this.getTask(taskId);
      if (!t || !Array.isArray(slots)) return { addedBlocks: 0, addedEvents: 0 };
      var todayStr = DateUtil.toStr(DateUtil.today());

      // 默认清理该任务此前未发生的计划块与自动生成的日程，防止重排叠加
      if (opts.replaceExisting !== false) {
        state.activities = (state.activities || []).filter(function (a) {
          return !(a && a.taskId === taskId && a.planned && a.date >= todayStr);
        });
        state.events = (state.events || []).filter(function (e) {
          return !(e && e.taskId === taskId && e.from === 'task-auto' && e.date >= todayStr);
        });
      }

      var totalMin = 0;
      var addedBlocks = 0, addedEvents = 0;
      var self = this;
      slots.forEach(function (s, idx) {
        if (!s || !s.date || !s.start || !s.end) return;
        var dur = TimeUtil.diffMin(s.start, s.end);
        totalMin += dur;
        var blockTitle = '计划 · ' + t.title + (slots.length > 1 ? (' (' + (idx + 1) + '/' + slots.length + ')') : '');
        self.addActivity({
          date: s.date,
          start: s.start,
          end: s.end,
          name: blockTitle,
          type: 'study',
          from: 'block',
          taskId: taskId,
          courseId: t.courseId || '',
          planned: true,
          note: s.reason ? ('智能排期：' + s.reason) : '智能分配计划专注块'
        });
        addedBlocks++;

        if (opts.syncEvents) {
          self.addEvent({
            title: '⚡ ' + t.title + (slots.length > 1 ? (' [' + (idx + 1) + '/' + slots.length + ']') : ''),
            date: s.date,
            start: s.start,
            end: s.end,
            location: s.peakName || '',
            note: '由待办「智能分配时间」自动排入日程' + (s.reason ? (' · ' + s.reason) : ''),
            taskId: taskId,
            from: 'task-auto'
          });
          addedEvents++;
        }
      });

      if (totalMin > 0) {
        t.estHours = Math.round((totalMin / 60) * 10) / 10;
      }
      this.save();
      this.emit();
      return { addedBlocks: addedBlocks, addedEvents: addedEvents, totalMinutes: totalMin };
    },

    /**
     * 每日 24 小时全景长条时间轴聚合器（供日历「每日长条时间轴模式」与象限月程使用）。
     * 返回：
     *  - pastBlocks: 过去已发生/已记录的实心时间段（睡眠、已上课程、已完成活动/专注、运动、三餐）
     *  - futureBlocks: 将来待执行/规划的虚线时间段（待上课程、考试、日程、计划专注块、关联微行动）
     *  - deadlines: 截止时间点横线/竖线标记（当日截止待办含 dueTime、考试截止线、目标到期线）
     */
    dayTimeline: function (dateStr, opts) {
      opts = opts || {};
      var self = this;
      var todayStr = opts.todayStr || DateUtil.toStr(DateUtil.today());
      var ds = dateStr || todayStr;
      var nowObj = new Date();
      var nowMin = opts.nowMin != null ? Number(opts.nowMin) : (nowObj.getHours() * 60 + nowObj.getMinutes());
      var isToday = ds === todayStr;
      var isPast = ds < todayStr;
      var isFuture = ds > todayStr;
      var cutoffMin = isPast ? 1440 : (isFuture ? 0 : nowMin);

      var pastBlocks = [];
      var futureBlocks = [];
      var deadlines = [];

      // 1. 睡眠记录（按日切分跨午夜）
      (state.sleeps || []).forEach(function (r) {
        if (!r || !r.start || !r.end) return;
        var sMin = TimeUtil.toMin(r.start), eMin = TimeUtil.toMin(r.end);
        var wakeDate = self.wakeDateOf ? self.wakeDateOf(r) : r.date;
        if (wakeDate === ds && eMin <= sMin) {
          // 昨夜跨午夜到今晨 [00:00 -> end]
          if (eMin > 0) {
            pastBlocks.push({
              id: r.id + '_am', kind: 'sleep', title: '睡眠',
              start: '00:00', end: r.end, startMin: 0, endMin: eMin,
              duration: eMin, color: '#6366f1', isPast: true
            });
          }
        }
        if (r.date === ds) {
          if (eMin > sMin) {
            pastBlocks.push({
              id: r.id, kind: 'sleep', title: '睡眠',
              start: r.start, end: r.end, startMin: sMin, endMin: eMin,
              duration: eMin - sMin, color: '#6366f1', isPast: true
            });
          } else {
            // 今晚入睡跨午夜 [start -> 24:00]
            pastBlocks.push({
              id: r.id + '_pm', kind: 'sleep', title: '夜间睡眠',
              start: r.start, end: '24:00', startMin: sMin, endMin: 1440,
              duration: 1440 - sMin, color: '#6366f1', isPast: true
            });
          }
        }
      });

      // 2. 课程（已过时刻归入 pastBlocks 实心段，未到时刻归入 futureBlocks 虚线规划段）
      this.coursesOnDate(ds).forEach(function (c) {
        var ct = self.courseTime(c);
        if (!ct || !ct.start || !ct.end) return;
        var cs = TimeUtil.toMin(ct.start), ce = TimeUtil.toMin(ct.end);
        if (!(ce > cs)) return;
        var blk = {
          id: 'course_' + c.id + '_' + cs,
          kind: 'course',
          title: c.name,
          location: c.location || '',
          start: ct.start,
          end: ct.end,
          startMin: cs,
          endMin: ce,
          duration: ce - cs,
          color: c.color || '#0ea5e9',
          courseId: c.id
        };
        if (ce <= cutoffMin) {
          blk.isPast = true;
          pastBlocks.push(blk);
        } else {
          blk.isPlanned = true;
          futureBlocks.push(blk);
        }
      });

      // 3. 活动记录与计划时间块（!planned 为过去实心，planned 为未来虚线）
      this.activitiesOf(ds).forEach(function (a) {
        if (!a || !a.start || !a.end) return;
        var as = TimeUtil.toMin(a.start), ae = TimeUtil.toMin(a.end);
        if (ae <= as) ae = 1440;
        var at = actType(a.type);
        var blk = {
          id: a.id,
          kind: a.planned ? 'planned_block' : 'activity',
          subType: a.type || 'study',
          title: a.name || at.label,
          start: a.start,
          end: a.end,
          startMin: as,
          endMin: ae,
          duration: ae - as,
          color: at.color || '#10b981',
          taskId: a.taskId || '',
          courseId: a.courseId || '',
          note: a.note || ''
        };
        if (a.planned) {
          blk.isPlanned = true;
          futureBlocks.push(blk);
        } else {
          blk.isPast = true;
          pastBlocks.push(blk);
        }
      });

      // 4. 饮食记录（占 30 分钟实心块）
      (this.mealsOf(ds) || []).forEach(function (m) {
        if (!m || !m.time) return;
        var ms = TimeUtil.toMin(m.time);
        var me = Math.min(1440, ms + 30);
        pastBlocks.push({
          id: m.id,
          kind: 'meal',
          title: (mealType(m.type).label || '用餐') + (m.content ? ' · ' + m.content : ''),
          start: m.time,
          end: TimeUtil.fromMin(me),
          startMin: ms,
          endMin: me,
          duration: me - ms,
          color: '#ef4444',
          isPast: true
        });
      });

      // 5. 日程事件与考试安排
      (this.eventsOf(ds) || []).forEach(function (ev) {
        if (!ev || ev.anniv || !ev.start) return;
        var es = TimeUtil.toMin(ev.start);
        var ee = ev.end ? TimeUtil.toMin(ev.end) : Math.min(1440, es + 60);
        if (ee <= es) ee = Math.min(1440, es + 60);
        var blk = {
          id: ev.id,
          kind: 'event',
          title: ev.title,
          location: ev.location || '',
          start: ev.start,
          end: TimeUtil.fromMin(ee),
          startMin: es,
          endMin: ee,
          duration: ee - es,
          color: '#ec4899',
          taskId: ev.taskId || ''
        };
        if (ev.done || ee <= cutoffMin) {
          blk.isPast = true;
          pastBlocks.push(blk);
        } else {
          blk.isPlanned = true;
          futureBlocks.push(blk);
        }
      });

      (this.examsOf(ds) || []).forEach(function (ex) {
        var xs = ex.start ? TimeUtil.toMin(ex.start) : 9 * 60;
        var xe = ex.end ? TimeUtil.toMin(ex.end) : xs + 120;
        futureBlocks.push({
          id: 'exam_' + (ex.courseId || ex.name),
          kind: 'exam',
          title: '🎯 考试：' + ex.name,
          location: ex.location || '',
          start: TimeUtil.fromMin(xs),
          end: TimeUtil.fromMin(xe),
          startMin: xs,
          endMin: xe,
          duration: xe - xs,
          color: '#ef4444',
          isPlanned: true
        });
        deadlines.push({
          id: 'ddl_exam_' + (ex.courseId || ex.name),
          kind: 'exam',
          title: ex.name + ' 考试开考',
          time: ex.start || '09:00',
          timeMin: xs,
          priority: 'high',
          important: true,
          done: false,
          color: '#ef4444'
        });
      });

      // 6. 截止时间点横线/竖线 (Deadlines: 当日到期任务)
      (state.tasks || []).forEach(function (t) {
        if (!t || t.parentId || t.dueDate !== ds) return;
        var tmStr = t.dueTime || '23:59';
        var tmMin = TimeUtil.toMin(tmStr);
        if (tmMin == null || isNaN(tmMin)) tmMin = 1439;
        deadlines.push({
          id: t.id,
          kind: 'task_ddl',
          title: t.title,
          time: tmStr,
          timeMin: Math.max(0, Math.min(1439, tmMin)),
          priority: t.priority || 'normal',
          important: !!t.important,
          status: t.status || 'todo',
          done: t.status === 'done',
          courseId: t.courseId || '',
          goalId: t.goalId || '',
          krId: t.krId || '',
          color: t.status === 'done' ? '#10b981' : (t.priority === 'high' || t.important ? '#ef4444' : '#f59e0b')
        });
      });

      pastBlocks.sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });
      futureBlocks.sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });
      deadlines.sort(function (a, b) { return a.timeMin - b.timeMin; });

      var recMin = 0, planMin = 0, sleepMin = 0, studyMin = 0;
      pastBlocks.forEach(function (b) {
        recMin += b.duration;
        if (b.kind === 'sleep') sleepMin += b.duration;
        if (b.kind === 'activity' && b.subType === 'study') studyMin += b.duration;
      });
      futureBlocks.forEach(function (b) {
        planMin += b.duration;
      });

      return {
        date: ds,
        isToday: isToday,
        isPast: isPast,
        isFuture: isFuture,
        nowMin: isToday ? nowMin : null,
        nowTime: isToday ? TimeUtil.fromMin(nowMin) : '',
        pastBlocks: pastBlocks,
        futureBlocks: futureBlocks,
        deadlines: deadlines,
        stats: {
          recordedMin: Math.min(1440, recMin),
          plannedMin: Math.min(1440, planMin),
          sleepMin: sleepMin,
          studyMin: studyMin,
          deadlineCount: deadlines.length,
          pendingDeadlines: deadlines.filter(function (d) { return !d.done; }).length
        }
      };
    },

    /* ==========================================================
     * Vis OKR 四级目标细化与复利微行动引擎
     * ========================================================== */

    /**
     * 水位卡片右下角「⊕」快捷步进 KR 数值，自动识别正向增长或反向减重目标，
     * 并记录今日进度增量流水（供顶部「+X.XX% 今日增加进度」实时统计）。
     */
    stepKrValue: function (goalId, krId, delta, note, dateStr) {
      var g = this.getGoal(goalId);
      if (!g) return null;
      var todayStr = dateStr || DateUtil.toStr(DateUtil.today());
      var beforeGoal = this.goalProgressOf(g);
      var beforeGoalPct = beforeGoal.exactPct != null ? beforeGoal.exactPct : beforeGoal.pct;

      var targetKr = null;
      (g.krs || []).forEach(function (k) { if (k.id === krId) targetKr = k; });
      if (!targetKr) return null;

      var ctx = this.goalCtx(g);
      var beforeKr = this.krProgress(targetKr, ctx);
      var beforeKrPct = (beforeKr.pct || 0) * 100;

      // 若是挂计划的 KR，点 ⊕ 直接为该计划今日打卡/累加一次
      if (targetKr.kind === 'plan' && targetKr.planId) {
        var pl = this.getPlan(targetKr.planId);
        if (pl) {
          var tickLike = global.isCheckinLike ? global.isCheckinLike(pl) : (pl.type === 'checkin' || pl.type === 'quota');
          if (tickLike) this.togglePlanCheckin(pl.id, todayStr);
          else this.addPlanValue(pl.id, delta || 1, note || '目标页快捷打卡', todayStr);
        }
      } else if (targetKr.kind === 'weight') {
        var stepW = delta != null ? Number(delta) : -(Number(targetKr.step) || 0.5);
        var curW = this.latestWeight() || Number(targetKr.current) || Number(targetKr.startVal) || 60;
        var nextW = Math.round((curW + stepW) * 10) / 10;
        this.logWeight(todayStr, nextW);
        targetKr.current = nextW;
      } else {
        var hasStart = targetKr.startVal !== undefined && targetKr.startVal !== null && targetKr.startVal !== '';
        var isDecreasing = hasStart && Number(targetKr.startVal) > Number(targetKr.target);
        var rawStep = delta != null ? Number(delta) : (Number(targetKr.step) || 1);
        var signedDelta = (delta == null && isDecreasing) ? -Math.abs(rawStep) : rawStep;
        var baseVal = (targetKr.current !== undefined && targetKr.current !== null && targetKr.current !== '')
          ? Number(targetKr.current)
          : (hasStart ? Number(targetKr.startVal) : 0);
        var nextVal = Math.max(0, Math.round((baseVal + signedDelta) * 100) / 100);
        targetKr.current = nextVal;
      }

      var afterKr = this.krProgress(targetKr, this.goalCtx(g));
      var afterKrPct = (afterKr.pct || 0) * 100;
      var krPctDelta = Math.round((afterKrPct - beforeKrPct) * 100) / 100;

      if (!Array.isArray(targetKr.logs)) targetKr.logs = [];
      targetKr.logs.push({
        date: todayStr,
        delta: delta != null ? Number(delta) : (Number(targetKr.step) || 1),
        val: afterKr.value,
        pctDelta: Math.max(0, krPctDelta),
        note: (note || '').trim(),
        at: new Date().toISOString()
      });
      if (targetKr.logs.length > 100) targetKr.logs = targetKr.logs.slice(-100);

      this.updateGoal(g.id, { krs: g.krs });
      var afterGoal = this.goalProgressOf(this.getGoal(goalId));
      var afterGoalPct = afterGoal.exactPct != null ? afterGoal.exactPct : afterGoal.pct;
      return {
        ok: true,
        goalId: g.id,
        krId: targetKr.id,
        value: afterKr.value,
        target: afterKr.target,
        unit: afterKr.unit,
        krPct: Math.round(afterKrPct * 10) / 10,
        krPctDelta: Math.max(0, krPctDelta),
        goalPct: afterGoalPct,
        goalPctDelta: Math.max(0, Math.round((afterGoalPct - beforeGoalPct) * 100) / 100)
      };
    },

    /**
     * 获取某个目标（及可选指定 KR）下关联的第 4 级「每日微行动」（包含每日计划与待办），
     * 并自动换算每次打卡/完成对目标总进度的复利贡献百分比（⬆️ +0.x%）。
     */
    krMicroActions: function (goalId, krId) {
      var g = this.getGoal(goalId);
      if (!g) return [];
      var krs = (g.krs || []).filter(function (k) { return !krId || k.id === krId; });
      var totalKrCount = Math.max(1, (g.krs || []).length);
      var todayStr = DateUtil.toStr(DateUtil.today());
      var actions = [];
      var seenPlan = {}, seenTask = {};
      var self = this;

      krs.forEach(function (kr) {
        // 1. 绑定的计划（kr.planId 或 plan.goalId === g.id）
        (state.plans || []).forEach(function (p) {
          if (!p || seenPlan[p.id]) return;
          var match = (kr.kind === 'plan' && kr.planId === p.id) ||
                      (p.goalId === g.id && (!p.krId || p.krId === kr.id));
          if (!match) return;
          seenPlan[p.id] = 1;
          var pTarget = Math.max(1, Number(p.target) || Number(p.days) || 21);
          var contrib = Math.round((100 / pTarget / totalKrCount) * 100) / 100;
          var doneToday = self.planDoneToday ? self.planDoneToday(p) : false;
          actions.push({
            type: 'plan',
            id: p.id,
            title: p.title,
            krId: kr.id,
            krTitle: kr.title,
            doneToday: doneToday,
            done: !!p.done,
            unit: p.unit || '次',
            contribPct: Math.max(0.05, contrib),
            scheduleText: p.period === 'daily' ? '每日打卡' : (p.period === 'weekly' ? '每周打卡' : '阶段计划')
          });
        });

        // 2. 绑定的待办（task.goalId === g.id 或 task.krId === kr.id 或标签匹配）
        (state.tasks || []).forEach(function (t) {
          if (!t || t.parentId || seenTask[t.id]) return;
          var directMatch = (t.goalId === g.id && (!t.krId || t.krId === kr.id)) || (t.krId && t.krId === kr.id);
          var ruleMatch = false;
          if (!directMatch && kr.kind === 'task') {
            var due = t.dueDate || '';
            if (due && due >= g.startDate && due <= g.endDate) {
              var cOk = !kr.courseId || t.courseId === kr.courseId;
              var tOk = !(kr.tags && kr.tags.length) || (t.tags || []).some(function (tg) { return kr.tags.indexOf(tg) >= 0; });
              ruleMatch = cOk && tOk;
            }
          }
          if (!directMatch && !ruleMatch) return;
          seenTask[t.id] = 1;
          var denom = Math.max(4, Number(kr.target) || 10);
          var contrib = Math.round((100 / denom / totalKrCount) * 100) / 100;
          actions.push({
            type: 'task',
            id: t.id,
            title: t.title,
            krId: kr.id,
            krTitle: kr.title,
            doneToday: t.status === 'done' && (t.doneAt || '').slice(0, 10) === todayStr,
            done: t.status === 'done',
            dueDate: t.dueDate || '',
            dueTime: t.dueTime || '',
            contribPct: Math.max(0.1, contrib),
            scheduleText: t.dueDate ? ('截止 ' + t.dueDate.slice(5) + (t.dueTime ? ' ' + t.dueTime : '')) : '待排期微行动'
          });
        });
      });

      return actions;
    },

    /**
     * 计算 Vis OKR 顶部「复利摘要大盘」数据：
     * - 全盘在办目标综合进度（支持小数位，如 63.4%）
     * - 今日增加进度（+X.XX%）与今日打卡/推进记录条数
     * - 「⏳ 第 N 个 10 天」微周期复利计数器
     * - 6 大人生领域（GOAL_GROUPS）的各自进度环数据
     */
    goalCompoundSummary: function (todayStr) {
      todayStr = todayStr || DateUtil.toStr(DateUtil.today());
      var self = this;
      var active = this.goalsActive();
      var totalExact = 0;
      var todayGainSum = 0;
      var todayRecords = 0;
      var earliestStart = todayStr;

      var groupMap = {};
      (this.GOAL_GROUPS || []).forEach(function (gg) {
        groupMap[gg.key] = {
          key: gg.key, name: gg.name, icon: gg.icon, color: gg.color,
          count: 0, pctSum: 0, pct: 0, goals: []
        };
      });

      active.forEach(function (g) {
        if (g.startDate && g.startDate < earliestStart) earliestStart = g.startDate;
        var pg = self.goalProgressOf(g);
        var gPct = pg.exactPct != null ? pg.exactPct : pg.pct;
        totalExact += gPct;

        var gKey = (g.group && groupMap[g.group]) ? g.group : 'study';
        groupMap[gKey].count++;
        groupMap[gKey].pctSum += gPct;
        groupMap[gKey].goals.push(g);

        var krCount = Math.max(1, (g.krs || []).length);
        // 统计今日对每个 KR 的新增贡献
        (g.krs || []).forEach(function (kr) {
          // 1) kr.logs 中今天步进的记录
          (kr.logs || []).forEach(function (lg) {
            if (lg && lg.date === todayStr) {
              todayRecords++;
              todayGainSum += (Number(lg.pctDelta) || 1) / krCount;
            }
          });
          // 2) 绑定的计划今天打卡
          if (kr.kind === 'plan' && kr.planId) {
            var pl = self.getPlan(kr.planId);
            if (pl) {
              var recToday = (pl.records || []).filter(function (r) { return r && r.date === todayStr && Number(r.value) > 0; });
              if (recToday.length) {
                todayRecords += recToday.length;
                var pTgt = Math.max(1, Number(pl.target) || 1);
                var valToday = recToday.reduce(function (s, r) { return s + (Number(r.value) || 0); }, 0);
                todayGainSum += Math.min(100, (valToday / pTgt) * 100) / krCount;
              }
            }
          }
          // 3) 专注时长 KR 今天完成的番茄钟
          if (kr.kind === 'focus') {
            var sessToday = ((state.pomodoro && state.pomodoro.sessions) || []).filter(function (s) {
              return s && s.date === todayStr && (!kr.courseId || s.courseId === kr.courseId);
            });
            if (sessToday.length) {
              todayRecords += sessToday.length;
              var minToday = sessToday.reduce(function (s, x) { return s + (Number(x.minutes) || 0); }, 0);
              var fTgt = Math.max(0.5, Number(kr.target) || 10);
              todayGainSum += ((minToday / 60) / fTgt * 100) / krCount;
            }
          }
        });
      });

      var avgPct = active.length ? Math.round((totalExact / active.length) * 10) / 10 : 0;
      var todayAddedPct = active.length ? Math.round((todayGainSum / active.length) * 100) / 100 : 0;

      // 计算「第 N 个 10 天」微周期（以最早在办目标或当前学期起点为基准）
      var semStart = (this.semester && this.semester.startDate) ? this.semester.startDate : earliestStart;
      var anchorStr = active.length ? earliestStart : semStart;
      var diffDays = Math.max(0, DateUtil.diffDays(DateUtil.parse(todayStr), DateUtil.parse(anchorStr)));
      var tenDayIndex = Math.floor(diffDays / 10) + 1;
      var dayInCycle = (diffDays % 10) + 1;

      var groups = (this.GOAL_GROUPS || []).map(function (gg) {
        var item = groupMap[gg.key];
        item.pct = item.count ? Math.round((item.pctSum / item.count) * 10) / 10 : 0;
        return item;
      });

      return {
        date: todayStr,
        activeCount: active.length,
        avgPct: avgPct,
        todayAddedPct: todayAddedPct,
        todayRecords: todayRecords,
        tenDayIndex: tenDayIndex,
        dayInCycle: dayInCycle,
        daysLeftInCycle: 10 - dayInCycle + 1,
        groups: groups
      };
    },

    getNavLayout: function () {
      return (state && state.settings && state.settings.navLayout === 'classic') ? 'classic' : 'hub5';
    },

    /* ===== 番茄钟强制前台锁屏 & 夜间自律守夜模式 ===== */
    getPomoStrict: function () {
      var ps = (state.settings && state.settings.pomoStrict) || {};
      return {
        enabled: !!ps.enabled,
        graceSec: Math.max(5, Math.min(120, parseInt(ps.graceSec, 10) || 15)),
        maxLeaves: Math.max(1, Math.min(10, parseInt(ps.maxLeaves, 10) || 2))
      };
    },
    setPomoStrict: function (patch) {
      if (!state.settings) state.settings = {};
      var cur = this.getPomoStrict();
      state.settings.pomoStrict = Object.assign(cur, patch || {});
      this.save();
      this.emit();
      return state.settings.pomoStrict;
    },
    getNightDiscipline: function () {
      if (!state.settings) state.settings = {};
      if (!state.settings.nightDiscipline) {
        state.settings.nightDiscipline = {
          enabled: false, startTime: '23:00', endTime: '06:30',
          autoPopup: true, strictForeground: true, whiteNoise: false,
          activeSession: null, history: []
        };
      }
      return state.settings.nightDiscipline;
    },
    setNightDiscipline: function (patch) {
      var cur = this.getNightDiscipline();
      Object.assign(cur, patch || {});
      this.save();
      this.emit();
      return cur;
    },
    isInNightDisciplineWindow: function (nowDate) {
      var cfg = this.getNightDiscipline();
      var d = nowDate instanceof Date ? nowDate : new Date();
      var curMin = d.getHours() * 60 + d.getMinutes();
      var sm = TimeUtil.toMin(cfg.startTime || '23:00');
      var em = TimeUtil.toMin(cfg.endTime || '06:30');
      if (sm === em) return false;
      if (sm > em) {
        // 跨午夜（例如 23:00 ~ 06:30）
        return curMin >= sm || curMin < em;
      }
      return curMin >= sm && curMin < em;
    },
    startNightDiscipline: function (nowDate) {
      var cfg = this.getNightDiscipline();
      var d = nowDate instanceof Date ? nowDate : new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
      var ds = DateUtil.toStr(d);
      var sess = {
        startedAt: d.getTime(),
        startDate: ds,
        startHHMM: hhmm,
        targetEndTime: cfg.endTime || '06:30',
        leaveCount: 0,
        violated: false
      };
      cfg.activeSession = sess;
      if (this.logSleepOnset) {
        this.logSleepOnset(hhmm, { date: ds, source: 'night_discipline' });
      }
      this.save(true);
      this.emit();
      return sess;
    },
    recordNightDisciplineLeave: function (awaySec) {
      var cfg = this.getNightDiscipline();
      if (!cfg.activeSession) return null;
      cfg.activeSession.leaveCount = (cfg.activeSession.leaveCount || 0) + 1;
      var grace = this.getPomoStrict().graceSec || 15;
      if (cfg.strictForeground && (awaySec >= grace || cfg.activeSession.leaveCount > 2)) {
        cfg.activeSession.violated = true;
      }
      this.save(true);
      return cfg.activeSession;
    },
    completeNightDiscipline: function (nowDate) {
      var cfg = this.getNightDiscipline();
      var sess = cfg.activeSession;
      if (!sess) return null;
      var d = nowDate instanceof Date ? nowDate : new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var endHHMM = pad(d.getHours()) + ':' + pad(d.getMinutes());
      var durMin = Math.max(1, Math.round((d.getTime() - (sess.startedAt || d.getTime())) / 60000));
      var success = !sess.violated;
      var pts = success ? 15 : 0;
      if (pts > 0 && state.pomodoro) {
        state.pomodoro.points = (Number(state.pomodoro.points) || 0) + pts;
        state.pomodoro.earned = (Number(state.pomodoro.earned) || 0) + pts;
        if (state.pomodoro.mode === 'gacha') {
          // 1 积分 = 180 合成玉；`|| 180` 已经把缺省值兜住了，后面那层 `|| 10` 永远走不到
          state.pomodoro.jade = (Number(state.pomodoro.jade) || 0) + pts * ((global.POMO && global.POMO.JADE_PER_POINT) || 180);
        }
        if (Array.isArray(state.pomodoro.pointLog)) {
          state.pomodoro.pointLog.push({ date: DateUtil.toStr(d), n: pts, src: 'focus', note: '夜间自律守夜达标' });
        }
      }
      var rec = {
        date: DateUtil.toStr(d),
        startDate: sess.startDate,
        startTime: sess.startHHMM,
        endTime: endHHMM,
        durationMin: durMin,
        success: success,
        points: pts
      };
      if (!Array.isArray(cfg.history)) cfg.history = [];
      cfg.history.push(rec);
      if (cfg.history.length > 60) cfg.history = cfg.history.slice(-60);
      cfg.activeSession = null;
      // 若守夜满 30 分钟且当日尚未录入睡眠，自动同步一条睡眠记录
      if (durMin >= 30 && this.addSleep) {
        var wakeDate = DateUtil.toStr(d);
        var hasSleep = (state.sleeps || []).some(function (sl) { return sl && sl.date === wakeDate; });
        if (!hasSleep) {
          this.addSleep({
            date: wakeDate,
            start: sess.startHHMM,
            end: endHHMM,
            total: durMin,
            quality: success ? 'good' : 'ok',
            note: '夜间自律模式守夜记录'
          });
        }
      }
      this.save(true);
      this.emit();
      return rec;
    },
    cancelNightDiscipline: function () {
      var cfg = this.getNightDiscipline();
      cfg.activeSession = null;
      this.save(true);
      this.emit();
    },

    /**
     * 智能日程冲突检测：交叉扫描指定日期的【常规课程、期中/期末考试、定点日程、待办计划块】
     * 返回重叠冲突项列表 [{ date, a, b, overlapMin, start, end, summary }]
     */
    detectDayConflicts: function (dateStr) {
      var ds = dateStr || DateUtil.toStr(DateUtil.today());
      var items = [];
      var self = this;

      function addSlot(kind, id, title, startStr, endStr, extra) {
        if (!startStr || !endStr) return;
        var sMin = TimeUtil.toMin(startStr);
        var eMin = TimeUtil.toMin(endStr);
        if (!(eMin > sMin)) return;
        items.push(Object.assign({
          kind: kind,
          id: id || "",
          title: title || "",
          start: startStr,
          end: endStr,
          startMin: sMin,
          endMin: eMin
        }, extra || {}));
      }

      // 1) 当日生效课程
      var courses = this.coursesOnDate ? this.coursesOnDate(ds) : [];
      courses.forEach(function (c) {
        var st = "", et = "";
        if (c.timeMode === "custom" && c.startTime && c.endTime) {
          st = c.startTime; et = c.endTime;
        } else if (c.periodId) {
          var p = self.getPeriod(c.periodId);
          if (p) { st = p.start; et = p.end; }
        }
        addSlot("course", c.courseId || c.id, c.name, st, et, { location: c.location || "" });
      });

      // 2) 当日考试（期中/期末/测验）
      var exams = this.examsOf ? this.examsOf(ds) : [];
      exams.forEach(function (ex) {
        var eObj = ex.exam || {};
        var label = ex.examLabel || eObj.label || "考试";
        addSlot("exam", ex.id, ex.name + "（" + label + "）", eObj.start || "09:00", eObj.end || "11:00", {
          location: eObj.location || ex.location || ""
        });
      });

      // 3) 当日未完成定点日程
      var evs = this.eventsOf ? this.eventsOf(ds) : [];
      evs.forEach(function (ev) {
        if (!ev || ev.done || !ev.start) return;
        var et = ev.end && ev.end > ev.start ? ev.end : TimeUtil.fromMin(Math.min(1439, TimeUtil.toMin(ev.start) + 60));
        addSlot("event", ev.id, ev.title, ev.start, et, { location: ev.location || "" });
      });

      // 4) 当日待办计划时间块
      (state.activities || []).forEach(function (a) {
        if (!a || !a.planned || a.date !== ds || !a.start || !a.end) return;
        addSlot("planBlock", a.id, a.name || "计划学习", a.start, a.end, { taskId: a.taskId || "" });
      });

      items.sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });

      var KIND_CN = { course: "课程", exam: "考试", event: "日程", planBlock: "计划块" };
      var conflicts = [];
      for (var i = 0; i < items.length; i++) {
        for (var j = i + 1; j < items.length; j++) {
          var A = items[i], B = items[j];
          if (B.startMin >= A.endMin) break;
          // 同一门课的连堂或相同事件跳过
          if (A.kind === B.kind && A.id && A.id === B.id) continue;
          var ovStart = Math.max(A.startMin, B.startMin);
          var ovEnd = Math.min(A.endMin, B.endMin);
          var ovMin = ovEnd - ovStart;
          if (ovMin > 0) {
            var sStr = TimeUtil.fromMin(ovStart), eStr = TimeUtil.fromMin(ovEnd);
            conflicts.push({
              date: ds,
              a: A,
              b: B,
              overlapMin: ovMin,
              start: sStr,
              end: eStr,
              summary: "【" + (KIND_CN[A.kind] || A.kind) + "】" + A.title + " 与 【" + (KIND_CN[B.kind] || B.kind) + "】" + B.title + " 在 " + sStr + "–" + eStr + " 重叠 " + ovMin + " 分钟"
            });
          }
        }
      }
      return conflicts;
    },

    /** 计算指定日期的排程总负荷与分类时长 */
    dayLoadSummary: function (dateStr) {
      var ds = dateStr || DateUtil.toStr(DateUtil.today());
      var self = this;
      var courseMin = 0, examMin = 0, eventMin = 0, planBlockMin = 0;
      (this.coursesOnDate ? this.coursesOnDate(ds) : []).forEach(function (c) {
        if (c.timeMode === "custom" && c.startTime && c.endTime) {
          courseMin += Math.max(0, TimeUtil.diffMin(c.startTime, c.endTime));
        } else if (c.periodId) {
          var p = self.getPeriod(c.periodId);
          if (p) courseMin += Math.max(0, TimeUtil.diffMin(p.start, p.end));
        }
      });
      (this.examsOf ? this.examsOf(ds) : []).forEach(function (ex) {
        var eObj = ex.exam || {};
        examMin += Math.max(0, TimeUtil.diffMin(eObj.start || "09:00", eObj.end || "11:00"));
      });
      (this.eventsOf ? this.eventsOf(ds) : []).forEach(function (ev) {
        if (!ev || ev.done || !ev.start) return;
        var et = ev.end && ev.end > ev.start ? ev.end : TimeUtil.fromMin(Math.min(1439, TimeUtil.toMin(ev.start) + 60));
        eventMin += Math.max(0, TimeUtil.diffMin(ev.start, et));
      });
      (state.activities || []).forEach(function (a) {
        if (!a || !a.planned || a.date !== ds || !a.start || !a.end) return;
        planBlockMin += Math.max(0, TimeUtil.diffMin(a.start, a.end));
      });
      var totalMin = courseMin + examMin + eventMin + planBlockMin;
      var conflicts = this.detectDayConflicts(ds);
      return {
        date: ds,
        courseMin: courseMin,
        examMin: examMin,
        eventMin: eventMin,
        planBlockMin: planBlockMin,
        totalMin: totalMin,
        totalHours: Math.round(totalMin / 6) / 10,
        level: totalMin >= 480 ? "heavy" : (totalMin >= 300 ? "moderate" : "light"),
        conflicts: conflicts
      };
    },

    /** 记录已完成一次外部文件导出备份 */
    markBackupExported: function (dateStr) {
      if (!state.settings) state.settings = {};
      state.settings.lastBackupAt = dateStr || DateUtil.toStr(DateUtil.today());
      this.save();
      return state.settings.lastBackupAt;
    },

    /** 延后周期性备份提醒 */
    snoozeBackupRemind: function (days) {
      if (!state.settings) state.settings = {};
      var d = DateUtil.addDays(DateUtil.today(), Number(days) || 7);
      state.settings.backupRemindSnoozeUntil = DateUtil.toStr(d);
      this.save();
      return state.settings.backupRemindSnoozeUntil;
    },

    /** 评估当前本地数据安全与备份健康状态 */
    backupHealth: function () {
      var st = state.settings || {};
      var todayStr = DateUtil.toStr(DateUtil.today());
      var totalRecords =
        (state.courses || []).length +
        (state.tasks || []).length +
        (state.plans || []).length +
        (state.events || []).length +
        (state.notes || []).length +
        (state.diaries || []).length +
        (state.ledger || []).length;
      var lastAt = st.lastBackupAt || "";
      var daysSince = null;
      if (lastAt && /^\d{4}-\d{2}-\d{2}/.test(lastAt)) {
        var dLast = DateUtil.parse(lastAt.slice(0, 10));
        if (dLast) daysSince = Math.max(0, DateUtil.diffDays(DateUtil.today(), dLast));
      }
      var remindCycle = Number(st.backupRemindDays) || 7;
      var snoozeUntil = st.backupRemindSnoozeUntil || "";
      var snoozed = !!(snoozeUntil && snoozeUntil >= todayStr);
      var shouldRemind = totalRecords >= 3 && !snoozed && (daysSince === null || daysSince >= remindCycle);
      var status = totalRecords === 0 ? "empty" : ((daysSince !== null && daysSince < remindCycle) ? "safe" : "warn");
      return {
        totalRecords: totalRecords,
        lastBackupAt: lastAt,
        daysSinceBackup: daysSince,
        remindCycle: remindCycle,
        snoozed: snoozed,
        shouldRemind: shouldRemind,
        status: status
      };
    },

    setNavLayout: function (mode) {
      if (!state.settings) state.settings = {};
      state.settings.navLayout = (mode === 'classic') ? 'classic' : 'hub5';
      this.save();
      return state.settings.navLayout;
    },

    /**
     * 睡眠债务（滚动累积）
     *   缺口 deficit = max(0, 需求 − 实睡)；盈余 surplus = max(0, 实睡 − 需求)
     *   debt[i] = clamp(debt[i−1] + deficit − surplus, 0, CAP)
     * 没记录的夜不算「欠债」，只算「没数据」（has:false，不推进债务）。
     */
    sleepDebt: function (n) {
      n = n || 7;
      var SM = (typeof window !== 'undefined' && window.SleepModel) ||
               (typeof global !== 'undefined' && global.SleepModel) || null;
      var need = (SM && SM.CONST && SM.CONST.NEED_MIN) || 480;
      var CAP = 900;                       // 15h 封顶，防长期缺记录时数字失控
      var days = [], debt = 0, today = DateUtil.today();

      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var st = this.nightStats(ds);
        var total = st ? st.total : null;
        var deficit = 0, surplus = 0;
        if (total != null) {
          deficit = Math.max(0, need - total);
          surplus = Math.max(0, total - need);
          debt = Math.max(0, Math.min(CAP, debt + deficit - surplus));
        }
        days.push({ date: ds, total: total, has: !!st,
                    deficit: deficit, surplus: surplus, debt: debt });
      }

      var known = days.filter(function (d) { return d.has; });
      var avg = 0;
      if (known.length) {
        var sum = 0;
        known.forEach(function (d) { sum += d.total; });
        avg = Math.round(sum / known.length);
      }
      return {
        need: need, cap: CAP, days: days, debt: debt,
        debtH: Math.round(debt / 6) / 10,                 // 分钟 -> 小时（1 位小数）
        knownNights: known.length,
        avgMin: avg,
        recoverDays: debt > 0 ? Math.ceil(debt / 60) : 0  // 每晚多睡 1 小时需几天补回
      };
    },

    /**
     * 某天的课业负荷：第一节几点、是否「早八」、共几节。
     * 早八阈值：开始时间 ≤ earlyBy（默认 09:00）。
     */
    courseLoadOn: function (dateStr, earlyBy) {
      earlyBy = earlyBy || '09:00';
      var list = this.coursesOnDate(dateStr) || [];
      var times = [];
      list.forEach(function (c) {
        var t = (global.Store || this).courseTime(c);
        if (t) times.push(t);
      });
      times.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
      if (!times.length) {
        return { has: false, count: 0, firstStart: '', isEarly: false, earlyBy: earlyBy };
      }
      return {
        has: true,
        count: times.length,
        firstStart: times[0].start,
        isEarly: times[0].start <= earlyBy,
        earlyBy: earlyBy
      };
    },

    /**
     * 课表联动：把「有早八的上课日」与「没有早八的上课日」分开对比睡眠。
     * 只看「有课 + 有睡眠记录」的日子；无课日（周末/假期）不进对比，
     * 否则周末补觉会把「非早八」一侧拉高，制造假差异。
     */
    courseLink: function (n, earlyBy) {
      n = n || 28;
      earlyBy = earlyBy || '09:00';
      var early = [], late = [], unknown = 0, today = DateUtil.today();

      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var load = this.courseLoadOn(ds, earlyBy);
        if (!load.has) continue;
        var st = this.nightStats(ds);
        if (!st) { unknown++; continue; }
        (load.isEarly ? early : late).push({
          date: ds, q: st.q, total: st.total, firstStart: load.firstStart
        });
      }

      function avg(arr, key) {
        if (!arr.length) return 0;
        var s = 0;
        arr.forEach(function (x) { s += x[key]; });
        return s / arr.length;
      }

      var eq = avg(early, 'q'), lq = avg(late, 'q');
      var em = avg(early, 'total'), lm = avg(late, 'total');
      var both = early.length > 0 && late.length > 0;
      return {
        earlyBy: earlyBy,
        earlyDays: early, lateDays: late, unknown: unknown,
        earlyAvgQ: eq, lateAvgQ: lq, deltaQ: both ? eq - lq : 0,
        earlyAvgMin: em, lateAvgMin: lm, deltaMin: both ? em - lm : 0,
        hasData: early.length + late.length > 0
      };
    },

    /** 今天起 n 天内最近的一节「早八」课（看板把警觉度曲线和早八叠在一起用） */
    nextEarlyClass: function (n, earlyBy) {
      n = n || 7;
      earlyBy = earlyBy || '09:00';
      var today = DateUtil.today();
      for (var i = 0; i < n; i++) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, i));
        var load = this.courseLoadOn(ds, earlyBy);
        if (!load.has || !load.isEarly) continue;
        var list = this.coursesOnDate(ds), first = null, ft = null;
        list.forEach(function (c) {
          var t = (global.Store || this).courseTime(c);
          if (t && (!ft || t.start < ft.start)) { ft = t; first = c; }
        });
        if (!ft) continue;
        return {
          date: ds, start: ft.start, end: ft.end,
          name: (first && (first.name || first.courseName)) || '早课'
        };
      }
      return null;
    },

    /**
     * 睡眠规律性（近 n 夜就寝/起床时刻的分散度 -> 0–100 得分）。
     * 用圆周统计（circular mean / SD），避免「23:50 与 00:10」被线性均值算成中午。
     *   - bedSD / wakeSD：就寝、起床时刻的圆周标准差（分钟）
     *   - score：avgSD=0 ->100，avgSD≥90 ->0（90 分钟分散已基本谈不上规律）
     */
    sleepRegularity: function (n) {
      n = n || 14;
      var nights = [], today = DateUtil.today();
      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var st = this.nightStats(ds);
        if (st && st.bed != null && st.wake != null) {
          nights.push({ date: ds, bed: st.bed, wake: st.wake });
        }
      }
      if (nights.length < 2) {
        return { hasData: false, known: nights.length, bedSD: null, wakeSD: null,
                 avgSD: null, score: null, bedMean: null, wakeMean: null, nights: nights };
      }
      function circMean(arr) {
        var sx = 0, sy = 0;
        arr.forEach(function (t) {
          var a = t / 1440 * 2 * Math.PI;
          sx += Math.cos(a); sy += Math.sin(a);
        });
        var ang = Math.atan2(sy, sx);
        if (ang < 0) ang += 2 * Math.PI;
        return ang / (2 * Math.PI) * 1440;
      }
      function circSD(arr) {
        var sx = 0, sy = 0;
        arr.forEach(function (t) {
          var a = t / 1440 * 2 * Math.PI;
          sx += Math.cos(a); sy += Math.sin(a);
        });
        var R = Math.sqrt(sx * sx + sy * sy) / arr.length;
        if (R >= 1) return 0;
        return Math.sqrt(-2 * Math.log(R)) * (1440 / (2 * Math.PI));
      }
      var bedVals = nights.map(function (x) { return x.bed; });
      var wakeVals = nights.map(function (x) { return x.wake; });
      var bedSD = circSD(bedVals), wakeSD = circSD(wakeVals);
      var avgSD = (bedSD + wakeSD) / 2;
      var score = Math.max(0, Math.min(100, Math.round(100 - (avgSD / 90) * 100)));
      return {
        hasData: true, known: nights.length,
        bedSD: Math.round(bedSD), wakeSD: Math.round(wakeSD), avgSD: Math.round(avgSD),
        score: score,
        bedMean: Math.round(circMean(bedVals)),
        wakeMean: Math.round(circMean(wakeVals)),
        nights: nights
      };
    },

    /**
     * 深睡 / REM 占比（近 n 夜的平均占比 + 是否落在健康区间）。
     * 健康区间取自小米详情页参考范围：深睡 15%–20%、REM 20%–25%。
     * 没有深睡/REM 字段（只有总时长）的夜不计入占比统计。
     */
    deepRemRatio: function (n) {
      n = n || 14;
      var nights = [], today = DateUtil.today();
      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var st = this.nightStats(ds);
        if (st && st.total > 0 && st.deep != null && st.rem != null) {
          nights.push({
            date: ds,
            deepPct: st.deep / st.total * 100,
            remPct: st.rem / st.total * 100,
            total: st.total
          });
        }
      }
      if (!nights.length) {
        return { hasData: false, known: 0, nights: nights };
      }
      var avg = function (k) {
        var s = 0;
        nights.forEach(function (x) { s += x[k]; });
        return s / nights.length;
      };
      var ad = avg('deepPct'), ar = avg('remPct');
      return {
        hasData: true, known: nights.length,
        avgDeep: Math.round(ad * 10) / 10,
        avgRem: Math.round(ar * 10) / 10,
        deepRange: [15, 20], remRange: [20, 25],
        deepOk: ad >= 15 && ad <= 20,
        remOk: ar >= 20 && ar <= 25,
        nights: nights
      };
    },

    /**
     * 社交时差（Social Jet Lag）：上课日（有早八）与自由日（无早八/无课）的
     * 「睡眠中点」之差。中点 = (就寝 + 醒来) / 2，用圆周差避免跨午夜误算。
     *   - schoolMid / freeMid：两侧睡眠中点的圆周均值（分钟）
     *   - gapMin：两者之差（分钟）
     */
    socialJetLag: function (n) {
      n = n || 28;
      var school = [], free = [], today = DateUtil.today();
      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var st = this.nightStats(ds);
        if (!st || st.bed == null || st.wake == null) continue;
        var mid = ((st.bed + st.wake) / 2) % 1440;
        var load = this.courseLoadOn(ds);
        if (load.has && load.isEarly) school.push(mid);
        else free.push(mid);   // 无课日 + 有课但非早八，都算「自由日」
      }
      function circMean(arr) {
        if (!arr.length) return null;
        var sx = 0, sy = 0;
        arr.forEach(function (t) { var a = t / 1440 * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); });
        var ang = Math.atan2(sy, sx);
        if (ang < 0) ang += 2 * Math.PI;
        return ang / (2 * Math.PI) * 1440;
      }
      function circDiff(a, b) {
        if (a == null || b == null) return null;
        var d = Math.abs(a - b) % 1440;
        return d > 720 ? 1440 - d : d;
      }
      var sm = circMean(school), fm = circMean(free);
      return {
        hasData: school.length > 0 || free.length > 0,
        both: school.length > 0 && free.length > 0,
        schoolMid: sm == null ? null : Math.round(sm), schoolN: school.length,
        freeMid: fm == null ? null : Math.round(fm), freeN: free.length,
        gapMin: circDiff(sm, fm)
      };
    },

    /** 近 n 天夜间质量序列（按醒来日归属，复用 nightStats） */
    recentNights: function (n) {
      n = n || 14;
      var today = DateUtil.today(), out = [];
      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var st = this.nightStats(ds);
        out.push({ date: ds, q: st ? st.q : null, min: st ? st.total : null });
      }
      return out;
    },

    /** 连续低质量睡眠预警：从最近往回数连续 q<0.5 的夜，并给近 7 天平均质量 */
    lowSleepStreak: function () {
      var nights = this.recentNights(14).filter(function (x) { return x.q != null; });
      var streak = 0;
      for (var i = nights.length - 1; i >= 0; i--) {
        if (nights[i].q != null && nights[i].q < 0.5) streak++;
        else break;
      }
      var last7 = this.recentNights(7).filter(function (x) { return x.q != null; });
      var avg = last7.length ? last7.reduce(function (s, x) { return s + x.q; }, 0) / last7.length : null;
      var lowCount7 = nights.filter(function (x) { return x.q != null && x.q < 0.5; }).length;
      return {
        has: nights.length > 0,
        streak: streak,
        avg7: avg == null ? null : Math.round(avg * 100),
        lowCount7: lowCount7
      };
    },

    /** 睡眠 ↔ 专注相关性：有睡眠记录且有专注记录的同日配对，算 Pearson r 与分组均值 */
    sleepFocusCorr: function (n) {
      n = n || 28;
      var today = DateUtil.today();
      var focusByDate = {};
      var sessions = (state.pomodoro && state.pomodoro.sessions) || [];
      sessions.forEach(function (s) {
        if (!s.date || s.minutes == null) return;
        focusByDate[s.date] = (focusByDate[s.date] || 0) + s.minutes;
      });
      var pairs = [];
      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        var st = this.nightStats(ds);
        if (!st || st.q == null) continue;
        if (focusByDate[ds] == null) continue;
        pairs.push({ q: st.q, f: focusByDate[ds] });
      }
      if (pairs.length < 5) return { has: false, n: pairs.length };
      var n2 = pairs.length;
      var mq = pairs.reduce(function (s, p) { return s + p.q; }, 0) / n2;
      var mf = pairs.reduce(function (s, p) { return s + p.f; }, 0) / n2;
      var cov = 0, vq = 0, vf = 0;
      pairs.forEach(function (p) {
        var dq = p.q - mq, df = p.f - mf;
        cov += dq * df; vq += dq * dq; vf += df * df;
      });
      var r = (vq && vf) ? cov / Math.sqrt(vq * vf) : 0;
      var good = pairs.filter(function (p) { return p.q >= 0.7; });
      var bad = pairs.filter(function (p) { return p.q < 0.5; });
      var avg = function (arr) {
        return arr.length ? Math.round(arr.reduce(function (s, p) { return s + p.f; }, 0) / arr.length) : null;
      };
      return {
        has: true, n: n2, r: Math.round(r * 100) / 100,
        goodAvg: avg(good), badAvg: avg(bad), goodN: good.length, badN: bad.length
      };
    },

    /**
     * 日记心情 × 睡眠质量。
     *
     * 配对口径：日记日期 D 记的心情，配「醒来日是 D」的那一夜。
     * 也就是说——晚上写日记时，你写的是「今天（从今早这副身体开始）过得怎么样」，
     * 影响的是今早醒来那一次睡眠。反过来配「当晚」会把还没发生的睡眠算进去。
     *
     * 两个方向都返回，因为它们回答的是不同问题：
     *   · moodGood / moodBad —— 睡好和睡差时，心情差多少（睡眠 → 心情）
     *   · sleepHappy / sleepLow —— 心情好和心情差的那几天，前一晚各睡多久（心情 ← 睡眠）
     *
     * @param {number} n 回看天数，默认 60（日记不是每天都写，窗口给宽一点）
     */
    moodSleepCorr: function (n) {
      n = n || 60;
      var today = DateUtil.today();
      var score = {};
      MOODS.forEach(function (m, i) { score[m.key] = 5 - i; });   // great=5 … low=1

      var moodByDate = {};
      (state.diaries || []).forEach(function (d) {
        if (d && d.date && d.mood && score[d.mood] != null) moodByDate[d.date] = score[d.mood];
      });

      var pairs = [];
      for (var i = n - 1; i >= 0; i--) {
        var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
        if (moodByDate[ds] == null) continue;
        var st = this.nightStats(ds);            // 醒来日 = 日记当天
        if (!st || st.q == null) continue;
        pairs.push({ m: moodByDate[ds], q: st.q, min: st.total || 0 });
      }

      var NEED = 7;
      if (pairs.length < NEED) return { has: false, n: pairs.length, need: NEED };

      var k = pairs.length;
      var mm = pairs.reduce(function (s, p) { return s + p.m; }, 0) / k;
      var mq = pairs.reduce(function (s, p) { return s + p.q; }, 0) / k;
      var cov = 0, vm = 0, vq = 0;
      pairs.forEach(function (p) {
        var dm = p.m - mm, dq = p.q - mq;
        cov += dm * dq; vm += dm * dm; vq += dq * dq;
      });
      var r = (vm && vq) ? cov / Math.sqrt(vm * vq) : 0;

      var avg = function (arr, key) {
        return arr.length ? Math.round(arr.reduce(function (s, p) { return s + p[key]; }, 0) / arr.length * 100) / 100 : null;
      };
      var good = pairs.filter(function (p) { return p.q >= 0.7; });
      var bad = pairs.filter(function (p) { return p.q < 0.5; });
      var happy = pairs.filter(function (p) { return p.m >= 4; });
      var low = pairs.filter(function (p) { return p.m <= 2; });

      return {
        has: true, n: k,
        r: Math.round(r * 100) / 100,
        moodAll: Math.round(mm * 100) / 100,
        moodGood: avg(good, 'm'), moodBad: avg(bad, 'm'),
        sleepHappy: avg(happy, 'min'), sleepLow: avg(low, 'min'),
        nGood: good.length, nBad: bad.length, nHappy: happy.length, nLow: low.length
      };
    },
  };

  if (global.Store) {
    Object.assign(global.Store, StorePlanner);
  }
  global.StorePlanner = StorePlanner;
  if (global.CP && global.CP.register) global.CP.register('StorePlanner', StorePlanner);
})(typeof window !== 'undefined' ? window : globalThis);
