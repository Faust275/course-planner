

/* ==========================================================
 * Store —— 数据层
 * 全部数据持久化到 localStorage
 * ========================================================== */
(function (global) {
  'use strict';

  var KEY = 'course-planner:v1';
  var KEY_ARCHIVE = 'cp-store-archive';
  var KEY_LEDGER_ARCHIVE = 'cp-store-ledger-archive';
  var KEY_HEALTH_ARCHIVE = 'cp-store-health-archive';
  var SCHEMA_VERSION = 3;          // 数据结构版本（导出/导入都写这个）
  var BLOB_BG = 'cp-blob-background';
  var BLOB_PET = 'cp-blob-pet';
  var saveTimer = null;            // 保存去抖句柄
  var blobCache = { bg: null, pet: null };   // 已落盘的大图，避免重复写
  var archiveDirty = false;
  var archiveCachedStr = null;
  var ledgerArchiveCachedStr = null;

  /* ---------- 持久化抽象：优先 IndexedDB，file:// 或隐私模式回退 localStorage ---------- */
  var Persist = (function () {
    var DB_NAME = 'cp-store', STORE = 'kv', dbPromise = null, idbBroken = false;
    var IDB_TIMEOUT_MS = 700;
    function idbOK() {
      if (idbBroken) return false;
      try {
        var p = location.protocol;
        return typeof indexedDB !== 'undefined' && indexedDB !== null &&
          (p === 'http:' || p === 'https:' || p === 'capacitor:' || p === 'ionic:');
      } catch (e) { return false; }
    }
    function lsGet(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function lsSet(key, str) {
      try { localStorage.setItem(key, str); return true; } catch (e) { return false; }
    }
    function openDB() {
      if (idbBroken) return Promise.reject(new Error('idb-broken'));
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          idbBroken = true;
          dbPromise = null;
          reject(new Error('idb-timeout'));
        }, IDB_TIMEOUT_MS);
        try {
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () {
            var db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          };
          req.onsuccess = function () {
            if (settled) {
              try { req.result.close(); } catch (e) {}
              return;
            }
            settled = true;
            clearTimeout(timer);
            var db = req.result;
            try {
              db.onversionchange = function () {
                try { db.close(); } catch (e) {}
                dbPromise = null;
              };
            } catch (e) {}
            resolve(db);
          };
          req.onerror = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            idbBroken = true;
            dbPromise = null;
            reject(req.error || new Error('idb-error'));
          };
          req.onblocked = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            idbBroken = true;
            dbPromise = null;
            reject(new Error('idb-blocked'));
          };
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            idbBroken = true;
            dbPromise = null;
            reject(err);
          }
        }
      });
      return dbPromise;
    }
    function load(key) {
      if (!idbOK()) {
        return Promise.resolve(lsGet(key));
      }
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var done = false;
          var t = setTimeout(function () {
            if (done) return;
            done = true;
            idbBroken = true;
            dbPromise = null;
            resolve(lsGet(key));
          }, IDB_TIMEOUT_MS);
          try {
            var tx = db.transaction(STORE, 'readonly');
            var r = tx.objectStore(STORE).get(key);
            r.onsuccess = function () {
              if (done) return;
              done = true;
              clearTimeout(t);
              resolve(r.result != null ? r.result : lsGet(key));
            };
            r.onerror = function () {
              if (done) return;
              done = true;
              clearTimeout(t);
              resolve(lsGet(key));
            };
          } catch (e) {
            if (!done) {
              done = true;
              clearTimeout(t);
              resolve(lsGet(key));
            }
          }
        });
      }).catch(function () { return lsGet(key); });
    }

    /**
     * 主状态专用：同时读 IDB 与 localStorage，交给调用方挑「更新的一份」。
     * 只读其中一个会在「IDB 写失败但 LS 写成功」或「IDB 超时回退」时
     * 静默退回旧快照，再被下一次 save 覆盖，属于不可恢复的数据回退。
     * @returns {Promise<{idb: ?string, ls: ?string, degraded: boolean}>}
     */
    function loadBoth(key) {
      var lsVal = lsGet(key);
      if (!idbOK()) return Promise.resolve({ idb: null, ls: lsVal, degraded: true });
      return openDB().then(function (db) {
        return new Promise(function (resolve) {
          var done = false;
          var t = setTimeout(function () {
            if (done) return;
            done = true;
            idbBroken = true;
            dbPromise = null;
            resolve({ idb: null, ls: lsVal, degraded: true });
          }, IDB_TIMEOUT_MS);
          try {
            var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            r.onsuccess = function () {
              if (done) return;
              done = true;
              clearTimeout(t);
              resolve({ idb: r.result != null ? r.result : null, ls: lsVal, degraded: false });
            };
            r.onerror = function () {
              if (done) return;
              done = true;
              clearTimeout(t);
              resolve({ idb: null, ls: lsVal, degraded: false });
            };
          } catch (e) {
            if (!done) { done = true; clearTimeout(t); resolve({ idb: null, ls: lsVal, degraded: false }); }
          }
        });
      }).catch(function () { return { idb: null, ls: lsVal, degraded: true }; });
    }
    function save(key, str) {
      // 主数据 KEY 同步双写一份到 localStorage 作为瞬时热备，防止二次启动 IDB 锁表时丢失最近改动
      if (key === KEY) lsSet(key, str);
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
        /* IDB 不可用（隐私/配额/超时），回退 localStorage */
        try { localStorage.setItem(key, str); }
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
      try { localStorage.removeItem(key); } catch (e) {}
      if (!idbOK()) return Promise.resolve();
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
      }).catch(function () {});
    }

    return { load: load, loadBoth: loadBoth, save: save, remove: remove, keys: keys, idbOK: idbOK };
  })();

  /* ---------- 预设 ---------- */
  /**
   * 从两份候选里挑「更新」的主状态：优先比 savedAt（每次落盘都会写），
   * 没有 savedAt 的老档按 IDB 优先。两边都解析不了就返回 null，交给上层兜底。
   */
  function pickFresher(pair) {
    function stamp(raw) {
      if (!raw) return null;
      try {
        var o = JSON.parse(raw);
        return { t: Number(o && o.savedAt) || 0 };
      } catch (e) { return null; }
    }
    var a = stamp(pair && pair.idb);
    var b = stamp(pair && pair.ls);
    if (a && b) return b.t > a.t ? { raw: pair.ls, from: 'ls' } : { raw: pair.idb, from: 'idb' };
    if (a) return { raw: pair.idb, from: 'idb' };
    if (b) return { raw: pair.ls, from: 'ls' };
    return { raw: null, from: 'none' };
  }

  /** 法定「放假日」判断（补班日不算）。数据来自 holidays-cn.js。 */
  function statutoryHoliday(dateStr) {
    try {
      if (!global.HolidayCN || typeof global.HolidayCN.lookup !== 'function') return null;
      var h = global.HolidayCN.lookup(dateStr);
      return (h && h.type === 'holiday') ? h : null;
    } catch (e) { return null; }
  }

  /** 这一天是否按「停课」处理。设置里关掉自动停课后仍返回 null。 */
  function holidayPaused(dateStr) {
    if (state && state.settings && state.settings.pauseOnHoliday === false) return null;
    return statutoryHoliday(dateStr);
  }

  /** 把 date 早于 cutoff 的记录拆出来（健康类记录冷藏用） */
  function splitOldRecords(arr, cutoff) {
    var hot = [], cold = [];
    (Array.isArray(arr) ? arr : []).forEach(function (r) {
      if (r && r.date && String(r.date) < cutoff) cold.push(r);
      else hot.push(r);
    });
    return { hot: hot, cold: cold };
  }

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
      version: 3,          // 与 SCHEMA_VERSION 保持一致（单测沙箱只摘部分函数，这里写死）
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
      courseLogs: [],
      attendance: [],      // 考勤：{ id, courseId, date, status: 'present'|'absent'|'leave', note }
      courseMoods: [],     // 日记里给当天课程打的状态：{ date, courseId, mood: 'good'|'tired' }
      tasks: [],
      taskArchive: [],   // 重复任务旧实例归档区：不进主列表，但仍参与历史统计
      taskSeq: {},
      // —— 日程 / 象限 ——
      settings: {
        trackMeal: true, trackSleep: true, statsOn: true,   // statsOn：是否开启「统计」功能（待办的统计分页 + 今日卡片）
        gradeAutoAttendance: false, // 成绩构成支持「按出勤率折算」的自动分项（默认关）
        gradeAutoTasks: false,      // 成绩构成支持「按待办完成率折算」的自动分项（默认关）
        healthAutoSync: true,   // 健康联动自动同步：启动时/定时/打开记录弹窗时自动从 Health Connect 拉取睡眠（关闭则仅保留手动「从健康联动导入」按钮）
        stepGoal: 8000,         // 每日步数目标（「我的活动」界面进度用）
        kcalGoal: 300,          // 每日活动热量目标（活力三环·外环 kcal）
        workoutGoal: 30,        // 每日锻炼时长目标（活力三环·中环 分钟）
        syncWorkoutToQuadrant: true, // 手环/锻炼记录自动写入象限 24h 时间环
        autoPlanWorkout: true,  // 锻炼记录自动触发关联运动计划打卡
        autoPlanFocus: true,    // 番茄钟专注自动累计至匹配的计划
        autoPlanSleep: true,    // 睡眠达标自动勾选睡眠/作息计划
        autoPlanDiet: true,     // 饮食记录自动勾选健康饮食/早餐计划
        autoPlanWordQuiz: true, // 每日一词测验达标自动勾选英语/背词计划
        topSafeInset: 'auto',   // 安卓顶部留空模式：auto | compact | spacious
        showWeekend: true,   // 课表是否显示周六、周日两列（关掉只影响展示，课程数据不动）
        pauseOnHoliday: true, // 法定放假日自动停课：今日页 / 日历 / 提醒 / 小组件统一按停课处理
        statsWidgets: { time: true, curve: true, sources: true, spend: true, course: true, health: true },  // 统计分页里想看哪些卡片
        health: { on: true, sleepMinH: 6, kcalOver: true, activityMinH: 0 },  // 今日健康提示：阈值由用户定
        // 健康看板总开关：默认关。装完只问一次（asked），没关联健康数据就不占导航位置。
        // 注意别和上面的 health（今日健康提示）混为一谈。
        healthOn: { enabled: false, asked: false },
        bodyTipDay: '',   // 今日页「身体状态建议」被手动关掉的那天（YYYY-MM-DD），只压当天
        theme: 'indigo', customColor: '#4f46e5',
        themeSkin: true,          // 机制主题皮肤：开启时跟随奖励模式（森林→自然 / 抽卡→工厂）
        themeSkinAuto: true,      // 自动跟随时由机制提供默认强调色；用户手动选色后变为 false
        themeMode: 'auto',        // 明暗：auto（跟随系统）/ light / dark
        natureTheme: 'pine',      // 自然主题预设：pine(晨雾松林) | aurora(极光苍穹) | sunset(暮霞熔金) | slate(山岚青黛)
        arkTheme: 'terminal',     // 明日方舟预设：terminal(经典终端) | roguelike(集成战略水墨)
        quiz: { right: 0, wrong: 0, goal: 5, todayDate: '', todayRight: 0, todayWords: [] },
        nav: { today: true, schedule: true,
               tasks: true, pomodoro: true, settings: true },
        navOrder: [],   // 自定义模块顺序（空 = 用默认顺序）
        navLayout: 'hub5', // 方案 A：默认五大核心分区整合模式（hub5 = 五分区聚合 | classic = 经典多模块）
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
          mode: 'sleep',
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
        // 番茄钟严格前台锁屏模式
        pomoStrict: {
          enabled: false,
          graceSec: 15,
          maxLeaves: 2
        },
        // 夜间自律守夜模式（可自定义时间段开启，原理同番茄钟）
        nightDiscipline: {
          enabled: false,
          startTime: '23:00',
          endTime: '06:30',
          autoPopup: true,
          strictForeground: true,
          whiteNoise: false,
          activeSession: null,
          history: []
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
        },
        // 记账预算：monthly = 当月总预算（0 表示不限）；categories = 分类预算 { food: 800, ... }
        ledgerBudget: {
          monthly: 0,
          categories: {}
        },
        lastLedgerDate: ''
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
      metrics: [],     // 健康联动每日活动量：{ id, date, steps, calories, distance, source }
      workouts: [],    // 锻炼/运动会话：{ id, date, type, name, start, end, duration, calories, distance, avgHr, maxHr, pace, source, activityId }
      weightLog: [],   // 体重记录（按天一条）：{ id, date, kg }
      // 主动记录的「躺下时刻」：白噪音睡眠定时开始时写入（{ date, at:'23:35', min, src }）。
      // 它不等于睡着——它只是「我准备睡了」的时间戳，所以和 sleeps（实测睡眠）分开存。
      sleepOnsets: [],
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
  /**
   * 剥掉本机凭据：语音（讯飞）与 OCR 的密钥。
   * 密钥泄露的代价（API 额度被盗刷）远大于重填一次的成本，所以导出一律默认剥掉。
   */
  function stripKeys(st) {
    if (!st || !st.settings) return st;
    if (st.settings.asr) {
      st.settings.asr.appId = '';
      st.settings.asr.apiKey = '';
      st.settings.asr.apiSecret = '';
    }
    if (st.settings.ocr) {
      st.settings.ocr.apiKey = '';
    }
    return st;
  }

  function mergeShop(def, src) {
    var s = (src && typeof src === 'object') ? src : {};
    // 旧档抢救：补签卡 makeUp → 摸鱼券 fish，使用记录 makeUpLog → fishLog。
    // 必须在这个函数里做：一旦先用默认值打底，tickets.fish 就变成 0，
    // 后面「fish == null 才搬运」的判断就永远不成立，老用户手里的券会凭空消失；
    // fishLog 同理——只认 s.fishLog 的话，旧的使用记录会被直接丢掉。
    var tickets = Object.assign({}, def.tickets, s.tickets || {});
    if (s.tickets && s.tickets.makeUp != null) {
      if (!(Number(tickets.fish) > 0)) tickets.fish = Number(s.tickets.makeUp) || 0;
      delete tickets.makeUp;                       // 搬完即删，保证幂等
    }
    var fishLog = Array.isArray(s.fishLog) ? s.fishLog
      : (Array.isArray(s.makeUpLog) ? s.makeUpLog : []);
    return {
      card: s.card === undefined ? def.card : s.card,
      activeDays: Object.assign({}, s.activeDays || {}),
      dupPool: Array.isArray(s.dupPool) ? s.dupPool : [],
      validDays: Object.assign({}, s.validDays || {}),
      growth: typeof s.growth === 'number' ? s.growth : (def.growth || 0),
      streak: Object.assign({}, def.streak, s.streak || {}),
      tickets: tickets,
      fishLog: fishLog,
      log: Array.isArray(s.log) ? s.log : []
    };
  }

  /* ==========================================================
   * 导入：归一化 + 覆盖前对比
   * ========================================================== */

  /**
   * 把外部导入内容归一化成一份完整 state。importJSON 与 diffImport 共用，
   * 保证「弹窗里说会变成什么」和「实际导入成什么」永远是同一套规则。
   * 只返回新对象，不碰模块级 state。
   */
  function safeImportState(prev, obj) {
    if (!obj || typeof obj !== 'object') throw new Error('数据格式不正确');
    if (!obj.courses && !obj.courseLogs && !obj.tasks && !obj.settings && !obj.plans && !obj.ledger &&
        !obj.notes && !obj.diaries && !obj.events && !obj.activities &&
        !obj.meals && !obj.sleeps && !obj.metrics && !obj.workouts && !obj.weightLog && !obj.goals) {
      throw new Error('没有找到可恢复的数据');
    }
    var ds = defaultState();
    // 以默认结构打底再逐项覆盖：defaultState 里的每个顶层键都保证存在，
    // 以后新增顶层字段（如 shop）不会因为这份清单漏登记而在导入时凭空消失。
    var next = Object.assign({}, ds, obj);
    next.version = Number(obj.version) || 1;   // 交给 ensure() 里的 migrateSchema 升级
    next.model = obj.model || 2;
    next.semesters = (obj.semesters && obj.semesters.length) ? obj.semesters : [
      Object.assign({ id: uid('sem') }, ds.semesters[0], obj.semester || {})
    ];
    next.currentSemesterId = obj.currentSemesterId || '';
    next.grades = obj.grades || {};
    next.periods = (obj.periods && obj.periods.length) ? obj.periods : ds.periods;
    next.courses = obj.courses || [];
    next.courseLogs = Array.isArray(obj.courseLogs) ? obj.courseLogs : (prev && prev.courseLogs) || [];
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
    next.taskArchive = Array.isArray(obj.taskArchive) ? obj.taskArchive : (prev && prev.taskArchive) || [];
    next.events = obj.events || [];
    next.activities = obj.activities || [];
    next.meals = Array.isArray(obj.meals) ? obj.meals : [];
    next.sleeps = Array.isArray(obj.sleeps) ? obj.sleeps : [];
    next.metrics = Array.isArray(obj.metrics) ? obj.metrics : [];
    next.workouts = Array.isArray(obj.workouts) ? obj.workouts : [];
    next.weightLog = Array.isArray(obj.weightLog) ? obj.weightLog : [];
    next.sleepOnsets = Array.isArray(obj.sleepOnsets) ? obj.sleepOnsets : [];
    next.sleepSession = null;   // 别人的计时不该跟着同步过来
    next.usage = obj.usage || {};
    next.shop = mergeShop(ds.shop, obj.shop);
    // 旧备份没有 subtask 字段：逐项补齐，别让 Object.assign 把整个对象盖掉
    next.settings.subtask = Object.assign({}, ds.settings.subtask, next.settings.subtask || {});
    // 日记同理：旧备份没有 diary 设置，逐项补，不整块覆盖
    next.settings.diary = Object.assign({}, ds.settings.diary, next.settings.diary || {});
    return next;
  }

  /* 导入体检：实现在 import-safe.js（纯函数模块），这里只做一次转发 */
  function inspectImport(obj) {
    return global.ImportSafe ? global.ImportSafe.inspect(obj) : { total: 0, bad: 0, byModule: [] };
  }

  /** 课程在「另一台设备」上认得出是同一门课的键。不能用 id/semesterId——跨设备都是新生成的 */
  function courseKey(c) {    return String(c && c.name || '') + '\u0000' + String(c && c.teacher || '');
  }

  /** 课程内容指纹（只取用户真正关心的几项，颜色/备注变了不算改动，避免误报） */
  function courseShape(c) {
    var slots = Array.isArray(c && c.slots) ? c.slots : [];
    return JSON.stringify([
      c && c.location || '',
      String(slots.map(function (s) {
        return [s.day, s.timeMode || '', s.periodId || '', s.startTime || '', s.endTime || '', s.location || ''].join('~');
      }).sort().join('|')),
      c ? (c.startWeek || 1) : 1,
      c ? (c.endWeek || 0) : 0,
      c && c.weekType || 'all',
      Number(c && c.credit) || 0
    ]);
  }

  function taskKey(t) {
    return String(t && t.title || '') + '\u0000' + String(t && t.dueDate || '');
  }

  function taskShape(t) {
    return JSON.stringify([!!(t && t.done), Number(t && t.priority) || 0]);
  }

  /**
   * 逐项统计：条数、以及「按语义键」算出的新增 / 消失 / 改动条数。
   * 轻量版只做到这里——字段级三路合并等于重写一个同步引擎，
   * 而实际场景是自己的手机同步到自己的电脑，还有备份兜底。
   */
  function diffList(before, after, keyOf, shapeOf) {
    var av = Array.isArray(after) ? after : [];
    var bv = Array.isArray(before) ? before : [];
    var out = { add: 0, gone: 0, mod: 0 };
    if (!shapeOf) {
      out.add = Math.max(0, av.length - bv.length);
      out.gone = Math.max(0, bv.length - av.length);
      return out;
    }
    var mapB = {};
    bv.forEach(function (x) { var k = keyOf(x); if (!(k in mapB)) mapB[k] = x; });
    var seen = {};
    av.forEach(function (x) {
      var k = keyOf(x);
      if (!(k in mapB)) { out.add++; return; }
      if (seen[k]) return;                       // 同键重复出现只算一次改动
      seen[k] = 1;
      if (shapeOf(mapB[k]) !== shapeOf(x)) out.mod++;
    });
    bv.forEach(function (x) { if (!seen[keyOf(x)]) { out.gone++; seen[keyOf(x)] = 1; } });
    return out;
  }

  /** 各模块在对比表里的展示顺序与名字 */
  var DIFF_MODULES = [
    { key: 'courses',  name: '课程', keyOf: courseKey, shapeOf: courseShape },
    { key: 'tasks',    name: '待办', keyOf: taskKey,   shapeOf: taskShape },
    { key: 'plans',    name: '计划', keyOf: function (p) { return String(p && (p.title || p.name) || ''); } },
    { key: 'goals',    name: '目标', keyOf: function (g) { return String(g && (g.title || g.name) || ''); } },
    { key: 'ledger',   name: '记账' },
    { key: 'notes',    name: '灵感' },
    { key: 'diaries',  name: '日记' },
    { key: 'events',   name: '日程' },
    { key: 'activities', name: '活动' },
    { key: 'meals',    name: '饮食' },
    { key: 'sleeps',   name: '睡眠' },
    { key: 'metrics',  name: '步数' },
    { key: 'workouts', name: '锻炼' },
    { key: 'weightLog', name: '体重' },
    { key: 'courseLogs', name: '课堂所学' },
    { key: 'grades',   name: '成绩', isMap: true }
  ];

  function sizeOf(st, mod) {
    var v = st ? st[mod.key] : null;
    if (mod.isMap) return v && typeof v === 'object' ? Object.keys(v).length : 0;
    return Array.isArray(v) ? v.length : 0;
  }

  function diffStates(cur, next) {
    var rows = [];
    DIFF_MODULES.forEach(function (mod) {
      var before = sizeOf(cur, mod);
      var after = sizeOf(next, mod);
      var d = (before === 0 && after === 0)
        ? { add: 0, gone: 0, mod: 0 }
        : diffList(cur && cur[mod.key], next && next[mod.key], mod.keyOf, mod.shapeOf);
      rows.push({ key: mod.key, name: mod.name, before: before, after: after, add: d.add, gone: d.gone, mod: d.mod });
    });

    // 「会被清空」比条数更值得先说：同步码的精简档会把一堆模块整个清掉
    var wipes = rows.filter(function (r) { return r.before > 0 && r.after === 0; });
    var totalBefore = rows.reduce(function (s, r) { return s + r.before; }, 0);
    var totalAfter = rows.reduce(function (s, r) { return s + r.after; }, 0);
    return {
      rows: rows,
      wipes: wipes,
      totalBefore: totalBefore,
      totalAfter: totalAfter,
      // 备份几乎是空壳：这种情况下「覆盖」等于清库，必须让用户看清楚
      empty: totalAfter === 0,
      touched: rows.some(function (r) {
        return r.add || r.gone || r.mod || r.before !== r.after;
      })
    };
  }

  /** 把 diff 结果拼成确认弹窗里的几行字 */
  function diffLines(d) {
    var lines = [];
    d.rows.forEach(function (r) {
      if (!r.before && !r.after) return;
      var head = r.name + ' ' + r.before + ' → ' + r.after;
      var bits = [];
      if (r.add) bits.push('新增 ' + r.add);
      if (r.gone) bits.push('消失 ' + r.gone);
      if (r.mod) bits.push('改动 ' + r.mod);
      if (r.before > 0 && r.after === 0) bits.push('会被清空');
      lines.push(head + (bits.length ? '（' + bits.join(' · ') + '）' : '（无变化）'));
    });
    return lines;
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
      'courses', 'courseLogs', 'tasks', 'taskArchive', 'plans', 'goals', 'ledger', 'notes',
      'diaries', 'events', 'activities', 'meals', 'sleeps',
      'metrics', 'workouts', 'weightLog', 'sleepOnsets',
      'courseExceptions', 'periods', 'semesters', 'attendance', 'courseMoods'
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
    out.settings.pomoStrict = Object.assign({}, def.settings.pomoStrict, s.pomoStrict || {});
    out.settings.nightDiscipline = Object.assign({}, def.settings.nightDiscipline, s.nightDiscipline || {});
    if (!Array.isArray(out.settings.nightDiscipline.history)) out.settings.nightDiscipline.history = [];
    out.settings.diet = Object.assign({}, def.settings.diet, s.diet || {});
    out.settings.gpa = Object.assign({}, def.settings.gpa, s.gpa || {});
    out.settings.tagMeta = (s.tagMeta && typeof s.tagMeta === 'object') ? s.tagMeta : {};
    out.settings.nav = Object.assign({}, def.settings.nav, s.nav || {});
    if (!Array.isArray(out.settings.navOrder)) out.settings.navOrder = [];
    out.settings.navLayout = (s.navLayout === 'classic') ? 'classic' : 'hub5';
    if (['auto', 'light', 'dark'].indexOf(out.settings.themeMode) < 0) out.settings.themeMode = 'auto';
    if (typeof out.settings.themeSkin !== 'boolean') out.settings.themeSkin = true;
    if (typeof out.settings.themeSkinAuto !== 'boolean') out.settings.themeSkinAuto = true;
    if (!out.settings.natureTheme) out.settings.natureTheme = 'pine';
    if (!out.settings.arkTheme) out.settings.arkTheme = 'terminal';
    if (typeof out.settings.showWeekend !== 'boolean') out.settings.showWeekend = true;
    if (typeof out.settings.pauseOnHoliday !== 'boolean') out.settings.pauseOnHoliday = true;
    if (typeof out.settings.statsOn !== 'boolean') out.settings.statsOn = true;
      if (typeof out.settings.gradeAutoAttendance !== 'boolean') out.settings.gradeAutoAttendance = false;
      if (typeof out.settings.gradeAutoTasks !== 'boolean') out.settings.gradeAutoTasks = false;

    // 4. Pomodoro 深度校验
    var pm = (out.pomodoro && typeof out.pomodoro === 'object' && !Array.isArray(out.pomodoro)) ? out.pomodoro : {};
    out.pomodoro = Object.assign({}, def.pomodoro, pm);
    out.pomodoro.points = Math.max(0, Number(pm.points) || 0);
    out.pomodoro.jade = Math.max(0, Number(pm.jade) || 0);
    out.pomodoro.mode = (pm.mode === 'gacha' && out.settings.devArknights) ? 'gacha'
      : (pm.mode === 'academic' ? 'academic' : 'forest');
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

  /* ==========================================================
   * 一次性数据迁移（与 ensure 里的「字段补齐」分开维护）
   * 只做「旧结构 → 新结构」的转换：旧树 growth→阶段、单池 pity6→分池、
   * makeUp→摸鱼券、单学期→学期列表、同名多课程→一门课多时段。
   *
   * 触发条件一律用「数据特征」判断（t.stage == null / gc.pools 不存在 / …），
   * 不用版本号跳过——备份导入、旧档恢复随时可能发生，按版本跳过会漏迁。
   * 代价是每次启动要空转遍历一次（树 ≤4、池 2、课程 <20），量级可忽略；
   * 换来的是「任何来源的旧档都能被正确迁移」这个确定性。
   * ========================================================== */

  /**
   * 旧值抢救：**必须在 validateSchema 之前跑**（ensure 的第一行）。
   *
   * validateSchema 会按默认结构把 pools / tickets 的字段初始化成 0，
   * 等下面的 migrate* 再判断「旧字段存在吗」时，新字段已经不是 null 了，
   * 搬运条件永远不成立——老用户的保底计数（pity6）和补签卡（makeUp）
   * 就是这么丢的。所以先把旧值搬到新字段位上、删掉旧字段，再走正常流程。
   *
   * 搬完即删旧字段，保证幂等：第二次进入时旧字段已不在，不会重复搬运。
   *
   * 注：shop 那侧（makeUp → 摸鱼券）不在这里做——shop 只经 mergeShop 规范化，
   * 抢救逻辑已放在 mergeShop 内部，importJSON 与 validateSchema 两条路径都覆盖得到。
   */
  function hoistLegacy(st) {
    if (!st || typeof st !== 'object') return;

    // 单池 pity6 → 标准池（分池改造前的老档）
    var gc = st.pomodoro && st.pomodoro.gacha;
    if (gc && typeof gc === 'object') {
      var legacy = Number(gc.pity6) || 0;
      var pools = (gc.pools && typeof gc.pools === 'object') ? gc.pools : null;
      if (legacy > 0 && !(pools && pools.standard)) {
        gc.pools = Object.assign({}, pools || {}, {
          standard: { pity6: legacy, total: Number(gc.total) || 0, spark: 0, guaranteed: false }
        });
        if (!gc.pools.classic) gc.pools.classic = { pity6: 0, total: 0, spark: 0, guaranteed: false };
      }
    }
  }

  /** 旧树（按 growth 成长值）→ 新模型：阶段 + 阶段内记数 */
  function migrateTrees(trees) {
    (trees || []).forEach(function (t) {
      if (t.stage != null) return;          // 已是新模型
      var g = t.growth || 0;
      t.stage = g >= 320 ? 5 : g >= 200 ? 4 : g >= 120 ? 3 : g >= 60 ? 2 : 1;
      t.prog = 0;
      t.withered = false;
      delete t.growth;
    });
  }

  /** 分池：旧档的单一 pity6 归入标准寻访；两池各自独立计数 */
  function migratePools(gc) {
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
  }

  /** 摸鱼券：旧档的 makeUp 搬运过来，使用记录改名（调用前需已兜底 sh 对象） */
  function migrateShop(sh) {
    if (!sh.tickets) sh.tickets = { selection: 0, fish: 0 };
    if (sh.tickets.fish == null) sh.tickets.fish = sh.tickets.makeUp || 0;
    delete sh.tickets.makeUp;
    if (!Array.isArray(sh.fishLog)) sh.fishLog = Array.isArray(sh.makeUpLog) ? sh.makeUpLog : [];
    delete sh.makeUpLog;
    if (!sh.validDays || typeof sh.validDays !== 'object') sh.validDays = {};
    if (sh.growth == null) sh.growth = 0;
    if (!sh.streak) sh.streak = { weekEnd: '', monthEnd: '' };
  }

  /** 学期列表：旧版本只有一个 state.semester，迁成列表并确定当前学期 */
  function migrateSemesters(st, ds) {
    if (!st.semesters || !st.semesters.length) {
      var sid0 = uid('sem');
      var old0 = st.semester || {};
      st.semesters = [{
        id: sid0,
        name: old0.name || ds.semesters[0].name,
        startDate: old0.startDate || ds.semesters[0].startDate,
        weeks: old0.weeks || ds.semesters[0].weeks
      }];
      st.currentSemesterId = sid0;
    }
    var hasCur = st.semesters.some(function (x) { return x.id === st.currentSemesterId; });
    if (!hasCur) st.currentSemesterId = st.semesters[0].id;
  }

  /** 老课程没有学期归属，归到当前学期 */
  function migrateCourseSemester(st) {
    var curSem = st.currentSemesterId;
    st.courses.forEach(function (c) { if (!c.semesterId) c.semesterId = curSem; });
  }

  /**
   * 数据模型 v2：旧版「同名多条课程」合并为「一门课 + 多时段 slots」。
   * 只在 model < 2 时执行，跑完置 model = 2，之后不再进入。
   */
  function migrateCoursesV2(st) {
    if (st.model >= 2) return;
    // 1) 每条旧记录先补一个 slots（取其顶层 day/periodId/时间/地点）
    st.courses.forEach(function (c) {
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
    st.courses.forEach(function (c) {
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
    st.courses = _merged;
    // 5) 被合并掉的旧 id → 主课 id，回写任务关联
    Object.keys(_idMap).forEach(function (oldId) {
      st.tasks.forEach(function (t) { if (t.courseId === oldId) t.courseId = _idMap[oldId]; });
    });
    st.model = 2;
  }

  /* ==========================================================
   * 重复任务实例归档
   * 重复任务每完成一次就克隆一个新实例（genNextTask），用得越久 tasks 越长。
   * 这里把「已完成 + 无任何关联 + 够老」的重复实例挪进 taskArchive：
   *   - 归档区不参与列表渲染，待办 / 已完成列表自然变短
   *   - 但仍参与历史统计（目标 KR 完成率把 tasks + taskArchive 一起算），
   *     否则归档会把目标周期内的分母与分子一起变小，进度会莫名其妙地变
   * 只搬「没有活动记录、没有子任务」的实例：有时间投入或子任务的留在原地，
   * 免得「已投入 X」和子任务计数找不到主人——宁可不归档，也不做假数据。
   * ========================================================== */

  /** 完成超过这么多天的重复实例才考虑归档 */
  var ARCHIVE_AFTER_DAYS = 60;

  function archiveOldRepeats(st, todayStr) {
    var tasks = st.tasks || [];
    if (!tasks.length) return 0;
    if (!Array.isArray(st.taskArchive)) st.taskArchive = [];

    // 关联检查：挂了活动记录（时间投入）或子任务的一律不归档
    var withActs = {};
    (st.activities || []).forEach(function (a) { if (a && a.taskId) withActs[a.taskId] = 1; });
    var withKids = {};
    tasks.forEach(function (t) { if (t && t.parentId) withKids[t.parentId] = 1; });

    var base = DateUtil.parse(todayStr) || DateUtil.today();
    var cutoff = DateUtil.toStr(DateUtil.addDays(base, -ARCHIVE_AFTER_DAYS));

    var move = [], ids = {};
    tasks.forEach(function (t) {
      if (!t || t.status !== 'done') return;
      // 只归档重复任务生成的实例（膨胀来自它们），一次性任务保持原样
      if (!t.repeatFrom && !(t.occurrence > 0)) return;
      if (withActs[t.id] || withKids[t.id]) return;
      var d = (t.doneAt || t.dueDate || '').slice(0, 10);
      if (!d || d >= cutoff) return;                 // 太新：先留着，别刚完成就搬走
      move.push(t); ids[t.id] = 1;
    });
    if (!move.length) return 0;

    st.tasks = tasks.filter(function (t) { return !ids[t.id]; });
    move.forEach(function (t) { st.taskArchive.push(t); });
    archiveDirty = true;
    return move.length;
  }

  /** 时间工具：HH:MM <-> 分钟 */
  var TimeUtil = {
    fromMin: function (m) {
      var t = Math.max(0, Math.min(1440, Math.round(Number(m) || 0)));
      var h = Math.floor(t / 60), mm = t % 60;
      return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
    },
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

  /**
   * 入睡时刻归一到「夜晚轴」：18:00 之后算当晚，凌晨（<12:00）按 +24h 记。
   * 这样 23:40 和 01:20 能直接比早晚、求平均，不用先猜是不是跨了午夜。
   */
  function onsetAxis(hhmm) {
    if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return null;
    var m = TimeUtil.toMin(hhmm);
    return m < 12 * 60 ? m + 1440 : m;
  }
  /** 夜晚轴分钟 -> "HH:MM"（24:30 → "00:30"） */
  function axisToHhmm(m) {
    m = Math.round(m) % 1440;
    if (m < 0) m += 1440;
    return (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60);
  }

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

  /** 小米运动健康风格：运动/锻炼类型（含 MET 代谢当量估算系数与默认标签） */
  var WORKOUT_TYPES = [
    { value: 'run',        label: '户外跑',   icon: '🏃',   met: 8.5, color: '#10b981', tag: '运动/跑步', hasDist: true },
    { value: 'treadmill',  label: '室内跑',   icon: '🏃‍♂️', met: 7.5, color: '#059669', tag: '运动/跑步', hasDist: true },
    { value: 'walk',       label: '健走',     icon: '🚶',   met: 4.2, color: '#14b8a6', tag: '运动',      hasDist: true },
    { value: 'cycle',      label: '户外骑行', icon: '🚴',   met: 7.0, color: '#0ea5e9', tag: '运动/骑行', hasDist: true },
    { value: 'swim',       label: '泳池游泳', icon: '🏊',   met: 8.0, color: '#0284c7', tag: '运动',      hasDist: true },
    { value: 'rope',       label: '跳绳',     icon: '🪢',   met: 9.8, color: '#f97316', tag: '运动',      hasDist: false },
    { value: 'badminton',  label: '羽毛球',   icon: '🏸',   met: 6.5, color: '#eab308', tag: '运动/球类', hasDist: false },
    { value: 'basketball', label: '篮球',     icon: '🏀',   met: 7.5, color: '#f59e0b', tag: '运动/球类', hasDist: false },
    { value: 'strength',   label: '力量训练', icon: '🏋️',   met: 5.5, color: '#8b5cf6', tag: '运动',      hasDist: false },
    { value: 'yoga',       label: '瑜伽拉伸', icon: '🧘',   met: 3.2, color: '#ec4899', tag: '运动/拉伸', hasDist: false },
    { value: 'freestyle',  label: '自由训练', icon: '⚡',   met: 6.0, color: '#6366f1', tag: '运动',      hasDist: false }
  ];

  function workoutType(v) {
    for (var i = 0; i < WORKOUT_TYPES.length; i++) {
      if (WORKOUT_TYPES[i].value === v) return WORKOUT_TYPES[i];
    }
    return WORKOUT_TYPES[WORKOUT_TYPES.length - 1];
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
    },

    /**
     * 精确到小时/分钟的截止剩余时间计算
     * @param {string} dueDate YYYY-MM-DD
     * @param {string} [dueTime] HH:MM
     * @param {Date} [now]
     * @returns {{ hasTime: boolean, overdue: boolean, totalMinutes: number, hours: number, minutes: number, days: number, label: string, shortText: string }|null}
     */
    hoursLeft: function (dueDate, dueTime, now) {
      if (!dueDate) return null;
      var d = DateUtil.parse(dueDate);
      if (!d) return null;
      var cur = now instanceof Date ? now : new Date();
      var tm = String(dueTime || '').trim();
      var mMatch = /^(\d{1,2}):(\d{2})$/.exec(tm);
      if (!mMatch) {
        var dl = DateUtil.diffDays(d, new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()));
        return {
          hasTime: false,
          overdue: dl < 0,
          totalMinutes: dl * 1440,
          hours: dl * 24,
          minutes: 0,
          days: dl,
          label: dl < 0 ? ('逾期 ' + Math.abs(dl) + ' 天') : (dl === 0 ? '今天' : DateUtil.human(dueDate)),
          shortText: ''
        };
      }
      var hh = Math.max(0, Math.min(23, parseInt(mMatch[1], 10) || 0));
      var mm = Math.max(0, Math.min(59, parseInt(mMatch[2], 10) || 0));
      var target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
      var diffMs = target.getTime() - cur.getTime();
      var totalMin = Math.round(diffMs / 60000);
      var overdue = diffMs < 0;
      var absMin = Math.abs(totalMin);
      var absH = Math.floor(absMin / 60);
      var remM = absMin % 60;
      var dayDiff = DateUtil.diffDays(d, new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()));
      var shortText = '';
      if (overdue) {
        if (absMin < 60) shortText = '已超 ' + Math.max(1, absMin) + '分';
        else if (absH < 48) shortText = '已超 ' + absH + 'h' + (remM >= 15 ? remM + 'm' : '');
        else shortText = '逾期 ' + Math.max(1, Math.abs(dayDiff)) + ' 天';
      } else {
        if (absMin < 60) shortText = '剩 ' + Math.max(1, absMin) + '分';
        else if (absH < 24 && dayDiff === 0) shortText = '剩 ' + absH + 'h' + (remM >= 15 ? remM + 'm' : '');
        else if (dayDiff === 1 && absH < 36) shortText = '约 ' + absH + 'h 后';
      }
      var normTime = DateUtil.pad(hh) + ':' + DateUtil.pad(mm);
      var baseHuman = DateUtil.human(dueDate) + ' ' + normTime;
      return {
        hasTime: true,
        overdue: overdue,
        totalMinutes: totalMin,
        hours: overdue ? -absH : absH,
        minutes: remM,
        days: dayDiff,
        timeStr: normTime,
        label: shortText ? (baseHuman + ' · ' + shortText) : baseHuman,
        shortText: shortText
      };
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
    var sc = global.StatsCalc || (typeof StatsCalc !== 'undefined' ? StatsCalc : null);
    return sc && sc.sleepByNight ? sc.sleepByNight(sleeps, dateStr, DateUtil, TimeUtil) : 0;
  }

  /* ===== 计划类型 ===== */
  var PLAN_TYPES = {
    checkin: { name: '打卡', unitHint: '次' },
    // 额度型：回答「每周 3 次」这类需求。打卡型只有「每天一次 / 每周一次」，
    // 想表达「一周去三次健身房」只能退化成进度型凑数，连续与周期语义都丢了。
    quota: { name: '额度', unitHint: '次' },
    progress: { name: '进度', unitHint: '页' },
    duration: { name: '时长', unitHint: '分钟' }
  };

  var PLAN_PERIODS = {
    daily: { name: '每天' },
    weekly: { name: '每周' },
    monthly: { name: '每月' },
    once: { name: '单次' }
  };

  /**
   * 计划的「耗能档位」。只有用户显式标过才参与健康联动，
   * 不按标题猜（猜错的代价比不猜大得多）。
   */
  var PLAN_LOADS = {
    low:  { name: '轻松', hint: '久坐也能做，缺觉时优先推它' },
    mid:  { name: '一般', hint: '照常推进' },
    high: { name: '吃力', hint: '缺觉时会被建议缓一缓' }
  };
  /** 连续豁免上限：连缓超过这么多天就真的算断了，避免用豁免刷连续 */
  var PLAN_EXEMPT_MAX = 2;

  /* ===== 额度型计划的周期窗口 =====
   * 窗口边界算法在 plan-quota.js（纯函数模块，DateUtil 注入），这里只留薄封装，
   * 免得 store.js 继续膨胀（单测里有「< 12000 行」的守门断言）。 */
  function getPlanQuota() {
    var pq = (typeof global !== 'undefined' && global.PlanQuota) ||
             (typeof window !== 'undefined' && window.PlanQuota);
    if (pq) return pq;
    return {
      windowAt: function (plan, idx, u) {
        var i = Math.max(0, parseInt(idx, 10) || 0), s = u.parse(plan.startDate) || u.today(), ws, we;
        if (plan.period === 'monthly') { ws = u.addMonths(s, i); we = u.addDays(u.addMonths(s, i + 1), -1); }
        else { ws = u.addDays(s, i * 7); we = u.addDays(ws, 6); }
        return { index: i, start: u.toStr(ws), end: u.toStr(we) };
      },
      indexOn: function (plan, dateStr, u) {
        var s = u.parse(plan.startDate) || u.today(), d = u.parse(dateStr) || u.today();
        if (d < s) return 0;
        if (plan.period === 'monthly') return (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
        return Math.floor(u.diffDays(d, s) / 7);
      },
      countIn: function (plan, win) {
        var f = win.start, t = win.end, n = 0;
        (plan.records || []).forEach(function (r) { if (r && r.date && r.date >= f && r.date <= t) n++; });
        return n;
      },
      stateOf: function (plan, todayStr, u) {
        var n = Math.max(1, parseInt(plan.quotaN, 10) || 1), total = Math.max(1, parseInt(plan.days, 10) || 1);
        var idx = this.indexOn(plan, todayStr || u.toStr(u.today()), u), cur = this.windowAt(plan, idx, u), doneW = 0;
        for (var i = 0; i < total; i++) { if (this.countIn(plan, this.windowAt(plan, i, u)) >= n) doneW++; }
        var cnt = this.countIn(plan, cur);
        return { n: n, period: plan.period, index: idx, start: cur.start, end: cur.end, count: cnt, reached: cnt >= n, doneWindows: doneW, totalWindows: total };
      }
    };
  }

  function quotaWindowAt(plan, idx, du) {
    return getPlanQuota().windowAt(plan, idx, du || DateUtil);
  }

  /** 日期落在第几个周期；早于开始日一律算第 0 个（还没开始时也显示第一格） */
  function quotaIndexOn(plan, dateStr, du) {
    return getPlanQuota().indexOn(plan, dateStr, du || DateUtil);
  }

  /** 某个周期窗口内打了几次卡 */
  function quotaCountIn(plan, win) {
    return getPlanQuota().countIn(plan, win);
  }

  /**
   * 「按天打勾」类计划：打卡型 + 额度型。
   * 「今天打没打 / 自动联动打卡 / 画打卡格」都走它，
   * 免得每加一种计划类型都要改六处 type 判断（额度型这次就踩到了）。
   */
  function isCheckinLike(p) {
    return !!p && (p.type === 'checkin' || p.type === 'quota');
  }

  /** 额度型的当前状态（供 UI 与进度共用） */
  function quotaStateOf(plan, todayStr, du) {
    return getPlanQuota().stateOf(plan, todayStr, du || DateUtil);
  }

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

  /* ===== 番茄钟 / 积分 / 养树：规则与树阶段（静态目录已拆至 store-presets.js，此处保留兼容兜底） ===== */
  var _SP = global.StorePresets || {};
  var POMO = _SP.POMO || {
    POINT_PER_MIN: 0.1, TASK_DONE: 1, PLAN_CHECKIN: 0.2, PLAN_DONE: 3, GOAL_DONE: 6, KR_DONE: 1.5,
    SLEEP_DAY: 0, MEAL_EACH: 0, MEAL_MAX_DAY: 3, ACTIVITY_PER_MIN: 0, ACTIVITY_MAX_DAY: 60,
    PLANT_COST: 10, PLANT_STEP: 3, WATER_COST: 2,
    JADE_PER_POINT: 180, PULL_COST: 600, TEN_COST: 6000,
    RATE_6: 2, RATE_5: 8, RATE_4: 50, PITY_START: 50, PITY_STEP: 2, TEN_GUARANTEE: 5, POT_MAX: 5,
    DUP_POINTS: { 6: 10, 5: 3, 4: 0.5, 3: 0.2 },
    FOCUS_REWARD: 10, FOCUS_MIN_MIN: 40, FOCUS_REMIND_MIN: 60,
    GROVE_SLOTS: 4, REVIVE_COST: 5,
    CARD_PRICE: 300, CARD_PRICE_GACHA: 54000, CARD_DAYS: 30, CARD_DAILY: 25, CARD_WEEK_BONUS: 25, CARD_FULL_BONUS: 50,
    VALID_DAY_MIN: 2, GROWTH_PER_TICKET: 10, FISH_MAX_PER_WEEK: 5, FISH_HOLD_MAX: 20,
    STREAK_WEEK_POINTS: 5, STREAK_MONTH_POINTS: 20, LIMITED_SPARK: 200, GACHA_EPOCH: '2026-01-01',
    GACHA_POOLS: {
      standard: { id: 'standard', name: '标准寻访', tag: 'std', rotDays: 3, up6: 2, up5: 3, spark: 120, sparkHistory: 5, offLimited: 0.15, desc: '' },
      classic: { id: 'classic', name: '中坚寻访', tag: 'classic', rotDays: 3, up6: 2, up5: 3, spark: 120, sparkHistory: 5, offLimited: 0.15, desc: '' }
    }
  };
  var TREE_SPECIES = _SP.TREE_SPECIES || [
    { key: 'camphor', name: '樟树', crown: '#4c8c4a', crown2: '#3f7d3d', trunk: '#7a5c3a', shape: 'round', lastK: 3, unlockH: 0, price: 10, info: { sci: 'Cinnamomum camphora', family: '樟科', protect: '常见', note: '' } },
    { key: 'ginkgo', name: '银杏', crown: '#f0c04a', crown2: '#dfa93a', trunk: '#8a6a45', shape: 'fan', lastK: 3, unlockH: 0, price: 13, info: { sci: 'Ginkgo biloba', family: '银杏科', protect: '国家一级', note: '' } },
    { key: 'pine', name: '松树', crown: '#3f7d4a', crown2: '#356b3f', trunk: '#6f5637', shape: 'cone', lastK: 3, unlockH: 0, price: 14, info: { sci: 'Pinus', family: '松科', protect: '常见', note: '' } }
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

  var TREE_STAGES = _SP.TREE_STAGES || [
    { name: '—' }, { name: '嫩芽' }, { name: '幼苗' }, { name: '小树' }, { name: '大树' }, { name: '参天' }
  ];
  var TAG_PRESETS = _SP.TAG_PRESETS || [
    { g: '学习', name: '学习', icon: 'book', color: '#4f46e5' },
    { g: '生活', name: '生活', icon: 'home', color: '#10b981' },
    { g: '其他', name: '重要', icon: 'star', color: '#f59e0b' }
  ];
  var TAG_GROUPS = _SP.TAG_GROUPS || ['学习', '生活', '工作', '健康', '运动', '娱乐', '社交', '出行', '饮食', '其他'];

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

  /** 标签列表里是否有命中 filter 的项（一级命中其下所有二级） */
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
  /* ===== 成就系统（静态表已拆至 store-presets.js） ===== */
  var ACH_TIER = _SP.ACH_TIER || {
    bronze: { color: '#cd7f32', label: '初级' },
    silver: { color: '#9aa7b5', label: '中级' },
    gold:   { color: '#ffb300', label: '高级' }
  };
  var ACH_DEF = _SP.ACH_DEF || [];
  var ACH_GROUPS = _SP.ACH_GROUPS || ['抽卡', '集卡', '种树', '目标', '专注', '历练'];

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

  /** 周重复·多选星期：每周/每 N 周的指定星期各出现一次，返回晚于 max(today, anchor) 的第一天 */
  function nextWeeklyMulti(anchor, weekdays, iv, today) {
    var base = DateUtil.diffDays(anchor, today) > 0 ? anchor : today;
    var origin = DateUtil.weekStart(anchor);   // 锚点所在周一，作为 N 周块的起点
    var blockLen = 7 * iv;
    var best = null;
    weekdays.forEach(function (w) {
      var off = (((w % 7) + 6) % 7);           // 周一=0 … 周日=6（相对 origin 的偏移）
      var firstInBlock = DateUtil.addDays(origin, off);
      var delta = DateUtil.diffDays(firstInBlock, base); // >0 表示 firstInBlock 晚于 base
      var k = delta >= 0 ? 0 : (Math.floor(-delta / blockLen) + 1);
      var cand = DateUtil.addDays(firstInBlock, k * blockLen);
      while (DateUtil.diffDays(cand, base) <= 0) cand = DateUtil.addDays(cand, blockLen);
      if (best === null || DateUtil.diffDays(cand, best) < 0) best = cand;
    });
    return best ? DateUtil.toStr(best) : null;
  }

  /**
   * 计算下一次应出现的日期（展开式：完成任务时生成这条）。
   * - repeat.type: none | daily | weekly | monthly | yearly
   * - **始终以原定日期为锚点往前推进**，跳过已经错过的期；若在原定日期前提前完成，则推进到原定日期之后的下一期（> max(today, anchor)）。
   * @returns YYYY-MM-DD 字符串；无下一期返回 null
   */
  function nextDueDate(dueDateStr, repeat, todayStr) {
    if (!repeat || repeat.type === 'none') return null;
    var anchor = DateUtil.parse(dueDateStr);
    if (!anchor) return null;
    var today = DateUtil.parse(todayStr || DateUtil.toStr(DateUtil.today()));
    if (!today) return null;
    var base = DateUtil.diffDays(anchor, today) > 0 ? anchor : today;
    var iv = Math.max(1, (repeat.interval | 0) || 1);

    // 日：每 iv 天一个，等差 O(1)
    if (repeat.type === 'daily') {
      var k = Math.floor(DateUtil.diffDays(base, anchor) / iv) + 1;
      if (k < 1) k = 1;
      return DateUtil.toStr(DateUtil.addDays(anchor, k * iv));
    }

    // 周：多选星期走专属逻辑；否则沿用「每 iv 周」的等差（周几由锚点日期决定）
    if (repeat.type === 'weekly') {
      if (repeat.weekdays && repeat.weekdays.length) {
        return nextWeeklyMulti(anchor, repeat.weekdays, iv, base);
      }
      var wk = Math.floor(DateUtil.diffDays(base, anchor) / (7 * iv)) + 1;
      if (wk < 1) wk = 1;
      return DateUtil.toStr(DateUtil.addDays(anchor, wk * 7 * iv));
    }

    if (repeat.type === 'monthly') {
      // 月末最后一天（j=0 即锚点当月：若晚于 base 就直接用它，若等于或早于 base 则推进到下一期）
      if (repeat.monthRule === 'lastday') {
        for (var i = 0; i <= 3000; i++) {
          var lm = DateUtil.addMonths(anchor, iv * i);
          var last = new Date(lm.getFullYear(), lm.getMonth() + 1, 0);
          if (DateUtil.diffDays(last, base) > 0) return DateUtil.toStr(last);
        }
        return null;
      }
      // 第 pos 个星期 wd（pos=-1 = 最后一个）
      if (repeat.monthRule === 'pos') {
        for (var j = 0; j <= 3000; j++) {
          var pm = DateUtil.addMonths(anchor, iv * j);
          var pd = nthWeekdayOfMonth(pm.getFullYear(), pm.getMonth(), repeat.pos, repeat.wd);
          if (pd && DateUtil.diffDays(pd, base) > 0) return DateUtil.toStr(pd);
        }
        return null;
      }
      // 默认：每月固定 day 号（沿用锚点日期的日，月末/闰年夹紧）
      for (var m = 1; m <= 3000; m++) {
        var cand = DateUtil.addMonths(anchor, iv * m);
        if (DateUtil.diffDays(cand, base) > 0) return DateUtil.toStr(cand);
      }
      return null;
    }

    // 年：每 iv 年（闰年 2/29 夹到 2/28）
    if (repeat.type === 'yearly') {
      for (var y = 1; y <= 3000; y++) {
        var cy = DateUtil.addYears(anchor, iv * y);
        if (DateUtil.diffDays(cy, base) > 0) return DateUtil.toStr(cy);
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
  var GOAL_GROUPS = [
    { key: 'study',   name: '学业进阶', icon: '📚', color: '#4f46e5' },
    { key: 'health',  name: '健康体魄', icon: '🏃', color: '#10b981' },
    { key: 'work',    name: '科研工作', icon: '💻', color: '#0ea5e9' },
    { key: 'life',    name: '生活习惯', icon: '🌱', color: '#f59e0b' },
    { key: 'finance', name: '财务储蓄', icon: '💰', color: '#ec4899' },
    { key: 'custom',  name: '自由探索', icon: '🎯', color: '#8b5cf6' }
  ];

  var KR_KINDS = [
    { key: 'plan', name: '挂计划', desc: '按这条计划在周期内的打卡进度算' },
    { key: 'task', name: '挂待办', desc: '按周期内相关待办的完成率算' },
    { key: 'focus', name: '专注·累计时长', desc: '按周期内番茄钟累计专注小时数算（可选限定课程）' },
    { key: 'grade', name: '学期 GPA', desc: '按本学期已出分课程的加权 GPA 算（未出分显示待出分）' },
    { key: 'sleep', name: '健康·睡眠达标', desc: '周期内睡眠达标的夜数（阈值见「健康」里的睡眠时长）' },
    { key: 'active', name: '健康·运动达标', desc: '周期内步数达标的日数（按「健康」里的步数目标）' },
    { key: 'workout', name: '健康·锻炼达标', desc: '周期内手环/运动累计锻炼时长（分钟）或锻炼次数（自动联动手环与象限）' },
    { key: 'diet', name: '健康·饮食达标', desc: '周期内每日饮食花费或热量不超上限的达标天数' },
    { key: 'weight', name: '健康·体重目标', desc: '从起始体重到目标体重的双向进度（支持减重或增肌，自动联动体重记录）' },
    { key: 'budget', name: '记账·周期支出控制', desc: '周期内总支出或指定分类支出控制在目标金额以内' },
    { key: 'manual', name: '自己填', desc: '出分、有结果后自己填一个数（支持设置起始值，如减重 104→94）' }
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

    /* 自己填：支持「0 -> target」常规正向，也支持「startVal -> target」双向进度（例如减重 104 -> 94） */
    if (kr.kind === 'manual') {
      var hasStart = kr.startVal !== undefined && kr.startVal !== null && kr.startVal !== '' && isFinite(Number(kr.startVal));
      var sVal = hasStart ? Number(kr.startVal) : 0;
      var t = hasStart ? (Number(kr.target) || 0) : Math.max(1, Number(kr.target) || 1);
      var v = kr.current !== undefined && kr.current !== null && kr.current !== '' ? Number(kr.current) : (hasStart ? sVal : 0);
      out.startVal = hasStart ? sVal : 0;
      out.value = v;
      out.target = t;
      out.unit = kr.unit || '';
      if (hasStart && sVal !== t) {
        var rawPct = sVal > t ? (sVal - v) / (sVal - t) : (v - sVal) / (t - sVal);
        out.pct = Math.max(0, Math.min(1, rawPct));
      } else {
        out.pct = Math.max(0, Math.min(1, v / Math.max(1, t)));
      }
      return out;
    }

    /* 健康·体重目标：支持减脂（startVal > target）或增重（startVal < target），自动读取最新体重 */
    if (kr.kind === 'weight') {
      var wTarget = Math.max(20, Number(kr.target) || 60);
      var wSeries = (Store.weightSeries ? Store.weightSeries() : []) || [];
      var wLatest = Store.latestWeight ? Store.latestWeight() : null;
      var wStart = (kr.startVal !== undefined && kr.startVal !== null && kr.startVal !== '' && Number(kr.startVal) > 0)
        ? Number(kr.startVal)
        : (wSeries.length ? Number(wSeries[0].kg) : (Number(kr.current) || wTarget));
      var wCur = wLatest != null ? Number(wLatest) : (Number(kr.current) || 0);
      out.startVal = wStart;
      out.target = wTarget;
      out.value = wCur || wStart;
      out.unit = kr.unit || 'kg';
      if (!wCur && wLatest == null && !(Number(kr.current) > 0)) {
        out.empty = true;
        out.pct = null;
        return out;
      }
      if (wStart && wStart !== wTarget) {
        var wp = wStart > wTarget ? (wStart - out.value) / (wStart - wTarget) : (out.value - wStart) / (wTarget - wStart);
        out.pct = Math.max(0, Math.min(1, wp));
      } else {
        out.pct = out.value <= wTarget ? 1 : Math.max(0, 1 - (out.value - wTarget) / wTarget);
      }
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
      // 额度型：按「周期达标数」算，而不是把打卡次数除以总周期数（口径完全不同）
      if (plan.type === 'quota') {
        var qn = Math.max(1, Number(plan.quotaN) || 1);
        var qtotal = Math.max(1, Number(plan.days) || 1);
        var qdone = 0;
        for (var qi = 0; qi < qtotal; qi++) {
          var qw = quotaWindowAt(plan, qi, DateUtil);
          if (qw.start > limit) break;
          if (qw.end < ctx.from) continue;
          if (quotaCountIn(plan, qw) >= qn) qdone++;
        }
        out.value = qdone;
        out.target = qtotal;
        out.unit = plan.unit || '周';
        out.pct = Math.max(0, Math.min(1, qdone / qtotal));
        return out;
      }
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

    /* 记账·周期支出控制：统计周期内总支出（或指定分类支出）是否控制在目标预算内 */
    if (kr.kind === 'budget') {
      var blim = ctx.today < ctx.to ? ctx.today : ctx.to;
      var bspent = 0, bcount = 0;
      var llist = (state && state.ledger) || [];
      llist.forEach(function (e) {
        if (!e || e.type !== 'expense' || !e.date) return;
        if (e.date < ctx.from || e.date > blim) return;
        if (kr.category && e.category !== kr.category) return;
        bspent += Number(e.amount) || 0;
        bcount++;
      });
      bspent = Math.round(bspent * 100) / 100;
      var btgt = Math.max(1, Number(kr.target) || 1000);
      out.target = btgt;
      out.value = bspent;
      out.unit = '元';
      if (bcount === 0) { out.empty = true; out.pct = null; return out; }
      out.pct = bspent <= btgt ? 1 : Math.max(0, 1 - (bspent - btgt) / btgt);
      return out;
    }

    /* 专注·累计时长：按周期内番茄钟会话累计小时数算（支持限定某门课） */
    if (kr.kind === 'focus') {
      var flim = ctx.today < ctx.to ? ctx.today : ctx.to;
      var fmin = 0;
      var sessions = (state && state.pomodoro && state.pomodoro.sessions) || [];
      sessions.forEach(function (s) {
        if (!s || !s.date) return;
        if (s.date < ctx.from || s.date > flim) return;
        if (kr.courseId) {
          var hitCourse = s.courseId === kr.courseId;
          if (!hitCourse && s.taskId) {
            var tk = Store.getTask(s.taskId);
            if (tk && tk.courseId === kr.courseId) hitCourse = true;
          }
          if (!hitCourse) return;
        }
        fmin += Number(s.minutes) || 0;
      });
      var fhours = Math.round((fmin / 60) * 10) / 10;
      out.target = Math.max(0.5, Number(kr.target) || 10);
      out.value = fhours;
      out.unit = '小时';
      out.pct = Math.max(0, Math.min(1, fhours / out.target));
      return out;
    }

    /* 健康·锻炼达标：统计周期内累计锻炼分钟数（默认）或锻炼次数（metric='count'），联动 workouts 与象限运动活动 */
    if (kr.kind === 'workout') {
      var wlim = ctx.today < ctx.to ? ctx.today : ctx.to;
      var wMode = kr.metric === 'count' ? 'count' : 'minutes';
      var wVal = 0, wHasAny = false;
      var wSeenAct = {};
      var wList = (state && state.workouts) || [];
      wList.forEach(function (w) {
        if (!w || !w.date || w.date < ctx.from || w.date > wlim) return;
        if (kr.sportType && w.type !== kr.sportType) return;
        wHasAny = true;
        if (w.activityId) wSeenAct[w.activityId] = 1;
        wVal += (wMode === 'count') ? 1 : (Number(w.duration) || 0);
      });
      // 同时纳入象限中直接记录的「运动」类活动（排除已由 workout 同步生成的避免双计）
      var aList = (state && state.activities) || [];
      aList.forEach(function (a) {
        if (!a || a.planned || a.type !== 'exercise' || !a.date) return;
        if (a.date < ctx.from || a.date > wlim) return;
        if (a.workoutId || wSeenAct[a.id]) return;
        if (kr.sportType) return;
        wHasAny = true;
        var dur = TimeUtil.diffMin(a.start, a.end);
        wVal += (wMode === 'count') ? 1 : dur;
      });
      out.target = Math.max(1, Number(kr.target) || (wMode === 'count' ? 12 : 300));
      out.value = Math.round(wVal);
      out.unit = wMode === 'count' ? '次' : '分钟';
      if (!wHasAny && wVal === 0) { out.empty = true; out.pct = null; return out; }
      out.pct = Math.max(0, Math.min(1, wVal / out.target));
      return out;
    }

    /* 健康·饮食达标：统计周期内有饮食记录且每日花费 ≤ costMax、热量 ≤ kcalMax 的达标天数 */
    if (kr.kind === 'diet') {
      var dlim = ctx.today < ctx.to ? ctx.today : ctx.to;
      var costMax = Number(kr.costMax) > 0 ? Number(kr.costMax) : 0;
      var kcalMax = Number(kr.kcalMax) > 0 ? Number(kr.kcalMax)
        : ((state && state.settings && state.settings.diet && Number(state.settings.diet.goal) > 0) ? Number(state.settings.diet.goal) : 0);
      var dd = DateUtil.parse(ctx.from), dend = DateUtil.parse(dlim);
      var dMet = 0, dRecordedDays = 0;
      while (dd && dend && dd <= dend) {
        var dds = DateUtil.toStr(dd);
        var msum = Store.mealSummary(dds);
        if (msum && msum.count > 0) {
          dRecordedDays++;
          var costOk = !(costMax > 0) || msum.cost <= costMax;
          var kcalOk = !(kcalMax > 0) || msum.kcal <= kcalMax;
          if (costOk && kcalOk) dMet++;
        }
        dd = DateUtil.addDays(dd, 1);
      }
      out.target = Math.max(1, Number(kr.target) || 14);
      out.value = dMet;
      out.unit = '天';
      if (dRecordedDays === 0) { out.empty = true; out.pct = null; return out; }
      out.pct = Math.max(0, Math.min(1, dMet / out.target));
      return out;
    }

    /* 健康·睡眠 / 运动达标：数「周期内满足条件的天数」，数据源是 dayHealth（睡眠 / 步数）。
       目标填「累计达标天数」即可，例如「每周运动≥3天」的 4 周目标就把目标设 12。 */
    if (kr.kind === 'sleep' || kr.kind === 'active') {
      var hlim = ctx.today < ctx.to ? ctx.today : ctx.to;
      var hd = DateUtil.parse(ctx.from), hend = DateUtil.parse(hlim);
      var met = 0, htotal = 0;
      while (hd && hend && hd <= hend) {
        var hds = DateUtil.toStr(hd);
        var hh = Store.dayHealth(hds);
        if (kr.kind === 'sleep') { if (hh.sleepMet) met++; }
        else if (hh.stepPct >= 100) { met++; }
        htotal++;
        hd = DateUtil.addDays(hd, 1);
      }
      out.target = Math.max(1, Number(kr.target) || 1);
      out.value = met;
      out.unit = '天';
      if (htotal === 0) { out.empty = true; out.pct = null; return out; }
      out.pct = Math.max(0, Math.min(1, met / out.target));
      return out;
    }

    /* 挂待办：周期内、符合标签/课程的顶层任务的完成率。
       子任务算在父任务身上（不重复计）；没有截止日期的历史任务不计入，
       否则越用越久，分母会一直变大，完成率永远上不去 */
    var tags = kr.tags || [];
    var list = (ctx.tasks || []).filter(function (task) {
      if (task.parentId) return false;
      if (task.krId && kr.id && task.krId === kr.id) return true;
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
                  startVal: r.startVal != null ? r.startVal : (kr.startVal != null ? kr.startVal : null),
                  value: r.value, target: r.target, unit: r.unit,
                  step: kr.step || 1, color: kr.color || '',
                  logs: kr.logs || [],
                  empty: r.empty, missing: r.missing });
      if (r.pct != null) { sum += r.pct; n++; }
    });
    return {
      pct: n ? Math.round(sum / n * 100) : 0,
      exactPct: n ? Math.round(sum / n * 1000) / 10 : 0,
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
      plans: state.plans || [], tasks: (state.tasks || []).concat(state.taskArchive || [])
    }).pct;
  }

  /** 目标对象的字段收口：缺的补、脏的丢，避免旧数据把页面搞崩 */
  function normGoal(raw) {
    var g = raw || {};
    var validGroups = { study: 1, health: 1, work: 1, life: 1, finance: 1, custom: 1 };
    var group = validGroups[g.group] ? g.group : 'study';
    var krs = (Array.isArray(g.krs) ? g.krs : []).map(function (k, i) {
      k = k || {};
      var validKinds = { plan: 1, task: 1, focus: 1, grade: 1, sleep: 1, active: 1, workout: 1, diet: 1, weight: 1, budget: 1, manual: 1 };
      var kind = validKinds[k.kind] ? k.kind : 'manual';
      var hasStart = k.startVal !== undefined && k.startVal !== null && k.startVal !== '' && isFinite(Number(k.startVal));
      // GPA 目标可以是 0~5 的小数，双向起点目标也可以设任意合理目标值
      var tgt = (kind === 'grade' || hasStart) ? Math.max(0, Number(k.target) || 0) : Math.max(1, Number(k.target) || 1);
      return {
        id: k.id || uid('kr'),
        title: String(k.title || '').slice(0, 60) || ('关键结果 ' + (i + 1)),
        kind: kind,
        planId: String(k.planId || ''),
        tags: Array.isArray(k.tags) ? k.tags.slice(0, 6) : [],
        courseId: String(k.courseId || ''),
        category: String(k.category || ''),
        sportType: String(k.sportType || ''),
        costMax: Math.max(0, Number(k.costMax) || 0),
        kcalMax: Math.max(0, Number(k.kcalMax) || 0),
        startVal: hasStart ? Number(k.startVal) : null,
        target: tgt,
        current: Math.max(0, Number(k.current) || 0),
        step: Math.max(0.1, Number(k.step) || 1),
        color: String(k.color || ''),
        unit: String(k.unit || (kind === 'weight' ? 'kg' : '')),
        metric: kind === 'grade' ? 'semesterGpa' : (kind === 'workout' ? (k.metric === 'count' ? 'count' : 'minutes') : ''),
        semesterId: kind === 'grade' ? String(k.semesterId || '') : '',
        logs: Array.isArray(k.logs) ? k.logs.slice(-100) : [],
        awarded: k.awarded || ''    // KR 达成奖励只发一次（归一化时要保留）
      };
    }).slice(0, 4);    // 最多 4 条：再多就没人看得完
    var today = DateUtil.toStr(DateUtil.today());
    return {
      id: g.id || uid('gl'),
      title: String(g.title || '').slice(0, 40) || '未命名目标',
      note: String(g.note || ''),
      group: group,
      period: g.period === 'term' ? 'term' : 'custom',
      startDate: g.startDate || today,
      endDate: g.endDate || today,
      krs: krs,
      archivedAt: g.archivedAt || '',
      rewardedAt: g.rewardedAt || '',   // 达成奖励只发一次
      createdAt: g.createdAt || new Date().toISOString()
    };
  }

  /**
   * 版本化结构迁移：只做「无法靠字段特征判断」的升级，逐级递进。
   * 字段补齐仍留在 ensure 里——两条路一起跑，导入任何来源的旧档都能兜住。
   */
  function migrateSchema(st) {
    if (!st || typeof st !== 'object') return st;
    var from = Number(st.version) || 1;
    if (from > SCHEMA_VERSION) return st;   // 更新版本的数据不在旧代码里强行降级
    if (from < 3) {
      // v3：手动排序 order 字段 + 专注队列 timer.queue（幂等）
      var mx = 0;
      (st.tasks || []).forEach(function (t) { if (typeof t.order === 'number' && t.order > mx) mx = t.order; });
      var seq = 1;
      (st.tasks || []).forEach(function (t) { if (typeof t.order !== 'number') t.order = mx + (seq++); });
      if (st.pomodoro && st.pomodoro.timer && !Array.isArray(st.pomodoro.timer.queue)) {
        st.pomodoro.timer.queue = [];
      }
    }
    st.version = SCHEMA_VERSION;
    return st;
  }


  /** 标准化单门课程的考试槽位（默认包含期中考试、期末考试，支持自定义扩展） */
  function buildCourseExamSlots(c) {
    var rawList = (c && Array.isArray(c.exams)) ? c.exams : [];
    var legacy = (c && c.exam && c.exam.date) ? c.exam : null;
    var mid = null, fin = null, customs = [];
    rawList.forEach(function (ex, idx) {
      if (!ex || typeof ex !== 'object') return;
      var item = {
        id: String(ex.id || ('ex_' + idx)),
        type: ex.type || (ex.label === '期中考试' ? 'midterm' : (ex.label === '期末考试' ? 'final' : 'custom')),
        label: String(ex.label || (idx === 0 ? '期中考试' : (idx === 1 ? '期末考试' : ('考试 ' + (idx + 1))))).trim(),
        date: String(ex.date || '').trim(),
        start: String(ex.start || '').trim(),
        end: String(ex.end || '').trim(),
        location: String(ex.location || '').trim()
      };
      if (!mid && (item.type === 'midterm' || item.label === '期中考试')) mid = item;
      else if (!fin && (item.type === 'final' || item.label === '期末考试')) fin = item;
      else customs.push(item);
    });
    if (!mid) {
      mid = { id: 'midterm', type: 'midterm', label: '期中考试', date: '', start: '', end: '', location: '' };
    }
    if (!fin) {
      fin = {
        id: 'final',
        type: 'final',
        label: (legacy && legacy.label) ? String(legacy.label) : '期末考试',
        date: legacy ? String(legacy.date || '') : '',
        start: legacy ? String(legacy.start || '') : '',
        end: legacy ? String(legacy.end || '') : '',
        location: legacy ? String(legacy.location || '') : ''
      };
    } else if (!fin.date && legacy && legacy.date && (!mid.date || mid.date !== legacy.date)) {
      fin.date = String(legacy.date || '');
      fin.start = String(legacy.start || '');
      fin.end = String(legacy.end || '');
      if (legacy.location) fin.location = String(legacy.location);
    }
    return [mid, fin].concat(customs);
  }

  function normCourseExamsInput(data, oldCourse) {
    if (data && Array.isArray(data.exams)) {
      var slots = buildCourseExamSlots({ exams: data.exams });
      return slots;
    }
    if (data && data.exam !== undefined) {
      var base = buildCourseExamSlots(oldCourse);
      if (data.exam && data.exam.date) {
        var targetLabel = data.exam.label || '期末考试';
        var hit = base.find(function (x) { return x.label === targetLabel || (targetLabel === '期末考试' && x.type === 'final') || (targetLabel === '期中考试' && x.type === 'midterm'); });
        if (hit) {
          hit.date = String(data.exam.date || '').trim();
          hit.start = String(data.exam.start || '').trim();
          hit.end = String(data.exam.end || '').trim();
          if (data.exam.location != null) hit.location = String(data.exam.location || '').trim();
        } else {
          base[1].date = String(data.exam.date || '').trim();
          base[1].start = String(data.exam.start || '').trim();
          base[1].end = String(data.exam.end || '').trim();
          if (data.exam.location != null) base[1].location = String(data.exam.location || '').trim();
        }
      } else if (data.exam === null) {
        base.forEach(function (x) { x.date = ''; x.start = ''; x.end = ''; });
      }
      return base;
    }
    return buildCourseExamSlots(oldCourse);
  }

  function extractValidExams(c) {
    if (!c) return [];
    var slots = buildCourseExamSlots(c);
    return slots.filter(function (ex) {
      return ex && ex.date && /^\d{4}-\d{2}-\d{2}$/.test(ex.date);
    }).sort(function (a, b) {
      var ta = (a.date || '') + ' ' + (a.start || '');
      var tb = (b.date || '') + ' ' + (b.start || '');
      return ta < tb ? -1 : (ta > tb ? 1 : 0);
    });
  }

  function pickPrimaryExam(examsList, explicitExam) {
    var valid = (Array.isArray(examsList) ? examsList : []).filter(function (ex) {
      return ex && ex.date && /^\d{4}-\d{2}-\d{2}$/.test(ex.date);
    });
    if (!valid.length) {
      if (explicitExam && explicitExam.date) {
        return {
          label: String(explicitExam.label || '期末考试'),
          date: String(explicitExam.date),
          start: String(explicitExam.start || ''),
          end: String(explicitExam.end || ''),
          location: String(explicitExam.location || '')
        };
      }
      return null;
    }
    var todayStr = DateUtil.toStr(DateUtil.today());
    var upcoming = valid.filter(function (ex) { return ex.date >= todayStr; }).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });
    var chosen = upcoming[0] || valid[valid.length - 1];
    return {
      id: chosen.id || 'final',
      label: chosen.label || '期末考试',
      date: chosen.date,
      start: chosen.start || '',
      end: chosen.end || '',
      location: chosen.location || ''
    };
  }

  /**
   * 等级制（五级制）成绩的默认换算表（静态目录在 store-presets.js）。
   * 分数只用于算加权均分，绩点单独给——「优/良/中/及格/不及格」不能编个假分数。
   */
  var GPA_LEVEL_RULES = _SP.GPA_LEVEL_RULES || [
    { key: 'A', name: '优', score: 95, gp: 4.0 },
    { key: 'B', name: '良', score: 85, gp: 3.5 },
    { key: 'C', name: '中', score: 75, gp: 2.5 },
    { key: 'D', name: '及格', score: 65, gp: 1.5 },
    { key: 'F', name: '不及格', score: 50, gp: 0 }
  ];

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
    get settings() { return state.settings; },
    get courses() { return state.courses; },
    get courseLogs() { return state.courseLogs || []; },
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
    get metrics() { return state.metrics; },
    get workouts() { return state.workouts || []; },
    WORKOUT_TYPES: WORKOUT_TYPES,
    workoutType: workoutType,
    get sleepSession() { return state.sleepSession || null; },

    init: async function () {
      // 诊断用：地址加 ?perf=1 时打印各阶段耗时（默认零开销）
      var __perf = (typeof location !== 'undefined' && /[?&]perf=1/.test(location.search || '') &&
        typeof performance !== 'undefined' && performance.now)
        ? function (label) { console.info('[store] ' + label + ' +' + Math.round(performance.now()) + 'ms'); }
        : function () {};
      __perf('init-start');
      // 检测 localStorage 是否可用（iframe / 隐私模式可能被禁用）
      try {
        localStorage.setItem('__cp_probe__', '1');
        localStorage.removeItem('__cp_probe__');
        this.storageOK = true;
      } catch (e) {
        this.storageOK = false;
      }

      var raw = null;
      var loadIssue = null;
      try {
        // 两份都读：IDB 写失败而 LS 写成功时，只读 IDB 会退回旧快照。
        var pair = await Persist.loadBoth(KEY);
        var pick = pickFresher(pair);
        raw = pick.raw;
        if (!raw && pair.degraded && pair.ls) raw = pair.ls;
      } catch (e) { raw = null; }
      __perf('state-loaded');
      if (raw) {
        try {
          state = JSON.parse(raw);
        } catch (e) {
          state = null;
          // 坏档先原样留一份，绝不直接覆盖。用户还能从「设置 → 数据管理」导出它。
          try {
            var keepKey = 'cp-corrupt-' + Date.now();
            await Persist.save(keepKey, raw);
            loadIssue = { type: 'corrupt', key: keepKey, bytes: raw.length };
          } catch (e2) {
            loadIssue = { type: 'corrupt', key: '', bytes: raw.length };
          }
          if (global.console && console.error) console.error('本地数据解析失败，已保留原始副本');
        }
      }
      if (!state || !state.version) state = defaultState();
      /** 加载异常（坏档 / 读库降级）。有值时启动流程不自动落盘，避免把现场冲掉。 */
      this.loadIssue = loadIssue;

      // 大图与冷存储外置：并行读取，避免串行等待拖慢二次启动
      try {
        var blobs = await Promise.all([
          Persist.load(BLOB_BG),
          Persist.load(BLOB_PET),
          Persist.load(KEY_ARCHIVE),
          Persist.load(KEY_LEDGER_ARCHIVE)
        ]);
        var bgBlob = blobs[0], petBlob = blobs[1], arcBlob = blobs[2], lgBlob = blobs[3];
        if (state.settings) {
          if (bgBlob && state.settings.background && !state.settings.background.dataUrl) state.settings.background.dataUrl = bgBlob;
          if (petBlob && state.settings.pet && !state.settings.pet.src) state.settings.pet.src = petBlob;
        }
        blobCache.bg = bgBlob || null;
        blobCache.pet = petBlob || null;
        if (arcBlob) {
          try {
            var arcList = JSON.parse(arcBlob);
            if (Array.isArray(arcList) && arcList.length > 0) {
              state.taskArchive = arcList;
              archiveCachedStr = arcBlob;
            }
          } catch (_) {}
        }
        if (lgBlob) {
          try {
            var lgList = JSON.parse(lgBlob);
            if (Array.isArray(lgList) && lgList.length > 0) {
              if (!Array.isArray(state.ledger)) state.ledger = [];
              var exIds = {};
              state.ledger.forEach(function (x) { if (x && x.id) exIds[x.id] = 1; });
              lgList.forEach(function (x) {
                if (x && x.id && !exIds[x.id]) state.ledger.push(x);
              });
              ledgerArchiveCachedStr = lgBlob;
            }
          } catch (_) {}
        }
      } catch (e) { /* 外置读取失败不影响主流程 */ }
      __perf('blobs-loaded');

      // 健康类记录冷藏：超过 24 个月的移出主状态，避免状态无限膨胀
      // （账目/任务早有类似机制，活动/三餐/睡眠/步数之前没有）
      try {
        var coldCutoff = DateUtil.toStr(DateUtil.addMonths(DateUtil.today(), -24));
        var cold = { activities: [], meals: [], sleeps: [], metrics: [] };
        var moved = 0;
        ['activities', 'meals', 'sleeps', 'metrics'].forEach(function (k) {
          var sp = splitOldRecords(state[k], coldCutoff);
          if (sp.cold.length) {
            state[k] = sp.hot;
            cold[k] = sp.cold;
            moved += sp.cold.length;
          }
        });
        if (moved && !this.loadIssue) {
          var oldRaw = await Persist.load(KEY_HEALTH_ARCHIVE);
          var oldObj = null;
          try { oldObj = oldRaw ? JSON.parse(oldRaw) : null; } catch (e) { oldObj = null; }
          if (!oldObj || typeof oldObj !== 'object') oldObj = {};
          ['activities', 'meals', 'sleeps', 'metrics'].forEach(function (k) {
            if (!Array.isArray(oldObj[k])) oldObj[k] = [];
            oldObj[k] = oldObj[k].concat(cold[k]);
          });
          await Persist.save(KEY_HEALTH_ARCHIVE, JSON.stringify(oldObj));
          if (typeof console !== 'undefined' && console.info) {
            console.info('[store] 已冷藏 ' + moved + ' 条 24 个月前的健康记录');
          }
        }
      } catch (e) { /* 冷藏失败不影响启动 */ }

      // 兼容补齐字段（日程 / 象限 / 记账 / 设置…）
      this.ensure();
      this.settleGoals();      // 上次关闭期间到期的目标，这里补结算
      __perf('ensure-settle');
      var self = this;
      // 坏档时先不落盘：等用户在提示条里选择「导出副本 / 用空数据继续」再写。
      // 正常情况也把首次落盘推到第一帧之后，别和首屏渲染抢主线程。
      if (!this.loadIssue) setTimeout(function () { self.save(); }, 80);
      // 页面要走了，把去抖中的保存立刻落盘
      if (!this._flushHooked && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        this._flushHooked = true;
        window.addEventListener('pagehide', function () { self.flushSave(); });
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') self.flushSave();
          });
        }
      }
      // 每日自动快照：跨天首次启动补一份；再往后挪一点，彻底避开首屏
      setTimeout(function () { self.maybeDailyBackup(); }, 1500);
      __perf('init-done');
      return state;
    },

    /** 补齐缺失字段：加载本地数据、导入备份后都会调用 */
    ensure: function () {
      if (!state) state = defaultState();
      // 「老档有没有这个字段」必须在 validateSchema 之前取样：
      // 那之后默认值会把缺的字段补齐，就分不清「老档没有」还是「用户真的是 false」。
      var hadHealthOn = !!(state && state.settings && state.settings.healthOn);
      migrateSchema(state);      // 版本升级：必须早于 validateSchema（否则默认值会盖掉旧结构）
      hoistLegacy(state);        // 旧值抢救：必须早于 validateSchema，否则旧值会被默认值覆盖、再也搬不动
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
      if (state.settings.pauseOnHoliday == null) state.settings.pauseOnHoliday = true;
      if (state.settings.statsOn == null) state.settings.statsOn = true;
      state.settings.statsWidgets = Object.assign(
        { time: true, curve: true, sources: true, spend: true, course: true, health: true }, state.settings.statsWidgets || {});
      state.settings.health = Object.assign(
        { on: true, sleepMinH: 6, kcalOver: true, activityMinH: 0 }, state.settings.health || {});
      if (!state.settings.nav) state.settings.nav = ds.settings.nav;
      if (!Array.isArray(state.settings.navOrder)) state.settings.navOrder = [];
      if (state.settings.navLayout !== 'classic' && state.settings.navLayout !== 'hub5') state.settings.navLayout = 'hub5';
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
      var psOpt = state.settings.pomoStrict || {};
      state.settings.pomoStrict = {
        enabled: !!psOpt.enabled,
        graceSec: Math.max(5, Math.min(120, parseInt(psOpt.graceSec, 10) || 15)),
        maxLeaves: Math.max(1, Math.min(10, parseInt(psOpt.maxLeaves, 10) || 2))
      };
      var ndOpt = state.settings.nightDiscipline || {};
      state.settings.nightDiscipline = {
        enabled: !!ndOpt.enabled,
        startTime: /^\d{2}:\d{2}$/.test(ndOpt.startTime || '') ? ndOpt.startTime : '23:00',
        endTime: /^\d{2}:\d{2}$/.test(ndOpt.endTime || '') ? ndOpt.endTime : '06:30',
        autoPopup: ndOpt.autoPopup !== false,
        strictForeground: ndOpt.strictForeground !== false,
        whiteNoise: !!ndOpt.whiteNoise,
        activeSession: (ndOpt.activeSession && typeof ndOpt.activeSession === 'object') ? ndOpt.activeSession : null,
        history: Array.isArray(ndOpt.history) ? ndOpt.history.slice(-60) : []
      };
      if (!state.pomodoro) state.pomodoro = ds.pomodoro;
      if (!state.pomodoro.trees) state.pomodoro.trees = [];
      if (!state.pomodoro.timer) state.pomodoro.timer = ds.pomodoro.timer;
      if (state.pomodoro.points == null) state.pomodoro.points = 0;
      if (state.pomodoro.jade == null) state.pomodoro.jade = 0;
      if (state.pomodoro.mode !== 'gacha' && state.pomodoro.mode !== 'academic') state.pomodoro.mode = 'forest';
      if (state.pomodoro.treesPlanted == null) state.pomodoro.treesPlanted = (state.pomodoro.trees || []).length;
      if (state.pomodoro.harvested == null) state.pomodoro.harvested = 0;
      if (!state.pomodoro.selectedSpecies) state.pomodoro.selectedSpecies = 'camphor';
      if (!state.pomodoro.timer.treeId) state.pomodoro.timer.treeId = '';
      migrateTrees(state.pomodoro.trees);      // 旧树 growth → 阶段模型
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
      migratePools(gc);                        // 单池 pity6 → 标准/中坚分池
      // shop 兜底必须放在取值之前：导入/恢复路径可能带着没有 shop 的对象进来
      if (!state.shop || typeof state.shop !== 'object') state.shop = {};
      var sh = state.shop;
      migrateShop(sh);                         // makeUp → 摸鱼券，旧使用记录改名
      // 限定井：登记目标 + 累计抽数（与 UP 井双计，但不叠加使用）
      if (!gc.limited || typeof gc.limited !== 'object') gc.limited = { target: '', count: 0 };
      if (gc.limited.target == null) gc.limited.target = '';
      if (gc.limited.count == null) gc.limited.count = 0;
      if (state.pomodoro.earned == null) state.pomodoro.earned = 0;
      if (!state.pomodoro.pointLog) state.pomodoro.pointLog = [];
      if (state.pomodoro.focusMinutes == null) state.pomodoro.focusMinutes = 0;
      if (!state.pomodoro.sessions) state.pomodoro.sessions = [];
      if (!state.plans) state.plans = [];
      // 计划的耗能档位 / 豁免日：老档没这两列，补上默认值（只补不覆盖）
      state.plans.forEach(function (p) {
        if (!p) return;
        if (p.load == null) p.load = '';
        if (!Array.isArray(p.exemptDays)) p.exemptDays = [];
      });
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
      // 每日活动量（健康联动 / 手动）：老档没有这个字段，补空数组，避免下游 filter 抛错
      if (!Array.isArray(state.metrics)) state.metrics = [];
      if (!Array.isArray(state.workouts)) state.workouts = [];
      if (state.settings.kcalGoal == null) state.settings.kcalGoal = 300;
      if (state.settings.workoutGoal == null) state.settings.workoutGoal = 30;
      if (typeof state.settings.syncWorkoutToQuadrant !== 'boolean') state.settings.syncWorkoutToQuadrant = true;
      if (typeof state.settings.autoPlanWorkout !== 'boolean') state.settings.autoPlanWorkout = true;
      if (typeof state.settings.autoPlanFocus !== 'boolean') state.settings.autoPlanFocus = true;
      if (typeof state.settings.autoPlanSleep !== 'boolean') state.settings.autoPlanSleep = true;
      if (typeof state.settings.autoPlanDiet !== 'boolean') state.settings.autoPlanDiet = true;
      if (typeof state.settings.autoPlanWordQuiz !== 'boolean') state.settings.autoPlanWordQuiz = true;
      if (!state.settings.quiz || typeof state.settings.quiz !== 'object') {
        state.settings.quiz = { right: 0, wrong: 0, goal: 5, todayDate: '', todayRight: 0, todayWords: [] };
      } else {
        state.settings.quiz.right = Math.max(0, parseInt(state.settings.quiz.right, 10) || 0);
        state.settings.quiz.wrong = Math.max(0, parseInt(state.settings.quiz.wrong, 10) || 0);
        state.settings.quiz.goal = Math.max(1, Math.min(100, parseInt(state.settings.quiz.goal, 10) || 5));
        state.settings.quiz.todayDate = String(state.settings.quiz.todayDate || '');
        state.settings.quiz.todayRight = Math.max(0, parseInt(state.settings.quiz.todayRight, 10) || 0);
        if (!Array.isArray(state.settings.quiz.todayWords)) state.settings.quiz.todayWords = [];
      }
      /* 健康看板总开关：老档没有这个字段。
         已经有健康数据（睡眠 / 活动量 / 体重 / 饮食）的老用户按「已开启 + 已问过」迁移，
         免得升级后入口凭空消失；其余人保持关闭，等新手教程结束问一次。 */
      if (!hadHealthOn) {
        var hasHealthData = (state.sleeps && state.sleeps.length) ||
                            (state.metrics && state.metrics.length) ||
                            (state.workouts && state.workouts.length) ||
                            (state.weightLog && state.weightLog.length) ||
                            (state.meals && state.meals.length);
        state.settings.healthOn = { enabled: !!hasHealthData, asked: !!hasHealthData };
      } else {
        var ho = state.settings.healthOn || {};
        state.settings.healthOn = {
          enabled: ho.enabled === true,
          asked: ho.asked === true
        };
      }
      // 体重与入睡时刻记录：老档补空数组
      if (!Array.isArray(state.weightLog)) state.weightLog = [];
      if (!Array.isArray(state.sleepOnsets)) state.sleepOnsets = [];
      // 旧档睡眠记录可能没有结构字段，补成 null，避免下游读到 undefined
      state.sleeps.forEach(function (s) {
        ['total', 'deep', 'light', 'rem', 'awake', 'efficiency', 'awakenings'].forEach(function (k) {
          if (s[k] === undefined) s[k] = null;
        });
        if (!s.source) s.source = 'manual';
      });
      // 进行中的睡眠计时：字段不全就丢弃，避免半截状态一直转下去
      if (state.sleepSession && (!state.sleepSession.date || !state.sleepSession.start ||
          typeof state.sleepSession.at !== 'number')) {
        state.sleepSession = null;
      }
      if (!state.courses) state.courses = [];
      if (!Array.isArray(state.courseLogs)) state.courseLogs = [];
      if (!Array.isArray(state.courseExceptions)) state.courseExceptions = [];
      if (!Array.isArray(state.tasks)) state.tasks = [];
      state.tasks = state.tasks.filter(function (t) { return t && typeof t === 'object'; });
      if (!Array.isArray(state.taskArchive)) state.taskArchive = [];
      state.taskArchive = state.taskArchive.filter(function (t) { return t && typeof t === 'object'; });
      // 旧任务补 order 字段（用于「待办手动排序」）：按当前最大值顺延，保证唯一
      (function () {
        var mx = 0, i = 1;
        state.tasks.forEach(function (t) { if (typeof t.order === 'number' && t.order > mx) mx = t.order; });
        state.tasks.forEach(function (t) { if (typeof t.order !== 'number') { t.order = mx + i; i++; } });
      })();
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

      migrateSemesters(state, ds);      // 单学期 → 学期列表
      migrateCourseSemester(state);     // 老课程补学期归属

      migrateCoursesV2(state);          // 同名多条课程 → 一门课 + 多时段 slots

      // 重复任务旧实例归档：每天最多跑一次，只搬「已完成 + 无关联 + 够老」的
      var _today = DateUtil.toStr(DateUtil.today());
      if (state.lastArchive !== _today) {
        archiveOldRepeats(state, _today);
        state.lastArchive = _today;
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

    /**
     * 保存。默认去抖 250ms：勾选待办、拖动排序这类高频操作不会每次都
     * 序列化整个 state 再写库。计时等关键状态传 true 立即落盘。
     */
    save: function (immediate) {
      if (immediate) return this.flushSave();
      if (saveTimer) return;
      var self = this;
      saveTimer = setTimeout(function () { saveTimer = null; self._saveNow(); }, 250);
    },

    /** 立刻把待写状态落盘（页面隐藏 / 计时操作 / 测试用） */
    flushSave: function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      return this._saveNow();
    },

    _saveNow: function () {
      var self = this;
      // 坏档保护：用户还没决定「导出副本 / 用空数据继续」之前，禁止任何路径落盘，
      // 否则首页的日常操作（签到、活跃度）会先把现场冲掉。
      if (this.loadIssue) return Promise.resolve();
      var bg = '', pet = '';
      try {
        if (state.settings && state.settings.background) bg = state.settings.background.dataUrl || '';
        if (state.settings && state.settings.pet) pet = state.settings.pet.src || '';
      } catch (e) {}

      // 冷归档数据隔离：不进高频主快照序列化，降低日常 I/O 阻塞
      var arcBackup = null;
      if (Array.isArray(state.taskArchive) && state.taskArchive.length > 0) {
        arcBackup = state.taskArchive;
        state.taskArchive = [];
      }

      // 记账数据冷热分层：超过 90 天的历史往期账目剥离至独立冷通道
      var ledgerCold = null;
      if (Array.isArray(state.ledger) && state.ledger.length > 30) {
        var baseDate = (DateUtil && DateUtil.today) ? DateUtil.today() : new Date();
        var cutoff = (DateUtil && DateUtil.addDays && DateUtil.toStr)
          ? DateUtil.toStr(DateUtil.addDays(baseDate, -90))
          : '';
        if (cutoff) {
          var hotLedger = [], coldLedger = [];
          state.ledger.forEach(function (lg) {
            if (lg && lg.date && lg.date < cutoff) coldLedger.push(lg);
            else hotLedger.push(lg);
          });
          if (coldLedger.length > 0) {
            ledgerCold = coldLedger;
            state.ledger = hotLedger;
          }
        }
      }

      // 大图不进主 state：临时清空 → 序列化 → 还原。主状态因此保持很小。
      var bgBackup = '', petBackup = '';
      if (state.settings && state.settings.background && bg) { bgBackup = bg; state.settings.background.dataUrl = ''; }
      if (state.settings && state.settings.pet && pet) { petBackup = pet; state.settings.pet.src = ''; }
      var str = '';
      // 落盘时间戳：主状态同时存在于 IDB 与 localStorage，启动时靠它判断哪份更新。
      if (state && typeof state === 'object') state.savedAt = Date.now();
      try { str = JSON.stringify(state); }
      catch (e) { console.warn('序列化失败', e); }
      finally {
        if (arcBackup) state.taskArchive = arcBackup;
        if (ledgerCold) state.ledger = state.ledger.concat(ledgerCold);
        if (state.settings && state.settings.background) state.settings.background.dataUrl = bgBackup;
        if (state.settings && state.settings.pet) state.settings.pet.src = petBackup;
      }
      if (!str) return Promise.resolve();

      // 先写大图、再写主状态；图被清空时同步删除，避免下次启动又被塞回来
      var chain = Promise.resolve();
      if (bg && bg !== blobCache.bg) {
        chain = chain.then(function () { return Persist.save(BLOB_BG, bg); }).then(function () { blobCache.bg = bg; });
      } else if (!bg && blobCache.bg) {
        chain = chain.then(function () { return Persist.remove(BLOB_BG); }).then(function () { blobCache.bg = null; });
      }
      if (pet && pet !== blobCache.pet) {
        chain = chain.then(function () { return Persist.save(BLOB_PET, pet); }).then(function () { blobCache.pet = pet; });
      } else if (!pet && blobCache.pet) {
        chain = chain.then(function () { return Persist.remove(BLOB_PET); }).then(function () { blobCache.pet = null; });
      }

      if (archiveDirty && arcBackup) {
        archiveDirty = false;
        var arcStr = JSON.stringify(arcBackup);
        if (arcStr !== archiveCachedStr) {
          archiveCachedStr = arcStr;
          chain = chain.then(function () { return Persist.save(KEY_ARCHIVE, arcStr); });
        }
      }
      if (ledgerCold) {
        var lgStr = JSON.stringify(ledgerCold);
        if (lgStr !== ledgerArchiveCachedStr) {
          ledgerArchiveCachedStr = lgStr;
          chain = chain.then(function () { return Persist.save(KEY_LEDGER_ARCHIVE, lgStr); });
        }
      } else if (!ledgerCold && ledgerArchiveCachedStr) {
        ledgerArchiveCachedStr = null;
        chain = chain.then(function () { return Persist.remove(KEY_LEDGER_ARCHIVE); });
      }
      return chain.then(function () { return Persist.save(KEY, str); }).catch(function (e) {
        console.warn('保存失败', e);
        if (!self.quotaWarned) {
          self.quotaWarned = true;
          if (global.UI && UI.toast) UI.toast('本地存储空间不足，建议换一张更小的背景图', 'err');
        }
      });
    },

    persist: Persist,

  /* ===== 记录开关 ===== */
    updateSettings: function (data) {
      Object.assign(state.settings, data);
      this.emit();
    },

    /* ===== 健康看板总开关 ===== */
    /** 健康看板是否开启（未开启时导航里不出现，自动同步也不跑） */
    healthEnabled: function () {
      return !!(state.settings && state.settings.healthOn && state.settings.healthOn.enabled);
    },
    /** 是否已经问过「要不要用健康看板」（装完只问一次） */
    healthAsked: function () {
      return !!(state.settings && state.settings.healthOn && state.settings.healthOn.asked);
    },
    /** 开/关健康看板；开关一次就算问过了 */
    setHealthOn: function (on) {
      this.updateSettings({ healthOn: { enabled: !!on, asked: true } });
    },
    /** 本机是否已有健康数据（用于设置页提示与首次询问的文案） */
    hasHealthData: function () {
      return !!((state.sleeps && state.sleeps.length) ||
                (state.metrics && state.metrics.length) ||
                            (state.workouts && state.workouts.length) ||
                (state.weightLog && state.weightLog.length) ||
                (state.meals && state.meals.length));
    },

    /* ===== 健康 → 待办：昨晚睡成什么样，今天就别硬扛 ===== */
    /**
     * 今天该不该扛重活——把昨晚睡眠翻成一句能照做的安排建议。
     *
     * 只给建议，**不动任何数据**：真正的「挪到明天」由用户点按钮后走 deferTaskTo，
     * 因为自动挪日期最招人烦——你不知道它为什么动，也不知道动了什么。
     *
     * 四档（阈值都从 nightStats 来，不引入新数据源）：
     *   low   睡不足 6h 或质量 < 0.5   —— 别扛高耗能，给出可挪的任务
     *   mild  不足 7h 或质量 < 0.62     —— 提醒一句，不给动作
     *   good  ≥ 7.5h 且质量 ≥ 0.7      —— 适合攻坚，指一个目标
     *   ok    其余                     —— 不打扰（UI 不渲染）
     * 没记录 → unknown；健康看板关着 → off。两种情况 UI 都静默。
     */
    /** 联动 F：检测最近连续 2 天日记是否均为疲惫 (tired) 或低落 (low) */
    hasConsecutiveLowMood: function (dateStr) {
      var baseD = DateUtil.parse(dateStr) || DateUtil.today();
      var d0 = DateUtil.toStr(baseD);
      var d1 = DateUtil.toStr(DateUtil.addDays(baseD, -1));
      var d2 = DateUtil.toStr(DateUtil.addDays(baseD, -2));
      var isCold = function (ds) {
        var entry = diaryOn(state.diaries, ds);
        return !!(entry && (entry.mood === 'tired' || entry.mood === 'low'));
      };
      return (isCold(d0) && isCold(d1)) || (isCold(d1) && isCold(d2));
    },

    /** 联动 E：生成某日「今日足迹」文本快照（供日记一键插入） */
    buildDayFootprint: function (dateStr) {
      var ds = dateStr || DateUtil.toStr(DateUtil.today());
      var lines = ['【📅 ' + ds + ' 今日足迹】'];
      var courses = this.coursesOnDate(ds);
      if (courses.length) {
        lines.push('📚 课程（' + courses.length + ' 节）：' + courses.map(function (c) { return c.name; }).join('、'));
      }
      var dayLogs = (state.courseLogs || []).filter(function (lg) { return lg && lg.date === ds; });
      if (dayLogs.length) {
        lines.push('📖 课堂所学：' + dayLogs.map(function (lg) {
          return '《' + (lg.courseName || '课程') + '》' + (lg.topic || (lg.learned || '').slice(0, 18));
        }).join('；'));
      }
      var sessions = ((state.pomodoro && state.pomodoro.sessions) || []).filter(function (s) { return s && s.date === ds; });
      var focusMin = sessions.reduce(function (sum, s) { return sum + (Number(s.minutes) || 0); }, 0);
      var doneTasks = (state.tasks || []).filter(function (t) {
        return t && t.status === 'done' && t.doneAt && t.doneAt.slice(0, 10) === ds;
      });
      if (focusMin > 0 || doneTasks.length > 0) {
        var studyBits = [];
        if (focusMin > 0) studyBits.push('番茄专注 ' + focusMin + ' 分钟（' + sessions.length + ' 次）');
        if (doneTasks.length > 0) studyBits.push('完成待办 ' + doneTasks.length + ' 项');
        lines.push('🍅 学习与待办：' + studyBits.join(' · '));
      }
      var dh = this.dayHealth ? this.dayHealth(ds) : null;
      if (dh && (dh.hasSleep || dh.steps > 0 || dh.workoutMin > 0)) {
        var hBits = [];
        if (dh.hasSleep && dh.sleepMin > 0) hBits.push('睡眠 ' + TimeUtil.humanMin(dh.sleepMin));
        if (dh.steps > 0) hBits.push('步数 ' + dh.steps + ' 步');
        if (dh.workoutMin > 0) hBits.push('锻炼 ' + dh.workoutMin + ' 分钟');
        if (dh.activeKcal > 0) hBits.push('活动消耗 ' + dh.activeKcal + ' kcal');
        lines.push('🏃 健康与运动：' + hBits.join(' · '));
      }
      var dayLedger = (state.ledger || []).filter(function (r) { return r && r.date === ds && r.type === 'expense'; });
      if (dayLedger.length) {
        var spent = dayLedger.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
        lines.push('💰 今日支出：¥' + (Math.round(spent * 100) / 100) + '（' + dayLedger.length + ' 笔）');
      }
      if (lines.length === 1) {
        lines.push('✨ 平静充实的一天，记录当下心情。');
      }
      return lines.join('\n');
    },

    bodyAdvice: function (dateStr) {
      var todayD = DateUtil.today();
      var today = dateStr || DateUtil.toStr(todayD);
      var moodFatigue = this.hasConsecutiveLowMood(today);
      var out = {
        has: false, level: 'off', date: today, total: 0, q: 0,
        shortMin: 0, needMin: 480, heavy: [], canDefer: false,
        moodFatigue: moodFatigue,
        dismissed: false, tomorrow: DateUtil.toStr(DateUtil.addDays(todayD, 1))
      };
      if (!this.healthEnabled()) return out;

      var st = this.nightStats(today);
      if (!st || !(st.total > 0)) {
        if (!moodFatigue) {
          out.level = 'unknown';
          return out;
        }
        st = { total: 0, q: 0.58 };
      }

      var SM = (typeof window !== 'undefined' && window.SleepModel) ||
               (typeof global !== 'undefined' && global.SleepModel) || null;
      var need = (SM && SM.CONST && SM.CONST.NEED_MIN) || 480;
      var total = st.total;
      var q = st.q == null ? 0.7 : st.q;

      var level = 'ok';
      if (total > 0) {
        if (total < 360 || q < 0.5) level = 'low';
        else if (total < 420 || q < 0.62) level = 'mild';
        else if (total >= 450 && q >= 0.7) level = 'good';
      }
      if (moodFatigue && (level === 'ok' || level === 'good')) {
        level = 'mild';
      }

      // 「今天到期 / 已逾期的高耗能任务」：口径与今日页一致（只看顶层、未完成）。
      // 带子任务的父任务不算——挪父任务而子任务留在今天会让两边对不上。
      var hasChild = {};
      (state.tasks || []).forEach(function (t) { if (t && t.parentId) hasChild[t.parentId] = 1; });
      var heavy = (state.tasks || []).filter(function (t) {
        return t && !t.parentId && t.status !== 'done' && t.status !== 'archived' &&
               !hasChild[t.id] && t.energy === 'high' && (!t.dueDate || t.dueDate <= today);
      });
      var rank = { high: 0, normal: 1, low: 2 };
      heavy.sort(function (a, b) {
        var ra = rank[a.priority] == null ? 1 : rank[a.priority];
        var rb = rank[b.priority] == null ? 1 : rank[b.priority];
        if (ra !== rb) return ra - rb;
        return String(a.dueDate || '~') < String(b.dueDate || '~') ? -1 : 1;
      });

      out.has = true;
      out.level = level;
      out.total = total;
      out.q = Math.round(q * 100) / 100;
      out.shortMin = Math.max(0, need - total);
      out.heavy = heavy.slice(0, 3);
      out.canDefer = level === 'low' && out.heavy.length > 0;
      out.dismissed = !!(state.settings && state.settings.bodyTipDay === today);
      return out;
    },

    /** 关掉今天的身体状态建议（每天可以关一次，明天照常提醒） */
    dismissBodyTip: function (dateStr) {
      var d = dateStr || DateUtil.toStr(DateUtil.today());
      if (!state.settings) state.settings = {};
      state.settings.bodyTipDay = d;
      this.save();
      this.emit();
    },

    /**
     * 把一条待办往后挪（默认明天）。只改截止日与截止时间，其余字段不动。
     * 记一笔 deferredCount，方便以后做「这条总被推迟」的提醒。
     */
    deferTaskTo: function (id, dateStr) {
      var t = this.getTask(id);
      if (!t) return null;
      t.dueDate = dateStr || DateUtil.toStr(DateUtil.addDays(DateUtil.today(), 1));
      t.dueTime = '';
      t.deferredCount = (Number(t.deferredCount) || 0) + 1;
      this.save();
      this.emit();
      return t;
    },

    /** 建议 1：将全部已逾期未完成待办一键顺延到今天（或指定日期），返回可撤销快照 */
    deferOverdueTasksToToday: function (targetDateStr) {
      var todayStr = targetDateStr || DateUtil.toStr(DateUtil.today());
      var nowHM = DateUtil.nowHM();
      var prevDates = [];
      (state.tasks || []).forEach(function (t) {
        if (!t || t.status === 'done' || !t.dueDate) return;
        var isPastDate = t.dueDate < todayStr;
        var isTodayTimeout = (t.dueDate === todayStr && t.dueTime && t.dueTime < nowHM);
        if (isPastDate || isTodayTimeout) {
          prevDates.push({
            id: t.id,
            dueDate: t.dueDate,
            dueTime: t.dueTime || '',
            deferredCount: Number(t.deferredCount) || 0
          });
          t.dueDate = todayStr;
          if (t.dueTime && t.dueTime < nowHM) {
            t.dueTime = '23:59';
          }
          t.deferredCount = (Number(t.deferredCount) || 0) + 1;
        }
      });
      if (prevDates.length) {
        this.save();
        this.emit();
      }
      return {
        count: prevDates.length,
        targetDate: todayStr,
        prevDates: prevDates
      };
    },

    /** 撤销批量顺延逾期任务 */
    restoreTaskDueDates: function (prevDates) {
      if (!Array.isArray(prevDates) || !prevDates.length) return 0;
      var map = {};
      prevDates.forEach(function (item) {
        if (item && item.id) map[item.id] = item;
      });
      var restored = 0;
      (state.tasks || []).forEach(function (t) {
        if (t && map[t.id]) {
          t.dueDate = map[t.id].dueDate;
          if (map[t.id].dueTime !== undefined) t.dueTime = map[t.id].dueTime;
          t.deferredCount = map[t.id].deferredCount;
          restored++;
        }
      });
      if (restored > 0) {
        this.save();
        this.emit();
      }
      return restored;
    },

    /* ===== 联动 1：每日一词拼写小测验 × 英语/词汇计划自动打卡（词数可由用户自定义） ===== */
    getWordQuizGoal: function () {
      var q = (state.settings && state.settings.quiz) || {};
      return Math.max(1, Math.min(100, parseInt(q.goal, 10) || 5));
    },

    setWordQuizGoal: function (n) {
      if (!state.settings.quiz || typeof state.settings.quiz !== 'object') {
        state.settings.quiz = { right: 0, wrong: 0, goal: 5, todayDate: '', todayRight: 0, todayWords: [] };
      }
      var goal = Math.max(1, Math.min(100, parseInt(n, 10) || 5));
      state.settings.quiz.goal = goal;
      var todayStr = DateUtil.toStr(DateUtil.today());
      if (state.settings.quiz.todayDate === todayStr && (state.settings.quiz.todayRight || 0) >= goal) {
        this.syncWordQuizToPlans(todayStr, state.settings.quiz.todayRight, goal);
      }
      this.save();
      this.emit();
      return goal;
    },

    recordWordQuizResult: function (wordStr, isCorrect, dateStr) {
      if (!state.settings.quiz || typeof state.settings.quiz !== 'object') {
        state.settings.quiz = { right: 0, wrong: 0, goal: 5, todayDate: '', todayRight: 0, todayWords: [] };
      }
      var q = state.settings.quiz;
      var dStr = dateStr || DateUtil.toStr(DateUtil.today());
      if (q.todayDate !== dStr) {
        q.todayDate = dStr;
        q.todayRight = 0;
        q.todayWords = [];
      }
      if (!Array.isArray(q.todayWords)) q.todayWords = [];
      var goal = Math.max(1, Math.min(100, parseInt(q.goal, 10) || 5));
      q.goal = goal;
      var synced = [];
      if (isCorrect) {
        q.right = (Number(q.right) || 0) + 1;
        q.todayRight = (Number(q.todayRight) || 0) + 1;
        var wClean = String(wordStr || '').trim();
        if (wClean && q.todayWords.indexOf(wClean) < 0) q.todayWords.push(wClean);
        if (!state.settings || state.settings.autoPlanWordQuiz !== false) {
          synced = this.syncWordQuizToPlans(dStr, q.todayRight, goal, wClean);
        }
      } else {
        q.wrong = (Number(q.wrong) || 0) + 1;
      }
      this.save();
      this.emit();
      return {
        right: q.right,
        wrong: q.wrong,
        todayRight: q.todayRight,
        goal: goal,
        reached: q.todayRight >= goal,
        syncedPlans: synced
      };
    },

    syncWordQuizToPlans: function (dateStr, todayRight, goal, wordStr) {
      if (!Array.isArray(state.plans) || !state.plans.length) return [];
      var self = this;
      var dStr = dateStr || DateUtil.toStr(DateUtil.today());
      var targetGoal = Math.max(1, parseInt(goal, 10) || this.getWordQuizGoal());
      var count = Math.max(0, parseInt(todayRight, 10) || 0);
      var wordRe = /单词|背词|词汇|英语|四级|六级|专四|专八|雅思|托福|考研英语|vocab|word/i;
      var synced = [];

      state.plans.forEach(function (p) {
        if (!p || p.done) return;
        if (p.startDate && dStr < p.startDate) return;
        var title = String(p.title || '');
        var pTags = Array.isArray(p.tags) ? p.tags : [];
        var hit = wordRe.test(title) || pTags.some(function (t) { return wordRe.test(t); });
        if (!hit) return;

        if (!Array.isArray(p.records)) p.records = [];
        if (isCheckinLike(p)) {
          if (count < targetGoal) return;
          var hasRec = p.records.some(function (r) { return r && r.date === dStr; });
          if (hasRec) return;
          p.records.push({
            date: dStr,
            value: 1,
            note: '拼写小测验达标 (' + count + '/' + targetGoal + '词)',
            source: 'wordQuiz',
            at: new Date().toISOString()
          });
          if (Array.isArray(p.exemptDays)) {
            p.exemptDays = p.exemptDays.filter(function (d) { return d !== dStr; });
          }
        } else if (p.type === 'progress') {
          var unit = String(p.unit || '');
          if (/词|个|题/.test(unit)) {
            if (!wordStr) return;
            var alreadyWord = p.records.some(function (r) {
              return r && r.date === dStr && r.source === 'wordQuiz' && r.word === wordStr;
            });
            if (alreadyWord) return;
            p.records.push({
              date: dStr,
              value: 1,
              word: wordStr,
              note: '测验掌握单词：' + wordStr,
              source: 'wordQuiz',
              at: new Date().toISOString()
            });
          } else {
            if (count < targetGoal) return;
            var hasDayProg = p.records.some(function (r) { return r && r.date === dStr && r.source === 'wordQuiz'; });
            if (hasDayProg) return;
            p.records.push({
              date: dStr,
              value: 1,
              note: '拼写小测验达标 (' + count + '/' + targetGoal + '词)',
              source: 'wordQuiz',
              at: new Date().toISOString()
            });
          }
        } else {
          return;
        }
        var wasDone = p.done;
        self.refreshPlanDone(p);
        var gain = POMO.PLAN_CHECKIN + ((!wasDone && p.done) ? POMO.PLAN_DONE : 0);
        if (gain > 0) self.addPoints(gain, 'plan', dStr);
        synced.push(p.title);
      });
      this.lastSyncedWordPlans = synced;
      if (synced.length) this.settleKRs();
      return synced;
    },

    /* ===== 联动 2：课程 × 课堂灵感笔记快速关联 ===== */
    notesOfCourse: function (courseIdOrName) {
      var c = this.getCourse(courseIdOrName);
      var cName = c ? c.name : String(courseIdOrName || '').trim();
      if (!cName) return [];
      return (state.notes || []).filter(function (n) {
        if (!n) return false;
        var tags = Array.isArray(n.tags) ? n.tags : [];
        if (tags.indexOf(cName) >= 0) return true;
        var txt = String(n.content || '');
        return txt.indexOf('#' + cName) >= 0 || txt.indexOf('《' + cName + '》') >= 0;
      });
    },

    addCourseNote: function (courseIdOrName, content, extraTags) {
      var c = this.getCourse(courseIdOrName);
      var cName = c ? c.name : String(courseIdOrName || '').trim();
      var txt = String(content || '').trim();
      if (!txt) return null;
      var tags = [];
      if (cName) tags.push(cName);
      tags.push('课堂笔记');
      if (Array.isArray(extraTags)) {
        extraTags.forEach(function (t) { if (t && tags.indexOf(t) < 0) tags.push(t); });
      }
      return this.addNote({ content: txt, tags: tags });
    },

    /* ===== 课堂所学记录（学了什么 / 章节进度 / 掌握度 / 复盘转待办） ===== */
    COURSE_MASTERY: [
      { key: 'mastered', name: '已吃透', icon: '🟢', color: '#10b981' },
      { key: 'normal',   name: '基本掌握', icon: '🔵', color: '#3b82f6' },
      { key: 'review',   name: '需重点复习', icon: '🟠', color: '#f59e0b' }
    ],

    masteryMeta: function (key) {
      var list = this.COURSE_MASTERY;
      for (var i = 0; i < list.length; i++) {
        if (list[i].key === key) return list[i];
      }
      return list[1];
    },

    courseLogsOfCourse: function (courseId, semesterId) {
      if (!Array.isArray(state.courseLogs)) state.courseLogs = [];
      var sid = semesterId || state.currentSemesterId;
      var c = courseId ? this.getCourse(courseId) : null;
      var cName = c ? c.name : '';
      return state.courseLogs.filter(function (item) {
        if (!item) return false;
        if (courseId) {
          if (item.courseId === courseId) return true;
          if (cName && item.courseName === cName && (!item.semesterId || item.semesterId === sid)) return true;
          return false;
        }
        return !item.semesterId || !sid || item.semesterId === sid;
      }).slice().sort(function (a, b) {
        var da = String(a.date || ''), db = String(b.date || '');
        if (da !== db) return da > db ? -1 : 1;
        var wa = Number(a.week) || 0, wb = Number(b.week) || 0;
        if (wa !== wb) return wb - wa;
        return String(b.createdAt || '') > String(a.createdAt || '') ? 1 : -1;
      });
    },

    courseLogsOfSlot: function (courseId, weekNo, day) {
      var list = this.courseLogsOfCourse(courseId);
      var w = Number(weekNo) || 0;
      var d = Number(day) || 0;
      return list.filter(function (item) {
        if (w && Number(item.week) !== w) return false;
        if (d && Number(item.day) && Number(item.day) !== d) return false;
        return true;
      });
    },

    courseLearningStats: function (courseId, semesterId) {
      var logs = this.courseLogsOfCourse(courseId, semesterId);
      var mastered = 0, normal = 0, review = 0;
      var weekMap = {};
      var courseMap = {};
      logs.forEach(function (l) {
        if (l.mastery === 'mastered') mastered++;
        else if (l.mastery === 'review') review++;
        else normal++;
        if (l.week) weekMap[l.week] = 1;
        if (l.courseId || l.courseName) courseMap[l.courseId || l.courseName] = 1;
      });
      return {
        total: logs.length,
        mastered: mastered,
        normal: normal,
        review: review,
        coveredWeeks: Object.keys(weekMap).length,
        coveredCourses: Object.keys(courseMap).length,
        latest: logs[0] || null,
        logs: logs
      };
    },

    getCourseLog: function (id) {
      if (!Array.isArray(state.courseLogs)) return null;
      for (var i = 0; i < state.courseLogs.length; i++) {
        if (state.courseLogs[i] && state.courseLogs[i].id === id) return state.courseLogs[i];
      }
      return null;
    },

    addCourseLog: function (data) {
      data = data || {};
      if (!Array.isArray(state.courseLogs)) state.courseLogs = [];
      var c = data.courseId ? this.getCourse(data.courseId) : null;
      var courseName = (c && c.name) || String(data.courseName || '').trim();
      var topic = String(data.topic || '').trim();
      var learned = String(data.learned || '').trim();
      var keyPoints = String(data.keyPoints || '').trim();
      if (!topic && !learned) return null;

      var todayStr = DateUtil.toStr(DateUtil.today());
      var dateStr = String(data.date || todayStr).trim() || todayStr;
      var dt = DateUtil.parse(dateStr) || DateUtil.today();
      var weekNo = Math.max(1, parseInt(data.week, 10) || this.weekOf(dt) || this.currentWeek() || 1);
      var dayNo = Math.max(1, Math.min(7, parseInt(data.day, 10) || DateUtil.isoDow(dt) || 1));
      var mastery = ['mastered', 'normal', 'review'].indexOf(data.mastery) >= 0 ? data.mastery : 'normal';

      var rec = {
        id: uid('clog'),
        courseId: c ? c.id : String(data.courseId || ''),
        courseName: courseName || '通用课程',
        semesterId: (c && c.semesterId) || data.semesterId || state.currentSemesterId || '',
        date: dateStr,
        week: weekNo,
        day: dayNo,
        periodText: String(data.periodText || '').trim(),
        topic: topic || (learned.split(/\r?\n/)[0] || '').slice(0, 36),
        learned: learned,
        keyPoints: keyPoints,
        mastery: mastery,
        taskId: String(data.taskId || ''),
        noteId: String(data.noteId || ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.courseLogs.unshift(rec);

      if (data.syncToNotes) {
        var noteText = '【第' + rec.week + '周 · ' + rec.topic + '】\n' +
          (rec.learned ? rec.learned : '') +
          (rec.keyPoints ? '\n⚠️ 课后重难点：' + rec.keyPoints : '');
        var n = this.addCourseNote(rec.courseId || rec.courseName, noteText, ['课堂所学', '第' + rec.week + '周']);
        if (n && n.id) rec.noteId = n.id;
      }

      if (data.createReviewTask) {
        var t = this.convertCourseLogToTask(rec.id, { silent: true, dueDate: data.reviewDueDate });
        if (t && t.id) rec.taskId = t.id;
      }

      if (this.bumpUsage) this.bumpUsage('course_log');
      this.emit();
      return rec;
    },

    updateCourseLog: function (id, patch) {
      patch = patch || {};
      var rec = this.getCourseLog(id);
      if (!rec) return null;
      if (patch.courseId !== undefined) {
        var c = patch.courseId ? this.getCourse(patch.courseId) : null;
        rec.courseId = c ? c.id : String(patch.courseId || '');
        if (c && c.name) rec.courseName = c.name;
      }
      if (patch.courseName !== undefined) rec.courseName = String(patch.courseName || '').trim() || rec.courseName;
      if (patch.date !== undefined) rec.date = String(patch.date || '').trim() || rec.date;
      if (patch.week !== undefined) rec.week = Math.max(1, parseInt(patch.week, 10) || rec.week || 1);
      if (patch.day !== undefined) rec.day = Math.max(1, Math.min(7, parseInt(patch.day, 10) || rec.day || 1));
      if (patch.periodText !== undefined) rec.periodText = String(patch.periodText || '').trim();
      if (patch.topic !== undefined) rec.topic = String(patch.topic || '').trim();
      if (patch.learned !== undefined) rec.learned = String(patch.learned || '').trim();
      if (patch.keyPoints !== undefined) rec.keyPoints = String(patch.keyPoints || '').trim();
      if (patch.mastery !== undefined && ['mastered', 'normal', 'review'].indexOf(patch.mastery) >= 0) {
        rec.mastery = patch.mastery;
      }
      if (patch.taskId !== undefined) rec.taskId = String(patch.taskId || '');
      rec.updatedAt = new Date().toISOString();
      this.emit();
      return rec;
    },

    removeCourseLog: function (id) {
      if (!Array.isArray(state.courseLogs)) return;
      state.courseLogs = state.courseLogs.filter(function (x) { return x && x.id !== id; });
      this.emit();
    },

    convertCourseLogToTask: function (logId, opts) {
      opts = opts || {};
      var rec = this.getCourseLog(logId);
      if (!rec) return null;
      var baseDate = DateUtil.parse(rec.date) || DateUtil.today();
      var dueStr = opts.dueDate || DateUtil.toStr(DateUtil.addDays(baseDate, rec.mastery === 'review' ? 1 : 3));
      var title = '巩固《' + rec.courseName + '》：' + (rec.topic || rec.learned.slice(0, 20));
      var noteParts = [];
      if (rec.learned) noteParts.push('📖 课堂所学：' + rec.learned);
      if (rec.keyPoints) noteParts.push('⚠️ 重难点待消化：' + rec.keyPoints);
      var task = this.addTask({
        title: title,
        courseId: rec.courseId || '',
        dueDate: dueStr,
        priority: rec.mastery === 'review' ? 'high' : 'normal',
        important: rec.mastery === 'review',
        energy: rec.mastery === 'review' ? 'high' : 'normal',
        examStage: 'round1',
        tags: [rec.courseName, '课堂复盘'],
        note: noteParts.join('\n')
      });
      if (task && task.id) {
        rec.taskId = task.id;
        this.save();
      }
      return task;
    },

    /* ===== 联动 4 & 6b：考试倒计时一键生成考前复习计划 & 纪念日一键生成准备待办 ===== */
    createExamStudyPlan: function (courseId, opts) {
      opts = opts || {};
      var c = this.getCourse(courseId);
      if (!c) return null;
      var todayStr = opts.today || DateUtil.toStr(DateUtil.today());
      var exList = extractValidExams(c);
      var upcomingEx = exList.filter(function (x) { return x.date >= todayStr; })[0] || exList[0] || c.exam || null;
      var examDate = opts.examDate || (upcomingEx && upcomingEx.date) || (c.exam && c.exam.date) || '';
      var daysLeft = examDate ? DateUtil.diffDays(DateUtil.parse(examDate), DateUtil.parse(todayStr)) : 14;
      var planDays = Math.max(3, Math.min(60, daysLeft > 0 ? daysLeft : 14));
      var planTitle = '备考复习：' + c.name;

      var existingPlan = (state.plans || []).find(function (p) {
        return p && !p.done && (p.title === planTitle || (p.title.indexOf(c.name) >= 0 && /复习|备考/.test(p.title)));
      });
      var plan = existingPlan || this.addPlan({
        title: planTitle,
        type: opts.planType || 'checkin',
        period: 'daily',
        startDate: todayStr,
        days: planDays,
        tags: [c.name, '复习', '备考'],
        color: c.color || '#4f46e5',
        important: true,
        load: 'high',
        note: examDate ? ('距离考试日（' + examDate + '）冲刺复习计划') : '课程备考复习计划'
      });

      var stages = [
        { stage: 'round1', title: '一轮复习：梳理《' + c.name + '》核心章节与笔记', ratio: 0.35 },
        { stage: 'papers', title: '二轮刷题：完成《' + c.name + '》真题与课后重点习题', ratio: 0.75 },
        { stage: 'sprint', title: '考前冲刺：《' + c.name + '》错题复盘与公式速记', ratio: 0.95 }
      ];
      var createdTasks = [];
      var self = this;
      if (opts.withTasks !== false) {
        stages.forEach(function (st) {
          var exists = (state.tasks || []).some(function (t) {
            return t && t.courseId === c.id && t.examStage === st.stage && t.status !== 'done';
          });
          if (exists) return;
          var offset = Math.max(0, Math.round(planDays * st.ratio) - 1);
          var due = DateUtil.toStr(DateUtil.addDays(DateUtil.parse(todayStr), offset));
          var tk = self.addTask({
            title: st.title,
            courseId: c.id,
            dueDate: due,
            priority: 'high',
            energy: 'high',
            examStage: st.stage,
            important: st.stage === 'sprint',
            tags: [c.name, '复习']
          });
          if (tk) createdTasks.push(tk);
        });
      }
      return {
        plan: plan,
        existed: !!existingPlan,
        tasksCreated: createdTasks.length,
        tasks: createdTasks
      };
    },

    createAnnivPrepTask: function (eventIdOrObj, todayStr) {
      var ev = typeof eventIdOrObj === 'string' ? this.getEvent(eventIdOrObj) : eventIdOrObj;
      if (!ev) return null;
      var tStr = todayStr || DateUtil.toStr(DateUtil.today());
      var info = this.annivNext(ev, tStr);
      var targetDate = info ? info.next : (ev.date || tStr);
      var due = tStr;
      if (targetDate > tStr) {
        var dObj = DateUtil.parse(targetDate);
        if (dObj) {
          var prevD = DateUtil.toStr(DateUtil.addDays(dObj, -1));
          due = prevD >= tStr ? prevD : tStr;
        }
      }
      var title = '准备「' + ev.title + '」事项/礼物';
      var existing = (state.tasks || []).find(function (t) {
        return t && t.status !== 'done' && t.title === title;
      });
      if (existing) return existing;
      return this.addTask({
        title: title,
        dueDate: due,
        priority: 'high',
        important: true,
        tags: ['纪念日', '准备'],
        note: '纪念日/倒数日：' + ev.title + '（' + targetDate + '）'
      });
    },

    /* ===== 联动 8：收藏诗词/单词一键引用到今日日记 & 番茄钟专注伴读 ===== */
    appendQuoteToDiary: function (quoteText, dateStr) {
      var clean = String(quoteText || '').trim();
      if (!clean) return null;
      var dStr = dateStr || DateUtil.toStr(DateUtil.today());
      var formatted = clean.indexOf('>') === 0 ? clean : ('> ' + clean);
      var exist = this.diaryOf(dStr);
      var nextContent = exist && exist.content && exist.content.trim()
        ? (exist.content.replace(/\s+$/, '') + '\n\n' + formatted)
        : formatted;
      return this.saveDiary({
        date: dStr,
        content: nextContent,
        mood: exist ? exist.mood : ''
      });
    },

    pickCompanionQuote: function () {
      if (!global.Daily && typeof global.__cpLoadDaily === 'function') global.__cpLoadDaily();
      var poems = this.favPoems();
      var words = this.favWords();
      var pool = [];
      poems.forEach(function (x) {
        var p = x.item;
        if (!p) return;
        var src = (p.d ? p.d + ' · ' : '') + p.a + (String(p.a).indexOf('《') === 0 ? '' : '《' + p.t + '》');
        pool.push({
          kind: 'poem',
          fav: true,
          main: p.ex,
          sub: src,
          quote: '「' + p.ex + '」—— ' + src
        });
      });
      words.forEach(function (x) {
        var w = x.item;
        if (!w || !w.w) return;
        pool.push({
          kind: 'word',
          fav: true,
          main: w.w + (w.ph ? '  ' + w.ph : '') + (w.pos ? ' [' + w.pos + ']' : ''),
          sub: w.def || '',
          quote: '📖 ' + w.w + (w.pos ? ' (' + w.pos + ') ' : ' ') + (w.def || '')
        });
      });
      if (!pool.length && global.Daily) {
        var dp = Daily.poem && Daily.poem();
        if (dp) {
          var dSrc = (dp.d ? dp.d + ' · ' : '') + dp.a + (String(dp.a).indexOf('《') === 0 ? '' : '《' + dp.t + '》');
          pool.push({
            kind: 'poem',
            fav: false,
            main: dp.ex,
            sub: dSrc,
            quote: '「' + dp.ex + '」—— ' + dSrc
          });
        }
        var dw = Daily.word && Daily.word();
        if (dw) {
          pool.push({
            kind: 'word',
            fav: false,
            main: dw.w + (dw.ph ? '  ' + dw.ph : '') + (dw.pos ? ' [' + dw.pos + ']' : ''),
            sub: dw.def || '',
            quote: '📖 ' + dw.w + (dw.pos ? ' (' + dw.pos + ') ' : ' ') + (dw.def || '')
          });
        }
      }
      if (!pool.length) return null;
      var idx = Math.floor(Math.random() * pool.length);
      return pool[idx];
    },

    /* ===== 建议 2：计算单日/本周空闲时间段并一键生成文本 ===== */
    calcDayFreeSlots: function (dateStr, opts) {
      opts = opts || {};
      var dayStart = opts.startMin != null ? Number(opts.startMin) : 8 * 60;   // 默认 08:00
      var dayEnd = opts.endMin != null ? Number(opts.endMin) : 22 * 60;        // 默认 22:00
      var minDur = opts.minSlotMin != null ? Number(opts.minSlotMin) : 45;     // 默认 >= 45 分钟才算可用空档
      var self = this;
      var busy = [];

      function addBusy(sStr, eStr, label) {
        if (!sStr || !eStr) return;
        var s = TimeUtil.toMin(sStr), e = TimeUtil.toMin(eStr);
        if (!(e > s)) return;
        var cs = Math.max(dayStart, s), ce = Math.min(dayEnd, e);
        if (ce > cs) busy.push({ start: cs, end: ce, label: label || '' });
      }

      this.coursesOnDate(dateStr).forEach(function (c) {
        var t = self.courseTime(c);
        if (t && t.start && t.end) addBusy(t.start, t.end, c.name);
      });
      this.examsOf(dateStr).forEach(function (ex) {
        if (ex.start && ex.end) addBusy(ex.start, ex.end, ex.name + '考试');
      });
      this.eventsOf(dateStr).forEach(function (ev) {
        if (ev && !ev.anniv && !ev.done && ev.start && ev.end) {
          addBusy(ev.start, ev.end, ev.title);
        }
      });
      this.activitiesOf(dateStr).forEach(function (act) {
        if (act && act.planned && act.start && act.end) {
          addBusy(act.start, act.end, act.name);
        }
      });

      busy.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
      var merged = [];
      busy.forEach(function (b) {
        if (!merged.length || b.start > merged[merged.length - 1].end) {
          merged.push({ start: b.start, end: b.end });
        } else if (b.end > merged[merged.length - 1].end) {
          merged[merged.length - 1].end = b.end;
        }
      });

      var free = [];
      var cursor = dayStart;
      merged.forEach(function (m) {
        if (m.start - cursor >= minDur) {
          free.push({
            startMin: cursor,
            endMin: m.start,
            start: TimeUtil.fromMin(cursor),
            end: TimeUtil.fromMin(m.start),
            duration: m.start - cursor
          });
        }
        if (m.end > cursor) cursor = m.end;
      });
      if (dayEnd - cursor >= minDur) {
        free.push({
          startMin: cursor,
          endMin: dayEnd,
          start: TimeUtil.fromMin(cursor),
          end: TimeUtil.fromMin(dayEnd),
          duration: dayEnd - cursor
        });
      }

      var isFullDay = merged.length === 0 && (dayEnd - dayStart >= minDur);
      return {
        date: dateStr,
        busyCount: busy.length,
        isFullDayFree: isFullDay,
        slots: free,
        text: isFullDay
          ? ('全天空闲 (' + TimeUtil.fromMin(dayStart) + '-' + TimeUtil.fromMin(dayEnd) + ')')
          : (free.length
              ? free.map(function (s) { return s.start + '-' + s.end; }).join('、')
              : '满课/暂无整块空档')
      };
    },

    exportFreeTimeText: function (opts) {
      opts = opts || {};
      var weekNo = opts.weekNo || Math.max(1, Math.min(this.semester.weeks || 20, this.currentWeek()));
      var includeWeekend = opts.includeWeekend !== false;
      var dayCount = includeWeekend ? 7 : 5;
      var startStr = TimeUtil.fromMin(opts.startMin != null ? opts.startMin : 8 * 60);
      var endStr = TimeUtil.fromMin(opts.endMin != null ? opts.endMin : 22 * 60);
      var lines = ['【第 ' + weekNo + ' 周空闲时间段（' + startStr + '-' + endStr + '）】'];
      for (var d = 1; d <= dayCount; d++) {
        var dObj = this.dateOf(weekNo, d);
        var ds = DateUtil.toStr(dObj);
        var md = DateUtil.mdShort(dObj);
        var info = this.calcDayFreeSlots(ds, opts);
        lines.push('· ' + DAY_NAMES[d - 1] + '（' + md + '）：' + info.text);
      }
      return lines.join('\n');
    },

    exportDayScheduleText: function (dateStr) {
      var ds = dateStr || DateUtil.toStr(DateUtil.today());
      var dObj = DateUtil.parse(ds) || DateUtil.today();
      var dow = DateUtil.isoDow(dObj);
      var self = this;
      var courses = this.coursesOnDate(ds);
      var events = this.eventsOf(ds).filter(function (e) { return e && !e.anniv; });
      var freeInfo = this.calcDayFreeSlots(ds);
      var lines = ['【' + ds + ' ' + DAY_NAMES[dow - 1] + ' 课表与空档】'];
      if (!courses.length && !events.length) {
        lines.push('· 今日无课无固定日程');
      } else {
        courses.forEach(function (c) {
          var t = self.courseTime(c) || { start: '--:--', end: '--:--' };
          lines.push('· ' + t.start + '-' + t.end + ' 《' + c.name + '》' + (c.location ? ' @ ' + c.location : ''));
        });
        events.forEach(function (e) {
          lines.push('· ' + (e.start || '--') + (e.end ? '-' + e.end : '') + ' [日程] ' + e.title + (e.location ? ' @ ' + e.location : ''));
        });
      }
      lines.push('· 空闲时段：' + freeInfo.text);
      return lines.join('\n');
    },

    /* ===== 建议 3：学期末一键归档 / 开启新学期向导 ===== */
    suggestNextSemester: function () {
      var cur = this.currentSemester() || { name: '2026–2027 学年 秋季学期', startDate: DateUtil.toStr(DateUtil.today()), weeks: 20 };
      var curName = String(cur.name || '');
      var nextName = curName;
      if (/秋|第一学期|上学期/.test(curName)) {
        nextName = curName.replace(/秋季学期|秋/, '春季学期').replace(/第一学期/, '第二学期').replace(/上学期/, '下学期');
      } else if (/春|第二学期|下学期/.test(curName)) {
        var ym = curName.match(/(\d{4})\s*[–\-~]\s*(\d{4})/);
        if (ym) {
          var y1 = Number(ym[1]) + 1, y2 = Number(ym[2]) + 1;
          nextName = curName.replace(ym[0], y1 + '–' + y2);
        }
        nextName = nextName.replace(/春季学期|春/, '秋季学期').replace(/第二学期/, '第一学期').replace(/下学期/, '上学期');
      } else {
        nextName = curName + '（新学期）';
      }
      var curStart = DateUtil.parse(cur.startDate);
      var nextStart = curStart
        ? DateUtil.weekStart(DateUtil.addDays(curStart, (cur.weeks || 20) * 7 + 14))
        : DateUtil.weekStart(DateUtil.today());
      return {
        name: nextName,
        startDate: DateUtil.toStr(nextStart),
        weeks: cur.weeks || 20
      };
    },

    startNewSemester: function (opts) {
      opts = opts || {};
      var sug = this.suggestNextSemester();
      var name = String(opts.name || sug.name || '新学期').trim();
      var dStart = DateUtil.parse(opts.startDate || sug.startDate) || DateUtil.today();
      var monday = DateUtil.weekStart(dStart);
      var startStr = DateUtil.toStr(monday);
      var weeks = Math.max(1, Math.min(30, parseInt(opts.weeks, 10) || sug.weeks || 20));

      var archivedTasks = 0;
      if (opts.archiveDoneTasks !== false) {
        if (!Array.isArray(state.taskArchive)) state.taskArchive = [];
        var doneParentIds = {};
        (state.tasks || []).forEach(function (t) {
          if (t && !t.parentId && t.status === 'done') doneParentIds[t.id] = 1;
        });
        var keepTasks = [];
        (state.tasks || []).forEach(function (t) {
          if (!t) return;
          if (doneParentIds[t.id] || (t.parentId && doneParentIds[t.parentId])) {
            state.taskArchive.push(t);
            if (!t.parentId) archivedTasks++;
          } else {
            keepTasks.push(t);
          }
        });
        state.tasks = keepTasks;
        if (state.taskArchive.length > 500) {
          state.taskArchive = state.taskArchive.slice(-500);
        }
      }

      var newSem = this.addSemester({
        name: name,
        startDate: startStr,
        weeks: weeks,
        switchTo: true
      });
      var copiedCourses = 0;
      if (opts.copyFromSemesterId) {
        copiedCourses = this.cloneCourses(opts.copyFromSemesterId, newSem.id);
      }
      this.save();
      this.emit();
      return {
        semester: newSem,
        archivedTasks: archivedTasks,
        copiedCourses: copiedCourses
      };
    },

    /* ===== 入睡时刻：白噪音睡眠定时回写 ===== */
    /**
     * 记一次「我准备睡了」。白噪音开睡眠定时时调用，不用用户再填表。
     *
     * 一天只留一条：同一天再开一次定时，保留**更早**的那个时刻
     * （先听的是真正躺下的时间，后面是续播），定时分钟取更长的。
     */
    logSleepOnset: function (at, opts) {
      opts = opts || {};
      var hhmm = /^\d{1,2}:\d{2}$/.test(at || '') ? at : null;
      if (!hhmm) {
        var now = new Date();
        hhmm = (now.getHours() < 10 ? '0' : '') + now.getHours() + ':' +
               (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
      }
      var dateStr = opts.date || DateUtil.toStr(DateUtil.today());
      if (!state.sleepOnsets) state.sleepOnsets = [];

      var ex = null;
      state.sleepOnsets.forEach(function (o) { if (o && o.date === dateStr) ex = o; });
      var mins = Number(opts.min) || 0;

      if (ex) {
        if (onsetAxis(hhmm) < onsetAxis(ex.at)) ex.at = hhmm;
        ex.min = Math.max(Number(ex.min) || 0, mins);
        ex.n = (Number(ex.n) || 1) + 1;
      } else {
        ex = { date: dateStr, at: hhmm, min: mins, src: opts.src || 'white-noise', n: 1 };
        state.sleepOnsets.push(ex);
      }
      // 只留最近 120 天，避免常年累积把存档撑大
      var keep = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -120));
      state.sleepOnsets = state.sleepOnsets.filter(function (o) { return o && o.date >= keep; });

      this.save();
      this.emit();
      return ex;
    },

    /**
     * 最近 n 天的入睡时刻统计。
     * avgMin 是「夜晚轴」分钟（24:30 表示凌晨 0:30），转显示用 axisToHhmm。
     * 和就寝建议（bedtimePlan）对比时用 gapMin：正数 = 比建议晚多少分钟。
     */
    onsetStats: function (n) {
      n = n || 7;
      var from = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -n + 1));
      var list = (state.sleepOnsets || []).filter(function (o) {
        return o && o.date >= from && onsetAxis(o.at) != null;
      }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

      var out = { has: false, n: list.length, days: n, list: list,
                  avgMin: null, avgHHMM: '', earliest: '', latest: '', spread: 0 };
      if (!list.length) return out;

      var sum = 0, lo = Infinity, hi = -Infinity;
      list.forEach(function (o) {
        var m = onsetAxis(o.at);
        sum += m;
        if (m < lo) lo = m;
        if (m > hi) hi = m;
      });
      out.has = true;
      out.avgMin = sum / list.length;
      out.avgHHMM = axisToHhmm(out.avgMin);
      out.earliest = axisToHhmm(lo);
      out.latest = axisToHhmm(hi);
      out.spread = hi - lo;                 // 最早最晚差多少分钟 = 作息乱不乱
      return out;
    },

    /** 最近一次记下的入睡时刻（HH:MM），没有则 '' */
    latestOnset: function () {
      var list = (state.sleepOnsets || []).slice().sort(function (a, b) {
        return String(a.date) < String(b.date) ? 1 : -1;
      });
      return list.length ? list[0].at : '';
    },

    /** 把 'HH:MM' 归一到夜晚轴（24:30 → 凌晨 0:30），供 UI 与就寝建议比较早晚 */
    onsetAxisOf: function (hhmm) { return onsetAxis(hhmm); },

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

  };

  global.DateUtil = DateUtil;
  global.TimeUtil = TimeUtil;
  global.MEAL_TYPES = MEAL_TYPES;
  global.ACT_TYPES = ACT_TYPES;
  global.actType = actType;
  global.WORKOUT_TYPES = WORKOUT_TYPES;
  global.workoutType = workoutType;
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
  global.PLAN_LOADS = PLAN_LOADS;
  global.isCheckinLike = isCheckinLike;
  global.quotaWindowAt = quotaWindowAt;
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
  Store.inspectImport = inspectImport;
  Store.krProgress = krProgress;
  /**
   * 域模块（store-ledger.js 等）用的内部上下文。
   * 只暴露「纯函数 + 状态引用」，域模块通过 Object.assign 挂回 Store，
   * 对外 API 不变，store.js 与域模块可以各自演进。
   */
  Store._ctx = {
    defaultState: defaultState,
    uid: uid,
    normalizeTags: normalizeTags,
    ledgerCat: ledgerCat,
    LEDGER_CATS: LEDGER_CATS,
    POMO: (typeof POMO !== 'undefined' ? POMO : null),
    sleepByNight: sleepByNight,
    workoutType: workoutType,
    mealType: mealType,
    sumItems: sumItems,
    r1: r1,
    isCheckinLike: isCheckinLike,
    normFoodItem: normFoodItem,
    firstOccurrence: firstOccurrence,
    sanitizeRepeat: sanitizeRepeat,
    repeatSummary: repeatSummary,
    repeatShort: repeatShort,
    genNextTask: genNextTask,
    subOpts: subOpts,
    isChild: isChild,
    childrenOf: childrenOf,
    subtaskProgress: subtaskProgress,
    compareDue: compareDue,
    tagParts: tagParts,
    holidayPaused: holidayPaused,
    normSlot: normSlot,
    goalActive: goalActive,
    krProgress: krProgress,
    buildCourseExamSlots: buildCourseExamSlots,
    normCourseExamsInput: normCourseExamsInput,
    extractValidExams: extractValidExams,
    pickPrimaryExam: pickPrimaryExam,
    COLORS: COLORS,
    GPA_LEVEL_RULES: (typeof GPA_LEVEL_RULES !== 'undefined' ? GPA_LEVEL_RULES : null),
    rangeDates: rangeDates,
    speciesOf: speciesOf,
    stageNeed: stageNeed,
    achValue: achValue,
    achMet: achMet,
    TREE_SPECIES: TREE_SPECIES,
    ACH_TIER: ACH_TIER,
    ACH_DEF: ACH_DEF,
    ACH_GROUPS: ACH_GROUPS,
    Persist: Persist,
    touch: touch,
    SCHEMA_VERSION: SCHEMA_VERSION,
    stripKeys: stripKeys,
    safeImportState: safeImportState,
    diffStates: diffStates,
    diffLines: diffLines,
    inspectImport: inspectImport,
    statutoryHoliday: statutoryHoliday,
    listeners: listeners,
    DAY_NAMES: DAY_NAMES,
    /** 域模块里需要整体换 state（导入/重置）时用，Store.state 只有 getter */
    setState: function (v) { state = v; },
    quotaWindowAt: quotaWindowAt,
    quotaIndexOn: quotaIndexOn,
    quotaCountIn: quotaCountIn,
    quotaStateOf: quotaStateOf,
    compareRange: compareRange,
    perDay: perDay,
    eachDate: eachDate,
    goalExpired: goalExpired,
    goalProgress: goalProgress,
    goalReviewDue: goalReviewDue,
    goalReviewText: goalReviewText,
    goalDays: goalDays,
    goalPct: goalPct,
    normGoal: normGoal,
    rev: rev,
    rangeStatCache: rangeStatCache,
    PLAN_TYPES: PLAN_TYPES,
    PLAN_PERIODS: PLAN_PERIODS,
    PLAN_LOADS: PLAN_LOADS,
    PLAN_EXEMPT_MAX: PLAN_EXEMPT_MAX,
    GOAL_MAX_ACTIVE: GOAL_MAX_ACTIVE,
    GOAL_GROUPS: GOAL_GROUPS,
    KR_KINDS: KR_KINDS,
    GOAL_MIN_DAYS: GOAL_MIN_DAYS,
    expandRange: expandRange,
    dayStatCache: dayStatCache,
    splitOldRecords: splitOldRecords,
    tagMeta: tagMeta,
    tagStyle: tagStyle,
    tagFull: tagFull,
    moodOf: moodOf,
    diaryDatePrompt: diaryDatePrompt,
    moodStats: moodStats,
    diaryOn: diaryOn,
    diariesSorted: diariesSorted,
    TAG_PRESETS: TAG_PRESETS,
    TAG_GROUPS: TAG_GROUPS,
    MOODS: MOODS,
    MOOD_MIN_DAYS: MOOD_MIN_DAYS,
    MOOD_CROSS_MIN_DAYS: MOOD_CROSS_MIN_DAYS
  };
  global.validateSchema = validateSchema;
  if (global.StorePlanner) {
    Object.assign(Store, global.StorePlanner);
  }
  // 撤销栈在 undo.js；在这里挂载，保证 Store.undo / canUndo 始终是 API 的一部分
  // （CP.selfCheck 会扫描源码里的 Store.xxx( 调用，缺一个就报错）
  if (global.Undo && global.Undo.attach) global.Undo.attach(Store);
  global.Store = Store;
  if (global.CP && global.CP.register) {
    global.CP.register('DateUtil', DateUtil);
    global.CP.register('TimeUtil', TimeUtil);
    global.CP.register('Store', Store);
  }
})(typeof window !== 'undefined' ? window : globalThis);


