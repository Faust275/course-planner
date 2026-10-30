/* ==========================================================
 * Store 奖励域（v1.4.6 从 store.js 拆出）
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
  var TREE_SPECIES = ctx.TREE_SPECIES;
  var ACH_TIER = ctx.ACH_TIER;
  var ACH_DEF = ctx.ACH_DEF;
  var ACH_GROUPS = ctx.ACH_GROUPS;
  var rangeDates = ctx.rangeDates;
  var speciesOf = ctx.speciesOf;
  var stageNeed = ctx.stageNeed;
  var achValue = ctx.achValue;
  var achMet = ctx.achMet;
  var isCheckinLike = ctx.isCheckinLike;
  var tagParts = ctx.tagParts;
  var normalizeTags = ctx.normalizeTags;
  var extractValidExams = ctx.extractValidExams;

  Object.assign(Store, {
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
    var pm = Store.state.pomodoro;
    if (pm.mode === 'gacha') pm.jade += n * POMO.JADE_PER_POINT;
    else pm.points += n;
    pm.earned += n;
    // 写流水（用于统计分页的「积分曲线」与「来源构成」）；date 缺省为今天，记录类可传记录的所属日
    pm.pointLog.push({ date: date || DateUtil.toStr(DateUtil.today()), n: n, src: src || 'other' });
    if (pm.pointLog.length > 2000) pm.pointLog = pm.pointLog.slice(-2000);
    return pm.mode === 'gacha' ? pm.jade : pm.points;
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
    return global.StatsCalc.seriesFromLog(Store.state.pomodoro.pointLog, dates);
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
    return global.StatsCalc.ledgerBreakdown(Store.state.ledger, dates, type || 'expense');
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
    return global.StatsCalc.sumByCourse(Store.state.activities, dates);
  },

  /** 当前机制余额：森林=积分，抽卡=合成玉（两币不互通、不再折算） */
  totalPoints: function () {
    var pm = Store.state.pomodoro;
    return pm.mode === 'gacha' ? pm.jade : pm.points;
  },

  /** 抽卡系统是否开启（开发者选项「明日方舟」开启；默认关闭，仅种树） */
  gachaEnabled: function () {
    return !!(Store.state.settings && Store.state.settings.devArknights);
  },

  /** 开发者选项：setGachaEnabled(true) 开启抽卡；false 关闭并切回森林 */
  setGachaEnabled: function (on) {
    on = !!on;
    Store.state.settings.devArknights = on;
    if (!on && Store.state.pomodoro.mode === 'gacha') Store.state.pomodoro.mode = 'forest';
    this.save();
    this.emit();
    if (typeof App !== 'undefined' && App.rebuildNav) App.rebuildNav();
    return on;
  },

  /** 是否处于非游戏化纯粹学术专注模式 */
  isAcademicMode: function () {
    return !!(Store.state && Store.state.pomodoro && Store.state.pomodoro.mode === 'academic');
  },

  /** 切换奖励机制（academic 纯学术 | forest 森林种树 | gacha 抽卡寻访） */
  setRewardMode: function (mode) {
    if (mode === 'gacha' && !this.gachaEnabled()) return Store.state.pomodoro.mode;
    var pm = Store.state.pomodoro;
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
    var eg = Store.state.settings && Store.state.settings.energy;
    if (eg && eg.custom && Array.isArray(eg.peaks) && eg.peaks.length) {
      return eg.peaks;
    }
    return [
      { start: '09:00', end: '11:30', name: '晨间黄金专注期' },
      { start: '15:00', end: '17:30', name: '午后高效期' },
      { start: '19:30', end: '21:30', name: '晚间静心期' }
    ];
  },

  /**
   * 当前时刻的生理精力评估与建议。
   *
   * 先按「钟点节律」判一次（早/中/晚三个高峰段 + 午后低谷 + 夜间），
   * 再用昨晚的睡眠修正——同一个 10:00，睡了 5 小时和睡了 8 小时不是一回事。
   * 修正只在有睡眠记录时生效（无记录 / 健康看板关着就纯按节律走）。
   */
  currentEnergyState: function (nowStr) {
    var st = this._energyByClock(nowStr);
    return this.applySleepToEnergy(st);
  },

  /** 纯节律判定（不看睡眠），供 currentEnergyState 与测试复用 */
  _energyByClock: function (nowStr) {
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

  /**
   * 用昨晚睡眠修正节律判定。
   * 只做两件事：欠睡时把「黄金期」打折成平稳期（因为此时的高峰是假高峰），
   * 以及在任何档位上补一句实话。不改 level 以外的东西，调用方判断逻辑不用动。
   */
  applySleepToEnergy: function (st) {
    if (!st) return st;
    var adv = this.bodyAdvice();
    if (!adv.has || (adv.level !== 'low' && adv.level !== 'good')) return st;

    var out = {};
    Object.keys(st).forEach(function (k) { out[k] = st[k]; });
    out.sleepLevel = adv.level;
    out.sleepTotal = adv.total;
    var dur = TimeUtil.humanMin(adv.total);

    if (adv.level === 'low') {
      if (out.level === 'high') {
        out.level = 'medium';
        out.isPeak = false;
        out.sleepDamp = true;
        out.label = out.label + '（昨晚欠睡，已降档）';
        out.advice = '昨晚只睡了 ' + dur + '，这段时间的高峰是假高峰：' +
                     '先做轻松的，高耗能的往后挪。';
      } else {
        out.advice = out.advice + '（昨晚只睡了 ' + dur + '，别再给自己加码。）';
      }
    } else if (out.level === 'high') {
      out.advice = out.advice + '（昨晚睡了 ' + dur + '，这段可以加量。）';
    }
    return out;
  },

  /** 获取当前学期所有登记了考试的场次列表（含期中、期末及自定义考试，按考试日期升序） */
  courseExams: function (semId) {
    var sid = semId || Store.state.currentSemesterId;
    var out = [];
    Store.state.courses.forEach(function (c) {
      if (c.semesterId && c.semesterId !== sid) return;
      var list = extractValidExams(c);
      list.forEach(function (ex) {
        out.push(Object.assign({}, c, {
          examId: ex.id || 'final',
          examLabel: ex.label || '期末考试',
          exam: {
            id: ex.id || 'final',
            label: ex.label || '期末考试',
            date: ex.date,
            start: ex.start || '',
            end: ex.end || '',
            location: ex.location || c.location || ''
          }
        }));
      });
    });
    return out.sort(function (a, b) {
      var ta = (a.exam.date || '') + ' ' + (a.exam.start || '');
      var tb = (b.exam.date || '') + ' ' + (b.exam.start || '');
      return ta < tb ? -1 : (ta > tb ? 1 : 0);
    });
  },

  /** 扣森林积分：只动积分池，不与合成玉互通 */
  spendPoints: function (n) {
    n = Math.round(n);
    if (n <= 0) return true;
    var pm = Store.state.pomodoro;
    if (pm.points >= n) { pm.points -= n; return true; }
    return false;
  },

  /** 扣合成玉：只动玉池，不与积分互通 */
  spendJade: function (n) {
    n = Math.round(n);
    if (n <= 0) return true;
    var pm = Store.state.pomodoro;
    if (pm.jade >= n) { pm.jade -= n; return true; }
    return false;
  },

  /* ===== 商城 ===== */

  /** 余额：森林积分 / 合成玉 / 等值积分 */
  shopBalance: function () {
    var pm = Store.state.pomodoro;
    return {
      points: pm.points,
      jade: pm.jade,
      mode: pm.mode,
      current: pm.mode === 'gacha' ? pm.jade : pm.points
    };
  },

  /** 月卡剩余天数（含当天）；未购买或已过期返回 0 */
  cardDaysLeft: function () {
    var c = Store.state.shop.card;
    if (!c) return 0;
    var today = DateUtil.toStr(DateUtil.today());
    if (today > c.endDate) return 0;
    return DateUtil.diffDays(DateUtil.parse(c.endDate), DateUtil.parse(today)) + 1;
  },

  /** 月卡展示状态：只读，供 UI 用 */
  cardInfo: function () {
    var c = Store.state.shop.card;
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
    var sh = Store.state.shop;
    var left = this.cardDaysLeft();
    if (left > 0) return { ok: false, msg: '当前月卡还剩 ' + left + ' 天，到期后才能换购' };
    var pm = Store.state.pomodoro;
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
    var sh = Store.state.shop;
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
    var sh = Store.state.shop;
    var c = sh.card;
    if (!c) return false;
    if (day < c.startDate || day > c.endDate) return false;
    if (c.days[day]) return false;

    c.days[day] = 1;
    // 返还到「购买月卡时那个模式」的币种：森林→积分，抽卡→合成玉（按 180:1 等值）
    var pm = Store.state.pomodoro;
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
    var sh = Store.state.shop;
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
    var t = (Store.state.shop && Store.state.shop.tickets) || {};
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
    var pm = Store.state.pomodoro;
    var hit = null;
    for (var k = 0; k < pm.gacha.ops.length; k++) {
      if (pm.gacha.ops[k].n === o.n) { hit = pm.gacha.ops[k]; break; }
    }
    if (hit) {
      hit.count = (hit.count || 1) + 1;
      if (hit.count > POMO.POT_MAX + 1) {
        var pts = POMO.DUP_POINTS[o.r] || POMO.DUP_POINTS[3];
        if (!Store.state.shop) Store.state.shop = { activeDays: {}, dupPool: [], log: [], card: null };
        if (!Array.isArray(Store.state.shop.dupPool)) Store.state.shop.dupPool = [];
        Store.state.shop.dupPool.push({ n: o.n, r: o.r, pts: pts, at: Date.now() });
        hit.dupPts = (hit.dupPts || 0) + pts;
      }
    } else {
      pm.gacha.ops.push({ n: o.n, r: o.r, p: o.p, img: o.img, count: 1, at: Date.now() });
    }
    this.checkAchievements(true);
  },

  /** 限定井进度（每抽并计，但与 UP 井不叠加使用） */
  limitedSparkInfo: function () {
    var li = Store.state.pomodoro.gacha.limited || {};
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
    Store.state.pomodoro.gacha.limited.target = name || '';
    this.emit();
    this.save();
    return { ok: true, target: name || '' };
  },

  /** 用攒满的限定井兑换登记的限定（兑换后计数清零） */
  redeemLimitedSpark: function () {
    var li = Store.state.pomodoro.gacha.limited;
    if (!li.target) return { ok: false, msg: '先登记一名限定干员' };
    if ((li.count || 0) < POMO.LIMITED_SPARK) {
      return { ok: false, msg: '限定井还没攒够（' + (li.count || 0) + '/' + POMO.LIMITED_SPARK + '）' };
    }
    var op = this.opByName(li.target);
    if (!op) return { ok: false, msg: '目标干员不存在' };
    li.count = 0;
    this.addOwnedOp(op);
    Store.state.shop.log.unshift({ at: Date.now(), type: 'limited', text: '限定井兑换：' + op.n });
    this.trimShopLog();
    this.emit();
    this.save();
    return { ok: true, n: op.n };
  },

  /** 定向券兑换限定（月全勤发放） */
  useSelectionTicket: function (name) {
    var sh = Store.state.shop;
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
    var sh = Store.state.shop;
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
    var sh = Store.state.shop;
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
    var sh = Store.state.shop;
    var today = DateUtil.toStr(DateUtil.today());
    if (!sh.streak) sh.streak = { weekEnd: '', monthEnd: '' };
    var got = { fish: 0, points: 0, selection: 0 };

    function payPoints(n) {
      var pm = Store.state.pomodoro;
      // 按当前模式币种发（森林→积分，抽卡→合成玉 180:1）
      if (pm.mode === 'gacha') pm.jade += n * POMO.JADE_PER_POINT;
      else pm.points += n;
      pm.earned += n;
      pm.pointLog.push({ date: today, n: n });
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
    var sh = Store.state.shop;
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
    var sh = Store.state.shop;
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
    var sh = Store.state.shop;
    if (!dateStr || dateStr > DateUtil.toStr(DateUtil.today())) return { ok: false, msg: '只能补已经过去的日子' };
    if (dateStr === DateUtil.toStr(DateUtil.today())) return { ok: false, msg: '今天还没过完，做 2 件小事就行，不用花券' };
    if (this.isValidDay(dateStr)) return { ok: false, msg: '这一天已经是有效日了' };
    if (!sh.validDays) sh.validDays = {};
    sh.validDays[dateStr] = POMO.VALID_DAY_MIN;
    return { ok: true, label: '补签 ' + dateStr, date: dateStr };
  },

  /** 护树：当前专注的树进入休眠，阶段与进度都保留 */
  fishProtectTree: function () {
    var pm = Store.state.pomodoro;
    var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
    if (!tree) return { ok: false, msg: '当前没有正在长的树' };
    tree.withered = false;
    tree.dormant = true;
    return { ok: true, label: '护住树苗（休眠保留）', treeId: tree.id };
  },

  /** 休整：提前结束但树不判枯、进度保留（下一次专注接着长） */
  fishRestTree: function () {
    var pm = Store.state.pomodoro;
    var tree = pm.timer && pm.timer.treeId ? this.getTree(pm.timer.treeId) : null;
    if (!tree) return { ok: false, msg: '当前没有正在长的树' };
    tree.withered = false;
    tree.dormant = true;
    return { ok: true, label: '休整（树保留）', treeId: tree.id };
  },

  /** 休整收尾：把树从休眠转回可生长状态（不清进度） */
  keepActiveTree: function () {
    var pm = Store.state.pomodoro;
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
    var pool = Store.state.shop.dupPool || [];
    var pts = 0;
    pool.forEach(function (d) { pts += d.pts || 0; });
    return { count: pool.length, points: pts, jade: pts * POMO.JADE_PER_POINT };
  },

  /** 满潜重复兑换：按 1 积分 = JADE_PER_POINT 玉，固定换成合成玉（两币不互通，满潜是抽卡子系统产物） */
  exchangeDup: function () {
    var sh = Store.state.shop;
    var info = this.dupPoolInfo();
    if (!info.count) return { ok: false, count: 0, points: 0, jade: 0 };
    var pm = Store.state.pomodoro;
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
    var log = Store.state.shop.log;
    if (log.length > 100) log.length = 100;
  },

  /** 结束一次专注：minutes 为实际专注分钟，extra 可带起止时间用于写入象限 */
  finishFocus: function (minutes, taskId, extra, opts) {
    minutes = Math.max(0, Math.floor(minutes));
    var pm = Store.state.pomodoro;
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

    var fTask = taskId ? this.getTask(taskId) : null;
    var fCourseId = (extra && extra.courseId) || (fTask && fTask.courseId) || (pm.timer && pm.timer.courseId) || '';
    var fCourse = fCourseId ? this.getCourse(fCourseId) : null;
    var fCourseName = (extra && extra.courseName) || (fCourse ? fCourse.name : '');
    if (!fCourseId) {
      var rawTags = ctx.normalizeTags(extra && extra.tags);
      for (var ci = 0; ci < Store.state.courses.length; ci++) {
        var cc = Store.state.courses[ci];
        if (cc && cc.name && rawTags.some(function (tg) { return tg === cc.name || tg === "学习/" + cc.name || tg.indexOf(cc.name) >= 0; })) {
          fCourseId = cc.id;
          fCourseName = cc.name;
          break;
        }
      }
    }

    // 记录本次专注（用于统计 & 目标 KR 按课程统计）
    var dateStr = (extra && extra.date) || DateUtil.toStr(DateUtil.today());
    var sessionTags = ctx.normalizeTags(extra && extra.tags);
    if (fTask && Array.isArray(fTask.tags)) {
      fTask.tags.forEach(function (tg) { if (sessionTags.indexOf(tg) < 0) sessionTags.push(tg); });
    }
    if (fCourseName && sessionTags.indexOf(fCourseName) < 0) {
      sessionTags.push(fCourseName);
    }
    pm.sessions.push({
      date: dateStr, minutes: minutes,
      taskId: taskId || '',
      courseId: fCourseId,
      courseName: fCourseName,
      name: (extra && extra.name) || '',
      tags: sessionTags,
      at: new Date().toISOString()
    });
    if (pm.sessions.length > 400) pm.sessions = pm.sessions.slice(-400);

    // 自动把专注时长写进象限的活动记录（专注分已单独结算，这里不再重复发活动分）
    if (extra && extra.start && extra.end && minutes >= 1) {
      this.addActivity({
        date: dateStr,
        start: extra.start,
        end: extra.end,
        name: extra.name || '专注',
        type: 'study',
        tags: sessionTags,
        note: '番茄钟自动记录',
        taskId: taskId || '',
        courseId: fCourseId,
        courseName: fCourseName,
        noAward: true
      });
    }

    // 联动 C：番茄钟完成自动联动匹配的「时长型 / 打卡型 / 进度型」专注与学科复习计划
    var syncedPlans = [];
    if (minutes >= 1 && (!Store.state.settings || Store.state.settings.autoPlanFocus !== false)) {
      syncedPlans = this.syncFocusToPlans({
        date: dateStr,
        minutes: minutes,
        taskId: taskId || '',
        taskTitle: fTask ? (fTask.title || '') : '',
        courseId: fCourseId,
        courseName: fCourseName,
        tags: sessionTags,
        name: (extra && extra.name) || (fTask ? ('专注：' + fTask.title) : (fCourseName ? ('专注：' + fCourseName) : '番茄专注'))
      });
    }
    Store.state.pomodoro.lastSyncedPlans = syncedPlans;

    // 实时结算包含 focus / plan 的在办目标 KR
    this.settleKRs();
    this.settleGoals();

    Store.state.pomodoro.timer = {
      running: false, endAt: 0, left: 0,
      duration: Store.state.pomodoro.timer.duration || 45, taskId: '', treeId: ''
    };
    this.bumpUsage('focus');
    this.emit();
    this.save(true);
    return gain;
  },

  /** 联动 C：将番茄专注自动同步至匹配的时长型、打卡型或进度型计划（支持专注/学习/自习标签及绑定课程的复习计划） */
  syncFocusToPlans: function (fObj) {
    if (!fObj || !(fObj.minutes > 0) || !Array.isArray(Store.state.plans)) return [];
    var self = this;
    var synced = [];
    var dStr = fObj.date || DateUtil.toStr(DateUtil.today());
    var sportRe = /跑步|慢跑|健走|骑行|游泳|跳绳|羽毛球|篮球|足球|排球|乒乓|网球|力量|健身|有氧|锻炼/;
    var studyRe = /专注|番茄|自习|学习|复习|读书|阅读|背单词|刷题|考研|备考|编程|代码|英语|数学|高数|写字|练字|写作|论文|文献|听力/;
    var fTags = Array.isArray(fObj.tags) ? fObj.tags : [];

    Store.state.plans.forEach(function (p) {
      if (!p || p.done) return;
      if (p.startDate && dStr && p.startDate > dStr) return;
      var title = String(p.title || '');
      if (sportRe.test(title)) return;

      var pTags = Array.isArray(p.tags) ? p.tags : [];
      var tagHit = pTags.length > 0 && fTags.length > 0 && pTags.some(function (pt) {
        return fTags.some(function (ft) {
          return ft === pt || ft.indexOf(pt + '/') === 0 || pt.indexOf(ft + '/') === 0;
        });
      });
      var focusTagHit = pTags.some(function (pt) {
        return /专注|番茄|学习|自习|复习|备考/.test(pt);
      });
      var courseHit = !!(fObj.courseName && (title.indexOf(fObj.courseName) >= 0 || pTags.some(function (pt) { return pt.indexOf(fObj.courseName) >= 0; })));
      var taskHit = !!(fObj.taskTitle && (title.indexOf(fObj.taskTitle) >= 0 || fObj.taskTitle.indexOf(title) >= 0));
      var studyHit = studyRe.test(title) || focusTagHit;

      if (!tagHit && !courseHit && !taskHit && !studyHit) return;

      if (!Array.isArray(p.records)) p.records = [];
      if (p.type === 'duration') {
        p.records.push({
          date: dStr,
          value: fObj.minutes,
          note: (fObj.name || '番茄专注') + ' ' + fObj.minutes + '分钟',
          source: 'pomodoro',
          at: new Date().toISOString()
        });
      } else if (isCheckinLike(p)) {
        // 打卡型计划：若今日尚未打卡，完成专注后自动打勾
        var alreadyChecked = p.records.some(function (r) { return r && r.date === dStr; });
        if (alreadyChecked) return;
        p.records.push({
          date: dStr,
          value: 1,
          note: (fObj.name || '番茄专注') + ' ' + fObj.minutes + '分钟',
          source: 'pomodoro',
          at: new Date().toISOString()
        });
        if (Array.isArray(p.exemptDays)) {
          p.exemptDays = p.exemptDays.filter(function (d) { return d !== dStr; });
        }
      } else if (p.type === 'progress') {
        var unit = String(p.unit || '');
        // 仅对分钟/小时/番茄/次/节等专注相关单位自动累加，避免误加「页/词」计划（除非绑定了该课程或待办）
        var unitMatched = /分钟|min|小时|h|番茄|次|个|节/i.test(unit) || courseHit || taskHit || tagHit;
        if (!unitMatched) return;
        var addVal = 1;
        if (/分钟|min/i.test(unit)) addVal = fObj.minutes;
        else if (/小时|h/i.test(unit)) addVal = Math.round((fObj.minutes / 60) * 100) / 100;
        if (!(addVal > 0)) return;
        p.records.push({
          date: dStr,
          value: addVal,
          note: (fObj.name || '番茄专注') + ' ' + fObj.minutes + '分钟',
          source: 'pomodoro',
          at: new Date().toISOString()
        });
      } else {
        return;
      }

      var wasDone = p.done;
      self.refreshPlanDone(p);
      var gain = POMO.PLAN_CHECKIN + ((!wasDone && p.done) ? POMO.PLAN_DONE : 0);
      if (gain > 0) self.addPoints(gain, 'plan', dStr);
      synced.push(p.title);
    });
    return synced;
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
    var g = Store.state.pomodoro && Store.state.pomodoro.gacha;
    return (g && Array.isArray(g.wishlist)) ? g.wishlist : [];
  },

  /** 切换心愿单（最多同时追踪 2 名心愿干员） */
  toggleWishlist: function (name) {
    if (!name) return false;
    var g = Store.state.pomodoro.gacha;
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
    var g = Store.state.pomodoro && Store.state.pomodoro.gacha;
    return !!(g && Array.isArray(g.wishlist) && g.wishlist.indexOf(name) >= 0);
  },

  /** 计算心愿单未来轮换到货预报 */
  wishlistForecast: function () {
    var self = this;
    var g = (Store.state.pomodoro && Store.state.pomodoro.gacha) || {};
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
      var curJade = (Store.state.pomodoro && Store.state.pomodoro.jade) || 0;
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
    var g = Store.state.pomodoro.gacha;
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
    Store.state.pomodoro.gacha.currentPool = poolId;
    this.emit();
    this.save();
    return true;
  },

  /** 按池出一名干员（UP / 大保底 / 歪 / 共用低星） */
  pickPoolOp: function (poolId, r) {
    var pool = POMO.GACHA_POOLS[poolId] || POMO.GACHA_POOLS.standard;
    var st = this.gachaPoolState(poolId);
    var all = global.AK_OPS || [];

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
    Store.state.shop.log.unshift({ at: Date.now(), type: 'card', text: pool.name + ' 井兑换：' + name });
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
    var pid = poolId || Store.state.pomodoro.gacha.currentPool || 'standard';
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
    var pm = Store.state.pomodoro;
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
    var pm = Store.state.pomodoro;
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
          if (!Store.state.shop) Store.state.shop = { activeDays: {}, dupPool: [], log: [], card: null };
          if (!Array.isArray(Store.state.shop.dupPool)) Store.state.shop.dupPool = [];
          Store.state.shop.dupPool.push({ n: o.n, r: o.r, pts: pts, at: Date.now() });
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
    var pm = Store.state.pomodoro;
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
    return Store.state.pomodoro.gacha.ops.slice().sort(function (a, b) {
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
    Store.state.pomodoro.gacha = {
      pity6: 0, total: 0, ops: [], log: [],
      dailyGuaranteeDay: '', streakNo6: 0, streakNo5: 0, lastTen: null,
      currentPool: (Store.state.pomodoro.gacha.currentPool === 'classic') ? 'classic' : 'standard',
      pools: {
        standard: { pity6: 0, total: 0, spark: 0, guaranteed: false },
        classic: { pity6: 0, total: 0, spark: 0, guaranteed: false }
      },
      // 限定井进度归零，保留登记目标
      limited: { target: (Store.state.pomodoro.gacha.limited || {}).target || '', count: 0 }
    };
    // 清掉寻访相关成就（group 为「抽卡」「集卡」）的完成记录
    var ids = {};
    ACH_DEF.forEach(function (a) {
      if (a.group === '抽卡' || a.group === '集卡') ids[a.id] = 1;
    });
    if (Store.state.achievements && Store.state.achievements.done) {
      Object.keys(Store.state.achievements.done).forEach(function (k) {
        if (ids[k]) delete Store.state.achievements.done[k];
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
    return !!(Store.state.achievements && Store.state.achievements.done && Store.state.achievements.done[id]);
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
        if (!Store.state.achievements) Store.state.achievements = { done: {} };
        if (!Store.state.achievements.done) Store.state.achievements.done = {};
        Store.state.achievements.done[a.id] = { at: Date.now() };
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
    if (!Store.state.usage) Store.state.usage = {};
    Store.state.usage[key] = (Store.state.usage[key] || 0) + 1;
    this.checkAchievements(true);
    this.save();
    return Store.state.usage[key];
  },

  /** 寻访数据窗口：最近 100 抽 ∩ 近 30 天（取较小窗口） */
  gachaHistory: function () {
    var pm = Store.state.pomodoro;
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
    return (Store.state.pomodoro.focusMinutes || 0) / 60;
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
    Store.state.pomodoro.selectedSpecies = key;
    this.save();
    this.emit();
    return true;
  },

  /** 在空树位播下种子（种植免费）；无空位或未解锁返回 null */
  seedTree: function (speciesKey) {
    var pm = Store.state.pomodoro;
    var key = speciesKey || pm.selectedSpecies || 'camphor';
    if (!this.isSpeciesUnlocked(key)) return null;
    if (pm.trees.length >= POMO.GROVE_SLOTS) return null;
    var tree = { id: ctx.uid('tr'), species: key, stage: 1, prog: 0, withered: false, plantedAt: new Date().toISOString() };
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
    var pm = Store.state.pomodoro;
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
    var pm = Store.state.pomodoro;
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
    var pm = Store.state.pomodoro;
    var tree = this.getTree(id);
    if (!tree || tree.withered || tree.stage < 5) return false;
    pm.trees = pm.trees.filter(function (t) { return t.id !== id; });
    pm.harvested = (pm.harvested || 0) + 1;
    this.save();
    this.emit();
    return true;
  },

  getTree: function (id) {
    for (var i = 0; i < Store.state.pomodoro.trees.length; i++) {
      if (Store.state.pomodoro.trees[i].id === id) return Store.state.pomodoro.trees[i];
    }
    return null;
  },

  /** 专注统计：今日 / 本周 / 累计 */
  focusStats: function () {
    var today = DateUtil.toStr(DateUtil.today());
    var weekFrom = DateUtil.toStr(DateUtil.weekStart(DateUtil.today()));
    var todayMin = 0, weekMin = 0;
    (Store.state.pomodoro.sessions || []).forEach(function (x) {
      if (x.date === today) todayMin += x.minutes;
      if (x.date >= weekFrom) weekMin += x.minutes;
    });
    return { today: todayMin, week: weekMin, total: Store.state.pomodoro.focusMinutes };
  },

  /** 按标签汇总专注分钟：[{ full, lv1, lv2, minutes, count }] */
  focusByTag: function (ym) {
    var map = {};
    (Store.state.pomodoro.sessions || []).forEach(function (x) {
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

  /** 最近 7 天每天的专注分钟 */
  focusByDay: function (n) {
    n = n || 7;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = DateUtil.addDays(DateUtil.today(), -i);
      var ds = DateUtil.toStr(d);
      var m = 0;
      (Store.state.pomodoro.sessions || []).forEach(function (x) {
        if (x.date === ds) m += x.minutes;
      });
      out.push({ date: ds, d: d, minutes: m });
    }
    return out;
  },

  /** 保存计时器状态（刷新后仍可恢复） */
  saveTimer: function (t) {
    Store.state.pomodoro.timer = t;
    this.save(true);   // 计时状态要能经得起立刻刷新
  },
  });
})(window);
