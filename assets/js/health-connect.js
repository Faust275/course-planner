/* ==========================================================
 * 健康联动（Android Health Connect）Web 桥
 * ----------------------------------------------------------
 * 原生插件在 Capacitor 安卓侧读取系统睡眠记录；本文件只负责：
 *   1) 探测插件与 Health Connect 是否可用；
 *   2) 发起授权、读取近 N 天睡眠会话；
 *   3) 把原生会话规范成本应用睡眠记录结构（source = 'hc'）。
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

  /**
   * 把一条原生睡眠会话映射成本应用的睡眠记录结构。
   * Health Connect 的 SleepSessionRecord 通常只有「清醒/离床」细分，
   * 深睡/浅睡/REM 不暴露，故留空；与截图导入字段形状保持一致。
   */
  function toSleepRecord(s) {
    if (!s || !s.date) return null;
    return {
      date: s.date,
      start: s.start || '23:00',
      end: s.end || '07:00',
      total: (typeof s.totalMinutes === 'number') ? s.totalMinutes : null,
      awake: (typeof s.awakeMinutes === 'number') ? s.awakeMinutes : null,
      deep: null, light: null, rem: null,
      efficiency: null, awakenings: null,
      source: 'hc'
    };
  }

  /** 取最近一晚（按 startTime 倒序），用于回填弹窗 */
  function latest(sessions) {
    if (!sessions || !sessions.length) return null;
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
      source: 'hc'
    };
  }

  /** 把 readMetrics 的返回收敛成记录数组（过滤无效项） */
  function mapMetrics(res) {
    var days = (res && res.days) || [];
    var out = [];
    for (var i = 0; i < days.length; i++) {
      var r = toMetricRecord(days[i]);
      if (r) out.push(r);
    }
    return out;
  }

  // 最近一次成功拉取的缓存（选项 A：打开 App 自动拉取后用，弹窗打开即回填）
  var _cache = null;            // { rec: sleepRecord, at: ts }
  var _metricCache = null;      // { days: [metricRecord], at: ts }
  var CACHE_TTL = 6 * 3600 * 1000;

  /** 把 readSleep 的返回收敛成最近一晚的睡眠记录（或 null） */
  function latestRecord(res) {
    var sessions = (res && res.sessions) || [];
    var raw = latest(sessions);
    return raw ? toSleepRecord(raw) : null;
  }

  var HealthConnect = {
    /** 插件与 Health Connect 是否可用 */
    available: function () {
      if (!plugin()) return Promise.resolve(false);
      return invoke('isAvailable', {})
        .then(function (r) { return !!(r && r.available); })
        .catch(function () { return false; });
    },
    /** 发起系统授权（会弹出 Health Connect 授权界面） */
    request: function () { return invoke('requestHealthPermissions', {}); },
    /** 读取近 days 天睡眠会话：{ sessions: [...] } */
    read: function (days) { return invoke('readSleep', { days: days || 14 }); },
    /** 读取近 days 天每日活动量汇总：{ days: [{date,steps,calories,distance}] } */
    readMetrics: function (days) { return invoke('readMetrics', { days: days || 14 }); },
    toSleepRecord: toSleepRecord,
    toMetricRecord: toMetricRecord,
    latest: latest,

    /**
     * 选项 A：打开 App 时静默拉取最近一晚睡眠 + 每日活动量并缓存。
     * 全程无提示、无授权弹窗；仅在「已安装 + 已授权」时干活，否则静默跳过。
     * @returns {Promise<boolean>} 是否成功拿到任一数据
     */
    autoSync: function () {
      return HealthConnect.available().then(function (ok) {
        if (!ok) return false;
        return HealthConnect.read(14).then(function (res) {
          var rec = latestRecord(res);
          if (rec) _cache = { rec: rec, at: Date.now() };
          return HealthConnect.readMetrics(14).then(function (mres) {
            var recs = mapMetrics(mres);
            if (recs.length) _metricCache = { days: recs, at: Date.now() };
            return !!(rec || recs.length);
          }).catch(function () { return !!rec; });
        }).catch(function () { return false; });
      });
    },
    /** 取缓存的最近一晚睡眠（6 小时内有效），否则 null */
    getCached: function () {
      if (_cache && (Date.now() - _cache.at) < CACHE_TTL) return _cache.rec;
      return null;
    },
    /** 取缓存的每日活动量数组（6 小时内有效），否则 null */
    getCachedMetrics: function () {
      if (_metricCache && (Date.now() - _metricCache.at) < CACHE_TTL) return _metricCache.days;
      return null;
    },
    /** 取某天的活动量（来自缓存），无则返回 null */
    getMetricForDate: function (dateStr) {
      if (!_metricCache || (Date.now() - _metricCache.at) >= CACHE_TTL) return null;
      var arr = _metricCache.days || [];
      for (var i = 0; i < arr.length; i++) if (arr[i].date === dateStr) return arr[i];
      return null;
    },
    /** 清空缓存（如用户改用手动/截图后） */
    clearCache: function () { _cache = null; _metricCache = null; }
  };

  // 暴露纯函数给单测
  HealthConnect._test = { toSleepRecord: toSleepRecord, toMetricRecord: toMetricRecord, latest: latest, mapMetrics: mapMetrics };

  global.HealthConnect = HealthConnect;
})(typeof window !== 'undefined' ? window : this);
