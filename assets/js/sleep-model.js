/* ==========================================================
 * 睡眠推算模型（纯函数，无 DOM / Store 依赖）
 * ----------------------------------------------------------
 * 目标：用「昨夜的完整睡眠结构」（深睡/浅睡/REM/清醒时长 + 入睡/醒来）
 * 推算一天的「高警觉时段 / 瞌睡时段 / 合适喝咖啡时段」，并提供：
 *   - 自然语言睡眠速记解析（parseQuickSleep / SleepNLP）
 *   - 小米运动健康风格的睡眠综合评分、四维分期画像与睡眠动物标签（sleepScoreAndProfile）
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

  /* ---------- 截图 -> 睡眠（P2 解析器，按真实 OCR 校准） ---------- */

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

  function scanDurs(s) {
    var out = [], m, TOK = '[' + NUMTOK + ']';
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

  function scanPcts(s) {
    var out = [], m;
    var re = /(\d{1,3})\s*[x×X%]/g;
    while ((m = re.exec(s))) {
      var v = +m[1];
      if (v >= 3 && v <= 100) out.push(v);
    }
    return out;
  }

  function stageOf(t) {
    if (/深/.test(t)) return 'deep';
    if (/浅/.test(t)) return 'light';
    if (/眼动|限动|腿动|REM/i.test(t)) return 'rem';
    if (/清[醒弄柄]/.test(t)) return 'awake';
    return null;
  }

  function refStageOf(t) {
    var m2 = t.match(/(\d+)\s*[-~—]\s*(\d+)\s*次/);
    if (m2 && +m2[1] === 0) return 'awake';
    var m = t.match(/(\d{1,3})\s*%?\s*[-~—]\s*(\d{1,3})\s*%?/);
    if (!m) return null;
    var a = +m[1], b = +m[2];
    while (a > 100) a = Math.floor(a / 10);
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

    var date = '';
    for (var i = 0; i < C.length; i++) {
      var dm = C[i].match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
      if (dm) { date = dm[1] + '-' + pad(+dm[2]) + '-' + pad(+dm[3]); break; }
      var dm2 = C[i].match(/(\d{1,2})月(\d{1,2})日/);
      if (dm2) { date = new Date().getFullYear() + '-' + pad(+dm2[1]) + '-' + pad(+dm2[2]); break; }
    }

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

    var durs = C.map(scanDurs);
    var pcts = C.map(scanPcts);

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
      if (!got && i + 1 < C.length) collect(i + 1, st);
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

    var effCands = [];
    for (i = 0; i < C.length; i++) {
      if (!/率/.test(C[i])) continue;
      [i, i + 1, i - 1].forEach(function (j) {
        if (j < 0 || j >= C.length) return;
        if (/范[围闺园]|合理/.test(C[j])) return;
        scanEff(C[j]).forEach(function (v) { uniqPush(effCands, v); });
      });
    }

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

    var dates = rs.map(function (r) { return r.date; }).filter(Boolean);
    if (dates.length && dates.some(function (d) { return d !== dates[0]; })) out._dateConflict = dates;

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

  /* ---------- 自然语言睡眠速记解析（parseQuickSleep / SleepNLP） ----------
   * 支持示例：
   *   - "昨晚1点20到8点半 深睡1h30m 浅睡4h REM1h15m 醒2次 效率91%"
   *   - "23:40-07:20 深睡95m 浅睡240m 眼动85m 清醒15m"
   *   - "昨晚11点半睡 7点15起 睡得很好"
   *   - "10月22日 0:30~8:00 深1.5h"
   */
  function shiftDateStr(dateStr, deltaDays) {
    if (!dateStr) return '';
    var p = String(dateStr).split('-');
    if (p.length !== 3) return dateStr;
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    d.setDate(d.getDate() + deltaDays);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseFlexDur(chunk) {
    if (!chunk) return null;
    var s = String(chunk).trim();
    // 7个半小时 / 7小时半
    var halfH = s.match(/(\d{1,2})\s*(?:个)?半\s*(?:h|hr|小时|时)|(\d{1,2})\s*(?:h|hr|小时|时)\s*半/i);
    if (halfH) {
      return (parseInt(halfH[1] || halfH[2], 10) || 0) * 60 + 30;
    }
    // 1.5h / 1.5小时
    var decH = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|小时|时)(?!\s*\d)/i);
    if (decH && s.indexOf('.') >= 0) {
      return Math.round(parseFloat(decH[1]) * 60);
    }
    // 1h30m / 1小时30分 / 1时20分
    var hm = s.match(/(\d{1,2})\s*(?:h|hr|小时|时)\s*(\d{1,2})?\s*(?:m|min|分钟|分)?/i);
    if (hm) {
      var h = parseInt(hm[1], 10) || 0;
      var m = hm[2] != null ? (parseInt(hm[2], 10) || 0) : 0;
      return h * 60 + m;
    }
    // 95m / 95分 / 95分钟
    var mm = s.match(/(\d{1,3})\s*(?:m|min|分钟|分)/i);
    if (mm) return parseInt(mm[1], 10);
    // 纯数字（紧跟在阶段名后）
    var bare = s.match(/^[:：\s]*(\d{1,3})(?:\b|$)/);
    if (bare) return parseInt(bare[1], 10);
    return null;
  }

  function normClockPoint(hRaw, mRaw, periodHint, isBedSide) {
    var h = parseInt(hRaw, 10);
    var m = mRaw === '半' ? 30 : (mRaw ? parseInt(mRaw, 10) : 0);
    if (isNaN(h) || isNaN(m) || m < 0 || m > 59) return null;
    if (periodHint && /晚|夜|pm/i.test(periodHint) && h >= 1 && h <= 11) {
      h += 12;
    } else if (periodHint && /凌晨|早|晨|am/i.test(periodHint) && h === 12) {
      h = 0;
    } else if (isBedSide && !periodHint && h >= 7 && h <= 11) {
      // 入睡侧说「10点半」「11点20」默认指晚上 22:30 / 23:20
      h += 12;
    }
    if (h === 24) h = 0;
    if (h < 0 || h > 23) return null;
    return pad(h) + ':' + pad(m);
  }

  function parseQuickSleep(text, baseDateStr) {
    var raw = String(text || '').trim();
    var out = {
      ok: false,
      date: baseDateStr || '',
      start: null,
      end: null,
      total: null,
      deep: null,
      light: null,
      rem: null,
      awake: null,
      awakenings: null,
      efficiency: null,
      quality: null
    };
    if (!raw) return out;

    // 1. 解析日期（如 2026-10-22 / 10月22日 / 昨晚 / 前晚 / 昨天）
    var isoDate = raw.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/);
    var mdDate = !isoDate && raw.match(/(\d{1,2})月(\d{1,2})[日号]?/);
    if (isoDate) {
      out.date = isoDate[1] + '-' + pad(+isoDate[2]) + '-' + pad(+isoDate[3]);
    } else if (mdDate) {
      var yr = baseDateStr ? parseInt(baseDateStr.slice(0, 4), 10) : new Date().getFullYear();
      out.date = yr + '-' + pad(+mdDate[1]) + '-' + pad(+mdDate[2]);
    } else if (baseDateStr) {
      if (/前天|前晚|前夜/.test(raw)) out.date = shiftDateStr(baseDateStr, -1);
      // 「昨晚/昨夜/今早/今天」在按醒来日归属的口径下均对应当日 baseDateStr（入睡跨零点则在保存时修正）
    }

    // 2. 解析起止时间段
    // 支持：23:30-07:15 / 1点20到8点半 / 昨晚11点半睡 7点20起
    var TIME_PT = '(?:(昨晚|昨夜|晚上|夜里|凌晨|早上|今早|上午)?\\s*(\\d{1,2})\\s*(?:[:：点时]\\s*(?:(半|\\d{1,2})\\s*分?)?)?)';
    var rangeRe = new RegExp(TIME_PT + '\\s*(?:[-~—–至到]|睡\\s*(?:到|至)?\\s*[,，]?\\s*)' + TIME_PT + '(?:\\s*(?:醒|起|起床))?');
    var rm = raw.match(rangeRe);
    if (rm && (raw.indexOf(':') >= 0 || raw.indexOf('：') >= 0 || /点|到|至|-|~|—|睡/.test(rm[0]))) {
      var st = normClockPoint(rm[2], rm[3], rm[1], true);
      var et = normClockPoint(rm[5], rm[6], rm[4], false);
      if (st && et) {
        out.start = st;
        out.end = et;
      }
    }
    if (!out.start || !out.end) {
      // 分别匹配「X点Y睡」和「X点Y起/醒」
      var mBed = raw.match(/(?:入睡|就寝)?\s*(昨晚|晚上|凌晨)?\s*(\d{1,2})\s*(?:[:：点时]\s*(半|\d{1,2})?\s*分?)\s*(?:入睡|睡|躺)?/);
      var mWake = raw.match(/(?:醒来|起床)?\s*(早上|今早|凌晨)?\s*(\d{1,2})\s*(?:[:：点时]\s*(半|\d{1,2})?\s*分?)\s*(?:醒来|醒|起|起床)/);
      if (mBed && mWake && mBed[0] !== mWake[0]) {
        out.start = normClockPoint(mBed[2], mBed[3], mBed[1], true);
        out.end = normClockPoint(mWake[2], mWake[3], mWake[1], false);
      }
    }

    // 3. 解析四维分期时长（深睡 / 浅睡 / REM / 清醒）
    var stageDefs = [
      { key: 'deep', re: /(?:深睡|深眠|深)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:h|hr|小时|时)(?:\s*\d{1,2}\s*(?:m|min|分钟|分)?)?|\d{1,3}\s*(?:m|min|分钟|分)?)/i },
      { key: 'light', re: /(?:浅睡|浅眠|浅)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:h|hr|小时|时)(?:\s*\d{1,2}\s*(?:m|min|分钟|分)?)?|\d{1,3}\s*(?:m|min|分钟|分)?)/i },
      { key: 'rem', re: /(?:快速眼动|眼动|REM)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:h|hr|小时|时)(?:\s*\d{1,2}\s*(?:m|min|分钟|分)?)?|\d{1,3}\s*(?:m|min|分钟|分)?)/i },
      { key: 'awake', re: /(?:清醒时长|清醒)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:h|hr|小时|时)(?:\s*\d{1,2}\s*(?:m|min|分钟|分)?)?|\d{1,3}\s*(?:m|min|分钟|分))(?!\s*次)/i }
    ];
    stageDefs.forEach(function (sd) {
      var sm = raw.match(sd.re);
      if (sm) {
        var mins = parseFlexDur(sm[1]);
        if (mins != null && mins >= 0 && mins <= 720) out[sd.key] = mins;
      }
    });

    // 4. 清醒次数 & 睡眠效率 & 主观质量
    var awkM = raw.match(/(?:清醒|醒了?|夜醒)\s*(\d{1,2})\s*次/);
    if (awkM) out.awakenings = parseInt(awkM[1], 10);

    var effM = raw.match(/(?:效率|得分)\s*[:：]?\s*(\d{2,3})\s*%?/);
    if (effM) {
      var ev = parseInt(effM[1], 10);
      if (ev >= 40 && ev <= 100) out.efficiency = ev;
    }

    if (/睡得?很?好|充沛|优质|极佳/.test(raw)) out.quality = 'good';
    else if (/没睡好|失眠|很差|糟糕|断断续续/.test(raw)) out.quality = 'bad';
    else if (/一般|还行|普通/.test(raw)) out.quality = 'normal';

    // 5. 计算总时长与自动补全
    if (out.start && out.end) {
      var sMin = toMin(out.start), eMin = toMin(out.end);
      var spanMin = eMin > sMin ? (eMin - sMin) : (1440 - sMin + eMin);
      var stageSum = (out.deep || 0) + (out.light || 0) + (out.rem || 0);
      if (stageSum > 0 && stageSum <= spanMin) {
        out.total = stageSum;
      } else {
        out.total = Math.max(0, spanMin - (out.awake || 0));
      }
      if (out.efficiency == null && spanMin > 0 && out.total > 0) {
        out.efficiency = clamp(Math.round(out.total / spanMin * 100), 50, 100);
      }
    } else if ((out.deep || 0) + (out.light || 0) + (out.rem || 0) > 0) {
      out.total = (out.deep || 0) + (out.light || 0) + (out.rem || 0);
    } else {
      var totM = raw.match(/(?:睡了|总时长|睡眠|共)\s*(\d{1,2}\s*(?:个)?半\s*(?:h|hr|小时|时)|\d+(?:\.\d+)?\s*(?:h|hr|小时|时)(?:\s*(?:半|\d{1,2}\s*(?:m|min|分钟|分)?))?|\d{2,3}\s*(?:m|min|分钟|分))/i);
      if (totM) out.total = parseFlexDur(totM[1]);
    }

    if (!out.quality && out.efficiency != null) {
      out.quality = out.efficiency >= 90 ? 'good' : (out.efficiency < 75 ? 'bad' : 'normal');
    }

    out.ok = !!(out.start && out.end) || out.total != null || out.deep != null || out.light != null || out.rem != null;
    return out;
  }

  /* ---------- 小米运动健康风格：睡眠综合评分、四维分期画像与时序色带 ---------- */
  function sleepScoreAndProfile(rec) {
    if (!rec) return null;
    var night = normalizeNight(rec);
    var total = (rec.total != null && Number(rec.total) > 0)
      ? Number(rec.total)
      : (night ? night.total : 0);
    if (!(total > 0)) return null;

    var deep = rec.deep != null ? Number(rec.deep) : null;
    var light = rec.light != null ? Number(rec.light) : null;
    var rem = rec.rem != null ? Number(rec.rem) : null;
    var awake = rec.awake != null ? Number(rec.awake) : 0;
    var hasStages = (deep != null && deep > 0) || (light != null && light > 0) || (rem != null && rem > 0);

    // 若只有深睡+REM而缺浅睡，自动补齐浅睡
    if (hasStages && light == null && deep != null && rem != null && total > deep + rem) {
      light = Math.max(0, total - deep - rem);
    }
    var stageTotal = hasStages ? Math.max(total, (deep || 0) + (light || 0) + (rem || 0)) : total;
    var inBed = stageTotal + Math.max(0, awake || 0);

    var deepPct = hasStages && deep != null ? Math.round(deep / stageTotal * 100) : null;
    var lightPct = hasStages && light != null ? Math.round(light / stageTotal * 100) : null;
    var remPct = hasStages && rem != null ? Math.round(rem / stageTotal * 100) : null;
    var awakePct = inBed > 0 ? Math.round((awake || 0) / inBed * 100) : 0;

    // 综合得分 (0-100)：时长 45 分 + 结构 25 分 + 效率/连续性 20 分 + 作息早晚 10 分
    var durRatio = clamp(total / 460, 0.35, 1.06);
    var durPts = Math.round(clamp(durRatio * 45, 12, 45));

    var structPts = 20;
    if (hasStages) {
      var dOk = deepPct != null ? (deepPct >= 15 && deepPct <= 28 ? 13 : (deepPct >= 10 ? 9 : 6)) : 10;
      var rOk = remPct != null ? (remPct >= 18 && remPct <= 28 ? 12 : (remPct >= 12 ? 9 : 6)) : 10;
      structPts = dOk + rOk;
    }

    var eff = rec.efficiency != null ? Number(rec.efficiency) : (inBed > 0 ? Math.round(stageTotal / inBed * 100) : 92);
    var awk = rec.awakenings != null ? Number(rec.awakenings) : (awake > 10 ? 2 : (awake > 0 ? 1 : 0));
    var effPts = Math.round(clamp((eff - 65) / 30 * 14, 4, 14)) + Math.max(0, 6 - awk * 2);

    var bedClock = night ? ((night.bed % 1440) + 1440) % 1440 : 1410;
    // 22:00 (1320) ~ 23:45 (1425) 最佳入睡得 10 分；01:00 后递减
    var bedAxis = bedClock < 720 ? bedClock + 1440 : bedClock;
    var timePts = bedAxis <= 1425 ? 10 : (bedAxis <= 1485 ? 8 : (bedAxis <= 1545 ? 5 : 3));

    var score = clamp(durPts + structPts + effPts + timePts, 35, 99);
    if (rec.quality === 'bad' && score > 74) score = 72;

    var grade = score >= 85 ? '优质' : (score >= 75 ? '良好' : (score >= 62 ? '一般' : '待改善'));
    var gradeColor = score >= 85 ? '#10b981' : (score >= 75 ? '#3b82f6' : (score >= 62 ? '#f59e0b' : '#ef4444'));

    // 小米健康风格「睡眠动物/节律画像」
    var animal;
    if (bedAxis <= 1410 && total >= 420) {
      animal = { key: 'lark', icon: '🐦', name: '规律云雀', tag: '早睡早起 · 节律稳健', desc: '入睡及时且睡眠充足，晨间皮质醇唤醒自然，上午专注力佳。' };
    } else if (hasStages && deepPct >= 22 && total >= 400) {
      animal = { key: 'koala', icon: '🐨', name: '深眠考拉', tag: '深睡充沛 · 高效修复', desc: '慢波深睡占比高，体能与免疫恢复速度优于平均水平。' };
    } else if (bedAxis >= 1500) {
      animal = { key: 'owl', icon: '🦉', name: '灵感夜鸮', tag: '晚睡型节律 · 留意睡眠债', desc: '入睡偏晚，上午容易出现睡眠惯性，建议把高强度学习排在午后。' };
    } else if (total < 360 || awk >= 3) {
      animal = { key: 'dolphin', icon: '🐬', name: '浅眠海豚', tag: '睡眠偏浅 · 易受干扰', desc: '昨夜睡眠时长或连续性略显不足，午间建议小憩 20 分钟补充电量。' };
    } else {
      animal = { key: 'bear', icon: '🐻', name: '稳健棕熊', tag: '均衡睡眠 · 节奏平稳', desc: '整体睡眠时长与深浅比例均衡，今日精力处于稳定区间。' };
    }

    // 合成夜间多周期睡眠分期时序条（供小米风格睡眠分期甘特图/色带渲染）
    var segments = [];
    var dMin = hasStages ? (deep || 0) : Math.round(total * 0.18);
    var rMin = hasStages ? (rem || 0) : Math.round(total * 0.22);
    var aMin = Math.max(0, awake || 0);
    var lMin = Math.max(0, total - dMin - rMin);
    var cycles = Math.max(2, Math.min(6, Math.round(total / 90)));
    var curClock = night ? night.bed : 1410;

    for (var c = 0; c < cycles; c++) {
      var progress = c / Math.max(1, cycles - 1); // 0 -> 1（前半夜深睡多，后半夜 REM 多）
      var dWeight = (1 - progress * 0.65);
      var rWeight = (0.4 + progress * 0.8);
      var cycLight1 = Math.max(6, Math.round((lMin / cycles) * 0.45));
      var cycDeep = Math.max(0, Math.round((dMin / cycles) * dWeight * 1.35));
      var cycLight2 = Math.max(6, Math.round((lMin / cycles) * 0.55));
      var cycRem = Math.max(0, Math.round((rMin / cycles) * rWeight * 1.25));
      var cycAwake = (aMin > 0 && c === Math.floor(cycles / 2)) ? aMin : 0;

      var pushSeg = function (stKey, dur) {
        if (dur <= 0) return;
        segments.push({
          stage: stKey,
          dur: dur,
          startClock: minToHHMM(curClock),
          endClock: minToHHMM(curClock + dur)
        });
        curClock += dur;
      };
      pushSeg('light', cycLight1);
      pushSeg('deep', cycDeep);
      pushSeg('light', cycLight2);
      pushSeg('rem', cycRem);
      pushSeg('awake', cycAwake);
    }

    var tier = score >= 85 ? 'great' : (score >= 75 ? 'good' : (score >= 62 ? 'fair' : 'poor'));
    var dPctVal = deepPct != null ? deepPct : 18;
    var lPctVal = lightPct != null ? lightPct : 55;
    var rPctVal = remPct != null ? remPct : 22;
    return {
      score: score,
      tier: tier,
      grade: grade,
      gradeColor: gradeColor,
      totalMin: total,
      inBedMin: inBed,
      hasStages: hasStages,
      efficiency: eff,
      awakenings: awk,
      animal: animal,
      stages: {
        deepPct: dPctVal,
        lightPct: lPctVal,
        remPct: rPctVal,
        awakePct: awakePct,
        deep: { min: deep || 0, pct: dPctVal, ref: '15%–25%', status: deepPct == null ? 'est' : (deepPct < 15 ? 'low' : (deepPct > 28 ? 'high' : 'ok')), color: '#4f46e5', label: '深睡' },
        light: { min: light || 0, pct: lPctVal, ref: '45%–60%', status: lightPct == null ? 'est' : (lightPct < 40 ? 'low' : (lightPct > 65 ? 'high' : 'ok')), color: '#3b82f6', label: '浅睡' },
        rem: { min: rem || 0, pct: rPctVal, ref: '18%–25%', status: remPct == null ? 'est' : (remPct < 16 ? 'low' : (remPct > 28 ? 'high' : 'ok')), color: '#06b6d4', label: '快速眼动' },
        awake: { min: awake || 0, pct: awakePct, count: awk, ref: '0–2 次', status: awk <= 2 ? 'ok' : 'high', color: '#f59e0b', label: '清醒' }
      },
      segments: segments,
      hypnogram: segments
    };
  }


  /* ---------- P0 小米运动健康 / Zepp Life / 手环 CSV 批量解析 ----------
   * 同时支持：
   *  1) 标准表格型 CSV（Zepp Life 导出 SLEEP.csv / ACTIVITY.csv / SPORT.csv 及自定义中文表头）
   *  2) 小米运动健康 GDPR 导出格式（含 Key/Time/Value JSON 字符串列，如 hlth_center_aggregated_fitness_data.csv）
   */
  function splitCsvLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '\\' && inQ && line[i + 1] === '"') {
        cur += '"'; i++;
      } else if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if ((ch === ',' || ch === '\t' || ch === ';') && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function tsToDateAndHM(raw, fallbackDate) {
    if (raw == null || raw === '') return { date: fallbackDate || '', hm: '' };
    var s = String(raw).trim();
    // 纯 HH:MM
    var mHM = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (mHM) return { date: fallbackDate || '', hm: pad(+mHM[1]) + ':' + pad(+mHM[2]) };
    // ISO 或 YYYY-MM-DD HH:MM(:SS)
    var mIso = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
    if (mIso) {
      var ds = mIso[1] + '-' + pad(+mIso[2]) + '-' + pad(+mIso[3]);
      var hm = (mIso[4] != null && mIso[5] != null) ? (pad(+mIso[4]) + ':' + pad(+mIso[5])) : '';
      return { date: ds, hm: hm };
    }
    // Unix 时间戳（秒 10位 或 毫秒 13位）
    if (/^\d{10,13}$/.test(s)) {
      var ms = s.length === 10 ? (+s * 1000) : +s;
      var d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return {
          date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
          hm: pad(d.getHours()) + ':' + pad(d.getMinutes())
        };
      }
    }
    return { date: fallbackDate || '', hm: '' };
  }

  function normDurMin(raw, isTotal) {
    if (raw == null || raw === '') return null;
    var s = String(raw).trim();
    if (/h|hr|小时|时|分|min/i.test(s)) return parseFlexDur(s);
    var n = parseFloat(s);
    if (isNaN(n) || n < 0) return null;
    // 若大于 1080（18 小时），说明单位是秒（Zepp Life/小米导出常见秒数）
    if (n > (isTotal ? 1080 : 720)) return Math.round(n / 60);
    return Math.round(n);
  }

  function mapCsvSportType(raw) {
    var s = String(raw || '').toLowerCase();
    if (/walk|健走|步行|散步|indoor_walking|^6$/.test(s)) return 'walk';
    if (/treadmill|室内跑|跑步机|^2$/.test(s)) return 'treadmill';
    if (/cycle|riding|bike|骑行|单车|^3$|^4$/.test(s)) return 'cycle';
    if (/swim|游泳|^5$/.test(s)) return 'swim';
    if (/rope|跳绳|^14$/.test(s)) return 'rope';
    if (/badminton|羽毛球/.test(s)) return 'badminton';
    if (/basketball|篮球/.test(s)) return 'basketball';
    if (/soccer|football|足球/.test(s)) return 'football';
    if (/table_tennis|pingpong|乒乓/.test(s)) return 'pingpong';
    if (/tennis|网球/.test(s)) return 'tennis';
    if (/volleyball|排球/.test(s)) return 'volleyball';
    if (/yoga|stretch|瑜伽|拉伸|太极|操/.test(s)) return 'yoga';
    if (/hiit|燃脂|有氧/.test(s)) return 'hiit';
    if (/strength|weight|力量|无氧|核心|自由训练|^10$/.test(s)) return 'strength';
    return 'run';
  }

  function parseXiaomiCsv(csvText) {
    var raw = String(csvText || '').replace(/^\uFEFF/, '').trim();
    var res = { ok: false, sleeps: [], metrics: [], workouts: [] };
    if (!raw) return res;

    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) return res;

    var headers = splitCsvLine(lines[0]).map(function (h) { return h.toLowerCase().trim(); });
    function colIdx(patterns) {
      for (var i = 0; i < headers.length; i++) {
        for (var j = 0; j < patterns.length; j++) {
          if (patterns[j].test(headers[i])) return i;
        }
      }
      return -1;
    }

    var idxKey = colIdx([/^key$/, /^category$/]);
    var idxVal = colIdx([/^value$/, /^data$/]);
    var idxTime = colIdx([/^time$/, /^date$/, /^day$/, /日期/, /时间/]);

    // 分支 A：小米运动健康 GDPR JSON-in-CSV 格式 (Uid,Sid,Key,Time,Value...)
    if (idxKey >= 0 && idxVal >= 0) {
      for (var r = 1; r < lines.length; r++) {
        var cols = splitCsvLine(lines[r]);
        var k = (cols[idxKey] || '').toLowerCase();
        var tInfo = tsToDateAndHM(cols[idxTime], '');
        var valStr = cols[idxVal] || '';
        if (!valStr || valStr[0] !== '{') continue;
        var obj;
        try { obj = JSON.parse(valStr); } catch (e) { continue; }
        if (!obj || typeof obj !== 'object') continue;

        if (k.indexOf('sleep') >= 0 || obj.bedTime != null || obj.sleepTime != null || obj.deepSleepTime != null) {
          var bInfo = tsToDateAndHM(obj.bedTime || obj.sleepTime || obj.startTime, tInfo.date);
          var wInfo = tsToDateAndHM(obj.wakeUpTime || obj.wakeTime || obj.stopTime || obj.endTime, tInfo.date);
          var sDate = wInfo.date || tInfo.date || bInfo.date;
          var deep = normDurMin(obj.deepSleepTime != null ? obj.deepSleepTime : obj.deep, false);
          var light = normDurMin(obj.lightSleepTime != null ? obj.lightSleepTime : (obj.shallowSleepTime != null ? obj.shallowSleepTime : obj.light), false);
          var rem = normDurMin(obj.remTime != null ? obj.remTime : obj.rem, false);
          var awake = normDurMin(obj.awakeTime != null ? obj.awakeTime : obj.wake, false);
          var total = normDurMin(obj.duration != null ? obj.duration : obj.totalMinutes, true);
          if (!total && ((deep || 0) + (light || 0) + (rem || 0) > 0)) {
            total = (deep || 0) + (light || 0) + (rem || 0);
          }
          if (sDate && (total > 0 || (bInfo.hm && wInfo.hm))) {
            res.sleeps.push({
              date: sDate,
              start: bInfo.hm || '23:30',
              end: wInfo.hm || '07:30',
              total: total || 450,
              deep: deep,
              light: light,
              rem: rem,
              awake: awake || 0,
              awakenings: obj.wakeCount != null ? +obj.wakeCount : null,
              efficiency: obj.score != null ? +obj.score : null,
              source: 'csv'
            });
          }
        } else if (k.indexOf('step') >= 0 || k.indexOf('daily_report') >= 0 || (obj.steps != null && obj.sportType == null)) {
          var mDate = tInfo.date || tsToDateAndHM(obj.time || obj.date, '').date;
          var steps = parseInt(obj.steps != null ? obj.steps : obj.step, 10) || 0;
          var cal = parseInt(obj.calories != null ? obj.calories : (obj.calorie != null ? obj.calorie : obj.kcal), 10) || 0;
          var dist = parseInt(obj.distance != null ? obj.distance : obj.dist, 10) || 0;
          if (mDate && (steps > 0 || cal > 0 || dist > 0)) {
            res.metrics.push({ date: mDate, steps: steps, calories: cal, distance: dist, source: 'csv' });
          }
        } else if (k.indexOf('sport') >= 0 || k.indexOf('workout') >= 0 || obj.sportType != null || obj.exerciseType != null) {
          var stInfo = tsToDateAndHM(obj.startTime || obj.time || cols[idxTime], tInfo.date);
          var wDur = normDurMin(obj.duration != null ? obj.duration : obj.sportTime, false);
          if (stInfo.date && wDur > 0) {
            res.workouts.push({
              date: stInfo.date,
              start: stInfo.hm || '17:00',
              duration: wDur,
              type: mapCsvSportType(obj.sportType || obj.exerciseType || k),
              calories: parseInt(obj.calories || obj.calorie || obj.kcal, 10) || 0,
              distance: parseInt(obj.distance || obj.dist, 10) || 0,
              avgHr: parseInt(obj.avgHr || obj.avgHeartRate || obj.heartRate, 10) || null,
              source: 'csv'
            });
          }
        }
      }
      res.ok = !!(res.sleeps.length || res.metrics.length || res.workouts.length);
      return res;
    }

    // 分支 B：标准表头 CSV（Zepp Life / 小米运动 / 通用表格）
    var iDate = colIdx([/^date$/, /^day$/, /日期/, /^time$/]);
    var iBed = colIdx([/^start$/, /bedtime/, /sleeptime/, /starttime/, /inbed/, /入睡/, /就寝/]);
    var iWake = colIdx([/^end$/, /waketime/, /wakeuptime/, /stoptime/, /endtime/, /起床/, /醒来/]);
    var iDeep = colIdx([/^deep/, /deepsleep/, /深睡/, /深眠/]);
    var iLight = colIdx([/^light/, /^shallow/, /lightsleep/, /shallowsleep/, /浅睡/, /浅眠/]);
    var iRem = colIdx([/^rem/, /eyemove/, /眼动/]);
    var iAwake = colIdx([/^awake/, /wakemin/, /清醒时长/, /清醒分钟/]);
    var iAwkCnt = colIdx([/awakenings/, /wakecount/, /清醒次数/, /夜醒/]);
    var iTotal = colIdx([/^total/, /^sleepduration/, /睡眠时长/, /总睡眠/]);
    var iEff = colIdx([/efficiency/, /score/, /效率/, /睡眠得分/]);

    var iSteps = colIdx([/^steps?$/, /步数/, /总步数/]);
    var iCal = colIdx([/^cal/, /^kcal/, /activekcal/, /热量/, /卡路里/, /消耗/]);
    var iDist = colIdx([/^dist/, /距离/, /里程/]);

    var iSportType = colIdx([/^type$/, /sporttype/, /exercisetype/, /activitytype/, /运动类型/, /锻炼类型/, /项目/]);
    var iSportDur = colIdx([/^duration$/, /sporttime/, /workoutmin/, /运动时长/, /锻炼时长/, /^时长$/]);
    var iSportStart = colIdx([/^starttime$/, /^start$/, /开始时间/, /运动时间/]);
    var iHr = colIdx([/avghr/, /heartrate/, /心率/]);

    var isSleepTable = (iDeep >= 0 || iLight >= 0 || iBed >= 0 || iWake >= 0 || iTotal >= 0) && iSportType < 0;
    var isWorkoutTable = iSportType >= 0 && (iSportDur >= 0 || iCal >= 0 || iDist >= 0);
    var isMetricTable = iSteps >= 0 && !isWorkoutTable;

    for (var rowIdx = 1; rowIdx < lines.length; rowIdx++) {
      var c = splitCsvLine(lines[rowIdx]);
      if (!c.length || c.every(function (x) { return !x; })) continue;
      var dInfo = iDate >= 0 ? tsToDateAndHM(c[iDate], '') : { date: '', hm: '' };

      if (isSleepTable) {
        var bI = iBed >= 0 ? tsToDateAndHM(c[iBed], dInfo.date) : { date: dInfo.date, hm: '' };
        var wI = iWake >= 0 ? tsToDateAndHM(c[iWake], dInfo.date) : { date: dInfo.date, hm: '' };
        var dt = wI.date || dInfo.date || bI.date;
        var dp = iDeep >= 0 ? normDurMin(c[iDeep], false) : null;
        var lt = iLight >= 0 ? normDurMin(c[iLight], false) : null;
        var rm2 = iRem >= 0 ? normDurMin(c[iRem], false) : null;
        var awk = iAwake >= 0 ? normDurMin(c[iAwake], false) : null;
        var tot = iTotal >= 0 ? normDurMin(c[iTotal], true) : null;
        if (!tot && ((dp || 0) + (lt || 0) + (rm2 || 0) > 0)) {
          tot = (dp || 0) + (lt || 0) + (rm2 || 0);
        }
        if (!tot && bI.hm && wI.hm) {
          var sm = toMin(bI.hm), em = toMin(wI.hm);
          tot = (em > sm ? em - sm : 1440 - sm + em) - (awk || 0);
        }
        if (dt && ((tot != null && tot > 0) || (bI.hm && wI.hm))) {
          res.sleeps.push({
            date: dt,
            start: bI.hm || '23:30',
            end: wI.hm || '07:30',
            total: tot,
            deep: dp,
            light: lt,
            rem: rm2,
            awake: awk != null ? awk : 0,
            awakenings: iAwkCnt >= 0 && c[iAwkCnt] !== '' ? (parseInt(c[iAwkCnt], 10) || 0) : null,
            efficiency: iEff >= 0 && c[iEff] !== '' ? (parseInt(c[iEff], 10) || null) : null,
            source: 'csv'
          });
        }
      }

      if (isMetricTable) {
        var mDt = dInfo.date;
        var stp = iSteps >= 0 ? (parseInt(String(c[iSteps]).replace(/,/g, ''), 10) || 0) : 0;
        var mCal = iCal >= 0 ? (parseInt(String(c[iCal]).replace(/,/g, ''), 10) || 0) : 0;
        var rawDist = iDist >= 0 ? parseFloat(String(c[iDist]).replace(/,/g, '')) : 0;
        // 若距离带小数且 < 100，说明单位为公里 (km)，转为米
        var mDist = isNaN(rawDist) ? 0 : ((rawDist > 0 && rawDist < 80 && String(c[iDist]).indexOf('.') >= 0) ? Math.round(rawDist * 1000) : Math.round(rawDist));
        if (mDt && (stp > 0 || mCal > 0 || mDist > 0)) {
          res.metrics.push({ date: mDt, steps: stp, calories: mCal, distance: mDist, source: 'csv' });
        }
      }

      if (isWorkoutTable) {
        var sI = iSportStart >= 0 ? tsToDateAndHM(c[iSportStart], dInfo.date) : dInfo;
        var wDt = sI.date || dInfo.date;
        var durM = iSportDur >= 0 ? normDurMin(c[iSportDur], false) : 30;
        var wCal = iCal >= 0 ? (parseInt(String(c[iCal]).replace(/,/g, ''), 10) || 0) : 0;
        var rawWDist = iDist >= 0 ? parseFloat(String(c[iDist]).replace(/,/g, '')) : 0;
        var wDist = isNaN(rawWDist) ? 0 : ((rawWDist > 0 && rawWDist < 80 && String(c[iDist]).indexOf('.') >= 0) ? Math.round(rawWDist * 1000) : Math.round(rawWDist));
        var hrVal = iHr >= 0 ? (parseInt(c[iHr], 10) || null) : null;
        if (wDt && durM > 0) {
          res.workouts.push({
            date: wDt,
            start: sI.hm || '17:00',
            duration: durM,
            type: mapCsvSportType(c[iSportType]),
            name: String(c[iSportType] || '').trim() || undefined,
            calories: wCal,
            distance: wDist,
            avgHr: hrVal,
            source: 'csv'
          });
        }
      }
    }

    res.ok = !!(res.sleeps.length || res.metrics.length || res.workouts.length);
    return res;
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
    mergeShotResults: mergeShotResults,
    parseQuickSleep: parseQuickSleep,
    sleepScoreAndProfile: sleepScoreAndProfile,
    parseXiaomiCsv: parseXiaomiCsv
  };

  global.SleepNLP = {
    parse: parseQuickSleep,
    parseSleepText: parseQuickSleep
  };
  if (global.CP && global.CP.register) global.CP.register('SleepModel', global.SleepModel);
})(typeof window !== 'undefined' ? window : globalThis);
