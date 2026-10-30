/* ==========================================================
 * Store 备份域（v1.4.6 从 store.js 拆出）
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
  var Persist = ctx.Persist;
  var touch = ctx.touch;
  var DAY_NAMES = ctx.DAY_NAMES;
  var listeners = ctx.listeners;

  Object.assign(Store, {
    /** 已冷藏的健康记录条数（24 个月前的活动 / 三餐 / 睡眠 / 步数） */
    healthArchiveInfo: function () {
      return Persist.load('cp-store-health-archive').then(function (raw) {
        var o = null;
        try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
        var counts = {}, total = 0;
        ['activities', 'meals', 'sleeps', 'metrics'].forEach(function (k) {
          var n = o && Array.isArray(o[k]) ? o[k].length : 0;
          counts[k] = n;
          total += n;
        });
        return { total: total, counts: counts };
      }).catch(function () { return { total: 0, counts: {} }; });
    },

  /* ===== 自动备份：破坏性操作前的回滚点 ===== */
  BK_PREFIX: 'cp-backup-',
  BK_INDEX: 'cp-backup-index',
  BK_DAILY_KEY: 'cp-daily-backup-date',
  BK_MAX: 5,           // 手动 / 覆盖前的回滚点，最多 5 份
  BK_DAILY_MAX: 2,     // 每日自动快照，最多 2 份，且不挤占上面那 5 份
  BK_TOTAL_BYTES: 4 * 1024 * 1024,  // 备份总量软上限：超出则丢弃最旧的，避免 IndexedDB 无限膨胀

  /** 存一份当前数据的快照；返回备份元信息（异步，不阻塞调用方） */
  backupNow: function (reason) {
    var self = this;
    var ts = Date.now();
    var key = this.BK_PREFIX + ts;
    var str;
    try { str = this.exportJSON('full', { includeKeys: true }); } catch (e) { return Promise.resolve(null); }
    // 空数据没必要占备份位
    var probe = null;
    try { probe = JSON.parse(str); } catch (e) { probe = null; }
    if (!probe) return Promise.resolve(null);
    var n = (probe.courses || []).length + (probe.tasks || []).length +
            (probe.ledger || []).length + (probe.notes || []).length +
            (probe.plans || []).length + (probe.events || []).length +
            (probe.diaries || []).length;
    if (n === 0) return Promise.resolve(null);

    var meta = {
      key: key, ts: ts, reason: reason || '手动',
      // 中文按 UTF-8 是 3 字节，用字符数会低估约 3 倍，配额判断跟着失真
      bytes: (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(str).length : str.length,
      courses: (probe.courses || []).length,
      tasks: (probe.tasks || []).length,
      ledger: (probe.ledger || []).length,
      notes: (probe.notes || []).length,
      diaries: (probe.diaries || []).length
    };
    return Persist.save(key, str).then(function () {
      return self._bkAddIndex(meta);
    }).then(function () {
      return self._bkTrim();
    }).catch(function (e) {
      console.warn('备份失败', e);
      return null;
    }).then(function () { return meta; });
  },

  _bkReadIndex: function () {
    return Persist.load(this.BK_INDEX).then(function (raw) {
      if (!raw) return [];
      try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    }).catch(function () { return []; });
  },

  _bkAddIndex: function (meta) {
    var self = this;
    return this._bkReadIndex().then(function (list) {
      list.push(meta);
      list.sort(function (a, b) { return b.ts - a.ts; });   // 新的在前
      return Persist.save(self.BK_INDEX, JSON.stringify(list));
    });
  },

  /**
   * 按来源分层裁剪：每日自动最多 BK_DAILY_MAX 份，其余（手动 / 清空 / 覆盖前）
   * 最多 BK_MAX 份。这样每日快照不会把手动回滚点挤掉。
   */
  _bkTrim: function () {
    var self = this;
    return this._bkReadIndex().then(function (list) {
      var daily = [], other = [];
      list.forEach(function (m) { (m.reason === '每日自动' ? daily : other).push(m); });
      var keep = other.slice(0, self.BK_MAX).concat(daily.slice(0, self.BK_DAILY_MAX));
      // 必须在按字节配额裁剪前先按时间戳倒序（最新在先），保证优先淘汰旧备份，保护今日最新快照
      keep.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      // 总量配额：从新到旧累计，超出 BK_TOTAL_BYTES 的最旧备份一并丢弃，防 IndexedDB 膨胀。
      // 最新一份无论如何都保留 —— 否则单份超限时会把整批备份（含刚生成的那份）一起删光。
      var total = 0, kept = [];
      keep.forEach(function (m, i) {
        var b = m.bytes || 0;
        if (i === 0 || total + b <= self.BK_TOTAL_BYTES) {
          kept.push(m);
          total += b;
        }
      });
      keep = kept;
      var keepKeys = {};
      keep.forEach(function (m) { keepKeys[m.key] = 1; });
      var drop = list.filter(function (m) { return !keepKeys[m.key]; });
      if (!drop.length) return keep;
      return Promise.all(drop.map(function (m) { return Persist.remove(m.key); }))
        .then(function () { return Persist.save(self.BK_INDEX, JSON.stringify(keep)); })
        .then(function () { return keep; });
    });
  },

  /**
   * 每日自动快照：跨天首次启动补一份。用独立 key 记住「今天已备份」，
   * 不写进同步数据；数据为空时 backupNow 返回 null，不落日期，之后有数据再补。
   */
  maybeDailyBackup: function () {
    var self = this;
    var today;
    try { today = DateUtil.toStr(DateUtil.today()); } catch (e) { today = ''; }
    if (!today) return Promise.resolve(false);
    return Persist.load(this.BK_DAILY_KEY).then(function (last) {
      if (last === today) return false;
      return self.listBackups().then(function (list) {
        var exists = list.some(function (m) {
          return m.reason === '每日自动' && DateUtil.toStr(new Date(m.ts)) === today;
        });
        var p = exists ? Promise.resolve(true)
                       : self.backupNow('每日自动').then(function (meta) { return !!meta; });
        return p.then(function (ok) {
          if (!ok) return false;
          return Persist.save(self.BK_DAILY_KEY, today).then(function () { return true; });
        });
      });
    }).catch(function () { return false; });
  },

  /** 列出备份（新的在前） */
  listBackups: function () {
    return this._bkReadIndex();
  },

  /** 读取某份备份的 JSON 文本 */
  loadBackup: function (key) {
    if (!key || key.indexOf(this.BK_PREFIX) !== 0) return Promise.reject(new Error('备份不存在'));
    return Persist.load(key).then(function (raw) {
      if (!raw) throw new Error('备份内容已丢失');
      return raw;
    });
  },

  /** 从某份备份恢复：先把当前状态也存一份，再覆盖 */
  restoreBackup: function (key) {
    var self = this;
    return this.backupNow('恢复前').then(function () {
      return self.loadBackup(key);
    }).then(function (text) {
      self.importJSON(text);
      return true;
    });
  },

  /** 删除单份备份 */
  deleteBackup: function (key) {
    var self = this;
    return Persist.remove(key).then(function () {
      return self._bkReadIndex();
    }).then(function (list) {
      var keep = list.filter(function (m) { return m.key !== key; });
      return Persist.save(self.BK_INDEX, JSON.stringify(keep)).then(function () { return keep; });
    });
  },
  subscribe: function (fn) { listeners.push(fn); },
  emit: function () {
    touch();          // 统计缓存随写操作整体失效
    this.save();
    this.syncWidget();
    listeners.forEach(function (fn) {
      try { fn(Store.state); } catch (e) { console.error('Store listener error:', e); }
    });
  },

  _widgetSyncTimer: null,

  /**
   * 立即把桌面小组件快照同步给安卓原生端（单一桥接通道，消除双重写盘与双重广播）。
   */
  syncWidgetNow: function () {
    if (this._widgetSyncTimer) {
      clearTimeout(this._widgetSyncTimer);
      this._widgetSyncTimer = null;
    }
    try {
      var snap = JSON.stringify(this.snapshotForWidget());
      var bridge = (typeof global !== 'undefined' && global.AndroidBridge) ||
                   (typeof window !== 'undefined' && window.AndroidBridge);
      if (bridge && typeof bridge.pushSnapshot === 'function') {
        bridge.pushSnapshot(snap);
        return true;
      }
      var cap = (typeof global !== 'undefined' && global.Capacitor) ||
                (typeof window !== 'undefined' && window.Capacitor);
      var wb = cap && cap.Plugins && cap.Plugins.WidgetBridge;
      if (wb && typeof wb.pushSnapshot === 'function') {
        wb.pushSnapshot({ snapshot: snap }).catch(function () {});
        return true;
      }
      var tw = cap && cap.Plugins && cap.Plugins.TodayWidget;
      if (tw && typeof tw.update === 'function') {
        tw.update({ json: snap }).catch(function () {});
        return true;
      }
    } catch (e) { /* 桥接异常不影响主流程 */ }
    return false;
  },

  /**
   * 节流同步桌面小组件（默认 150ms 合并高频写操作；在测试或显式调用时若无定时器环境则同步执行）。
   */
  syncWidget: function (immediate) {
    if (immediate || typeof setTimeout === 'undefined') return this.syncWidgetNow();
    var self = this;
    if (this._widgetSyncTimer) clearTimeout(this._widgetSyncTimer);
    this._widgetSyncTimer = setTimeout(function () {
      self._widgetSyncTimer = null;
      self.syncWidgetNow();
    }, 150);
  },

  /**
   * 生成桌面小组件所需的精简快照：
   *   同时包含新版状态字段（dateLabel, weekNo, nextCourse, sleep, tasks）
   *   与旧版兼容字段（today, weekday, courses, nextTodo, nextExam, focusToday, sleepMinutes）。
   */
  snapshotForWidget: function (nowInput) {
    var st = Store.state;
    var nowClock = (nowInput instanceof Date) ? nowInput : new Date();
    var todayDate = new Date(nowClock.getFullYear(), nowClock.getMonth(), nowClock.getDate());
    var gd = todayDate.getDay();           // 0=周日
    var dow = gd === 0 ? 7 : gd;           // 转成 1-7（周一=1）
    var rawWeek = this.weekOf(todayDate);
    var sem = this.currentSemester();
    var inTerm = sem && rawWeek >= 1 && rawWeek <= (sem.weeks || 20);
    var weekNo = inTerm ? rawWeek : 0;
    var todayStr = DateUtil.toStr(todayDate);
    var dateLabel = (todayDate.getMonth() + 1) + '月' + todayDate.getDate() + '日 ' + (DAY_NAMES[dow - 1] || '');

    var rawCourses = inTerm ? this.coursesOnDate(todayStr) : [];
    var courses = rawCourses.map(function (c) {
      var t = Store.courseTime(c) || { start: '', end: '' };
      return { start: t.start || '', end: t.end || '', name: c.name, location: c.location || '' };
    }).sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); });

    // 计算当前/下一节课状态与毫秒时间戳（供安卓 Chronometer 精确倒计时）
    var hmNow = DateUtil.pad(nowClock.getHours()) + ':' + DateUtil.pad(nowClock.getMinutes());
    var toEpoch = function (hhmm) {
      var p = String(hhmm || '00:00').split(':');
      var d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate(),
                       parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, 0, 0);
      return d.getTime();
    };
    var nextCourse = { state: 'none', title: '', start: '', end: '', room: '', startEpoch: 0, endEpoch: 0, remain: 0 };
    if (courses.length) {
      var curHit = null, upHit = null;
      for (var i = 0; i < courses.length; i++) {
        var ci = courses[i];
        if (!ci.start || !ci.end) continue;
        if (ci.start <= hmNow && hmNow < ci.end) { curHit = ci; break; }
        if (hmNow < ci.start && !upHit) { upHit = ci; }
      }
      if (curHit) {
        nextCourse = {
          state: 'now',
          title: curHit.name || '',
          start: curHit.start,
          end: curHit.end,
          room: curHit.location || '',
          startEpoch: toEpoch(curHit.start),
          endEpoch: toEpoch(curHit.end),
          remain: courses.filter(function (x) { return x.start > hmNow; }).length
        };
      } else if (upHit) {
        nextCourse = {
          state: 'upcoming',
          title: upHit.name || '',
          start: upHit.start,
          end: upHit.end,
          room: upHit.location || '',
          startEpoch: toEpoch(upHit.start),
          endEpoch: toEpoch(upHit.end),
          remain: courses.filter(function (x) { return x.start >= upHit.start; }).length
        };
      } else {
        var lastC = courses[courses.length - 1];
        nextCourse = {
          state: 'done',
          title: lastC.name || '',
          start: lastC.start,
          end: lastC.end,
          room: lastC.location || '',
          startEpoch: 0,
          endEpoch: 0,
          remain: 0
        };
      }
    }

    // 昨夜睡眠摘要
    var sRec = this.sleepForDay ? this.sleepForDay(todayStr) : null;
    var sTier = this.sleepQualityTier ? this.sleepQualityTier(sRec) : { tier: 'none', label: '未记录', totalMin: 0 };
    var sleepObj = {
      totalMin: sTier.totalMin || 0,
      start: (sRec && sRec.start) || '',
      end: (sRec && sRec.end) || '',
      label: sTier.label || ''
    };

    // 待办统计（今日到期 & 已逾期，只看顶层未完成任务）
    var dueCount = 0, overdueCount = 0;
    (Store.state.tasks || []).forEach(function (t) {
      if (!t || t.parentId || t.status === 'done' || t.status === 'archived') return;
      if (!t.dueDate) return;
      if (t.dueDate < todayStr) overdueCount++;
      else if (t.dueDate === todayStr) dueCount++;
    });

    var pend = this.pendingTasks();
    var nextTodo = null;
    // 用户钉住的待办优先显示；钉的那条完成了就自动回落到最近一条
    var pinId = (Store.state.settings && Store.state.settings.widgetTodoId) || '';
    var pinTask = pinId && Store.getTask ? Store.getTask(pinId) : null;
    var t0 = (pinTask && pinTask.status !== 'done' && pinTask.status !== 'archived')
      ? pinTask
      : ((pend && pend.length) ? pend[0] : null);
    if (t0) {
      var rd = t0.dueDate ? DateUtil.daysLeft(t0.dueDate) : null;
      nextTodo = {
        id: t0.id || '',
        title: t0.title,
        pinned: t0 === pinTask,
        due: t0.dueDate || '',
        time: t0.dueTime || '',
        remainDays: (rd == null ? null : rd),
        done: t0.status === 'done'
      };
    }

    var nextExam = null;
    var exAll = [];
    Store.state.courses.forEach(function (c) {
      if (c.semesterId && c.semesterId !== st.currentSemesterId) return;
      if (c.exam && c.exam.date && c.exam.date >= todayStr) exAll.push(c);
    });
    exAll.sort(function (a, b) { return a.exam.date < b.exam.date ? -1 : 1; });
    if (exAll.length) {
      var e = exAll[0];
      nextExam = { name: e.name, date: e.exam.date, start: e.exam.start || '', location: e.location || '' };
    }

    var focusToday = (this.focusStats && this.focusStats().today) || 0;
    var sleepMin = (this.sleepMinutes && this.sleepMinutes(todayStr)) || 0;

    // 生成未来 14 天离线快照字典 days[YYYY-MM-DD]，让安卓桌面小组件（1×2 / 2×2 / 1×4 / 2×4）跨天零唤醒自动切日
    var daysMap = {};
    var self = this;
    for (var dOff = 0; dOff < 14; dOff++) {
      var dObj = DateUtil.addDays(todayDate, dOff);
      var dStr = DateUtil.toStr(dObj);
      var dGd = dObj.getDay();
      var dDow = dGd === 0 ? 7 : dGd;
      var dRawW = self.weekOf(dObj);
      var dInTerm = sem && dRawW >= 1 && dRawW <= (sem.weeks || 20);
      var dCourses = (dInTerm ? self.coursesOnDate(dStr) : []).map(function (c) {
        var ct = Store.courseTime(c) || { start: '', end: '' };
        return { start: ct.start || '', end: ct.end || '', name: c.name, location: c.location || '' };
      }).sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); });
      var dTodo = nextTodo;
      if (pend && pend.length && dOff > 0) {
        var tHit = pend.filter(function (tk) { return !tk.dueDate || tk.dueDate >= dStr; })[0] || pend[0];
        if (tHit) {
          var rd2 = tHit.dueDate ? DateUtil.diffDays(DateUtil.parse(tHit.dueDate), dObj) : null;
          dTodo = { title: tHit.title, due: tHit.dueDate || '', time: tHit.dueTime || '', remainDays: rd2 };
        }
      }
      daysMap[dStr] = {
        today: dStr,
        weekday: DAY_NAMES[dDow - 1] || '',
        dateLabel: (dObj.getMonth() + 1) + '月' + dObj.getDate() + '日 ' + (DAY_NAMES[dDow - 1] || ''),
        weekNo: dInTerm ? dRawW : 0,
        courses: dCourses,
        nextTodo: dTodo,
        nextExam: nextExam
      };
    }

    return {
      updatedAt: nowClock.getTime(),
      today: todayStr,
      weekday: DAY_NAMES[dow - 1] || '',
      dateLabel: dateLabel,
      weekNo: weekNo,
      nextCourse: nextCourse,
      sleep: sleepObj,
      tasks: { due: dueCount, overdue: overdueCount },
      courses: courses,
      nextTodo: nextTodo,
      nextExam: nextExam,
      focusToday: focusToday,
      sleepMinutes: sleepMin,
      widgetFormats: ['1x2', '2x2', '1x4', '2x4'],
      days: daysMap
    };
  },
  });
})(window);
