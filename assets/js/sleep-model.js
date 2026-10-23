/* ==========================================================
 * 睡眠推算模型（纯函数，无 DOM / Store 依赖）
 * ----------------------------------------------------------
 * 目标：用「昨夜的完整睡眠结构」（深睡/浅睡/REM/清醒时长 + 入睡/醒来）
 * 推算一天的「高警觉时段 / 瞌睡时段 / 合适喝咖啡时段」。
 *
 * 设计原则：
 *   - 全部为纯函数，输入一个"夜"对象，输出可序列化结果，便于单测与离线推算。
 *   - 不关心数据从哪来（手环计时 / 截图 / CSV / Health Connect），
 *     数据源只负责把记录规范成 normalizeNight 能吃的形状。
 *   - 所有经验常数集中放在顶部 CONST，便于后续按真实数据标定。
 * ========================================================== */
(function (global) {
  'use strict';

  var CONST = {
    NEED_MIN: 480,          // 理想睡眠时长（分钟），8 小时
    DEF_AFTER_WAKE: 90,     // 咖啡窗口起点：醒后多少分钟（避开晨间皮质醇高峰）
    DEF_BEFORE_BED: 360,    // 咖啡窗口终点：睡前多少分钟（咖啡因半衰期≈5–6h）
    INERTIA_MIN: 30,        // 睡眠惯性窗口长度
    WIND_DOWN_MIN: 90,      // 睡前收尾窗口长度
    CAFFEINE_PEAK: 18,      // 咖啡因对警觉度的最高加成（0–100 分制）
    CAFFEINE_ONSET: 30,     // 起效时间（分钟）
    CAFFEINE_HALF: 300,     // 半衰期（分钟）
    STAGE_OK: 0.35          // 优质深睡+REM 占睡眠总时长比例（典型 35%–45%，取下限）
  };

  /* ---------- 基础工具 ---------- */

  function toMin(hhmm) {
    if (hhmm == null) return null;
    var s = String(hhmm).split(':');
    var h = parseInt(s[0], 10), m = parseInt(s[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 分钟 -> 'HH:MM'，支持负数与跨 1440 回绕（如 -300 -> 19:00，1500 -> 01:00）
  function minToHHMM(min) {
    min = Math.round(min);
    min = ((min % 1440) + 1440) % 1440;
    return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }

  // 把一条 sleeps 记录（或任何含 start/end 的"夜"）规范化为模型输入
  function normalizeNight(rec) {
    if (!rec) return null;
    var bed = toMin(rec.start), wake = toMin(rec.end);
    if (bed == null || wake == null) return null;
    if (wake <= bed) wake += 1440;            // 跨午夜：醒来时刻 +24h
    return {
      bed: bed,
      wake: wake,
      total: wake - bed,
      deep: num(rec.deep),
      light: num(rec.light),
      rem: num(rec.rem),
      awake: num(rec.awake),
      efficiency: num(rec.efficiency),
      awakenings: num(rec.awakenings),
      quality: rec.quality || 'normal'
    };
  }

  /* ---------- 警觉度基线 ---------- */

  // 昼夜警觉度基线（0–1），自变量为当地时刻分钟数 clockMin（0–1439）
  // 上午高峰 ~10:30，午后小谷 ~15:00，傍晚随昼夜节律缓降，深夜最低。
  // 锚定当地时刻而非"醒后小时数"，否则晚睡晚起者的"午后低谷"会被傍晚整体下滑带偏。
  function circadian(clockMin) {
    var H = (((clockMin % 1440) + 1440) % 1440) / 60;            // 当地小时
    var base = 0.5 + 0.42 * Math.cos((H - 10.5) / 24 * 2 * Math.PI); // 峰 10.5h，谷 22.5h
    var dip = 0.10 * Math.exp(-Math.pow((H - 15) / 1.3, 2));           // 午后小谷 ~15:00
    return clamp(base - dip, 0.05, 0.98);
  }

  // 睡眠质量系数（0.3–1）：时长达标 + 效率高 + 深睡/REM 占比合理
  function qualityFactor(night) {
    if (!night || !night.total) return 0.70;
    var durScore = clamp(night.total / CONST.NEED_MIN, 0.2, 1.1);
    var eff = night.efficiency != null ? clamp(night.efficiency / 100, 0.3, 1) : 0.90;
    var stageScore = 0.85;
    if (night.deep != null && night.rem != null && night.total > 0) {
      var deepRem = (night.deep + night.rem) / night.total;
      stageScore = clamp(deepRem / CONST.STAGE_OK, 0.4, 1.1);
    }
    return clamp(0.45 + 0.55 * durScore * eff * stageScore, 0.30, 1);
  }

  // 某时刻警觉度（0–100），h = 醒后小时数
  function alertnessAt(night, h) {
    if (!night) return null;
    var q = qualityFactor(night);
    var wakeClock = ((night.wake % 1440) + 1440) % 1440;
    var clock = wakeClock + h * 60;
    var c;
    if (h < 0.5) {
      // 睡眠惯性：醒后前 30 分钟被压低，再平滑接回昼夜曲线
      var c05 = circadian(wakeClock + 0.5 * 60);
      c = 0.35 + (c05 - 0.35) * (h / 0.5);
    } else {
      c = circadian(clock);
    }
    return Math.round(clamp(100 * q * c, 0, 100));
  }

  // 整日警觉度曲线：从醒来时刻起，覆盖 spanHours（默认 18h），步长 step 分钟
  // 返回 [{ h, clock, score }]，clock 为该日当地时刻 'HH:MM'
  function alertnessCurve(night, opts) {
    if (!night) return [];
    opts = opts || {};
    var step = opts.step || 15;
    var spanH = opts.spanHours || 18;
    var wakeClock = ((night.wake % 1440) + 1440) % 1440;
    var pts = [];
    for (var m = 0; m <= spanH * 60; m += step) {
      var h = m / 60;
      pts.push({
        h: h,
        clock: minToHHMM(wakeClock + m),
        score: alertnessAt(night, h)
      });
    }
    return pts;
  }

  /* ---------- 咖啡 / 瞌睡窗口 ---------- */

  // 合适喝咖啡时段：[醒后 DEF_AFTER_WAKE, 睡前 DEF_BEFORE_BED]
  function coffeeWindow(night, opts) {
    if (!night) return { valid: false, reason: 'no-sleep', start: '', end: '' };
    opts = opts || {};
    var after = opts.afterWake != null ? opts.afterWake : CONST.DEF_AFTER_WAKE;
    var before = opts.beforeBed != null ? opts.beforeBed : CONST.DEF_BEFORE_BED;
    var wakeClock = ((night.wake % 1440) + 1440) % 1440;
    var bedClock = ((night.bed % 1440) + 1440) % 1440;
    if (bedClock <= wakeClock) bedClock += 1440;   // 夜猫子：就寝在醒来之后，按次日晚算
    var start = wakeClock + after;
    var end = bedClock - before;
    var valid = end > start;
    return {
      start: minToHHMM(start),
      end: minToHHMM(end),
      valid: valid,
      reason: valid ? '' : 'window-too-narrow'
    };
  }

  // 瞌睡时段：睡眠惯性 + 午后低谷 + 睡前收尾
  function drowsinessWindows(night, opts) {
    if (!night) return [];
    opts = opts || {};
    var wakeClock = ((night.wake % 1440) + 1440) % 1440;
    var bedClock = ((night.bed % 1440) + 1440) % 1440;
    if (bedClock <= wakeClock) bedClock += 1440;
    var inertia = opts.inertia != null ? opts.inertia : CONST.INERTIA_MIN;
    var wind = opts.windDown != null ? opts.windDown : CONST.WIND_DOWN_MIN;

    var out = [{
      type: 'inertia',
      start: minToHHMM(wakeClock),
      end: minToHHMM(wakeClock + inertia),
      note: '刚醒，注意力尚未恢复'
    }];

    // 午后低谷：固定在当地 15:00 附近（受"醒后≥5h、睡前≥2h"约束），
    // 不随曲线单调性漂移——否则晚睡者会被傍晚整体下滑误判成"午后"。
    var center = 15 * 60;
    if (center < wakeClock + 5 * 60) center = wakeClock + 5 * 60;
    if (center > bedClock - 2 * 60) center = bedClock - 2 * 60;
    out.push({
      type: 'afternoon',
      start: minToHHMM(center - 45),
      end: minToHHMM(center + 45),
      note: '午后生理低谷，最易犯困'
    });

    out.push({
      type: 'winddown',
      start: minToHHMM(bedClock - wind),
      end: minToHHMM(bedClock),
      note: '临近入睡，避免刺激与咖啡因'
    });
    return out;
  }

  // 给已有曲线叠加咖啡因效应（coffeeClock 为 'HH:MM'），返回新曲线
  function applyCaffeine(curve, coffeeClock, opts) {
    if (!curve || !curve.length) return curve;
    opts = opts || {};
    var peak = opts.peak != null ? opts.peak : CONST.CAFFEINE_PEAK;
    var onset = opts.onset != null ? opts.onset : CONST.CAFFEINE_ONSET;
    var half = opts.halfLife != null ? opts.halfLife : CONST.CAFFEINE_HALF;
    var start = toMin(coffeeClock);
    if (start == null) return curve;
    return curve.map(function (p) {
      var t = toMin(p.clock) - start;
      if (t < 0) return p;
      var boost = peak * (1 - Math.exp(-t / onset)) * Math.exp(-t / half);
      return { h: p.h, clock: p.clock, score: clamp(p.score + boost, 0, 100) };
    });
  }

  /* ---------- 截图 -> 睡眠（P2 解析器，按真实 OCR 校准） ----------
   * 依据 tesseract.js（chi_sim best_int、psm4）对小米运动健康 6.x 真机截图的实测输出设计：
   *  - 数字错字有规律：7→了、4→个、%→x/X，"分钟"→"分名/分针/分钙"
   *  - 详情页每行「阶段名 占比 偏高/偏低 时长」，下方有「参考: 15%-20%」锚点行
   *  - 总览页是「值行在上、标签行在下」的网格，值可能散落
   * 策略：标签匹配 + 参考范围锚定双路取值，再用约束自动纠错：
   *  深+浅+REM=总时长、效率≈总时长/卧床时长、阶段时长必须小于总时长。
   */

  // OCR 数字混淆候选：同一字符可能是哪个数字
  var DIG_ALT = {
    '0': [0], '1': [1], '2': [2], '3': [3], '4': [4], '5': [5],
    '6': [6], '7': [7], '8': [8], '9': [9],
    '了': [7], '个': [4], '涉': [4], 'O': [0], 'o': [0], '〇': [0], '○': [0],
    '一': [1], '二': [2], '三': [3, 5], '四': [4], '五': [5],
    '六': [6], '七': [7], '八': [8], '九': [9]
  };
  var NUMTOK = '0-9○O〇了个涉一二三四五六七八九十';

  function numAlts(tok) {
    var alts = [0];
    for (var i = 0; i < tok.length; i++) {
      var d = DIG_ALT[tok[i]];
      if (!d) return null;
      var next = [];
      for (var a = 0; a < alts.length; a++) {
        for (var b = 0; b < d.length; b++) next.push(alts[a] * 10 + d[b]);
      }
      alts = next.length > 8 ? next.slice(0, 8) : next;
    }
    return alts;
  }

  /** 扫一行里的时长 token：[{min, alt:[...]}]。前缀是 晚/迟 的是「入睡规律性」，跳过 */
  function scanDurs(s) {
    var out = [], m, TOK = '[' + NUMTOK + ']';
    // hGroup/mGroup 指明哪个捕获组是小时/分钟（0=无）
    // A: 7小时 / 7小时6分名；B: 7时6分（无「小」，两部分数字都须在场，避免「了时分」误判）；C: 3分针（纯分钟）
    var PATS = [
      { re: '(' + TOK + '{1,2})小时(?:(' + TOK + '{1,2})分?)?', h: 1, m: 2 },
      { re: '(' + TOK + '{1,2})小?时(' + TOK + '{1,2})分', h: 1, m: 2 },
      { re: '(' + TOK + '{1,3})分', h: 0, m: 1 }
    ];
    PATS.forEach(function (p) {
      var g = new RegExp(p.re, 'g');
      while ((m = g.exec(s))) {
        var pv = m.index > 0 ? s[m.index - 1] : '';
        if (pv === '晚' || pv === '迟') continue;
        // 已被更长的模式覆盖的不重复算
        var inside = out.some(function (d) {
          var pos = s.indexOf(d.text);
          return pos >= 0 && m.index >= pos && m.index < pos + d.text.length;
        });
        if (inside) continue;
        var hs = p.h ? numAlts(m[p.h]) : [0];
        if (!hs) continue;
        var ms = p.m ? (m[p.m] ? numAlts(m[p.m]) : [0]) : [0];
        if (!ms) ms = [0];
        var mins = [];
        hs.forEach(function (h) { ms.forEach(function (mm) { mins.push(h * 60 + mm); }); });
        out.push({ min: mins[0], alt: mins, text: m[0] });
      }
    });
    return out;
  }

  /** 扫一行里的占比：29x / 14% / 57%（“5”常被认成别的字，取不到就取不到） */
  function scanPcts(s) {
    var out = [], m;
    var re = /(\d{1,3})\s*[x×X%]/g;
    while ((m = re.exec(s))) {
      var v = +m[1];
      if (v >= 3 && v <= 100) out.push(v);
    }
    return out;
  }

  /** 模糊阶段标签（睡/眠/动 等关键字常被认错，用最稳定的单字兜） */
  function stageOf(t) {
    if (/深/.test(t)) return 'deep';
    if (/浅/.test(t)) return 'light';
    if (/眼动|限动|腿动|REM/i.test(t)) return 'rem';
    if (/清[醒弄柄]/.test(t)) return 'awake';
    return null;
  }

  /** 参考范围行 -> 阶段（小米详情页固定：清醒 0-2次 / REM 20%-25% / 浅睡 55%-75% / 深睡 15%-20%） */
  function refStageOf(t) {
    var m2 = t.match(/(\d+)\s*[-~—]\s*(\d+)\s*次/);
    if (m2 && +m2[1] === 0) return 'awake';
    var m = t.match(/(\d{1,3})\s*%?\s*[-~—]\s*(\d{1,3})\s*%?/);
    if (!m) return null;
    var a = +m[1], b = +m[2];
    while (a > 100) a = Math.floor(a / 10);   // "202%-25%" -> 20
    if (a === 55 || b === 75) return 'light';
    if (a === 20 && b === 25) return 'rem';
    if (a === 15 && b === 20) return 'deep';
    if (a === 0) return 'awake';
    return null;
  }

  function scanEff(s) {
    var out = [], m;
    var re = /(\d{1,3})\s*[%xX×"”]/g;
    while ((m = re.exec(s))) {
      var v = +m[1];
      if (v >= 50 && v <= 100) out.push(v);
    }
    return out;
  }

  function uniqPush(arr, v) {
    if (v != null && arr.indexOf(v) < 0) arr.push(v);
  }

  function parseSleepShot(lines) {
    if (!lines || !lines.length) return null;
    var C = lines.map(function (l) {
      return String(l).replace(/\s+/g, '').replace(/％/g, '%');
    });

    /* 日期：2026年10月23日 / 2026-10-23 / 10月23日 */
    var date = '';
    for (var i = 0; i < C.length; i++) {
      var dm = C[i].match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
      if (dm) { date = dm[1] + '-' + pad(+dm[2]) + '-' + pad(+dm[3]); break; }
      var dm2 = C[i].match(/(\d{1,2})月(\d{1,2})日/);
      if (dm2) { date = new Date().getFullYear() + '-' + pad(+dm2[1]) + '-' + pad(+dm2[2]); break; }
    }

    /* 起止时间：两遍扫——先同行标签（入睡02:49 / 醒来09:58），
       再用上下文配对（总览页是「值在上、标签在下」的网格） */
    var bed = null, wake = null;
    var timeRows = [];
    for (i = 0; i < C.length; i++) {
      var tm = C[i].match(/(\d{1,2})[:：](\d{2})/);
      if (!tm) continue;
      var hh = +tm[1];
      if (hh > 23) continue;
      timeRows.push({ i: i, time: pad(hh) + ':' + tm[2], line: C[i] });
    }
    timeRows.forEach(function (r) {
      if (/醒|起床/.test(r.line) && wake == null) wake = r.time;
      else if (/入|就寝/.test(r.line) && !/规律/.test(r.line) && bed == null) bed = r.time;
    });
    timeRows.forEach(function (r) {
      if (wake != null && bed != null) return;
      var ctx = r.line + '\n' + (C[r.i - 1] || '') + '\n' + (C[r.i + 1] || '');
      if (wake == null && /醒|起床/.test(ctx) && !/入|就寝/.test(r.line)) wake = r.time;
      else if (bed == null && /入|就寝/.test(ctx) && !/规律/.test(ctx) && !/醒|起床/.test(r.line)) bed = r.time;
    });

    /* 每行时长/占比预扫描 */
    var durs = C.map(scanDurs);
    var pcts = C.map(scanPcts);

    /* 总时长：带「时长」标签行的同/上/下一行里最大的合理值；兜底找无阶段标签的长时长 */
    var total = null;
    for (i = 0; i < C.length; i++) {
      if (!/时长/.test(C[i])) continue;
      var rows = [i + 1, i, i - 1];
      for (var k = 0; k < rows.length && total == null; k++) {
        var j = rows[k];
        if (j < 0 || j >= C.length || !durs[j].length) continue;
        durs[j].forEach(function (d) {
          d.alt.forEach(function (v) {
            if (v >= 60 && v <= 900 && (total == null || v > total)) total = v;
          });
        });
      }
      if (total != null) break;
    }
    if (total == null) {
      for (i = 0; i < C.length; i++) {
        if (stageOf(C[i]) || /参考|规律/.test(C[i])) continue;
        durs[i].forEach(function (d) {
          d.alt.forEach(function (v) {
            if (v >= 240 && v <= 900 && (total == null || v < total)) total = v;
          });
        });
      }
    }

    /* 各阶段候选：标签行（同/上/下一行）+ 参考范围行锚定 */
    var stageC = { deep: { durs: [], pcts: [] }, light: { durs: [], pcts: [] },
                   rem: { durs: [], pcts: [] }, awake: { durs: [], pcts: [] } };

    function collect(idx, st) {
      durs[idx].forEach(function (d) { stageC[st].durs.push(d); });
      pcts[idx].forEach(function (p) { uniqPush(stageC[st].pcts, p); });
    }

    for (i = 0; i < C.length; i++) {
      var st = stageOf(C[i]);
      if (!st || /参考/.test(C[i])) continue;
      var got = false;
      var near = [i, i + 1, i - 1];
      for (var k2 = 0; k2 < near.length; k2++) {
        var j2 = near[k2];
        if (j2 < 0 || j2 >= C.length) continue;
        if (j2 !== i && (stageOf(C[j2]) || /参考/.test(C[j2]))) continue;
        if (durs[j2].length || pcts[j2].length) { collect(j2, st); got = true; break; }
      }
      if (!got && i + 1 < C.length) collect(i + 1, st);   // 散行兜底（如「深睦仅 / 点14%」）
    }
    for (i = 0; i < C.length; i++) {
      if (!/参[考者]/.test(C[i])) continue;
      var st2 = refStageOf(C[i]);
      if (!st2) continue;
      for (var k3 = 1; k3 <= 3 && i - k3 >= 0; k3++) {
        var j3 = i - k3;
        if (stageOf(C[j3]) && !/参考/.test(C[j3])) { collect(j3, st2); break; }
        if (durs[j3].length || pcts[j3].length) { collect(j3, st2); break; }
      }
    }

    /* 清醒次数 */
    var awakenings = null;
    for (i = 0; i < C.length; i++) {
      if (/参考/.test(C[i])) continue;
      var cm = C[i].match(/(\d{1,2})\s*次/);
      if (!cm) continue;
      var cv = +cm[1];
      if (cv <= 20 && (stageOf(C[i]) === 'awake' || /次数/.test(C[i] + (C[i + 1] || '') + (C[i - 1] || '')))) {
        awakenings = cv;
        break;
      }
    }

    /* 睡眠效率：候选取「最接近 总时长/卧床时长」的那个。
       标签放宽到「率」——「效」字常被 conf 过滤丢掉（如「清醒次数率入规律性」） */
    var effCands = [];
    for (i = 0; i < C.length; i++) {
      if (!/率/.test(C[i])) continue;
      [i, i + 1, i - 1].forEach(function (j) {
        if (j < 0 || j >= C.length) return;
        if (/范[围闺园]|合理/.test(C[j])) return;   // 「合理范围: 85%~100%」不是效率值
        scanEff(C[j]).forEach(function (v) { uniqPush(effCands, v); });
      });
    }

    /* 卧床时长（跨午夜） */
    var span = null;
    if (bed && wake) {
      var a1 = toMin(bed), b1 = toMin(wake);
      span = b1 >= a1 ? b1 - a1 : 1440 - a1 + b1;
      if (span <= 0 || span > 1080) span = null;
    }

    var efficiency = null;
    if (effCands.length) {
      if (span && total) {
        var exp = Math.round(total / span * 100);
        effCands.sort(function (x, y) { return Math.abs(x - exp) - Math.abs(y - exp); });
      }
      efficiency = effCands[0];
    }

    /* 阶段合成：时长候选 + 占比×总时长候选，穷举取「和=总时长」误差最小的组合 */
    function stageOpts(st) {
      var out = [];
      stageC[st].durs.forEach(function (d) {
        d.alt.forEach(function (v) { if (v > 0 && (total == null || v < total)) uniqPush(out, v); });
      });
      if (total) {
        stageC[st].pcts.forEach(function (p) { uniqPush(out, Math.round(total * p / 100)); });
      }
      return out;
    }

    var deep = null, light = null, rem = null, awake = null;
    var oD = stageOpts('deep'), oL = stageOpts('light'), oR = stageOpts('rem');
    var oA = stageC.awake.durs.length ? [stageC.awake.durs[0].min] : [];

    if (total == null && oD.length && oL.length && oR.length) {
      // 没有总时长：三项齐全时直接用时长并反推总量
      deep = oD[0]; light = oL[0]; rem = oR[0];
      total = deep + light + rem;
    } else if (total != null) {
      var D2 = oD.length ? oD : [null], L2 = oL.length ? oL : [null], R2 = oR.length ? oR : [null];
      var best = null;
      D2.forEach(function (d) {
        L2.forEach(function (l) {
          R2.forEach(function (r) {
            var vals = [d, l, r], miss = 0, sum = 0;
            vals.forEach(function (v) { if (v == null) miss++; else sum += v; });
            if (miss > 1) return;
            var der = miss === 1 ? total - sum : 0;
            if (miss === 1 && (der < 0 || der > total)) return;
            var score = Math.abs(sum + der - total) + (miss === 1 ? 0.5 : 0);
            if (!best || score < best.score) best = { score: score, deep: d, light: l, rem: r };
          });
        });
      });
      if (best) {
        deep = best.deep; light = best.light; rem = best.rem;
        // 唯一缺失的阶段由总量反推（如浅睡标签整行被 conf 过滤丢弃时）
        if ([deep, light, rem].filter(function (v) { return v == null; }).length === 1) {
          var der = total - (deep || 0) - (light || 0) - (rem || 0);
          if (der >= 0 && der <= total) {
            if (deep == null) deep = der;
            else if (light == null) light = der;
            else rem = der;
          }
        }
      }
      if (oA.length && oA[0] < (total || 1e9)) awake = oA[0];
      else if (stageC.awake.pcts.length && total) awake = Math.round(total * stageC.awake.pcts[0] / 100);
    }

    /* 效率与「总时长/卧床时长」明显矛盾时宁可丢弃 */
    if (efficiency != null && span && total) {
      var exp2 = Math.round(total / span * 100);
      if (Math.abs(efficiency - exp2) > 5) efficiency = null;
    }

    var quality = /良好|质量好|睡得?很?好/.test(C.join('')) ? 'good'
      : (efficiency != null && efficiency >= 90) ? 'good'
      : (efficiency != null && efficiency < 75) ? 'bad' : 'normal';

    if (!bed && !wake && total == null && effCands.length === 0) return null;

    return {
      date: date,
      start: bed,
      end: wake,
      total: total,
      deep: deep,
      light: light,
      rem: rem,
      awake: awake,
      efficiency: efficiency,
      awakenings: awakenings,
      quality: quality,
      source: 'shot',
      _raw: {
        effCands: effCands,
        pcts: { deep: stageC.deep.pcts, light: stageC.light.pcts, rem: stageC.rem.pcts, awake: stageC.awake.pcts }
      }
    };
  }

  /**
   * 多张截图的结果合并（详情页 + 总览页）。
   * 字段取第一个非空值；效率在多候选时选最接近「总时长/卧床时长」的。
   */
  function mergeShotResults(list) {
    var rs = (list || []).filter(Boolean);
    if (!rs.length) return null;
    if (rs.length === 1) return rs[0];

    var out = { source: 'shot' };
    var FIELDS = ['date', 'start', 'end', 'total', 'deep', 'light', 'rem', 'awake', 'awakenings'];
    FIELDS.forEach(function (f) {
      for (var i = 0; i < rs.length; i++) {
        if (rs[i][f] != null && rs[i][f] !== '') { out[f] = rs[i][f]; return; }
      }
    });

    // 日期冲突：以第一张为准并标记
    var dates = rs.map(function (r) { return r.date; }).filter(Boolean);
    if (dates.length && dates.some(function (d) { return d !== dates[0]; })) out._dateConflict = dates;

    // 效率：收集所有候选（含各自 _raw），用 span 校验挑最合理的
    var effAll = [];
    rs.forEach(function (r) {
      if (r.efficiency != null) effAll.push(r.efficiency);
      ((r._raw && r._raw.effCands) || []).forEach(function (v) { uniqPush(effAll, v); });
    });
    var span2 = null;
    if (out.start && out.end) {
      var a = toMin(out.start), b = toMin(out.end);
      span2 = b >= a ? b - a : 1440 - a + b;
      if (span2 <= 0 || span2 > 1080) span2 = null;
    }
    if (effAll.length) {
      if (span2 && out.total) {
        var exp = Math.round(out.total / span2 * 100);
        effAll.sort(function (x, y) { return Math.abs(x - exp) - Math.abs(y - exp); });
      }
      out.efficiency = effAll[0];
    }

    // 丢掉合并后与 span 矛盾的效率
    if (out.efficiency != null && span2 && out.total) {
      var exp2 = Math.round(out.total / span2 * 100);
      if (Math.abs(out.efficiency - exp2) > 5) delete out.efficiency;
    }

    out.quality = out.efficiency != null
      ? (out.efficiency >= 90 ? 'good' : out.efficiency < 75 ? 'bad' : 'normal')
      : (rs.some(function (r) { return r.quality === 'good'; }) ? 'good' : 'normal');
    out._raw = rs[0]._raw || {};
    return out;
  }

  global.SleepModel = {
    CONST: CONST,
    toMin: toMin,
    minToHHMM: minToHHMM,
    normalizeNight: normalizeNight,
    circadian: circadian,
    qualityFactor: qualityFactor,
    alertnessAt: alertnessAt,
    alertnessCurve: alertnessCurve,
    coffeeWindow: coffeeWindow,
    drowsinessWindows: drowsinessWindows,
    applyCaffeine: applyCaffeine,
    parseSleepShot: parseSleepShot,
    mergeShotResults: mergeShotResults
  };
})(typeof window !== 'undefined' ? window : globalThis);
