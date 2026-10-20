/* ==========================================================
 * 农历（1900–2100）
 *
 * 为什么要内置数据而不是算：农历没有简单公式，必须查表。
 * 数据来源：用 `sxtwl`（寿星天文历）逐日扫描 1899-12 ~ 2101-06 的
 * 农历初一，取出 1900 正月初一 ~ 2101 正月初一 之间的 2486 个"月"，
 * 记录每段长度（29/30 天）与每年的闰月号，压成 416 字节位流。
 *
 * 存储格式（base64 解码后）：
 *   [0..2]  1900 正月初一 相对 1900-01-31 的天数（3 字节大端）
 *   [3]     尾部补齐用的 bit 数
 *   [4..]   位流：先 2486 个"月长位"（1=30 天，0=29 天），
 *           再 201 年 × 4 bit 的"闰月号"（0=不闰）
 *
 * 月份号不存——固定是 1..12，闰月插在同名月之后，由闰月号唯一确定。
 * 体积 556 字符，相对 1.7MB 的单文件可忽略。
 *
 * 校验：9 个已知春节（1900/1950/2000/2023/2024/2025/2026/2033/2100）
 *       与 5 个闰月（2020闰四、2023闰二、2025闰六、2028闰五、2033闰十一）
 *       全部正确；2486 个初一日序与 sxtwl 原始值 0 不一致。
 * ========================================================== */
(function (global) {
  'use strict';

  var START = 1900;
  var END = 2100;
  var SEGS = 2486;              // 1900 正月初一 ~ 2101 正月初一 之间的月段数
  var EPOCH_MS = Date.UTC(1900, 0, 31);
  var DAY_MS = 86400000;

  /* 见文件头注释：416 字节位流，base64 后 556 字符 */
  var LUNAR_B64 =
    'AAAABktqV1K6k3SbZVqqrVNaldSupN0m6S6pbVNapbUraTdJekuyW1K2pW1K2lXSXpLsltSupW1K1pW0m6S7JbkrqVtKtVVqqtku' +
    'yW5K6lbSrZVqqrVNqltSupXUq6VaqrVVapbUrqV1Juk2yq1VWqW1K6lbSbpN0l1S2qW1S2pW0m6S9JdktqVtStpVtKukvSXZLald' +
    'StZVrKtpNsl2S2pXUraVaqrVVbJdktyV1K2lWqq1VWqXVLaldSupN0q1VWqm1S2pXUnaTdJtU1qmtUtqV1K2k3SXpLqltUtaVtSt' +
    'pN0l6S6pbUraVbSraTdJekuyW1K6laqq2VXSXZLsltSupW0q1VWqm1S6pbUrqVtKtVVqqtUuqW1K6k7SblNqqtVNqltSupO0W6Ta' +
    'pbVNalbUrqTtFuiuyXVKABQBAAgYAUAIHAFAEACBgBQAwcAYAQAIHAFADCABgBAAwcAUAQIAGAECgBgBQAwgAUAQAIHAFAECQBgB' +
    'AAgYAUAMLAGAFACBwBQAwgAYAQAMHAFAECABgBAAwcAUAQIAGAEACAA=';
;

  /* ---------- 解码（惰性，只做一次） ---------- */
  var cache = null;

  function b64ToBytes(str) {
    var CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var map = {};
    for (var i = 0; i < CH.length; i++) map[CH[i]] = i;
    var out = [];
    var buf = 0, bits = 0;
    for (var k = 0; k < str.length; k++) {
      var c = str[k];
      if (c === '=') break;
      if (map[c] === undefined) continue;
      buf = (buf << 6) | map[c];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 0xff);
      }
    }
    return out;
  }

  /**
   * 解出农历表。
   * @returns { baseOff, lens, leap, monthStarts }
   *   baseOff      1900 正月初一 相对 1900-01-31 的天数
   *   lens[]       每段天数（29/30）
   *   leap{year:m} 每年闰几月（无此键=不闰）
   *   monthStarts[] 每个月初一相对 1900-01-31 的天数（长度 SEGS+1，末位是 2101 正月初一）
   */
  function decode() {
    if (cache) return cache;

    var bytes = b64ToBytes(LUNAR_B64);
    var baseOff = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
    var pad = bytes[3] || 0;

    // 展开为 bit 数组
    var bits = [];
    for (var i = 4; i < bytes.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((bytes[i] >> b) & 1);
    }
    if (pad) bits = bits.slice(0, bits.length - pad);

    var lens = [];
    for (var s = 0; s < SEGS; s++) lens.push(bits[s] ? 30 : 29);

    var leap = {};
    var off = SEGS;
    for (var y = START; y <= END; y++) {
      var v = 0;
      for (var j = 0; j < 4; j++) v = (v << 1) | (bits[off++] || 0);
      if (v) leap[y] = v;
    }

    var starts = [baseOff];
    var cur = baseOff;
    for (var t = 0; t < SEGS; t++) {
      cur += lens[t];
      starts.push(cur);
    }

    cache = { baseOff: baseOff, lens: lens, leap: leap, monthStarts: starts, bits: bits };
    return cache;
  }

  /* ---------- 工具 ---------- */
  function dayIndex(y, m, d) {          // 公历 -> 相对 1900-01-31 的天数
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH_MS) / DAY_MS);
  }
  function fromIndex(n) {               // 相对天数 -> { y, m, d }
    var t = new Date(EPOCH_MS + n * DAY_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /**
   * 把"每年第几个农历月"映射到真实的月号。
   * 无闰月的年份就是 1..12；有闰月的年份，闰月插在同名月之后。
   * @param {number} year 农历年
   * @param {number} seq  1..(12 或 13)
   */
  function monthAt(year, seq) {
    var lv = decode().leap[year] || 0;
    if (!lv) return { month: seq, isLeap: false };
    if (seq <= lv) return { month: seq, isLeap: false };
    if (seq === lv + 1) return { month: lv, isLeap: true };
    return { month: seq - 1, isLeap: false };
  }

  /** 该农历年共有几个月（12 或 13） */
  function monthsInYear(year) {
    return decode().leap[year] ? 13 : 12;
  }

  /** 某农历年某月的起始相对天数（下标 = 该年之前的累计月数） */
  function indexOfMonthStart(year, seq) {
    var d = decode();
    if (year < START || year > END) return null;
    // 累加 1900..year-1 的月数
    var n = 0;
    for (var y = START; y < year; y++) n += monthsInYear(y);
    n += seq - 1;
    return n < d.monthStarts.length ? d.monthStarts[n] : null;
  }

  /**
   * 农历转公历。
   * @param {number} year  农历年（1900-2100）
   * @param {number} month 月号 1-12
   * @param {number} day   日 1-30
   * @param {boolean} [isLeap] 是否闰月
   * @returns {{y,m,d}|null} 公历日期；超出范围或该月无此日返回 null
   */
  function lunarToSolar(year, month, day, isLeap) {
    var d = decode();
    if (year < START || year > END) return null;
    if (month < 1 || month > 12 || day < 1 || day > 30) return null;

    var total = monthsInYear(year);
    for (var seq = 1; seq <= total; seq++) {
      var info = monthAt(year, seq);
      if (info.month !== month || !!info.isLeap !== !!isLeap) continue;
      var start = indexOfMonthStart(year, seq);
      if (start === null) return null;
      var len = d.lens[/* 该月的全局下标 */ (function () {
        var n = 0;
        for (var y = START; y < year; y++) n += monthsInYear(y);
        return n + seq - 1;
      })()];
      if (day > len) return null;          // 该月只有 29 天却要 30 日
      return fromIndex(start + day - 1);
    }
    return null;   // 该年没有这个月（如闰月不存在）
  }

  /**
   * 公历转农历。
   * @param {number} y 公历年
   * @param {number} m 公历月
   * @param {number} d 公历日
   * @returns {{year,month,day,isLeap}|null}
   */
  function solarToLunar(y, m, d) {
    var tb = decode();
    var idx = dayIndex(y, m, d) - tb.baseOff;
    if (idx < 0 || idx >= tb.lens.reduce(function (a, b) { return a + b; }, 0)) return null;

    // 二分找所属月段
    var lo = 0, hi = SEGS - 1, seg = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (tb.monthStarts[mid] - tb.baseOff <= idx) { seg = mid; lo = mid + 1; }
      else hi = mid - 1;
    }

    // 第 seg 段属于哪个农历年
    var n = 0, year = START;
    while (year <= END) {
      var cnt = monthsInYear(year);
      if (seg < n + cnt) break;
      n += cnt;
      year++;
    }
    if (year > END) return null;
    var seq = seg - n + 1;
    var info = monthAt(year, seq);
    return {
      year: year,
      month: info.month,
      day: idx - (tb.monthStarts[seg] - tb.baseOff) + 1,
      isLeap: info.isLeap
    };
  }

  /**
   * 某个农历日期在指定（农历）年对应哪个公历日 —— 给纪念日顺延用。
   * 闰月生日如果该年没有闰月，退回同名常规月（常见做法）。
   * @returns {string|null} 'YYYY-MM-DD'
   */
  function lunarInYear(lunarYear, month, day, preferLeap) {
    var p = lunarToSolar(lunarYear, month, day, preferLeap);
    if (!p && preferLeap) p = lunarToSolar(lunarYear, month, day, false);
    if (!p) p = lunarToSolar(lunarYear, month, Math.min(day, 29));   // 三十在小月退到廿九
    if (!p) return null;
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  global.Lunar = {
    START: START,
    END: END,
    SEGS: SEGS,
    decode: decode,
    lunarToSolar: lunarToSolar,
    solarToLunar: solarToLunar,
    lunarInYear: lunarInYear,
    monthsInYear: monthsInYear,
    monthAt: monthAt,
    /** 数据自检：返回 { ok, bad[] } */
    selfTest: function () {
      var known = {
        1900: '1900-01-31', 1950: '1950-02-17', 2000: '2000-02-05',
        2023: '2023-01-22', 2024: '2024-02-10', 2025: '2025-01-29',
        2026: '2026-02-17', 2033: '2033-01-31', 2100: '2100-02-09'
      };
      var leapKnown = { 2020: 4, 2023: 2, 2025: 6, 2028: 5, 2033: 11 };
      var bad = [];
      Object.keys(known).forEach(function (y) {
        var r = lunarToSolar(+y, 1, 1, false);
        var got = r ? r.y + '-' + pad(r.m) + '-' + pad(r.d) : 'null';
        if (got !== known[y]) bad.push('春节 ' + y + ': ' + got + ' != ' + known[y]);
      });
      var tb = decode();
      Object.keys(leapKnown).forEach(function (y) {
        if ((tb.leap[+y] || 0) !== leapKnown[y]) {
          bad.push('闰月 ' + y + ': ' + (tb.leap[+y] || 0) + ' != ' + leapKnown[y]);
        }
      });
      return { ok: bad.length === 0, bad: bad };
    }
  };
})(window);
