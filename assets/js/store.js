/* ==========================================================
 * Store —— 数据层
 * 全部数据持久化到 localStorage
 * ========================================================== */
(function (global) {
  'use strict';

  var KEY = 'course-planner:v1';

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

  function defaultState() {
    var today = new Date();
    // 默认学期：本周一往前推 8 周作为学期开始，共 20 周
    var start = DateUtil.addDays(DateUtil.weekStart(today), -7 * 8);
    var sid = uid('sem');
    return {
      version: 2,
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
        background: { dataUrl: '', mask: 0.5 }
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
      events: [],      // 一次性日程
      activities: [],  // 活动记录
      meals: [],       // 饮食记录
      sleeps: [],      // 睡眠记录
      achievements: { done: {} }   // 成就系统：{ done: { 成就id: { at: 时间戳 } } }
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
  var RANGES = {
    day:   { key: 'day',   name: '今天', days: 1 },
    week:  { key: 'week',  name: '一周', days: 7 },
    month: { key: 'month', name: '一月', days: 30 },
    season:{ key: 'season',name: '一季', days: 90 }
  };

  /** 日期区间 [from, to]（含两端） */
  function rangeDates(key) {
    var n = (RANGES[key] || RANGES.week).days;
    var to = DateUtil.today();
    var from = DateUtil.addDays(to, -(n - 1));
    return { from: DateUtil.toStr(from), to: DateUtil.toStr(to), days: n, key: key };
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
    { key: 'camphor', name: '樟树', crown: '#4c8c4a', crown2: '#3f7d3d', trunk: '#7a5c3a' },
    { key: 'ginkgo', name: '银杏', crown: '#f0c04a', crown2: '#dfa93a', trunk: '#8a6a45' },
    { key: 'maple', name: '枫树', crown: '#e0703c', crown2: '#c8542a', trunk: '#7a5c3a' },
    { key: 'sakura', name: '樱花', crown: '#f2a3bd', crown2: '#e88aab', trunk: '#8a6a45' },
    { key: 'pine', name: '松树', crown: '#3f7d4a', crown2: '#356b3f', trunk: '#6f5637', shape: 'cone' },
    { key: 'birch', name: '白桦', crown: '#8fc46b', crown2: '#7bb45c', trunk: '#c9c2b6' },
    { key: 'oak', name: '橡树', crown: '#4a8f52', crown2: '#3d7f45', trunk: '#6f5637' },
    { key: 'plane', name: '梧桐', crown: '#7cb342', crown2: '#6aa83a', trunk: '#8a6a45' }
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
      metric: 'tree', threshold: 9 }
  ];

  /** 成就分类顺序：抽卡 / 集卡 / 种树 */
  var ACH_GROUPS = ['抽卡', '集卡', '种树'];

  /** 当前各成就指标的实际数值 */
  function achValue(metric) {
    var s = state;
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

  /** 成就是否已满足：累计型看 threshold，事件型走 check() */
  function achMet(a) {
    if (typeof a.check === 'function') return !!a.check();
    return achValue(a.metric) >= (a.threshold || 0);
  }

  var Store = {
    COLORS: COLORS,
    DAY_NAMES: DAY_NAMES,
    util: DateUtil,

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

    init: function () {
      // 检测 localStorage 是否可用（iframe / 隐私模式可能被禁用）
      try {
        localStorage.setItem('__cp_probe__', '1');
        localStorage.removeItem('__cp_probe__');
        this.storageOK = true;
      } catch (e) {
        this.storageOK = false;
      }

      var raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
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
      if (!state.events) state.events = [];
      if (!state.activities) state.activities = [];
      if (!state.meals) state.meals = [];
      if (!state.sleeps) state.sleeps = [];
      if (!state.courses) state.courses = [];
      if (!state.tasks) state.tasks = [];
      if (!state.achievements || typeof state.achievements !== 'object') state.achievements = { done: {} };
      if (!state.achievements.done || typeof state.achievements.done !== 'object') state.achievements.done = {};
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
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        this.quotaWarned = false;
      } catch (e) {
        console.warn('保存失败', e);
        if (!this.quotaWarned) {
          this.quotaWarned = true;
          if (global.UI && UI.toast) {
            UI.toast('本地存储空间不足，建议换一张更小的背景图', 'err');
          }
        }
      }
    },

    subscribe: function (fn) { listeners.push(fn); },
    emit: function () {
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
      var custom = data.timeMode === 'custom';
      var c = {
        id: uid('c'),
        name: (data.name || '').trim() || '未命名课程',
        teacher: (data.teacher || '').trim(),
        location: (data.location || '').trim(),
        color: data.color || COLORS[state.courses.length % COLORS.length],
        day: data.day || 1,
        timeMode: custom ? 'custom' : 'period',
        periodId: custom ? '' : (data.periodId || ''),
        startTime: custom ? (data.startTime || '') : '',
        endTime: custom ? (data.endTime || '') : '',
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
      this.emit();
      this.checkAchievements(true);
      return c;
    },

    updateCourse: function (id, data) {
      var c = this.getCourse(id);
      if (!c) return null;
      Object.keys(data).forEach(function (k) {
        if (typeof data[k] === 'string') c[k] = data[k].trim();
        else c[k] = data[k];
      });
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

    /** 某周的课表数据：返回 [dow][periodId] = [course] */
    weekMatrix: function (weekNo) {
      var map = {};
      var sid = state.currentSemesterId;
      state.courses.forEach(function (c) {
        if (c.semesterId && c.semesterId !== sid) return;
        if (!Store.courseInWeek(c, weekNo)) return;
        var key = c.day + '|' + c.periodId;
        (map[key] = map[key] || []).push(c);
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
        tags: normalizeTags(data.tags),
        note: (data.note || '').trim(),
        createdAt: new Date().toISOString(),
        doneAt: ''
      };
      state.tasks.push(t);
      this.emit();
      return t;
    },

    updateTask: function (id, data) {
      var t = this.getTask(id);
      if (!t) return null;
      var wasDone = t.status === 'done';
      Object.keys(data).forEach(function (k) {
        t[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
      });
      // 首次标记为完成 → 奖励积分
      if (!wasDone && t.status === 'done') {
        this.addPoints(POMO.TASK_DONE);
      }
      this.checkAchievements(true);
      if (t.status === 'done' && !t.doneAt) t.doneAt = new Date().toISOString();
      if (t.status !== 'done') t.doneAt = '';
      this.emit();
      return t;
    },

    removeTask: function (id) {
      state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
      this.emit();
    },

    getTask: function (id) {
      for (var i = 0; i < state.tasks.length; i++) {
        if (state.tasks[i].id === id) return state.tasks[i];
      }
      return null;
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
      return state.courses.filter(function (c) {
        if (c.semesterId && c.semesterId !== sid) return false;
        return c.day === day && Store.courseInWeek(c, weekNo);
      }).sort(function (a, b) {
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
        createdAt: new Date().toISOString()
      };
      state.events.push(e);
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

    sleepMinutes: function (dateStr) {
      return mergeTotal(this.sleepsOf(dateStr).reduce(function (acc, r) {
        return acc.concat(expandRange(r.start, r.end));
      }, []));
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

    plantCost: function () {
      return POMO.PLANT_COST + state.pomodoro.trees.length * POMO.PLANT_STEP;
    },

    /** 种一棵树，消耗当前价格的积分 */
    plantTree: function (speciesKey) {
      var pm = state.pomodoro;
      var cost = this.plantCost();
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

    /** 区间内的时间去向汇总 */
    rangeStat: function (from, to) {
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
        daily.push({ date: ds, d: DateUtil.parse(ds), recorded: per, idle: sum.idle });
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
     */
    dayStat: function (dateStr) {
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
    exportJSON: function () { return JSON.stringify(state, null, 2); },

    importJSON: function (text) {
      var obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object') throw new Error('数据格式不正确');
      if (!obj.courses && !obj.tasks && !obj.settings && !obj.plans && !obj.ledger &&
          !obj.notes && !obj.events && !obj.activities) {
        throw new Error('没有找到可恢复的数据');
      }
      var ds = defaultState();
      state = {
        version: 1,
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
        events: obj.events || [],
        activities: obj.activities || [],
        meals: obj.meals || [],
        sleeps: obj.sleeps || []
      };
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
  global.rangeDates = rangeDates;
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
  global.Store = Store;
})(window);
