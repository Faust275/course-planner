

/* ==========================================================
 * Store —— 数据层
 * 全部数据持久化到 localStorage
 * ========================================================== */
(function (global) {
  'use strict';

  var KEY = 'course-planner:v1';

  /* ---------- 持久化抽象：优先 IndexedDB，file:// 或隐私模式回退 localStorage ---------- */
  var Persist = (function () {
    var DB_NAME = 'cp-store', STORE = 'kv', dbPromise = null;
    function idbOK() {
      try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null &&
          (location.protocol === 'http:' || location.protocol === 'https:');
      } catch (e) { return false; }
    }
    function openDB() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbPromise;
    }
    function load(key) {
      if (!idbOK()) {
        try { return Promise.resolve(localStorage.getItem(key)); } catch (e) { return Promise.resolve(null); }
      }
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(STORE, 'readonly');
            var r = tx.objectStore(STORE).get(key);
            r.onsuccess = function () { resolve(r.result != null ? r.result : localStorage.getItem(key)); };
            r.onerror = function () { resolve(localStorage.getItem(key)); };
          } catch (e) { resolve(localStorage.getItem(key)); }
        });
      }).catch(function () { try { return localStorage.getItem(key); } catch (e) { return null; } });
    }
    function save(key, str) {
      if (!idbOK()) {
        return new Promise(function (resolve, reject) {
          try { localStorage.setItem(key, str); resolve(); } catch (e) { reject(e); }
        });
      }
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          try {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(str, key);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error); };
          } catch (e) { reject(e); }
        });
      }).catch(function (e) {
        /* IDB 不可用（隐私/配额），回退 localStorage */
        try { localStorage.setItem(key, str); resolve(); }
        catch (e2) { return Promise.reject(e2); }
      });
    }
    /** 列出带指定前缀的 key（备份管理用）；IDB 与 localStorage 都支持 */
    function keys(prefix) {
      if (!idbOK()) {
        try {
          var out = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(prefix) === 0) out.push(k);
          }
          return Promise.resolve(out);
        } catch (e) { return Promise.resolve([]); }
      }
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          try {
            var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
            req.onsuccess = function () {
              resolve((req.result || []).filter(function (k) {
                return typeof k === 'string' && k.indexOf(prefix) === 0;
              }));
            };
            req.onerror = function () { resolve([]); };
          } catch (e) { resolve([]); }
        });
      }).catch(function () { return Promise.resolve([]); });
    }

    function remove(key) {
      if (!idbOK()) {
        try { localStorage.removeItem(key); } catch (e) {}
        return Promise.resolve();
      }
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { resolve(); };
            tx.onabort = function () { resolve(); };
          } catch (e) { resolve(); }
        });
      }).catch(function () {
        try { localStorage.removeItem(key); } catch (e) {}
      });
    }

    return { load: load, save: save, remove: remove, keys: keys, idbOK: idbOK };
  })();

  /* ---------- 预设 ---------- */
  var COLORS = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'
  ];

  var DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  function defaultPeriods() {
    var base = [
      ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
      ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'],
      ['19:00', '19:45'], ['19:55', '20:40']
    ];
    return base.map(function (p, i) {
      return { id: 'p' + (i + 1), name: '第' + (i + 1) + '节', start: p[0], end: p[1] };
    });
  }

  /** 规范化一个上课时段 */
  function normSlot(s) {
    s = s || {};
    var custom = s.timeMode === 'custom';
    return {
      day: s.day || 1,
      timeMode: custom ? 'custom' : 'period',
      periodId: custom ? '' : (s.periodId || ''),
      startTime: custom ? (s.startTime || '') : '',
      endTime: custom ? (s.endTime || '') : '',
      location: (s.location || '').trim()
    };
  }

  function defaultState() {
    var today = new Date();
    // 默认学期：本周一往前推 8 周作为学期开始，共 20 周
    var start = DateUtil.addDays(DateUtil.weekStart(today), -7 * 8);
    var sid = uid('sem');
    return {
      version: 2,
      model: 2,          // 数据模型版本：2 = 课程支持多时段 slots[]
      semesters: [{
        id: sid,
        name: '2026–2027 学年 秋季学期',
        startDate: DateUtil.toStr(start),
        weeks: 20
      }],
      currentSemesterId: sid,
      grades: {},          // { 学期id: { 记录key: 成绩记录 } }
      periods: defaultPeriods(),
      courses: [],
      tasks: [],
      taskSeq: {},
      // —— 日程 / 象限 ——
      settings: {
        trackMeal: true, trackSleep: true,
        theme: 'indigo', customColor: '#4f46e5',
        quiz: { right: 0, wrong: 0 },
        nav: { today: true, schedule: true, agenda: true, quadrant: true,
               tasks: true, pomodoro: true, settings: true },
        navOrder: [],   // 自定义模块顺序（空 = 用默认顺序）
        tagMeta: {},    // 标签自定义图标与颜色：{ '学习': {icon:'book', color:'#4f46e5'} }
        fav: { poems: [], words: [] },   // 收藏的每日一句（索引）与每日一词（单词）
        diet: {            // 每日热量目标与三餐配比
          goal: 0,         // 0 = 没设置
          ratio: { breakfast: 30, lunch: 40, dinner: 30, snack: 0 },
          protein: 0,      // 三大营养素目标（g），0 = 不显示
          fat: 0,
          carb: 0,
          profile: { sex: '', age: '', height: '', weight: '', activity: '1.375' }
        },
        gpa: {          // GPA 换算规则：scale = 满分绩点，rules = 由高到低的分段
          scale: 4,
          rules: [
            { min: 90, gp: 4 }, { min: 85, gp: 3.7 }, { min: 82, gp: 3.3 },
            { min: 78, gp: 3 }, { min: 75, gp: 2.7 }, { min: 72, gp: 2.3 },
            { min: 68, gp: 2 }, { min: 64, gp: 1.5 }, { min: 60, gp: 1 },
            { min: 0, gp: 0 }
          ]
        },
        asr: { prefer: 'auto', appId: '', apiKey: '', apiSecret: '' },
        ocr: { prefer: 'auto', provider: '', apiKey: '', endpoint: '', model: '' },
        background: { dataUrl: '', mask: 0.5 },
        // 子任务行为（详见「设置 → 子任务」）。前三项会互相影响，设置页有互斥提示
        subtask: {
          autoDoneParent: false,   // 子任务全完成 → 自动完成父任务
          cascadeDone: false,      // 父任务完成 → 未完成子任务一并完成
          orphanKeep: true,        // 删除父任务时子任务保留（提升为顶层）；false = 一起删
          showProgress: true       // 父任务显示 2/4 进度徽章
        },
        subtaskHinted: false,      // 是否已弹过「子任务默认行为」一次性说明
        // 日记（详见「设置 → 日记」）
        diary: {
          askDateAtNight: true,    // 0–4 点保存时询问归属「昨天 / 今天」
          showMoodStats: true      // 心情统计总开关（样本 < 7 天仍单独提示，不显示统计）
        },
        pet: {
          enabled: false,        // 开发者/自用开关：默认关闭
          src: '',               // 本地精灵图 base64（不随源码分发）
          frameW: 0, frameH: 0,  // 单帧像素尺寸
          rowWalk: 0,            // 行走帧所在行（sprite sheet 行索引）
          frames: 0,             // 行走帧数
          fps: 8,                // 行走帧率
          scale: 1,              // 显示缩放
          speed: 70,             // 游走速度 px/s
          gravity: 1400,         // 掉落重力
          bottomMargin: 10,      // 距屏幕底部距离
          rowReact: -1,          // 点击反应帧行（-1=无）
          reactFrames: 0
        }
      },
      pomodoro: {
        points: 0,          // 森林积分（种树 / 浇水）
        jade: 0,            // 合成玉（抽卡）
        mode: 'forest',     // 当前奖励机制：forest | gacha
        gacha: { pity6: 0, total: 0, ops: [], log: [], dailyGuaranteeDay: '', streakNo6: 0, streakNo5: 0 },
        earned: 0,          // 累计获得
        focusMinutes: 0,    // 累计专注分钟
        trees: [],
        sessions: [],
        timer: { running: false, endAt: 0, left: 0, duration: 25, taskId: '' }
      },
      plans: [],       // 计划（打卡 / 进度）
      ledger: [],      // 记账流水
      notes: [],       // 灵感速记
      diaries: [],     // 日记（一天一篇，key 为 YYYY-MM-DD）
      events: [],      // 一次性日程
      activities: [],  // 活动记录
      meals: [],       // 饮食记录
      sleeps: [],      // 睡眠记录
      achievements: { done: {} },  // 成就系统：{ done: { 成就id: { at: 时间戳 } } }
      usage: {}                // 功能使用次数：{ 功能key: 次数 }（历练成就用）
    };
  }

  /** 时间工具：HH:MM <-> 分钟 */
  var TimeUtil = {
    toMin: function (hhmm) {
      var p = (hhmm || '00:00').split(':');
      return (+p[0] || 0) * 60 + (+p[1] || 0);
    },
    /** 起止相差分钟，支持跨午夜（end < start 视为次日） */
    diffMin: function (start, end) {
      var a = TimeUtil.toMin(start), b = TimeUtil.toMin(end);
      var d = b - a;
      if (d < 0) d += 1440;
      return d;
    },
    /** 分钟 -> "1 小时 30 分钟" */
    humanMin: function (m) {
      m = Math.round(m);
      if (m <= 0) return '—';
      var h = Math.floor(m / 60), mm = m % 60;
      if (!h) return mm + ' 分钟';
      if (!mm) return h + ' 小时';
      return h + ' 小时 ' + mm + ' 分';
    },
    /** 把区间拆成跨午夜的两段（供绘图使用） */
    expand: function (start, end) { return expandRange(start, end); },
    addMin: function (hhmm, delta) {
      var t = (TimeUtil.toMin(hhmm) + delta + 1440) % 1440;
      return (t < 600 ? '0' : '') + Math.floor(t / 60) + ':' + ((t % 60) < 10 ? '0' : '') + (t % 60);
    }
  };

  /** 用餐类型默认时长（分钟） */
  var MEAL_TYPES = [
    { value: 'breakfast', label: '早餐', min: 20, emoji: '' },
    { value: 'lunch', label: '午餐', min: 35, emoji: '' },
    { value: 'dinner', label: '晚餐', min: 40, emoji: '' },
    { value: 'snack', label: '加餐', min: 10, emoji: '' }
  ];

  /** 活动类型（自带配色） */
  var ACT_TYPES = [
    { value: 'study', label: '学习', color: '#0ea5e9' },
    { value: 'exercise', label: '运动', color: '#10b981' },
    { value: 'social', label: '社交', color: '#f59e0b' },
    { value: 'rest', label: '休息放松', color: '#14b8a6' },
    { value: 'other', label: '其它', color: '#8b5cf6' }
  ];

  function actType(v) {
    for (var i = 0; i < ACT_TYPES.length; i++) if (ACT_TYPES[i].value === v) return ACT_TYPES[i];
    return ACT_TYPES[ACT_TYPES.length - 1];
  }

  /** 规范化一条食物明细 */
  function normFoodItem(it) {
    if (!it || typeof it !== 'object') return null;
    var n = String(it.n || '').trim();
    if (!n) return null;
    var kcal = Number(it.kcal);
    return {
      n: n,
      q: Number(it.q) > 0 ? Number(it.q) : 1,
      kcal: isNaN(kcal) ? 0 : kcal,
      p: isNaN(Number(it.p)) ? 0 : Number(it.p),
      f: isNaN(Number(it.f)) ? 0 : Number(it.f),
      c: isNaN(Number(it.c)) ? 0 : Number(it.c)
    };
  }

  /** 食物明细汇总（不四舍五入，供显示层处理） */
  function sumItems(items) {
    var s = { kcal: 0, p: 0, f: 0, c: 0 };
    (items || []).forEach(function (it) {
      var q = Number(it && it.q) || 0;
      s.kcal += (Number(it.kcal) || 0) * q;
      s.p += (Number(it.p) || 0) * q;
      s.f += (Number(it.f) || 0) * q;
      s.c += (Number(it.c) || 0) * q;
    });
    return s;
  }

  function r1(v) { return Math.round((Number(v) || 0) * 10) / 10; }

  function mealType(v) {
    for (var i = 0; i < MEAL_TYPES.length; i++) if (MEAL_TYPES[i].value === v) return MEAL_TYPES[i];
    return MEAL_TYPES[0];
  }

  /* ---------- 日期工具 ---------- */
  var DateUtil = {
    pad: function (n) { return n < 10 ? '0' + n : '' + n; },

    toStr: function (d) {
      return d.getFullYear() + '-' + DateUtil.pad(d.getMonth() + 1) + '-' + DateUtil.pad(d.getDate());
    },

    /** 解析 YYYY-MM-DD 为本地时间 Date（00:00:00） */
    parse: function (s) {
      if (!s) return null;
      var p = String(s).split('-');
      if (p.length !== 3) return null;
      return new Date(+p[0], +p[1] - 1, +p[2]);
    },

    today: function () {
      var d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    },

    addDays: function (d, n) {
      var x = new Date(d.getTime());
      x.setDate(x.getDate() + n);
      return x;
    },

    /** 加月份，day 超出目标月时夹到当月最后一天（1/31 + 1 -> 2/28） */
    addMonths: function (d, n) {
      var day = d.getDate();
      var m = d.getMonth() + n;
      var y = d.getFullYear() + Math.floor(m / 12);
      m = ((m % 12) + 12) % 12;
      var last = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, last));
    },

    /** 加年份，闰年 2/29 夹到 2/28 */
    addYears: function (d, n) {
      var day = d.getDate();
      var m = d.getMonth();
      var y = d.getFullYear() + n;
      var last = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, last));
    },

    /** 该日期所在周的周一 00:00 */
    weekStart: function (d) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var dow = x.getDay();            // 0=周日
      var diff = (dow === 0 ? -6 : 1 - dow);
      return DateUtil.addDays(x, diff);
    },

    /** 该日期所在周的周日 00:00 */
    weekEnd: function (d) {
      return DateUtil.addDays(DateUtil.weekStart(d), 6);
    },

    /** 起止日期之间包含多少整周（两端都先对齐到整周） */
    weeksBetween: function (a, b) {
      var monday = DateUtil.weekStart(a);
      var sunday = DateUtil.weekEnd(b);
      var days = DateUtil.diffDays(sunday, monday) + 1;
      return Math.max(1, Math.round(days / 7));
    },

    /** 相差天数（a - b），按本地日界计算 */
    diffDays: function (a, b) {
      var MS = 86400000;
      var ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
      var ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
      return Math.round((ua - ub) / MS);
    },

    /** ISO 星期：周一=1 ... 周日=7 */
    isoDow: function (d) {
      var w = d.getDay();
      return w === 0 ? 7 : w;
    },

    mdShort: function (d) {
      return (d.getMonth() + 1) + '.' + d.getDate();
    },

    /** "今天" / "明天" / "10.25" */
    human: function (str) {
      var d = DateUtil.parse(str);
      if (!d) return '';
      var diff = DateUtil.diffDays(d, DateUtil.today());
      if (diff === 0) return '今天';
      if (diff === 1) return '明天';
      if (diff === 2) return '后天';
      if (diff === -1) return '昨天';
      return DateUtil.mdShort(d);
    },

    /** 剩余天数：<0 已过期，0 今天 */
    daysLeft: function (str) {
      var d = DateUtil.parse(str);
      if (!d) return 999;
      return DateUtil.diffDays(d, DateUtil.today());
    },

    weekdayCN: function (d) {
      return DAY_NAMES[DateUtil.isoDow(d) - 1];
    },

    /** 当前时刻 HH:MM */
    nowHM: function () {
      var d = new Date();
      return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
             (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }
  };

  /* ---------- Store ---------- */
  var listeners = [];
  var state = null;

  /**
   * 数据版本号：每次写操作 +1。
   * 统计结果都按它做缓存键，写一次就整体失效，省得在每个写函数里手动清缓存
   * （手动清必然漏，漏了就会出现「改了课表，统计还是旧的」）。
   */
  var rev = 0;
  /** 单日统计缓存：{ '2025-01-01': { rev, val } } */
  var dayStatCache = {};
  /** 区间统计缓存：{ 'from|to': { rev, val } } */
  var rangeStatCache = {};

  function touch() {
    rev++;
    return rev;
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 把 (start, end) 拆成 0–1440 内的区间，跨午夜拆为两段 */
  function expandRange(start, end) {
    var a = TimeUtil.toMin(start), b = TimeUtil.toMin(end);
    if (b <= a) return [[a, 1440], [0, b]];
    return [[a, b]];
  }

  /**
   * 某一天「实际睡了多少分钟」。
   * 睡眠记录挂在入睡那天（date），所以一天真正睡着的时间由两段拼成：
   *   1. 昨晚（date-1）睡下、跨过午夜、今天早上醒来 —— 取 [00:00, end]
   *   2. 今晚（date）睡下、可能跨到明天 —— 取 [start, 24:00]
   * 这样「1/1 睡 23:00–7:00」不会在 1/1 记 8 小时、1/2 记 0 小时，
   * 而是 1/1 记 1 小时、1/2 记 7 小时，日内分布才和现实一致。
   * 同一夜的多段记录先合并，避免两段重叠被重复计时。
   * @param {string} _next 保留位（旧调用方传了次日日期），目前不使用
   */
  function sleepByNight(sleeps, dateStr, _next) {
    var d = DateUtil.parse(dateStr);
    if (!d) return 0;
    var prev = DateUtil.toStr(DateUtil.addDays(d, -1));
    var ranges = [];
    sleeps.forEach(function (r) {
      if (!r || !r.start || !r.end) return;
      var a = TimeUtil.toMin(r.start), b = TimeUtil.toMin(r.end);
      var overnight = b <= a;
      if (r.date === dateStr) {
        // 今晚这一段：只取今天之内能落下的部分
        ranges.push([a, overnight ? 1440 : b]);
      } else if (r.date === prev && overnight) {
        // 昨晚跨过来：只取今天早上那半截
        ranges.push([0, b]);
      }
    });
    return mergeTotal(ranges);
  }

  /** 合并重叠区间后返回总分钟数（避免重复计时） */
  function mergeTotal(ranges) {
    if (!ranges || !ranges.length) return 0;
    var arr = ranges.slice().sort(function (x, y) { return x[0] - y[0]; });
    var total = 0, cs = arr[0][0], ce = arr[0][1];
    for (var i = 1; i < arr.length; i++) {
      if (arr[i][0] > ce) { total += ce - cs; cs = arr[i][0]; ce = arr[i][1]; }
      else if (arr[i][1] > ce) ce = arr[i][1];
    }
    total += ce - cs;
    return Math.max(0, total);
  }

  /* ===== 计划类型 ===== */
  var PLAN_TYPES = {
    checkin: { name: '打卡', unitHint: '次' },
    progress: { name: '进度', unitHint: '页' },
    duration: { name: '时长', unitHint: '分钟' }
  };

  var PLAN_PERIODS = {
    daily: { name: '每天' },
    weekly: { name: '每周' },
    once: { name: '单次' }
  };

  /* ===== 统计范围 ===== */
  /**
   * 两种口径：
   *   cal  —— 自然日历（今天 / 本周一起算 / 本月 1 号起算 / 本学期），用于统计与复盘
   *   win  —— 滑动窗口（最近 N 天，含今天），用于记账这种「近 30 天花了多少」的场景
   * days 只在 win 口径下有意义；cal 口径的实际天数由日历决定，见 rangeDates()。
   */
  var RANGES = {
    day:   { key: 'day',   name: '今天', mode: 'cal', days: 1 },
    week:  { key: 'week',  name: '本周', mode: 'cal', days: 7 },
    month: { key: 'month', name: '本月', mode: 'cal', days: 30 },
    term:  { key: 'term',  name: '本学期', mode: 'cal', days: 120 },
    recent7:  { key: 'recent7',  name: '最近 7 天',  mode: 'win', days: 7 },
    recent30: { key: 'recent30', name: '最近 30 天', mode: 'win', days: 30 }
  };

  /** 记账页用的四档（自然口径为主，末档保留滑动窗口） */
  var LEDGER_RANGES = ['day', 'week', 'month', 'recent30'];

  /** 自然周 / 自然月的起止（周一为一周之始） */
  function weekBounds(d) {
    d = d || DateUtil.today();
    var s = DateUtil.weekStart(d);
    return { from: s, to: DateUtil.addDays(s, 6) };
  }
  function monthBounds(d) {
    d = d || DateUtil.today();
    var s = new Date(d.getFullYear(), d.getMonth(), 1);
    var e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: s, to: e };
  }

  /**
   * 日期区间（含两端）。
   * 「今天 / 本周 / 本月」的 to 一律截到今天——统计不该把未来的空白天算进分母。
   * @param {string} key RANGES 的 key
   * @param {object} [sem] 学期对象，默认当前学期（term 口径用）
   */
  function rangeDates(key, sem) {
    var R = RANGES[key] || RANGES.week;
    var today = DateUtil.today();

    if (R.mode === 'win') {
      var wf = DateUtil.addDays(today, -(R.days - 1));
      return { from: DateUtil.toStr(wf), to: DateUtil.toStr(today), days: R.days, key: R.key, mode: 'win' };
    }

    var from = today, to = today;
    if (R.key === 'day') {
      from = today; to = today;
    } else if (R.key === 'week') {
      var wb = weekBounds(today);
      from = wb.from; to = to < wb.to ? today : wb.to;
    } else if (R.key === 'month') {
      var mb = monthBounds(today);
      from = mb.from; to = today < mb.to ? today : mb.to;
    } else if (R.key === 'term') {
      var s = sem || (state && Store.currentSemester ? Store.currentSemester() : null);
      var start = (s && DateUtil.parse(s.startDate)) || DateUtil.weekStart(today);
      var weeks = (s && s.weeks) || 20;
      var end = DateUtil.addDays(start, weeks * 7 - 1);
      from = start;
      // 学期还没开学：空区间，由调用方显示提示
      if (today < start) { from = today; to = today; }
      else to = today < end ? today : end;
    }
    var n = DateUtil.diffDays(to, from) + 1;
    return { from: DateUtil.toStr(from), to: DateUtil.toStr(to), days: Math.max(1, n), key: R.key, mode: 'cal' };
  }

  /**
   * 参照区间：拿同样的口径往前挪一个周期，用来做「比上次」。
   * 今天 → 昨天；本周 → 上周；本月 → 上月；本学期 → 无（返回 null）；
   * 滑动窗口 → 等长的上一段，保证天数一致，可以直接比总量。
   * 自然口径的上月天数可能与本月不同，比较时请统一换成日均。
   */
  function compareRange(key, r) {
    r = r || rangeDates(key);
    var from = DateUtil.parse(r.from), to = DateUtil.parse(r.to);
    if (!from || !to) return null;
    if (r.key === 'day') {
      var y = DateUtil.addDays(from, -1);
      return { from: DateUtil.toStr(y), to: DateUtil.toStr(y), days: 1, key: 'day', mode: 'cal' };
    }
    if (r.key === 'week') {
      var pw = weekBounds(DateUtil.addDays(from, -1));
      return { from: DateUtil.toStr(pw.from), to: DateUtil.toStr(pw.to), days: 7, key: 'week', mode: 'cal' };
    }
    if (r.key === 'month') {
      var pm = monthBounds(DateUtil.addDays(from, -1));
      // 参照月同样截到「同一天数」，避免月末几天没得比
      var span = DateUtil.diffDays(to, from);
      var pmTo = DateUtil.addDays(pm.from, span);
      if (pmTo > pm.to) pmTo = pm.to;
      return {
        from: DateUtil.toStr(pm.from), to: DateUtil.toStr(pmTo),
        days: DateUtil.diffDays(pmTo, pm.from) + 1, key: 'month', mode: 'cal'
      };
    }
    if (r.key === 'term') return null;   // 没有「上一学期」的可靠数据，不做比较
    // 滑动窗口：紧邻的等长区间
    var n = r.days;
    var pf = DateUtil.addDays(from, -n);
    var pt = DateUtil.addDays(from, -1);
    return { from: DateUtil.toStr(pf), to: DateUtil.toStr(pt), days: n, key: r.key, mode: 'win' };
  }

  /** 日均（保留一位小数），供跨长度区间比较 */
  function perDay(total, days) {
    if (!days) return 0;
    return Math.round(total / days * 10) / 10;
  }

  /** 区间内每天的日期字符串 */
  function eachDate(from, to) {
    var out = [];
    var d = DateUtil.parse(from);
    var end = DateUtil.parse(to);
    var guard = 0;
    while (d && end && d <= end && guard < 400) {
      out.push(DateUtil.toStr(d));
      d = DateUtil.addDays(d, 1);
      guard++;
    }
    return out;
  }

  /* ===== 记账分类 ===== */
  var LEDGER_CATS = {
    expense: [
      { key: 'food', name: '餐饮', color: '#ef4444' },
      { key: 'transport', name: '交通', color: '#0ea5e9' },
      { key: 'shopping', name: '购物', color: '#8b5cf6' },
      { key: 'study', name: '学习', color: '#10b981' },
      { key: 'fun', name: '娱乐', color: '#f59e0b' },
      { key: 'medical', name: '医疗', color: '#14b8a6' },
      { key: 'other', name: '其他', color: '#94a3b8' }
    ],
    income: [
      { key: 'scholarship', name: '奖学金', color: '#10b981' },
      { key: 'parttime', name: '兼职', color: '#0ea5e9' },
      { key: 'allowance', name: '生活费', color: '#8b5cf6' },
      { key: 'other_in', name: '其他', color: '#94a3b8' }
    ]
  };

  /** 按 key 找分类（找不到归为「其他」） */
  function ledgerCat(type, key) {
    var list = LEDGER_CATS[type] || LEDGER_CATS.expense;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i];
    }
    return list[list.length - 1];
  }

  /* ===== 番茄钟 / 积分 / 养树：规则与树阶段 ===== */
  var POMO = {
    POINT_PER_MIN: 1,      // 每专注 1 分钟
    TASK_DONE: 10,         // 完成一个待办
    PLAN_CHECKIN: 2,       // 完成一次打卡
    PLAN_DONE: 30,         // 完成一个计划
    PLANT_COST: 100,       // 第一棵树
    PLANT_STEP: 30,        // 每多一棵，价格递增
    WATER_COST: 20,        // 浇一次水
    /* —— 抽卡机制 —— */
    JADE_PER_POINT: 160,   // 1 积分 = 160 合成玉
    PULL_COST: 600,        // 单抽 600 合成玉（= 1 积分）
    TEN_COST: 6000,        // 十连 6000 合成玉（= 10 积分）
    RATE_6: 2,             // 六星基础概率 %
    RATE_5: 8,
    RATE_4: 50,
    PITY_START: 50,        // 50 抽后概率递增
    PITY_STEP: 2,          // 每抽 +2%
    TEN_GUARANTEE: 5,      // 十连保底至少五星
    POT_MAX: 5,            // 潜能上限（干员最多 6 份复制，潜能 0~5）
    DUP_POINTS: { 6: 40, 5: 25, 4: 12, 3: 6 }  // 满潜能后，每多抽一份转化的积分（按星级）
  };

  var TREE_SPECIES = [
    { key: 'camphor', name: '樟树', crown: '#4c8c4a', crown2: '#3f7d3d', trunk: '#7a5c3a', price: 100 },
    { key: 'ginkgo', name: '银杏', crown: '#f0c04a', crown2: '#dfa93a', trunk: '#8a6a45', price: 130 },
    { key: 'maple', name: '枫树', crown: '#e0703c', crown2: '#c8542a', trunk: '#7a5c3a', price: 160 },
    { key: 'sakura', name: '樱花', crown: '#f2a3bd', crown2: '#e88aab', trunk: '#8a6a45', price: 200 },
    { key: 'pine', name: '松树', crown: '#3f7d4a', crown2: '#356b3f', trunk: '#6f5637', shape: 'cone', price: 140 },
    { key: 'birch', name: '白桦', crown: '#8fc46b', crown2: '#7bb45c', trunk: '#c9c2b6', price: 120 },
    { key: 'oak', name: '橡树', crown: '#4a8f52', crown2: '#3d7f45', trunk: '#6f5637', price: 220 },
    { key: 'plane', name: '梧桐', crown: '#7cb342', crown2: '#6aa83a', trunk: '#8a6a45', price: 180 }
  ];

  function speciesOf(key) {
    for (var i = 0; i < TREE_SPECIES.length; i++) {
      if (TREE_SPECIES[i].key === key) return TREE_SPECIES[i];
    }
    return TREE_SPECIES[0];
  }

  var TREE_STAGES = [
    { name: '种子', min: 0 },
    { name: '幼苗', min: 60 },
    { name: '小树', min: 120 },
    { name: '大树', min: 200 },
    { name: '果树', min: 320 }
  ];

  /* ==========================================================
   * 标签图标 / 配色
   * ========================================================== */

  /**
   * 常用标签预设：标签名命中时自动套用图标与颜色。
   * 共 10 组（学习 / 生活 / 工作 / 健康 / 运动 / 娱乐 / 社交 / 出行 / 饮食 / 其他）。
   */
  var TAG_PRESETS = [
    /* —— 学习 —— */
    { g: '学习', name: '学习', icon: 'book', color: '#4f46e5' },
    { g: '学习', name: '学习/英语', icon: 'lang', color: '#0ea5e9' },
    { g: '学习', name: '学习/数学', icon: 'calc', color: '#8b5cf6' },
    { g: '学习', name: '学习/专业课', icon: 'cap', color: '#6366f1' },
    { g: '学习', name: '学习/阅读', icon: 'bookOpen', color: '#14b8a6' },
    { g: '学习', name: '学习/作业', icon: 'pen', color: '#f59e0b' },
    { g: '学习', name: '学习/实验', icon: 'flask', color: '#06b6d4' },
    { g: '学习', name: '学习/编程', icon: 'code', color: '#0f766e' },
    { g: '学习', name: '学习/背诵', icon: 'idea', color: '#7c3aed' },
    { g: '学习', name: '学习/考试', icon: 'target', color: '#dc2626' },
    /* —— 生活 —— */
    { g: '生活', name: '生活', icon: 'home', color: '#10b981' },
    { g: '生活', name: '生活/家务', icon: 'sparkle', color: '#84cc16' },
    { g: '生活', name: '生活/洗漱', icon: 'drop', color: '#38bdf8' },
    { g: '生活', name: '生活/通勤', icon: 'bus', color: '#0ea5e9' },
    { g: '生活', name: '生活/收纳', icon: 'box', color: '#f59e0b' },
    { g: '生活', name: '生活/宠物', icon: 'paw', color: '#f97316' },
    { g: '生活', name: '生活/购物', icon: 'cart', color: '#ec4899' },
    /* —— 工作 —— */
    { g: '工作', name: '工作', icon: 'briefcase', color: '#1e40af' },
    { g: '工作', name: '工作/会议', icon: 'people', color: '#2563eb' },
    { g: '工作', name: '工作/写稿', icon: 'pen', color: '#4f46e5' },
    { g: '工作', name: '工作/邮件', icon: 'mail', color: '#0ea5e9' },
    { g: '工作', name: '工作/汇报', icon: 'chart', color: '#7c3aed' },
    { g: '工作', name: '工作/实习', icon: 'laptop', color: '#0891b2' },
    /* —— 健康 —— */
    { g: '健康', name: '健康', icon: 'heart', color: '#ef4444' },
    { g: '健康', name: '健康/睡眠', icon: 'moon', color: '#6366f1' },
    { g: '健康', name: '健康/吃药', icon: 'pill', color: '#f43f5e' },
    { g: '健康', name: '健康/就医', icon: 'pill', color: '#e11d48' },
    { g: '健康', name: '健康/冥想', icon: 'leaf', color: '#22c55e' },
    /* —— 运动 —— */
    { g: '运动', name: '运动', icon: 'dumbbell', color: '#f97316' },
    { g: '运动', name: '运动/跑步', icon: 'heartbeat', color: '#ef4444' },
    { g: '运动', name: '运动/球类', icon: 'ball', color: '#16a34a' },
    { g: '运动', name: '运动/骑行', icon: 'bike', color: '#0891b2' },
    { g: '运动', name: '运动/拉伸', icon: 'heartbeat', color: '#14b8a6' },
    /* —— 娱乐 —— */
    { g: '娱乐', name: '娱乐', icon: 'game', color: '#a855f7' },
    { g: '娱乐', name: '娱乐/电影', icon: 'film', color: '#6366f1' },
    { g: '娱乐', name: '娱乐/音乐', icon: 'music', color: '#ec4899' },
    { g: '娱乐', name: '娱乐/追剧', icon: 'tv', color: '#8b5cf6' },
    { g: '娱乐', name: '娱乐/画画', icon: 'brush', color: '#f59e0b' },
    /* —— 社交 —— */
    { g: '社交', name: '社交', icon: 'people', color: '#0ea5e9' },
    { g: '社交', name: '社交/聚会', icon: 'gift', color: '#ec4899' },
    { g: '社交', name: '社交/聊天', icon: 'chat', color: '#38bdf8' },
    { g: '社交', name: '社交/电话', icon: 'phone', color: '#22c55e' },
    /* —— 出行 —— */
    { g: '出行', name: '出行', icon: 'plane', color: '#0284c7' },
    { g: '出行', name: '出行/旅行', icon: 'pin', color: '#f59e0b' },
    { g: '出行', name: '出行/自驾', icon: 'car', color: '#64748b' },
    /* —— 饮食 —— */
    { g: '饮食', name: '饮食', icon: 'food', color: '#f97316' },
    { g: '饮食', name: '饮食/早餐', icon: 'coffee', color: '#f59e0b' },
    { g: '饮食', name: '饮食/饮品', icon: 'coffee', color: '#a16207' },
    { g: '饮食', name: '饮食/外卖', icon: 'bag', color: '#ef4444' },
    /* —— 其他 —— */
    { g: '其他', name: '其他', icon: 'dots', color: '#94a3b8' },
    { g: '其他', name: '重要', icon: 'star', color: '#f59e0b' },
    { g: '其他', name: '灵感', icon: 'idea', color: '#eab308' },
    { g: '其他', name: '未打标签', icon: 'dots', color: '#cbd5e1' }
  ];

  var TAG_GROUPS = ['学习', '生活', '工作', '健康', '运动', '娱乐', '社交', '出行', '饮食', '其他'];

  var PRESET_MAP = {};
  TAG_PRESETS.forEach(function (p) { PRESET_MAP[p.name] = p; });

  /** 没有预设也没有自定义时，按名字哈希出一个稳定的颜色 */
  function hashColor(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  function presetOf(tag) {
    var full = tagFull(tag);
    var parts = tagParts(full);
    return PRESET_MAP[full] || PRESET_MAP[parts.lv1] || null;
  }

  /** 标签元数据对象（可能尚未初始化） */
  function tagMeta() {
    if (!state.settings) state.settings = {};
    if (!state.settings.tagMeta || typeof state.settings.tagMeta !== 'object') {
      state.settings.tagMeta = {};
    }
    return state.settings.tagMeta;
  }

  /**
   * 取一个标签的展示样式
   * @returns { icon, color, own, preset }  icon 为空表示只用圆点
   */
  function tagStyle(tag) {
    var full = tagFull(tag);
    var parts = tagParts(full);
    var meta = tagMeta();
    var own = meta[full] || null;
    var up = parts.lv2 ? meta[parts.lv1] : null;
    var pre = presetOf(full);
    var color = (own && own.color) || (pre && pre.color) ||
                (up && up.color) || hashColor(full);
    var icon = '';
    if (own && 'icon' in own) icon = own.icon;
    else if (pre && pre.icon) icon = pre.icon;
    else if (up && up.icon) icon = up.icon;
    return { icon: icon || '', color: color, own: !!own, preset: !own && !!pre, full: full };
  }

  /** 拆出一二级：'学习 / 高数' → { lv1:'学习', lv2:'高数' } */
  function tagParts(tag) {
    var str = String(tag || '').trim().replace(/\s*\/\s*/g, '/').replace(/^\/+|\/+$/g, '');
    var i = str.indexOf('/');
    if (i < 0) return { lv1: str, lv2: '' };
    var a = str.slice(0, i).trim(), b = str.slice(i + 1).trim();
    return { lv1: a, lv2: b };
  }

  /** 规范化后的完整标签名（存储用） */
  function tagFull(tag) {
    var t = tagParts(tag);
    if (!t.lv1) return '';
    return t.lv2 ? t.lv1 + '/' + t.lv2 : t.lv1;
  }

  /** 两个标签是否匹配（支持一级命中其下所有二级） */
  function tagMatch(itemTag, filter) {
    if (!filter) return true;
    var f = tagParts(filter);
    var t = tagParts(itemTag);
    if (!f.lv2) return t.lv1 === f.lv1;        // 筛一级：同族即命中
    return (t.lv1 === f.lv1 && t.lv2 === f.lv2); // 筛二级：精确
  }

  function hasTag(tags, filter) {
    if (!filter) return true;
    for (var i = 0; i < (tags || []).length; i++) {
      if (tagMatch(tags[i], filter)) return true;
    }
    return false;
  }

  /** 归一化标签：数组或「逗号/空格分隔的字符串」→ 去重后的数组，支持 一级/二级 */
  function normalizeTags(v) {
    var arr = [];
    if (Array.isArray(v)) arr = v.slice();
    else if (typeof v === 'string') {
      // 含逗号时按逗号切（允许标签内有空格）；纯空格分隔则兼容旧习惯
      arr = /[,，;；]/.test(v) ? v.split(/[,，;；]+/) : v.split(/\s+/);
    }
    var out = [];
    arr.forEach(function (x) {
      var t = tagFull(x);
      if (t && out.indexOf(t) < 0) out.push(t);
    });
    return out.slice(0, 6);
  }

  function treeStage(growth) {
    var st = 0;
    for (var i = 0; i < TREE_STAGES.length; i++) {
      if (growth >= TREE_STAGES[i].min) st = i;
    }
    return st;
  }

  /** 截止时间比较：无日期排最后，同日按时间 */
  function compareDue(a, b) {
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;
    var da = a.dueDate || '9999-12-31';
    var db = b.dueDate || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    var ta = a.dueTime || '23:59';
    var tb = b.dueTime || '23:59';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return 0;
  }

  /* ==========================================================
   * 成就系统：定义与检测
   * ========================================================== */
  var ACH_TIER = {
    bronze: { color: '#cd7f32', label: '初级' },
    silver: { color: '#9aa7b5', label: '中级' },
    gold:   { color: '#ffb300', label: '高级' }
  };

  /* 成就分三类：抽卡 / 集卡 / 种树
   * - 累计型：带 metric + threshold（tree / streakNo6 / streakNo5 / coll3）
   * - 事件型：带 check() 函数（一次十连的特定结果，判定依据 gacha.lastTen） */
  var ACH_DEF = [
    /* —— 抽卡 —— */
    { id: 'gacha_all3', group: '抽卡', name: '绝世非皇', desc: '一次十连抽出的干员全部为三星', icon: 'star', tier: 'silver', points: 60,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.all3); } },
    { id: 'gacha_max4', group: '抽卡', name: '紫气东来', desc: '一次十连中最高星级仅为四星（不出五/六星）', icon: 'sparkle', tier: 'silver', points: 60,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.max4); } },
    { id: 'gacha_2six', group: '抽卡', name: '双黄蛋', desc: '一次十连中恰好抽出两个六星', icon: 'sun', tier: 'gold', points: 200,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.twoSix); } },
    { id: 'gacha_4six', group: '抽卡', name: '绝世欧皇', desc: '一次十连中抽出超过三个六星（≥4）', icon: 'crown', tier: 'gold', points: 250,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.fourSix); } },
    { id: 'gacha_no6_70', group: '抽卡', name: '七秩未逢星', desc: '连续 70 抽未出六星', icon: 'clock', tier: 'gold', points: 150,
      metric: 'streakNo6', threshold: 70 },
    { id: 'gacha_no5_30', group: '抽卡', name: '三十非五星', desc: '连续 30 抽未出五星', icon: 'moon', tier: 'silver', points: 50,
      metric: 'streakNo5', threshold: 30 },
    /* —— 集卡 —— */
    { id: 'coll3', group: '集卡', name: '集齐三星', desc: '集齐全部三星干员（共 22 名）', icon: 'box', tier: 'gold', points: 300,
      metric: 'coll3', threshold: 1 },
    /* —— 种树 —— */
    { id: 'tree3', group: '种树', name: '植树新手', desc: '种下 3 棵树', icon: 'leaf', tier: 'bronze', points: 30,
      metric: 'tree', threshold: 3 },
    { id: 'tree6', group: '种树', name: '绿意盎然', desc: '种下 6 棵树', icon: 'tree', tier: 'silver', points: 60,
      metric: 'tree', threshold: 6 },
    { id: 'tree9', group: '种树', name: '森之守护', desc: '种下 9 棵树', icon: 'tree', tier: 'gold', points: 120,
      metric: 'tree', threshold: 9 },

    /* —— 历练：各功能使用次数成就，分三档逐级解锁（1 / 10 / 100）——
     * 初出茅庐(1) → 小有心得(10, 需初出茅庐) → 炉火纯青(100, 需小有心得)
     * metric 用 'usage:<key>'，由 state.usage[<key>] 计次 */
    { id: 'use_course_1', group: '历练', name: '初出茅庐：课程表', desc: '首次使用课程表', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:course', threshold: 1 },
    { id: 'use_course_10', group: '历练', name: '小有心得：课程表', desc: '使用课程表 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:course', threshold: 10, req: 'use_course_1' },
    { id: 'use_course_100', group: '历练', name: '炉火纯青：课程表', desc: '使用课程表 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:course', threshold: 100, req: 'use_course_10' },
    { id: 'use_plan_1', group: '历练', name: '初出茅庐：计划', desc: '首次执行计划（打卡 / 记录进度）', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:plan', threshold: 1 },
    { id: 'use_plan_10', group: '历练', name: '小有心得：计划', desc: '执行计划 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:plan', threshold: 10, req: 'use_plan_1' },
    { id: 'use_plan_100', group: '历练', name: '炉火纯青：计划', desc: '执行计划 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:plan', threshold: 100, req: 'use_plan_10' },
    { id: 'use_ledger_1', group: '历练', name: '初出茅庐：记账', desc: '首次记账', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:ledger', threshold: 1 },
    { id: 'use_ledger_10', group: '历练', name: '小有心得：记账', desc: '记账 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:ledger', threshold: 10, req: 'use_ledger_1' },
    { id: 'use_ledger_100', group: '历练', name: '炉火纯青：记账', desc: '记账 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:ledger', threshold: 100, req: 'use_ledger_10' },
    { id: 'use_grade_1', group: '历练', name: '初出茅庐：成绩', desc: '首次记录成绩', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:grade', threshold: 1 },
    { id: 'use_grade_10', group: '历练', name: '小有心得：成绩', desc: '记录成绩 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:grade', threshold: 10, req: 'use_grade_1' },
    { id: 'use_grade_100', group: '历练', name: '炉火纯青：成绩', desc: '记录成绩 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:grade', threshold: 100, req: 'use_grade_10' },
    { id: 'use_meal_1', group: '历练', name: '初出茅庐：饮食', desc: '首次记录饮食', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:meal', threshold: 1 },
    { id: 'use_meal_10', group: '历练', name: '小有心得：饮食', desc: '记录饮食 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:meal', threshold: 10, req: 'use_meal_1' },
    { id: 'use_meal_100', group: '历练', name: '炉火纯青：饮食', desc: '记录饮食 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:meal', threshold: 100, req: 'use_meal_10' },
    { id: 'use_sleep_1', group: '历练', name: '初出茅庐：睡眠', desc: '首次记录睡眠', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:sleep', threshold: 1 },
    { id: 'use_sleep_10', group: '历练', name: '小有心得：睡眠', desc: '记录睡眠 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:sleep', threshold: 10, req: 'use_sleep_1' },
    { id: 'use_sleep_100', group: '历练', name: '炉火纯青：睡眠', desc: '记录睡眠 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:sleep', threshold: 100, req: 'use_sleep_10' },
    { id: 'use_focus_1', group: '历练', name: '初出茅庐：专注', desc: '首次完成一次专注', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:focus', threshold: 1 },
    { id: 'use_focus_10', group: '历练', name: '小有心得：专注', desc: '完成专注 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:focus', threshold: 10, req: 'use_focus_1' },
    { id: 'use_focus_100', group: '历练', name: '炉火纯青：专注', desc: '完成专注 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:focus', threshold: 100, req: 'use_focus_10' },
    { id: 'use_note_1', group: '历练', name: '初出茅庐：速记', desc: '首次使用速记', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:note', threshold: 1 },
    { id: 'use_note_10', group: '历练', name: '小有心得：速记', desc: '使用速记 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:note', threshold: 10, req: 'use_note_1' },
    { id: 'use_note_100', group: '历练', name: '炉火纯青：速记', desc: '使用速记 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:note', threshold: 100, req: 'use_note_10' },
    { id: 'use_event_1', group: '历练', name: '初出茅庐：日程', desc: '首次添加日程', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:event', threshold: 1 },
    { id: 'use_event_10', group: '历练', name: '小有心得：日程', desc: '添加日程 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:event', threshold: 10, req: 'use_event_1' },
    { id: 'use_event_100', group: '历练', name: '炉火纯青：日程', desc: '添加日程 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:event', threshold: 100, req: 'use_event_10' }
  ];

  /** 成就分类顺序：抽卡 / 集卡 / 种树 */
  var ACH_GROUPS = ['抽卡', '集卡', '种树', '历练'];

  /** 当前各成就指标的实际数值 */
  function achValue(metric) {
    var s = state;
    if (metric && metric.indexOf('usage:') === 0) {
      var uk = metric.slice(6);
      return (s.usage && s.usage[uk]) || 0;
    }
    if (metric === 'tree') return (s.pomodoro.trees || []).length;
    if (metric === 'streakNo6') return (s.pomodoro.gacha.streakNo6) || 0;
    if (metric === 'streakNo5') return (s.pomodoro.gacha.streakNo5) || 0;
    if (metric === 'coll3') {
      var pool = (global.AK_OPS || []).filter(function (o) { return o[1] === 3; });
      if (!pool.length) return 0;
      var have = {};
      (s.pomodoro.gacha.ops || []).forEach(function (o) { if (o.r === 3) have[o.n] = 1; });
      return Object.keys(have).length >= pool.length ? 1 : 0;
    }
    return 0;
  }

  /* ---------- 日期夹紧（纪念日顺延用） ---------- */

  /** 指定年月的 day，超出当月天数时夹到月末；2/29 在平年落到 2/28 */
  function clampDayOfMonth(y, m0, day) {
    var last = new Date(y, m0 + 1, 0).getDate();
    return new Date(y, m0, Math.min(day, last));
  }

  /** 指定年 + 原月份的某日，同样做月末夹紧 */
  function clampFeb29(y, m0, day) {
    return clampDayOfMonth(y, m0, day);
  }

  /** 成就是否已满足：累计型看 threshold，事件型走 check() */
  function achMet(a) {    if (typeof a.check === 'function') return !!a.check();
    return achValue(a.metric) >= (a.threshold || 0);
  }

  /**
   * 计算下一次应出现的日期（展开式：完成任务时生成这条）。
   * - repeat.type: none | daily | weekly | monthly | yearly
   * - 基准日若已过期，从今天起算，避免一直在远古日期往后推
   * - monthly/yearly 的 day 超出目标月时夹到当月最后一天（闰年 2/29 -> 2/28）
   * @returns YYYY-MM-DD 字符串；无下一期返回 null
   */
  function nextDueDate(dueDateStr, repeat, todayStr) {
    if (!repeat || repeat.type === 'none') return null;
    var today = DateUtil.parse(todayStr || DateUtil.toStr(DateUtil.today()));
    var ref = DateUtil.parse(dueDateStr);
    if (!ref) return null;
    if (DateUtil.diffDays(ref, today) < 0) ref = today;       // 已过期的基准，从今天算
    var iv = Math.max(1, (repeat.interval | 0) || 1);
    var nxt;
    if (repeat.type === 'daily') nxt = DateUtil.addDays(ref, iv);
    else if (repeat.type === 'weekly') nxt = DateUtil.addDays(ref, 7 * iv);
    else if (repeat.type === 'monthly') nxt = DateUtil.addMonths(ref, iv);
    else if (repeat.type === 'yearly') nxt = DateUtil.addYears(ref, iv);
    else return null;
    return DateUtil.toStr(nxt);
  }

  /** until 是含当天的最末一次；超过 until 即到期 */
  function repeatExpired(repeat, dateStr) {
    if (!repeat || !repeat.until) return false;
    return DateUtil.diffDays(DateUtil.parse(dateStr), DateUtil.parse(repeat.until)) > 0;
  }

  /** 规范化 repeat 字段，非法输入一律降级为不重复 */
  function sanitizeRepeat(raw) {
    if (!raw || !raw.type || raw.type === 'none') return { type: 'none' };
    var types = { daily: 1, weekly: 1, monthly: 1, yearly: 1 };
    if (!types[raw.type]) return { type: 'none' };
    var r = { type: raw.type, interval: Math.max(1, (raw.interval | 0) || 1) };
    if (raw.until && /^\d{4}-\d{2}-\d{2}$/.test(raw.until)) r.until = raw.until;
    return r;
  }

  /** 由当前实例生成下一个实例（保留 repeat 使链条继续）；无下一期返回 null */
  function genNextTask(task, todayStr) {
    if (!task.repeat || task.repeat.type === 'none') return null;
    var nxt = nextDueDate(task.dueDate, task.repeat, todayStr);
    if (!nxt) return null;
    if (repeatExpired(task.repeat, nxt)) return null;
    var copy = clone(task);
    copy.id = uid('t');
    copy.dueDate = nxt;
    copy.status = 'todo';
    copy.doneAt = '';
    copy.createdAt = new Date().toISOString();
    copy.repeatFrom = task.id;
      copy.occurrence = (task.occurrence || 0) + 1;
      return copy;
  }

  /* ==========================================================
   * 日记：一天一篇 + 心情标签
   * ========================================================== */

  /**
   * 心情枚举。**固定五档**，不允许自定义文案：
   *   - 自定义文字做不了统计（每个人写的都不一样，没法归类）
   *   - 固定枚举才能给每档配一个稳定颜色，日历上才认得出
   * 颜色按冷暖分布：越靠上越"热"（高涨），越靠下越"冷"（低落），
   * 中间「平静」用绿色过渡，这样一眼扫过去能看出整月情绪偏向哪一侧。
   */
  var MOODS = [
    { key: 'great',  name: '很好', emoji: '😄', color: '#f59e0b', tone: 'warm' },
    { key: 'good',   name: '还行', emoji: '😊', color: '#10b981', tone: 'neutral' },
    { key: 'meh',    name: '一般', emoji: '😐', color: '#94a3b8', tone: 'neutral' },
    { key: 'tired',  name: '疲惫', emoji: '😴', color: '#6366f1', tone: 'cold' },
    { key: 'low',    name: '低落', emoji: '😔', color: '#8b5cf6', tone: 'cold' }
  ];

  /** 心情统计的最少样本天数：少于这个数不给统计，避免"3 天数据看出人生规律" */
  var MOOD_MIN_DAYS = 7;
  /** 心情 × 时间去向的交叉分析门槛，比单心情统计更严 */
  var MOOD_CROSS_MIN_DAYS = 14;

  function moodOf(key) {
    for (var i = 0; i < MOODS.length; i++) if (MOODS[i].key === key) return MOODS[i];
    return null;
  }

  /** 归类心情到「偏暖 / 中性 / 偏冷」，用于粗粒度统计（样本少时比五档更稳） */
  function moodTone(key) {
    var m = moodOf(key);
    return m ? m.tone : '';
  }

  /**
   * 凌晨写作的日期归属。
   * 数据只存 date（YYYY-MM-DD），所以这里只做判断，真正选哪一天由用户决定。
   *
   * @param {number} hour 当前小时 0–23
   * @param {string} todayStr 今天的日期串
   * @param {string} [diaryDate] 已经打开/保存过的日记日期
   * @returns {{ask:boolean, suggest:string, other:string}}
   *   ask      — 是否需要问用户
   *   suggest  — 默认建议的归属日（凌晨则建议「昨天」）
   *   other    — 另一个可选项（与 suggest 必然不同）
   *
   * 规则：只有 0:00–3:59 才问。再晚就算"早起"而不是"熬夜"，
   * 而且白天写日记时问"算昨天还是今天"会让人觉得莫名其妙。
   */
  function diaryDatePrompt(hour, todayStr, diaryDate) {
    var isSmallHour = hour >= 0 && hour < 4;
    if (!isSmallHour) {
      return { ask: false, suggest: todayStr, other: todayStr };
    }
    var today = DateUtil.parse(todayStr) || DateUtil.today();
    var yest = DateUtil.toStr(DateUtil.addDays(today, -1));
    // 已经在写「昨天」那篇：默认继续昨天，另一个选项是今天
    if (diaryDate === yest) return { ask: true, suggest: yest, other: todayStr };
    // 其余情况（新建 / 已在写今天）：默认今天，另一个选项是昨天
    return { ask: true, suggest: todayStr, other: yest };
  }

  /**
   * 心情统计：分布 + 平均分 + 样本是否够。
   * 平均分把五档映射成 1–5（great=5 … low=1），比"哪种心情最多"更能反映整体。
   * @param {Array} diaries 日记数组
   * @param {string} from 起始日期串（含）
   * @param {string} to 结束日期串（含）
   */
  function moodStats(diaries, from, to) {
    var order = {};
    MOODS.forEach(function (m, i) { order[m.key] = 5 - i; });   // great=5 … low=1

    var inRange = (diaries || []).filter(function (d) {
      return d && d.date && d.date >= from && d.date <= to;
    });
    var days = inRange.length;
    var counts = {};
    MOODS.forEach(function (m) { counts[m.key] = 0; });
    var sum = 0, rated = 0, withText = 0;

    inRange.forEach(function (d) {
      if (d.content && d.content.trim()) withText++;
      var k = d.mood;
      if (!k || counts[k] == null) return;     // 心情选填，没填的不参与
      counts[k]++;
      sum += order[k];
      rated++;
    });

    var tones = { warm: 0, neutral: 0, cold: 0 };
    MOODS.forEach(function (m) {
      if (counts[m.key]) tones[m.tone] += counts[m.key];
    });

    return {
      days: days,                 // 这段时间写了几天
      rated: rated,               // 其中标了心情的天数
      withText: withText,
      counts: counts,
      tones: tones,
      avg: rated ? Math.round(sum / rated * 100) / 100 : 0,
      eligible: rated >= MOOD_MIN_DAYS,     // 够不够给统计
      need: Math.max(0, MOOD_MIN_DAYS - rated),
      // 最常出现的那一档（并列时取顺序靠前的，保证结果稳定）
      top: (function () {
        var best = '', bestN = 0;
        MOODS.forEach(function (m) {
          if (counts[m.key] > bestN) { best = m.key; bestN = counts[m.key]; }
        });
        return best;
      })()
    };
  }

  /**
   * 按日期找日记（一天一篇）。
   * @returns {object|null}
   */
  function diaryOn(diaries, dateStr) {
    for (var i = 0; i < (diaries || []).length; i++) {
      if (diaries[i] && diaries[i].date === dateStr) return diaries[i];
    }
    return null;
  }

  /** 按日期倒序排（最新在前），不改原数组 */
  function diariesSorted(diaries) {
    return (diaries || []).slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  }

  /* ==========================================================
   * 子任务（只做一层：parentId 要么为空，要么指向顶层任务）
   * ========================================================== */

  /** 子任务行为的默认值；settings.subtask 缺字段时逐项回退到这里 */
  var SUBTASK_DEFAULTS = {
    autoDoneParent: false,   // 子任务全完成 → 自动完成父任务
    cascadeDone: false,      // 父任务完成 → 未完成子任务一并完成
    orphanKeep: true,        // 删除父任务：true = 子任务保留（提升为顶层），false = 一起删
    showProgress: true       // 父任务显示 2/4 进度徽章
  };

  /** 读设置里的子任务行为，缺省/脏值一律回落到默认 */
  function subOpts(settings) {
    var raw = (settings && settings.subtask) || {};
    var out = {};
    Object.keys(SUBTASK_DEFAULTS).forEach(function (k) {
      out[k] = typeof raw[k] === 'boolean' ? raw[k] : SUBTASK_DEFAULTS[k];
    });
    return out;
  }

  /** 是否子任务 */
  function isChild(t) {
    return !!(t && t.parentId);
  }

  /** 从一组任务里取直属子任务（保持原顺序） */
  function childrenOf(list, id) {
    return list.filter(function (t) { return t.parentId === id; });
  }

  /**
   * 父任务的子任务进度
   * @returns {{ total: number, done: number, pct: number, allDone: boolean }}
   */
  function subtaskProgress(list, id) {
    var ch = childrenOf(list, id);
    var done = 0;
    ch.forEach(function (t) { if (t.status === 'done') done++; });
    return {
      total: ch.length,
      done: done,
      // 向下取整：2/3 显示 66% 而不是 67%，别让进度条看着快做完了
      pct: ch.length ? Math.floor(done / ch.length * 100) : 0,
      allDone: ch.length > 0 && done === ch.length
    };
  }

  /** 所有子任务的 id 集合（列表里判断「这条要不要藏起来」用） */
  function childIds(list) {
    var out = {};
    list.forEach(function (t) { if (t.parentId) out[t.id] = 1; });
    return out;
  }

  var Store = {
    COLORS: COLORS,
    DAY_NAMES: DAY_NAMES,
    util: DateUtil,

    /* ---------- 纪念日 / 倒数日 纯函数 ---------- */
    /**
     * 把纪念日解析为"下一次发生"的公历日期。
     * @param {object} ev  { date, repeat: 'none'|'yearly'|'monthly', lunar, lunarMonth, lunarDay, lunarLeap }
     * @param {string} todayStr  基准日 YYYY-MM-DD
     * @returns {{ next: string, nth: number, daysLeft: number }|null}
     *   next     下一次（含今天；正好今天就是今天）
     *   nth      第几届（第 N 个周年 / 第 N 次）
     *   daysLeft 距今天数
     */
    annivNext: function (ev, todayStr) {
      if (!ev || !ev.date) return null;
      var today = DateUtil.parse(todayStr || DateUtil.toStr(DateUtil.today()));
      var base = DateUtil.parse(ev.date);
      if (!base) return null;
      var rp = ev.repeat || 'none';

      var cand = base;
      var nth = 1;

      if (rp === 'yearly') {
        if (ev.lunar && global.Lunar && ev.lunarMonth && ev.lunarDay) {
          // 农历：逐年找，直到 >= 今天
          for (var ly = base.getFullYear(); ly <= base.getFullYear() + 200 && ly <= 2100; ly++) {
            var s = global.Lunar.lunarInYear(ly, ev.lunarMonth, ev.lunarDay, !!ev.lunarLeap);
            if (!s) continue;
            var sd = DateUtil.parse(s);
            cand = sd;
            nth = ly - base.getFullYear() + 1;
            if (DateUtil.diffDays(sd, today) >= 0) break;
          }
        } else {
          // 公历：从「今天所在年」起试，没过就顺延一年
          var y0 = base.getFullYear();
          var keepMonth = base.getMonth();
          var keepDay = base.getDate();
          var y = Math.max(y0, today.getFullYear());
          cand = clampFeb29(y, keepMonth, keepDay);
          if (DateUtil.diffDays(cand, today) < 0) {
            y += 1;
            cand = clampFeb29(y, keepMonth, keepDay);
          }
          nth = y - y0 + 1;
        }
      } else if (rp === 'monthly') {
        // 每月：按"日"对齐，日超出当月天数时夹到月末
        var m0 = base.getFullYear() * 12 + base.getMonth();
        var mNow = today.getFullYear() * 12 + today.getMonth();
        var k = Math.max(0, mNow - m0);
        cand = clampDayOfMonth(today.getFullYear(), today.getMonth(), base.getDate());
        nth = k + 1;
        if (DateUtil.diffDays(cand, today) < 0) {
          var nm = new Date(today.getFullYear(), today.getMonth() + 1, 1);
          cand = clampDayOfMonth(nm.getFullYear(), nm.getMonth(), base.getDate());
          nth = k + 2;
        }
      }

      return {
        next: DateUtil.toStr(cand),
        nth: nth,
        daysLeft: DateUtil.diffDays(cand, today)
      };
    },

    /** 所有纪念日，按"下一次"升序 */
    anniversaries: function (todayStr) {
      var out = [];
      state.events.forEach(function (e) {
        if (!e.repeat || e.repeat === 'none') return;
        var a = Store.annivNext(e, todayStr);
        if (a) out.push({ ev: e, next: a.next, nth: a.nth, daysLeft: a.daysLeft });
      });
      return out.sort(function (x, y) { return x.daysLeft - y.daysLeft; });
    },

    get state() { return state; },
    get courses() { return state.courses; },
    get tasks() { return state.tasks; },
    get periods() { return state.periods; },
    get semester() { return this.currentSemester(); },
    get semesters() { return state.semesters; },
    get currentSemesterId() { return state.currentSemesterId; },
    get pomodoro() { return state.pomodoro; },
    get plans() { return state.plans; },
    get ledger() { return state.ledger; },
    get notes() { return state.notes; },
    get events() { return state.events; },
    get activities() { return state.activities; },
    get meals() { return state.meals; },
    get sleeps() { return state.sleeps; },

    init: async function () {
      // 检测 localStorage 是否可用（iframe / 隐私模式可能被禁用）
      try {
        localStorage.setItem('__cp_probe__', '1');
        localStorage.removeItem('__cp_probe__');
        this.storageOK = true;
      } catch (e) {
        this.storageOK = false;
      }

      var raw = null;
      try { raw = await Persist.load(KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          state = JSON.parse(raw);
        } catch (e) {
          state = null;
        }
      }
      if (!state || !state.version) state = defaultState();

      // 兼容补齐字段（日程 / 象限 / 记账 / 设置…）
      this.ensure();
      this.save();
      return state;
    },

    /** 补齐缺失字段：加载本地数据、导入备份后都会调用 */
    ensure: function () {
      var ds = defaultState();
      if (!state) state = ds;
      if (!state.settings) state.settings = ds.settings;
      if (!state.settings.tagMeta || typeof state.settings.tagMeta !== 'object') {
        state.settings.tagMeta = {};
      }
      if (state.settings.trackMeal == null) state.settings.trackMeal = true;
      if (state.settings.trackSleep == null) state.settings.trackSleep = true;
      if (!state.settings.nav) state.settings.nav = ds.settings.nav;
      if (!Array.isArray(state.settings.navOrder)) state.settings.navOrder = [];
      if (!state.settings.asr) state.settings.asr = ds.settings.asr;
      if (!state.settings.ocr) state.settings.ocr = ds.settings.ocr;
      var defNav = ds.settings.nav;
      Object.keys(defNav).forEach(function (k) {
        if (state.settings.nav[k] == null) state.settings.nav[k] = true;
      });
      if (!state.settings.quiz) state.settings.quiz = { right: 0, wrong: 0 };
      if (!state.settings.theme) state.settings.theme = 'indigo';
      if (!state.settings.customColor) state.settings.customColor = '#4f46e5';
      if (!state.settings.background) state.settings.background = { dataUrl: '', mask: 0.5 };
      if (state.settings.background.mask == null) state.settings.background.mask = 0.5;
      if (!state.settings.pet) state.settings.pet = ds.settings.pet;
      state.settings.subtask = subOpts(state.settings);   // 逐项补默认值，顺带丢掉脏值
      // 日记设置同样逐项补，不让旧的 settings 整块覆盖掉新字段
      var dopt = state.settings.diary || {};
      state.settings.diary = {
        askDateAtNight: typeof dopt.askDateAtNight === 'boolean' ? dopt.askDateAtNight : true,
        showMoodStats: typeof dopt.showMoodStats === 'boolean' ? dopt.showMoodStats : true
      };
      if (!state.pomodoro) state.pomodoro = ds.pomodoro;
      if (!state.pomodoro.trees) state.pomodoro.trees = [];
      if (!state.pomodoro.timer) state.pomodoro.timer = ds.pomodoro.timer;
      if (state.pomodoro.points == null) state.pomodoro.points = 0;
      if (state.pomodoro.jade == null) state.pomodoro.jade = 0;
      if (state.pomodoro.mode !== 'gacha') state.pomodoro.mode = 'forest';
      if (!state.pomodoro.gacha || typeof state.pomodoro.gacha !== 'object') {
        state.pomodoro.gacha = { pity6: 0, total: 0, ops: [], log: [] };
      }
      var gc = state.pomodoro.gacha;
      if (!Array.isArray(gc.ops)) gc.ops = [];
      if (!Array.isArray(gc.log)) gc.log = [];
      if (gc.pity6 == null) gc.pity6 = 0;
      if (gc.total == null) gc.total = 0;
      if (gc.streakNo6 == null) gc.streakNo6 = 0;
      if (gc.streakNo5 == null) gc.streakNo5 = 0;
      if (state.pomodoro.earned == null) state.pomodoro.earned = 0;
      if (state.pomodoro.focusMinutes == null) state.pomodoro.focusMinutes = 0;
      if (!state.pomodoro.sessions) state.pomodoro.sessions = [];
      if (!state.plans) state.plans = [];
      if (!state.ledger) state.ledger = [];
      if (!state.notes) state.notes = [];
      if (!Array.isArray(state.diaries)) state.diaries = [];
      if (!state.events) state.events = [];
      if (!state.activities) state.activities = [];
      if (!state.meals) state.meals = [];
      if (!state.sleeps) state.sleeps = [];
      if (!state.courses) state.courses = [];
      if (!state.tasks) state.tasks = [];
      if (!state.achievements || typeof state.achievements !== 'object') state.achievements = { done: {} };
      if (!state.achievements.done || typeof state.achievements.done !== 'object') state.achievements.done = {};
      if (!state.usage || typeof state.usage !== 'object') state.usage = {};
      if (!state.taskSeq) state.taskSeq = {};
      if (!state.periods || !state.periods.length) state.periods = ds.periods;

      // 学期列表（旧版本只有一个 state.semester，迁过来）
      if (!state.semesters || !state.semesters.length) {
        var sid0 = uid('sem');
        var old0 = state.semester || {};
        state.semesters = [{
          id: sid0,
          name: old0.name || ds.semesters[0].name,
          startDate: old0.startDate || ds.semesters[0].startDate,
          weeks: old0.weeks || ds.semesters[0].weeks
        }];
        state.currentSemesterId = sid0;
      }
      var hasCur = state.semesters.some(function (x) { return x.id === state.currentSemesterId; });
      if (!hasCur) state.currentSemesterId = state.semesters[0].id;

      // 老课程没有学期归属，归到当前学期
      var curSem = state.currentSemesterId;
      state.courses.forEach(function (c) { if (!c.semesterId) c.semesterId = curSem; });

      // —— 数据模型 v2：把旧版「同名多条课程」合并为「一门课 + 多时段 slots」——
      if (!state.model || state.model < 2) {
        // 1) 每条旧记录先补一个 slots（取其顶层 day/periodId/时间/地点）
        state.courses.forEach(function (c) {
          if (!c.slots || !c.slots.length) {
            var cm = c.timeMode === 'custom';
            c.slots = [{
              day: c.day || 1,
              timeMode: cm ? 'custom' : 'period',
              periodId: cm ? '' : (c.periodId || ''),
              startTime: cm ? (c.startTime || '') : '',
              endTime: cm ? (c.endTime || '') : '',
              location: c.location || ''
            }];
          }
        });
        // 2) 按「学期 + 课程名 + 老师」分组
        var _groups = {}, _order = [];
        state.courses.forEach(function (c) {
          var key = [c.semesterId || '', c.name || '', c.teacher || ''].join('\u0001');
          if (!_groups[key]) { _groups[key] = []; _order.push(key); }
          _groups[key].push(c);
        });
        // 3) 每组合并为一门主课，收集去重后的 slots
        var _idMap = {}, _merged = [];
        _order.forEach(function (key) {
          var list = _groups[key], main = list[0];
          var seen = {}, slots = [];
          list.forEach(function (c) {
            (c.slots || []).forEach(function (s) {
              var sk = (s.day || 1) + '|' + (s.timeMode === 'custom'
                ? (s.startTime + '-' + s.endTime)
                : (s.periodId || ''));
              if (seen[sk]) return;
              seen[sk] = 1;
              slots.push({
                day: s.day || 1,
                timeMode: s.timeMode === 'custom' ? 'custom' : 'period',
                periodId: s.timeMode === 'custom' ? '' : (s.periodId || ''),
                startTime: s.timeMode === 'custom' ? (s.startTime || '') : '',
                endTime: s.timeMode === 'custom' ? (s.endTime || '') : '',
                location: s.location || c.location || ''
              });
            });
            if (c !== main) _idMap[c.id] = main.id;
          });
          main.slots = slots;
          // 4) 顶层字段镜像 slots[0]，保证旧代码/旧同步码仍可读
          var s0 = slots[0] || {};
          main.day = s0.day || 1;
          main.timeMode = s0.timeMode || 'period';
          main.periodId = s0.periodId || '';
          main.startTime = s0.startTime || '';
          main.endTime = s0.endTime || '';
          main.location = s0.location || main.location || '';
          _merged.push(main);
        });
        state.courses = _merged;
        // 5) 被合并掉的旧 id → 主课 id，回写任务关联
        Object.keys(_idMap).forEach(function (oldId) {
          state.tasks.forEach(function (t) { if (t.courseId === oldId) t.courseId = _idMap[oldId]; });
        });
        state.model = 2;
      }

      // 成绩按学期归档
      if (!state.grades || typeof state.grades !== 'object') state.grades = {};
      if (!state.settings.gpa || typeof state.settings.gpa !== 'object') {
        state.settings.gpa = ds.settings.gpa;
      }
      if (!Array.isArray(state.settings.gpa.rules) || !state.settings.gpa.rules.length) {
        state.settings.gpa.rules = ds.settings.gpa.rules;
      }
      if (!(Number(state.settings.gpa.scale) > 0)) state.settings.gpa.scale = 4;
      if (!state.settings.fav || typeof state.settings.fav !== 'object') {
        state.settings.fav = { poems: [], words: [] };
      }
      if (!Array.isArray(state.settings.fav.poems)) state.settings.fav.poems = [];
      if (!Array.isArray(state.settings.fav.words)) state.settings.fav.words = [];
      if (!state.settings.diet || typeof state.settings.diet !== 'object') {
        state.settings.diet = { goal: 0, ratio: { breakfast: 30, lunch: 40, dinner: 30, snack: 0 },
          protein: 0, fat: 0, carb: 0,
          profile: { sex: '', age: '', height: '', weight: '', activity: '1.375' } };
      }
      var dt = state.settings.diet;
      if (!dt.ratio || typeof dt.ratio !== 'object') dt.ratio = { breakfast: 30, lunch: 40, dinner: 30, snack: 0 };
      ['breakfast', 'lunch', 'dinner', 'snack'].forEach(function (k) {
        if (dt.ratio[k] == null) dt.ratio[k] = (k === 'snack' ? 0 : (k === 'lunch' ? 40 : 30));
      });
      if (!dt.profile || typeof dt.profile !== 'object') {
        dt.profile = { sex: '', age: '', height: '', weight: '', activity: '1.375' };
      }
      if (state.settings.nav.dailyPoem == null) state.settings.nav.dailyPoem = true;
      if (state.settings.nav.dailyWord == null) state.settings.nav.dailyWord = true;
      return state;
    },

    save: function () {
      var self = this;
      var str;
      try { str = JSON.stringify(state); } catch (e) { console.warn('序列化失败', e); return; }
      Persist.save(KEY, str).catch(function (e) {
        console.warn('保存失败', e);
        if (!self.quotaWarned) {
          self.quotaWarned = true;
          if (global.UI && UI.toast) {
            UI.toast('本地存储空间不足，建议换一张更小的背景图', 'err');
          }
        }
      });
    },

    persist: Persist,

    /* ===== 自动备份：破坏性操作前的回滚点 ===== */
    BK_PREFIX: 'cp-backup-',
    BK_INDEX: 'cp-backup-index',
    BK_MAX: 5,

    /** 存一份当前数据的快照；返回备份元信息（异步，不阻塞调用方） */
    backupNow: function (reason) {
      var self = this;
      var ts = Date.now();
      var key = this.BK_PREFIX + ts;
      var str;
      try { str = this.exportJSON('full'); } catch (e) { return Promise.resolve(null); }
      // 空数据没必要占备份位
      var probe = null;
      try { probe = JSON.parse(str); } catch (e) { probe = null; }
      if (!probe) return Promise.resolve(null);
      var n = (probe.courses || []).length + (probe.tasks || []).length +
              (probe.ledger || []).length + (probe.notes || []).length +
              (probe.plans || []).length + (probe.events || []).length;
      if (n === 0) return Promise.resolve(null);

      var meta = {
        key: key, ts: ts, reason: reason || '手动',
        bytes: str.length,
        courses: (probe.courses || []).length,
        tasks: (probe.tasks || []).length,
        ledger: (probe.ledger || []).length,
        notes: (probe.notes || []).length
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

    /** 只保留最近 BK_MAX 份，删掉更老的 */
    _bkTrim: function () {
      var self = this;
      return this._bkReadIndex().then(function (list) {
        if (list.length <= self.BK_MAX) return list;
        var keep = list.slice(0, self.BK_MAX);
        var drop = list.slice(self.BK_MAX);
        return Promise.all(drop.map(function (m) { return Persist.remove(m.key); }))
          .then(function () { return Persist.save(self.BK_INDEX, JSON.stringify(keep)); })
          .then(function () { return keep; });
      });
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
      // 桌面小组件：把快照推给原生桥。仅当运行在安卓壳（存在 window.AndroidBridge）时生效，
      // Web 版 / 普通浏览器里 AndroidBridge 不存在，整段被 try/catch 安全跳过，零副作用。
      try {
        var bridge = (typeof global !== 'undefined' && global.AndroidBridge) ||
                     (typeof window !== 'undefined' && window.AndroidBridge);
        if (bridge && bridge.pushSnapshot) {
          bridge.pushSnapshot(JSON.stringify(this.snapshotForWidget()));
        }
      } catch (e) { /* 桥接异常不影响主流程 */ }
      listeners.forEach(function (fn) { fn(state); });
    },

    /**
     * 生成桌面小组件所需的精简快照：
     *   今日课程时间线 / 下一个待办 / 下一个考试
     * 数据量小，App 每次状态变更（emit）都会重写，供安卓 Widget 独立进程读取。
     */
    snapshotForWidget: function () {
      var st = state;
      var now = DateUtil.today();
      var gd = now.getDay();                 // 0=周日
      var dow = gd === 0 ? 7 : gd;           // 转成 1-7（周一=1），与课程 day 一致
      var weekNo = this.currentWeek();
      var todayStr = DateUtil.toStr(now);

      var courses = this.coursesOnDay(dow, weekNo).map(function (c) {
        var t = Store.courseTime(c) || { start: '', end: '' };
        return { start: t.start || '', end: t.end || '', name: c.name, location: c.location || '' };
      });

      var pend = this.pendingTasks();
      var nextTodo = null;
      if (pend && pend.length) {
        var t0 = pend[0];
        var rd = t0.dueDate ? DateUtil.daysLeft(t0.dueDate) : null;
        nextTodo = {
          title: t0.title,
          due: t0.dueDate || '',
          time: t0.dueTime || '',
          remainDays: (rd == null ? null : rd)
        };
      }

      var nextExam = null;
      var exAll = [];
      state.courses.forEach(function (c) {
        if (c.semesterId && c.semesterId !== st.currentSemesterId) return;
        if (c.exam && c.exam.date && c.exam.date >= todayStr) exAll.push(c);
      });
      exAll.sort(function (a, b) { return a.exam.date < b.exam.date ? -1 : 1; });
      if (exAll.length) {
        var e = exAll[0];
        nextExam = { name: e.name, date: e.exam.date, start: e.exam.start || '', location: e.location || '' };
      }

      return {
        updatedAt: Date.now(),
        today: todayStr,
        weekday: DAY_NAMES[dow - 1] || '',
        courses: courses,
        nextTodo: nextTodo,
        nextExam: nextExam
      };
    },

    /* ===== 学期 & 周次 ===== */
    /* ===== 学期 ===== */
    /** 当前学期对象 */
    currentSemester: function () {
      var id = state.currentSemesterId;
      for (var i = 0; i < state.semesters.length; i++) {
        if (state.semesters[i].id === id) return state.semesters[i];
      }
      return state.semesters[0];
    },

    semesterById: function (id) {
      for (var i = 0; i < state.semesters.length; i++) {
        if (state.semesters[i].id === id) return state.semesters[i];
      }
      return null;
    },

    /** 切换课表/成绩查看的学期 */
    switchSemester: function (id) {
      if (!this.semesterById(id)) return null;
      state.currentSemesterId = id;
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
        id: uid('sem'),
        name: (data.name || '').trim() || '新学年 新学期的课表',
        startDate: start,
        weeks: Math.max(1, Math.min(30, parseInt(data.weeks, 10) || 20))
      };
      state.semesters.push(s);
      if (data.switchTo !== false) state.currentSemesterId = s.id;
      this.emit();
      return s;
    },

    updateSemesterById: function (id, data) {
      var s = this.semesterById(id);
      if (!s) return null;
      Object.keys(data || {}).forEach(function (k) {
        if (typeof data[k] === 'string') s[k] = data[k].trim();
        else s[k] = data[k];
      });
      this.emit();
      return s;
    },

    /** 删除学期：里面的课程和成绩一起删掉 */
    removeSemester: function (id) {
      if (state.semesters.length <= 1) return false;
      var idx = -1;
      state.semesters.forEach(function (s, i) { if (s.id === id) idx = i; });
      if (idx < 0) return false;
      state.semesters.splice(idx, 1);
      state.courses = state.courses.filter(function (c) { return c.semesterId !== id; });
      delete state.grades[id];
      if (state.currentSemesterId === id) state.currentSemesterId = state.semesters[0].id;
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
        id: uid('c'),
        name: (data.name || '').trim() || '未命名课程',
        teacher: (data.teacher || '').trim(),
        location: (data.location || '').trim() || s0.location || '',
        color: data.color || COLORS[state.courses.length % COLORS.length],
        slots: slots,
        day: s0.day,
        timeMode: s0.timeMode,
        periodId: s0.periodId,
        startTime: s0.startTime,
        endTime: s0.endTime,
        semesterId: data.semesterId || state.currentSemesterId,
        credit: Number(data.credit) > 0 ? Number(data.credit) : 0,
        exam: (data.exam && data.exam.date)
          ? { date: String(data.exam.date), start: String(data.exam.start || ''), end: String(data.exam.end || '') }
          : null,
        startWeek: data.startWeek == null ? 1 : data.startWeek,
        endWeek: data.endWeek == null ? this.currentSemester().weeks : data.endWeek,
        weekType: data.weekType || 'all',
        note: (data.note || '').trim()
      };
      state.courses.push(c);
      this.bumpUsage('course');
      this.emit();
      this.checkAchievements(true);
      return c;
    },

    updateCourse: function (id, data) {
      var c = this.getCourse(id);
      if (!c) return null;
      var hasSlots = Array.isArray(data.slots);
      Object.keys(data).forEach(function (k) {
        if (k === 'slots') return;
        if (typeof data[k] === 'string') c[k] = data[k].trim();
        else c[k] = data[k];
      });
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
      this.emit();
      return c;
    },

    removeCourse: function (id) {
      state.courses = state.courses.filter(function (c) { return c.id !== id; });
      // 同步清理关联任务中的课程引用（保留任务，解绑课程）
      state.tasks.forEach(function (t) { if (t.courseId === id) t.courseId = ''; });
      this.emit();
    },

    /* ==========================================================
     * 学分
     * ========================================================== */
    /** 某学期的课程学分（同名课程只算一次，避免多节次重复计） */
    creditsOf: function (semesterId) {
      var sid = semesterId || state.currentSemesterId;
      var map = {};
      state.courses.forEach(function (c) {
        if (c.semesterId !== sid || !(c.credit > 0)) return;
        map[c.name] = Math.max(map[c.name] || 0, Number(c.credit) || 0);
      });
      var total = 0;
      Object.keys(map).forEach(function (k) { total += map[k]; });
      return Math.round(total * 100) / 100;
    },

    currentCredits: function () { return this.creditsOf(state.currentSemesterId); },

    historyCredits: function () {
      var self = this, total = 0;
      state.semesters.forEach(function (s) {
        if (s.id === state.currentSemesterId) return;
        total += self.creditsOf(s.id);
      });
      return Math.round(total * 100) / 100;
    },

    allCredits: function () {
      var self = this, total = 0;
      state.semesters.forEach(function (s) { total += self.creditsOf(s.id); });
      return Math.round(total * 100) / 100;
    },

    /* ==========================================================
     * 考试
     * ========================================================== */
    /** 某一天的考试（当前学期，同名课程只列一次） */
    examsOf: function (dateStr) {
      var sid = state.currentSemesterId, out = [], seen = {};
      state.courses.forEach(function (c) {
        if (c.semesterId !== sid || !c.exam || !c.exam.date) return;
        if (c.exam.date !== dateStr || seen[c.name]) return;
        seen[c.name] = 1;
        out.push({
          name: c.name, courseId: c.id, color: c.color,
          start: c.exam.start || '', end: c.exam.end || '',
          location: c.location || ''
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

    /** 未来 n 天内有没有考试（日程用） */
    examsInRange: function (from, to) {
      var out = [], d = DateUtil.parse(from), end = DateUtil.parse(to);
      while (d && end && d.getTime() <= end.getTime()) {
        var ds = DateUtil.toStr(d);
        this.examsOf(ds).forEach(function (e) { out.push(Object.assign({ date: ds }, e)); });
        d = DateUtil.addDays(d, 1);
      }
      return out;
    },

    /* ==========================================================
     * 成绩
     * ========================================================== */
    /** 默认成绩结构：总评 = 平时 40% + 期末 60%（可任意增删嵌套） */
    defaultGradeTree: function () {
      return {
        id: uid('g'), name: '总评', weight: 100, score: null,
        children: [
          { id: uid('g'), name: '平时', weight: 40, score: null, children: [] },
          { id: uid('g'), name: '期末', weight: 60, score: null, children: [] }
        ]
      };
    },

    /**
     * 递归算得分
     * 叶子：直接取填写的分数
     * 父项：把已填写的子项按权重归一化后加权（没填的不拉低）
     */
    computeGrade: function (node) {
      if (!node) return null;
      if (node.children && node.children.length) {
        var sum = 0, w = 0, any = false;
        node.children.forEach(function (ch) {
          var v = Store.computeGrade(ch);
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
      if (node.score == null || node.score === '') return null;
      var n = Number(node.score);
      return isNaN(n) ? null : n;
    },

    /** 某学期的成绩条目：填了学分的课程自动进来 + 手动添加的课程 */
    gradeList: function (semesterId) {
      var sid = semesterId || state.currentSemesterId;
      var manual = state.grades[sid] || {};
      var out = [], has = {};
      Object.keys(manual).forEach(function (k) {
        out.push(manual[k]);
        has[manual[k].key || k] = 1;
      });
      var seen = {};
      state.courses.forEach(function (c) {
        if (c.semesterId !== sid || !(c.credit > 0) || !c.name) return;
        if (seen[c.name]) return;              // 同一门课排好几节，只算一门
        seen[c.name] = 1;
        var key = 'c:' + c.name;
        if (has[key]) return;                  // 已经录过分了
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

    gradeRecord: function (semesterId, key) {
      var sid = semesterId || state.currentSemesterId;
      return (state.grades[sid] || {})[key] || null;
    },

    saveGrade: function (semesterId, rec) {
      var sid = semesterId || state.currentSemesterId;
      if (!state.grades[sid]) state.grades[sid] = {};
      state.grades[sid][rec.key] = rec;
      this.bumpUsage('grade');
      this.emit();
      return rec;
    },

    removeGrade: function (semesterId, key) {
      var sid = semesterId || state.currentSemesterId;
      if (state.grades[sid]) delete state.grades[sid][key];
      this.emit();
    },

    /* ==========================================================
     * 收藏：每日一句 / 每日一词
     * ========================================================== */
    fav: function () {
      var f = (state.settings && state.settings.fav) || null;
      if (!f || typeof f !== 'object') f = { poems: [], words: [] };
      if (!Array.isArray(f.poems)) f.poems = [];
      if (!Array.isArray(f.words)) f.words = [];
      state.settings.fav = f;
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
      var nav = state.settings.nav || {};
      var v = nav['daily' + (which === 'word' ? 'Word' : 'Poem')];
      return v == null ? true : !!v;
    },

    setDailyOn: function (which, on) {
      var patch = {};
      patch['daily' + (which === 'word' ? 'Word' : 'Poem')] = !!on;
      Object.assign(state.settings.nav, patch);
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
      var ds = defaultState();
      var g = (state.settings && state.settings.gpa) || ds.settings.gpa;
      var rules = (Array.isArray(g.rules) && g.rules.length) ? g.rules : defaultGpaRules();
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
      if (!state.settings.gpa) state.settings.gpa = {};
      var cfg = this.gpaConfig();
      var next = {
        scale: data.scale != null ? Math.max(0.1, Number(data.scale) || 4) : cfg.scale,
        linear: data.linear != null ? !!data.linear : cfg.linear,
        rules: data.rules ? data.rules.slice() : cfg.rules
      };
      state.settings.gpa = next;
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

    /**
     * 汇总若干学期的成绩
     * @returns { count, scored, credits, creditsScored, weighted, average }
     */
    gradeSummary: function (semesterIds) {
      var self = this;
      var ids = semesterIds || [state.currentSemesterId];
      var list = [];
      ids.forEach(function (sid) {
        self.gradeList(sid).forEach(function (r) {
          list.push({
            name: r.name,
            credit: Number(r.credit) || 0,
            score: r.root ? self.computeGrade(r.root) : null,
            semesterId: sid
          });
        });
      });
      var cr = 0, crDone = 0, wsum = 0, sum = 0, n = 0, gsum = 0;
      list.forEach(function (r) {
        cr += r.credit;
        if (r.score != null) {
          sum += r.score;
          n++;
          wsum += r.score * r.credit;
          crDone += r.credit;
          var gp = self.gpaOf(r.score);
          if (gp != null) gsum += gp * r.credit;
        }
      });
      return {
        count: list.length,
        scored: n,
        credits: Math.round(cr * 100) / 100,
        creditsScored: Math.round(crDone * 100) / 100,
        weighted: crDone > 0 ? Math.round(wsum / crDone * 100) / 100 : null,
        average: n > 0 ? Math.round(sum / n * 100) / 100 : null,
        gpa: crDone > 0 ? Math.round(gsum / crDone * 100) / 100 : null
      };
    },

    getCourse: function (id) {
      for (var i = 0; i < state.courses.length; i++) {
        if (state.courses[i].id === id) return state.courses[i];
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

    /** 把一门课按 slots 展开为「伪记录」：courseId 指向父课程，其余字段取各时段 */
    expandCourse: function (c) {
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
        return p;
      });
    },

    getPeriod: function (id) {
      for (var i = 0; i < state.periods.length; i++) {
        if (state.periods[i].id === id) return state.periods[i];
      }
      return null;
    },

    periodIndex: function (id) {
      for (var i = 0; i < state.periods.length; i++) {
        if (state.periods[i].id === id) return i;
      }
      return -1;
    },

    /** 某周的课表数据：返回 'day|periodId' = [伪记录]（一门课的多时段会展开） */
    weekMatrix: function (weekNo) {
      var map = {};
      var sid = state.currentSemesterId;
      state.courses.forEach(function (c) {
        if (c.semesterId && c.semesterId !== sid) return;
        if (!Store.courseInWeek(c, weekNo)) return;
        Store.expandCourse(c).forEach(function (p) {
          if ((p.timeMode || 'period') === 'custom') return; // 自定义时间由 customAt 处理
          var key = p.day + '|' + p.periodId;
          (map[key] = map[key] || []).push(p);
        });
      });
      return map;
    },


    /* ===== 作业 / 待办 CRUD ===== */
    addTask: function (data) {
      var t = {
        id: uid('t'),
        title: (data.title || '').trim() || '未命名待办',
        courseId: data.courseId || '',
        dueDate: data.dueDate || '',
        dueTime: data.dueTime || '',
        status: data.status || 'todo',
        priority: data.priority || 'normal',
        important: !!data.important,
        tags: normalizeTags(data.tags),
        note: (data.note || '').trim(),
        repeat: sanitizeRepeat(data.repeat),
        parentId: this.validParentId(data.parentId),
        createdAt: new Date().toISOString(),
        doneAt: ''
      };
      state.tasks.push(t);
      // 新增子任务后，父任务的进度可能变了；若设置要求「全完成自动完成父」，这里也要生效
      if (t.parentId) this.syncParent(t.parentId);
      this.emit();
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
      // 首次标记为完成 → 奖励积分
      if (!wasDone && t.status === 'done') {
        this.addPoints(POMO.TASK_DONE);
        // 重复任务：完成时生成下一期实例（保留 repeat 链条）
        if (t.repeat && t.repeat.type !== 'none') {
          var nt = genNextTask(t);
          if (nt) state.tasks.push(nt);
        }
      }
      this.checkAchievements(true);
      if (t.status === 'done' && !t.doneAt) t.doneAt = new Date().toISOString();
      if (t.status !== 'done') t.doneAt = '';

      /* ---- 子任务联动 ---- */
      var o = subOpts(state.settings);
      if (!wasDone && t.status === 'done') {
        if (isChild(t)) {
          // ① 子任务全完成 → 视设置决定是否自动完成父任务
          if (wasParentId) this.syncParent(wasParentId);
        } else if (o.cascadeDone) {
          // ② 父任务完成 → 视设置决定是否连带勾选未完成的子任务
          childrenOf(state.tasks, t.id).forEach(function (c) {
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
      var o = subOpts(state.settings);
      var pr = subtaskProgress(state.tasks, pid);
      if (!o.autoDoneParent) return;
      if (pr.allDone && p.status !== 'done') {
        p.status = 'done';
        p.doneAt = new Date().toISOString();
        this.addPoints(POMO.TASK_DONE);
      }
    },

    /** 当前设置下的子任务行为（带默认值兜底） */
    subtaskOpts: function () {
      return subOpts(state.settings);
    },

    /** 某任务的直属子任务（按创建顺序） */
    subtasksOf: function (id) {
      return childrenOf(state.tasks, id);
    },

    /** 某任务的子任务进度 { total, done, pct, allDone } */
    subtaskProgress: function (id) {
      return subtaskProgress(state.tasks, id);
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
      var o = subOpts(state.settings);
      var removed = 1, kept = 0;
      var kill = {};
      var isParent = !t.parentId;     // 必须在改动之前判断，下面会动 t.parentId 之外的记录
      var parentId = t.parentId;

      if (isParent) {
        var kids = childrenOf(state.tasks, id);
        if (kids.length) {
          if (o.orphanKeep) {
            kids.forEach(function (c) { c.parentId = ''; });
            kept = kids.length;
          } else {
            kids.forEach(function (c) { kill[c.id] = 1; removed++; });
          }
        }
      }

      state.tasks = state.tasks.filter(function (x) { return x.id !== id && !kill[x.id]; });
      if (parentId) this.syncParent(parentId);
      this.emit();
      return { removed: removed, kept: kept };
    },

    getTask: function (id) {
      for (var i = 0; i < state.tasks.length; i++) {
        if (state.tasks[i].id === id) return state.tasks[i];
      }
      return null;
    },

    /** 顶层任务（不含子任务）。「今日」、四象限、导航角标只看这些 */
    rootTasks: function () {
      return state.tasks.filter(function (t) { return !t.parentId; });
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

    /** 未完成任务，按截止时间升序（无日期的排最后） */
    pendingTasks: function () {
      return state.tasks.filter(function (t) { return t.status !== 'done'; }).sort(compareDue);
    },

    todayTasks: function () {
      var today = DateUtil.toStr(DateUtil.today());
      return this.pendingTasks().filter(function (t) { return t.dueDate === today; });
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
      var sid = state.currentSemesterId;
      var out = [];
      state.courses.forEach(function (c) {
        if (c.semesterId && c.semesterId !== sid) return;
        if (!Store.courseInWeek(c, weekNo)) return;
        Store.expandCourse(c).forEach(function (p) { if (p.day === day) out.push(p); });
      });
      return out.sort(function (a, b) {
        var ta = Store.courseTime(a), tb = Store.courseTime(b);
        return (ta ? ta.start : '99:99') < (tb ? tb.start : '99:99') ? -1 : 1;
      });
    },

    /* ===== 一次性日程 ===== */
    addEvent: function (data) {
      var e = {
        id: uid('e'),
        title: (data.title || '').trim() || '未命名日程',
        date: data.date || DateUtil.toStr(DateUtil.today()),
        start: data.start || '08:00',
        end: data.end || '09:00',
        location: (data.location || '').trim(),
        note: (data.note || '').trim(),
        done: !!data.done,
        important: !!data.important,
        repeat: data.repeat || 'none',       // none | yearly | monthly
        kind: data.kind || '',               // birthday | anniversary | countdown | ''
        lunar: !!data.lunar,
        lunarMonth: data.lunarMonth || 0,
        lunarDay: data.lunarDay || 0,
        lunarLeap: !!data.lunarLeap,
        createdAt: new Date().toISOString()
      };
      state.events.push(e);
      this.bumpUsage('event');
      this.emit();
      return e;
    },

    updateEvent: function (id, data) {
      var e = this.getEvent(id);
      if (!e) return null;
      Object.keys(data).forEach(function (k) {
        e[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
      });
      this.emit();
      return e;
    },

    removeEvent: function (id) {
      state.events = state.events.filter(function (e) { return e.id !== id; });
      this.emit();
    },

    getEvent: function (id) {
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === id) return state.events[i];
      }
      return null;
    },

    eventsOf: function (dateStr) {
      return state.events.filter(function (e) { return e.date === dateStr; })
        .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    },

    /** 从今天起 n 天内的一次性日程 */
    upcomingEvents: function (n) {
      var from = DateUtil.toStr(DateUtil.today());
      var to = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), n - 1));
      return state.events.filter(function (e) { return e.date >= from && e.date <= to; })
        .sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
        });
    },

    /* ===== 活动记录 ===== */
    addActivity: function (data) {
      var a = {
        id: uid('a'),
        date: data.date || DateUtil.toStr(DateUtil.today()),
        start: data.start || '00:00',
        end: data.end || '00:00',
        name: (data.name || '').trim() || '未命名活动',
        type: data.type || 'other',
        tags: normalizeTags(data.tags),
        note: (data.note || '').trim()
      };
      state.activities.push(a);
      this.emit();
      this.checkAchievements(true);
      return a;
    },

    updateActivity: function (id, data) {
      var a = this.getActivity(id);
      if (!a) return null;
      Object.keys(data).forEach(function (k) {
        if (k === 'tags') a.tags = normalizeTags(data.tags);
        else a[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
      });
      this.emit();
      return a;
    },

    removeActivity: function (id) {
      state.activities = state.activities.filter(function (a) { return a.id !== id; });
      this.emit();
    },

    getActivity: function (id) {
      for (var i = 0; i < state.activities.length; i++) {
        if (state.activities[i].id === id) return state.activities[i];
      }
      return null;
    },

    activitiesOf: function (dateStr) {
      return state.activities.filter(function (a) { return a.date === dateStr; })
        .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    },

    /* ===== 饮食记录 ===== */
    addMeal: function (data) {
      var m = {
        id: uid('m'),
        date: data.date || DateUtil.toStr(DateUtil.today()),
        time: data.time || '12:00',
        type: data.type || 'lunch',
        content: (data.content || '').trim(),
        cost: data.cost == null || data.cost === '' ? 0 : Number(data.cost) || 0,
        kcal: data.kcal == null || data.kcal === '' ? 0 : Number(data.kcal) || 0,
        items: Array.isArray(data.items) ? data.items.map(normFoodItem) : [],
        kcalManual: !!data.kcalManual,
        // 饮食默认归到「餐饮」，让记账的标签统计不用堆在「未打标签」
        tags: normalizeTags(data.tags).length ? normalizeTags(data.tags) : ['餐饮'],
        note: (data.note || '').trim()
      };
      state.meals.push(m);
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
        else if (k === 'tags') m.tags = normalizeTags(d2.tags);
        else m[k] = typeof d2[k] === 'string' ? d2[k].trim() : d2[k];
      });
      // 有食物明细且不是手填：热量跟着明细自动算
      if (m.items && m.items.length && !m.kcalManual) {
        m.kcal = r1(sumItems(m.items).kcal);
      }
      this.syncMealLedger(m);
      this.emit();
      return m;
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
        tags: normalizeTags(m.tags)
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
      state.meals = state.meals.filter(function (m) { return m.id !== id; });
      this.emit();
    },

    getMeal: function (id) {
      for (var i = 0; i < state.meals.length; i++) {
        if (state.meals[i].id === id) return state.meals[i];
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

    /** 按分类取食物（用于浏览） */
    foodsOf: function (cat) {
      var db = (global.FOOD_DB || []);
      var out = [];
      db.forEach(function (f, i) {
        if (!cat || f[6] === cat) {
          out.push({ idx: i, n: f[0], unit: f[1], kcal: f[2], p: f[3], f: f[4], c: f[5], cat: f[6] });
        }
      });
      return out;
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
      return (state.settings && state.settings.diet) ||
        { goal: 0, ratio: {}, protein: 0, fat: 0, carb: 0, profile: {} };
    },

    setDiet: function (data) {
      Object.assign(state.settings.diet || {}, data || {});
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
      return state.meals.filter(function (m) { return m.date === dateStr; })
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

    /* ===== 睡眠记录 ===== */
    addSleep: function (data) {
      var r = {
        id: uid('s'),
        date: data.date || DateUtil.toStr(DateUtil.today()),   // 记录所属日
        start: data.start || '23:00',                          // 入睡时间
        end: data.end || '07:00',                              // 醒来时间（可跨午夜）
        quality: data.quality || 'normal',                     // good / normal / bad
        note: (data.note || '').trim()
      };
      state.sleeps.push(r);
      this.bumpUsage('sleep');
      this.emit();
      return r;
    },

    updateSleep: function (id, data) {
      var r = this.getSleep(id);
      if (!r) return null;
      Object.keys(data).forEach(function (k) {
        r[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
      });
      this.emit();
      return r;
    },

    removeSleep: function (id) {
      state.sleeps = state.sleeps.filter(function (r) { return r.id !== id; });
      this.emit();
    },

    getSleep: function (id) {
      for (var i = 0; i < state.sleeps.length; i++) {
        if (state.sleeps[i].id === id) return state.sleeps[i];
      }
      return null;
    },

    sleepsOf: function (dateStr) {
      return state.sleeps.filter(function (r) { return r.date === dateStr; })
        .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    },

    /** 睡眠总分钟（按实际时刻归属：跨午夜的部分算到后一天） */
    sleepMinutes: function (dateStr) {
      var d = DateUtil.parse(dateStr) || DateUtil.today();
      var next = DateUtil.toStr(DateUtil.addDays(d, 1));
      return sleepByNight(state.sleeps, dateStr, next);
    },

  /* ===== 番茄钟 / 积分 / 养树 ===== */

    /**
     * 增加积分（不自动 emit，由调用方决定何时通知界面）
     * 两种奖励机制的积分分开存放：
     *   forest → points（种树 / 浇水）
     *   gacha  → jade（合成玉，1 积分 = 600）
     * 无论哪种，earned 都记总积分，切换机制时总量不变。
     */
    addPoints: function (n) {
      n = Math.round(n) || 0;
      if (n <= 0) return this.pomodoro.points;
      var pm = state.pomodoro;
      if (pm.mode === 'gacha') pm.jade += n * POMO.JADE_PER_POINT;
      else pm.points += n;
      pm.earned += n;
      return pm.mode === 'gacha' ? pm.jade : pm.points;
    },

    /** 当前机制的余额（森林=积分，抽卡=合成玉） */
    currentBalance: function () {
      var pm = state.pomodoro;
      return pm.mode === 'gacha' ? pm.jade : pm.points;
    },

    /** 折算成积分的总余额：森林积分 + 合成玉 ÷ 600 */
    totalPoints: function () {
      var pm = state.pomodoro;
      return Math.round((pm.points + pm.jade / POMO.JADE_PER_POINT) * 100) / 100;
    },

    /** 切换奖励机制（余额各自保留，总量不变） */
    setRewardMode: function (mode) {
      var pm = state.pomodoro;
      pm.mode = (mode === 'gacha') ? 'gacha' : 'forest';
      this.emit();
      return pm.mode;
    },

    spendPoints: function (n) {
      var pm = state.pomodoro;
      if (pm.points < n) return false;
      pm.points -= n;
      return true;
    },

    /** 结束一次专注：minutes 为实际专注分钟，extra 可带起止时间用于写入象限 */
    finishFocus: function (minutes, taskId, extra) {
      minutes = Math.max(0, Math.floor(minutes));
      var pm = state.pomodoro;
      pm.focusMinutes += minutes;
      var gain = minutes * POMO.POINT_PER_MIN;
      this.addPoints(gain);

      // 记录本次专注（用于统计）
      var dateStr = (extra && extra.date) || DateUtil.toStr(DateUtil.today());
      pm.sessions.push({
        date: dateStr, minutes: minutes,
        taskId: taskId || '',
        name: (extra && extra.name) || '',
        tags: normalizeTags(extra && extra.tags),
        at: new Date().toISOString()
      });
      if (pm.sessions.length > 400) pm.sessions = pm.sessions.slice(-400);

      // 自动把专注时长写进象限的活动记录
      if (extra && extra.start && extra.end && minutes >= 1) {
        this.addActivity({
          date: dateStr,
          start: extra.start,
          end: extra.end,
          name: extra.name || '专注',
          type: 'study',
          tags: extra.tags,
          note: '番茄钟自动记录'
        });
      }
      state.pomodoro.timer = {
        running: false, endAt: 0, left: 0,
        duration: state.pomodoro.timer.duration || 25, taskId: ''
      };
      this.bumpUsage('focus');
      this.emit();
      return gain;
    },

    /** 第 n 棵树的价格：种得越多越贵 */
    /* ==========================================================
     * 抽卡机制（明日方舟标准寻访）
     * ========================================================== */
    /** 可抽的干员池（3★ 及以上） */
    gachaPool: function () {
      return (global.AK_OPS || []).filter(function (o) { return o[1] >= 3; });
    },

    /** 按星级随机取一个干员 */
    pickOp: function (rarity) {
      var all = this.gachaPool();
      var pool = all.filter(function (o) { return o[1] === rarity; });
      if (!pool.length) pool = all;
      if (!pool.length) return null;
      var it = pool[Math.floor(Math.random() * pool.length)];
      return { n: it[0], r: it[1], p: it[2], img: it[3] };
    },

    /** 当前六星概率（含 50 抽后的递增保底） */
    gachaRate6: function () {
      var pity = state.pomodoro.gacha.pity6 || 0;
      var p = POMO.RATE_6;
      if (pity >= POMO.PITY_START) {
        p = POMO.RATE_6 + (pity - POMO.PITY_START + 1) * POMO.PITY_STEP;
      }
      return Math.min(100, Math.round(p * 10) / 10);
    },

    /** 单抽一次（forceMin 用于保底时指定最低星级） */
    gachaOne: function (forceMin) {
      var pm = state.pomodoro;
      var g = pm.gacha;
      var r;

      if (forceMin) {
        r = forceMin;
      } else {
        var p6 = this.gachaRate6();
        var roll = Math.random() * 100;
        if (roll < p6) r = 6;
        else if (roll < p6 + POMO.RATE_5) r = 5;
        else if (roll < p6 + POMO.RATE_5 + POMO.RATE_4) r = 4;
        else r = 3;
      }

      if (r === 6) g.pity6 = 0;
      else g.pity6 = (g.pity6 || 0) + 1;
      g.total = (g.total || 0) + 1;
      return this.pickOp(r);
    },

    /**
     * 抽卡：单抽（600 玉）或十连（6000 玉）
     * @returns {Array|null} 余额不足返回 null
     */
    gachaPull: function (times) {
      var pm = state.pomodoro;
      times = (times === 10) ? 10 : 1;
      var cost = (times === 10) ? POMO.TEN_COST : POMO.PULL_COST;
      if (pm.jade < cost) return null;
      pm.jade -= cost;

      var out = [];
      for (var i = 0; i < times; i++) {
        var o = this.gachaOne();
        if (o) out.push(o);
      }

      // 十连保底：仅「每自然天第一个十连」保底五星，其余十连不保底
      if (times === 10 && out.length) {
        var todayStr = DateUtil.toStr(DateUtil.today());
        if (pm.gacha.dailyGuaranteeDay !== todayStr) {
          var ok = out.some(function (x) { return x.r >= POMO.TEN_GUARANTEE; });
          if (!ok) {
            var up = this.gachaOne(POMO.TEN_GUARANTEE);
            if (up) out[out.length - 1] = up;
          }
          pm.gacha.dailyGuaranteeDay = todayStr;
        }
      }

      /* 连续未出星计数（跨所有抽，单抽 / 十连都逐个计入）
       * streakNo6：连续未出六星的抽数；streakNo5：连续未出五星（含六星）的抽数 */
      out.forEach(function (o) {
        if (o.r >= 6) pm.gacha.streakNo6 = 0; else pm.gacha.streakNo6 = (pm.gacha.streakNo6 || 0) + 1;
        if (o.r >= 5) pm.gacha.streakNo5 = 0; else pm.gacha.streakNo5 = (pm.gacha.streakNo5 || 0) + 1;
      });

      /* 十连事件标记：供「十连皆三星 / 最高仅四星 / 六星三连」成就判定 */
      if (times === 10) {
        var maxR = 0, sixN = 0, isAll3 = true;
        out.forEach(function (o) {
          if (o.r > maxR) maxR = o.r;
          if (o.r === 6) sixN++;
          if (o.r !== 3) isAll3 = false;
        });
        pm.gacha.lastTen = {
          all3: isAll3,
          max4: (maxR === 4),
          twoSix: (sixN === 2),     // 恰好两个六星 → 双黄蛋
          fourSix: (sixN > 3)       // 超过三个六星（≥4）→ 绝世欧皇
        };
      } else {
        pm.gacha.lastTen = null;
      }

      // 写进图鉴 + 潜能机制
      out.converted = 0;
      out.forEach(function (o) {
        var hit = null;
        for (var k = 0; k < pm.gacha.ops.length; k++) {
          if (pm.gacha.ops[k].n === o.n) { hit = pm.gacha.ops[k]; break; }
        }
        if (hit) {
          hit.count = (hit.count || 1) + 1;
          // 潜能 = max(0, min(复制数-1, 上限))；达到上限（6 份）后，多余复制转化为积分
          if (hit.count > POMO.POT_MAX + 1) {
            var pts = POMO.DUP_POINTS[o.r] || POMO.DUP_POINTS[3];
            pm.points += pts;
            hit.dupPts = (hit.dupPts || 0) + pts;
            out.converted += pts;
          }
        } else {
          pm.gacha.ops.push({ n: o.n, r: o.r, p: o.p, img: o.img, count: 1, at: Date.now() });
        }
      });

      pm.gacha.log = out.map(function (o) { return { n: o.n, r: o.r, t: Date.now() }; })
        .concat(pm.gacha.log).slice(0, 500);

      // 抽卡相关的成就（十连事件、连续未出星、集齐星级）在此检测并弹窗
      this.checkAchievements(true);
      this.emit();
      return out;
    },

    /** 图鉴统计 */
    gachaStats: function () {
      var pm = state.pomodoro;
      var all = this.gachaPool();
      var byR = { 6: [0, 0], 5: [0, 0], 4: [0, 0], 3: [0, 0] };
      all.forEach(function (o) { if (byR[o[1]]) byR[o[1]][1]++; });
      var seen = {};
      pm.gacha.ops.forEach(function (o) {
        if (seen[o.n]) return;
        seen[o.n] = 1;
        if (byR[o.r]) byR[o.r][0]++;
      });
      return {
        total: all.length,
        owned: Object.keys(seen).length,
        pulls: pm.gacha.total || 0,
        pity: pm.gacha.pity6 || 0,
        rate6: this.gachaRate6(),
        byR: byR
      };
    },

    /** 已获得的干员（按星级、名称排序） */
    gachaOwned: function () {
      return state.pomodoro.gacha.ops.slice().sort(function (a, b) {
        return (b.r - a.r) || (String(a.n) < String(b.n) ? -1 : 1);
      });
    },

    /**
     * 一键清空当前寻访：
     * - 我的干员（gacha.ops）
     * - 寻访数据（gacha.log）与抽卡计数（保底 / 累计 / 连续未出星 / 十连标记）
     * - 相关成就（抽卡 + 集卡）的解锁记录
     * 不影响：已获得的积分、森林与种树成就。
     */
    clearGacha: function () {
      state.pomodoro.gacha = {
        pity6: 0, total: 0, ops: [], log: [],
        dailyGuaranteeDay: '', streakNo6: 0, streakNo5: 0, lastTen: null
      };
      // 清掉寻访相关成就（group 为「抽卡」「集卡」）的完成记录
      var ids = {};
      ACH_DEF.forEach(function (a) {
        if (a.group === '抽卡' || a.group === '集卡') ids[a.id] = 1;
      });
      if (state.achievements && state.achievements.done) {
        Object.keys(state.achievements.done).forEach(function (k) {
          if (ids[k]) delete state.achievements.done[k];
        });
      }
      this.emit();
      return true;
    },

    /* ---------- 成就系统 ---------- */
    ACHIEVEMENTS: ACH_DEF,
    ACH_GROUPS: ACH_GROUPS,
    ACH_TIERS: ACH_TIER,
    achievementList: function () { return ACH_DEF; },
    achievementValue: function (metric) { return achValue(metric); },
    achievementDone: function (id) {
      return !!(state.achievements && state.achievements.done && state.achievements.done[id]);
    },
    isAchieved: function (a) {
      return this.achievementDone(a.id) || achMet(a);
    },
    /** 检测并解锁成就：返回本次新解锁的成就列表；showPopup=true 时弹出提示 */
    checkAchievements: function (showPopup) {
      var self = this, newly = [];
      ACH_DEF.forEach(function (a) {
        if (self.achievementDone(a.id)) return;
        if (achMet(a)) {
          if (!state.achievements) state.achievements = { done: {} };
          if (!state.achievements.done) state.achievements.done = {};
          state.achievements.done[a.id] = { at: Date.now() };
          self.addPoints(a.points);
          newly.push(a);
        }
      });
      if (newly.length) self.emit();
      if (showPopup && newly.length && global.UI && UI.showAchievement) UI.showAchievement(newly);
      return newly;
    },

    /** 记录某功能的使用次数并检测相关成就（初出茅庐 / 小有心得 / 炉火纯青） */
    bumpUsage: function (key) {
      if (!state.usage) state.usage = {};
      state.usage[key] = (state.usage[key] || 0) + 1;
      this.checkAchievements(true);
      this.save();
      return state.usage[key];
    },

    /** 寻访数据窗口：最近 100 抽 ∩ 近 30 天（取较小窗口） */
    gachaHistory: function () {
      var pm = state.pomodoro;
      var log = (pm.gacha && pm.gacha.log) || [];
      var cutoff = Date.now() - 30 * 86400000;
      var last100 = log.slice(0, 100);
      var set = last100.filter(function (p) { return (p.t || 0) >= cutoff; });
      var stats = { pulls: set.length, r6: 0, r5: 0, r4: 0, r3: 0, byDay: {} };
      set.forEach(function (p) {
        if (p.r >= 6) stats.r6++;
        else if (p.r === 5) stats.r5++;
        else if (p.r === 4) stats.r4++;
        else stats.r3++;
        var d = p.t ? DateUtil.toStr(new Date(p.t)) : '未知';
        stats.byDay[d] = (stats.byDay[d] || 0) + 1;
      });
      var days = Object.keys(stats.byDay).sort(function (a, b) { return a < b ? 1 : -1; });
      return { set: set, stats: stats, days: days, last100: last100.length };
    },

    plantCost: function (speciesKey) {
      var sp = speciesOf(speciesKey || 'camphor');
      return (sp.price || POMO.PLANT_COST) + state.pomodoro.trees.length * POMO.PLANT_STEP;
    },

    /** 种一棵树，消耗当前价格的积分 */
    plantTree: function (speciesKey) {
      var pm = state.pomodoro;
      var cost = this.plantCost(speciesKey);
      if (pm.points < cost) return null;
      this.spendPoints(cost);
      var tree = {
        id: uid('tr'),
        plantedAt: new Date().toISOString(),
        growth: cost,
        species: speciesKey || 'camphor',
        waterCount: 0
      };
      pm.trees.push(tree);
      // 种树成就（3 / 6 / 9 棵）在此检测并弹窗
      this.checkAchievements(true);
      this.emit();
      return tree;
    },

    /** 浇水：消耗 WATER_COST，成长值增加 */
    waterTree: function (id) {
      var pm = state.pomodoro;
      if (pm.points < POMO.WATER_COST) return false;
      var tree = this.getTree(id);
      if (!tree) return false;
      this.spendPoints(POMO.WATER_COST);
      tree.growth += POMO.WATER_COST;
      tree.waterCount = (tree.waterCount || 0) + 1;
      this.emit();
      return true;
    },

    getTree: function (id) {
      for (var i = 0; i < state.pomodoro.trees.length; i++) {
        if (state.pomodoro.trees[i].id === id) return state.pomodoro.trees[i];
      }
      return null;
    },

    /** 专注统计：今日 / 本周 / 累计 */
    focusStats: function () {
      var today = DateUtil.toStr(DateUtil.today());
      var weekFrom = DateUtil.toStr(DateUtil.weekStart(DateUtil.today()));
      var todayMin = 0, weekMin = 0;
      (state.pomodoro.sessions || []).forEach(function (x) {
        if (x.date === today) todayMin += x.minutes;
        if (x.date >= weekFrom) weekMin += x.minutes;
      });
      return { today: todayMin, week: weekMin, total: state.pomodoro.focusMinutes };
    },

    /** 按标签汇总专注分钟：[{ full, lv1, lv2, minutes, count }] */
    focusByTag: function (ym) {
      var map = {};
      (state.pomodoro.sessions || []).forEach(function (x) {
        if (ym && String(x.date).slice(0, 7) !== ym) return;
        var tags = (x.tags && x.tags.length) ? x.tags : ['未打标签'];
        tags.forEach(function (t) {
          if (!map[t]) map[t] = { minutes: 0, count: 0 };
          map[t].minutes += x.minutes;
          map[t].count += 1;
        });
      });
      return Object.keys(map).map(function (k) {
        var parts = tagParts(k);
        return {
          full: k, lv1: parts.lv1, lv2: parts.lv2,
          minutes: map[k].minutes, count: map[k].count
        };
      }).sort(function (a, b) { return b.minutes - a.minutes; });
    },

    /** 指定标签下的专注分钟（一级标签汇总其所有二级） */
    focusMinutesByTag: function (filter, ym) {
      var total = 0;
      (state.pomodoro.sessions || []).forEach(function (x) {
        if (ym && String(x.date).slice(0, 7) !== ym) return;
        if (!filter || hasTag(x.tags, filter)) total += x.minutes;
      });
      return total;
    },

    /** 最近 7 天每天的专注分钟 */
    focusByDay: function (n) {
      n = n || 7;
      var out = [];
      for (var i = n - 1; i >= 0; i--) {
        var d = DateUtil.addDays(DateUtil.today(), -i);
        var ds = DateUtil.toStr(d);
        var m = 0;
        (state.pomodoro.sessions || []).forEach(function (x) {
          if (x.date === ds) m += x.minutes;
        });
        out.push({ date: ds, d: d, minutes: m });
      }
      return out;
    },

    /** 保存计时器状态（刷新后仍可恢复） */
    saveTimer: function (t) {
      state.pomodoro.timer = t;
      this.save();
    },

    /* ===== 计划 ===== */

    addPlan: function (data) {
      var type = PLAN_TYPES[data.type] ? data.type : 'checkin';
      var period = PLAN_PERIODS[data.period] ? data.period : 'daily';
      if (type !== 'checkin') period = 'once';   // 累加型不按周期
      var start = data.startDate || DateUtil.toStr(DateUtil.today());
      var days = Math.max(1, parseInt(data.days, 10) || 21);
      var unit = (data.unit || '').trim() || (
        type === 'duration' ? '分钟' :
        type === 'checkin' ? (period === 'daily' ? '天' : period === 'weekly' ? '周' : '次') : ''
      );

      // 打卡型的目标 = 槽位数；累加型用用户填的目标值
      var target = type === 'checkin'
        ? (period === 'once' ? 1 : days)
        : Math.max(1, parseFloat(data.target) || 1);

      var plan = {
        id: uid('pl'),
        title: (data.title || '').trim() || '未命名计划',
        note: (data.note || '').trim(),
        tags: normalizeTags(data.tags),
        type: type,
        period: period,
        startDate: start,
        days: days,
        target: target,
        unit: unit,
        color: data.color || '#4f46e5',
        records: [],
        done: false,
        important: !!data.important,
        doneAt: '',
        createdAt: new Date().toISOString()
      };
      state.plans.unshift(plan);
      this.emit();
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
        if (k === 'tags') plan.tags = normalizeTags(data.tags);
        else if (k === 'days') plan.days = Math.max(1, parseInt(data[k], 10) || plan.days);
        else if (k === 'target') plan.target = Math.max(1, parseFloat(data[k]) || plan.target);
        else plan[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
      });
      // 打卡型：目标始终跟随天数
      if (plan.type === 'checkin' && plan.period !== 'once') plan.target = plan.days;
      this.refreshPlanDone(plan);
      this.emit();
      return plan;
    },

    removePlan: function (id) {
      state.plans = state.plans.filter(function (x) { return x.id !== id; });
      this.emit();
    },

    getPlan: function (id) {
      for (var i = 0; i < state.plans.length; i++) {
        if (state.plans[i].id === id) return state.plans[i];
      }
      return null;
    },

    /** 打卡型的日期槽位 */
    planSlots: function (plan) {
      var slots = [];
      var start = DateUtil.parse(plan.startDate) || DateUtil.today();
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
      var v = this.planValue(plan);
      var t = plan.target || 1;
      var pct = Math.max(0, Math.min(100, Math.round(v / t * 100)));
      return { value: v, target: t, pct: pct, remain: Math.max(0, t - v) };
    },

    /** 连续打卡天数（仅每日打卡型） */
    planStreak: function (plan) {
      if (plan.type !== 'checkin' || plan.period !== 'daily') return 0;
      var doneDay = {};
      plan.records.forEach(function (r) { if (r.date) doneDay[r.date] = 1; });
      var n = 0;
      var cur = DateUtil.today();
      // 今天还没打卡时从昨天算起，不打断连续性
      if (!doneDay[DateUtil.toStr(cur)]) cur = DateUtil.addDays(cur, -1);
      while (doneDay[DateUtil.toStr(cur)]) {
        n++;
        cur = DateUtil.addDays(cur, -1);
      }
      return n;
    },

    /** 今日是否已打卡 */
    planDoneToday: function (plan) {
      var today = DateUtil.toStr(DateUtil.today());
      if (plan.type === 'checkin') return !!this.planRecordOfDate(plan, today);
      return plan.records.some(function (r) { return r.date === today; });
    },

    /** 打卡 / 取消打卡（打卡型） */
    togglePlanCheckin: function (id, dateStr) {
      var plan = this.getPlan(id);
      if (!plan || plan.type !== 'checkin') return null;
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
        this.bumpUsage('plan');
      }
      var wasDone = plan.done;
      this.refreshPlanDone(plan);
      // 积分：打卡 +2，本次促成完成再 +30
      var gain = 0;
      if (!exist) gain += POMO.PLAN_CHECKIN;
      if (!wasDone && plan.done) gain += POMO.PLAN_DONE;
      if (gain) this.addPoints(gain);
      this.emit();
      this.checkAchievements(true);
      return { checked: !exist, completed: plan.done && !exist, gain: gain };
    },

    /** 累加型：增加一笔数值 */
    addPlanValue: function (id, amount, note, dateStr) {
      var plan = this.getPlan(id);
      if (!plan || plan.type === 'checkin') return null;
      var v = parseFloat(amount);
      if (!v || v <= 0) return null;
      plan.records.push({
        date: dateStr || DateUtil.toStr(DateUtil.today()),
        value: v, note: (note || '').trim(), at: new Date().toISOString()
      });
      this.bumpUsage('plan');
      var wasDone = plan.done;
      this.refreshPlanDone(plan);
      var gain = POMO.PLAN_CHECKIN;
      if (!wasDone && plan.done) gain += POMO.PLAN_DONE;
      this.addPoints(gain);
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
      state.plans.forEach(function (p) {
        if (p.done) { finished++; return; }
        running++;
        // 只有打卡型才有「今日待打卡」概念
        if (p.type === 'checkin' && !self.planDoneToday(p)) todayPending++;
      });
      return { running: running, finished: finished, todayPending: todayPending, total: state.plans.length };
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
      var keys = ['sleep', 'course', 'event', 'activity', 'meal', 'idle'];
      var sum = {}, daily = [];
      keys.forEach(function (k) { sum[k] = 0; });

      dates.forEach(function (ds) {
        var st = this.dayStat(ds);
        var per = 0;
        st.segments.forEach(function (seg) {
          if (sum[seg.key] == null) sum[seg.key] = 0;
          sum[seg.key] += seg.minutes;
          if (seg.key !== 'idle') per += seg.minutes;
        });
        daily.push({ date: ds, d: DateUtil.parse(ds), recorded: per, idle: Math.max(0, 1440 - per) });
      }, this);

      var labels = { sleep: '睡眠', course: '上课', event: '日程', activity: '活动', meal: '用餐', idle: '未记录' };
      var colors = { sleep: '#6366f1', course: '#f59e0b', event: '#ec4899', activity: '#10b981', meal: '#ef4444', idle: '#e8eaf0' };
      var segments = keys.map(function (k) {
        return { key: k, label: labels[k], minutes: Math.round(sum[k] || 0), color: colors[k] };
      });
      var recorded = segments.reduce(function (a, b) {
        return a + (b.key === 'idle' ? 0 : b.minutes);
      }, 0);
      var total = dates.length * 1440;
      return {
        segments: segments, daily: daily,
        recorded: recorded, total: total,
        pct: total ? Math.round(recorded / total * 100) : 0,
        days: dates.length
      };
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
      var list = state.ledger.filter(function (e) {
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
        return { key: k, total: Math.round(map[k] * 100) / 100, cat: ledgerCat(type, k) };
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
      state.ledger.forEach(function (e) {
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

    /* ===== 灵感速记 ===== */
  addNote: function (data) {
    var n = {
      id: uid('n'),
      content: (data.content || '').trim(),
      tags: normalizeTags(data.tags),
      converted: false,
      createdAt: new Date().toISOString()
    };
    state.notes.unshift(n);
    this.bumpUsage('note');
    this.emit();
    return n;
  },

  updateNote: function (id, data) {
    var n = this.getNote(id);
    if (!n) return null;
    Object.keys(data).forEach(function (k) {
      if (k === 'tags') n.tags = normalizeTags(data.tags);
      else n[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
    });
    this.emit();
    return n;
  },

  removeNote: function (id) {
    state.notes = state.notes.filter(function (n) { return n.id !== id; });
    this.emit();
  },

  getNote: function (id) {
    for (var i = 0; i < state.notes.length; i++) {
      if (state.notes[i].id === id) return state.notes[i];
    }
    return null;
  },

  /* ===== 日记（一天一篇） ===== */
  /**
   * 写入某天的日记。已有则更新，没有则新建 —— 一天只可能有一条。
   * @param {object} data { date, content, mood, sourceNoteId }
   * @returns {object} 日记对象
   */
  saveDiary: function (data) {
    var date = (data.date || '').trim() || DateUtil.toStr(DateUtil.today());
    var exist = this.diaryOf(date);
    var content = typeof data.content === 'string' ? data.content : '';
    var mood = data.mood && moodOf(data.mood) ? data.mood : '';

    if (exist) {
      exist.content = content;
      exist.mood = mood;
      exist.updatedAt = new Date().toISOString();
      // sourceNoteId 只记录"最初从哪条灵感来的"，后续编辑不清空
      if (data.sourceNoteId) exist.sourceNoteId = data.sourceNoteId;
      this.emit();
      return exist;
    }

    var d = {
      id: uid('d'),
      date: date,
      content: content,
      mood: mood,                     // 选填，空串表示没标
      sourceNoteId: data.sourceNoteId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.diaries.unshift(d);
    this.bumpUsage('diary');
    this.emit();
    return d;
  },

  /** 只改心情（日历上快速标记用） */
  setDiaryMood: function (date, mood) {
    var d = this.diaryOf(date);
    if (!d) return null;
    d.mood = mood && moodOf(mood) ? mood : '';
    d.updatedAt = new Date().toISOString();
    this.emit();
    return d;
  },

  removeDiary: function (id) {
    state.diaries = state.diaries.filter(function (d) { return d.id !== id; });
    this.emit();
  },

  getDiary: function (id) {
    for (var i = 0; i < state.diaries.length; i++) {
      if (state.diaries[i].id === id) return state.diaries[i];
    }
    return null;
  },

  /** 某天的日记（一天一篇） */
  diaryOf: function (dateStr) {
    return diaryOn(state.diaries, dateStr);
  },

  /** 心情统计（把纯函数挂到 Store 上，界面层统一从 Store 取） */
  moodStats: function (from, to) {
    return moodStats(state.diaries, from, to);
  },

  /** 心情枚举 / 门槛，供界面层读取 */
  MOODS: MOODS,
  MOOD_MIN_DAYS: MOOD_MIN_DAYS,
  MOOD_CROSS_MIN_DAYS: MOOD_CROSS_MIN_DAYS,
  moodOf: moodOf,
  diaryDatePrompt: diaryDatePrompt,
  diariesSorted: function () { return diariesSorted(state.diaries); },

  /**
   * 全站标签（待办 / 灵感 / 活动 / 账目 / 专注 / 计划）
   * @returns [{ full, lv1, lv2, count, sources }]
   */
  allTags: function (sources) {
    var map = {};
    var buckets = {
      task: state.tasks, note: state.notes, activity: state.activities,
      ledger: state.ledger, session: state.pomodoro.sessions || [], plan: state.plans
    };
    var keys = sources || Object.keys(buckets);
    keys.forEach(function (k) {
      (buckets[k] || []).forEach(function (item) {
        (item.tags || []).forEach(function (x) { map[x] = (map[x] || 0) + 1; });
      });
    });
    return Object.keys(map).map(function (k) {
      var t = tagParts(k);
      return { full: k, lv1: t.lv1, lv2: t.lv2, count: map[k] };
    }).sort(function (a, b) {
      return b.count - a.count || (a.full < b.full ? -1 : 1);
    });
  },

  /** 标签层级树：[{ name, count, children:[{full, name, count}] }] */
  tagTree: function (sources) {
    var flat = this.allTags(sources);
    var order = [], map = {};
    flat.forEach(function (t) {
      if (!map[t.lv1]) { map[t.lv1] = { name: t.lv1, count: 0, children: [] }; order.push(t.lv1); }
      var g = map[t.lv1];
      g.count += t.count;
      if (t.lv2) g.children.push({ full: t.full, name: t.lv2, count: t.count });
    });
    return order.map(function (k) { return map[k]; });
  },

  /* ===== 标签图标 / 配色 ===== */

  /** 常用标签预设（含分组） */
  tagPresets: function () {
    return TAG_PRESETS.map(function (p) {
      return { name: p.name, icon: p.icon, color: p.color, group: p.g };
    });
  },

  tagGroups: function () { return TAG_GROUPS.slice(); },

  /** 某个标签的 { icon, color } */
  tagStyle: tagStyle,

  /** 只要颜色（图表用） */
  tagColor: function (tag) { return tagStyle(tag).color; },

  /**
   * 写入标签自定义样式
   * @param {string} tag 标签全名（支持 一级/二级）
   * @param {Object} patch { icon, color }，传 null 值表示清除
   */
  setTagMeta: function (tag, patch) {
    var full = tagFull(tag);
    if (!full) return null;
    var meta = tagMeta();
    var cur = meta[full] || {};
    var next = Object.assign({}, cur);
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] == null || patch[k] === '') delete next[k];
      else next[k] = patch[k];
    });
    meta[full] = next;
    this.emit();
    return next;
  },

  /** 清除某个标签的自定义样式 */
  clearTagMeta: function (tag) {
    var full = tagFull(tag);
    delete tagMeta()[full];
    this.emit();
  },

  /**
   * 重命名标签：同步所有用到它的记录，并迁移自定义样式
   * @returns {number} 受影响的条目数
   */
  renameTag: function (oldName, newName) {
    var from = tagFull(oldName), to = tagFull(newName);
    if (!from || !to || from === to) return 0;

    var buckets = [
      state.tasks, state.notes, state.activities,
      state.ledger, state.plans, state.pomodoro.sessions || []
    ];
    var n = 0;
    buckets.forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item.tags || !item.tags.length) return;
        var hit = false;
        item.tags = item.tags.map(function (t) {
          if (t === from) { hit = true; return to; }
          if (t.indexOf(from + '/') === 0) { hit = true; return to + t.slice(from.length); }
          return t;
        });
        if (hit) n++;
      });
    });

    /* 迁移自定义样式：本级 + 其下所有二级 */
    var meta = tagMeta();
    Object.keys(meta).forEach(function (k) {
      if (k === from) { meta[to] = Object.assign(meta[to] || {}, meta[k]); delete meta[k]; }
      else if (k.indexOf(from + '/') === 0) {
        meta[to + k.slice(from.length)] = meta[k];
        delete meta[k];
      }
    });

    this.emit();
    return n;
  },

  /** 删除标签：从所有记录中移除，并清掉自定义样式 */
  removeTagEverywhere: function (tag) {
    var full = tagFull(tag);
    if (!full) return 0;
    var buckets = [
      state.tasks, state.notes, state.activities,
      state.ledger, state.plans, state.pomodoro.sessions || []
    ];
    var n = 0;
    buckets.forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item.tags || !item.tags.length) return;
        var before = item.tags.length;
        item.tags = item.tags.filter(function (t) {
          return t !== full && t.indexOf(full + '/') !== 0;
        });
        if (item.tags.length !== before) n++;
      });
    });
    /* 同时清掉本级的样式，以及它下面所有二级的样式 */
    var meta = tagMeta();
    Object.keys(meta).forEach(function (k) {
      if (k === full || k.indexOf(full + '/') === 0) delete meta[k];
    });
    this.emit();
    return n;
  },

  /** 标签自动补全候选（去重后的一级与二级全名） */
  tagSuggest: function () {
    var set = {}, out = [];
    Object.keys({
      t: state.tasks, n: state.notes, a: state.activities,
      l: state.ledger, s: state.pomodoro.sessions || [], p: state.plans
    }).forEach(function (k) {
      var b = { t: state.tasks, n: state.notes, a: state.activities,
                l: state.ledger, s: state.pomodoro.sessions || [], p: state.plans }[k];
      (b || []).forEach(function (item) {
        (item.tags || []).forEach(function (x) { set[x] = 1; });
      });
    });
    Object.keys(set).forEach(function (k) { out.push(k); });
    return out.sort();
  },

  /* ===== 记账 ===== */
  addLedger: function (data) {
    var e = {
      id: uid('lg'),
      type: data.type === 'income' ? 'income' : 'expense',
      amount: Math.round((Number(data.amount) || 0) * 100) / 100,
      category: data.category || (data.type === 'income' ? 'other_in' : 'other'),
      note: (data.note || '').trim(),
      date: data.date || DateUtil.toStr(DateUtil.today()),
      time: data.time || DateUtil.nowHM(),
      source: data.source || 'manual',
      refId: data.refId || '',
      tags: normalizeTags(data.tags),
      createdAt: new Date().toISOString()
    };
    if (e.amount <= 0) return null;
    state.ledger.push(e);
    this.bumpUsage('ledger');
    this.emit();
    return e;
  },

  updateLedger: function (id, data) {
    var e = this.getLedgerEntry(id);
    if (!e) return null;
    Object.keys(data).forEach(function (k) {
      if (k === 'amount') e[k] = Math.round((Number(data[k]) || 0) * 100) / 100;
      else if (k === 'tags') e[k] = normalizeTags(data.tags);
      else e[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
    });
    this.emit();
    return e;
  },

  removeLedger: function (id) {
    state.ledger = state.ledger.filter(function (e) { return e.id !== id; });
    this.emit();
  },

  getLedgerEntry: function (id) {
    for (var i = 0; i < state.ledger.length; i++) {
      if (state.ledger[i].id === id) return state.ledger[i];
    }
    return null;
  },

  /** 由饮食记录生成的那条账目 */
  ledgerByRef: function (refId) {
    for (var i = 0; i < state.ledger.length; i++) {
      if (state.ledger[i].refId === refId && state.ledger[i].source === 'meal') {
        return state.ledger[i];
      }
    }
    return null;
  },

  /** 某月（YYYY-MM）流水；不传则全部 */
  ledgerOfMonth: function (ym) {
    return state.ledger.filter(function (e) {
      return !ym || e.date.slice(0, 7) === ym;
    }).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  },

  /** 收支汇总 */
  ledgerStats: function (ym) {
    var income = 0, expense = 0;
    this.ledgerOfMonth(ym).forEach(function (e) {
      if (e.type === 'income') income += e.amount;
      else expense += e.amount;
    });
    return {
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100
    };
  },

  /** 按标签汇总金额：[{ full, lv1, lv2, amount, count }] */
  ledgerByTag: function (ym) {
    var map = {};
    this.ledgerOfMonth(ym).forEach(function (e) {
      var tags = (e.tags && e.tags.length) ? e.tags : ['未打标签'];
      tags.forEach(function (t) {
        if (!map[t]) map[t] = { amount: 0, count: 0 };
        map[t].amount += e.amount;
        map[t].count += 1;
      });
    });
    return Object.keys(map).map(function (k) {
      var parts = tagParts(k);
      return {
        full: k, lv1: parts.lv1, lv2: parts.lv2,
        amount: Math.round(map[k].amount * 100) / 100, count: map[k].count
      };
    }).sort(function (a, b) { return b.amount - a.amount; });
  },

  /** 分类统计（支出） */
  ledgerByCategory: function (ym) {
    var map = {};
    this.ledgerOfMonth(ym).forEach(function (e) {
      if (e.type !== 'expense') return;
      map[e.category] = (map[e.category] || 0) + e.amount;
    });
    return Object.keys(map).map(function (k) {
      return { key: k, total: Math.round(map[k] * 100) / 100, cat: ledgerCat('expense', k) };
    }).sort(function (a, b) { return b.total - a.total; });
  },

  /** 最近 n 天每日支出 */
  ledgerByDay: function (n) {
    n = n || 7;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = DateUtil.addDays(DateUtil.today(), -i);
      var ds = DateUtil.toStr(d);
      var sum = 0;
      state.ledger.forEach(function (e) {
        if (e.date === ds && e.type !== 'income') sum += e.amount;
      });
      out.push({ date: ds, d: d, amount: Math.round(sum * 100) / 100 });
    }
    return out;
  },

  /* ===== 记录开关 ===== */
    updateSettings: function (data) {
      Object.assign(state.settings, data);
      this.emit();
    },

    get settings() { return state.settings; },

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
      if (hit && hit.rev === rev) return hit.val;
      var val = this._dayStat(dateStr);
      dayStatCache[dateStr] = { rev: rev, val: val };
      return val;
    },

    _dayStat: function (dateStr) {
      var d = DateUtil.parse(dateStr) || DateUtil.today();
      var dow = DateUtil.isoDow(d);
      var weekNo = this.weekOf(d);

      var courses = this.coursesOnDay(dow, weekNo);
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
      activities.forEach(function (a) { ar = ar.concat(expandRange(a.start, a.end)); });

      var events = this.eventsOf(dateStr);
      var er = [];
      events.forEach(function (e) { er = er.concat(expandRange(e.start, e.end)); });

      var meals = state.settings.trackMeal ? this.mealsOf(dateStr) : [];
      var mr = [];
      meals.forEach(function (m) {
        var dur = mealType(m.type).min;
        mr = mr.concat(expandRange(m.time, TimeUtil.addMin(m.time, dur)));
      });

      var sleepMin = state.settings.trackSleep ? this.sleepMinutes(dateStr) : 0;

      var segs = [
        { key: 'sleep', label: '睡眠', minutes: sleepMin, color: '#6366f1' },
        { key: 'course', label: '上课', minutes: mergeTotal(cr), color: '#f59e0b' },
        { key: 'event', label: '日程', minutes: mergeTotal(er), color: '#ec4899' },
        { key: 'activity', label: '活动记录', minutes: mergeTotal(ar), color: '#10b981' },
        { key: 'meal', label: '用餐', minutes: mergeTotal(mr), color: '#ef4444' }
      ];

      var recorded = segs.reduce(function (s, x) { return s + x.minutes; }, 0);
      var idle = Math.max(0, 1440 - recorded);
      segs.push({ key: 'idle', label: '未记录', minutes: idle, color: '#e8eaf0' });

      return { segments: segs, idle: idle, courses: courses, events: events };
    },

    /* ===== 设置 ===== */
    updateSemester: function (data) {
      var cur = this.currentSemester();
      Object.keys(data || {}).forEach(function (k) {
        if (typeof data[k] === 'string') cur[k] = data[k].trim();
        else cur[k] = data[k];
      });
      this.emit();
    },

    setPeriods: function (list) {
      state.periods = list;
      this.emit();
    },

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
    exportJSON: function (scope) {
      var s = scope || 'full';
      if (s === 'full') return JSON.stringify(state, null, 2);

      var out = JSON.parse(JSON.stringify(state));

      // 两档都不带自定义图片：图片 base64 会撑爆同步码，且换设备本就要重选图
      if (out.settings) {
        if (out.settings.background) out.settings.background.dataUrl = '';
        if (out.settings.pet) out.settings.pet.src = '';
        // 密钥属于本机凭据，不随同步码外传
        if (out.settings.asr) { out.settings.asr.appId = ''; out.settings.asr.apiKey = ''; out.settings.asr.apiSecret = ''; }
        if (out.settings.ocr) { out.settings.ocr.apiKey = ''; }
      }
      // 日记一律不进同步码。用 delete 而不是置空数组：
      // 置空会在导入端被当成「对方没有日记」而覆盖掉本机已有的日记
      delete out.diaries;

      if (s === 'standard') {
        out.exportScope = 'standard';
        return JSON.stringify(out, null, 2);
      }

      // lite：只留课表骨架，其余清空（保留空结构，方便导入端直接覆盖）
      var empty = defaultState();
      out.tasks = [];      out.taskSeq = {};
      out.plans = [];      out.ledger = [];      out.notes = [];
      out.events = [];     out.activities = [];  out.meals = [];   out.sleeps = [];
      out.grades = {};
      out.achievements = { done: {} };
      out.usage = {};
      out.pomodoro = empty.pomodoro;
      // 设置只保留影响课表展示的项
      var keep = ['theme', 'customColor', 'nav', 'navOrder', 'background'];
      var ns = {};
      keep.forEach(function (k) { if (out.settings && out.settings[k] !== undefined) ns[k] = out.settings[k]; });
      out.settings = Object.assign({}, empty.settings, ns);
      if (out.settings.background) out.settings.background.dataUrl = '';
      if (out.settings.pet) out.settings.pet.src = '';
      out.exportScope = 'lite';
      return JSON.stringify(out, null, 2);
    },

    importJSON: function (text) {
      var obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object') throw new Error('数据格式不正确');
      if (!obj.courses && !obj.tasks && !obj.settings && !obj.plans && !obj.ledger &&
          !obj.notes && !obj.diaries && !obj.events && !obj.activities) {
        throw new Error('没有找到可恢复的数据');
      }
      var ds = defaultState();
      state = {
        version: 2,
        model: obj.model || 2,
        semesters: (obj.semesters && obj.semesters.length) ? obj.semesters : [
          Object.assign({ id: uid('sem') }, ds.semesters[0], obj.semester || {})
        ],
        currentSemesterId: obj.currentSemesterId || '',
        grades: obj.grades || {},
        periods: (obj.periods && obj.periods.length) ? obj.periods : ds.periods,
        courses: obj.courses || [],
        tasks: obj.tasks || [],
        taskSeq: obj.taskSeq || {},
        settings: Object.assign({}, ds.settings, obj.settings || {}),
        pomodoro: Object.assign({}, ds.pomodoro, obj.pomodoro || {}),
        plans: obj.plans || [],
        achievements: obj.achievements || { done: {} },
        ledger: obj.ledger || [],
        notes: obj.notes || [],
        // 日记特殊处理：同步码里根本没有 diaries 这个键。
        // 如果是「文件备份」缺这个键，说明是老备份，保留本机日记；
        // 如果明确给了数组（哪怕是空数组），就按给的来 —— 那是用户主动导入的完整备份。
        diaries: Array.isArray(obj.diaries) ? obj.diaries : (state && state.diaries) || [],
        events: obj.events || [],
        activities: obj.activities || [],
        meals: obj.meals || [],
        sleeps: obj.sleeps || [],
        usage: obj.usage || {}
      };
      // 旧备份没有 subtask 字段：逐项补齐，别让 Object.assign 把整个对象盖掉
      state.settings.subtask = Object.assign({}, ds.settings.subtask, state.settings.subtask || {});
      // 日记同理：旧备份没有 diary 设置，逐项补，不整块覆盖
      state.settings.diary = Object.assign({}, ds.settings.diary, state.settings.diary || {});
      this.ensure();
      this.emit();
    },

    reset: function () {
      state = defaultState();
      this.emit();
    }
  };

  global.DateUtil = DateUtil;
  global.TimeUtil = TimeUtil;
  global.MEAL_TYPES = MEAL_TYPES;
  global.ACT_TYPES = ACT_TYPES;
  global.actType = actType;
  global.mealType = mealType;
  global.POMO = POMO;
  global.LEDGER_CATS = LEDGER_CATS;
  global.RANGES = RANGES;
  global.LEDGER_RANGES = LEDGER_RANGES;
  global.rangeDates = rangeDates;
  global.compareRange = compareRange;
  global.perDay = perDay;
  global.weekBounds = weekBounds;
  global.monthBounds = monthBounds;
  global.sleepByNight = sleepByNight;
  global.MOODS = MOODS;
  global.MOOD_MIN_DAYS = MOOD_MIN_DAYS;
  global.MOOD_CROSS_MIN_DAYS = MOOD_CROSS_MIN_DAYS;
  global.moodOf = moodOf;
  global.moodTone = moodTone;
  global.diaryDatePrompt = diaryDatePrompt;
  global.moodStats = moodStats;
  global.diaryOn = diaryOn;
  global.diariesSorted = diariesSorted;
  global.eachDate = eachDate;
  global.PLAN_TYPES = PLAN_TYPES;
  global.PLAN_PERIODS = PLAN_PERIODS;
  global.normalizeTags = normalizeTags;
  global.tagParts = tagParts;
  global.tagFull = tagFull;
  global.tagMatch = tagMatch;
  global.hasTag = hasTag;
  global.tagStyle = tagStyle;
  global.ledgerCat = ledgerCat;
  global.TREE_STAGES = TREE_STAGES;
  global.TREE_SPECIES = TREE_SPECIES;
  global.speciesOf = speciesOf;
  global.treeStage = treeStage;
  global.SUBTASK_DEFAULTS = SUBTASK_DEFAULTS;
  global.subOpts = subOpts;
  global.isChild = isChild;
  global.childrenOf = childrenOf;
  global.subtaskProgress = subtaskProgress;
  global.childIds = childIds;
  global.Store = Store;
})(window);


