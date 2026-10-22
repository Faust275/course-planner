

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
  // 20 色课程调色板统一从 palette.js 取，和外观主题共用一套色
  var COLORS = (typeof Palette !== 'undefined' && Palette.COURSE_COLORS) || [
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
        trackMeal: true, trackSleep: true, statsOn: true,   // statsOn：是否开启「统计」功能（待办的统计分页 + 今日卡片）
        showWeekend: true,   // 课表是否显示周六、周日两列（关掉只影响展示，课程数据不动）
        statsWidgets: { time: true, curve: true, sources: true, spend: true, course: true },  // 统计分页里想看哪些卡片
        health: { on: true, sleepMinH: 6, kcalOver: true, activityMinH: 0 },  // 今日健康提示：阈值由用户定
        theme: 'indigo', customColor: '#4f46e5',
        themeSkin: true,          // 机制主题皮肤：开启时跟随奖励模式（森林→自然 / 抽卡→工厂）
        themeSkinAuto: true,      // 自动跟随时由机制提供默认强调色；用户手动选色后变为 false
        themeMode: 'auto',        // 明暗：auto（跟随系统）/ light / dark
        natureTheme: 'pine',      // 自然主题预设：pine(晨雾松林) | aurora(极光苍穹) | sunset(暮霞熔金) | slate(山岚青黛)
        arkTheme: 'terminal',     // 明日方舟预设：terminal(经典终端) | roguelike(集成战略水墨)
        quiz: { right: 0, wrong: 0 },
        nav: { today: true, schedule: true,
               tasks: true, pomodoro: true, settings: true },
        navOrder: [],   // 自定义模块顺序（空 = 用默认顺序）
        ui: { sidebarMini: false },   // 桌面侧边栏是否折叠成图标条
        devArknights: false,         // 开发者选项：输入「明日方舟」开启抽卡系统；默认关闭（仅种树）
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
        // 生理节律与精力高峰偏好（详见「设置 → 精力高峰」）
        energy: {
          custom: false,
          peaks: [
            { start: '09:00', end: '11:30', name: '晨间黄金专注期' },
            { start: '15:00', end: '17:30', name: '午后高效期' },
            { start: '19:30', end: '21:30', name: '晚间静心期' }
          ]
        },
        // 子任务行为（详见「设置 → 子任务」）。前三项会互相影响，设置页有互斥提示
        subtask: {
          autoDoneParent: false,   // 子任务全完成 → 自动完成父任务
          cascadeDone: false,      // 父任务完成 → 未完成子任务一并完成
          orphanKeep: true,        // 删除父任务时子任务保留（提升为顶层）；false = 一起删
          showProgress: true       // 父任务显示 2/4 进度徽章
        },
        subtaskHinted: false,      // 是否已弹过「子任务默认行为」一次性说明
        // 目标（详见「设置 → 目标」）
        goals: {
          monthlyReview: true,     // 每月最后三天提示做一次复盘
          reviewDismissed: ''      // 已选择「这个月不再提醒」的月份（YYYY-MM）
        },
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
        gacha: { pity6: 0, total: 0, ops: [], log: [], dailyGuaranteeDay: '', streakNo6: 0, streakNo5: 0,
                 limited: { target: '', count: 0 }, wishlist: [] },
        earned: 0,          // 累计获得
        pointLog: [],       // 积分流水：[{date, n, src}]，src ∈ focus/task/plan/goal/ach/sleep/meal/activity
        focusMinutes: 0,    // 累计专注分钟
        trees: [],          // 林地树位（最多 4 棵）
        treesPlanted: 0,    // 累计种下棵数（种树成就用）
        harvested: 0,       // 累计收获棵数（收藏）
        selectedSpecies: 'camphor',  // 下次种下的树种
        sessions: [],
        timer: { running: false, endAt: 0, left: 0, duration: 45, taskId: '', treeId: '' }
      },
      plans: [],       // 计划（打卡 / 进度）
      goals: [],       // 目标（目标 → 关键结果 → 计划/待办）
      ledger: [],      // 记账流水
      notes: [],       // 灵感速记
      diaries: [],     // 日记（一天一篇，key 为 YYYY-MM-DD）
      events: [],      // 一次性日程
      activities: [],  // 活动记录
      meals: [],       // 饮食记录
      sleeps: [],      // 睡眠记录
      sleepSession: null,  // 进行中的睡眠计时：{ date: 入睡日, start: 'HH:MM', at: 毫秒时间戳 }
      achievements: { done: {} },  // 成就系统：{ done: { 成就id: { at: 时间戳 } } }
      usage: {},                // 功能使用次数：{ 功能key: 次数 }（历练成就用）
      shop: {                   // 商城：月卡 / 潜能兑换 / 限定专区
        card: null,             // 月卡 { startDate, endDate, days:{}, weekAwardEnd, fullAwarded, paid, gained, mode }
        activeDays: {},         // 近 120 天「打开过应用」的日期（旧口径，仅统计用）：{ 'YYYY-MM-DD': 1 }
        dupPool: [],            // 满潜重复待兑换：[{ n, r, pts, at }]
        validDays: {},          // 有效日：{ 'YYYY-MM-DD': 当天有效动作次数 }（新签到口径）
        growth: 0,              // 成长值：重度动作 2 / 轻度 1，满 GROWTH_PER_TICKET 换 1 张摸鱼券
        streak: { weekEnd: '', monthEnd: '' },  // 全勤发奖窗口（滚动，不重叠）
        tickets: { selection: 0, fish: 0 },     // 定向券（月全勤）/ 摸鱼券（周+月全勤 + 成长值）
        fishLog: [],            // 摸鱼券使用日期（滚动 7 天限 FISH_MAX_PER_WEEK）
        log: []                 // 最近 100 条商城记录
      }
    };
  }

  /**
   * 商城状态逐项合并：老备份没有 shop 整块缺失，新备份也可能缺某个子键。
   * importJSON 必须走这里，不能裸 `obj.shop` —— 否则 ensure 里取 tickets 直接崩。
   */
  function mergeShop(def, src) {
    var s = (src && typeof src === 'object') ? src : {};
    return {
      card: s.card === undefined ? def.card : s.card,
      activeDays: Object.assign({}, s.activeDays || {}),
      dupPool: Array.isArray(s.dupPool) ? s.dupPool : [],
      validDays: Object.assign({}, s.validDays || {}),
      growth: typeof s.growth === 'number' ? s.growth : (def.growth || 0),
      streak: Object.assign({}, def.streak, s.streak || {}),
      tickets: Object.assign({}, def.tickets, s.tickets || {}),
      fishLog: Array.isArray(s.fishLog) ? s.fishLog : [],
      log: Array.isArray(s.log) ? s.log : []
    };
  }

  /**
   * 强 Schema 校验与迁移器 (Declarative Schema Validator & Sanitizer)
   * 对外部导入、旧备份、本地存储读入的数据进行深层结构检验与默认值修复，
   * 杜绝因缺失属性导致的空指针崩溃（TypeError: reading 'x' of undefined）。
   * @param {Object} raw - 输入的数据对象
   * @returns {Object} 符合规范的完整 state 对象
   */
  function validateSchema(raw) {
    var def = defaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return def;
    }

    var out = Object.assign({}, def, raw);

    // 1. 数组类型安全收敛
    var arrayKeys = [
      'courses', 'tasks', 'plans', 'goals', 'ledger', 'notes',
      'diaries', 'events', 'activities', 'meals', 'sleeps',
      'courseExceptions', 'periods', 'semesters'
    ];
    arrayKeys.forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = Array.isArray(def[k]) ? def[k].slice() : [];
    });

    // 2. 学期与节次校验
    if (!out.semesters.length) out.semesters = def.semesters.slice();
    if (!out.periods.length) out.periods = def.periods.slice();
    if (!out.currentSemesterId || !out.semesters.some(function (s) { return s.id === out.currentSemesterId; })) {
      out.currentSemesterId = out.semesters[0].id;
    }

    // 3. Settings 深度校验与收敛
    var s = (out.settings && typeof out.settings === 'object' && !Array.isArray(out.settings)) ? out.settings : {};
    out.settings = Object.assign({}, def.settings, s);
    out.settings.subtask = subOpts(out.settings);
    out.settings.statsWidgets = Object.assign({}, def.settings.statsWidgets, s.statsWidgets || {});
    out.settings.health = Object.assign({}, def.settings.health, s.health || {});
    out.settings.ui = Object.assign({}, def.settings.ui, s.ui || {});
    out.settings.goals = Object.assign({}, def.settings.goals, s.goals || {});
    out.settings.diary = Object.assign({}, def.settings.diary, s.diary || {});
    out.settings.diet = Object.assign({}, def.settings.diet, s.diet || {});
    out.settings.gpa = Object.assign({}, def.settings.gpa, s.gpa || {});
    out.settings.tagMeta = (s.tagMeta && typeof s.tagMeta === 'object') ? s.tagMeta : {};
    out.settings.nav = Object.assign({}, def.settings.nav, s.nav || {});
    if (!Array.isArray(out.settings.navOrder)) out.settings.navOrder = [];
    if (['auto', 'light', 'dark'].indexOf(out.settings.themeMode) < 0) out.settings.themeMode = 'auto';
    if (typeof out.settings.themeSkin !== 'boolean') out.settings.themeSkin = true;
    if (typeof out.settings.themeSkinAuto !== 'boolean') out.settings.themeSkinAuto = true;
    if (!out.settings.natureTheme) out.settings.natureTheme = 'pine';
    if (!out.settings.arkTheme) out.settings.arkTheme = 'terminal';
    if (typeof out.settings.showWeekend !== 'boolean') out.settings.showWeekend = true;
    if (typeof out.settings.statsOn !== 'boolean') out.settings.statsOn = true;

    // 4. Pomodoro 深度校验
    var pm = (out.pomodoro && typeof out.pomodoro === 'object' && !Array.isArray(out.pomodoro)) ? out.pomodoro : {};
    out.pomodoro = Object.assign({}, def.pomodoro, pm);
    out.pomodoro.points = Math.max(0, Number(pm.points) || 0);
    out.pomodoro.jade = Math.max(0, Number(pm.jade) || 0);
    out.pomodoro.mode = (pm.mode === 'gacha' && out.settings.devArknights) ? 'gacha' : 'forest';
    out.pomodoro.trees = Array.isArray(pm.trees) ? pm.trees : [];
    out.pomodoro.pointLog = Array.isArray(pm.pointLog) ? pm.pointLog : [];
    out.pomodoro.sessions = Array.isArray(pm.sessions) ? pm.sessions : [];
    out.pomodoro.timer = Object.assign({}, def.pomodoro.timer, pm.timer || {});

    // Gacha 状态校验
    var gc = (pm.gacha && typeof pm.gacha === 'object') ? pm.gacha : {};
    out.pomodoro.gacha = Object.assign({}, def.pomodoro.gacha, gc);
    out.pomodoro.gacha.ops = Array.isArray(gc.ops) ? gc.ops : [];
    out.pomodoro.gacha.log = Array.isArray(gc.log) ? gc.log : [];
    out.pomodoro.gacha.pools = (gc.pools && typeof gc.pools === 'object') ? gc.pools : {};
    ['standard', 'classic'].forEach(function (pid) {
      var p = out.pomodoro.gacha.pools[pid];
      if (!p || typeof p !== 'object') p = out.pomodoro.gacha.pools[pid] = {};
      p.pity6 = Math.max(0, Number(p.pity6) || 0);
      p.total = Math.max(0, Number(p.total) || 0);
      p.spark = Math.max(0, Number(p.spark) || 0);
      p.guaranteed = !!p.guaranteed;
    });
    out.pomodoro.gacha.limited = Object.assign({}, def.pomodoro.gacha.limited, gc.limited || {});

    // 5. Shop 深度校验（核心防崩溃区）
    out.shop = mergeShop(def.shop, out.shop);

    // 6. 成就与使用统计
    var ach = (out.achievements && typeof out.achievements === 'object') ? out.achievements : {};
    out.achievements = { done: (ach.done && typeof ach.done === 'object') ? ach.done : {} };
    out.usage = (out.usage && typeof out.usage === 'object') ? out.usage : {};
    out.taskSeq = (out.taskSeq && typeof out.taskSeq === 'object') ? out.taskSeq : {};

    // 7. 睡眠临时会话校验
    if (out.sleepSession && (!out.sleepSession.date || !out.sleepSession.start || typeof out.sleepSession.at !== 'number')) {
      out.sleepSession = null;
    }

    return out;
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

  /* ---- 时间区间：实现已移到 stats-calc.js，这里只保留调用别名 ---- */
  /** 把 (start, end) 拆成 0–1440 内的区间，跨午夜拆为两段 */
  function expandRange(start, end) {
    return StatsCalc.expandRange(start, end, TimeUtil);
  }

  /** 某一天实际睡了多少分钟（跨午夜按实际归属拆到两天） */
  function sleepByNight(sleeps, dateStr, _next) {
    return StatsCalc.sleepByNight(sleeps, dateStr, DateUtil, TimeUtil);
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
    year:  { key: 'year',  name: '今年', mode: 'cal', days: 365 },
    recent7:  { key: 'recent7',  name: '最近 7 天',  mode: 'win', days: 7 },
    recent30: { key: 'recent30', name: '最近 30 天', mode: 'win', days: 30 }
  };

  /** 记账页用的四档（自然口径为主，末档保留滑动窗口） */
  var LEDGER_RANGES = ['day', 'week', 'month', 'recent30'];

  /* ---- 日期区间：实现已移到 stats-calc.js，这里只保留薄封装 ---- */
  /** 自然周 / 自然月的起止（周一为一周之始），导出给视图与单测用 */
  function weekBounds(d) {
    return StatsCalc.weekBounds(d, DateUtil);
  }
  function monthBounds(d) {
    return StatsCalc.monthBounds(d, DateUtil);
  }

  /**
   * 日期区间（含两端）。「今天 / 本周 / 本月」的 to 一律截到今天——
   * 统计不该把未来的空白天算进分母。term 口径需要当前学期，由这里补默认值。
   */
  function rangeDates(key, sem) {
    return StatsCalc.rangeDates(key, {
      util: DateUtil,
      ranges: RANGES,
      today: DateUtil.today(),
      semester: sem || (state && Store.currentSemester ? Store.currentSemester() : null)
    });
  }

  /** 参照区间：同口径往前挪一个周期，用来做「比上次」 */
  function compareRange(key, r) {
    return StatsCalc.compareRange(key, r || rangeDates(key), {
      util: DateUtil, ranges: RANGES
    });
  }

  /** 日均（保留一位小数），供跨长度区间比较 */
  function perDay(total, days) {
    return StatsCalc.perDay(total, days);
  }

  /** 区间内每天的日期字符串 */
  function eachDate(from, to) {
    return StatsCalc.eachDate(from, to, DateUtil);
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
    POINT_PER_MIN: 0.1,    // 每专注 1 分钟（整体下调到原 1/10）
    TASK_DONE: 1,          // 完成一个待办
    PLAN_CHECKIN: 0.2,     // 完成一次打卡
    PLAN_DONE: 3,          // 完成一个计划
    GOAL_DONE: 6,          // 目标推进到 100% 并归档留档（每目标一次，周期需满 7 天）
    KR_DONE: 1.5,          // 单条 KR 首次达成 100%（每 KR 一次）
    /* —— 记录类发分（睡眠 / 饮食 / 活动）：本轮移除积分 —— */
    SLEEP_DAY: 0,          // 每天首条睡眠记录（已移除积分）
    MEAL_EACH: 0,          // 每餐（已移除积分）
    MEAL_MAX_DAY: 3,       // 每天封顶几餐（仅记录用）
    ACTIVITY_PER_MIN: 0,   // 活动每分钟积分（已移除积分）
    ACTIVITY_MAX_DAY: 60,   // 活动每天积分上限（仅记录用）
    PLANT_COST: 10,        // 第一棵树（种树花费整体 ×0.1）
    PLANT_STEP: 3,         // 每多一棵，价格递增
    WATER_COST: 2,         // 浇一次水
    /* —— 抽卡机制 —— */
    JADE_PER_POINT: 180,   // 1 积分 = 180 合成玉（PULL_COST 仍为 600，故单抽 ≈ 3.33 积分）
    PULL_COST: 600,        // 单抽 600 合成玉（≈ 3.33 积分）
    TEN_COST: 6000,        // 十连 6000 合成玉（= 10 积分）
    RATE_6: 2,             // 六星基础概率 %
    RATE_5: 8,
    RATE_4: 50,
    PITY_START: 50,        // 50 抽后概率递增
    PITY_STEP: 2,          // 每抽 +2%
    TEN_GUARANTEE: 5,      // 十连保底至少五星
    POT_MAX: 5,            // 潜能上限（干员最多 6 份复制，潜能 0~5）
    DUP_POINTS: { 6: 10, 5: 3, 4: 0.5, 3: 0.2 },  // 满潜能后，每多抽一份转化的积分（按星级，可再换成合成玉）
    /* —— 专注 —— */
    FOCUS_REWARD: 10,      // 一次合格专注固定给的养分（积分）
    FOCUS_MIN_MIN: 40,     // 计入奖励的最短专注分钟（≥40 才算）
    FOCUS_REMIND_MIN: 60,  // 专注满 60 分钟提醒起来走走

    /* —— 种树 —— */
    GROVE_SLOTS: 4,        // 树位上限（固定 4）
    REVIVE_COST: 5,        // 复活枯桩消耗的养分

    /* —— 商城 —— */
    CARD_PRICE: 300,       // 月卡售价（森林积分）
    CARD_PRICE_GACHA: 54000, // 月卡售价（抽卡模式，合成玉；占位数值，待定）
    CARD_DAYS: 30,         // 月卡有效天数
    CARD_DAILY: 25,        // 每天用任意功能返还的积分（30 天全勤总返还约为售价的 3 倍）
    CARD_WEEK_BONUS: 25,   // 滚动 7 天全勤的额外奖励（券由全勤统一发，见 settleStreak）
    CARD_FULL_BONUS: 50,   // 30 天全勤的额外奖励（另发 1 张定向券）
    /* —— 有效动作 / 全勤 / 摸鱼券 —— */
    VALID_DAY_MIN: 2,      // 一天算「有效日」所需的最少有效动作次数
    GROWTH_PER_TICKET: 10, // 成长值满 10 换 1 张摸鱼券（重度动作 2 分，轻度 1 分 → 5 次合格专注 = 1 张）
    FISH_MAX_PER_WEEK: 5,  // 摸鱼券：滚动 7 天内最多用 5 张
    FISH_HOLD_MAX: 20,     // 摸鱼券持有上限
    STREAK_WEEK_POINTS: 5, // 连续 7 个有效日：人人可得的积分
    STREAK_MONTH_POINTS: 20, // 连续 30 个有效日：人人可得的积分

    /* —— 限定获取通道 —— */
    LIMITED_SPARK: 200,    // 限定井：累计抽数达到可直接兑换登记的限定（双井并计，但不叠加）

    /* —— 卡池（配置驱动：新增干员只改 ak_ops.js 的 poolTag；新增池只改这里）—— */
    GACHA_EPOCH: '2026-01-01',   // 轮换基准日：期号按绝对日期算，跨设备一致
    GACHA_POOLS: {
      standard: {
        id: 'standard', name: '标准寻访', tag: 'std',
        rotDays: 3, up6: 2, up5: 3, spark: 120, sparkHistory: 5, offLimited: 0.15,
        desc: '常规干员轮换 UP；歪出的是本池其他干员，另有低概率歪到限定'
      },
      classic: {
        id: 'classic', name: '中坚寻访', tag: 'classic',
        rotDays: 3, up6: 2, up5: 3, spark: 120, sparkHistory: 5, offLimited: 0.15,
        desc: '早期实装的老牌干员，独立计数，与标准寻访不互通'
      }
    }
  };

  /**
   * 树种：shape 决定树冠形态（round 圆冠 / cone 锥冠 / fan 扇形 / droop 垂枝 / palm 棕榈）
   * lastK：第 4→5 阶段需要记数（3~6，越珍稀越多）
   * bloom：成树时的花/果颜色（null 表示无）
   * unlockH：累计专注满多少小时解锁（0 = 初始可用）
   * info：图鉴资料卡（学名 / 科属 / 保护级别 / 一句话）
   */
  var TREE_SPECIES = [
    { key: 'camphor', name: '樟树', crown: '#4c8c4a', crown2: '#3f7d3d', trunk: '#7a5c3a', shape: 'round', lastK: 3, unlockH: 0, price: 10,
      info: { sci: 'Cinnamomum camphora', family: '樟科', protect: '常见', note: '常绿乔木，枝叶自带樟脑清香。' } },
    { key: 'ginkgo', name: '银杏', crown: '#f0c04a', crown2: '#dfa93a', trunk: '#8a6a45', shape: 'fan', lastK: 3, unlockH: 0, price: 13,
      info: { sci: 'Ginkgo biloba', family: '银杏科', protect: '国家一级', note: '活化石，扇形叶秋日金黄。' } },
    { key: 'maple', name: '枫树', crown: '#e0703c', crown2: '#c8542a', trunk: '#7a5c3a', shape: 'droop', lastK: 4, unlockH: 0, price: 16,
      info: { sci: 'Acer', family: '槭树科', protect: '常见', note: '掌状裂叶，秋来满树红霞。' } },
    { key: 'sakura', name: '樱花', crown: '#f2a3bd', crown2: '#e88aab', trunk: '#8a6a45', shape: 'round', lastK: 4, bloom: '#ffb3c8', unlockH: 0, price: 20,
      info: { sci: 'Prunus serrulata', family: '蔷薇科', protect: '常见', note: '春日繁花，落英如雪。' } },
    { key: 'pine', name: '松树', crown: '#3f7d4a', crown2: '#356b3f', trunk: '#6f5637', shape: 'cone', lastK: 3, unlockH: 0, price: 14,
      info: { sci: 'Pinus', family: '松科', protect: '常见', note: '四季常青，针叶成塔。' } },
    { key: 'birch', name: '白桦', crown: '#8fc46b', crown2: '#7bb45c', trunk: '#c9c2b6', shape: 'round', lastK: 3, unlockH: 0, price: 12,
      info: { sci: 'Betula platyphylla', family: '桦木科', protect: '常见', note: '白色树皮，林间如雪。' } },
    { key: 'oak', name: '橡树', crown: '#4a8f52', crown2: '#3d7f45', trunk: '#6f5637', shape: 'round', lastK: 4, unlockH: 0, price: 22,
      info: { sci: 'Quercus', family: '壳斗科', protect: '常见', note: '冠幅阔大，结实为橡子。' } },
    { key: 'plane', name: '梧桐', crown: '#7cb342', crown2: '#6aa83a', trunk: '#8a6a45', shape: 'round', lastK: 3, unlockH: 0, price: 18,
      info: { sci: 'Platanus', family: '悬铃木科', protect: '常见', note: '叶大荫浓，行道常见。' } },
    { key: 'willow', name: '垂柳', crown: '#9ccc65', crown2: '#7cb342', trunk: '#7a5c3a', shape: 'droop', lastK: 3, unlockH: 5, price: 16,
      info: { sci: 'Salix babylonica', family: '杨柳科', protect: '常见', note: '枝条低垂，临水依依。' } },
    { key: 'palm', name: '椰树', crown: '#5aa86a', crown2: '#3f8f52', trunk: '#8a6a45', shape: 'palm', lastK: 4, unlockH: 10, price: 20,
      info: { sci: 'Cocos nucifera', family: '棕榈科', protect: '常见', note: '羽状大叶，海滨剪影。' } },
    /* —— 珍稀（按累计专注时长解锁）—— */
    { key: 'metasequoia', name: '水杉', crown: '#5fa05a', crown2: '#477f45', trunk: '#8a5a3a', shape: 'cone', lastK: 5, unlockH: 10, price: 0,
      info: { sci: 'Metasequoia glyptostroboides', family: '柏科', protect: '国家一级', note: '活化石，1940 年代在湖北利川重新发现，曾以为早已灭绝。' } },
    { key: 'dove', name: '珙桐', crown: '#6a9e58', crown2: '#548a46', trunk: '#8a6a45', shape: 'fan', lastK: 5, bloom: '#f7f7f2', unlockH: 20, price: 0,
      info: { sci: 'Davidia involucrata', family: '蓝果树科', protect: '国家一级', note: '中国特有「鸽子树」，白色苞片似鸽翼，风起如群鸽振翅。' } },
    { key: 'taxus', name: '红豆杉', crown: '#3f7d45', crown2: '#2f6236', trunk: '#7a5c3a', shape: 'cone', lastK: 5, bloom: '#e53935', unlockH: 30, price: 0,
      info: { sci: 'Taxus', family: '红豆杉科', protect: '国家一级', note: '珍稀濒危，树皮可提取抗癌药物紫杉醇，须依法保护。' } },
    { key: 'liriodendron', name: '鹅掌楸', crown: '#7aa84a', crown2: '#639238', trunk: '#8a6a45', shape: 'fan', lastK: 5, bloom: '#f2d06b', unlockH: 40, price: 0,
      info: { sci: 'Liriodendron chinense', family: '木兰科', protect: '国家二级', note: '叶似马褂，又名马褂木，中国特有珍稀树种。' } },
    { key: 'manglietia', name: '华盖木', crown: '#4f8a4a', crown2: '#3d703a', trunk: '#7a5c3a', shape: 'round', lastK: 6, bloom: '#f4e3b0', unlockH: 60, price: 0,
      info: { sci: 'Manglietiastrum sinicum', family: '木兰科', protect: '国家一级', note: '云南特有，野生植株一度不足十株，极危。' } },
    { key: 'dracaena', name: '龙血树', crown: '#4a7d52', crown2: '#37613f', trunk: '#9a7a55', shape: 'palm', lastK: 6, bloom: '#c0392b', unlockH: 80, price: 0,
      info: { sci: 'Dracaena cinnabari', family: '天门冬科', protect: '易危', note: '索科特拉岛特有，伞状树冠，树脂殷红如「龙血」。' } },
    { key: 'carpinus', name: '普陀鹅耳枥', crown: '#5a9a5a', crown2: '#457d45', trunk: '#8a6a45', shape: 'round', lastK: 6, unlockH: 100, price: 0,
      info: { sci: 'Carpinus putoensis', family: '桦木科', protect: '国家一级', note: '全球仅一株野生，被称为「地球独子」。' } },
    { key: 'fir', name: '百山祖冷杉', crown: '#2f6b45', crown2: '#245538', trunk: '#6f5637', shape: 'cone', lastK: 6, unlockH: 150, price: 0,
      info: { sci: 'Abies beshanzuensis', family: '松科', protect: '国家一级', note: '全球野生不足十株，极度濒危的松科孑遗植物。' } }
  ];

  function speciesOf(key) {
    for (var i = 0; i < TREE_SPECIES.length; i++) {
      if (TREE_SPECIES[i].key === key) return TREE_SPECIES[i];
    }
    return TREE_SPECIES[0];
  }

  /** 第 stage 阶段 → 下一阶段所需「记」数（1→2/2→3 各 1 记，3→4 需 2 记，4→5 需 lastK 记） */
  function stageNeed(sp, stage) {
    if (stage <= 1) return 1;
    if (stage === 2) return 1;
    if (stage === 3) return 2;
    return (sp && sp.lastK) || 3;
  }

  var TREE_STAGES = [
    { name: '—' },
    { name: '嫩芽' },
    { name: '幼苗' },
    { name: '小树' },
    { name: '大树' },
    { name: '参天' }
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

  /** 兼容旧调用：传入 0~5 视为阶段直接返回；更大的旧成长值按阈值映射 */
  function treeStage(v) {
    v = v || 0;
    if (v <= 5) return Math.max(0, v);
    if (v >= 320) return 5;
    if (v >= 200) return 4;
    if (v >= 120) return 3;
    if (v >= 60) return 2;
    return 1;
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
    { id: 'gacha_all3', group: '抽卡', name: '绝世非皇', desc: '一次十连抽出的干员全部为三星', icon: 'star', tier: 'silver', points: 100,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.all3); } },
    { id: 'gacha_max4', group: '抽卡', name: '紫气东来', desc: '一次十连中最高星级仅为四星（不出五/六星）', icon: 'sparkle', tier: 'silver', points: 10,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.max4); } },
    { id: 'gacha_2six', group: '抽卡', name: '双黄蛋', desc: '一次十连中恰好抽出两个六星', icon: 'sun', tier: 'gold', points: 10,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.twoSix); } },
    { id: 'gacha_4six', group: '抽卡', name: '绝世欧皇', desc: '一次十连中抽出三个及以上六星（≥3）', icon: 'crown', tier: 'gold', points: 100,
      check: function () { var t = state.pomodoro.gacha.lastTen; return !!(t && t.fourSix); } },
    { id: 'gacha_no6_70', group: '抽卡', name: '七秩非皇', desc: '连续 70 抽未出六星', icon: 'clock', tier: 'gold', points: 100,
      metric: 'streakNo6', threshold: 70 },
    { id: 'gacha_no5_30', group: '抽卡', name: '卅非皇', desc: '连续 30 抽未出五星', icon: 'moon', tier: 'silver', points: 100,
      metric: 'streakNo5', threshold: 30 },
    /* —— 集卡 —— */
    { id: 'collFaction', group: '集卡', name: '集齐阵营', desc: '集齐任意一个阵营的全部干员（≥6 人）', icon: 'box', tier: 'gold', points: 200,
      metric: 'collFaction', threshold: 1 },
    /* —— 种树 —— */
    /* 种树：逐级解锁。先要「植下一棵树」解锁，后续「种更多棵树」的成就才会出现；
     * 渲染层看到 req 前置未完成会直接隐藏该成就（见 collection.js achPane）。 */
    { id: 'tree1', group: '种树', name: '植下一棵树', desc: '种下 1 棵树', icon: 'leaf', tier: 'bronze', points: 3,
      metric: 'tree', threshold: 1 },
    { id: 'tree3', group: '种树', name: '植树新手', desc: '种下 3 棵树', icon: 'leaf', tier: 'bronze', points: 6,
      metric: 'tree', threshold: 3, req: 'tree1' },
    { id: 'tree10', group: '种树', name: '绿意盎然', desc: '种下 10 棵树', icon: 'tree', tier: 'silver', points: 12,
      metric: 'tree', threshold: 10, req: 'tree3' },
    { id: 'tree50', group: '种树', name: '森之守护', desc: '种下 50 棵树', icon: 'tree', tier: 'silver', points: 24,
      metric: 'tree', threshold: 50, req: 'tree10' },
    { id: 'tree100', group: '种树', name: '林海苍苍', desc: '种下 100 棵树', icon: 'tree', tier: 'gold', points: 48,
      metric: 'tree', threshold: 100, req: 'tree50' },

    /* —— 目标 —— */
    { id: 'goal_first', group: '目标', name: '不再只是待办', desc: '创建第一个目标', icon: 'target', tier: 'bronze', points: 10,
      metric: 'goalTotal', threshold: 1 },
    { id: 'goal_active5', group: '目标', name: '五线并进', desc: '同时在办 5 个目标（达到上限）', icon: 'flag', tier: 'silver', points: 30,
      metric: 'goalActive', threshold: 5 },
    { id: 'goal_achieved', group: '目标', name: '说到做到', desc: '有目标推进到 100% 并归档留档', icon: 'check', tier: 'gold', points: 60,
      metric: 'goalAchieved', threshold: 1 },
    { id: 'goal_review', group: '目标', name: '月末回头看', desc: '用月末复盘把进度写进日记一次', icon: 'book', tier: 'silver', points: 20,
      metric: 'goalReview', threshold: 1 },
    { id: 'goal_archived', group: '目标', name: '厚积薄发', desc: '累计归档 5 个目标', icon: 'crown', tier: 'gold', points: 100,
      metric: 'goalAchieved', threshold: 5, req: 'goal_achieved' },

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
    /* 专注里程：累计专注时长解锁，走成就发分 */
    { id: 'focus_h10', group: '专注', name: '专注里程 10 小时', desc: '累计专注满 10 小时', icon: 'clock', tier: 'bronze', points: 30, metric: 'focusMinutes', threshold: 600 },
    { id: 'focus_h30', group: '专注', name: '专注里程 30 小时', desc: '累计专注满 30 小时', icon: 'clock', tier: 'silver', points: 60, metric: 'focusMinutes', threshold: 1800, req: 'focus_h10' },
    { id: 'focus_h60', group: '专注', name: '专注里程 60 小时', desc: '累计专注满 60 小时', icon: 'star', tier: 'silver', points: 120, metric: 'focusMinutes', threshold: 3600, req: 'focus_h30' },
    { id: 'focus_h100', group: '专注', name: '专注里程 100 小时', desc: '累计专注满 100 小时', icon: 'crown', tier: 'gold', points: 200, metric: 'focusMinutes', threshold: 6000, req: 'focus_h60' },
    { id: 'focus_h200', group: '专注', name: '专注里程 200 小时', desc: '累计专注满 200 小时', icon: 'crown', tier: 'gold', points: 400, metric: 'focusMinutes', threshold: 12000, req: 'focus_h100' },
    { id: 'use_note_1', group: '历练', name: '初出茅庐：速记', desc: '首次使用速记', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:note', threshold: 1 },
    { id: 'use_note_10', group: '历练', name: '小有心得：速记', desc: '使用速记 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:note', threshold: 10, req: 'use_note_1' },
    { id: 'use_note_100', group: '历练', name: '炉火纯青：速记', desc: '使用速记 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:note', threshold: 100, req: 'use_note_10' },
    { id: 'use_event_1', group: '历练', name: '初出茅庐：日程', desc: '首次添加日程', icon: 'sparkle', tier: 'bronze', points: 10, metric: 'usage:event', threshold: 1 },
    { id: 'use_event_10', group: '历练', name: '小有心得：日程', desc: '添加日程 10 次', icon: 'star', tier: 'silver', points: 30, metric: 'usage:event', threshold: 10, req: 'use_event_1' },
    { id: 'use_event_100', group: '历练', name: '炉火纯青：日程', desc: '添加日程 100 次', icon: 'crown', tier: 'gold', points: 80, metric: 'usage:event', threshold: 100, req: 'use_event_10' }
  ];

  /** 成就分类顺序：抽卡 / 集卡 / 种树 */
  var ACH_GROUPS = ['抽卡', '集卡', '种树', '目标', '专注', '历练'];

  /** 当前各成就指标的实际数值 */
  function achValue(metric) {
    var s = state;
    if (metric && metric.indexOf('usage:') === 0) {
      var uk = metric.slice(6);
      return (s.usage && s.usage[uk]) || 0;
    }
    if (metric === 'focusMinutes') return (s.pomodoro && s.pomodoro.focusMinutes) || 0;
    if (metric === 'goalTotal') return (s.goals || []).length;
    if (metric === 'goalActive') {
      var tg = DateUtil.toStr(DateUtil.today());
      return (s.goals || []).filter(function (g) { return goalActive(g, tg); }).length;
    }
    if (metric === 'goalAchieved') {
      // 只看已经离开「在办」的：还在推进中的 100% 不算「说到做到」
      var ta = DateUtil.toStr(DateUtil.today());
      return (s.goals || []).filter(function (g) {
        return !goalActive(g, ta) && goalPct(g, ta) >= 100;
      }).length;
    }
    if (metric === 'goalReview') return (s.usage && s.usage.goalReview) || 0;
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
    if (metric === 'collFaction') {
      // 集齐任意一个阵营（≥6 人，跳过微型联动组）的全部干员 → 1
      var ops = global.AK_OPS || [];
      var byF = {};
      ops.forEach(function (o) { (byF[o[4]] = byF[o[4]] || []).push(o[0]); });
      var owned = {};
      (s.pomodoro.gacha.ops || []).forEach(function (o) { owned[o.n] = 1; });
      for (var f in byF) {
        if (byF[f].length < 6) continue;
        var full = byF[f].every(function (nm) { return owned[nm]; });
        if (full) return 1;
      }
      return 0;
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
   * - **始终以原定日期为锚点往前推进**，跳过已经错过的期：
   *   10/23（周五）那期拖到 10/27 才完成，下一期仍是 10/30，而不是 11/3。
   *   这样「每周五」不会因为晚完成漂成「每周一」。
   * - 只推进到「第一个晚于今天」的期，不会一次性补出多条欠账
   * - monthly/yearly 每次加法都从锚点算起，月末夹到当月最后一天（1/31 -> 2/28 -> 3/31）
   * @returns YYYY-MM-DD 字符串；无下一期返回 null
   */
  /** getDay() 编号(0=周日..6=周六) -> 中文星期（周一..周日） */
  function wdCN(w) {
    var idx = ((w % 7) + 7) % 7;
    return DAY_NAMES[(idx + 6) % 7];
  }

  /** 星期数组按「周一..周日」排序，便于人话展示 */
  function orderWeekdays(arr) {
    var order = [1, 2, 3, 4, 5, 6, 0];
    return order.filter(function (w) { return arr.indexOf(w) !== -1; });
  }

  /**
   * 取某年某月的第 pos 个星期 wd（pos>0：第 1..4 个；pos=-1：最后一个）。
   * 该月不存在该位置的星期（如某月只有 4 个周一却要第 5 个）返回 null。
   */
  function nthWeekdayOfMonth(year, monthIdx, pos, wd) {
    if (wd == null) return null;
    var first = new Date(year, monthIdx, 1);
    var firstDow = first.getDay();
    var diff = (((wd % 7) + 7) % 7) - firstDow;
    if (diff < 0) diff += 7;
    var firstMatch = new Date(year, monthIdx, 1 + diff);
    if (pos > 0) {
      var d = DateUtil.addDays(firstMatch, (pos - 1) * 7);
      if (d.getMonth() !== monthIdx) return null;     // 越月说明该月没有第 pos 个（如第 5 个周一）
      return d;
    }
    // 最后一个：先推 4 周，再回退到仍在当月内的那个
    var last = DateUtil.addDays(firstMatch, 28);
    while (last.getMonth() !== monthIdx) last = DateUtil.addDays(last, -7);
    return last;
  }

  /** 周重复·多选星期：每周/每 N 周的指定星期各出现一次，返回晚于 today 的第一天 */
  function nextWeeklyMulti(anchor, weekdays, iv, today) {
    var origin = DateUtil.weekStart(anchor);   // 锚点所在周一，作为 N 周块的起点
    var blockLen = 7 * iv;
    var best = null;
    weekdays.forEach(function (w) {
      var off = (((w % 7) + 6) % 7);           // 周一=0 … 周日=6（相对 origin 的偏移）
      var firstInBlock = DateUtil.addDays(origin, off);
      var delta = DateUtil.diffDays(firstInBlock, today); // >0 表示 firstInBlock 晚于 today
      var k = delta >= 0 ? 0 : (Math.floor(-delta / blockLen) + 1);
      var cand = DateUtil.addDays(firstInBlock, k * blockLen);
      while (DateUtil.diffDays(cand, today) <= 0) cand = DateUtil.addDays(cand, blockLen);
      if (best === null || DateUtil.diffDays(cand, best) < 0) best = cand;
    });
    return best ? DateUtil.toStr(best) : null;
  }

  /**
   * 计算下一次应出现的日期（展开式：完成任务时生成这条）。
   * - repeat.type: none | daily | weekly | monthly | yearly
   * - **始终以原定日期为锚点往前推进**，跳过已经错过的期：
   *   10/23（周五）那期拖到 10/27 才完成，下一期仍是 10/30，而不是 11/3。
   *   这样「每周五」不会因为晚完成漂成「每周一」。
   * - 只推进到「第一个晚于今天」的期，不会一次性补出多条欠账
   * - monthly/yearly 每次加法都从锚点算起，月末夹到当月最后一天（1/31 -> 2/28 -> 3/31）
   * - weekly.weekdays（多选星期）/ monthly.monthRule('pos'|'lastday') 为第三档新增的自定义周期
   * @returns YYYY-MM-DD 字符串；无下一期返回 null
   */
  function nextDueDate(dueDateStr, repeat, todayStr) {
    if (!repeat || repeat.type === 'none') return null;
    var anchor = DateUtil.parse(dueDateStr);
    if (!anchor) return null;
    var today = DateUtil.parse(todayStr || DateUtil.toStr(DateUtil.today()));
    if (!today) return null;
    var iv = Math.max(1, (repeat.interval | 0) || 1);

    // 日：每 iv 天一个，等差 O(1)
    if (repeat.type === 'daily') {
      var k = Math.floor(DateUtil.diffDays(today, anchor) / iv) + 1;
      if (k < 1) k = 1;
      return DateUtil.toStr(DateUtil.addDays(anchor, k * iv));
    }

    // 周：多选星期走专属逻辑；否则沿用「每 iv 周」的等差（周几由锚点日期决定）
    if (repeat.type === 'weekly') {
      if (repeat.weekdays && repeat.weekdays.length) {
        return nextWeeklyMulti(anchor, repeat.weekdays, iv, today);
      }
      var wk = Math.floor(DateUtil.diffDays(today, anchor) / (7 * iv)) + 1;
      if (wk < 1) wk = 1;
      return DateUtil.toStr(DateUtil.addDays(anchor, wk * 7 * iv));
    }

    if (repeat.type === 'monthly') {
      // 月末最后一天（j=0 即锚点当月：若晚于今天就直接用它，不跳过当月）
      if (repeat.monthRule === 'lastday') {
        for (var i = 0; i <= 3000; i++) {
          var lm = DateUtil.addMonths(anchor, iv * i);
          var last = new Date(lm.getFullYear(), lm.getMonth() + 1, 0);
          if (DateUtil.diffDays(last, today) > 0) return DateUtil.toStr(last);
        }
        return null;
      }
      // 第 pos 个星期 wd（pos=-1 = 最后一个）
      if (repeat.monthRule === 'pos') {
        for (var j = 0; j <= 3000; j++) {
          var pm = DateUtil.addMonths(anchor, iv * j);
          var pd = nthWeekdayOfMonth(pm.getFullYear(), pm.getMonth(), repeat.pos, repeat.wd);
          if (pd && DateUtil.diffDays(pd, today) > 0) return DateUtil.toStr(pd);
        }
        return null;
      }
      // 默认：每月固定 day 号（沿用锚点日期的日，月末/闰年夹紧）
      for (var m = 0; m <= 3000; m++) {
        var cand = DateUtil.addMonths(anchor, iv * m);
        if (DateUtil.diffDays(cand, today) > 0) return DateUtil.toStr(cand);
      }
      return null;
    }

    // 年：每 iv 年（闰年 2/29 夹到 2/28）
    if (repeat.type === 'yearly') {
      for (var y = 1; y <= 3000; y++) {
        var cy = DateUtil.addYears(anchor, iv * y);
        if (DateUtil.diffDays(cy, today) > 0) return DateUtil.toStr(cy);
      }
      return null;
    }
    return null;
  }

  /**
   * 由「开始日期 + repeat 规则」算出第一期的实际日期（>= 开始日期）。
   * 用于新建/编辑时把截止日期对齐到规则真正生效的那一天；
   * 旧规则（无 weekdays/monthRule）原样返回开始日期。
   * @returns YYYY-MM-DD 字符串
   */
  function firstOccurrence(startStr, repeat) {
    var start = DateUtil.parse(startStr);
    if (!start || !repeat || repeat.type === 'none') return startStr;
    var iv = Math.max(1, (repeat.interval | 0) || 1);

    if (repeat.type === 'weekly' && repeat.weekdays && repeat.weekdays.length) {
      for (var i = 0; i <= 400; i++) {
        var d = DateUtil.addDays(start, i);
        if (repeat.weekdays.indexOf(d.getDay()) !== -1) return DateUtil.toStr(d);
      }
      return startStr;
    }
    if (repeat.type === 'monthly') {
      if (repeat.monthRule === 'lastday') {
        for (var a = 0; a <= 400; a++) {
          var lm = DateUtil.addMonths(start, iv * a);
          var last = new Date(lm.getFullYear(), lm.getMonth() + 1, 0);
          if (DateUtil.diffDays(last, start) >= 0) return DateUtil.toStr(last);
        }
        return startStr;
      }
      if (repeat.monthRule === 'pos') {
        for (var b = 0; b <= 400; b++) {
          var pm = DateUtil.addMonths(start, iv * b);
          var pd = nthWeekdayOfMonth(pm.getFullYear(), pm.getMonth(), repeat.pos, repeat.wd);
          if (pd && DateUtil.diffDays(pd, start) >= 0) return DateUtil.toStr(pd);
        }
        return startStr;
      }
    }
    return startStr;
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
    if (raw.type === 'weekly') {
      // 多选星期：去重、取合法 0..6、排序；为空则回退「按首期日期的星期」（旧行为）
      if (raw.weekdays && Array.isArray(raw.weekdays) && raw.weekdays.length) {
        var seen = {}, wds = [];
        raw.weekdays.forEach(function (x) {
          var w = (((x % 7) + 7) % 7);
          if (!seen[w]) { seen[w] = 1; wds.push(w); }
        });
        if (wds.length) r.weekdays = wds.sort(function (a, b) { return a - b; });
      }
    }
    if (raw.type === 'monthly') {
      if (raw.monthRule === 'pos' && raw.wd != null) {
        r.monthRule = 'pos';
        r.wd = (((raw.wd % 7) + 7) % 7);
        r.pos = (raw.pos === -1) ? -1 : Math.max(1, Math.min(4, (raw.pos | 0) || 1));
      } else if (raw.monthRule === 'lastday') {
        r.monthRule = 'lastday';
      }
    }
    return r;
  }

  /**
   * 重复规则的人话摘要（纯展示，不参与计算）。
   * 例：每周五一次，从 10 月 23 日（周五）开始，没有结束日期。
   * @param {object} repeat { type, interval, until }
   * @param {string} dueDate 第一期的日期 YYYY-MM-DD
   */
  function repeatSummary(repeat, dueDate) {
    if (!repeat || !repeat.type || repeat.type === 'none') return '';
    var iv = Math.max(1, (repeat.interval | 0) || 1);
    var d = DateUtil.parse(dueDate);
    var rule;
    if (repeat.type === 'daily') {
      rule = iv > 1 ? '每 ' + iv + ' 天一次' : '每天一次';
    } else if (repeat.type === 'weekly') {
      if (repeat.weekdays && repeat.weekdays.length) {
        if (repeat.weekdays.length === 1) {
          // 单星期：沿用简洁写法（每周四一次），与旧「每周」体验一致
          var single = wdCN(repeat.weekdays[0]).slice(1);
          rule = (iv > 1 ? '每 ' + iv + ' 周的' : '每周') + single + '一次';
        } else {
          var wds = orderWeekdays(repeat.weekdays).map(wdCN);
          rule = (iv > 1 ? '每 ' + iv + ' 周的' : '每周') + wds.join('、') + '一次';
        }
      } else {
        var wd = d ? DateUtil.weekdayCN(d) : '';
        rule = iv > 1
          ? '每 ' + iv + ' 周的' + wd + '一次'
          : '每周' + (wd ? wd.slice(1) : '') + '一次';   // 周五 -> 每周五
      }
    } else if (repeat.type === 'monthly') {
      if (repeat.monthRule === 'lastday') {
        rule = (iv > 1 ? '每 ' + iv + ' 个月的' : '每月') + '最后一天一次';
      } else if (repeat.monthRule === 'pos') {
        var posTxt = repeat.pos === -1 ? '最后一个' : '第 ' + repeat.pos + ' 个';
        rule = (iv > 1 ? '每 ' + iv + ' 个月的' : '每月') + posTxt + wdCN(repeat.wd) + '一次';
      } else {
        rule = (iv > 1 ? '每 ' + iv + ' 个月的' : '每月') +
               (d ? ' ' + d.getDate() + ' 日' : '') + '一次';
      }
    } else if (repeat.type === 'yearly') {
      rule = (iv > 1 ? '每 ' + iv + ' 年的' : '每年') +
             (d ? ' ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日' : '') + '一次';
    } else {
      return '';
    }
    if (!d) return rule + '；还没选日期，完成后不会生成下一期。';

    var out = rule + '，从 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() +
              ' 日（' + DateUtil.weekdayCN(d) + '）开始';
    if (repeat.until) {
      var u = DateUtil.parse(repeat.until);
      out += u ? '，到 ' + (u.getMonth() + 1) + ' 月 ' + u.getDate() + ' 日为止' : '';
    } else {
      out += '，没有结束日期';
    }
    return out + '。';
  }

  /** 列表 chip 用的极简规则：每天 / 每周五 / 每 2 周·周一·周三·周五 / 每月第2周三 / 每月末 */
  function repeatShort(repeat, dueDate) {
    if (!repeat || !repeat.type || repeat.type === 'none') return '';
    var iv = Math.max(1, (repeat.interval | 0) || 1);
    var d = DateUtil.parse(dueDate);
    if (repeat.type === 'daily') return iv > 1 ? '每 ' + iv + ' 天' : '每天';
    if (repeat.type === 'weekly') {
      if (repeat.weekdays && repeat.weekdays.length) {
        if (repeat.weekdays.length === 1) {
          var s = wdCN(repeat.weekdays[0]).slice(1);
          return (iv > 1 ? '每' + iv + '周·' : '每周') + s;
        }
        var ws = orderWeekdays(repeat.weekdays).map(wdCN).join('·');
        return (iv > 1 ? '每' + iv + '周·' : '') + ws;
      }
      var wd2 = d ? DateUtil.weekdayCN(d) : '';
      return iv > 1 ? '每 ' + iv + ' 周的' + wd2 : '每周' + (wd2 ? wd2.slice(1) : '');
    }
    if (repeat.type === 'monthly') {
      if (repeat.monthRule === 'lastday') return '每月末';
      if (repeat.monthRule === 'pos') {
        if (repeat.pos === -1) return '每月末' + wdCN(repeat.wd);
        return '每月第' + repeat.pos + wdCN(repeat.wd);
      }
      return (iv > 1 ? '每 ' + iv + ' 个月的' : '每月') +
             (d ? ' ' + d.getDate() + ' 日' : '');
    }
    if (repeat.type === 'yearly') {
      return (iv > 1 ? '每 ' + iv + ' 年的' : '每年') +
             (d ? ' ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日' : '');
    }
    return '';
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

  /* ==========================================================
   * 目标（目标 → 关键结果 → 计划 / 待办 / 手填数字）
   * ----------------------------------------------------------
   * 只做一层拆解：目标下面挂 2–4 条关键结果，不做「目标套目标」。
   * 进度一律等权平均，不做权重——个人场景里权重基本靠拍脑袋，
   * 拍出来的数比不填更误导。
   * ========================================================== */

  /** 同时在办的目标上限（产品边界，不提供设置项） */
  var GOAL_MAX_ACTIVE = 5;

  /** 关键结果的三种计量方式 */
  var KR_KINDS = [
    { key: 'plan', name: '挂计划', desc: '按这条计划在周期内的打卡进度算' },
    { key: 'task', name: '挂待办', desc: '按周期内相关待办的完成率算' },
    { key: 'grade', name: '学期 GPA', desc: '按本学期已出分课程的加权 GPA 算（未出分显示待出分）' },
    { key: 'manual', name: '自己填', desc: '出分、有结果后自己填一个数' }
  ];

  /** 目标到期了没（到期当天仍算在办，第二天才算过期） */
  function goalExpired(goal, todayStr) {
    if (!goal || !goal.endDate) return false;
    return String(todayStr) > String(goal.endDate);
  }

  /** 目标是否在办：没手动归档、也没到期 */
  function goalActive(goal, todayStr) {
    if (!goal) return false;
    if (goal.archivedAt) return false;
    return !goalExpired(goal, todayStr);
  }

  /**
   * 单条关键结果的完成度
   * @param {Object} kr  { kind, planId, tags, courseId, target, current, unit }
   * @param {Object} ctx { from, to, today, plans, tasks }
   * @returns {{ pct: number|null, value: number, target: number, unit: string, empty: boolean, missing: boolean }}
   *          pct 为 null = 没有可统计的数据（刚建好、绑的计划被删了），不参与平均
   */
  function krProgress(kr, ctx) {
    var out = { pct: null, value: 0, target: 0, unit: '', empty: false, missing: false };
    if (!kr || !ctx) return out;

    /* 自己填：当前值 / 目标值，超过目标按 100% 算 */
    if (kr.kind === 'manual') {
      var t = Math.max(1, Number(kr.target) || 1);
      var v = Math.max(0, Number(kr.current) || 0);
      out.value = v;
      out.target = t;
      out.unit = kr.unit || '';
      out.pct = Math.max(0, Math.min(1, v / t));
      return out;
    }

    /* 学期 GPA：按该学期已出分课程的加权 GPA（用户自填的换算规则 + 占比权重）；
       一门都没出分时 gpa 为 null → 待出分（pct 保持 null，不进平均） */
    if (kr.kind === 'grade') {
      var gsid = kr.semesterId || (state && state.currentSemesterId) || '';
      var gsum = Store.gradeSummary([gsid]);
      out.target = Math.max(0.01, Number(kr.target) || 0);
      out.unit = 'GPA';
      if (gsum.gpa == null) { out.empty = true; out.value = 0; out.pct = null; return out; }
      out.value = gsum.gpa;
      out.pct = Math.max(0, Math.min(1, gsum.gpa / out.target));
      return out;
    }

    /* 挂计划：只统计目标周期内的打卡，到期后自然不再涨（等于冻结快照） */
    if (kr.kind === 'plan') {
      var plan = (ctx.plans || []).filter(function (p) { return p.id === kr.planId; })[0];
      if (!plan) { out.missing = true; return out; }
      var limit = ctx.today < ctx.to ? ctx.today : ctx.to;
      var sum = 0;
      (plan.records || []).forEach(function (r) {
        if (!r || !r.date) return;
        if (r.date < ctx.from || r.date > limit) return;
        sum += Number(r.value) || 0;
      });
      out.value = sum;
      out.target = Math.max(1, Number(plan.target) || 1);
      out.unit = plan.unit || '';
      out.pct = Math.max(0, Math.min(1, sum / out.target));
      return out;
    }

    /* 挂待办：周期内、符合标签/课程的顶层任务的完成率。
       子任务算在父任务身上（不重复计）；没有截止日期的历史任务不计入，
       否则越用越久，分母会一直变大，完成率永远上不去 */
    var tags = kr.tags || [];
    var list = (ctx.tasks || []).filter(function (task) {
      if (task.parentId) return false;
      var due = task.dueDate || '';
      if (!due || due < ctx.from || due > ctx.to) return false;
      if (kr.courseId && task.courseId !== kr.courseId) return false;
      if (tags.length) {
        var hit = (task.tags || []).some(function (x) { return tags.indexOf(x) >= 0; });
        if (!hit) return false;
      }
      return true;
    });
    if (!list.length) { out.empty = true; return out; }
    var done = list.filter(function (task) { return task.status === 'done'; }).length;
    out.value = done;
    out.target = list.length;
    out.pct = done / list.length;
    return out;
  }

  /**
   * 目标整体进度：各关键结果等权平均
   * 没有可统计数据的 KR 不进分母——「刚开学、期中还没考」不该显示 0%
   */
  function goalProgress(goal, ctx) {
    var krs = (goal && goal.krs) || [];
    var rows = [];
    var sum = 0, n = 0;
    krs.forEach(function (kr) {
      var r = krProgress(kr, ctx);
      rows.push({ id: kr.id, title: kr.title, kind: kr.kind, pct: r.pct,
                  value: r.value, target: r.target, unit: r.unit,
                  empty: r.empty, missing: r.missing });
      if (r.pct != null) { sum += r.pct; n++; }
    });
    return {
      pct: n ? Math.round(sum / n * 100) : 0,
      counted: n,
      total: krs.length,
      rows: rows
    };
  }

  /** 月末复盘要提示了吗：每月最后三天、本月没点过「不再提醒」、开关是开的 */
  function goalReviewDue(settings, todayStr) {
    var opt = (settings && settings.goals) || {};
    if (opt.monthlyReview === false) return false;
    var parts = String(todayStr || '').split('-');
    if (parts.length !== 3) return false;
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!y || !m || !d) return false;
    if (opt.reviewDismissed === parts[0] + '-' + parts[1]) return false;
    var lastDay = new Date(y, m, 0).getDate();
    return d >= lastDay - 2;
  }

  /** 复盘开头的文字：只列数字，不写评价（评价交给用户自己写） */
  function goalReviewText(lines, monthStr) {
    var mon = String(monthStr || '').slice(5, 7);
    var head = '【' + (Number(mon) || '') + ' 月目标复盘】';
    var body = (lines || []).map(function (x) { return '· ' + x.title + '：' + x.pct + '%'; });
    return [head].concat(body).join('\n');
  }

  /** 给目标发积分的最短周期：太短的目标容易变成刷分工具 */
  var GOAL_MIN_DAYS = 7;

  /** 目标周期天数（含首尾两天） */
  function goalDays(goal) {
    if (!goal || !goal.startDate || !goal.endDate) return 0;
    var a = DateUtil.parse(goal.startDate), b = DateUtil.parse(goal.endDate);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  /** 目标此刻的进度（成就与结算共用；页面层不用再算一遍） */
  function goalPct(goal, todayStr) {
    if (!goal) return 0;
    return goalProgress(goal, {
      from: goal.startDate, to: goal.endDate, today: todayStr,
      plans: state.plans || [], tasks: state.tasks || []
    }).pct;
  }

  /** 目标对象的字段收口：缺的补、脏的丢，避免旧数据把页面搞崩 */
  function normGoal(raw) {
    var g = raw || {};
    var krs = (Array.isArray(g.krs) ? g.krs : []).map(function (k, i) {
      k = k || {};
      var kind = (k.kind === 'plan' || k.kind === 'task' || k.kind === 'manual' || k.kind === 'grade') ? k.kind : 'manual';
      // GPA 目标可以是 0~5 的小数，别被「至少 1」夹掉
      var tgt = kind === 'grade' ? Math.max(0, Number(k.target) || 0) : Math.max(1, Number(k.target) || 1);
      return {
        id: k.id || uid('kr'),
        title: String(k.title || '').slice(0, 60) || ('关键结果 ' + (i + 1)),
        kind: kind,
        planId: String(k.planId || ''),
        tags: Array.isArray(k.tags) ? k.tags.slice(0, 6) : [],
        courseId: String(k.courseId || ''),
        target: tgt,
        current: Math.max(0, Number(k.current) || 0),
        unit: String(k.unit || ''),
        metric: kind === 'grade' ? 'semesterGpa' : '',
        semesterId: kind === 'grade' ? String(k.semesterId || '') : '',
        awarded: k.awarded || ''    // KR 达成奖励只发一次（归一化时要保留）
      };
    }).slice(0, 4);    // 最多 4 条：再多就没人看得完
    var today = DateUtil.toStr(DateUtil.today());
    return {
      id: g.id || uid('gl'),
      title: String(g.title || '').slice(0, 40) || '未命名目标',
      note: String(g.note || ''),
      period: g.period === 'term' ? 'term' : 'custom',
      startDate: g.startDate || today,
      endDate: g.endDate || today,
      krs: krs,
      archivedAt: g.archivedAt || '',
      rewardedAt: g.rewardedAt || '',   // 达成奖励只发一次
      createdAt: g.createdAt || new Date().toISOString()
    };
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
    get goals() { return state.goals || []; },
    get ledger() { return state.ledger; },
    get notes() { return state.notes; },
    get events() { return state.events; },
    get activities() { return state.activities; },
    get meals() { return state.meals; },
    get sleeps() { return state.sleeps; },
    get sleepSession() { return state.sleepSession || null; },

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
      this.settleGoals();      // 上次关闭期间到期的目标，这里补结算
      this.save();
      return state;
    },

    /** 补齐缺失字段：加载本地数据、导入备份后都会调用 */
    ensure: function () {
      state = validateSchema(state);
      var ds = defaultState();
      if (!state) state = ds;
      if (!state.settings) state.settings = ds.settings;
      if (!state.settings.tagMeta || typeof state.settings.tagMeta !== 'object') {
        state.settings.tagMeta = {};
      }
      if (state.settings.trackMeal == null) state.settings.trackMeal = true;
      if (state.settings.trackSleep == null) state.settings.trackSleep = true;
      if (state.settings.showWeekend == null) state.settings.showWeekend = true;
      if (state.settings.statsOn == null) state.settings.statsOn = true;
      state.settings.statsWidgets = Object.assign(
        { time: true, curve: true, sources: true, spend: true, course: true }, state.settings.statsWidgets || {});
      state.settings.health = Object.assign(
        { on: true, sleepMinH: 6, kcalOver: true, activityMinH: 0 }, state.settings.health || {});
      if (!state.settings.nav) state.settings.nav = ds.settings.nav;
      if (!Array.isArray(state.settings.navOrder)) state.settings.navOrder = [];
      if (!state.settings.ui || typeof state.settings.ui !== 'object') state.settings.ui = { sidebarMini: false };
      if (typeof state.settings.ui.sidebarMini !== 'boolean') state.settings.ui.sidebarMini = false;
      if (typeof state.settings.themeSkin !== 'boolean') state.settings.themeSkin = true;
      if (typeof state.settings.themeSkinAuto !== 'boolean') state.settings.themeSkinAuto = true;
      if (['auto', 'light', 'dark'].indexOf(state.settings.themeMode) < 0) state.settings.themeMode = 'auto';
      if (!state.settings.natureTheme) state.settings.natureTheme = 'pine';
      if (!state.settings.arkTheme) state.settings.arkTheme = 'terminal';
      if (!state.settings.asr) state.settings.asr = ds.settings.asr;
      if (typeof state.settings.devArknights !== 'boolean') state.settings.devArknights = false;
      if (!state.settings.devArknights && state.pomodoro.mode === 'gacha') state.pomodoro.mode = 'forest';
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
      if (state.pomodoro.treesPlanted == null) state.pomodoro.treesPlanted = (state.pomodoro.trees || []).length;
      if (state.pomodoro.harvested == null) state.pomodoro.harvested = 0;
      if (!state.pomodoro.selectedSpecies) state.pomodoro.selectedSpecies = 'camphor';
      if (!state.pomodoro.timer.treeId) state.pomodoro.timer.treeId = '';
      // 旧树（按 growth 成长值）迁移为新模型：阶段 + 阶段内记数
      (state.pomodoro.trees || []).forEach(function (t) {
        if (t.stage == null) {
          var g = t.growth || 0;
          t.stage = g >= 320 ? 5 : g >= 200 ? 4 : g >= 120 ? 3 : g >= 60 ? 2 : 1;
          t.prog = 0;
          t.withered = false;
          delete t.growth;
        }
      });
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
      // 分池：旧档的单一 pity6 归入标准寻访；两个池各自独立计数
      if (gc.currentPool !== 'classic') gc.currentPool = 'standard';
      if (!gc.pools || typeof gc.pools !== 'object') {
        gc.pools = { standard: { pity6: gc.pity6 || 0, total: 0, spark: 0, guaranteed: false } };
      }
      ['standard', 'classic'].forEach(function (id) {
        var p = gc.pools[id];
        if (!p || typeof p !== 'object') p = gc.pools[id] = { pity6: 0, total: 0, spark: 0, guaranteed: false };
        if (p.pity6 == null) p.pity6 = 0;
        if (p.total == null) p.total = 0;
        if (p.spark == null) p.spark = 0;
        if (p.guaranteed == null) p.guaranteed = false;
      });
      // 摸鱼券：旧档的 makeUp 搬运过来，使用记录改名
      // shop 兜底必须放在取值之前：导入/恢复路径可能带着没有 shop 的对象进来
      if (!state.shop || typeof state.shop !== 'object') state.shop = {};
      var sh = state.shop;
      if (!sh.tickets) sh.tickets = { selection: 0, fish: 0 };
      if (sh.tickets.fish == null) sh.tickets.fish = sh.tickets.makeUp || 0;
      delete sh.tickets.makeUp;
      if (!Array.isArray(sh.fishLog)) sh.fishLog = Array.isArray(sh.makeUpLog) ? sh.makeUpLog : [];
      delete sh.makeUpLog;
      if (!sh.validDays || typeof sh.validDays !== 'object') sh.validDays = {};
      if (sh.growth == null) sh.growth = 0;
      if (!sh.streak) sh.streak = { weekEnd: '', monthEnd: '' };
      // 限定井：登记目标 + 累计抽数（与 UP 井双计，但不叠加使用）
      if (!gc.limited || typeof gc.limited !== 'object') gc.limited = { target: '', count: 0 };
      if (gc.limited.target == null) gc.limited.target = '';
      if (gc.limited.count == null) gc.limited.count = 0;
      if (state.pomodoro.earned == null) state.pomodoro.earned = 0;
      if (!state.pomodoro.pointLog) state.pomodoro.pointLog = [];
      if (state.pomodoro.focusMinutes == null) state.pomodoro.focusMinutes = 0;
      if (!state.pomodoro.sessions) state.pomodoro.sessions = [];
      if (!state.plans) state.plans = [];
      if (!Array.isArray(state.goals)) state.goals = [];
      // 目标设置逐项补默认值，别让旧 settings 整块覆盖
      var gopt = state.settings.goals || {};
      state.settings.goals = {
        monthlyReview: typeof gopt.monthlyReview === 'boolean' ? gopt.monthlyReview : true,
        reviewDismissed: typeof gopt.reviewDismissed === 'string' ? gopt.reviewDismissed : ''
      };
      if (!state.ledger) state.ledger = [];
      if (!state.notes) state.notes = [];
      if (!Array.isArray(state.diaries)) state.diaries = [];
      if (!state.events) state.events = [];
      if (!state.activities) state.activities = [];
      if (!state.meals) state.meals = [];
      if (!state.sleeps) state.sleeps = [];
      // 进行中的睡眠计时：字段不全就丢弃，避免半截状态一直转下去
      if (state.sleepSession && (!state.sleepSession.date || !state.sleepSession.start ||
          typeof state.sleepSession.at !== 'number')) {
        state.sleepSession = null;
      }
      if (!state.courses) state.courses = [];
      if (!Array.isArray(state.courseExceptions)) state.courseExceptions = [];
      if (!state.tasks) state.tasks = [];
      if (!state.achievements || typeof state.achievements !== 'object') state.achievements = { done: {} };
      if (!state.achievements.done || typeof state.achievements.done !== 'object') state.achievements.done = {};
      if (!state.usage || typeof state.usage !== 'object') state.usage = {};
      // 商城：上方已兜底 shop 对象本身，这里只补子键（dupPool 不回溯老数据，避免重复发放）
      if (!state.shop.activeDays || typeof state.shop.activeDays !== 'object') state.shop.activeDays = {};
      if (!Array.isArray(state.shop.dupPool)) state.shop.dupPool = [];
      if (!Array.isArray(state.shop.log)) state.shop.log = [];
      if (state.shop.card == null) state.shop.card = null;
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

      var courses = this.coursesOnDate(todayStr).map(function (c) {
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
      state.courses.push(c);
      this.bumpUsage('course');
      if (this.markAction) this.markAction('course', 1);
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
    /** 重复规则的人话摘要（弹窗提示、chip 的 title 共用） */
    repeatSummary: function (repeat, dueDate) { return repeatSummary(repeat, dueDate); },
    /** 由「开始日期 + 规则」算出第一期的实际日期（对齐到规则真正生效的那天） */
    firstOccurrence: function (startStr, repeat) { return firstOccurrence(startStr, repeat); },
    /** 规范化 repeat 字段（白名单 + 越界 clamp），供 UI 复用 */
    sanitizeRepeat: function (raw) { return sanitizeRepeat(raw); },

    /** 重复规则的极简标签（列表 chip 用） */
    repeatShort: function (repeat, dueDate) { return repeatShort(repeat, dueDate); },

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
        energy: data.energy || 'medium',
        examStage: data.examStage || '',
        createdAt: new Date().toISOString(),
        doneAt: ''
      };
      state.tasks.push(t);
      // 新增子任务后，父任务的进度可能变了；若设置要求「全完成自动完成父」，这里也要生效
      if (t.parentId) this.syncParent(t.parentId);
      if (this.markAction) this.markAction('task', 1);
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
      // 重复规则单独规范化，避免脏数据（weekdays/pos 越界、多余字段）
      if (Object.prototype.hasOwnProperty.call(data, 'repeat')) {
        t.repeat = sanitizeRepeat(t.repeat);
      }
      // 首次标记为完成 → 奖励积分
      if (!wasDone && t.status === 'done') {
        this.addPoints(POMO.TASK_DONE, 'task');
        if (this.markAction) this.markAction('taskdone', 1);
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
        this.addPoints(POMO.TASK_DONE, 'task');
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

    /* ===== 单次调课例外（停课 / 换教室 / 调课） =====
     * 周历回答「这门课一般什么时候上」，例外回答「那一天到底上不上、在哪上」。
     * 判定逻辑在 course-exception.js（纯模块），这里只管存取与拼装。 */

    /** 某天的实际课表：基础周历 + 例外（去掉停课/调走的，换教室的带 _exRoom，
     *  调进来的以原课程为模板带 _moveIn/_moveFrom）。今天显示、提醒、统计、
     *  月历时间带全部走这里，别再用 coursesOnDay 直接当日历用。 */
    coursesOnDate: function (dateStr) {
      var d = DateUtil.parse(dateStr);
      if (!d || !global.CourseException) return [];
      var dow = DateUtil.isoDow(d);
      var base = this.coursesOnDay(dow, this.weekOf(d));
      var out = global.CourseException.dayEffect(base, dateStr, state.courseExceptions).kept;
      var self = this;
      global.CourseException.moveIns(state.courseExceptions, dateStr).forEach(function (e) {
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
      return global.CourseException.dayEffect(base, dateStr, state.courseExceptions).removed;
    },

    /** 一门课的全部例外（课程详情弹窗管理用） */
    lessonExceptionsOfCourse: function (courseId) {
      return (state.courseExceptions || []).filter(function (e) { return e.courseId === courseId; });
    },

    /** 写入一条例外；同一门课同一天只留一条（后写的覆盖先写的） */
    addCourseException: function (data) {
      if (!data || !data.courseId || !data.date) return null;
      var type = data.type === 'room' || data.type === 'move' ? data.type : 'cancel';
      state.courseExceptions = (state.courseExceptions || []).filter(function (e) {
        return !(e.courseId === data.courseId && e.date === data.date);
      });
      var ex = {
        id: uid('cex'),
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
      state.courseExceptions.push(ex);
      this.emit();
      return ex;
    },

    removeCourseException: function (id) {
      state.courseExceptions = (state.courseExceptions || []).filter(function (e) { return e.id !== id; });
      this.emit();
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
        note: (data.note || '').trim(),
        taskId: String(data.taskId || ''),   // 挂在哪条待办上：双向关联的这一头
        courseId: String(data.courseId || ''),   // 关联课程（可选）：用于「课程投入」统计
        courseName: String(data.courseName || ''),
        from: String(data.from || ''),       // 记录来源：'block' = 月历里补录的时间块
        planned: !!data.planned              // true = 计划专注块（还没发生，不进统计与投入）
      };
      state.activities.push(a);
      this.emit();
      this.checkAchievements(true);
      // 记录类发分：手动在象限记的活动给积分；月历时间块(from:'block')与番茄钟自动记录(noAward)不重复发
      if (!data.noAward && a.from !== 'block') this.awardActivityPoints(a);
      return a;
    },

    /** 活动记录发分：0.25 分/分钟，每天上限 60 分（按活动所属日计） */
    awardActivityPoints: function (a) {
      var mins = TimeUtil.diffMin(a.start, a.end);
      if (!mins || mins <= 0) return;
      var gain = POMO.ACTIVITY_PER_MIN * mins;
      var todayAct = (state.pomodoro.pointLog || [])
        .filter(function (l) { return l.date === a.date && l.src === 'activity'; })
        .reduce(function (s, l) { return s + l.n; }, 0);
      var allowed = Math.max(0, POMO.ACTIVITY_MAX_DAY - todayAct);
      var award = Math.min(gain, allowed);
      if (award > 0) this.addPoints(award, 'activity', a.date);
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
      // 记录类发分：每天封顶 3 餐，每餐 2 分（含本条，第 4 餐起不发）
      var dayCount = state.meals.filter(function (x) { return x.date === m.date; }).length;
      if (dayCount <= POMO.MEAL_MAX_DAY) this.addPoints(POMO.MEAL_EACH, 'meal', m.date);
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
      // 记录类发分：当天首条睡眠记录给 4 分（防重复刷）；push 前判断，避免把自己算进去
      var isFirst = !state.sleeps.some(function (s) { return s.date === r.date; });
      state.sleeps.push(r);
      this.bumpUsage('sleep');
      if (isFirst) this.addPoints(POMO.SLEEP_DAY, 'sleep', r.date);
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

    /* ===== 睡眠计时：点一下开始，再点一下结束 ===== */
    /**
     * 开始一次睡眠计时，以「现在」为入睡时刻，记录挂在入睡那天。
     * 已经在计时时重复点击不会重置，避免手抖把时长清零。
     */
    startSleep: function () {
      if (state.sleepSession) return state.sleepSession;
      var now = new Date();
      state.sleepSession = {
        date: DateUtil.toStr(now),
        start: DateUtil.pad(now.getHours()) + ':' + DateUtil.pad(now.getMinutes()),
        at: now.getTime()
      };
      this.emit();
      return state.sleepSession;
    },

    /**
     * 结束睡眠计时并写入一条睡眠记录（结束时刻为「现在」）。
     * @returns {{minutes:number, record:object|null, tooShort?:boolean, tooLong?:boolean}|null}
     */
    endSleep: function (data) {
      var s = state.sleepSession;
      if (!s) return null;
      var now = new Date();
      var mins = Math.round((now.getTime() - s.at) / 60000);
      state.sleepSession = null;

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
      if (!state.sleepSession) return;
      state.sleepSession = null;
      this.emit();
    },

  /* ===== 番茄钟 / 积分 / 养树 ===== */

    /**
     * 增加积分（不自动 emit，由调用方决定何时通知界面）
     * 两种奖励机制的积分分开存放：
     *   forest → points（种树 / 浇水）
     *   gacha  → jade（合成玉，1 积分 = 180）
     * 无论哪种，earned 都记总积分，切换机制时总量不变。
     */
    addPoints: function (n, src, date) {
      n = Math.round(n) || 0;
      if (n <= 0) return this.pomodoro.points;
      var pm = state.pomodoro;
      if (pm.mode === 'gacha') pm.jade += n * POMO.JADE_PER_POINT;
      else pm.points += n;
      pm.earned += n;
      // 写流水（用于统计分页的「积分曲线」与「来源构成」）；date 缺省为今天，记录类可传记录的所属日
      pm.pointLog.push({ date: date || DateUtil.toStr(DateUtil.today()), n: n, src: src || 'other' });
      if (pm.pointLog.length > 2000) pm.pointLog = pm.pointLog.slice(-2000);
      return pm.mode === 'gacha' ? pm.jade : pm.points;
    },

    /** 各渠道累计获得积分（按 src 汇总）；聚合逻辑见 stats-calc.js */
    pointSources: function () {
      return global.StatsCalc.sumBySource(state.pomodoro.pointLog);
    },

    /** 某区间按日聚合的积分（每日获得）；日期从 from 到 to 连续 */
    pointSeries: function (rangeKey) {
      rangeKey = rangeKey || 'week';
      var r = rangeDates(rangeKey);
      var dates = [], d = r.from;
      for (var i = 0; i < r.days; i++) {
        dates.push(d);
        d = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(d), 1));
      }
      return global.StatsCalc.seriesFromLog(state.pomodoro.pointLog, dates);
    },

    /** 某区间账本聚合（按分类构成 + 每日支出）；聚合逻辑见 stats-calc.js */
    ledgerBreakdown: function (rangeKey, type) {
      rangeKey = rangeKey || 'month';
      var r = rangeDates(rangeKey);
      var dates = [], d = r.from;
      for (var i = 0; i < r.days; i++) {
        dates.push(d);
        d = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(d), 1));
      }
      return global.StatsCalc.ledgerBreakdown(state.ledger, dates, type || 'expense');
    },

    /** 某区间按课程聚合的投入时长（分钟）；聚合逻辑见 stats-calc.js */
    courseInvest: function (rangeKey) {
      rangeKey = rangeKey || 'month';
      var r = rangeDates(rangeKey);
      var dates = [], d = r.from;
      for (var i = 0; i < r.days; i++) {
        dates.push(d);
        d = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(d), 1));
      }
      return global.StatsCalc.sumByCourse(state.activities, dates);
    },

    /** 当前机制的余额（森林=积分，抽卡=合成玉） */
    currentBalance: function () {
      var pm = state.pomodoro;
      return pm.mode === 'gacha' ? pm.jade : pm.points;
    },

    /** 当前机制余额：森林=积分，抽卡=合成玉（两币不互通、不再折算） */
    totalPoints: function () {
      var pm = state.pomodoro;
      return pm.mode === 'gacha' ? pm.jade : pm.points;
    },

    /** 抽卡系统是否开启（开发者选项「明日方舟」开启；默认关闭，仅种树） */
    gachaEnabled: function () {
      return !!(state.settings && state.settings.devArknights);
    },

    /** 开发者选项：setGachaEnabled(true) 开启抽卡；false 关闭并切回森林 */
    setGachaEnabled: function (on) {
      on = !!on;
      state.settings.devArknights = on;
      if (!on && state.pomodoro.mode === 'gacha') state.pomodoro.mode = 'forest';
      this.save();
      this.emit();
      if (typeof App !== 'undefined' && App.rebuildNav) App.rebuildNav();
      return on;
    },

    /** 是否处于非游戏化纯粹学术专注模式 */
    isAcademicMode: function () {
      return !!(state && state.pomodoro && state.pomodoro.mode === 'academic');
    },

    /** 切换奖励机制（academic 纯学术 | forest 森林种树 | gacha 抽卡寻访） */
    setRewardMode: function (mode) {
      if (mode === 'gacha' && !this.gachaEnabled()) return state.pomodoro.mode;
      var pm = state.pomodoro;
      if (mode === 'academic' || mode === 'gacha' || mode === 'forest') {
        pm.mode = mode;
      } else {
        pm.mode = 'forest';
      }
      this.save();
      this.emit();
      if (typeof App !== 'undefined' && App.rebuildNav) App.rebuildNav();
      return pm.mode;
    },

    /** 获取生理精力高峰时段（优先自定义，默认早/中/晚三段） */
    getEnergyPeaks: function () {
      var eg = state.settings && state.settings.energy;
      if (eg && eg.custom && Array.isArray(eg.peaks) && eg.peaks.length) {
        return eg.peaks;
      }
      return [
        { start: '09:00', end: '11:30', name: '晨间黄金专注期' },
        { start: '15:00', end: '17:30', name: '午后高效期' },
        { start: '19:30', end: '21:30', name: '晚间静心期' }
      ];
    },

    /** 获取当前时刻的生理精力评估与建议 */
    currentEnergyState: function (nowStr) {
      if (!nowStr) {
        var now = new Date();
        var h = String(now.getHours()).padStart(2, '0');
        var m = String(now.getMinutes()).padStart(2, '0');
        nowStr = h + ':' + m;
      }
      var peaks = this.getEnergyPeaks();
      for (var i = 0; i < peaks.length; i++) {
        var p = peaks[i];
        if (nowStr >= p.start && nowStr <= p.end) {
          return {
            isPeak: true,
            level: 'high',
            peakName: p.name,
            icon: '⚡',
            label: '精力黄金期 · ' + p.name,
            advice: '大脑运转高效，建议优先处理高难度待办与深度学习。'
          };
        }
      }
      if (nowStr >= '13:00' && nowStr <= '14:30') {
        return {
          isPeak: false,
          level: 'low',
          peakName: '午后低谷期',
          icon: '☕',
          label: '生理低谷期 · 午后困倦',
          advice: '处于自然节律低谷，适合小憩片刻、轻松散步或低能耗杂务。'
        };
      }
      if (nowStr >= '23:00' || nowStr <= '05:30') {
        return {
          isPeak: false,
          level: 'rest',
          peakName: '夜间休整期',
          icon: '🌙',
          label: '夜间休整期 · 宜休息',
          advice: '夜深了，大脑需要代谢修复，建议尽快就寝养精蓄锐。'
        };
      }
      return {
        isPeak: false,
        level: 'medium',
        peakName: '平稳期',
        icon: '🌤️',
        label: '常规平稳期 · 精力稳定',
        advice: '精力处于平稳水平，适合常规作业、复习与计划打卡。'
      };
    },

    /** 获取当前学期所有登记了考试的课程列表（按考试日期升序） */
    courseExams: function (semId) {
      var sid = semId || state.currentSemesterId;
      return state.courses.filter(function (c) {
        return (!c.semesterId || c.semesterId === sid) && c.exam && c.exam.date;
      }).sort(function (a, b) {
        var ta = (a.exam.date || '') + ' ' + (a.exam.start || '');
        var tb = (b.exam.date || '') + ' ' + (b.exam.start || '');
        return ta < tb ? -1 : (ta > tb ? 1 : 0);
      });
    },

    /** 获取关联到指定课程的所有待办任务（复习备考任务） */
    examTasks: function (courseId) {
      if (!courseId) return [];
      return state.tasks.filter(function (t) {
        return t.courseId === courseId;
      });
    },

    /** 扣森林积分：只动积分池，不与合成玉互通 */
    spendPoints: function (n) {
      n = Math.round(n);
      if (n <= 0) return true;
      var pm = state.pomodoro;
      if (pm.points >= n) { pm.points -= n; return true; }
      return false;
    },

    /** 扣合成玉：只动玉池，不与积分互通 */
    spendJade: function (n) {
      n = Math.round(n);
      if (n <= 0) return true;
      var pm = state.pomodoro;
      if (pm.jade >= n) { pm.jade -= n; return true; }
      return false;
    },

    /* ===== 商城 ===== */

    /** 余额：森林积分 / 合成玉 / 等值积分 */
    shopBalance: function () {
      var pm = state.pomodoro;
      return {
        points: pm.points,
        jade: pm.jade,
        mode: pm.mode,
        current: pm.mode === 'gacha' ? pm.jade : pm.points
      };
    },

    /** 月卡剩余天数（含当天）；未购买或已过期返回 0 */
    cardDaysLeft: function () {
      var c = state.shop.card;
      if (!c) return 0;
      var today = DateUtil.toStr(DateUtil.today());
      if (today > c.endDate) return 0;
      return DateUtil.diffDays(DateUtil.parse(c.endDate), DateUtil.parse(today)) + 1;
    },

    /** 月卡展示状态：只读，供 UI 用 */
    cardInfo: function () {
      var c = state.shop.card;
      var today = DateUtil.toStr(DateUtil.today());
      if (!c) return { active: false, bought: false };
      var left = this.cardDaysLeft();
      var total = POMO.CARD_DAYS;
      var signed = 0;
      for (var i = 0; i < total; i++) {
        var k = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(c.startDate), i));
        if (c.days && c.days[k]) signed++;
      }
      return {
        active: left > 0,
        bought: true,
        startDate: c.startDate,
        endDate: c.endDate,
        daysLeft: left,
        daysTotal: total,
        signedDays: signed,
        todaySigned: !!(c.days && c.days[today]),
        mode: c.mode || 'forest',
        paid: c.paid || 0,
        gained: c.gained || 0,
        fullAwarded: !!c.fullAwarded
      };
    },

    /** 购买月卡：扣 300 积分（双币折算），当天即算第一天并返 10 分 */
    buyCard: function () {
      var sh = state.shop;
      var left = this.cardDaysLeft();
      if (left > 0) return { ok: false, msg: '当前月卡还剩 ' + left + ' 天，到期后才能换购' };
      var pm = state.pomodoro;
      var gacha = pm.mode === 'gacha';
      var price = gacha ? POMO.CARD_PRICE_GACHA : POMO.CARD_PRICE;
      var bal = gacha ? pm.jade : pm.points;
      var unit = gacha ? '合成玉' : '积分';
      if (bal < price) {
        return { ok: false, msg: unit + '不足，还差 ' + Math.ceil(price - bal) };
      }
      if (gacha ? !this.spendJade(price) : !this.spendPoints(price)) return { ok: false, msg: '余额不足' };
      var today = DateUtil.toStr(DateUtil.today());
      sh.card = {
        startDate: today,
        endDate: DateUtil.toStr(DateUtil.addDays(DateUtil.today(), POMO.CARD_DAYS - 1)),
        days: {},
        weekAwardEnd: '',
        fullAwarded: false,
        mode: gacha ? 'gacha' : 'forest',   // 同一时间只持有一个模式的月卡
        paid: price,
        gained: 0
      };
      sh.log.unshift({ at: Date.now(), type: 'card', text: '购买月卡 −' + price + ' ' + unit });
      this.trimShopLog();
      this.save();
      this.touchActive();     // 只记活跃痕迹；首日返还要等当天完成 2 次有效动作
      return { ok: true };
    },

    /** 记录「今天打开过应用」（旧口径，仅保留活跃痕迹） */
    /**
     * 「打开过模块」的记录（旧口径）。签到已改为「完成有效动作」——见 markAction；
     * 这里只保留活跃日痕迹用于兼容，不再直接触发月卡结算。
     */
    touchActive: function () {
      var t = DateUtil.toStr(DateUtil.today());
      var sh = state.shop;
      var dirty = false;
      if (!sh.activeDays[t]) { sh.activeDays[t] = 1; dirty = true; }
      // 只留最近 120 天，避免无限增长
      var keys = Object.keys(sh.activeDays).sort();
      if (keys.length > 120) {
        keys.slice(0, keys.length - 120).forEach(function (k) { delete sh.activeDays[k]; });
        dirty = true;
      }
      if (dirty) this.save();
    },

    /**
     * 结算指定日期的月卡签到。补签与当天签到走同一套逻辑（返还、周窗口、全勤判定完全一致），
     * 因此补签后如果凑满了窗口或 30 天，同样会补发周奖励 / 全勤奖励与对应的卡。
     */
    settleCardFor: function (day) {
      var self = this;
      var sh = state.shop;
      var c = sh.card;
      if (!c) return false;
      if (day < c.startDate || day > c.endDate) return false;
      if (c.days[day]) return false;

      c.days[day] = 1;
      // 返还到「购买月卡时那个模式」的币种：森林→积分，抽卡→合成玉（按 180:1 等值）
      var pm = state.pomodoro;
      var cGacha = c.mode === 'gacha';
      function pay(amt) {
        if (cGacha) pm.jade += amt * POMO.JADE_PER_POINT;
        else pm.points += amt;
        pm.earned += amt;
        pm.pointLog.push({ date: day, n: amt, src: 'card' });
        if (pm.pointLog.length > 2000) pm.pointLog = pm.pointLog.slice(-2000);
      }
      var gained = POMO.CARD_DAILY;
      pay(POMO.CARD_DAILY);

      // 滚动 7 天：窗口 = [day-6, day]，与上一次发奖窗口不重叠才发
      var winStart = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(day), -6));
      var lastEnd = c.weekAwardEnd || '';
      if (!lastEnd || winStart > lastEnd) {
        var all = true;
        for (var i = 0; i < 7; i++) {
          var k = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(winStart), i));
          if (!c.days[k]) { all = false; break; }
        }
        if (all) {
          pay(POMO.CARD_WEEK_BONUS);
          gained += POMO.CARD_WEEK_BONUS;
          c.weekAwardEnd = day;
          // 摸鱼券由 settleStreak 统一发放（人人可得），月卡这里只多给积分
        }
      }

      // 30 天全勤
      if (!c.fullAwarded) {
        var full = true;
        for (var j = 0; j < POMO.CARD_DAYS; j++) {
          var kk = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(c.startDate), j));
          if (!c.days[kk]) { full = false; break; }
        }
        if (full) {
          pay(POMO.CARD_FULL_BONUS);
          gained += POMO.CARD_FULL_BONUS;
          c.fullAwarded = true;
          // 定向券由 settleStreak 发放（人人可得）
        }
      }

      c.gained = (c.gained || 0) + gained;
      sh.log.unshift({
        at: Date.now(), type: 'card',
        text: '月卡签到 ' + day + ' +' + gained + (gained > POMO.CARD_DAILY ? '（含全勤奖励）' : '')
      });
      this.trimShopLog();
      return true;
    },

    /* ==========================================================
     * 定向券 / 摸鱼券 / 限定井（限定获取通道）
     * ========================================================== */
    grantTicket: function (kind, from) {
      var sh = state.shop;
      if (!sh.tickets) sh.tickets = { selection: 0, fish: 0 };
      var max = (kind === 'fish') ? (POMO.FISH_HOLD_MAX || 20) : 99;
      var now = sh.tickets[kind] || 0;
      if (now >= max) return 0;                 // 摸鱼券持有上限，避免无限囤积
      sh.tickets[kind] = now + 1;
      sh.log.unshift({
        at: Date.now(), type: 'ticket',
        text: (from || '') + '奖励 +1 张' + (kind === 'fish' ? '摸鱼券' : '定向券')
      });
      this.trimShopLog();
      return 1;
    },

    ticketInfo: function () {
      var t = (state.shop && state.shop.tickets) || {};
      return { selection: t.selection || 0, fish: t.fish || 0 };
    },

    /** 干员名 → 抽卡记录对象（源数据 AK_OPS） */
    opByName: function (name) {
      var all = global.AK_OPS || [];
      for (var i = 0; i < all.length; i++) {
        if (all[i][0] === name) return { n: all[i][0], r: all[i][1], p: all[i][2], img: all[i][3], limited: !!all[i][6], tag: all[i][7] };
      }
      return null;
    },

    /** 限定干员列表（star 传 6 则只要六星限定） */
    limitedOps: function (star) {
      return (global.AK_OPS || []).filter(function (o) {
        return o[6] && (!star || o[1] === star);
      }).map(function (o) {
        return { n: o[0], r: o[1], p: o[2], img: o[3] };
      });
    },

    /** 加入图鉴（已有则 +1 份，超过满潜上限进商城待兑换） */
    addOwnedOp: function (o) {
      var pm = state.pomodoro;
      var hit = null;
      for (var k = 0; k < pm.gacha.ops.length; k++) {
        if (pm.gacha.ops[k].n === o.n) { hit = pm.gacha.ops[k]; break; }
      }
      if (hit) {
        hit.count = (hit.count || 1) + 1;
        if (hit.count > POMO.POT_MAX + 1) {
          var pts = POMO.DUP_POINTS[o.r] || POMO.DUP_POINTS[3];
          if (!state.shop) state.shop = { activeDays: {}, dupPool: [], log: [], card: null };
          if (!Array.isArray(state.shop.dupPool)) state.shop.dupPool = [];
          state.shop.dupPool.push({ n: o.n, r: o.r, pts: pts, at: Date.now() });
          hit.dupPts = (hit.dupPts || 0) + pts;
        }
      } else {
        pm.gacha.ops.push({ n: o.n, r: o.r, p: o.p, img: o.img, count: 1, at: Date.now() });
      }
      this.checkAchievements(true);
    },

    /** 限定井进度（每抽并计，但与 UP 井不叠加使用） */
    limitedSparkInfo: function () {
      var li = state.pomodoro.gacha.limited || {};
      var n = li.count || 0;
      return {
        target: li.target || '',
        count: Math.min(n, POMO.LIMITED_SPARK),
        raw: n,
        need: POMO.LIMITED_SPARK,
        ready: n >= POMO.LIMITED_SPARK && !!li.target
      };
    },

    /** 登记限定井目标（换目标保留已累计的抽数） */
    setLimitedTarget: function (name) {
      if (name && !this.opByName(name)) return { ok: false, msg: '没有这名干员' };
      state.pomodoro.gacha.limited.target = name || '';
      this.emit();
      this.save();
      return { ok: true, target: name || '' };
    },

    /** 用攒满的限定井兑换登记的限定（兑换后计数清零） */
    redeemLimitedSpark: function () {
      var li = state.pomodoro.gacha.limited;
      if (!li.target) return { ok: false, msg: '先登记一名限定干员' };
      if ((li.count || 0) < POMO.LIMITED_SPARK) {
        return { ok: false, msg: '限定井还没攒够（' + (li.count || 0) + '/' + POMO.LIMITED_SPARK + '）' };
      }
      var op = this.opByName(li.target);
      if (!op) return { ok: false, msg: '目标干员不存在' };
      li.count = 0;
      this.addOwnedOp(op);
      state.shop.log.unshift({ at: Date.now(), type: 'limited', text: '限定井兑换：' + op.n });
      this.trimShopLog();
      this.emit();
      this.save();
      return { ok: true, n: op.n };
    },

    /** 定向券兑换限定（月全勤发放） */
    useSelectionTicket: function (name) {
      var sh = state.shop;
      if (!(sh.tickets && sh.tickets.selection)) return { ok: false, msg: '没有定向券（月全勤发放）' };
      var rec = this.opByName(name);
      if (!rec) return { ok: false, msg: '没有这名干员' };
      if (!rec.limited) return { ok: false, msg: '定向券只能兑换限定干员' };
      sh.tickets.selection--;
      this.addOwnedOp(rec);
      sh.log.unshift({ at: Date.now(), type: 'limited', text: '定向券兑换：' + name });
      this.trimShopLog();
      this.emit();
      this.save();
      return { ok: true, n: name };
    },

    /* ==========================================================
     * 有效动作 / 全勤 / 摸鱼券
     * - 「有效日」= 当天完成 ≥ VALID_DAY_MIN 次有效动作（不再是「打开过模块」）
     * - 全勤奖励人人可得（摸鱼券 + 积分），月卡只是额外多一份积分，定向券人人都有
     * - 摸鱼券四种用法：补签 / 护树 / 休整 / 复活枯桩
     * ========================================================== */
    /** 有效动作埋点：重度 2 分，轻度 1 分 */
    markAction: function (kind, weight) {
      var sh = state.shop;
      var t = DateUtil.toStr(DateUtil.today());
      if (!sh.validDays) sh.validDays = {};
      sh.validDays[t] = (sh.validDays[t] || 0) + 1;

      var w = (weight === 2) ? 2 : 1;
      sh.growth = (sh.growth || 0) + w;
      var got = 0;
      while ((sh.growth || 0) >= POMO.GROWTH_PER_TICKET) {
        // 持有上限已满时不再消耗成长值，等腾出位置再自动换
        if (!this.grantTicket('fish', '工作量')) break;
        sh.growth -= POMO.GROWTH_PER_TICKET;
        got++;
      }
      // 达成有效日 → 结算（月卡日返还 + 全勤判定）
      if ((sh.validDays[t] || 0) >= POMO.VALID_DAY_MIN) {
        this.settleCardFor(t);
        this.settleStreak();
      }
      this.save();
      return { actions: sh.validDays[t], growth: sh.growth, tickets: got };
    },

    /** 某天是否为有效日 */
    isValidDay: function (dateStr) {
      var sh = state.shop;
      return ((sh.validDays || {})[dateStr] || 0) >= POMO.VALID_DAY_MIN;
    },

    /** 连续有效日数（从今天往回数） */
    validStreak: function () {
      var n = 0;
      var d = DateUtil.today();
      // 今天还没完成有效动作时不算断签：从昨天往回数（避免早上打开就看到 0 天）
      if (!this.isValidDay(DateUtil.toStr(d))) d = DateUtil.addDays(d, -1);
      for (var i = 0; i < 400; i++) {
        if (this.isValidDay(DateUtil.toStr(d))) n++;
        else break;
        d = DateUtil.addDays(d, -1);
      }
      return n;
    },

    /**
     * 全勤结算（所有用户）：连续 7 / 30 个有效日发奖。
     * 券人人可得；月卡用户在 settleCardFor 之外不再重复发券，只多拿积分。
     */
    settleStreak: function () {
      var sh = state.shop;
      var today = DateUtil.toStr(DateUtil.today());
      if (!sh.streak) sh.streak = { weekEnd: '', monthEnd: '' };
      var got = { fish: 0, points: 0, selection: 0 };

      function payPoints(n) {
        var pm = state.pomodoro;
        // 按当前模式币种发（森林→积分，抽卡→合成玉 180:1）
        if (pm.mode === 'gacha') pm.jade += n * POMO.JADE_PER_POINT;
        else pm.points += n;
        pm.earned += n;
        pm.pointLog.push({ date: today, n: n, src: 'streak' });
        if (pm.pointLog.length > 2000) pm.pointLog = pm.pointLog.slice(-2000);
      }

      // 周全勤：窗口 = [today-6, today]，与上次发奖窗口不重叠
      if (!sh.streak.weekEnd || today > sh.streak.weekEnd) {
        var winStart = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -6));
        if (!sh.streak.weekEnd || winStart > sh.streak.weekEnd) {
          var ok7 = true;
          for (var i = 0; i < 7; i++) {
            if (!this.isValidDay(DateUtil.toStr(DateUtil.addDays(DateUtil.parse(winStart), i)))) { ok7 = false; break; }
          }
          if (ok7) {
            sh.streak.weekEnd = today;
            this.grantTicket('fish', '周全勤');
            got.fish++;
            payPoints(POMO.STREAK_WEEK_POINTS);
            got.points += POMO.STREAK_WEEK_POINTS;
          }
        }
      }

      // 月全勤：连续 30 个有效日（与上次发奖不重叠）
      if (!sh.streak.monthEnd || DateUtil.toStr(DateUtil.addDays(DateUtil.parse(sh.streak.monthEnd), 30)) <= today) {
        var ok30 = true;
        for (var j = 0; j < 30; j++) {
          if (!this.isValidDay(DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -j)))) { ok30 = false; break; }
        }
        if (ok30 && this.validStreak() >= 30) {
          sh.streak.monthEnd = today;
          this.grantTicket('fish', '月全勤');
          this.grantTicket('selection', '月全勤');   // 定向券人人可得
          got.fish++; got.selection++;
          payPoints(POMO.STREAK_MONTH_POINTS);
          got.points += POMO.STREAK_MONTH_POINTS;
        }
      }

      if (got.fish) this.trimShopLog();
      return got;
    },

    /** 摸鱼券余额 / 7 天用券额度 */
    fishQuota: function () {
      var sh = state.shop;
      var log = sh.fishLog || [];
      var from = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -6));
      var used = 0;
      log.forEach(function (d) { if (d >= from) used++; });
      var max = POMO.FISH_MAX_PER_WEEK || 5;
      return {
        hold: (sh.tickets && sh.tickets.fish) || 0,
        holdMax: POMO.FISH_HOLD_MAX || 20,
        used: used, left: Math.max(0, max - used), max: max
      };
    },

    /**
     * 用一张摸鱼券。kind：
     *  mend 补签（把指定日期补成有效日）| protect 护树（中断不枯萎，进度保留）
     *  rest 休整（专注暂停，树休眠）| revive 复活枯桩（替代 5 养分）
     */
    useFishCard: function (kind, payload) {
      var sh = state.shop;
      if (!(sh.tickets && sh.tickets.fish)) return { ok: false, msg: '没有摸鱼券了（全勤或攒成长值可得）' };
      var q = this.fishQuota();
      if (q.left <= 0) return { ok: false, msg: '最近 7 天已用满 ' + q.max + ' 张，缓几天再来' };

      var res = null;
      if (kind === 'mend') res = this.fishMendDay(payload);
      else if (kind === 'protect') res = this.fishProtectTree();
      else if (kind === 'rest') res = this.fishRestTree();
      else if (kind === 'revive') res = this.fishRevive(payload);
      else return { ok: false, msg: '未知的用券方式' };

      if (!res || !res.ok) return res;

      sh.tickets.fish--;
      if (!Array.isArray(sh.fishLog)) sh.fishLog = [];
      sh.fishLog.push(DateUtil.toStr(DateUtil.today()));
      sh.log.unshift({ at: Date.now(), type: 'ticket', text: '用掉 1 张摸鱼券：' + (res.label || kind) });
      this.trimShopLog();
      if (kind === 'mend') {
        // 补签 = 当天签到：月卡用户在有效期内同样拿当日返还（不走这一步就会漏一天）
        this.settleCardFor(res.date);
        this.settleStreak();
      }
      this.emit();
      this.save();
      res.left = this.fishQuota();
      return res;
    },

    /** 补签：把某天补成有效日（与真实达成有效日同等参与全勤判定） */
    fishMendDay: function (dateStr) {
      var sh = state.shop;
      if (!dateStr || dateStr > DateUtil.toStr(DateUtil.today())) return { ok: false, msg: '只能补已经过去的日子' };
      if (dateStr === DateUtil.toStr(DateUtil.today())) return { ok: false, msg: '今天还没过完，做 2 件小事就行，不用花券' };
      if (this.isValidDay(dateStr)) return { ok: false, msg: '这一天已经是有效日了' };
      if (!sh.validDays) sh.validDays = {};
      sh.validDays[dateStr] = POMO.VALID_DAY_MIN;
      return { ok: true, label: '补签 ' + dateStr, date: dateStr };
    },

    /** 护树：当前专注的树进入休眠，阶段与进度都保留 */
    fishProtectTree: function () {
      var pm = state.pomodoro;
      var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
      if (!tree) return { ok: false, msg: '当前没有正在长的树' };
      tree.withered = false;
      tree.dormant = true;
      return { ok: true, label: '护住树苗（休眠保留）', treeId: tree.id };
    },

    /** 休整：提前结束但树不判枯、进度保留（下一次专注接着长） */
    fishRestTree: function () {
      var pm = state.pomodoro;
      var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
      if (!tree) return { ok: false, msg: '当前没有正在长的树' };
      tree.withered = false;
      tree.dormant = true;
      return { ok: true, label: '休整（树保留）', treeId: tree.id };
    },

    /** 休整收尾：把树从休眠转回可生长状态（不清进度） */
    keepActiveTree: function () {
      var pm = state.pomodoro;
      var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
      if (tree) { tree.withered = false; tree.dormant = false; }
      this.save();
    },

    /** 复活枯桩：免养分 */
    fishRevive: function (id) {
      var tree = this.getTree(id);
      if (!tree || !tree.withered) return { ok: false, msg: '这棵树没枯' };
      tree.withered = false;
      tree.dormant = false;
      tree.prog = 0;
      return { ok: true, label: '复活 ' + (tree.name || '枯桩') };
    },

    /** 满潜重复干员：待兑换份数与可换合成玉 */
    dupPoolInfo: function () {
      var pool = state.shop.dupPool || [];
      var pts = 0;
      pool.forEach(function (d) { pts += d.pts || 0; });
      return { count: pool.length, points: pts, jade: pts * POMO.JADE_PER_POINT };
    },

    /** 满潜重复兑换：按 1 积分 = JADE_PER_POINT 玉，固定换成合成玉（两币不互通，满潜是抽卡子系统产物） */
    exchangeDup: function () {
      var sh = state.shop;
      var info = this.dupPoolInfo();
      if (!info.count) return { ok: false, count: 0, points: 0, jade: 0 };
      var pm = state.pomodoro;
      var jade = info.jade;
      pm.jade += jade;
      sh.dupPool = [];
      sh.log.unshift({
        at: Date.now(), type: 'exchange',
        text: '兑换 ' + info.count + ' 份重复干员 → ' + jade + ' 合成玉'
      });
      this.trimShopLog();
      this.save();
      this.emit();
      return { ok: true, count: info.count, points: 0, jade: jade };
    },

    trimShopLog: function () {
      var log = state.shop.log;
      if (log.length > 100) log.length = 100;
    },

    /** 结束一次专注：minutes 为实际专注分钟，extra 可带起止时间用于写入象限 */
    finishFocus: function (minutes, taskId, extra, opts) {
      minutes = Math.max(0, Math.floor(minutes));
      var pm = state.pomodoro;
      pm.focusMinutes += minutes;
      // 一次 ≥40 分钟给固定 FOCUS_REWARD（森林→积分，抽卡→等值合成玉）；不足 40 分钟不发
      var qualified = minutes >= POMO.FOCUS_MIN_MIN;
      var gain = qualified ? POMO.FOCUS_REWARD : 0;
      if (gain > 0) this.addPoints(gain, 'focus');
      if (qualified && this.markAction) this.markAction('focus', 2);

      // 种树：合格专注让当前树长 1~2 记；不合格（中断）让本次播下的种子枯萎
      if (pm.mode === 'forest') {
        if (qualified) this.growActiveTree(minutes);
        else if (opts && opts.keepTree) this.keepActiveTree();   // 用摸鱼券休整：树保留
        else this.witherActiveTree();
      }

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

      // 自动把专注时长写进象限的活动记录（专注分已单独结算，这里不再重复发活动分）
      if (extra && extra.start && extra.end && minutes >= 1) {
        var fCourseId = '', fCourseName = '';
        if (taskId) {
          var fTask = this.getTask(taskId);
          if (fTask && fTask.courseId) {
            fCourseId = fTask.courseId;
            var fCourse = this.getCourse(fTask.courseId);
            fCourseName = fCourse ? fCourse.name : '';
          }
        }
        this.addActivity({
          date: dateStr,
          start: extra.start,
          end: extra.end,
          name: extra.name || '专注',
          type: 'study',
          tags: extra.tags,
          note: '番茄钟自动记录',
          taskId: taskId || '',
          courseId: fCourseId,
          courseName: fCourseName,
          noAward: true
        });
      }
      state.pomodoro.timer = {
        running: false, endAt: 0, left: 0,
        duration: state.pomodoro.timer.duration || 45, taskId: '', treeId: ''
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

    /* ==========================================================
     * 卡池：标准寻访 / 中坚寻访
     * - 成员来自 ak_ops.js 第 8 位 poolTag：std / classic / limited
     * - 轮换按「绝对日期」算期号，跨设备一致，不需要服务器
     * - 6★：UP 占 50%（两名各 25%）；歪 → 下个六星必 UP（大保底）
     * - 5★：UP 占 50%（三名）；4★ / 3★ 两池共用
     * - 限定不进轮换，只在「歪」里以低权重出现
     * ========================================================== */
    gachaDayIndex: function (dateStr) {
      var d = dateStr ? DateUtil.parse(dateStr) : DateUtil.today();
      var e = DateUtil.parse(POMO.GACHA_EPOCH || '2026-01-01');
      return Math.round((Date.parse(DateUtil.toStr(d)) - Date.parse(DateUtil.toStr(e))) / 86400000);
    },

    /** 期号（每 rotDays 天推进一期） */
    gachaRotIndex: function (poolId) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      return Math.floor(this.gachaDayIndex() / pool.rotDays);
    },

    /** 池成员（按名字排序，保证轮换结果可复现） */
    gachaPoolMembers: function (poolId, star) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      var list = (global.AK_OPS || []).filter(function (o) {
        return o[1] === star && o[7] === pool.tag;
      });
      list.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      return list;
    },

    /** 某期的 UP 名单（6★ / 5★）。轮换到底部后整体偏移一格，避免落单的成员永远轮不到 */
    gachaUpOf: function (poolId, star, rotIdx) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      var mem = this.gachaPoolMembers(poolId, star);
      if (!mem.length) return [];
      var k = star === 6 ? pool.up6 : pool.up5;
      var idx = (rotIdx == null) ? this.gachaRotIndex(poolId) : rotIdx;
      var base = idx * k;
      var start = (base + Math.floor(base / mem.length)) % mem.length;
      var out = [];
      for (var i = 0; i < k && i < mem.length; i++) out.push(mem[(start + i) % mem.length][0]);
      return out;
    },

    /** 本期 UP */
    gachaCurrentUp: function (poolId) {
      return { six: this.gachaUpOf(poolId, 6), five: this.gachaUpOf(poolId, 5) };
    },

    /** 未来 N 期的 UP 6★（预告） */
    gachaUpcoming: function (poolId, n) {
      var cur = this.gachaRotIndex(poolId);
      var out = [];
      for (var i = 1; i <= (n || 3); i++) {
        out.push({ offset: i, six: this.gachaUpOf(poolId, 6, cur + i), five: this.gachaUpOf(poolId, 5, cur + i) });
      }
      return out;
    },

    /** 井可兑换范围：含当期在内、最近 sparkHistory 期的全部 UP（5★ / 6★） */

    /** 获取心愿单干员列表 */
    getWishlist: function () {
      var g = state.pomodoro && state.pomodoro.gacha;
      return (g && Array.isArray(g.wishlist)) ? g.wishlist : [];
    },

    /** 切换心愿单（最多同时追踪 2 名心愿干员） */
    toggleWishlist: function (name) {
      if (!name) return false;
      var g = state.pomodoro.gacha;
      if (!Array.isArray(g.wishlist)) g.wishlist = [];
      var idx = g.wishlist.indexOf(name);
      if (idx >= 0) {
        g.wishlist.splice(idx, 1);
      } else {
        if (g.wishlist.length >= 2) g.wishlist.shift();
        g.wishlist.push(name);
      }
      this.save();
      this.emit();
      return true;
    },

    /** 是否在心愿单中 */
    isWishlisted: function (name) {
      var g = state.pomodoro && state.pomodoro.gacha;
      return !!(g && Array.isArray(g.wishlist) && g.wishlist.indexOf(name) >= 0);
    },

    /** 计算心愿单未来轮换到货预报 */
    wishlistForecast: function () {
      var self = this;
      var g = (state.pomodoro && state.pomodoro.gacha) || {};
      var list = Array.isArray(g.wishlist) ? g.wishlist : [];
      if (!list.length) return [];
      var curDay = this.gachaDayIndex();
      var out = [];

      list.forEach(function (name) {
        var rec = self.opByName(name);
        if (!rec) return;
        var poolId = (rec.tag === 'classic') ? 'classic' : 'standard';
        var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
        var curRot = self.gachaRotIndex(poolId);
        var star = rec.r;

        var curUps = self.gachaUpOf(poolId, star, curRot);
        var isCurrent = curUps.indexOf(name) >= 0;
        var foundRot = isCurrent ? curRot : -1;

        if (!isCurrent) {
          for (var i = 1; i <= 60; i++) {
            var upList = self.gachaUpOf(poolId, star, curRot + i);
            if (upList.indexOf(name) >= 0) {
              foundRot = curRot + i;
              break;
            }
          }
        }

        var daysLeft = 0;
        if (foundRot >= 0) {
          if (isCurrent) {
            var dayInPeriod = ((curDay % pool.rotDays) + pool.rotDays) % pool.rotDays;
            daysLeft = pool.rotDays - dayInPeriod;
          } else {
            var targetDay = foundRot * pool.rotDays;
            daysLeft = targetDay - curDay;
          }
        }

        var targetJade = pool.spark * 600;
        var curJade = (state.pomodoro && state.pomodoro.jade) || 0;
        var readyPct = Math.min(100, Math.round((curJade / targetJade) * 100));

        out.push({
          name: name,
          star: star,
          img: rec[3],
          poolId: poolId,
          poolName: pool.name,
          isCurrent: isCurrent,
          daysLeft: daysLeft,
          readyPct: readyPct,
          curJade: curJade,
          targetJade: targetJade
        });
      });

      return out;
    },

    gachaSparkPool: function (poolId) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      var cur = this.gachaRotIndex(poolId);
      var out = [], seen = {};
      for (var i = 0; i < pool.sparkHistory; i++) {
        var idx = cur - i;
        if (idx < 0) break;
        var names = this.gachaUpOf(poolId, 6, idx).concat(this.gachaUpOf(poolId, 5, idx));
        for (var j = 0; j < names.length; j++) {
          if (!seen[names[j]]) { seen[names[j]] = 1; out.push({ n: names[j], periodsAgo: i }); }
        }
      }
      return out;
    },

    /** 某个池的抽卡状态（保底 / 井 / 大保底） */
    gachaPoolState: function (poolId) {
      var g = state.pomodoro.gacha;
      if (!g.pools || typeof g.pools !== 'object') {
        g.pools = {
          standard: { pity6: g.pity6 || 0, total: 0, spark: 0, guaranteed: false },
          classic: { pity6: 0, total: 0, spark: 0, guaranteed: false }
        };
      }
      var p = g.pools[poolId];
      if (!p || typeof p !== 'object') {
        p = g.pools[poolId] = { pity6: 0, total: 0, spark: 0, guaranteed: false };
      }
      if (p.pity6 == null) p.pity6 = 0;
      if (p.total == null) p.total = 0;
      if (p.spark == null) p.spark = 0;
      if (p.guaranteed == null) p.guaranteed = false;
      return p;
    },

    /** 切换当前寻访池 */
    setGachaPool: function (poolId) {
      if (!POMO.GACHA_POOLS[poolId]) return false;
      state.pomodoro.gacha.currentPool = poolId;
      this.emit();
      this.save();
      return true;
    },

    /** 按池出一名干员（UP / 大保底 / 歪 / 共用低星） */
    pickPoolOp: function (poolId, r) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      var st = this.gachaPoolState(poolId);
      var all = global.AK_OPS || [];
      var self = this;

      function byName(name) {
        for (var i = 0; i < all.length; i++) {
          if (all[i][0] === name) return { n: all[i][0], r: all[i][1], p: all[i][2], img: all[i][3] };
        }
        return null;
      }
      function pickFrom(list) {
        if (!list.length) return null;
        var it = list[Math.floor(Math.random() * list.length)];
        return { n: it[0], r: it[1], p: it[2], img: it[3] };
      }

      var up6 = this.gachaUpOf(poolId, 6);
      var up5 = this.gachaUpOf(poolId, 5);

      if (r === 6) {
        if (st.guaranteed) {                      // 大保底：出六星必为 UP
          st.guaranteed = false;
          return byName(up6[Math.floor(Math.random() * up6.length)]) || this.pickOp(6);
        }
        if (Math.random() < 0.5) {                // UP 占六星出率 50%
          return byName(up6[Math.floor(Math.random() * up6.length)]) || this.pickOp(6);
        }
        // 歪：本池其他干员；另有低概率歪到限定（限定不进轮换，只能这样或定向券拿）
        var off;
        if (Math.random() < (pool.offLimited || 0)) {
          off = all.filter(function (o) { return o[1] === 6 && o[7] === 'limited'; });
        } else {
          off = this.gachaPoolMembers(poolId, 6).filter(function (o) { return up6.indexOf(o[0]) < 0; });
        }
        st.guaranteed = true;
        return pickFrom(off) || this.pickOp(6);
      }

      if (r === 5) {
        if (up5.length && Math.random() < 0.5) {
          return byName(up5[Math.floor(Math.random() * up5.length)]) || this.pickOp(5);
        }
        var rest5 = this.gachaPoolMembers(poolId, 5).filter(function (o) { return up5.indexOf(o[0]) < 0; });
        return pickFrom(rest5) || this.pickOp(5);
      }

      return this.pickOp(r);   // 4★ / 3★ 两池共用
    },

    /** 井进度（跨期不清零，攒满可兑换历史 5 期内的 UP） */
    sparkInfo: function (poolId) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      var st = this.gachaPoolState(poolId);
      var n = st.spark || 0;
      return {
        pool: poolId, name: pool.name,
        count: Math.min(n, pool.spark), need: pool.spark,
        ready: n >= pool.spark,
        guaranteed: !!st.guaranteed,
        poolTotal: st.total || 0
      };
    },

    /** 井兑换（兑换范围内任一 UP；兑换后计数清零） */
    redeemSpark: function (poolId, name) {
      var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
      var st = this.gachaPoolState(poolId);
      if ((st.spark || 0) < pool.spark) {
        return { ok: false, msg: '井还没攒够（' + (st.spark || 0) + '/' + pool.spark + '）' };
      }
      var list = this.gachaSparkPool(poolId);
      var hit = null;
      list.forEach(function (x) { if (x.n === name) hit = x; });
      if (!hit) return { ok: false, msg: '只能在「含当期在内的最近 ' + pool.sparkHistory + ' 期 UP」里兑换' };
      var rec = this.opByName(name);
      if (!rec) return { ok: false, msg: '没有这名干员' };
      st.spark = 0;
      this.addOwnedOp(rec);
      state.shop.log.unshift({ at: Date.now(), type: 'card', text: pool.name + ' 井兑换：' + name });
      this.trimShopLog();
      this.emit();
      this.save();
      return { ok: true, n: name };
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

    /** 当前六星概率（含 50 抽后的递增保底；按当前池独立计数） */
    gachaRate6: function (poolId) {
      var pid = poolId || state.pomodoro.gacha.currentPool || 'standard';
      var pity = this.gachaPoolState(pid).pity6 || 0;
      var p = POMO.RATE_6;
      if (pity >= POMO.PITY_START) {
        p = POMO.RATE_6 + (pity - POMO.PITY_START + 1) * POMO.PITY_STEP;
      }
      return Math.min(100, Math.round(p * 10) / 10);
    },

    /** 单抽一次（forceMin 用于保底时指定最低星级） */
    /**
     * 抽一次
     * @param {number} [forceMin] 指定最低星级（保底补抽用）
     * @param {boolean} [silent]  不计入抽数 / 保底 / 井（十连保底是「替换」最后一抽，不能重复计数）
     */
    gachaOne: function (forceMin, silent) {
      var pm = state.pomodoro;
      var g = pm.gacha;
      var poolId = g.currentPool || 'standard';
      var st = this.gachaPoolState(poolId);
      var r;

      if (forceMin) {
        r = forceMin;
      } else {
        var p6 = this.gachaRate6(poolId);
        var roll = Math.random() * 100;
        if (roll < p6) r = 6;
        else if (roll < p6 + POMO.RATE_5) r = 5;
        else if (roll < p6 + POMO.RATE_5 + POMO.RATE_4) r = 4;
        else r = 3;
      }

      if (silent) {
        // 替换式保底：只产出结果，不重复计入抽数 / 保底 / 井
        if (r === 6) { st.pity6 = 0; g.pity6 = 0; }
        return this.pickPoolOp(poolId, r) || this.pickOp(r);
      }
      if (r === 6) st.pity6 = 0;
      else st.pity6 = (st.pity6 || 0) + 1;
      st.total = (st.total || 0) + 1;
      st.spark = (st.spark || 0) + 1;      // 井：跨期不清零
      g.pity6 = st.pity6;                  // 兼容旧字段（统计 / 成就仍读它）
      g.total = (g.total || 0) + 1;
      return this.pickPoolOp(poolId, r) || this.pickOp(r);
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

      /* 限定井：每抽并计入数（与 UP 井双计，但两个井各管各的、不叠加使用） */
      pm.gacha.limited.count = (pm.gacha.limited.count || 0) + times;

      // 十连保底：仅「每自然天第一个十连」保底五星，其余十连不保底
      if (times === 10 && out.length) {
        var todayStr = DateUtil.toStr(DateUtil.today());
        if (pm.gacha.dailyGuaranteeDay !== todayStr) {
          var ok = out.some(function (x) { return x.r >= POMO.TEN_GUARANTEE; });
          if (!ok) {
            var up = this.gachaOne(POMO.TEN_GUARANTEE, true);
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
          fourSix: (sixN >= 3)      // 三个及以上六星（≥3）→ 绝世欧皇
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
          // 潜能 = max(0, min(复制数-1, 上限))；达到上限（6 份）后，多余复制存入商城待兑换
          if (hit.count > POMO.POT_MAX + 1) {
            var pts = POMO.DUP_POINTS[o.r] || POMO.DUP_POINTS[3];
            if (!state.shop) state.shop = { activeDays: {}, dupPool: [], log: [], card: null };
            if (!Array.isArray(state.shop.dupPool)) state.shop.dupPool = [];
            state.shop.dupPool.push({ n: o.n, r: o.r, pts: pts, at: Date.now() });
            hit.dupPts = (hit.dupPts || 0) + pts;   // 历史累计（含改造前已转化的部分）
            out.converted += pts;
            out.convertedCount = (out.convertedCount || 0) + 1;
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
      var poolId = pm.gacha.currentPool || 'standard';
      return {
        total: all.length,
        owned: Object.keys(seen).length,
        pulls: pm.gacha.total || 0,
        pity: this.gachaPoolState(poolId).pity6 || 0,
        rate6: this.gachaRate6(poolId),
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
        dailyGuaranteeDay: '', streakNo6: 0, streakNo5: 0, lastTen: null,
        currentPool: (state.pomodoro.gacha.currentPool === 'classic') ? 'classic' : 'standard',
        pools: {
          standard: { pity6: 0, total: 0, spark: 0, guaranteed: false },
          classic: { pity6: 0, total: 0, spark: 0, guaranteed: false }
        },
        // 限定井进度归零，保留登记目标
        limited: { target: (state.pomodoro.gacha.limited || {}).target || '', count: 0 }
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
          // 成就只发徽章，不再发任何资源（积分 / 合成玉均不发）
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

    /* ===== 种树（专注即种树）===== */

    /** 累计专注小时数（用于解锁珍稀树种） */
    focusHours: function () {
      return (state.pomodoro.focusMinutes || 0) / 60;
    },

    /** 已解锁的树种：初始 + 累计专注时长达到 unlockH 的 */
    unlockedSpecies: function () {
      var h = this.focusHours();
      return TREE_SPECIES.filter(function (sp) { return (sp.unlockH || 0) <= h; });
    },

    isSpeciesUnlocked: function (key) {
      var sp = speciesOf(key);
      return (sp.unlockH || 0) <= this.focusHours();
    },

    /** 选择下一次种下的树种 */
    setSelectedSpecies: function (key) {
      if (!this.isSpeciesUnlocked(key)) return false;
      state.pomodoro.selectedSpecies = key;
      this.save();
      this.emit();
      return true;
    },

    /** 在空树位播下种子（种植免费）；无空位或未解锁返回 null */
    seedTree: function (speciesKey) {
      var pm = state.pomodoro;
      var key = speciesKey || pm.selectedSpecies || 'camphor';
      if (!this.isSpeciesUnlocked(key)) return null;
      if (pm.trees.length >= POMO.GROVE_SLOTS) return null;
      var tree = { id: uid('tr'), species: key, stage: 1, prog: 0, withered: false, plantedAt: new Date().toISOString() };
      pm.trees.push(tree);
      pm.treesPlanted = (pm.treesPlanted || 0) + 1;
      this.checkAchievements(true);
      this.save();
      this.emit();
      return tree;
    },

    /** 给树增加 n 记（自动升阶段，满 5 阶段封顶） */
    addTreeJi: function (tree, n) {
      if (!tree || tree.withered) return;
      var sp = speciesOf(tree.species);
      for (var i = 0; i < n; i++) {
        if (tree.stage >= 5) break;
        tree.prog = (tree.prog || 0) + 1;
        if (tree.prog >= stageNeed(sp, tree.stage)) { tree.stage++; tree.prog = 0; }
      }
    },

    /** 合格专注：让本次种子 / 最近一棵树长 1~2 记 */
    growActiveTree: function (minutes) {
      var pm = state.pomodoro;
      var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
      if (!tree) {
        if (pm.trees.length < POMO.GROVE_SLOTS) tree = this.seedTree(pm.selectedSpecies);
        if (!tree) {
          for (var i = pm.trees.length - 1; i >= 0; i--) {
            var t = pm.trees[i];
            if (!t.withered && t.stage < 5) { tree = t; break; }
          }
        }
      }
      if (tree && !tree.withered) { tree.dormant = false; this.addTreeJi(tree, minutes >= 60 ? 2 : 1); }
      this.save();
    },

    /** 中断：本次播下的种子枯萎，阶段内记数归零 */
    witherActiveTree: function () {
      var pm = state.pomodoro;
      var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
      if (tree) { tree.withered = true; tree.prog = 0; }
      this.save();
    },

    /** 复活枯桩：扣 REVIVE_COST 养分；阶段保留、阶段内记数归零 */
    reviveTree: function (id) {
      var tree = this.getTree(id);
      if (!tree || !tree.withered) return false;
      if (!this.spendPoints(POMO.REVIVE_COST)) return false;
      tree.withered = false;
      tree.prog = 0;
      this.save();
      this.emit();
      return true;
    },

    /** 浇水：扣 WATER_COST 养分，+1 记加速生长 */
    waterTree: function (id) {
      var tree = this.getTree(id);
      if (!tree || tree.withered || tree.stage >= 5) return false;
      if (!this.spendPoints(POMO.WATER_COST)) return false;
      this.addTreeJi(tree, 1);
      tree.waterCount = (tree.waterCount || 0) + 1;
      this.checkAchievements(true);
      this.save();
      this.emit();
      return true;
    },

    /** 收获已长成的树：进收藏、腾出树位 */
    harvestTree: function (id) {
      var pm = state.pomodoro;
      var tree = this.getTree(id);
      if (!tree || tree.withered || tree.stage < 5) return false;
      pm.trees = pm.trees.filter(function (t) { return t.id !== id; });
      pm.harvested = (pm.harvested || 0) + 1;
      this.save();
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
      if (this.markAction) this.markAction('plan', 1);
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

    /* ---------------- 目标 ---------------- */
    GOAL_MAX_ACTIVE: GOAL_MAX_ACTIVE,
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
      var list = state.goals || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    /** 在办：没归档、没到期 */
    goalsActive: function () {
      var today = DateUtil.toStr(DateUtil.today());
      return (state.goals || []).filter(function (g) { return goalActive(g, today); });
    },

    /** 留档：手动归档 + 到期没达成的，原样留着，不删不扣分 */
    goalsArchived: function () {
      var today = DateUtil.toStr(DateUtil.today());
      return (state.goals || []).filter(function (g) { return !goalActive(g, today); });
    },

    canAddGoal: function () {
      return this.goalsActive().length < GOAL_MAX_ACTIVE;
    },

    addGoal: function (data) {
      if (!this.canAddGoal()) return null;     // 上限在数据层也拦一道，别只靠界面
      var g = normGoal(data);
      state.goals.unshift(g);
      this.bumpUsage('goal');
      if (this.markAction) this.markAction('goalnew', 1);
      this.emit();
      return g;
    },

    updateGoal: function (id, data) {
      var g = this.getGoal(id);
      if (!g) return null;
      var next = normGoal(Object.assign({}, g, data, { id: g.id, createdAt: g.createdAt }));
      state.goals = state.goals.map(function (x) { return x.id === id ? next : x; });
      this.settleKRs();      // KR 进度变化后结算：达成 100% 的发一次积分
      this.emit();
      return next;
    },

    removeGoal: function (id) {
      state.goals = (state.goals || []).filter(function (x) { return x.id !== id; });
      this.emit();
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
      (state.goals || []).forEach(function (g) {
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
      (state.goals || []).forEach(function (g) {
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
        plans: state.plans || [],
        tasks: state.tasks || []
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
      state.activities = (state.activities || []).filter(function (a) {
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
      return (state.activities || []).filter(function (a) { return a.taskId === taskId; });
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
      var pomos = (state.pomodoro.sessions || []).filter(function (s) { return s.taskId === taskId; }).length;
      var recent = list.slice().sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return String(a.start) < String(b.start) ? 1 : -1;
      }).slice(0, 5);
      return { minutes: minutes, count: list.length, pomodoros: pomos, last: last, recent: recent };
    },

    /** 某条待办在某天的「计划专注块」分钟数（from:'block' 且 planned） */
    taskPlannedOn: function (taskId, dateStr) {
      var min = 0;
      (state.activities || []).forEach(function (a) {
        if (a.taskId === taskId && a.date === dateStr && a.from === 'block' && a.planned) {
          min += TimeUtil.diffMin(a.start, a.end);
        }
      });
      return min;
    },

    /** 打卡型的日期槽位 */    planSlots: function (plan) {
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
      if (!plan || plan.type === 'checkin') return null;
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
    if (this.markAction) this.markAction('diary', 1);
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
    if (this.markAction) this.markAction('ledger', 1);
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

      var meals = state.settings.trackMeal ? this.mealsOf(dateStr) : [];
      var mr = [];
      meals.forEach(function (m) {
        var dur = mealType(m.type).min;
        mr = mr.concat(expandRange(m.time, TimeUtil.addMin(m.time, dur)));
      });

      var sleepMin = state.settings.trackSleep ? this.sleepMinutes(dateStr) : 0;

      // 合并重叠、算未记录都在 stats-calc.js，Store 只负责把「取了哪些数」摆好
      var sum = StatsCalc.sumDaySegments({
        sleep: sleepMin, course: cr, event: er, activity: ar, meal: mr
      });

      return { segments: sum.segments, idle: sum.idle, courses: courses, events: events };
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
      if (s === 'full') {
        var full = JSON.parse(JSON.stringify(state));
        delete full.sleepSession;   // 进行中的计时是临时状态，不写进备份
        return JSON.stringify(full, null, 2);
      }

      var out = JSON.parse(JSON.stringify(state));
      delete out.sleepSession;

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
      out.plans = [];      out.goals = [];     out.ledger = [];      out.notes = [];
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
      var prev = state;
      // 以默认结构打底再逐项覆盖：defaultState 里的每个顶层键都保证存在，
      // 以后新增顶层字段（如 shop）不会因为这份清单漏登记而在导入时凭空消失。
      var next = Object.assign({}, ds, obj);
      next.version = 2;
      next.model = obj.model || 2;
      next.semesters = (obj.semesters && obj.semesters.length) ? obj.semesters : [
        Object.assign({ id: uid('sem') }, ds.semesters[0], obj.semester || {})
      ];
      next.currentSemesterId = obj.currentSemesterId || '';
      next.grades = obj.grades || {};
      next.periods = (obj.periods && obj.periods.length) ? obj.periods : ds.periods;
      next.courses = obj.courses || [];
      next.courseExceptions = Array.isArray(obj.courseExceptions) ? obj.courseExceptions : [];
      next.tasks = obj.tasks || [];
      next.taskSeq = obj.taskSeq || {};
      next.settings = Object.assign({}, ds.settings, obj.settings || {});
      next.pomodoro = Object.assign({}, ds.pomodoro, obj.pomodoro || {});
      next.plans = obj.plans || [];
      next.goals = Array.isArray(obj.goals) ? obj.goals : [];
      next.achievements = obj.achievements || { done: {} };
      next.ledger = obj.ledger || [];
      next.notes = obj.notes || [];
      // 日记特殊处理：同步码里根本没有 diaries 这个键。
      // 如果是「文件备份」缺这个键，说明是老备份，保留本机日记；
      // 如果明确给了数组（哪怕是空数组），就按给的来 —— 那是用户主动导入的完整备份。
      next.diaries = Array.isArray(obj.diaries) ? obj.diaries : (prev && prev.diaries) || [];
      next.events = obj.events || [];
      next.activities = obj.activities || [];
      next.meals = obj.meals || [];
      next.sleeps = obj.sleeps || [];
      next.sleepSession = null;   // 别人的计时不该跟着同步过来
      next.usage = obj.usage || {};
      next.shop = mergeShop(ds.shop, obj.shop);
      // 旧备份没有 subtask 字段：逐项补齐，别让 Object.assign 把整个对象盖掉
      next.settings.subtask = Object.assign({}, ds.settings.subtask, next.settings.subtask || {});
      // 日记同理：旧备份没有 diary 设置，逐项补，不整块覆盖
      next.settings.diary = Object.assign({}, ds.settings.diary, next.settings.diary || {});
      // 先挂上再校验（ensure 读的是模块级 state）；校验失败整体回滚，
      // 绝不让半成品状态留下来被 save() 落盘 —— 否则刷新后连启动都过不去。
      state = next;
      try {
        this.ensure();
      } catch (e) {
        state = prev;
        throw e;
      }
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
  global.stageNeed = stageNeed;
  global.SUBTASK_DEFAULTS = SUBTASK_DEFAULTS;
  global.subOpts = subOpts;
  global.isChild = isChild;
  global.childrenOf = childrenOf;
  global.subtaskProgress = subtaskProgress;
  global.childIds = childIds;
  Store.validateSchema = validateSchema;
  global.validateSchema = validateSchema;
  global.Store = Store;
})(window);


