/* ==========================================================
 * 健康联动（Android Health Connect）Web 桥
 * ----------------------------------------------------------
 * 原生插件在 Capacitor 安卓侧读取系统睡眠记录、每日活动量与锻炼记录；本文件负责：
 *   1) 探测插件与 Health Connect 状态（status / available / openSettings）；
 *   2) 发起授权、读取近 N 天睡眠会话、每日活动量与运动/锻炼会话（workouts）；
 *   3) 对手环常见的「夜间分段睡眠」做跨段聚合，并过滤午睡防覆盖；
 *   4) 把原生会话规范成本应用睡眠 / 活动 / 锻炼记录结构（source = 'hc'），并提供统一落盘入口。
 *
 * 全部交互都走 window.Capacitor.Plugins.HealthConnect；
 * 非 Capacitor 环境（浏览器 / iOS）下所有方法安全降级为「不可用」。
 * ========================================================== */
(function (global) {
  'use strict';

  var PLUGIN = 'HealthConnect';

  function plugin() {
    return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins[PLUGIN];
  }

  function invoke(method, args) {
    var p = plugin();
    if (!p || typeof p[method] !== 'function') return Promise.reject(new Error('health-connect-unavailable'));
    return p[method](args || {});
  }

  function hmToMin(hm) {
    if (!hm || typeof hm !== 'string') return null;
    var m = hm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /**
   * 判定一条睡眠会话是否为白天小憩（午睡）：
   * 入睡时刻在 11:00–17:00 之间且单段睡眠时长 < 150 分钟。
   * 过滤午睡可防止下午睡了 30 分钟把昨晚 7.5 小时的主睡眠覆盖掉。
   */
  function isDaytimeNap(s) {
    if (!s) return false;
    var stMin = hmToMin(s.start);
    var enMin = hmToMin(s.end);
    var dur = typeof s.totalMinutes === 'number' ? s.totalMinutes : 0;
    if (stMin == null) return false;
    if (stMin >= 660 && stMin <= 1020 && (enMin == null || enMin <= 1140) && dur > 0 && dur < 150) {
      return true;
    }
    return false;
  }

  /**
   * 推断一条主睡眠会话归属的「起床日」（与 Store.sleeps 以醒来当天记账的口径对齐）：
   */
  function wakeDateOf(s) {
    if (!s || !s.date) return '';
    if (s.endTime && typeof s.endTime === 'string' && s.startTime && typeof s.startTime === 'string') {
      return s.date;
    }
    var stMin = hmToMin(s.start);
    var enMin = hmToMin(s.end);
    if (stMin != null && enMin != null && stMin >= 1080 && enMin < 720 && !s._wakeDateFixed) {
      return s.date;
    }
    return s.date;
  }

  /**
   * 针对小米手环 / Zepp Life / 小米运动健康常见的「夜间清醒分段」做同夜合并，并剔除午睡：
   */
  function mergeNightSessions(sessions) {
    if (!Array.isArray(sessions) || !sessions.length) return [];
    var valid = sessions.filter(function (s) { return s && s.date && !isDaytimeNap(s); });
    if (!valid.length) return [];

    var asc = valid.slice().sort(function (a, b) {
      var x = a.startTime || (a.date + 'T' + (a.start || '00:00'));
      var y = b.startTime || (b.date + 'T' + (b.start || '00:00'));
      return x < y ? -1 : (x > y ? 1 : 0);
    });

    var merged = [];
    for (var i = 0; i < asc.length; i++) {
      var cur = Object.assign({}, asc[i]);
      if (!merged.length) {
        merged.push(cur);
        continue;
      }
      var prev = merged[merged.length - 1];
      var canMerge = false;
      var gapMin = 0;
      if (prev.endTime && cur.startTime) {
        var t1 = Date.parse(prev.endTime);
        var t2 = Date.parse(cur.startTime);
        if (!isNaN(t1) && !isNaN(t2)) {
          gapMin = Math.max(0, Math.round((t2 - t1) / 60000));
          if (gapMin <= 120) canMerge = true;
        }
      } else if (prev.date === cur.date) {
        canMerge = true;
      }

      if (canMerge) {
        prev.endTime = cur.endTime || prev.endTime;
        prev.end = cur.end || prev.end;
        if (cur.date && cur.date > prev.date) prev.date = cur.date;
        prev.totalMinutes = (Number(prev.totalMinutes) || 0) + (Number(cur.totalMinutes) || 0);
        prev.awakeMinutes = (Number(prev.awakeMinutes) || 0) + (Number(cur.awakeMinutes) || 0) + gapMin;
        if (prev.deepMinutes != null || cur.deepMinutes != null) {
          prev.deepMinutes = (Number(prev.deepMinutes) || 0) + (Number(cur.deepMinutes) || 0);
        }
        if (prev.lightMinutes != null || cur.lightMinutes != null) {
          prev.lightMinutes = (Number(prev.lightMinutes) || 0) + (Number(cur.lightMinutes) || 0);
        }
        if (prev.remMinutes != null || cur.remMinutes != null) {
          prev.remMinutes = (Number(prev.remMinutes) || 0) + (Number(cur.remMinutes) || 0);
        }
        prev.awakenings = (Number(prev.awakenings) || 0) + (Number(cur.awakenings) || 0) + 1;
      } else {
        merged.push(cur);
      }
    }

    merged.sort(function (a, b) {
      var x = a.startTime || (a.date + 'T' + (a.start || '00:00'));
      var y = b.startTime || (b.date + 'T' + (b.start || '00:00'));
      return x < y ? 1 : (x > y ? -1 : 0);
    });
    return merged;
  }

  /**
   * 把一条原生睡眠会话映射成本应用的睡眠记录结构。
   */
  function toSleepRecord(s) {
    if (!s || !s.date) return null;
    var total = (typeof s.totalMinutes === 'number') ? s.totalMinutes : null;
    var awake = (typeof s.awakeMinutes === 'number') ? s.awakeMinutes : null;
    var deep = (typeof s.deepMinutes === 'number' && s.deepMinutes > 0) ? s.deepMinutes : null;
    var light = (typeof s.lightMinutes === 'number' && s.lightMinutes > 0) ? s.lightMinutes : null;
    var rem = (typeof s.remMinutes === 'number' && s.remMinutes > 0) ? s.remMinutes : null;
    var awakenings = (typeof s.awakenings === 'number' && s.awakenings > 0) ? s.awakenings : null;
    var eff = null;
    if (typeof s.efficiency === 'number') eff = s.efficiency;
    else if (total != null && total > 0 && awake != null && awake >= 0 && (deep != null || light != null || rem != null)) {
      eff = Math.round(total / (total + awake) * 100);
    }
    var quality = s.quality || (eff != null ? (eff >= 88 ? 'good' : (eff < 74 ? 'bad' : 'normal')) : 'normal');
    return {
      date: wakeDateOf(s),
      start: s.start || '23:00',
      end: s.end || '07:00',
      total: total,
      awake: awake,
      deep: deep,
      light: light,
      rem: rem,
      efficiency: eff,
      awakenings: awakenings,
      avgHr: (typeof s.avgHr === 'number' && s.avgHr > 0) ? Math.round(s.avgHr) : null,
      spo2: (typeof s.spo2 === 'number' && s.spo2 > 0) ? Math.round(s.spo2) : null,
      quality: quality,
      source: 'hc'
    };
  }

  /** 取最近一晚主睡眠（经过午睡过滤与分段合并，按 startTime 倒序） */
  function latest(sessions) {
    if (!sessions || !sessions.length) return null;
    var merged = mergeNightSessions(sessions);
    if (merged.length) return merged[0];
    var sorted = sessions.slice().sort(function (a, b) {
      var x = a.startTime || '', y = b.startTime || '';
      return x < y ? 1 : (x > y ? -1 : 0);
    });
    return sorted[0];
  }

  /** 把一条原生每日活动量映射成本应用结构 */
  function toMetricRecord(s) {
    if (!s || !s.date) return null;
    return {
      date: s.date,
      steps: (typeof s.steps === 'number') ? s.steps : 0,
      calories: (typeof s.calories === 'number') ? Math.round(s.calories) : 0,
      distance: (typeof s.distance === 'number') ? Math.round(s.distance) : 0,
      activeMinutes: (typeof s.activeMinutes === 'number') ? Math.round(s.activeMinutes) : 0,
      avgHr: (typeof s.avgHr === 'number' && s.avgHr > 0) ? Math.round(s.avgHr) : null,
      source: 'hc'
    };
  }

  /** 把一条原生锻炼会话（ExerciseSessionRecord / 手环运动记录）映射成本应用结构 */
  function toWorkoutRecord(w) {
    if (!w) return null;
    var wDate = w.date || (typeof w.startTime === 'string' && w.startTime.length >= 10 ? w.startTime.slice(0, 10) : '');
    if (!wDate) return null;
    var dur = (typeof w.durationMinutes === 'number') ? Math.round(w.durationMinutes)
      : ((typeof w.duration === 'number') ? Math.round(w.duration) : 30);
    if (dur <= 0) dur = 1;
    var sportType = String(w.type || w.exerciseType || 'run').toLowerCase();
    var typeMap = {
      'running': 'run', '56': 'run', '57': 'treadmill',
      'walking': 'walk', '79': 'walk',
      'biking': 'cycle', '8': 'cycle', '9': 'cycle',
      'swimming': 'swim', '73': 'swim', '74': 'swim',
      'badminton': 'badminton', '2': 'badminton',
      'basketball': 'basketball', '4': 'basketball',
      'strength_training': 'strength', '80': 'strength', '81': 'strength',
      'yoga': 'yoga', '83': 'yoga',
      'jump_rope': 'rope', '37': 'rope'
    };
    var normType = typeMap[sportType] || (['run', 'treadmill', 'walk', 'cycle', 'swim', 'rope', 'badminton', 'basketball', 'strength', 'yoga', 'freestyle'].indexOf(sportType) >= 0 ? sportType : 'freestyle');
    return {
      date: wDate,
      type: normType,
      name: w.title || w.name || '',
      start: w.start || '17:00',
      end: w.end || '',
      duration: dur,
      calories: (typeof w.calories === 'number') ? Math.round(w.calories) : 0,
      distance: (typeof w.distance === 'number') ? Math.round(w.distance) : 0,
      avgHr: (typeof w.avgHr === 'number' && w.avgHr > 0) ? Math.round(w.avgHr) : null,
      maxHr: (typeof w.maxHr === 'number' && w.maxHr > 0) ? Math.round(w.maxHr) : null,
      steps: (typeof w.steps === 'number' && w.steps > 0) ? Math.round(w.steps) : null,
      source: 'hc'
    };
  }

  function mapMetrics(res) {
    var days = (res && res.days) || [];
    var out = [];
    for (var i = 0; i < days.length; i++) {
      var r = toMetricRecord(days[i]);
      if (r) out.push(r);
    }
    return out;
  }

  function mapWorkouts(res) {
    var list = (res && (res.workouts || res.sessions)) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = toWorkoutRecord(list[i]);
      if (r) out.push(r);
    }
    return out;
  }

  var _cache = null;            // { rec: sleepRecord, nights: [sleepRecord], at: ts }
  var _metricCache = null;      // { days: [metricRecord], at: ts }
  var _workoutCache = null;     // { workouts: [workoutRecord], at: ts }
  var CACHE_TTL = 6 * 3600 * 1000;

  function mapSleepNights(res) {
    var sessions = (res && res.sessions) || [];
    var merged = mergeNightSessions(sessions);
    var out = [];
    for (var i = 0; i < merged.length; i++) {
      var r = toSleepRecord(merged[i]);
      if (r) out.push(r);
    }
    return out;
  }

  function latestRecord(res) {
    var nights = mapSleepNights(res);
    if (nights.length) return nights[0];
    var sessions = (res && res.sessions) || [];
    var raw = latest(sessions);
    return raw ? toSleepRecord(raw) : null;
  }

  /**
   * 将单条 HC 睡眠记录并入 Store.sleeps：
   * - 同日已有 HC 记录：当起止时间、时长或深浅睡/REM/心率/血氧分期数据有变化时自动更新（解决手环二次补充同步分期后不更新的问题）；
   * - 同日已有非 HC 记录（手动/截图）：不覆盖；
   * - 同日无记录：新增。
   */
  function sameNullable(a, b) {
    return (a == null ? null : a) === (b == null ? null : b);
  }

  function persistSleepRecord(rec) {
    var S = global.Store;
    if (!rec || !rec.date || !S) return false;
    var list = (S.sleeps || []).filter(function (s) { return s.date === rec.date; });
    var hc = list.filter(function (s) { return s.source === 'hc'; })[0];
    if (hc) {
      if (hc.start === rec.start && hc.end === rec.end &&
          sameNullable(hc.total, rec.total) && sameNullable(hc.awake, rec.awake) &&
          sameNullable(hc.deep, rec.deep) && sameNullable(hc.light, rec.light) &&
          sameNullable(hc.rem, rec.rem) && sameNullable(hc.awakenings, rec.awakenings) &&
          sameNullable(hc.avgHr, rec.avgHr) && sameNullable(hc.spo2, rec.spo2)) {
        return false;
      }
      S.updateSleep(hc.id, rec);
      return 'updated';
    }
    if (list.length) return false;
    S.addSleep(rec);
    return 'added';
  }

  /**
   * 统一将当前缓存中的睡眠（近14晚）、每日活动量、锻炼会话全部写入 Store。
   */
  function persistAllToStore(opts) {
    opts = opts || {};
    var S = global.Store;
    var U = global.UI;
    var res = { sleepsAdded: 0, sleepsUpdated: 0, addedDates: [], metricsChanged: 0, workoutsChanged: 0 };
    if (!S) return res;
    var nights = (HealthConnect.getCachedNights && HealthConnect.getCachedNights()) || [];
    if (!nights.length) {
      var single = HealthConnect.getCached && HealthConnect.getCached();
      if (single) nights = [single];
    }
    nights.forEach(function (rec) {
      var r = persistSleepRecord(rec);
      if (r === 'added') {
        res.sleepsAdded++;
        res.addedDates.push(rec.date);
      } else if (r === 'updated') {
        res.sleepsUpdated++;
      }
    });
    var recs = HealthConnect.getCachedMetrics && HealthConnect.getCachedMetrics();
    if (recs && recs.length && S.addMetrics) {
      res.metricsChanged = S.addMetrics(recs) || 0;
    }
    var ws = HealthConnect.getCachedWorkouts && HealthConnect.getCachedWorkouts();
    if (ws && ws.length && S.addWorkouts) {
      res.workoutsChanged = S.addWorkouts(ws) || 0;
    }
    if (opts.toastOnSleepAdd && U && U.toast) {
      if (res.addedDates.length === 1) {
        U.toast('已自动同步睡眠（' + res.addedDates[0] + '）', 'ok');
      } else if (res.addedDates.length > 1) {
        U.toast('已自动同步近 ' + res.addedDates.length + ' 晚睡眠记录', 'ok');
      }
    }
    return res;
  }

  var HealthConnect = {
    /** 插件与 Health Connect 是否可用 */
    available: function () {
      if (!plugin()) return Promise.resolve(false);
      return invoke('isAvailable', {})
        .then(function (r) { return !!(r && r.available); })
        .catch(function () { return false; });
    },
    /** 读取 Health Connect 详细诊断状态：{ available, status, statusLabel, error } */
    status: function () {
      if (!plugin()) {
        return Promise.resolve({
          available: false,
          status: -1,
          statusLabel: '当前运行在浏览器环境，未挂载安卓 Health Connect 插件',
          error: null
        });
      }
      return invoke('isAvailable', {}).then(function (r) {
        return {
          available: !!(r && r.available),
          status: (r && typeof r.status === 'number') ? r.status : (r && r.available ? 3 : 1),
          statusLabel: (r && r.statusLabel) || (r && r.available ? '可用' : 'Health Connect 未安装或不可用'),
          error: (r && r.error) || null
        };
      }).catch(function (e) {
        return {
          available: false,
          status: -1,
          statusLabel: '插件调用异常',
          error: (e && e.message) || String(e)
        };
      });
    },
    /** 直接打开系统 Health Connect 权限管理 / 设置界面 */
    openSettings: function () {
      var p = plugin();
      if (!p || typeof p.openSettings !== 'function') {
        return Promise.resolve({ opened: false, error: '当前环境不支持直接跳转设置' });
      }
      return invoke('openSettings', {}).catch(function (e) {
        return { opened: false, error: (e && e.message) || String(e) };
      });
    },
    /** 发起系统授权（会弹出 Health Connect 授权界面） */
    request: function () { return invoke('requestHealthPermissions', {}); },
    /** 读取近 days 天睡眠会话：{ sessions: [...] } */
    read: function (days) { return invoke('readSleep', { days: days || 14 }); },
    /** 读取近 days 天每日活动量汇总：{ days: [{date,steps,calories,distance}] } */
    readMetrics: function (days) { return invoke('readMetrics', { days: days || 14 }); },
    /** 读取近 days 天锻炼记录（若原生端支持 readWorkouts 则读取，否则返回空数组） */
    readWorkouts: function (days) {
      var p = plugin();
      if (!p || typeof p.readWorkouts !== 'function') return Promise.resolve({ workouts: [] });
      return invoke('readWorkouts', { days: days || 14 }).catch(function () { return { workouts: [] }; });
    },
    toSleepRecord: toSleepRecord,
    toMetricRecord: toMetricRecord,
    toWorkoutRecord: toWorkoutRecord,
    mergeNightSessions: mergeNightSessions,
    latest: latest,
    persistSleepRecord: persistSleepRecord,
    persistAllToStore: persistAllToStore,

    /**
     * 打开 App 或手动同步时拉取近 14 天睡眠 + 每日活动量 + 锻炼记录并缓存。
     * 三路独立容错：任一权限未授或无数据不会阻断另外两路。
     */
    autoSync: function () {
      return HealthConnect.available().then(function (ok) {
        if (!ok) return false;
        var pSleep = HealthConnect.read(14).then(function (res) {
          var nights = mapSleepNights(res);
          var rec = nights[0] || latestRecord(res);
          if (rec) _cache = { rec: rec, nights: nights.length ? nights : [rec], at: Date.now() };
          return !!(rec || nights.length);
        }).catch(function () { return false; });

        var pMetrics = HealthConnect.readMetrics(14).then(function (mres) {
          var recs = mapMetrics(mres);
          if (recs.length) _metricCache = { days: recs, at: Date.now() };
          var wFromMetrics = mapWorkouts(mres);
          if (wFromMetrics.length) _workoutCache = { workouts: wFromMetrics, at: Date.now() };
          return recs.length > 0;
        }).catch(function () { return false; });

        var pWorkouts = HealthConnect.readWorkouts(14).then(function (wres) {
          var ws = mapWorkouts(wres);
          if (ws.length) _workoutCache = { workouts: ws, at: Date.now() };
          return ws.length > 0;
        }).catch(function () { return false; });

        return Promise.all([pSleep, pMetrics, pWorkouts]).then(function (results) {
          return !!(results[0] || results[1] || results[2]);
        });
      });
    },
    getCached: function () {
      if (_cache && (Date.now() - _cache.at) < CACHE_TTL) return _cache.rec;
      return null;
    },
    getCachedNights: function () {
      if (_cache && (Date.now() - _cache.at) < CACHE_TTL) return _cache.nights || (_cache.rec ? [_cache.rec] : null);
      return null;
    },
    getCachedMetrics: function () {
      if (_metricCache && (Date.now() - _metricCache.at) < CACHE_TTL) return _metricCache.days;
      return null;
    },
    getMetricForDate: function (dateStr) {
      if (!_metricCache || (Date.now() - _metricCache.at) >= CACHE_TTL) return null;
      var arr = _metricCache.days || [];
      for (var i = 0; i < arr.length; i++) if (arr[i].date === dateStr) return arr[i];
      return null;
    },
    getCachedWorkouts: function () {
      if (_workoutCache && (Date.now() - _workoutCache.at) < CACHE_TTL) return _workoutCache.workouts;
      return null;
    },
    getWorkoutsForDate: function (dateStr) {
      if (!_workoutCache || (Date.now() - _workoutCache.at) >= CACHE_TTL) return [];
      return (_workoutCache.workouts || []).filter(function (w) { return w.date === dateStr; });
    },
    clearCache: function () { _cache = null; _metricCache = null; _workoutCache = null; }
  };

  HealthConnect._test = {
    toSleepRecord: toSleepRecord,
    toMetricRecord: toMetricRecord,
    toWorkoutRecord: toWorkoutRecord,
    mergeNightSessions: mergeNightSessions,
    isDaytimeNap: isDaytimeNap,
    latest: latest,
    mapMetrics: mapMetrics,
    mapWorkouts: mapWorkouts,
    persistSleepRecord: persistSleepRecord,
    persistAllToStore: persistAllToStore
  };

  global.HealthConnect = HealthConnect;
})(typeof window !== 'undefined' ? window : this);
