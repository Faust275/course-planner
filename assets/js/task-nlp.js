/* ==========================================================
 * 自然语言待办快速解析器 (Task Natural Language Parser)
 * 纯函数模块：从自然语言文本中提取日期、时间、优先级、标签与关联课程，
 * 并清洗出规范的任务标题。
 * 示例：
 *   "明天下午3点交高数作业 #作业 !重要"
 *   -> { title: "交高数作业", dueDate: "2026-10-23", dueTime: "15:00",
 *        priority: "high", important: true, tags: ["作业"],
 *        courseId: "...", courseName: "高等数学" }
 * ========================================================== */
(function (global) {
  'use strict';

  var CN_NUM = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
  };

  /** 中文数字转阿拉伯数字 (1-99) */
  function cnToNum(str) {
    str = String(str || '').trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (str === '十') return 10;
    if (str.indexOf('十') >= 0) {
      var parts = str.split('十');
      var a = parts[0] ? (CN_NUM[parts[0]] != null ? CN_NUM[parts[0]] : NaN) : 1;
      var b = parts[1] ? (CN_NUM[parts[1]] != null ? CN_NUM[parts[1]] : NaN) : 0;
      if (isNaN(a) || isNaN(b)) return NaN;
      return a * 10 + b;
    }
    var n = CN_NUM[str];
    return n == null ? NaN : n;
  }

  function pad2(n) {
    var v = Number(n) || 0;
    return (v < 10 ? '0' : '') + v;
  }

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(d, n) {
    var copy = new Date(d.getTime());
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  /**
   * 常见高校基础课程别名映射表（用于智能模糊匹配）
   */
  var COURSE_ALIASES = {
    '高数': ['高等数学', '微积分'],
    '大物': ['大学物理', '普通物理'],
    '大英': ['大学英语', '英语'],
    '线代': ['线性代数'],
    '概统': ['概率论与数理统计', '概率论', '数理统计'],
    '马原': ['马克思主义基本原理'],
    '毛概': ['毛泽东思想和中国特色社会主义理论体系概论'],
    '思修': ['思想道德与法治', '思想道德修养与法律基础'],
    '近纲': ['中国近现代史纲要', '近代史'],
    '军理': ['军事理论'],
    '体育': ['大学体育', '体育课'],
    '计网': ['计算机网络'],
    '计组': ['计算机组成原理'],
    '操作系统': ['OS'],
    '数据结构': ['DS']
  };

  /**
   * 解析自然语言待办文本
   * @param {string} text - 用户输入的文本
   * @param {Object} [options] - 选项
   * @param {Array} [options.courses] - 可选的已有课程列表 [{id, name}]
   * @param {Date} [options.baseDate] - 基准日期，默认当前时间
   * @returns {Object} 解析结果
   */
  function parseQuickTask(text, options) {
    options = options || {};
    var raw = String(text || '').trim();
    var res = {
      raw: raw,
      title: raw,
      dueDate: '',
      dueTime: '',
      priority: 'normal',
      important: false,
      tags: [],
      courseId: '',
      courseName: '',
      hasDate: false,
      hasTime: false
    };

    if (!raw) return res;

    var base = options.baseDate ? new Date(options.baseDate.getTime()) : new Date();
    // 归一化基准时间为当天 00:00:00
    var today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    var workText = ' ' + raw + ' ';

    /* ================= 1. 优先级提取 ================= */
    // !重要 / !高 / !high / !! / ★ / 【重要】
    var priHighPat = /(?:[!！]{1,2}(?:重要|高|high|紧急|urgent)|[!！]{2}|★|【(?:重要|紧急|高优)】)/i;
    var mh = priHighPat.exec(workText);
    if (mh) {
      res.priority = 'high';
      res.important = true;
      workText = workText.replace(mh[0], ' ');
    } else {
      var priLowPat = /(?:[!！](?:低|low|轻微|次要)|【(?:低优|次要)】)/i;
      var ml = priLowPat.exec(workText);
      if (ml) {
        res.priority = 'low';
        workText = workText.replace(ml[0], ' ');
      }
    }

    /* ================= 2. 标签提取 (#xxx) ================= */
    var tagPat = /#([^\s#]+)/g;
    var tagMatch;
    var tags = [];
    while ((tagMatch = tagPat.exec(workText)) !== null) {
      var tagStr = tagMatch[1].trim();
      if (tagStr && tags.indexOf(tagStr) === -1) {
        tags.push(tagStr);
      }
    }
    if (tags.length) {
      res.tags = tags;
      workText = workText.replace(tagPat, ' ');
    }

    /* ================= 3. 显式课程绑定 (@xxx) ================= */
    var courses = options.courses || [];
    var coursePat = /@([^\s@]+)/;
    var cm = coursePat.exec(workText);
    if (cm) {
      var cQuery = cm[1].trim().toLowerCase();
      var foundCourse = null;
      for (var ci = 0; ci < courses.length; ci++) {
        var cName = (courses[ci].name || '').toLowerCase();
        if (cName === cQuery || cName.indexOf(cQuery) >= 0 || cQuery.indexOf(cName) >= 0) {
          foundCourse = courses[ci];
          break;
        }
      }
      if (foundCourse) {
        res.courseId = foundCourse.id;
        res.courseName = foundCourse.name;
      } else {
        res.courseName = cm[1].trim();
      }
      workText = workText.replace(cm[0], ' ');
    }

    /* ================= 4. 时间提取 (Time) ================= */
    // 形式 A: 下午3点半 / 晚上8点 / 早上8:30 / 15:30 / 9点20
    var timePat = /(上午|早上|早晨|下午|中午|晚上|傍晚|夜里|凌晨)?\s*([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:[点時时]|[:：])\s*(半|[0-9]{1,2}\s*分?|[零〇一二两三四五六七八九十]{1,3}\s*分?)?/i;
    var mt = timePat.exec(workText);
    if (mt) {
      var hRaw = mt[2];
      var h = /^\d+$/.test(hRaw) ? parseInt(hRaw, 10) : cnToNum(hRaw);
      var m = 0;
      if (mt[3]) {
        var mStr = mt[3].trim();
        if (mStr === '半') {
          m = 30;
        } else {
          var mm = mStr.replace(/分/g, '').trim();
          m = /^\d+$/.test(mm) ? parseInt(mm, 10) : cnToNum(mm);
        }
      }
      var ampm = mt[1] || '';
      if (!isNaN(h)) {
        if (/下午|傍晚|晚上|夜里/.test(ampm)) {
          if (h < 12) h += 12;
        } else if (ampm === '中午') {
          if (h < 11) h += 12;
        } else if (/凌晨/.test(ampm)) {
          if (h === 12) h = 0;
        } else if (!ampm && h >= 1 && h <= 6) {
          // 未指明且数字在 1-6 之间，一般默认为下午（如下午3点）
          h += 12;
        }
        h = Math.max(0, Math.min(23, h));
        m = isNaN(m) ? 0 : Math.max(0, Math.min(59, m));
        res.dueTime = pad2(h) + ':' + pad2(m);
        res.hasTime = true;
        workText = workText.replace(mt[0], ' ');
      }
    }

    // 形式 B: 模糊时间段（只说了“早上/下午/今晚”未指定具体点数）
    if (!res.dueTime) {
      if (/(晚上|傍晚|夜里|今晚)/.test(workText)) {
        res.dueTime = '20:00';
        res.hasTime = true;
        workText = workText.replace(/(晚上|傍晚|夜里|今晚)/, ' ');
      } else if (/(下午)/.test(workText)) {
        res.dueTime = '15:00';
        res.hasTime = true;
        workText = workText.replace(/(下午)/, ' ');
      } else if (/(中午)/.test(workText)) {
        res.dueTime = '12:00';
        res.hasTime = true;
        workText = workText.replace(/(中午)/, ' ');
      } else if (/(早上|早晨|上午)/.test(workText)) {
        res.dueTime = '09:00';
        res.hasTime = true;
        workText = workText.replace(/(早上|早晨|上午)/, ' ');
      }
    }

    /* ================= 5. 日期提取 (Date) ================= */
    // 形式 A: 相对日期（今天/明天/后天/大后天/N天后）
    var relList = [
      [/大大后天/, 4],
      [/大后天/, 3],
      [/后天/, 2],
      [/明天|明日|明儿/, 1],
      [/今天|今日/, 0]
    ];
    for (var ri = 0; ri < relList.length; ri++) {
      var rReg = relList[ri][0];
      if (rReg.test(workText)) {
        res.dueDate = toDateStr(addDays(today, relList[ri][1]));
        res.hasDate = true;
        workText = workText.replace(rReg, ' ');
        break;
      }
    }

    // 形式 B: N天后 / 过N天
    if (!res.dueDate) {
      var daysAfterPat = /(\d+|[一二两三四五六七八九十]+)\s*天[之以]?后|过\s*(\d+|[一二两三四五六七八九十]+)\s*天/;
      var mda = daysAfterPat.exec(workText);
      if (mda) {
        var numStr = mda[1] || mda[2];
        var nDays = /^\d+$/.test(numStr) ? parseInt(numStr, 10) : cnToNum(numStr);
        if (!isNaN(nDays) && nDays > 0) {
          res.dueDate = toDateStr(addDays(today, nDays));
          res.hasDate = true;
          workText = workText.replace(mda[0], ' ');
        }
      }
    }

    // 形式 C: 星期（下下周五 / 下周三 / 本周六 / 周日 / 星期二）
    if (!res.dueDate) {
      var weekPat = /(下下周|下周|本周|这周|周|星期|礼拜)\s*([一二三四五六日天1-7])/;
      var wm = weekPat.exec(workText);
      if (wm) {
        var dayMap = {
          '一': 1, '1': 1, '二': 2, '2': 2, '三': 3, '3': 3, '四': 4, '4': 4,
          '五': 5, '5': 5, '六': 6, '6': 6, '日': 7, '天': 7, '7': 7
        };
        var wantDow = dayMap[wm[2]];
        if (wantDow) {
          var prefix = wm[1];
          var currentDow = today.getDay() === 0 ? 7 : today.getDay(); // 1..7 (周一..周日)
          var diff = wantDow - currentDow;

          if (prefix === '下下周') {
            diff += 14;
          } else if (prefix === '下周') {
            diff += 7;
          } else if (prefix === '本周' || prefix === '这周') {
            // 本周指定日
          } else {
            // 裸周几，如“周五”：若已过则顺延到下周对应日
            if (diff <= 0) diff += 7;
          }
          res.dueDate = toDateStr(addDays(today, diff));
          res.hasDate = true;
          workText = workText.replace(wm[0], ' ');
        }
      }
    }

    // 形式 D: 绝对日期 (如 2026-10-25 / 10月25日 / 10/25 / 10.25)
    if (!res.dueDate) {
      var absYearPat = /(\d{4})[年\-\/\.]\s*(\d{1,2})[月\-\/\.]\s*(\d{1,2})[日号]?/;
      var my = absYearPat.exec(workText);
      if (my) {
        res.dueDate = my[1] + '-' + pad2(my[2]) + '-' + pad2(my[3]);
        res.hasDate = true;
        workText = workText.replace(my[0], ' ');
      } else {
        var absMonthPat = /(\d{1,2})[月\-\/\.]\s*(\d{1,2})[日号]?/;
        var mm = absMonthPat.exec(workText);
        if (mm) {
          var mMonth = parseInt(mm[1], 10);
          var mDay = parseInt(mm[2], 10);
          if (mMonth >= 1 && mMonth <= 12 && mDay >= 1 && mDay <= 31) {
            res.dueDate = today.getFullYear() + '-' + pad2(mMonth) + '-' + pad2(mDay);
            res.hasDate = true;
            workText = workText.replace(mm[0], ' ');
          }
        }
      }
    }

    /* ================= 6. 隐式课程关联检测 ================= */
    if (!res.courseId && courses.length) {
      for (var k = 0; k < courses.length; k++) {
        var c = courses[k];
        var cFullName = (c.name || '').trim();
        if (cFullName && workText.indexOf(cFullName) >= 0) {
          res.courseId = c.id;
          res.courseName = cFullName;
          break;
        }
      }
      // 别名匹配（如“高数”匹配“高等数学”）
      if (!res.courseId) {
        var aliasKeys = Object.keys(COURSE_ALIASES);
        for (var ak = 0; ak < aliasKeys.length; ak++) {
          var alias = aliasKeys[ak];
          if (workText.indexOf(alias) >= 0) {
            var targets = COURSE_ALIASES[alias];
            for (var cj = 0; cj < courses.length; cj++) {
              var cnItem = courses[cj].name || '';
              var matched = targets.some(function (t) { return cnItem.indexOf(t) >= 0; });
              if (matched) {
                res.courseId = courses[cj].id;
                res.courseName = courses[cj].name;
                break;
              }
            }
            if (res.courseId) break;
          }
        }
      }
    }

    /* ================= 7. 标题清洗 ================= */
    // 去除残留的多余介词如“在、于、前、交、之前”与首尾符号
    var cleanTitle = workText
      .replace(/^[\s,，;；:：\-—–_]+|[\s,，;；:：\-—–_]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // 如果清洗后完全为空，则保留原文本
    res.title = cleanTitle || raw;
    return res;
  }

  global.TaskNLP = {
    parse: parseQuickTask,
    cnToNum: cnToNum
  };
})(typeof window !== 'undefined' ? window : globalThis);
