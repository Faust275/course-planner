

/* ==========================================================
 * 视图：课程表（核心排课）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 选格模式：在课表上直接点格子排课 */
  var pickMode = false;
  var picked = {};        // 'day|periodId' -> 1

  function pickKey(day, pid) { return day + '|' + pid; }
  function pickCount() { return Object.keys(picked).length; }
  function clearPick() { picked = {}; pickMode = false; }

  /** 顶栏按钮跟着选格模式变化（App.go 只在切页时调 actions，所以手动刷新一次） */
  function refreshActions() {
    var box = V.$('#viewActions');
    if (box) { box.innerHTML = ''; view.actions(box); }
  }

  function togglePick(day, pid) {
    if (!pid) return;
    var k = pickKey(day, pid);
    if (picked[k]) delete picked[k];
    else picked[k] = 1;
    view.render();
  }

  /* ==========================================================
   * 批量导入：粘贴教务系统 / Excel 的课表文本
   * 设计取向是「宽容」——不要求用户按规定格式写，尽量自动认列。
   * ========================================================== */
  var DAY_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  // 表头关键词：命中即认为该列是对应字段
  var HEAD_KEYS = {
    name: ['课程名', '课程名称', '课程', '科目'],
    teacher: ['任课教师', '授课教师', '教师', '老师'],
    location: ['上课地点', '教室', '地点', '位置'],
    day: ['星期', '上课日', '日期'],
    period: ['节次', '节数', '上课时间', '课时', '时间'],
    week: ['上课周', '周次', '起止周']
  };

  function splitRow(line) {
    if (line.indexOf('\t') >= 0) return line.split('\t');            // Excel 直接复制
    if (line.indexOf(',') >= 0) return line.split(',');
    if (line.indexOf('，') >= 0) return line.split('，');
    var parts = line.split(/\s{2,}/);                                // 先按对齐用的多空格切
    // 只用单个空格分隔时也别整行当一格（例：周一 第1-2节 高等数学）
    if (parts.length < 2 && /\s/.test(line)) parts = line.split(/\s+/);
    return parts;
  }

  /** 星期：周一 / 星期天 / 3 -> 1..7；认不出返回 0 */
  function parseDay(text) {
    var t = String(text || '').trim();
    var m = /(?:星期|周)\s*([一二三四五六日天])/.exec(t);
    if (m) return DAY_CN[m[1]] || 0;
    m = /(?:星期|周)\s*([1-7])/.exec(t);
    if (m) return +m[1];
    if (/^[一二三四五六日天]$/.test(t)) return DAY_CN[t] || 0;
    if (/^[1-7]$/.test(t)) return +t;
    return 0;
  }

  /** 节次：第1-2节 / 1,2 / 3节 -> [1,2]；认不出返回 [] */
  function parsePeriodNums(text) {
    var t = String(text || '').trim();
    var out = [];
    var m = /(\d+)\s*[-~－至]\s*(\d+)/.exec(t);        // 1-2 这样的连续区间
    if (m) {
      var a = +m[1], b = +m[2];
      if (a >= 1 && b >= a && b - a < 12) { for (var i = a; i <= b; i++) out.push(i); }
    } else {
      var nums = t.match(/\d+/g) || [];
      nums.forEach(function (n) { var v = +n; if (v >= 1 && v <= 20) out.push(v); });
    }
    return out;
  }

  /** 周次：1-16周 / 1-16 -> {start,end}；认不出返回 null */
  function parseWeeks(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    var m = /(\d+)\s*[-~－至]\s*(\d+)/.exec(t);
    if (m) return { start: +m[1], end: +m[2] };
    var n = t.match(/\d+/g);
    if (n && n.length) return { start: +n[0], end: +n[0] };
    return null;
  }

  function looksLikeWeekField(text) {
    var t = String(text || '');
    return /周\s*$/.test(t.trim()) && /\d+\s*[-~－至]\s*\d+/.test(t);
  }

  /**
   * 解析课表文本。
   * 返回 { rows:[{name,teacher,location,day,periods,weeks}], skipped:[原行], cols }。
   * rows 里 day/periods 缺失的行会带 missing 标记，交给 UI 提示。
   */
  /* ==========================================================
   * 自动适配教务系统日历 .ics 文件
   * ========================================================== */
  function parseIcsCourseTable(text) {
    var events = text.split(/BEGIN:VEVENT/i).slice(1);
    var rows = [];
    var DAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

    events.forEach(function (ev) {
      var sm = ev.match(/SUMMARY.*?:(.*?)(?:\r?\n[A-Z]|\r?\nEND:)/is);
      var summary = (sm && sm[1]) ? sm[1] : '';
      summary = summary.replace(/\r?\n\s*/g, '').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
      summary = summary.replace(/\[.*?周.*?\]/g, '').replace(/^\[.*?\]\s*/, '').replace(/（考试）$/, '').trim();
      if (!summary) return;

      var lm = ev.match(/LOCATION.*?:(.*?)(?:\r?\n[A-Z]|\r?\nEND:)/is);
      var location = (lm && lm[1]) ? lm[1] : '';
      location = location.replace(/\r?\n\s*/g, '').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();

      var dm = ev.match(/DESCRIPTION.*?:(.*?)(?:\r?\n[A-Z]|\r?\nEND:)/is);
      var desc = (dm && dm[1]) ? dm[1] : '';
      desc = desc.replace(/\r?\n\s*/g, '').replace(/\\n/g, ' ').trim();

      var dtsm = ev.match(/DTSTART.*?:(\d{8}T\d{4,6}|\d{8})/i);
      var dtem = ev.match(/DTEND.*?:(\d{8}T\d{4,6}|\d{8})/i);
      var rrm = ev.match(/RRULE.*?:(.*?)(?:\r?\n[A-Z]|\r?\nEND:)/is);

      var dtstart = dtsm ? dtsm[1] : '';
      var dtend = dtem ? dtem[1] : '';
      var rrule = rrm ? rrm[1] : '';

      var day = 0;
      var bym = rrule.match(/BYDAY=([A-Z]{2})/i);
      var byday = bym ? bym[1] : '';
      if (byday && DAY_MAP[byday.toUpperCase()]) {
        day = DAY_MAP[byday.toUpperCase()];
      } else if (dtstart && dtstart.length >= 8) {
        var y = parseInt(dtstart.slice(0, 4), 10);
        var m = parseInt(dtstart.slice(4, 6), 10) - 1;
        var d = parseInt(dtstart.slice(6, 8), 10);
        var dt = new Date(y, m, d);
        day = dt.getDay() === 0 ? 7 : dt.getDay();
      }

      var periods = [];
      if (dtstart.indexOf('T') >= 0 && dtend.indexOf('T') >= 0) {
        var stTime = dtstart.slice(9, 11) + ':' + dtstart.slice(11, 13);
        var enTime = dtend.slice(9, 11) + ':' + dtend.slice(11, 13);
        if (typeof Store !== 'undefined' && Store.periods) {
          Store.periods.forEach(function (p, idx) {
            if (p.start && p.end && ((p.start >= stTime && p.start < enTime) || (p.end > stTime && p.end <= enTime))) {
              periods.push(idx + 1);
            }
          });
        }
      }
      if (!periods.length) periods = [1, 2];

      var startWeek = 1;
      var cm = rrule.match(/COUNT=(\d+)/i);
      var endWeek = cm ? Math.min(25, parseInt(cm[1], 10)) : 16;
      var im = rrule.match(/INTERVAL=(\d+)/i);
      var interval = im ? im[1] : '1';
      var weekType = 'all';
      if (interval === '2') {
        weekType = (startWeek % 2 === 1) ? 'odd' : 'even';
      }

      rows.push({
        name: summary,
        teacher: desc,
        location: location,
        day: day || 1,
        periods: periods,
        weeks: { start: startWeek, end: endWeek, type: weekType },
        missing: []
      });
    });

    return { rows: rows, skipped: [], cols: { name: 0, day: 1, period: 2 } };
  }

  /* ==========================================================
   * 自动解析教务系统网页源码 (HTML DOM 抽取)
   * ========================================================== */
  function parseHtmlCourseTable(htmlText) {
    var doc = null;
    try {
      if (typeof DOMParser !== 'undefined') {
        doc = new DOMParser().parseFromString(htmlText, 'text/html');
      }
    } catch (e) { doc = null; }

    var rows = [], skipped = [];
    if (!doc) return { rows: [], skipped: ['当前运行环境不支持 HTML DOMParser 解析'], cols: null };

    var tables = doc.querySelectorAll('table');
    var targetTable = null;
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var txt = t.textContent || '';
      if (/星期[一二三四五六日天]|周[一二三四五六日天]/.test(txt)) {
        targetTable = t;
        break;
      }
    }
    if (!targetTable && tables.length) targetTable = tables[0];
    if (!targetTable) return { rows: [], skipped: ['未在 HTML 中找到课表表格'], cols: null };

    var colDays = {};
    var trs = targetTable.querySelectorAll('tr');
    var trArr = Array.prototype.slice.call(trs);

    trArr.forEach(function (tr) {
      var ths = tr.querySelectorAll('th, td');
      for (var c = 0; c < ths.length; c++) {
        var d = parseDay(ths[c].textContent);
        if (d > 0 && !colDays[c]) {
          colDays[c] = d;
        }
      }
    });

    trArr.forEach(function (tr, rIdx) {
      var tds = tr.querySelectorAll('td');
      for (var c = 0; c < tds.length; c++) {
        var td = tds[c];
        var text = (td.textContent || '').trim();
        if (!text || text.length < 2) continue;
        if (/^(第?\d+节|节次|时间|上午|下午|晚上)$/.test(text)) continue;
        if (parseDay(text) > 0 && text.length <= 5) continue;
        if (rIdx === 0 && colDays[c]) continue;

        var day = colDays[c] || 0;
        if (!day) day = parseDay(text);

        var periods = parsePeriodNums(text);
        var rowspan = (td.getAttribute ? parseInt(td.getAttribute('rowspan'), 10) : 1) || 1;
        if (!periods.length) {
          var pStart = rIdx;
          periods = [];
          for (var rp = 0; rp < rowspan; rp++) periods.push(pStart + rp);
          if (periods[0] === 0) periods = [1, 2];
        }

        var weeks = parseWeeks(text, 20);
        var lines = text.split(/[\r\n\s]{2,}|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        var courseName = lines[0] || text.slice(0, 15);
        var loc = '';
        var teacher = '';
        for (var l = 1; l < lines.length; l++) {
          var line = lines[l];
          if (/(?:[一-龥]{1,}(?:楼|教|室|馆|场|中心|基)\d*|[A-Za-z]\d{2,4}|\d{3,4})/.test(line)) {
            loc = line;
          } else if (/[\u4e00-\u9fa5]{2,4}(?:老师|教授|讲师)?$/.test(line) && !teacher) {
            teacher = line;
          }
        }

        if (day > 0 && courseName) {
          rows.push({
            name: courseName.replace(/\[.*?周.*?\]/, '').trim(),
            teacher: teacher,
            location: loc,
            day: day,
            periods: periods,
            weeks: weeks,
            missing: []
          });
        }
      }
    });

    return { rows: rows, skipped: skipped, cols: { name: 0, day: 1, period: 2 } };
  }

  function parseCourseTable(text) {
    var raw = String(text || '').trim();
    if (raw.indexOf('BEGIN:VCALENDAR') >= 0 || raw.indexOf('BEGIN:VEVENT') >= 0) {
      return parseIcsCourseTable(raw);
    }
    if (raw.indexOf('<table') >= 0 || raw.indexOf('<tr') >= 0 || raw.indexOf('<!DOCTYPE') >= 0 || raw.indexOf('<html') >= 0) {
      return parseHtmlCourseTable(raw);
    }
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l; });
    var rows = [], skipped = [], cols = null;

    // 1) 探表头：首行里能匹配到两个及以上关键词就当表头
    var first = splitRow(lines[0] || '');
    var hit = {};
    first.forEach(function (c, i) {
      var t = String(c || '').trim();
      Object.keys(HEAD_KEYS).forEach(function (k) {
        if (hit[k] != null) return;
        for (var j = 0; j < HEAD_KEYS[k].length; j++) {
          if (t.indexOf(HEAD_KEYS[k][j]) >= 0) { hit[k] = i; return; }
        }
      });
    });
    var isHead = Object.keys(hit).length >= 2;
    if (isHead) { cols = hit; lines = lines.slice(1); }

    // 2) 逐行解析
    lines.forEach(function (line) {
      var p = splitRow(line).map(function (x) { return String(x || '').trim(); })
        .filter(function (x) { return x; });
      if (!p.length) return;
      var r = { name: '', teacher: '', location: '', day: 0, periods: [], weeks: null, raw: line };

      if (cols) {
        if (cols.name != null) r.name = p[cols.name] || '';
        if (cols.teacher != null) r.teacher = p[cols.teacher] || '';
        if (cols.location != null) r.location = p[cols.location] || '';
        if (cols.day != null) r.day = parseDay(p[cols.day]);
        if (cols.period != null) r.periods = parsePeriodNums(p[cols.period]);
        if (cols.week != null) r.weeks = parseWeeks(p[cols.week]);
      } else {
        // 无表头：逐格猜
        p.forEach(function (cell) {
          var d = parseDay(cell);
          if (d && !r.day) { r.day = d; return; }
          if (looksLikeWeekField(cell)) { r.weeks = parseWeeks(cell); return; }
          var pn = parsePeriodNums(cell);
          // 「节次」特征：带「节」字，或纯数字且值不大
          if (pn.length && (/节/.test(cell) || /^\d+(\s*[-~－至]\s*\d+)?$/.test(cell)) && !r.periods.length) {
            r.periods = pn; return;
          }
          if (!r.name) { r.name = cell; return; }
          if (/[楼室馆场]|[\d]+[号]|[A-Za-z]-?\d/.test(cell) && !r.location) { r.location = cell; return; }
          if (!r.teacher && cell.length <= 6) { r.teacher = cell; return; }
          if (!r.location) r.location = cell;
        });
      }

      r.missing = (!r.name || !r.day || !r.periods.length);
      if (r.missing) skipped.push(line);
      else rows.push(r);
    });

    return { rows: rows, skipped: skipped, cols: cols };
  }

  /* ==========================================================
   * 时间冲突检测
   * ----------------------------------------------------------
   * 两门课在同一天同一节（或自定义时段相互重叠），且周次区间有交集，就算冲突。
   * 这里全是纯函数、不依赖 Store，方便单测；UI 侧自己把当前学期的课程传进来。
   * ========================================================== */

  /** 课程在第 w 周是否上课（courseInWeek 的纯函数版） */
  function inWeekOf(c, w, totalWeeks) {
    var s = c.startWeek == null ? 1 : (+c.startWeek || 1);
    var e = c.endWeek == null ? totalWeeks : (+c.endWeek || totalWeeks);
    if (w < s || w > e) return false;
    if (c.weekType === 'odd') return w % 2 === 1;
    if (c.weekType === 'even') return w % 2 === 0;
    return true;
  }

  /** 两门课的周次区间是否有交集；返回第一个共同周次，0 表示不重叠 */
  function weekOverlap(a, b, totalWeeks) {
    for (var w = 1; w <= totalWeeks; w++) {
      if (inWeekOf(a, w, totalWeeks) && inWeekOf(b, w, totalWeeks)) return w;
    }
    return 0;
  }

  /** 两个自定义时段是否时间重叠（半开区间，首尾相接不算重叠） */
  function timeOverlap(a, b) {
    var as = TimeUtil.toMin(a.startTime || '00:00');
    var ae = TimeUtil.toMin(a.endTime || a.startTime || '00:00');
    var bs = TimeUtil.toMin(b.startTime || '00:00');
    var be = TimeUtil.toMin(b.endTime || b.startTime || '00:00');
    return as < be && bs < ae;
  }

  /**
   * 找出整个学期里互相撞时间的课程。
   * 返回 [{day, periodId, ids:[], names:[], week}]，按 星期→节次 排序。
   * 同一门课自己的多个时段不算冲突；单双周不同也不算。
   */
  function findConflicts(courses, totalWeeks) {
    var list = (courses || []).filter(function (c) { return c && c.id; });
    var pb = {};   // 'day|periodId' -> [{c,s}]  按节次排的
    var cb = {};   // day -> [{c,s}]             自定义时段的，要逐对比时间
    list.forEach(function (c) {
      (c.slots || []).forEach(function (s) {
        if (!s || !s.day) return;
        var d = +s.day;
        if (s.timeMode === 'custom') (cb[d] = cb[d] || []).push({ c: c, s: s });
        else if (s.periodId) (pb[d + '|' + s.periodId] = pb[d + '|' + s.periodId] || []).push({ c: c, s: s });
      });
    });

    var groups = {};
    function hit(x, y, day, periodId) {
      if (x.c.id === y.c.id) return;                 // 同一门课不算冲突
      var w = weekOverlap(x.c, y.c, totalWeeks);
      if (!w) return;                                // 周次错开，不算
      var k = day + '|' + periodId;
      var g = groups[k] || (groups[k] = { day: day, periodId: periodId, ids: [], names: [], week: w });
      [[x.c, 0], [y.c, 1]].forEach(function (pair) {
        if (g.ids.indexOf(pair[0].id) < 0) { g.ids.push(pair[0].id); g.names.push(pair[0].name || '未命名课程'); }
      });
      if (w < g.week) g.week = w;
    }
    function pairs(arr, day, periodId, needTimeCheck) {
      for (var i = 0; i < arr.length; i++) {
        for (var j = i + 1; j < arr.length; j++) {
          if (needTimeCheck && !timeOverlap(arr[i].s, arr[j].s)) continue;
          hit(arr[i], arr[j], day, periodId);
        }
      }
    }
    Object.keys(pb).forEach(function (k) {
      var seg = k.split('|');
      pairs(pb[k], +seg[0], seg[1], false);
    });
    Object.keys(cb).forEach(function (d) { pairs(cb[d], +d, '', true); });

    return Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (x, y) {
        return (x.day - y.day) || String(x.periodId).localeCompare(String(y.periodId));
      });
  }

  /** 当前学期的课程（冲突检测只在同学期内比，跨学期没有可比性） */
  function semesterCourses() {
    var sid = Store.semester.id;
    return Store.courses.filter(function (c) { return !c.semesterId || c.semesterId === sid; });
  }

  /** 冲突条目的人类可读时间：「周一 第1节 · 第3周起」 */
  function conflictWhen(g) {
    var p = g.periodId ? Store.getPeriod(g.periodId) : null;
    var seg = '周' + '一二三四五六日'.charAt(g.day - 1) +
              (p ? (' 第' + (Store.periodIndex(g.periodId) + 1) + '节') : ' 自定义时段');
    return seg + ' · 第' + g.week + '周起';
  }

  /**
   * 批量导入预览用：拿待导入的行去和已有课程比，看哪些行会撞。
   * 返回 { 行下标: [撞到的课程名] }；没撞的行不出现在结果里。
   */
  function batchConflicts(rows) {
    var totalWeeks = Store.semester.weeks;
    var periods = Store.periods || [];
    var pseudo = rows.map(function (r, i) {
      return {
        id: '__new' + i,
        name: r.name || ('第' + (i + 1) + '行'),
        startWeek: r.weeks ? r.weeks.start : 1,
        endWeek: r.weeks ? r.weeks.end : totalWeeks,
        weekType: 'all',
        slots: (r.periods || []).map(function (n) {
          var p = periods[n - 1];
          return p ? { day: r.day, timeMode: 'period', periodId: p.id } : null;
        }).filter(Boolean)
      };
    });
    var out = {};
    findConflicts(semesterCourses().concat(pseudo), totalWeeks).forEach(function (g) {
      g.ids.forEach(function (id, k) {
        if (String(id).indexOf('__new') !== 0) return;
        var i = +String(id).slice(5);
        var box = out[i] || (out[i] = []);
        g.names.forEach(function (nm, k2) {
          if (k2 !== k && box.indexOf(nm) < 0) box.push(nm);
        });
      });
    });
    return out;
  }

  /** 冲突里的一行（提示卡和弹窗共用） */
  function conflictRow(g, onPick) {
    return el('div', {
      class: 'conflict-row',
      onclick: function () { onPick(g); }
    }, [
      el('b', { text: g.names.join(' / ') }),
      el('span', { text: conflictWhen(g) })
    ]);
  }

  /** 课表页顶部的冲突提示卡 */
  function conflictCard(conflicts) {
    var n = conflicts.length;
    var m = null;
    function openCourse(g) {
      if (m) m.close();
      setTimeout(function () { CourseDialog.detail(g.ids[0]); }, 160);
    }
    return el('div', { class: 'conflict-card' }, [
      el('div', { class: 'conflict-title' }, [
        el('b', { text: '检测到 ' + n + ' 处时间冲突' }),
        el('span', { text: '同一时段排了多门课，点一下直接改' })
      ]),
      el('div', {}, conflicts.slice(0, 3).map(function (g) { return conflictRow(g, openCourse); })),
      n > 3 ? el('button', {
        class: 'conflict-more', text: '查看全部 ' + n + ' 处',
        onclick: function () { m = conflictListDialog(conflicts); }
      }) : null
    ]);
  }

  /** 全部冲突的弹窗 */
  function conflictListDialog(conflicts) {
    var m = V.modal({
      title: '时间冲突（' + conflicts.length + ' 处）',
      width: '520px',
      body: [
        el('p', {
          class: 'ocr-hint',
          text: '同一时段排了多门课。单双周错开、或周次不重叠的不会算冲突。'
        }),
        el('div', { style: { maxHeight: '360px', overflow: 'auto' } },
          conflicts.map(function (g) {
            return conflictRow(g, function (x) {
              m.close();
              setTimeout(function () { CourseDialog.detail(x.ids[0]); }, 160);
            });
          }))
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '知道了', onclick: function () { m.close(); } })
      ])
    });
    return m;
  }

  /** 批量导入弹窗：粘贴 → 预览 → 确认 */
  function batchImportDialog() {
    var ta = V.textarea({
      class: 'textarea sync-code', rows: 8,
      placeholder: '把教务系统或 Excel 里的课表整段粘进来，一行一门课。\n' +
                   '示例：高等数学\t张老师\t教学楼A301\t周一\t1-2节\t1-16周\n' +
                   '也可以写：周一 第1-2节 高等数学 张老师 A301'
    });
    var fileInput = el('input', {
      type: 'file', accept: '.html,.htm,.ics,.csv,.tsv,.txt', style: { display: 'none' },
      onchange: function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (evt) {
          var content = evt.target.result;
          ta.value = content;
          preview(content);
        };
        reader.readAsText(file);
      }
    });

    var dropZone = el('div', {
      class: 'cp-batch-dropzone',
      style: {
        padding: '12px', border: '2px dashed var(--border)', borderRadius: '8px',
        textAlign: 'center', marginBottom: '10px', background: 'var(--bg-weak)', cursor: 'pointer'
      },
      onclick: function () { fileInput.click(); }
    }, [
      el('span', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '📂 点击或拖拽上传教务课表文件（支持 .html 网页源码 / .ics 日历 / .csv / .tsv）' }),
      fileInput
    ]);

    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
    dropZone.addEventListener('dragleave', function (e) { dropZone.style.borderColor = 'var(--border)'; });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border)';
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function (evt) {
          var content = evt.target.result;
          ta.value = content;
          preview(content);
        };
        reader.readAsText(file);
      }
    });

    var m = V.modal({
      title: '批量导入课表（支持教务网页与日历）',
      width: '620px',
      autofocus: true,
      body: [
        dropZone,
        el('p', {
          class: 'ocr-hint',
          text: '或在下方直接粘贴教务网页源码（HTML）、日历文本（ICS）或 Excel/Tab 文本，系统将智能自适应解析。'
        }),
        ta,
        el('div', { id: 'cpBatchPreview', style: { marginTop: '10px' } })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '解析并预览',
          onclick: function () { preview(ta.value); }
        })
      ])
    });

    function preview(text) {
      var host = m.el ? m.el.querySelector('#cpBatchPreview') : document.getElementById('cpBatchPreview');
      if (!host) return;
      host.innerHTML = '';
      var res = parseCourseTable(text);
      if (!res.rows.length) {
        host.appendChild(el('div', {
          class: 'ocr-hint',
          text: '没解析出课程。至少要能看出「课程名 + 星期 + 节次」，比如：高等数学 周一 1-2节'
        }));
        if (res.skipped.length) {
          host.appendChild(el('div', {
            class: 'ocr-hint',
            text: '跳过了 ' + res.skipped.length + ' 行（信息不全）：' + res.skipped.slice(0, 3).join(' / ')
          }));
        }
        return;
      }

      // 冲突检测：把待导入的行当成临时课程，和已有课程（以及彼此）一起比一次
      var hitMap = batchConflicts(res.rows);
      var hitCount = Object.keys(hitMap).length;

      host.appendChild(el('div', { class: 'section-title' },
        ['认出 ' + res.rows.length + ' 门课' +
         (res.skipped.length ? '（跳过 ' + res.skipped.length + ' 行）' : '') +
         (hitCount ? ('，' + hitCount + ' 门撞时间') : '')]));

      var list = el('div', { style: { maxHeight: '260px', overflow: 'auto' } });
      res.rows.forEach(function (r, i) {
        var dayName = '周' + '一二三四五六日'.charAt(r.day - 1);
        var box = el('div', {});
        box.appendChild(el('div', {
          class: 'setting-row',
          style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }
        }, [
          el('input', {
            class: 'input', value: r.name,
            style: { flex: '2', minWidth: '90px' },
            oninput: function (e) { r.name = e.target.value; }
          }),
          el('input', {
            class: 'input', value: dayName,
            style: { width: '62px' },
            oninput: function (e) { r.day = parseDay(e.target.value) || r.day; }
          }),
          el('input', {
            class: 'input', value: r.periods.join('-'),
            style: { width: '58px' },
            oninput: function (e) { var n = parsePeriodNums(e.target.value); if (n.length) r.periods = n; }
          }),
          el('input', {
            class: 'input', value: r.teacher || '', placeholder: '老师',
            style: { flex: '1', minWidth: '60px' },
            oninput: function (e) { r.teacher = e.target.value; }
          }),
          el('input', {
            class: 'input', value: r.location || '', placeholder: '地点',
            style: { flex: '1', minWidth: '60px' },
            oninput: function (e) { r.location = e.target.value; }
          })
        ]));
        if (hitMap[i]) {
          box.appendChild(el('div', {
            class: 'batch-warn',
            text: '⚠ 与已排的 ' + hitMap[i].join('、') + ' 撞时间，导入后可在课表上改'
          }));
        }
        list.appendChild(box);
      });
      host.appendChild(list);

      host.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        el('button', {
          class: 'btn btn-primary',
          text: '导入这 ' + res.rows.length + ' 门课',
          onclick: function () { doImport(res.rows, m); }
        })
      ]));
    }

    function doImport(rows, modal) {
      // 用节次表按序号取 id，这样就算用户自定义过节次（id 不一定是 p1/p2…）也能对上
      var periods = Store.periods || [];
      var ok = 0;
      rows.forEach(function (r) {
        if (!r.name || !r.day) return;
        var slots = [];
        (r.periods || []).forEach(function (n) {
          var p = periods[n - 1];
          // 节次超出当前节次表就不排，避免课表上出现空白格
          if (!p) return;
          slots.push({ day: r.day, timeMode: 'period', periodId: p.id, location: r.location || '' });
        });
        if (!slots.length) return;
        Store.addCourse({
          name: r.name,
          teacher: r.teacher || '',
          location: r.location || '',
          slots: slots,
          startWeek: r.weeks ? r.weeks.start : 1,
          endWeek: r.weeks ? r.weeks.end : undefined
        });
        ok++;
      });
      modal.close();
      UI.toast(ok ? ('已导入 ' + ok + ' 门课') : '没有可导入的课程');
      if (ok && global.App) App.go('schedule');
    }
  }

  /** 选格模式底部的操作条 */
  function pickBar() {
    var n = pickCount();
    return el('div', { class: 'pick-bar' }, [
      el('div', { class: 'pb-info' }, [
        el('b', { text: n ? ('已选 ' + n + ' 个时段') : '点格子选上课时间' }),
        el('span', { text: n ? '再点一次格子可以取消' : '可以选多天多节，比如周一第 1 节 + 周三第 2 节' })
      ]),
      el('button', {
        class: 'btn btn-sm', text: '取消',
        onclick: function () { clearPick(); view.render(); refreshActions(); }
      }),
      el('button', {
        class: 'btn btn-sm btn-primary', text: '填课程信息',
        onclick: function () {
          var cells = Object.keys(picked).map(function (k) {
            var a = k.split('|');
            return { day: parseInt(a[0], 10), periodId: a[1] };
          });
          if (!cells.length) { UI.toast('先在课表上点几个格子', 'err'); return; }
          CourseDialog.open(null, {
            cells: cells,
            onDone: function () { clearPick(); view.render(); refreshActions(); }
          });
        }
      })
    ]);
  }

  /* ==========================================================
   * 课表布局计算
   *
   * 把「哪门课画在哪个格子、跨几行」算成一份指令表，渲染和导出图片共用。
   * 抽出来是为了避免两处各写一套、改了一边忘了另一边。
   *
   * 指令只有四种：
   *   { type:'block', span:n, item }  从当前行起连续占 n 行（合并连堂）
   *   { type:'covered' }              被上面的 block 覆盖，不单独画
   *   { type:'stack', items:[...] }   同一格撞了多门课，纵向堆叠
   *   （没有键 = 空格子）
   * ========================================================== */
  var ScheduleLayout = {
    /**
     * @param {number} weekNo 第几周
     * @returns {Object<string, object>} 键为 'day|rowIdx'（day 0-6，rowIdx 0-based）
     */
    build: function (weekNo) {
      var sid = Store.semester ? Store.semester.id : null;
      var periods = Store.periods || [];
      var grid = {};

      // 节假日停课：按列的实际日期查中国法定节假日，放假日当天不排课
      var hb = {};
      for (var _d = 1; _d <= 7; _d++) {
        var _dt = Store.dateOf(weekNo, _d);
        hb[_d] = (global.HolidayCN ? HolidayCN.lookup(DateUtil.toStr(_dt)) : null);
      }

      // 1) 汇总每格课程（一门课的多时段在此展开为多条伪记录）
      Store.courses.forEach(function (c) {
        if (c.semesterId && c.semesterId !== sid) return;
        if (!Store.courseInWeek(c, weekNo)) return;
        Store.expandCourse(c, weekNo).forEach(function (p) {
          // 法定放假日当天不排课（已在下方按整列标「休」覆盖，这里提前跳过更稳妥）
          if (hb[p.day] && hb[p.day].type === 'holiday') return;
          var first = -1, last = -1;
          if (p.timeMode === 'custom') {
            if (!p.startTime) return;
            var ce = p.endTime || p.startTime;
            periods.forEach(function (pp, i) {
              // 与节次有交集就算占这一节
              if (TimeUtil.toMin(pp.start) < TimeUtil.toMin(ce) &&
                  TimeUtil.toMin(p.startTime) < TimeUtil.toMin(pp.end)) {
                if (first < 0) first = i;
                last = i;
              }
            });
          } else {
            var pi = Store.periodIndex(p.periodId);
            if (pi >= 0) { first = last = pi; }
          }
          if (first < 0) return;
          for (var r = first; r <= last; r++) {
            var key = p.day + '|' + r;
            (grid[key] = grid[key] || []).push(p);
          }
        });
      });

      // 2) 生成指令：有冲突 -> 同格堆叠；无冲突 -> 合并连续同门课
      var out = {};
      for (var dayX = 1; dayX <= 7; dayX++) {
        // 法定放假日：整列标记为「休」，不渲染课程（保证表格对齐，屏幕与导出一致）
        if (hb[dayX] && hb[dayX].type === 'holiday') {
          periods.forEach(function (pp, ri) { out[dayX + '|' + ri] = { type: 'holiday' }; });
          continue;
        }
        var rowList = {};
        periods.forEach(function (pp, ri) {
          if (grid[dayX + '|' + ri]) rowList[ri] = grid[dayX + '|' + ri];
        });

        var hasOverlap = Object.keys(rowList).some(function (r) { return rowList[r].length > 1; });
        if (hasOverlap) {
          Object.keys(rowList).forEach(function (r) {
            out[dayX + '|' + r] = { type: 'stack', items: rowList[r] };
          });
          continue;
        }

        var r0 = 0;
        while (r0 < periods.length) {
          var items = rowList[r0];
          if (!items || !items.length) { r0++; continue; }
          var it = items[0];
          var endR = r0;
          while (endR + 1 < periods.length) {
            var nx = rowList[endR + 1];
            if (!nx || nx.length !== 1) break;
            var nxIt = nx[0];
            // 同一个 slot 的连堂，或同一门课相邻两节，都算"该合并"
            var same = (nxIt._slot && it._slot && nxIt._slot === it._slot) ||
                       (nxIt.courseId === it.courseId && nxIt.timeMode !== 'custom' && it.timeMode !== 'custom');
            if (!same) break;
            endR++;
          }
          out[dayX + '|' + r0] = { type: 'block', span: endR - r0 + 1, item: it };
          for (var rr = r0 + 1; rr <= endR; rr++) out[dayX + '|' + rr] = { type: 'covered' };
          r0 = endR + 1;
        }
      }
      return out;
    }
  };



  /** 考试周备考看板：顶部考试倒计时阵列 + 三阶段备考推进看板 */
  function renderExamBoard(root) {
    var exams = Store.courseExams ? Store.courseExams() : [];
    var sid = Store.semester ? Store.semester.id : '';
    var semCourses = Store.courses.filter(function (c) { return !c.semesterId || c.semesterId === sid; });

    // 1. 顶部考试倒计时横幅卡片
    var cdCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    cdCard.appendChild(el('div', {
      class: 'section-title',
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }
    }, [
      el('span', {}, ['🎯 期中 / 期末考试倒计时阵列']),
      el('span', { style: { fontSize: '12px', color: 'var(--text-3)', fontWeight: 'normal' }, text: exams.length ? ('共 ' + exams.length + ' 场考试安排（支持期中/期末/测验独立计时）') : '在课程编辑里填写「期中/期末考试时间」即可自动排入' })
    ]));

    if (!exams.length) {
      cdCard.appendChild(el('div', {
        style: { padding: '14px', borderRadius: '10px', background: 'var(--surface-2)', fontSize: '13px', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }
      }, [
        el('span', { text: '当前学期还没有登记考试时间。点任意课程「编辑」，填入考试日期和起止时间，这里会自动生成倒计时卡片。' }),
        semCourses.length ? el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: function () { CourseDialog.open(semCourses[0].id); }
        }, ['去给课程填考试时间']) : null
      ]));
    } else {
      var grid = el('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }
      });
      exams.forEach(function (c) {
        var ex = c.exam || {};
        var left = DateUtil.daysLeft(ex.date);
        var badgeText = left < 0 ? ('已结束 ' + Math.abs(left) + ' 天') : (left === 0 ? '🔥 今天考试' : ('还有 ' + left + ' 天'));
        var badgeColor = left < 0 ? 'var(--text-3)' : (left <= 3 ? 'var(--red)' : (left <= 7 ? 'var(--amber)' : 'var(--primary)'));
        var tm = ex.start ? (ex.start + (ex.end ? '–' + ex.end : '')) : '时间待定';
        grid.appendChild(el('div', {
          class: 'card',
          style: {
            padding: '12px 14px',
            borderLeft: '4px solid ' + (c.color || 'var(--primary)'),
            background: 'var(--surface-2)',
            cursor: 'pointer'
          },
          onclick: function () { CourseDialog.detail(c.id); }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '6px' } }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0', flex: '1' } }, [
              el('b', { style: { fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: c.name }),
              el('span', {
                class: 'chip',
                style: { fontSize: '10.5px', padding: '1px 6px', background: 'var(--primary-weak)', color: 'var(--primary)', flex: '0 0 auto' },
                text: c.examLabel || ex.label || '期末考试'
              })
            ]),
            el('span', {
              class: 'chip',
              style: { color: badgeColor, fontWeight: '700', fontSize: '11.5px', flex: '0 0 auto' },
              text: badgeText
            })
          ]),
          el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '📅 ' + ex.date + ' · ' + tm }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '2px' }, text: '📍 ' + (ex.location || c.location || '地点待定') + (c.credit ? (' · ' + c.credit + ' 学分') : '') }),
          left >= 0 ? el('div', { style: { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
            el('button', {
              class: 'btn btn-sm',
              style: { height: '24px', padding: '0 8px', fontSize: '11.5px' },
              onclick: function (evClick) {
                evClick.stopPropagation();
                if (!Store.createExamStudyPlan) return;
                V.confirm({
                  title: '生成《' + c.name + '》考前复习计划',
                  message: '距离' + (c.examLabel || ex.label || '考试') + '还有 ' + Math.max(1, left) + ' 天，是否自动创建每日备考打卡计划，并拆解一轮复习/真题/冲刺三项待办？',
                  okText: '立即生成'
                }).then(function (ok) {
                  if (!ok) return;
                  var res = Store.createExamStudyPlan(c.id, { examDate: ex.date, examLabel: c.examLabel || ex.label });
                  if (res && res.plan) {
                    UI.toast('已生成备考计划「' + res.plan.title + '」及 ' + res.tasksCreated + ' 项复习待办', 'ok');
                    view.render();
                  }
                });
              }
            }, ['✨ 生成备考计划与待办']),
            el('button', {
              class: 'btn btn-sm',
              style: { height: '24px', padding: '0 8px', fontSize: '11.5px' },
              onclick: function (evClick) {
                evClick.stopPropagation();
                if (global.App && App.focusCourse) App.focusCourse(c.id);
              }
            }, ['🍅 专注此科'])
          ]) : null
        ]));
      });
      cdCard.appendChild(grid);
    }
    root.appendChild(cdCard);

    // 2. 三阶段备考看板 (一轮复习 / 历年真题 / 考前冲刺)
    var STAGES = [
      { key: 'round1', next: 'papers', title: '📖 一轮复习 · 知识点梳理', desc: '教材章节通读、课堂笔记整理与重难点排雷', color: '#3b82f6' },
      { key: 'papers', next: 'sprint', title: '✍️ 二轮强化 · 历年真题刷题', desc: '往年期末卷限时模考、错题归档与题型总结', color: '#f59e0b' },
      { key: 'sprint', next: '', title: '🔥 考前冲刺 · 核心背诵押题', desc: '高频公式默写、简答背诵与考前查漏补缺', color: '#ef4444' }
    ];

    var boardHead = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }
    }, [
      el('div', {}, [
        el('b', { style: { fontSize: '15px' }, text: '🗂️ 三阶段备考推进看板' }),
        el('span', { style: { fontSize: '12px', color: 'var(--text-3)', marginLeft: '8px' }, text: '将期末复习拆解为三个阶段，点击「推进 ▸」流转至下一阶段' })
      ]),
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: function () {
          if (global.TaskDialog) global.TaskDialog.open(null, { examStage: 'round1', energy: 'high' });
        }
      }, [V.svg(V.icons.plus, 14), '新建备考任务'])
    ]);
    root.appendChild(boardHead);

    var colsWrap = el('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '16px' }
    });

    STAGES.forEach(function (st) {
      var tasks = (Store.tasks || []).filter(function (t) {
        return !t.parentId && t.examStage === st.key;
      });
      var doneCount = tasks.filter(function (t) { return t.status === 'done'; }).length;

      var colCard = el('div', {
        class: 'card',
        style: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '3px solid ' + st.color }
      });

      colCard.appendChild(el('div', {}, [
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
          el('b', { style: { fontSize: '14px' }, text: st.title }),
          el('span', { class: 'chip', style: { fontSize: '11px' }, text: doneCount + '/' + tasks.length })
        ]),
        el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' }, text: st.desc })
      ]));

      var qInp = V.input({ placeholder: '快速添加本阶段任务（Enter）…', style: { height: '32px', fontSize: '12.5px' } });
      var qSel = V.select(
        [{ value: '', label: '关联课程（可选）' }].concat(semCourses.map(function (c) { return { value: c.id, label: c.name }; })),
        exams[0] ? exams[0].id : '',
        { style: 'height:32px;font-size:12px;max-width:125px' }
      );
      function quickAddStageTask() {
        var title = (qInp.value || '').trim();
        if (!title) { UI.toast('请输入备考任务内容', 'err'); qInp.focus(); return; }
        Store.addTask({
          title: title,
          courseId: qSel.value || '',
          examStage: st.key,
          energy: 'high',
          priority: st.key === 'sprint' ? 'high' : 'normal',
          dueDate: DateUtil.toStr(DateUtil.today())
        });
        qInp.value = '';
        UI.toast('已加入「' + st.title.slice(0, 6) + '」');
        view.render();
      }
      qInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); quickAddStageTask(); }
      });
      colCard.appendChild(el('div', { style: { display: 'flex', gap: '6px' } }, [
        qSel, qInp,
        el('button', { class: 'btn btn-sm', style: { height: '32px', padding: '0 10px' }, text: '+', onclick: quickAddStageTask })
      ]));

      var listEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '80px' } });
      if (!tasks.length) {
        listEl.appendChild(el('div', {
          style: { padding: '18px 10px', textAlign: 'center', fontSize: '12px', color: 'var(--text-3)', border: '1px dashed var(--line)', borderRadius: '8px' },
          text: '暂无任务，在上方输入即可快速拆解复习计划'
        }));
      } else {
        tasks.forEach(function (t) {
          var course = t.courseId ? Store.getCourse(t.courseId) : null;
          var isDone = t.status === 'done';
          listEl.appendChild(el('div', {
            style: {
              padding: '9px 11px',
              borderRadius: '8px',
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              opacity: isDone ? 0.65 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
              el('input', {
                type: 'checkbox',
                checked: isDone ? 'checked' : null,
                onclick: function (e) {
                  e.stopPropagation();
                  Store.updateTask(t.id, { status: isDone ? 'todo' : 'done' });
                  view.render();
                }
              }),
              el('span', {
                style: { flex: '1', fontSize: '13px', fontWeight: '500', textDecoration: isDone ? 'line-through' : 'none', cursor: 'pointer' },
                text: t.title,
                onclick: function () { if (global.TaskDialog) global.TaskDialog.open(t.id); }
              })
            ]),
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } }, [
              course ? el('span', {
                class: 'chip',
                style: { fontSize: '11px', padding: '1px 6px', background: (course.color || '#4f46e5') + '22', color: course.color || '#4f46e5' },
                text: course.name
              }) : el('span', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: '通用备考' }),
              el('div', { style: { display: 'flex', gap: '4px' } }, [
                st.next ? el('button', {
                  class: 'btn btn-sm',
                  style: { padding: '2px 8px', fontSize: '11px' },
                  title: '流转到下一备考阶段',
                  onclick: function () {
                    Store.updateTask(t.id, { examStage: st.next });
                    UI.toast('已推进至下一阶段');
                    view.render();
                  }
                }, ['推进 ▸']) : null,
                el('button', {
                  class: 'btn btn-sm',
                  style: { padding: '2px 8px', fontSize: '11px' },
                  onclick: function () {
                    if (global.App && App.focusTask) App.focusTask(t.id);
                    else if (global.App) App.go('pomodoro');
                  }
                }, ['🍅 专注'])
              ])
            ])
          ]));
        });
      }
      colCard.appendChild(listEl);
      colsWrap.appendChild(colCard);
    });

    root.appendChild(colsWrap);
  }

  /* ==========================================================
   * 课堂所学日志看板（记录每节课学了什么 / 章节进度 / 掌握度 / 一键转复习待办）
   * ========================================================== */
  function renderCourseLogsBoard(root) {
    var semCourses = semesterCourses();
    var allStats = Store.courseLearningStats ? Store.courseLearningStats('', Store.currentSemesterId) : { total: 0, mastered: 0, normal: 0, review: 0, coveredWeeks: 0, coveredCourses: 0, logs: [] };
    var curCourseId = view.logCourseFilter || '';
    var curMastery = view.logMasteryFilter || 'all';

    // 1. 顶部概览与快捷新建卡
    var heroCard = el('div', {
      class: 'cp-card cp-clog-hero',
      style: { padding: '16px 18px', marginBottom: '14px' }
    }, [
      el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }
      }, [
        el('div', {}, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
            el('b', { style: { fontSize: '15.5px' }, text: '📖 课堂所学与章节进度日志' }),
            el('span', { class: 'cp-chip cp-chip-primary', text: '共 ' + allStats.total + ' 节记录' })
          ]),
          el('div', {
            style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '3px' },
            text: '随手记下每节课学了什么、讲到第几章、有哪些重难点，支持按掌握程度筛选并一键生成课后复习待办。'
          })
        ]),
        el('button', {
          class: 'cp-btn cp-btn-primary',
          onclick: function () {
            CourseLogDialog.open(null, {
              courseId: curCourseId || (semCourses[0] ? semCourses[0].id : ''),
              week: view.week || Store.currentWeek(),
              onDone: function () { view.render(); }
            });
          }
        }, [V.svg(V.icons.plus, 15), '记录本节所学'])
      ]),
      el('div', { class: 'cp-clog-stat-grid' }, [
        el('div', { class: 'cp-clog-stat-item' }, [
          el('span', { class: 'cp-clog-stat-lbl', text: '本学期累计记录' }),
          el('b', { class: 'cp-clog-stat-val', text: allStats.total + ' 节' }),
          el('small', { text: '覆盖 ' + allStats.coveredCourses + ' 门课 · ' + allStats.coveredWeeks + ' 个教学周' })
        ]),
        el('div', { class: 'cp-clog-stat-item' }, [
          el('span', { class: 'cp-clog-stat-lbl', text: '🟢 已吃透' }),
          el('b', { class: 'cp-clog-stat-val', style: { color: '#10b981' }, text: allStats.mastered + ' 节' }),
          el('small', { text: '核心概念与推导已完全掌握' })
        ]),
        el('div', { class: 'cp-clog-stat-item' }, [
          el('span', { class: 'cp-clog-stat-lbl', text: '🔵 基本掌握' }),
          el('b', { class: 'cp-clog-stat-val', style: { color: '#3b82f6' }, text: allStats.normal + ' 节' }),
          el('small', { text: '跟上课堂节奏，常规巩固即可' })
        ]),
        el('div', { class: 'cp-clog-stat-item' }, [
          el('span', { class: 'cp-clog-stat-lbl', text: '🟠 需重点复习' }),
          el('b', { class: 'cp-clog-stat-val', style: { color: '#f59e0b' }, text: allStats.review + ' 节' }),
          el('small', { text: '存在疑难点，建议转待办攻克' })
        ])
      ])
    ]);
    root.appendChild(heroCard);

    // 2. 筛选栏（按课程 / 掌握度 / 关键词）
    var filterCard = el('div', {
      class: 'cp-card',
      style: { padding: '12px 14px', marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }
    });

    var courseRow = el('div', { class: 'cp-seg-row', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '12px', color: 'var(--text-3)', marginRight: '4px' }, text: '课程：' }),
      el('button', {
        type: 'button',
        class: 'cp-seg-btn' + (!curCourseId ? ' cp-on' : ''),
        onclick: function () { view.logCourseFilter = ''; view.render(); }
      }, ['全部课程 (' + allStats.total + ')'])
    ]);
    semCourses.forEach(function (c) {
      var cnt = (Store.courseLogsOfCourse ? Store.courseLogsOfCourse(c.id).length : 0);
      courseRow.appendChild(el('button', {
        type: 'button',
        class: 'cp-seg-btn' + (curCourseId === c.id ? ' cp-on' : ''),
        onclick: function () { view.logCourseFilter = c.id; view.render(); }
      }, [c.name + (cnt ? ' (' + cnt + ')' : '')]));
    });
    filterCard.appendChild(courseRow);

    var bottomFilterRow = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }
    });
    var masteryRow = el('div', { class: 'cp-seg-row', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '12px', color: 'var(--text-3)', marginRight: '4px' }, text: '掌握度：' })
    ]);
    [
      { key: 'all', label: '全部状态' },
      { key: 'review', label: '🟠 需重点复习' },
      { key: 'normal', label: '🔵 基本掌握' },
      { key: 'mastered', label: '🟢 已吃透' }
    ].forEach(function (m) {
      masteryRow.appendChild(el('button', {
        type: 'button',
        class: 'cp-seg-btn' + (curMastery === m.key ? ' cp-on' : ''),
        onclick: function () { view.logMasteryFilter = m.key; view.render(); }
      }, [m.label]));
    });
    bottomFilterRow.appendChild(masteryRow);

    var searchInp = V.input({
      placeholder: '🔍 搜索章节、知识点或重难点…',
      value: view.logQuery || '',
      style: { maxWidth: '240px', height: '32px', fontSize: '12.5px' }
    });
    searchInp.addEventListener('input', function () {
      view.logQuery = searchInp.value;
      renderListOnly();
    });
    bottomFilterRow.appendChild(searchInp);
    filterCard.appendChild(bottomFilterRow);
    root.appendChild(filterCard);

    var listHost = el('div', { class: 'cp-clog-list' });
    root.appendChild(listHost);

    function renderListOnly() {
      listHost.innerHTML = '';
      var kw = (view.logQuery || '').trim().toLowerCase();
      var logs = (Store.courseLogsOfCourse ? Store.courseLogsOfCourse(curCourseId, Store.currentSemesterId) : []).filter(function (item) {
        if (curMastery !== 'all' && item.mastery !== curMastery) return false;
        if (kw) {
          var hay = [item.courseName, item.topic, item.learned, item.keyPoints, '第' + item.week + '周'].join(' ').toLowerCase();
          if (hay.indexOf(kw) < 0) return false;
        }
        return true;
      });

      if (!logs.length) {
        listHost.appendChild(el('div', {
          class: 'cp-card',
          style: { padding: '28px 18px', textAlign: 'center', color: 'var(--text-3)' }
        }, [
          el('div', { style: { fontSize: '28px', marginBottom: '8px' }, text: '📖' }),
          el('b', { style: { fontSize: '14px', color: 'var(--text-2)', display: 'block', marginBottom: '4px' }, text: '还没有课堂所学记录' }),
          el('div', { style: { fontSize: '12.5px', marginBottom: '12px' }, text: '下课后花 30 秒记下「今天讲到哪一章、核心学了什么、哪块没听懂」，期末复习时直接按重难点串联！' }),
          el('button', {
            class: 'cp-btn cp-btn-primary',
            onclick: function () {
              CourseLogDialog.open(null, {
                courseId: curCourseId || (semCourses[0] ? semCourses[0].id : ''),
                week: view.week || Store.currentWeek(),
                onDone: function () { view.render(); }
              });
            }
          }, [V.svg(V.icons.plus, 14), '记第一节课所学'])
        ]));
        return;
      }

      logs.forEach(function (item) {
        var course = item.courseId ? Store.getCourse(item.courseId) : null;
        var cColor = (course && course.color) || '#4f46e5';
        var mMeta = Store.masteryMeta ? Store.masteryMeta(item.mastery) : { icon: '🔵', name: '基本掌握', color: '#3b82f6' };
        var dayName = Store.DAY_NAMES[(Number(item.day) || 1) - 1] || '周一';
        var linkedTask = item.taskId ? Store.getTask(item.taskId) : null;

        var card = el('div', {
          class: 'cp-card cp-clog-card',
          dataset: { rec: 'courseLog:' + item.id },
          style: { borderLeft: '4px solid ' + cColor, padding: '13px 15px', marginBottom: '10px' }
        }, [
          el('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
              el('span', {
                class: 'cp-chip',
                style: { background: cColor + '1f', color: cColor, fontWeight: '650', cursor: course ? 'pointer' : 'default' },
                text: item.courseName || (course ? course.name : '课程'),
                onclick: function () { if (course) CourseDialog.detail(course.id); }
              }),
              el('span', {
                class: 'cp-chip',
                style: { fontSize: '11.5px' },
                text: '第 ' + (item.week || 1) + ' 周 · ' + dayName + (item.periodText ? ' (' + item.periodText + ')' : '') + ' · ' + (item.date || '')
              }),
              el('span', {
                class: 'cp-chip',
                style: { background: mMeta.color + '1c', color: mMeta.color, fontWeight: '600', fontSize: '11.5px' },
                text: mMeta.icon + ' ' + mMeta.name
              })
            ]),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
              linkedTask ? el('span', {
                class: 'cp-chip cp-chip-green',
                style: { fontSize: '11px', cursor: 'pointer' },
                title: '点击打开关联的课后复习待办',
                onclick: function () { if (global.TaskDialog) global.TaskDialog.open(linkedTask.id); },
                text: (linkedTask.status === 'done' ? '✅ 已完成复习待办' : '📌 已转复习待办')
              }) : el('button', {
                class: 'cp-btn cp-btn-sm',
                style: { height: '25px', padding: '0 8px', fontSize: '11.5px' },
                onclick: function () {
                  var t = Store.convertCourseLogToTask(item.id);
                  if (t) {
                    UI.toast('已生成课后复习待办：「' + t.title + '」', 'ok');
                    renderListOnly();
                  }
                }
              }, ['📌 转复习待办']),
              el('button', {
                class: 'cp-btn cp-btn-sm',
                style: { height: '25px', padding: '0 8px', fontSize: '11.5px' },
                onclick: function () {
                  CourseLogDialog.open(item.id, { onDone: function () { view.render(); } });
                }
              }, ['编辑']),
              el('button', {
                class: 'cp-btn cp-btn-sm',
                style: { height: '25px', padding: '0 8px', fontSize: '11.5px', color: 'var(--red)' },
                onclick: function () {
                  V.confirm({
                    title: '删除课堂所学记录',
                    message: '确定删除「' + (item.topic || item.courseName) + '」这条课堂所学记录吗？',
                    danger: true,
                    okText: '删除'
                  }).then(function (ok) {
                    if (ok) {
                      Store.removeCourseLog(item.id);
                      UI.toast('已删除课堂所学记录');
                      view.render();
                    }
                  });
                }
              }, ['删除'])
            ])
          ]),
          el('div', {
            style: { fontSize: '14.5px', fontWeight: '650', color: 'var(--text)', marginBottom: '6px' },
            text: '📑 ' + (item.topic || '本节课堂内容')
          }),
          item.learned ? el('div', {
            style: { fontSize: '13px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: '1.65', background: 'var(--surface-2)', padding: '8px 11px', borderRadius: '8px' },
            text: item.learned
          }) : null,
          item.keyPoints ? el('div', {
            style: { fontSize: '12.5px', color: '#d97706', marginTop: '6px', padding: '6px 10px', borderRadius: '7px', background: 'rgba(245, 158, 11, 0.1)', whiteSpace: 'pre-wrap' },
            text: '⚠️ 重难点 / 待巩固：' + item.keyPoints
          }) : null
        ]);
        listHost.appendChild(card);
      });
    }

    renderListOnly();
  }

  var view = {
    id: 'schedule',
    name: '课程表',
    icon: V.icons.calendar,
    title: '课程表',
    order: 10,
    nav: true,

    root: null,
    week: null,
    subMode: 'table',
    defaultTab: 'table',
    logCourseFilter: '',
    logMasteryFilter: 'all',
    logQuery: '',
    getTab: function () { return this.subMode; },
    setTab: function (tab) {
      if (tab === 'calendar' || tab === 'month') {
        if (global.App && App.go) App.go('calendar', { tab: 'calendar' });
        return;
      }
      if (tab === 'agenda') {
        if (global.App && App.go) App.go('calendar', { tab: 'agenda' });
        return;
      }
      if (tab === 'logs' || tab === 'courseLogs') {
        this.subMode = 'logs';
      } else if (tab === 'exam') {
        this.subMode = 'exam';
      } else {
        this.subMode = 'table';
      }
      if (this.root) this.render();
    },

    /** 当前学期的时间冲突列表（渲染提示卡与批量导入预览都用它） */
    conflicts: function () {
      return findConflicts(semesterCourses(), Store.semester.weeks);
    },

    /** 顶栏右侧操作按钮（由 App.go 每次切页时调用） */
    actions: function (host) {

      /** 切换「按节次添加」；退出时清空已选格子 */
      function togglePick() {
        pickMode = !pickMode;
        if (!pickMode) picked = {};
        view.render();
        var box = V.$('#viewActions');
        if (box) {
          if (V.cleanupMenus) V.cleanupMenus();
          box.innerHTML = '';
          view.actions(box);
        }
      }

      /* 顶栏只留「导入 / 导出与分享 / 添加」三组；
         月历由上方分区胶囊「月历与长条」承担，不再重复放一个同名按钮。 */
      var vself = this;

      host.appendChild(V.menuButton({
        label: '导入',
        icon: V.icons.camera,
        items: [
          { icon: V.icons.camera, label: '导入课表', onclick: function () { if (global.OcrDialog) global.OcrDialog.open(); } },
          { icon: V.icons.upload || V.icons.download, label: '批量导入', onclick: function () { batchImportDialog(); } }
        ]
      }));

      host.appendChild(V.menuButton({
        label: '导出与分享',
        icon: V.icons.download,
        items: [
          { icon: V.icons.download || V.icons.upload, label: '导出图片', onclick: function () { if (global.ScheduleExport) ScheduleExport.previewDialog(); } },
          { icon: V.icons.clock, label: '导出日历', onclick: function () { if (global.Remind) Remind.exportDialog(); } },
          { icon: V.icons.clock, label: '导出空档', onclick: function () { exportFreeTimeDialog(vself.week); } },
          { icon: V.icons.grid || V.icons.calendar, label: '二维码分享', onclick: function () { if (global.QrSync) global.QrSync.openDialog('skeleton'); } }
        ]
      }));

      host.appendChild(V.menuButton({
        label: '添加',
        icon: V.icons.plus,
        primary: true,
        active: pickMode,
        items: [
          { icon: V.icons.plus, label: '自定义添加', onclick: function () { CourseDialog.open(); } },
          { icon: V.icons.grid || V.icons.calendar, label: pickMode ? '退出选择' : '按节次添加', onclick: togglePick }
        ]
      }));
    },

    mount: function (host) {
      var self = this;
      if (this.week == null) this.week = Store.currentWeek();
      this.root = el('section', { class: 'view', id: 'view-schedule' });
      host.appendChild(this.root);

      // 移动端横滑切周：左滑下一周，右滑上一周（与顶部箭头一致）
      V.addSwipe(this.root, {
        left: function () { self.goWeek(self.week + 1); },
        right: function () { self.goWeek(self.week - 1); }
      });

      this.render();
      return this.root;
    },

    onEnter: function () {
      this.week = Store.currentWeek();
      this.render();
    },

    _canFastUpdateWeek: function () {
      return (!this.subMode || this.subMode === 'table') &&
             this.root &&
             this._tableEl &&
             this.root.contains(this._tableEl) &&
             this._weekLabelEl &&
             this._weekChipEl &&
             !pickMode &&
             Store.courses && Store.courses.length > 0;
    },

    _buildExamCard: function (exams) {
      return el('div', { class: 'exam-card' }, [
        el('div', { class: 'exam-title' }, ['本周考试']),
        exams.map(function (e) {
          var tm = e.start ? (e.start + (e.end ? '–' + e.end : '')) : '时间待定';
          return el('div', {
            class: 'exam-row',
            onclick: function () { if (e.courseId) CourseDialog.detail(e.courseId); }
          }, [
            el('i', { class: 'exam-dot', style: { background: e.color || '#ef4444' } }),
            el('b', { text: e.name + (e.examLabel ? ' · ' + e.examLabel : '') }),
            el('span', {
              text: Store.DAY_NAMES[e.day - 1] + ' ' + e.date.slice(5) + ' · ' + tm +
                    (e.location ? ' · ' + e.location : '')
            })
          ]);
        })
      ]);
    },

    _buildGridContent: function (weekNo, dayCount) {
      var self = this;
      var todayStr = DateUtil.toStr(DateUtil.today());
      var renderAt = ScheduleLayout.build(weekNo);

      var thead = el('thead', { class: 'tt-head' });
      var trh = el('tr');
      trh.appendChild(el('th', { class: 'col-time' }));
      for (var d = 1; d <= dayCount; d++) {
        var date = Store.dateOf(weekNo, d);
        var isToday = DateUtil.toStr(date) === todayStr;
        var hol = (global.HolidayCN && Store.settings.showHoliday !== false)
          ? HolidayCN.lookup(DateUtil.toStr(date)) : null;
        trh.appendChild(el('th', { class: isToday ? 'today' : '' }, [
          el('div', { class: 'day-cell' }, [
            el('span', { class: 'dow', text: Store.DAY_NAMES[d - 1] }),
            el('span', { class: 'date', text: DateUtil.mdShort(date) }),
            hol ? el('span', {
              class: 'hol-badge ' + (hol.type === 'holiday' ? 'hol-holiday' : 'hol-work'),
              title: hol.name, text: hol.type === 'holiday' ? '休' : '班'
            }) : null
          ])
        ]));
      }
      thead.appendChild(trh);

      function periodGroup(pp) {
        var m = TimeUtil.toMin(pp.start);
        if (m < 720) return '上午';
        if (m < 1080) return '下午';
        return '晚上';
      }

      var prevGroup = null;
      var tbody = el('tbody', { class: 'tt-body' });
      Store.periods.forEach(function (p, ri) {
        var grp = periodGroup(p);
        var newGroup = grp !== prevGroup;
        prevGroup = grp;
        var tr = el('tr', { class: (newGroup && ri > 0) ? 'grp-sep' : '' });
        var timeCell = el('td', { class: 'col-time' }, [
          el('b', { text: p.name }),
          el('span', { text: p.start }),
          document.createElement('br'),
          el('span', { text: p.end })
        ]);
        if (newGroup) timeCell.insertBefore(el('span', { class: 'grp-tag', text: grp }), timeCell.firstChild);
        tr.appendChild(timeCell);

        for (var dc = 1; dc <= dayCount; dc++) {
          var inst = renderAt[dc + '|' + ri];
          if (inst && inst.type === 'covered') continue;

          if (inst && inst.type === 'block') {
            var cellB = el('td', {
              class: 'cell' + (dc >= 6 ? ' we-off' : '') + (inst.span > 1 ? ' has-custom' : '') +
                     (pickMode ? ' pickable' : ''),
              rowspan: inst.span > 1 ? inst.span : null,
              dataset: { day: dc, period: p.id },
              onclick: function (e) {
                if (e.target.closest('.cp-course-block, .course-block')) return;
                if (pickMode) { togglePick(+this.dataset.day, this.dataset.period); return; }
                CourseDialog.open(null, { day: +this.dataset.day, periodId: this.dataset.period });
              }
            });
            cellB.appendChild(el('div', { class: 'tcell' }, [self.block(inst.item)]));
            tr.appendChild(cellB);
            continue;
          }

          if (inst && inst.type === 'stack') {
            var cellS = el('td', {
              class: 'cell stack-cell' + (dc >= 6 ? ' we-off' : ''),
              dataset: { day: dc, period: p.id },
              onclick: function (e) {
                if (e.target.closest('.cp-course-block, .course-block')) return;
                if (pickMode) { togglePick(+this.dataset.day, this.dataset.period); return; }
                CourseDialog.open(null, { day: +this.dataset.day, periodId: this.dataset.period });
              }
            });
            var holdS = el('div', { class: 'tcell stack' });
            inst.items.forEach(function (p2) { holdS.appendChild(self.block(p2)); });
            cellS.appendChild(holdS);
            tr.appendChild(cellS);
            continue;
          }

          if (inst && inst.type === 'holiday' && Store.settings.showHoliday !== false) {
            var cellH = el('td', {
              class: 'cell holiday-col' + (dc >= 6 ? ' we-off' : ''),
              dataset: { day: dc, period: p.id }
            });
            cellH.appendChild(el('div', { class: 'tcell holiday-mark' }, [
              el('span', { class: 'hol-rest', text: '休' })
            ]));
            tr.appendChild(cellH);
            continue;
          }

          var weekend = dc >= 6;
          var isPicked = !!picked[pickKey(dc, p.id)];
          var cell = el('td', {
            class: 'cell' + (weekend ? ' we-off' : '') +
                   (pickMode ? ' pickable' : '') + (isPicked ? ' picked' : ''),
            dataset: { day: dc, period: p.id },
            onclick: function (e) {
              if (pickMode) {
                if (!e.target.closest('.cp-course-block, .course-block')) togglePick(+this.dataset.day, this.dataset.period);
                return;
              }
              if (e.target.closest('.cp-course-block, .course-block')) return;
              CourseDialog.open(null, { day: +this.dataset.day, periodId: this.dataset.period });
            }
          });
          if (pickMode) cell.appendChild(el('span', { class: 'cell-pick' }, [V.svg(V.icons.check, 15)]));
          var holder = el('div', { class: 'tcell' });
          holder.appendChild(el('div', { class: 'cell-add' }, [V.svg(V.icons.plus, 16)]));
          cell.appendChild(holder);
          tr.appendChild(cell);
        }
        tbody.appendChild(tr);
      });

      return { thead: thead, tbody: tbody };
    },

    _updateWeekView: function (weekNo) {
      var totalWeeks = Store.semester.weeks;
      var weekStart = Store.weekStartDate(weekNo);
      var dayCount = Store.settings.showWeekend === false ? 5 : 7;
      var weekEnd = DateUtil.addDays(weekStart, dayCount - 1);
      var inTerm = weekNo >= 1 && weekNo <= totalWeeks;

      if (this._weekLabelEl) {
        this._weekLabelEl.innerHTML = '';
        this._weekLabelEl.appendChild(el('span', { text: inTerm ? ('第 ' + weekNo + ' 周') : '假期周' }));
        this._weekLabelEl.appendChild(el('small', {
          text: DateUtil.mdShort(weekStart) + ' – ' + DateUtil.mdShort(weekEnd) +
                (inTerm ? ('  · 共 ' + totalWeeks + ' 周') : '')
        }));
      }

      if (this._weekChipEl) {
        var isCur = weekNo === Store.currentWeek();
        this._weekChipEl.className = 'chip ' + (isCur ? 'chip-primary' : '');
        this._weekChipEl.textContent = isCur ? '本周' : '非本周';
      }

      if (this._examSlotEl) {
        this._examSlotEl.innerHTML = '';
        var exams = Store.examsOfWeek(weekNo);
        if (exams.length) {
          this._examSlotEl.appendChild(this._buildExamCard(exams));
        }
      }

      if (this._tableEl) {
        var parts = this._buildGridContent(weekNo, dayCount);
        this._tableEl.innerHTML = '';
        this._tableEl.appendChild(parts.thead);
        this._tableEl.appendChild(parts.tbody);
      }

      var gridScrollEl = this._gridScrollEl;
      if (gridScrollEl) {
        setTimeout(function () {
          if (weekNo !== Store.currentWeek()) return;
          if (!gridScrollEl.isConnected) return;
          if (gridScrollEl.scrollWidth <= gridScrollEl.clientWidth + 4) return;
          var todayDow = DateUtil.isoDow(DateUtil.today());
          var ths = gridScrollEl.querySelectorAll('.cp-tt-head th, .tt-head th');
          if (ths.length > todayDow) {
            gridScrollEl.scrollLeft = Math.max(0, ths[todayDow].offsetLeft - ths[0].offsetWidth);
          }
        }, 0);
      }
    },

    goWeek: function (n) {
      this.week = Math.max(1, n);
      if (this._canFastUpdateWeek()) {
        this._updateWeekView(this.week);
        return;
      }
      this.render();
    },

    render: function () {
      var self = this;
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      /* ---- 经典模式下显示顶部子导航；六大分区模式下由顶部 #hubBar 统一承载，直接移除重复二级栏 ---- */
      var totalCourseLogs = (Store.courseLogs && Store.courseLogs.length) ? Store.courseLogs.length : 0;
      var isClassicNav = Store.getNavLayout && Store.getNavLayout() === 'classic';
      if (isClassicNav) {
        var modeBar = el('div', { class: 'cp-pane-tabs', style: { marginBottom: '12px' } }, [
          el('button', {
            class: 'cp-pane-tab' + (self.subMode === 'table' || !self.subMode ? ' cp-active' : ''),
            text: '📅 常规周课表',
            onclick: function () { self.subMode = 'table'; self.render(); }
          }),
          el('button', {
            class: 'cp-pane-tab' + (self.subMode === 'logs' ? ' cp-active' : ''),
            text: '📖 课堂所学' + (totalCourseLogs ? ' (' + totalCourseLogs + ')' : ''),
            onclick: function () { self.subMode = 'logs'; self.render(); }
          }),
          el('button', {
            class: 'cp-pane-tab',
            text: '🗓️ 月历',
            onclick: function () { if (global.App) App.go('calendar', { tab: 'calendar' }); }
          }),
          el('button', {
            class: 'cp-pane-tab' + (self.subMode === 'exam' ? ' cp-active' : ''),
            text: '🎯 考试周备考看板',
            onclick: function () { self.subMode = 'exam'; self.render(); }
          })
        ]);
        root.appendChild(modeBar);
      }

      if (self.subMode === 'logs') {
        renderCourseLogsBoard(root);
        return;
      }
      if (self.subMode === 'exam') {
        renderExamBoard(root);
        return;
      }

      var weekNo = this.week;
      var totalWeeks = Store.semester.weeks;
      var weekStart = Store.weekStartDate(weekNo);
      var dayCount = Store.settings.showWeekend === false ? 5 : 7;
      var weekEnd = DateUtil.addDays(weekStart, dayCount - 1);
      var inTerm = weekNo >= 1 && weekNo <= totalWeeks;

      /* ---- 周切换条 ---- */
      var label = el('div', { class: 'week-label' }, [
        el('span', { text: inTerm ? ('第 ' + weekNo + ' 周') : '假期周' }),
        el('small', { text: DateUtil.mdShort(weekStart) + ' – ' + DateUtil.mdShort(weekEnd) +
          (inTerm ? ('  · 共 ' + totalWeeks + ' 周') : '') })
      ]);
      self._weekLabelEl = label;

      var chip = el('span', { class: 'chip ' + (weekNo === Store.currentWeek() ? 'chip-primary' : ''),
        text: weekNo === Store.currentWeek() ? '本周' : '非本周' });
      self._weekChipEl = chip;

      var weekBar = el('div', { class: 'week-bar' }, [
        el('div', { class: 'week-nav' }, [
          el('button', {
            class: 'icon-btn', title: '上一周', 'aria-label': '上一周',
            onclick: function () { self.goWeek(weekNo - 1); }
          }, [V.svg(V.icons.left)]),
          label,
          el('button', {
            class: 'icon-btn', title: '下一周', 'aria-label': '下一周',
            onclick: function () { self.goWeek(weekNo + 1); }
          }, [V.svg(V.icons.right)])
        ]),
        el('div', { class: 'week-meta' }, [
          chip,
          el('button', {
            class: 'btn btn-sm',
            title: Store.settings.showWeekend ? '收起周六、周日两列' : '展开周六、周日两列',
            onclick: function () {
              var on = !Store.settings.showWeekend;
              Store.updateSettings({ showWeekend: on });
              UI.toast(on ? '已显示周末' : '已隐藏周末');
            }
          }, [Store.settings.showWeekend ? '隐藏周末' : '显示周末']),
          el('button', {
            class: 'btn btn-sm',
            title: '显示 / 隐藏「休 / 班」法定节假日与调休标记',
            onclick: function () {
              var on = Store.settings.showHoliday === false;
              Store.updateSettings({ showHoliday: on });
              UI.toast(on ? '已显示节假日标记' : '已隐藏节假日标记');
            }
          }, [Store.settings.showHoliday === false ? '显示节假日' : '隐藏节假日']),
          el('button', {
            class: 'btn btn-sm',
            title: '开启新学期向导，自动保留旧课表并归档已完成旧待办',
            onclick: function () { openNewSemesterWizard(function () { self.week = Store.currentWeek(); self.render(); }); }
          }, ['🎓 新学期向导']),
          weekNo === Store.currentWeek() ? null : el('button', {
            class: 'btn btn-sm', onclick: function () { self.goWeek(Store.currentWeek()); }
          }, ['回到本周'])
        ])
      ]);
      root.appendChild(weekBar);

      /* ---- 学分统计 ---- */
      var crNow = Store.currentCredits();
      var crOld = Store.historyCredits();
      root.appendChild(el('div', { class: 'credit-bar' }, [
        el('div', { class: 'cr-item' }, [
          el('b', { text: String(crNow) }),
          el('span', { text: '本学期学分' })
        ]),
        el('div', { class: 'cr-sep' }),
        el('div', { class: 'cr-item' }, [
          el('b', { text: String(crOld) }),
          el('span', { text: '历史学期学分' })
        ]),
        global.App && App.views.some(function (v) { return v.id === 'grades'; })
          ? el('button', {
              class: 'cr-go',
              onclick: function () { App.go('grades'); }
            }, ['查看成绩 →'])
          : null
      ]));

      /* ---- 本周考试 ---- */
      var examSlot = el('div', { class: 'exam-slot' });
      self._examSlotEl = examSlot;
      var exams = Store.examsOfWeek(weekNo);
      if (exams.length) examSlot.appendChild(self._buildExamCard(exams));
      root.appendChild(examSlot);

      /* ---- 时间冲突提示 ---- */
      var conflicts = self.conflicts();
      if (conflicts.length) root.appendChild(conflictCard(conflicts));

      /* ---- 表格 ---- */
      var todayStr = DateUtil.toStr(DateUtil.today());
      var parts = self._buildGridContent(weekNo, dayCount);
      var table = el('table', { class: 'tt' + (dayCount < 7 ? ' no-weekend' : '') }, [parts.thead, parts.tbody]);
      self._tableEl = table;

      /* ---- 空状态 ---- */
      if (!Store.courses.length) {
        root.appendChild(el('div', { class: 'grid-scroll' }, [table]));
        if (pickMode) root.appendChild(pickBar());
        root.appendChild(V.empty(
          V.icons.book, '还没有课程',
          pickMode
            ? '直接在上面点格子选上课时间，选完点底部「填课程信息」。'
            : '点顶部的「按节次添加」可以在课表上直接选格子排课；也可以先载入一份示例课表看看效果。',
          pickMode ? null : el('button', {
            class: 'btn btn-primary', onclick: function () { Sample.load(); }
          }, [V.svg(V.icons.download, 16), '载入示例课表'])
        ));
        return;
      }

      var gridScrollEl = el('div', { class: 'grid-scroll' }, [table]);
      self._gridScrollEl = gridScrollEl;
      root.appendChild(gridScrollEl);
      if (pickMode) root.appendChild(pickBar());

      // 窄屏：把课表横向滚动到今天所在列
      setTimeout(function () {
        if (weekNo !== Store.currentWeek()) return;
        if (!gridScrollEl.isConnected) return;
        if (gridScrollEl.scrollWidth <= gridScrollEl.clientWidth + 4) return;
        var todayDow = DateUtil.isoDow(DateUtil.today());
        var ths = gridScrollEl.querySelectorAll('.cp-tt-head th');
        if (ths.length > todayDow) {
          gridScrollEl.scrollLeft = Math.max(0, ths[todayDow].offsetLeft - ths[0].offsetWidth);
        }
      }, 0);

      /* ---- 图例 ---- */
      var uniq = Store.courses.slice().sort(function (a, b) {
        var ta = Store.courseTime(a), tb = Store.courseTime(b);
        var sa = ta ? ta.start : '99:99', sb = tb ? tb.start : '99:99';
        return a.day - b.day || (sa < sb ? -1 : sa > sb ? 1 : 0);
      });

      var legend = el('div', { class: 'card course-legend' },
        uniq.map(function (c) {
          return el('div', {
            class: 'legend-item', title: '点击查看课程详情',
            style: { cursor: 'pointer' },
            onclick: function () { CourseDialog.detail(c.id); }
          }, [
            el('i', { class: 'legend-dot', style: { background: c.color } }),
            el('b', { text: c.name, style: { fontWeight: '600' } }),
            el('span', { text: (c.location || '—'), style: { color: 'var(--text-3)' } })
          ]);
        })
      );
      root.appendChild(legend);

      /* ---- 节假日图例 ---- */
      if (Store.settings.showHoliday !== false && global.HolidayCN && HolidayCN.hasYear(todayStr.slice(0, 4))) {
        root.appendChild(el('div', { class: 'card holi-note' }, [
          el('span', { class: 'hol-badge hol-holiday', title: '法定放假日', text: '休' }),
          el('span', { class: 'holi-text', text: '法定放假日停课' }),
          el('span', { class: 'hol-badge hol-work', title: '调休补班', text: '班' }),
          el('span', { class: 'holi-text', text: '调休补班（按实际上课）' })
        ]));
      }
    },

    block: function (p) {
      var t = Store.courseTime(p);
      var loc = p.location || '';
      var meta = [];
      if (p.topic) meta.push('🔬' + p.topic);
      if (loc) meta.push(loc);
      if (t && t.mode === 'custom') meta.unshift(t.start + '-' + t.end);
      else if (t) meta.push(t.start);

      var hasBadge = (p.weekType !== 'all' || p.startWeek > 1 || p.endWeek < Store.semester.weeks);
      var exListBlock = (Store.courseExamList && Store.courseExamList(p)) || ((p.exam && p.exam.date) ? [p.exam] : []);
      var hasExam = exListBlock.length > 0;
      var exTipStr = exListBlock.map(function (ex) { return (ex.label || '考试') + ' ' + ex.date + (ex.start ? ' ' + ex.start : ''); }).join(' / ');
      var cid = p.courseId || p.id;
      var slotLogs = (Store.courseLogsOfSlot && this.week) ? Store.courseLogsOfSlot(cid, this.week, p.day) : [];
      var latestSlotLog = slotLogs.length ? slotLogs[0] : null;
      if (latestSlotLog && latestSlotLog.topic) {
        meta.push('📖' + String(latestSlotLog.topic).slice(0, 8));
      }

      return el('button', {
        class: 'course-block' + ((hasExam || hasBadge) ? ' has-marks' : ''),
        style: { '--c': p.color },
        dataset: { rec: 'course:' + cid },     // 全局搜索跳转后靠它定位
        title: p.name + ' · ' + (p.teacher || '') + ' · ' + (loc || '') +
               (hasExam ? '\n' + exTipStr : ''),
        onclick: function (e) {
          e.stopPropagation();
          if (pickMode) { togglePick(p.day, p.periodId || ''); return; }
          CourseDialog.detail(cid);
        }
      }, [
        (hasExam || hasBadge) ? el('span', { class: 'cb-marks' }, [
          hasExam ? el('span', { class: 'cb-exam', text: '考', title: exTipStr }) : null,
          hasBadge ? el('span', { class: 'cb-badge', text: Store.weekTypeText(p.weekType).slice(0, 1) }) : null
        ]) : null,
        el('span', {
          class: 'cb-name',
          style: (hasExam || hasBadge) ? { paddingRight: (hasExam ? 21 : 16) + 'px' } : null,
          text: p.name
        }),
        meta.length ? el('span', { class: 'cb-meta', text: meta.join(' · ') }) : null
      ]);
    }
  };

  /* ==========================================================
   * 课程新增 / 编辑 / 详情弹窗
   * ========================================================== */
  var CourseDialog = {
    open: function (courseId, preset) {
      preset = preset || {};
      var isEdit = !!courseId;
      var c = courseId ? Store.getCourse(courseId) : null;
      var data = {
        name: c ? c.name : '',
        teacher: c ? c.teacher : '',
        location: c ? c.location : '',
        color: c ? c.color : Store.COLORS[Store.courses.length % Store.COLORS.length],
        startWeek: c ? c.startWeek : 1,
        endWeek: c ? c.endWeek : Store.semester.weeks,
        weekType: c ? c.weekType : 'all',
        note: c ? c.note : '',
        credit: c ? (c.credit || 0) : 0,
        exam: c ? c.exam : null,
        exams: Store.courseExamSlots ? JSON.parse(JSON.stringify(Store.courseExamSlots(c))) : [
          { id: 'midterm', type: 'midterm', label: '期中考试', date: '', start: '', end: '', location: '' },
          { id: 'final', type: 'final', label: '期末考试', date: (c && c.exam && c.exam.date) || '', start: (c && c.exam && c.exam.start) || '', end: (c && c.exam && c.exam.end) || '', location: '' }
        ],
        rotations: c && Array.isArray(c.rotations) ? JSON.parse(JSON.stringify(c.rotations)) : []
      };

      // 现有全部时段（编辑时用来回填 / 保留未编辑的部分）
      var origSlots = c ? Store.courseSlots(c).map(function (s) {
        return {
          day: s.day, timeMode: s.timeMode, periodId: s.periodId,
          startTime: s.startTime, endTime: s.endTime, location: s.location || ''
        };
      }) : [];

      /* ---------- 按节次：多选格子 + 逐格地点 ---------- */
      var picked = {};      // 'day|periodId' -> 1
      var slotLocs = {};    // 'day|periodId' -> location
      origSlots.forEach(function (s) {
        if (s.timeMode === 'custom') return;
        var k = s.day + '|' + s.periodId;
        picked[k] = 1;
        slotLocs[k] = s.location || '';
      });
      if (preset.cells && preset.cells.length) {
        preset.cells.forEach(function (cc) { picked[cc.day + '|' + cc.periodId] = 1; });
      } else if (!isEdit && !Object.keys(picked).length) {
        var pid0 = preset.periodId || (Store.periods[0] && Store.periods[0].id);
        if (pid0) picked[(preset.day || 1) + '|' + pid0] = 1;
      }

      var customSlots = origSlots.filter(function (s) { return s.timeMode === 'custom'; });
      var selDays = customSlots.length
        ? customSlots.map(function (s) { return s.day; })
        : [preset.day || 1];
      var customStart = customSlots[0] ? customSlots[0].startTime : '08:00';
      var customEnd = customSlots[0] ? customSlots[0].endTime : '09:40';
      var customLoc = customSlots[0] ? (customSlots[0].location || '') : '';

      var timeMode = c ? (c.timeMode || 'period') : 'period';
      if (isEdit && !origSlots.some(function (s) { return s.timeMode !== 'custom'; }) && customSlots.length) {
        timeMode = 'custom';
      }

      var gridRedraws = [];

      function cellKey(day, pid) { return day + '|' + pid; }

      function toggleCell(day, pid) {
        var k = cellKey(day, pid);
        if (picked[k]) delete picked[k];
        else picked[k] = 1;
        redrawGrid();
        updateCount();
        renderSlotLoc();
      }

      function toggleCol(day) {
        var all = true;
        Store.periods.forEach(function (p) { if (!picked[cellKey(day, p.id)]) all = false; });
        Store.periods.forEach(function (p) {
          var k = cellKey(day, p.id);
          if (all) delete picked[k]; else picked[k] = 1;
        });
        redrawGrid();
        updateCount();
        renderSlotLoc();
      }

      function toggleRow(pid) {
        var all = true;
        for (var d = 1; d <= 7; d++) { if (!picked[cellKey(d, pid)]) all = false; }
        for (var d2 = 1; d2 <= 7; d2++) {
          var k = cellKey(d2, pid);
          if (all) delete picked[k]; else picked[k] = 1;
        }
        redrawGrid();
        updateCount();
        renderSlotLoc();
      }

      function countEl() { return V.$('#fPickCount'); }

      function updateCount() {
        var n = Object.keys(picked).length;
        var e = countEl();
        if (e) e.textContent = n ? ('已选 ' + n + ' 个时段') : '还没有选时段';
      }

      /** 网格：行首点整行、列头点整列、格子单独选 */
      function buildGridPick() {
        var wrap = el('div', { class: 'grid-pick' });

        var head = el('div', { class: 'gp-head' });
        head.appendChild(el('span', { class: 'gp-corner' }));
        Store.DAY_NAMES.forEach(function (n, i) {
          head.appendChild(el('button', {
            class: 'gp-col', type: 'button', text: n,
            title: '选中/取消这一整天',
            onclick: function () { toggleCol(i + 1); }
          }));
        });
        wrap.appendChild(head);

        Store.periods.forEach(function (p) {
          var row = el('div', { class: 'gp-r' });
          row.appendChild(el('button', {
            class: 'gp-row-label', type: 'button',
            title: '选中/取消这一整节',
            onclick: function () { toggleRow(p.id); }
          }, [
            el('b', { text: p.name }),
            el('span', { text: p.start })
          ]));
          for (var d = 1; d <= 7; d++) {
            (function (day, pid) {
              var cell = el('button', {
                class: 'gp-cell' + (picked[cellKey(day, pid)] ? ' on' : ''),
                type: 'button',
                dataset: { k: cellKey(day, pid) },
                title: Store.DAY_NAMES[day - 1] + ' ' + p.name,
                onclick: function () { toggleCell(day, pid); }
              }, [V.svg(V.icons.check, 12)]);
              row.appendChild(cell);
            })(d, p.id);
          }
          wrap.appendChild(row);
        });
        return wrap;
      }

      function redrawGrid() {
        gridRedraws.forEach(function (fn) { fn(); });
      }

      var gridPick = buildGridPick();
      gridRedraws.push(function () {
        V.$$('.gp-cell', gridPick).forEach(function (b) {
          b.classList.toggle('cp-on', !!picked[b.dataset.k]);
        });
      });

      var pickCount = el('div', { class: 'ocr-hint', id: 'fPickCount', text: '' });

      var slotLocBox = el('div', { class: 'slot-loc-box' });
      function renderSlotLoc() {
        slotLocBox.innerHTML = '';
        var keys = Object.keys(picked);
        if (!keys.length) { slotLocBox.style.display = 'none'; return; }
        slotLocBox.style.display = '';
        slotLocBox.appendChild(el('div', { class: 'ocr-hint', text: '各时段可单独设置地点（留空则用上方统一地点）' }));
        var order = Store.periods.map(function (p) { return p.id; });
        keys.sort(function (a, b) {
          var pa = a.split('|'), pb = b.split('|');
          return (+pa[0]) - (+pb[0]) || order.indexOf(pa[1]) - order.indexOf(pb[1]);
        });
        keys.forEach(function (k) {
          var parts = k.split('|');
          var day = +parts[0], pid = parts[1];
          var pname = (Store.getPeriod(pid) || {}).name || '';
          var inp = V.input({ placeholder: '留空则用统一地点', value: slotLocs[k] || '' });
          inp.addEventListener('input', function () { slotLocs[k] = inp.value; });
          inp.addEventListener('change', function () { slotLocs[k] = inp.value; });
          slotLocBox.appendChild(el('div', { class: 'slot-loc-row' }, [
            el('span', { class: 'slot-loc-label', text: Store.DAY_NAMES[day - 1] + ' ' + pname }),
            inp
          ]));
        });
      }

      var periodBox = el('div', { class: 'tm-sub' }, [
        gridPick,
        pickCount,
        slotLocBox,
        el('div', {
          class: 'ocr-hint',
          text: '想上几节课就点几个格子，这些时段都属于这一门课；点顶部「周一」选中一整天，点左侧「第1节」选中这一节的七天。'
        })
      ]);

      /* ---------- 自定义时间：星期多选 + 起止时间 ---------- */
      var dayRedraws = [];

      function chipPick(items, selected, opts) {
        opts = opts || {};
        var wrap = el('div', { class: 'chip-pick' + (opts.grid ? ' ' + opts.grid : '') });
        items.forEach(function (it) {
          var b = el('button', {
            class: 'cp-item' + (selected.indexOf(it.value) >= 0 ? ' on' : ''),
            type: 'button',
            onclick: function () {
              var i = selected.indexOf(it.value);
              if (i >= 0) {
                if (opts.minOne && selected.length <= 1) return;
                selected.splice(i, 1);
              } else {
                selected.push(it.value);
              }
              dayRedraws.forEach(function (fn) { fn(); });
            }
          }, [
            el('span', { class: 'cp-label', text: it.label }),
            it.sub ? el('span', { class: 'cp-sub', text: it.sub }) : null
          ]);
          b._v = it.value;
          wrap.appendChild(b);
        });
        dayRedraws.push(function () {
          V.$$('.cp-item', wrap).forEach(function (b) {
            b.classList.toggle('cp-on', selected.indexOf(b._v) >= 0);
          });
        });
        return wrap;
      }

      var dayPick = chipPick(
        Store.DAY_NAMES.map(function (n, i) { return { value: i + 1, label: n }; }),
        selDays, { minOne: true, grid: 'days' }
      );

      var fStart = V.input({ type: 'text', inputmode: 'numeric', placeholder: '08:00', value: customStart || '08:00' });
      var fEnd = V.input({ type: 'text', inputmode: 'numeric', placeholder: '09:40', value: customEnd || '09:40' });
      var fCustomLoc = V.input({ placeholder: '可选，例如：实验室', value: customLoc });

      function normT(v) {
        var m = /^(\d{1,2}):(\d{1,2})$/.exec((v || '').trim());
        if (!m) return '';
        var h = +m[1], mi = +m[2];
        if (h > 23 || mi > 59) return '';
        return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
      }
      function bindTimeInput(inp) {
        inp.addEventListener('input', function () {
          var v = inp.value.replace(/[^\d]/g, '');
          if (v.length === 4) inp.value = v.slice(0, 2) + ':' + v.slice(2);
        });
        inp.addEventListener('blur', function () {
          var t = normT(inp.value);
          if (t) inp.value = t;
        });
      }
      bindTimeInput(fStart);
      bindTimeInput(fEnd);
      function timeChips(target) {
        var times = [];
        Store.periods.forEach(function (pp) { if (times.indexOf(pp.start) < 0) times.push(pp.start); });
        ['08:00', '10:00', '14:00', '16:00', '19:00'].forEach(function (t) { if (times.indexOf(t) < 0) times.push(t); });
        return el('div', { class: 'time-chips' }, times.slice(0, 8).map(function (t) {
          return el('button', { class: 'chip', type: 'button', text: t, onclick: function () { target.value = t; } });
        }));
      }

      var customBox = el('div', { class: 'tm-sub' }, [
        V.field('星期几（可多选）', dayPick),
        el('div', { class: 'field-row' }, [
          V.field('开始时间', el('div', {}, [fStart, timeChips(fStart)])),
          V.field('结束时间', el('div', {}, [fEnd, timeChips(fEnd)]))
        ]),
        V.field('地点（这些时段共用）', fCustomLoc),
        el('div', {
          class: 'ocr-hint',
          text: '不受「设置 → 课程时间」里的节次限制，比如 09:10-10:30 的实习课，课表里会按时间跨行显示。'
        })
      ]);

      var fMode = V.segment(
        [{ value: 'period', label: '按节次' }, { value: 'custom', label: '自定义时间' }],
        timeMode,
        function (v) {
          timeMode = v;
          periodBox.style.display = v === 'period' ? '' : 'none';
          customBox.style.display = v === 'custom' ? '' : 'none';
        }
      );
      periodBox.style.display = timeMode === 'period' ? '' : 'none';
      customBox.style.display = timeMode === 'custom' ? '' : 'none';

      var fName = V.input({ placeholder: '例如：高等数学 A', value: data.name, dataset: { autofocus: '1' } });
      var fTeacher = V.input({ placeholder: '可选', value: data.teacher });
      var fLocation = V.input({ placeholder: '统一地点，例如：教三 301', value: data.location });
      var fNote = V.textarea({ placeholder: '可选，例如：需要带教材', value: data.note });
      var colorBox = V.colorPicker(data.color, function (v) { data.color = v; });
      var fWT = V.segment(
        [{ value: 'all', label: '每周' }, { value: 'odd', label: '单周' }, { value: 'even', label: '双周' }],
        data.weekType, function (v) { data.weekType = v; }
      );

      var fCredit = V.input({
        type: 'number', min: '0', max: '30', step: '0.5',
        value: data.credit || '', placeholder: '例如：3'
      });

      /* ---------- 课程考试时间（默认提供「期中考试」与「期末考试」两个独立槽位，且支持自由添加更多考试/随堂测验） ---------- */
      var examsBox = el('div', { class: 'exams-box', style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
      function syncExamsFromDOM() {
        if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
          try { document.activeElement.blur(); } catch (e) {}
        }
        var rows = examsBox.querySelectorAll('.cp-exam-edit-row');
        rows.forEach(function (row) {
          var ex = row._ex;
          if (!ex) return;
          var inps = row._inps || {};
          if (inps.lblInp) ex.label = inps.lblInp.value.trim();
          if (inps.dInp) ex.date = inps.dInp.value;
          if (inps.stInp) ex.start = inps.stInp.value.trim();
          if (inps.enInp) ex.end = inps.enInp.value.trim();
          if (inps.locInp) ex.location = inps.locInp.value.trim();
        });
      }
      function renderExamsEditor() {
        if (examsBox && examsBox.querySelector('.cp-exam-edit-row')) {
          syncExamsFromDOM();
        }
        examsBox.innerHTML = '';
        data.exams.forEach(function (ex, idx) {
          var isDefaultTwo = (idx === 0 && (ex.type === 'midterm' || ex.label === '期中考试')) ||
                             (idx === 1 && (ex.type === 'final' || ex.label === '期末考试'));
          var labelNode;
          if (isDefaultTwo) {
            labelNode = el('span', {
              class: 'chip',
              style: {
                fontWeight: '700', fontSize: '12px', padding: '4px 10px',
                background: idx === 0 ? 'rgba(14,165,233,0.12)' : 'rgba(79,70,229,0.12)',
                color: idx === 0 ? '#0284c7' : 'var(--primary)',
                flex: '0 0 auto'
              },
              text: (idx === 0 ? '📘 ' : '🎯 ') + ex.label
            });
          } else {
            var lblInp = V.input({
              placeholder: '考试名称，如：阶段测验1 / 实验考核',
              value: ex.label || '',
              style: { width: '130px', height: '32px', fontSize: '12.5px', fontWeight: '600' }
            });
            lblInp.oninput = function () { ex.label = lblInp.value.trim(); };
            labelNode = lblInp;
          }

          var dInp = V.input({ type: 'date', value: ex.date || '', style: { flex: '1', minWidth: '128px', height: '32px', fontSize: '12.5px' } });
          var stInp = V.input({ type: 'text', inputmode: 'numeric', placeholder: '开始 HH:MM', value: ex.start || '', style: { width: '92px', height: '32px', fontSize: '12.5px' } });
          var enInp = V.input({ type: 'text', inputmode: 'numeric', placeholder: '结束 HH:MM', value: ex.end || '', style: { width: '92px', height: '32px', fontSize: '12.5px' } });
          var locInp = V.input({ placeholder: '考场/地点（可选）', value: ex.location || '', style: { flex: '1', minWidth: '110px', height: '32px', fontSize: '12.5px' } });
          bindTimeInput(stInp);
          bindTimeInput(enInp);

          dInp.oninput = function () { ex.date = dInp.value; };
          dInp.onchange = function () { ex.date = dInp.value; };
          stInp.oninput = function () { ex.start = stInp.value.trim(); };
          enInp.oninput = function () { ex.end = enInp.value.trim(); };
          locInp.oninput = function () { ex.location = locInp.value.trim(); };

          var actionBtn = isDefaultTwo
            ? el('button', {
                class: 'btn btn-sm', type: 'button', title: '清空该场考试时间',
                style: { height: '28px', padding: '0 8px', fontSize: '11.5px', color: 'var(--text-3)' },
                onclick: function () {
                  ex.date = ''; ex.start = ''; ex.end = ''; ex.location = '';
                  renderExamsEditor();
                }
              }, ['清空'])
            : el('button', {
                class: 'icon-btn', type: 'button', title: '删除此场考试',
                onclick: function () { data.exams.splice(idx, 1); renderExamsEditor(); }
              }, [V.svg(V.icons.trash, 14)]);

          var examRow = el('div', {
            class: 'cp-exam-edit-row',
            style: {
              display: 'flex', flexDirection: 'column', gap: '6px',
              padding: '8px 10px', background: 'var(--surface-2)', borderRadius: '8px',
              border: ex.date ? '1px solid rgba(79,70,229,0.28)' : '1px solid transparent'
            }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } }, [
              labelNode,
              dInp,
              actionBtn
            ]),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
              stInp,
              el('span', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: '至' }),
              enInp,
              locInp
            ])
          ]);
          examRow._ex = ex;
          examRow._inps = { lblInp: (labelNode && labelNode.tagName === 'INPUT' ? labelNode : null), dInp: dInp, stInp: stInp, enInp: enInp, locInp: locInp };
          dInp.addEventListener('blur', function () { ex.date = dInp.value; });
          stInp.addEventListener('blur', function () { ex.start = stInp.value.trim(); });
          enInp.addEventListener('blur', function () { ex.end = enInp.value.trim(); });
          locInp.addEventListener('blur', function () { ex.location = locInp.value.trim(); });
          examsBox.appendChild(examRow);
        });

        examsBox.appendChild(el('button', {
          class: 'btn btn-sm', type: 'button', style: { alignSelf: 'flex-start' },
          onclick: function () {
            var nextNum = Math.max(1, data.exams.length - 1);
            data.exams.push({
              id: 'ex_' + Date.now() + '_' + nextNum,
              type: 'custom',
              label: '阶段测验 ' + nextNum,
              date: '',
              start: '',
              end: '',
              location: ''
            });
            renderExamsEditor();
          }
        }, [V.svg(V.icons.plus, 14), '添加更多考试 / 随堂测验']));
      }
      renderExamsEditor();

      /* ---------- 实验课多地点 / 课题按周轮转 ---------- */
      var rotBox = el('div', { class: 'rot-box', style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
      function syncRotationsFromDOM() {
        if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
          try { document.activeElement.blur(); } catch (e) {}
        }
        var rows = rotBox.querySelectorAll('.cp-rot-edit-row');
        rows.forEach(function (row) {
          var r = row._r;
          if (!r) return;
          var inps = row._inps || {};
          if (inps.swInp) r.startWeek = Math.max(1, parseInt(inps.swInp.value, 10) || 1);
          if (inps.ewInp) r.endWeek = Math.max(1, parseInt(inps.ewInp.value, 10) || r.startWeek || 1);
          if (inps.locInp) r.location = inps.locInp.value.trim();
          if (inps.topInp) r.topic = inps.topInp.value.trim();
        });
      }
      function renderRotations() {
        if (rotBox && rotBox.querySelector('.cp-rot-edit-row')) {
          syncRotationsFromDOM();
        }
        rotBox.innerHTML = '';
        if (data.rotations.length) {
          data.rotations.forEach(function (r, idx) {
            var swInp = V.input({ type: 'number', min: '1', max: String(Store.semester.weeks), value: r.startWeek || 1, style: { width: '58px' } });
            var ewInp = V.input({ type: 'number', min: '1', max: String(Store.semester.weeks), value: r.endWeek || r.startWeek || 1, style: { width: '58px' } });
            var locInp = V.input({ placeholder: '轮转教室，如：物理实验楼 204', value: r.location || '', style: { flex: '1', minWidth: '110px' } });
            var topInp = V.input({ placeholder: '实验课题（可选），如：迈克尔逊干涉', value: r.topic || '', style: { flex: '1', minWidth: '110px' } });
            swInp.oninput = function () { r.startWeek = Math.max(1, parseInt(swInp.value, 10) || 1); };
            ewInp.oninput = function () { r.endWeek = Math.max(1, parseInt(ewInp.value, 10) || r.startWeek || 1); };
            locInp.oninput = function () { r.location = locInp.value.trim(); };
            topInp.oninput = function () { r.topic = topInp.value.trim(); };
            var rotRow = el('div', {
              class: 'cp-rot-edit-row',
              style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '6px 8px', background: 'var(--surface-2)', borderRadius: '8px' }
            }, [
              el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '第' }),
              swInp,
              el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '–' }),
              ewInp,
              el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '周' }),
              locInp,
              topInp,
              el('button', {
                class: 'icon-btn', type: 'button', title: '删除此条轮转',
                onclick: function () { data.rotations.splice(idx, 1); renderRotations(); }
              }, [V.svg(V.icons.trash, 14)])
            ]);
            rotRow._r = r;
            rotRow._inps = { swInp: swInp, ewInp: ewInp, locInp: locInp, topInp: topInp };
            swInp.addEventListener('blur', function () { r.startWeek = Math.max(1, parseInt(swInp.value, 10) || 1); });
            ewInp.addEventListener('blur', function () { r.endWeek = Math.max(1, parseInt(ewInp.value, 10) || r.startWeek || 1); });
            locInp.addEventListener('blur', function () { r.location = locInp.value.trim(); });
            topInp.addEventListener('blur', function () { r.topic = topInp.value.trim(); });
            rotBox.appendChild(rotRow);
          });
        }
        rotBox.appendChild(el('button', {
          class: 'btn btn-sm', type: 'button', style: { alignSelf: 'flex-start' },
          onclick: function () {
            var nextW = data.rotations.length ? Math.min(Store.semester.weeks, (data.rotations[data.rotations.length - 1].endWeek || 1) + 1) : 1;
            data.rotations.push({ startWeek: nextW, endWeek: nextW, location: '', topic: '' });
            renderRotations();
          }
        }, [V.svg(V.icons.plus, 14), '添加周次教室/课题轮转']));
      }
      renderRotations();

      var body = [
        V.field('课程名称', fName),
        el('div', { class: 'field-row' }, [
          V.field('任课教师', fTeacher),
          V.field('上课地点', fLocation)
        ]),
        V.field('上课时间', el('div', { class: 'tm-box' }, [fMode, periodBox, customBox])),
        V.field('🔬 实验课多地点/课题轮转（可选）', rotBox, '不同周次在不同实验室或做不同课题时填写，课表会随当前周次自动切换教室与课题名'),
        V.field('学分', fCredit, '填了会自动出现在「成绩」里'),
        V.field('🎯 考试时间安排（默认含期中、期末，可独立设置时间并添加更多测验）', examsBox, '填写日期的考试会自动同步到课程表、备考看板、今日提醒与日历中'),
        el('div', { class: 'field-row' }, [
          V.field('起始周', V.input({ type: 'number', id: 'fSW', min: '1', max: String(Store.semester.weeks), value: data.startWeek })),
          V.field('结束周', V.input({ type: 'number', id: 'fEW', min: '1', max: String(Store.semester.weeks), value: data.endWeek }))
        ]),
        el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '-8px 0 14px' },
          text: '学期共 ' + Store.semester.weeks + ' 周，填 1 与 ' + Store.semester.weeks + ' 即整学期' }),
        V.field('单 / 双周', fWT),
        V.field('课程颜色', colorBox),
        V.field('备注', fNote)
      ];

      var m = V.modal({
        title: isEdit ? '编辑课程' : '添加课程',
        body: body,
        width: '560px',
        autofocus: true,
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({ title: '删除课程', message: '确定删除「' + (Store.getCourse(courseId) || {}).name + '」吗？该操作不可撤销。', danger: true, okText: '删除' })
                  .then(function (ok) { if (ok) { Store.removeCourse(courseId); UI.toast('已删除课程'); } });
              }, 220);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', { class: 'btn btn-primary', text: '保存', onclick: function () { save(); } })
        ])
      });

      updateCount();
      renderSlotLoc();

      function weekPair() {
        var sw = Math.max(1, parseInt(V.$('#fSW').value, 10) || 1);
        var ew = Math.min(Store.semester.weeks, parseInt(V.$('#fEW').value, 10) || Store.semester.weeks);
        return sw > ew ? { startWeek: ew, endWeek: sw } : { startWeek: sw, endWeek: ew };
      }

      function save() {
        if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
          try { document.activeElement.blur(); } catch (e) {}
        }
        syncExamsFromDOM();
        syncRotationsFromDOM();
        var name = fName.value.trim();
        if (!name) { UI.toast('请填写课程名称', 'err'); fName.focus(); return; }
        var wk = weekPair();

        var cleanExams = (data.exams || []).map(function (ex, idx) {
          return {
            id: ex.id || ('ex_' + idx),
            type: ex.type || (idx === 0 ? 'midterm' : (idx === 1 ? 'final' : 'custom')),
            label: (ex.label || (idx === 0 ? '期中考试' : (idx === 1 ? '期末考试' : ('考试 ' + (idx + 1))))).trim(),
            date: (ex.date || '').trim(),
            start: normT(ex.start || '') || (ex.start || '').trim(),
            end: normT(ex.end || '') || (ex.end || '').trim(),
            location: (ex.location || '').trim()
          };
        });
        var base = {
          name: name,
          teacher: fTeacher.value.trim(),
          color: data.color,
          credit: Math.max(0, parseFloat(fCredit.value) || 0),
          exams: cleanExams,
          weekType: data.weekType,
          note: fNote.value.trim(),
          rotations: data.rotations || [],
          startWeek: wk.startWeek,
          endWeek: wk.endWeek
        };

        var uniformLoc = fLocation.value.trim();
        var newSlots = [];

        if (timeMode === 'custom') {
          var st = normT(fStart.value), en = normT(fEnd.value);
          if (!st || !en) { UI.toast('请填写有效时间（HH:MM）', 'err'); return; }
          if (en <= st) { UI.toast('结束时间要晚于开始时间', 'err'); return; }
          if (!selDays.length) { UI.toast('请至少选一天', 'err'); return; }
          var cl = fCustomLoc.value.trim() || uniformLoc;
          selDays.forEach(function (day) {
            newSlots.push({ day: day, timeMode: 'custom', startTime: st, endTime: en, location: cl });
          });
          // 编辑时保留未在 UI 中编辑的 period 时段
          if (isEdit) {
            origSlots.forEach(function (s) { if (s.timeMode !== 'custom') newSlots.push(s); });
          }
        } else {
          var combos = Object.keys(picked).map(function (k) {
            var parts = k.split('|');
            return { day: parseInt(parts[0], 10), periodId: parts[1] };
          });
          if (!combos.length) { UI.toast('请先选至少一个时段', 'err'); return; }
          var order = Store.periods.map(function (p) { return p.id; });
          combos.sort(function (a, b) {
            return a.day - b.day || order.indexOf(a.periodId) - order.indexOf(b.periodId);
          });
          combos.forEach(function (cb) {
            newSlots.push({
              day: cb.day, timeMode: 'period', periodId: cb.periodId,
              location: (slotLocs[cb.day + '|' + cb.periodId] || '').trim() || uniformLoc
            });
          });
          // 编辑时保留未在 UI 中编辑的 custom 时段
          if (isEdit) {
            origSlots.forEach(function (s) { if (s.timeMode === 'custom') newSlots.push(s); });
          }
        }

        if (isEdit) {
          Store.updateCourse(courseId, Object.assign({}, base, { slots: newSlots }));
          if (Store.flushSave) Store.flushSave();
          m.close();
          UI.toast('课程已更新');
        } else {
          Store.addCourse(Object.assign({}, base, { slots: newSlots }));
          if (Store.flushSave) Store.flushSave();
          m.close();
          UI.toast('已添加课程');
          if (preset.onDone) preset.onDone();
        }
      }
    },

    /** 课程详情（只读卡 + 编辑入口 + 相关作业入口） */
    detail: function (courseId) {
      var c = Store.getCourse(courseId);
      if (!c) return;
      var slots = Store.courseSlots(c);
      var tasks = Store.tasks.filter(function (t) { return t.courseId === courseId; });

      var timeLines = slots.map(function (s) {
        var dayName = Store.DAY_NAMES[(s.day || 1) - 1];
        var str;
        if (s.timeMode === 'custom') {
          str = (s.startTime || '') + '–' + (s.endTime || '');
        } else {
          var p = Store.getPeriod(s.periodId);
          str = p ? (p.name + '　' + p.start + '–' + p.end) : '—';
        }
        var loc = s.location ? '　·　' + V.escapeHTML(s.location) : '';
        return dayName + ' ' + str + loc;
      });
      var timeLine = timeLines.join('<br>') || '—';

      var info = el('div', {
        class: 'preview-box',
        html:
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
          '<i style="width:12px;height:12px;border-radius:4px;background:' + c.color + ';display:inline-block"></i>' +
          '<b style="font-size:15px">' + V.escapeHTML(c.name) + '</b></div>' +
          '<div>时间：' + timeLine + '</div>' +
          '<div>周次：第 ' + c.startWeek + '–' + c.endWeek + ' 周（' + Store.weekTypeText(c.weekType) + '）</div>' +
          (c.credit > 0 ? '<div>学分：' + c.credit + '</div>' : '') +
          (function () {
            var sid = c.semesterId || Store.currentSemesterId;
            var grec = Store.gradeRecord ? Store.gradeRecord(sid, 'c:' + c.name, c.id) : null;
            if (!grec) return '';
            var parts = [];
            if (grec.root && Array.isArray(grec.root.children) && grec.root.children.length) {
              var compStr = grec.root.children.map(function (ch) {
                var scTxt = (ch.score != null && ch.score !== '') ? ('=' + ch.score + '分') : '';
                return V.escapeHTML(ch.name || '分项') + ' ' + (Number(ch.weight) || 0) + '%' + scTxt;
              }).join(' + ');
              parts.push('<div>📊 成绩构成：' + compStr + '</div>');
            }
            var disp = Store.gradeScoreOf ? Store.gradeScoreOf(grec) : null;
            if (disp && (disp.score != null || disp.label)) {
              parts.push('<div>🏆 当前总评：<b>' + V.escapeHTML(disp.label || String(Math.round(disp.score * 10) / 10)) + '</b>' +
                (disp.gp != null ? ('（GPA ' + Number(disp.gp).toFixed(2) + '）') : '') + '</div>');
            }
            return parts.join('');
          })() +
          ((Store.courseExamList && Store.courseExamList(c).length)
            ? Store.courseExamList(c).map(function (ex) {
                return '<div>🎯 ' + V.escapeHTML(ex.label || '考试') + '：' + ex.date +
                  (ex.start ? ' ' + ex.start + (ex.end ? '–' + ex.end : '') : '') +
                  (ex.location ? ' · ' + V.escapeHTML(ex.location) : '') + '</div>';
              }).join('')
            : (c.exam && c.exam.date
                ? '<div>考试：' + c.exam.date + (c.exam.start ? ' ' + c.exam.start + (c.exam.end ? '–' + c.exam.end : '') : '') + '</div>'
                : '')) +
          (c.teacher ? '<div>教师：' + V.escapeHTML(c.teacher) + '</div>' : '') +
          (Array.isArray(c.rotations) && c.rotations.length
            ? '<div style="margin-top:6px"><b>🔬 轮转安排：</b><br>' + c.rotations.map(function (r) {
                return '第 ' + r.startWeek + (r.endWeek && r.endWeek !== r.startWeek ? '–' + r.endWeek : '') + ' 周：' +
                  V.escapeHTML(r.location || c.location || '—') + (r.topic ? '（' + V.escapeHTML(r.topic) + '）' : '');
              }).join('<br>') + '</div>'
            : '') +
          (c.note ? '<div style="margin-top:6px">备注：' + V.escapeHTML(c.note) + '</div>' : '')
      });

      var courseFocusMin = 0, coursePomos = 0;
      var taskIdsMap = {};
      tasks.forEach(function (t) { taskIdsMap[t.id] = 1; });
      (Store.activities || []).forEach(function (a) {
        if (!a || a.planned) return;
        if (a.courseId === courseId || (a.taskId && taskIdsMap[a.taskId])) {
          courseFocusMin += TimeUtil.diffMin(a.start, a.end);
        }
      });
      ((Store.pomodoro && Store.pomodoro.sessions) || []).forEach(function (s) {
        if (s && (s.courseId === courseId || (s.taskId && taskIdsMap[s.taskId]))) {
          coursePomos += 1;
        }
      });
      var doneTaskCount = tasks.filter(function (t) { return t.status === 'done'; }).length;

      var linkBar = el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }
      }, [
        el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '12px' } }, [
          el('span', { class: 'chip chip-green', text: '累计投入 ' + TimeUtil.humanMin(courseFocusMin) + (coursePomos ? ' · ' + coursePomos + ' 🍅' : '') }),
          el('span', { class: 'chip chip-blue', text: '作业完成 ' + doneTaskCount + '/' + tasks.length })
        ]),
        el('div', { style: { display: 'flex', gap: '6px' } }, [
          el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              m.close();
              setTimeout(function () {
                if (global.TaskDialog) global.TaskDialog.open(null, { courseId: courseId });
              }, 180);
            }
          }, ['+ 新建本课待办']),
          el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              m.close();
              setTimeout(function () {
                if (global.GradeDialog && GradeDialog.openForCourse) {
                  GradeDialog.openForCourse(courseId, {
                    onSaved: function () {
                      if (global.App && App.current && App.current.render) App.current.render();
                    }
                  });
                } else if (global.App) App.go('grades');
              }, 180);
            }
          }, ['成绩与构成 →'])
        ])
      ]);

      var taskList = el('div', { class: 'card', style: { padding: '10px 12px' } }, [linkBar]);
      if (!tasks.length) {
        taskList.appendChild(el('div', { text: '这门课暂无作业/待办，点上方「+ 新建本课待办」即可关联。', style: { fontSize: '12.5px', color: 'var(--text-3)' } }));
      } else {
        tasks.forEach(function (t) {
          taskList.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', fontSize: '13px' }
          }, [
            el('i', { style: { width: '6px', height: '6px', borderRadius: '50%', background: UI.hStatusColor(t), flex: '0 0 6px' } }),
            el('span', {
              text: t.title,
              style: { flex: '1', cursor: 'pointer', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--text-3)' : 'var(--text)' },
              onclick: function () {
                m.close();
                setTimeout(function () { if (global.TaskDialog) global.TaskDialog.open(t.id); }, 180);
              }
            }),
            el('span', { text: t.dueDate ? (DateUtil.human(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '')) : '—', style: { fontSize: '11.5px', color: 'var(--text-3)' } }),
            t.status !== 'done' ? el('button', {
              class: 'btn btn-sm',
              style: { padding: '1px 7px', fontSize: '11px' },
              onclick: function (e) {
                e.stopPropagation();
                m.close();
                if (global.App && App.focusTask) App.focusTask(t.id);
              }
            }, ['🍅 专注']) : null
          ]));
        });
      }

      var exCount = Store.lessonExceptionsOfCourse(courseId).length;
      var isPe = Store.isPeCourse && Store.isPeCourse(c);
      var exField = V.field('单次调整' + (isPe ? '与运动联动' : ''), el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-sm',
          text: exCount ? ('本次停课 / 换教室 / 调课（已有 ' + exCount + ' 条）') : '本次停课 / 换教室 / 调课',
          onclick: function () {
            m.close();
            setTimeout(function () { LessonDialog.open(courseId, DateUtil.toStr(DateUtil.today())); }, 200);
          }
        }),
        isPe ? el('button', {
          class: 'btn btn-sm btn-primary',
          text: '🏃 记入今日锻炼（联动象限·计划·目标）',
          onclick: function () {
            var w = Store.logCourseWorkout(courseId, DateUtil.toStr(DateUtil.today()));
            m.close();
            if (w) {
              UI.toast('已将《' + c.name + '》记入今日锻炼（' + w.duration + ' 分钟）！', 'ok');
            }
          }
        }) : null
      ]));

      // 联动 1.5：本课「课堂所学记录（学了什么 / 章节进度 / 掌握度）」
      var cStats = Store.courseLearningStats ? Store.courseLearningStats(courseId) : { total: 0, mastered: 0, normal: 0, review: 0, logs: [] };
      var cLogs = cStats.logs || [];
      var logBox = el('div', { class: 'cp-card', style: { padding: '10px 12px' } });
      var logHead = el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
          el('span', { class: 'cp-chip cp-chip-primary', text: '已记所学 ' + cStats.total + ' 节' }),
          cStats.review > 0 ? el('span', { class: 'cp-chip', style: { color: '#f59e0b', background: 'rgba(245,158,11,0.12)' }, text: '🟠 待复习 ' + cStats.review }) : null,
          cStats.mastered > 0 ? el('span', { class: 'cp-chip', style: { color: '#10b981', background: 'rgba(16,185,129,0.12)' }, text: '🟢 已吃透 ' + cStats.mastered }) : null
        ]),
        el('div', { style: { display: 'flex', gap: '6px' } }, [
          cLogs.length > 0 ? el('button', {
            class: 'cp-btn cp-btn-sm',
            onclick: function () {
              m.close();
              view.logCourseFilter = courseId;
              view.subMode = 'logs';
              view.render();
              if (global.App && App.renderHubBar) App.renderHubBar();
            }
          }, ['全部日志 →']) : null,
          el('button', {
            class: 'cp-btn cp-btn-sm cp-btn-primary',
            onclick: function () {
              m.close();
              setTimeout(function () {
                CourseLogDialog.open(null, {
                  courseId: courseId,
                  week: view.week || Store.currentWeek(),
                  onDone: function () {
                    view.render();
                    CourseDialog.detail(courseId);
                  }
                });
              }, 160);
            }
          }, ['+ 记本节所学'])
        ])
      ]);
      logBox.appendChild(logHead);
      if (!cLogs.length) {
        logBox.appendChild(el('div', {
          style: { fontSize: '12.5px', color: 'var(--text-3)' },
          text: '暂未记录这门课每节学了什么。点击右上角「+ 记本节所学」，按周记录章节进度、核心知识点与重难点。'
        }));
      } else {
        cLogs.slice(0, 5).forEach(function (lg) {
          var mm = Store.masteryMeta ? Store.masteryMeta(lg.mastery) : { icon: '🔵', name: '基本掌握', color: '#3b82f6' };
          var dName = Store.DAY_NAMES[(Number(lg.day) || 1) - 1] || '周一';
          logBox.appendChild(el('div', {
            style: { padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: '12.5px', display: 'flex', flexDirection: 'column', gap: '3px' }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } }, [
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0', flex: '1' } }, [
                el('span', { style: { fontSize: '11px', color: 'var(--text-3)', flex: '0 0 auto' }, text: '第' + lg.week + '周·' + dName }),
                el('b', { style: { color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: lg.topic || '课堂所学' }),
                el('span', { style: { fontSize: '11px', color: mm.color, flex: '0 0 auto' }, text: mm.icon + mm.name })
              ]),
              el('div', { style: { display: 'flex', gap: '4px', flex: '0 0 auto' } }, [
                !lg.taskId ? el('button', {
                  class: 'cp-btn cp-btn-sm',
                  style: { padding: '1px 6px', fontSize: '11px' },
                  onclick: function (e) {
                    e.stopPropagation();
                    var t = Store.convertCourseLogToTask(lg.id);
                    if (t) {
                      UI.toast('已生成复习待办：「' + t.title + '」', 'ok');
                      m.close();
                      CourseDialog.detail(courseId);
                    }
                  }
                }, ['转待办']) : el('span', { style: { fontSize: '11px', color: 'var(--green)' }, text: '已转待办' }),
                el('button', {
                  class: 'cp-btn cp-btn-sm',
                  style: { padding: '1px 6px', fontSize: '11px' },
                  onclick: function (e) {
                    e.stopPropagation();
                    m.close();
                    setTimeout(function () {
                      CourseLogDialog.open(lg.id, {
                        onDone: function () {
                          view.render();
                          CourseDialog.detail(courseId);
                        }
                      });
                    }, 160);
                  }
                }, ['编辑'])
              ])
            ]),
            lg.learned ? el('div', { style: { color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }, text: String(lg.learned).slice(0, 140) }) : null,
            lg.keyPoints ? el('div', { style: { color: '#d97706', fontSize: '11.5px' }, text: '⚠️ 重难点：' + String(lg.keyPoints).slice(0, 100) }) : null
          ]));
        });
      }

      // 联动 2：关联本课的灵感与课堂笔记
      var courseNotes = Store.notesOfCourse ? Store.notesOfCourse(courseId) : [];
      var noteBox = el('div', { class: 'card', style: { padding: '10px 12px' } });
      var noteHead = el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }
      }, [
        el('span', { class: 'chip', text: '已关联笔记 ' + courseNotes.length + ' 条' }),
        el('div', { style: { display: 'flex', gap: '6px' } }, [
          (((Store.courseExamList && Store.courseExamList(c).length > 0) || (c.exam && c.exam.date)) && Store.createExamStudyPlan) ? el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              var res = Store.createExamStudyPlan(courseId);
              if (res && res.plan) {
                UI.toast('已生成备考计划「' + res.plan.title + '」', 'ok');
                m.close();
                CourseDialog.detail(courseId);
              }
            }
          }, ['✨ 生成备考计划']) : null,
          el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              m.close();
              setTimeout(function () {
                if (global.openQuickCourseNoteDialog) global.openQuickCourseNoteDialog(c);
              }, 180);
            }
          }, ['+ 记课堂笔记'])
        ])
      ]);
      noteBox.appendChild(noteHead);
      if (!courseNotes.length) {
        noteBox.appendChild(el('div', {
          style: { fontSize: '12.5px', color: 'var(--text-3)' },
          text: '暂无关联课堂笔记。点击右上角「+ 记课堂笔记」，自动带 #' + c.name + ' 标签归档。'
        }));
      } else {
        courseNotes.slice(0, 5).forEach(function (n) {
          noteBox.appendChild(el('div', {
            style: { padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: '12.5px', cursor: 'pointer' },
            onclick: function () {
              m.close();
              if (global.App) App.go('tasks', { tab: 'notes' });
            }
          }, [
            el('div', { style: { color: 'var(--text)', whiteSpace: 'pre-wrap' }, text: String(n.content || '').slice(0, 100) }),
            el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }, text: String(n.createdAt || '').slice(0, 10) })
          ]));
        });
      }

      var m = V.modal({
        title: '课程详情',
        body: [
          info,
          exField,
          V.field('📖 课堂所学记录（学了什么 / 章节进度）', logBox),
          V.field('作业与待办', taskList),
          V.field('课堂灵感与笔记', noteBox)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({
                  title: '删除课程',
                  message: '确定删除「' + c.name + '」吗？该课程下的作业会保留，但不再关联课程。',
                  danger: true, okText: '删除'
                }).then(function (ok) { if (ok) { Store.removeCourse(courseId); UI.toast('已删除课程'); } });
              }, 220);
            }
          }),
          el('button', { class: 'btn', text: '🍅 专注此科', onclick: function () { m.close(); if (global.App && App.focusCourse) App.focusCourse(courseId); } }),
          el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
          el('button', { class: 'btn btn-primary', text: '编辑课程', onclick: function () { m.close(); setTimeout(function () { CourseDialog.open(courseId); }, 200); } })
        ])
      });
    }
  };

  /* ==========================================================
   * 示例数据
   * ========================================================== */
  var Sample = {
    load: function () {
      var ps = Store.periods;
      var W = Store.semester.weeks;
      if (ps.length < 8) { UI.toast('节次太少，无法载入示例', 'err'); return; }
      var rows = [
        ['高等数学 A', '王敏', '教三 301', 1, 0, '#4f46e5', 'all'],
        ['大学英语', '李娜', '外语楼 204', 1, 2, '#0ea5e9', 'all'],
        ['数据结构', '陈昊', '信息楼 A105', 2, 0, '#10b981', 'all'],
        ['数据结构实验', '陈昊', '机房 3-12', 2, 4, '#10b981', 'odd'],
        ['线性代数', '周涛', '教二 108', 3, 2, '#f59e0b', 'all'],
        ['计算机网络', '吴桐', '信息楼 B203', 4, 0, '#8b5cf6', 'all'],
        ['体育（篮球）', '赵刚', '体育馆', 4, 6, '#14b8a6', 'all'],
        ['马克思主义基本原理', '孙玉', '教四 402', 5, 2, '#ef4444', 'all'],
        ['操作系统', '林峰', '信息楼 A307', 5, 4, '#ec4899', 'even']
      ];
      rows.forEach(function (r) {
        Store.addCourse({
          name: r[0], teacher: r[1], location: r[2], day: r[3],
          periodId: ps[r[4]].id, startWeek: 1, endWeek: W, weekType: r[6], color: r[5]
        });
      });
      UI.toast('已载入示例课表');
      setTimeout(function () {
        var host = document.getElementById('views');
        if (host) host.scrollTop = 0;
      }, 60);
    }
  };

  global.UI.hStatusColor = function (t) {
    return t.status === 'done' ? 'var(--text-3)' : (t.status === 'doing' ? 'var(--amber)' : 'var(--primary)');
  };

  /* ==========================================================
   * 单次调课例外：本次停课 / 临时换教室 / 调课补课
   * 只影响选中的那一天，不动整学期的周历规则。
   * ========================================================== */
  var LessonDialog = {
    open: function (courseId, dateStr) {
      var c = Store.getCourse(courseId);
      if (!c) return;
      var date = dateStr || DateUtil.toStr(DateUtil.today());

      var dateInput = V.input({ type: 'date', value: date });
      var list = el('div');
      var m;

      function fmtEx(e) {
        var d = e.date.slice(5).replace('-', '/');
        if (e.type === 'cancel') return d + ' 停课';
        if (e.type === 'room') return d + ' 换教室 → ' + e.location;
        var to = (e.toDate || '').slice(5).replace('-', '/');
        var t = e.toPeriodId ? (function () {
          var p = Store.getPeriod(e.toPeriodId);
          return p ? p.name : '';
        })() : (e.toStart ? e.toStart : '');
        return d + ' 调课 → ' + to + (t ? ' ' + t : '');
      }

      function drawList() {
        list.innerHTML = '';
        var exs = Store.lessonExceptionsOfCourse(courseId);
        if (!exs.length) {
          list.appendChild(el('div', { class: 'ocr-hint', text: '这门课还没有任何单次调整。' }));
          return;
        }
        exs.sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
          list.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--line)' }
          }, [
            el('span', { text: fmtEx(e), style: { flex: '1', fontSize: '13px' } }),
            el('button', {
              class: 'btn btn-sm', text: '撤销',
              onclick: function () { Store.removeCourseException(e.id); drawList(); }
            })
          ]));
        });
      }

      function save(ex) {
        Store.addCourseException(ex);
        UI.toast('已记录：' + CourseException.TYPES[ex.type]);
        drawList();
      }

      function cancelOne() {
        var d = dateInput.value;
        if (!d) { UI.toast('先选日期', 'err'); return; }
        save({ courseId: courseId, date: d, type: 'cancel' });
      }

      function roomOne() {
        var d = dateInput.value;
        if (!d) { UI.toast('先选日期', 'err'); return; }
        var inp = V.input({ type: 'text', placeholder: '新教室，如 三教 402' });
        var box = el('div', {}, [
          el('p', { class: 'ocr-hint', text: d + ' 的「' + c.name + '」改到哪里上课？' }),
          inp
        ]);
        V.confirm({
          title: '临时换教室',
          message: '',
          body: box,
          okText: '确定'
        }).then(function (ok) {
          if (!ok) return;
          var loc = inp.value.trim();
          if (!loc) { UI.toast('教室不能为空', 'err'); return; }
          save({ courseId: courseId, date: d, type: 'room', location: loc });
        });
      }

      function moveOne() {
        var d = dateInput.value;
        if (!d) { UI.toast('先选日期', 'err'); return; }
        var toDate = V.input({ type: 'date', value: d });
        var ps = [{ value: '', label: '时间不变' }].concat((Store.periods || []).map(function (p) {
          return { value: p.id, label: p.name + ' ' + p.start + '–' + p.end };
        }));
        var periodSel = V.select(ps, '');
        var box = el('div', {}, [
          el('p', { class: 'ocr-hint', text: '把 ' + d + ' 的「' + c.name + '」调到哪天？' }),
          V.field('调到', toDate),
          V.field('节次', periodSel, '选「时间不变」就按原课的节次上')
        ]);
        V.confirm({
          title: '调课到其它日期',
          message: '',
          body: box,
          okText: '确定'
        }).then(function (ok) {
          if (!ok) return;
          var td = toDate.value;
          if (!td) { UI.toast('先选调到哪天', 'err'); return; }
          if (td === d) { UI.toast('调到的日期不能和原日期一样', 'err'); return; }
          save({ courseId: courseId, date: d, type: 'move', toDate: td, toPeriodId: periodSel.value || '' });
        });
      }

      m = V.modal({
        title: '本次课设置',
        width: '460px',
        body: [
          el('p', { class: 'ocr-hint', text: '「' + c.name + '」· 只调整某一天，不影响整学期的课表。' }),
          V.field('哪一天', dateInput, '默认今天；改日期可以管理其它天的单次调整'),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0 14px' } }, [
            el('button', { class: 'btn btn-danger', text: '本次停课', onclick: cancelOne }),
            el('button', { class: 'btn', text: '临时换教室', onclick: roomOne }),
            el('button', { class: 'btn', text: '调课到其它天', onclick: moveOne })
          ]),
          V.field('已有的调整', list)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } })
        ])
      });
      drawList();
    }
  };

  /* ==========================================================
   * 建议 2：今日 / 本周空闲时间段一键生成文本弹窗
   * ========================================================== */
  function exportFreeTimeDialog(weekNo) {
    var curWeek = weekNo || Store.currentWeek();
    var mode = 'week'; // week | today
    var incWeekend = Store.settings.showWeekend !== false;
    var minDur = 45;

    var ta = V.textarea({ class: 'textarea sync-code', rows: 9 });
    var modeSeg = V.segment(
      [{ value: 'week', label: '第 ' + curWeek + ' 周空档汇总' }, { value: 'today', label: '今日课表与空档' }],
      mode,
      function (v) { mode = v; optRow.style.display = v === 'week' ? 'flex' : 'none'; refreshText(); }
    );
    var durSel = V.select(
      [
        { value: '30', label: '≥ 30 分钟算空档' },
        { value: '45', label: '≥ 45 分钟算空档' },
        { value: '60', label: '≥ 1 小时算空档' },
        { value: '120', label: '≥ 2 小时整块空档' }
      ],
      '45',
      { style: 'height:32px;width:auto;font-size:12.5px' }
    );
    var chkWeekend = el('input', { type: 'checkbox', checked: incWeekend ? 'checked' : null });
    durSel.addEventListener('change', function () { minDur = parseInt(durSel.value, 10) || 45; refreshText(); });
    chkWeekend.addEventListener('change', function () { incWeekend = !!chkWeekend.checked; refreshText(); });

    var optRow = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', margin: '8px 0' }
    }, [
      durSel,
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', cursor: 'pointer' } }, [
        chkWeekend,
        el('span', { text: '包含周六、周日' })
      ])
    ]);

    function refreshText() {
      if (mode === 'today' && Store.exportDayScheduleText) {
        ta.value = Store.exportDayScheduleText(DateUtil.toStr(DateUtil.today()));
      } else if (Store.exportFreeTimeText) {
        ta.value = Store.exportFreeTimeText({
          weekNo: curWeek,
          includeWeekend: incWeekend,
          minSlotMin: minDur
        });
      }
    }
    refreshText();

    var fm = V.modal({
      title: '📋 空闲时间段与课表文本导出',
      width: '500px',
      body: [
        modeSeg,
        optRow,
        ta,
        el('div', { class: 'ocr-hint', text: '已自动结合当前课表、考试、日程及象限计划块计算 08:00–22:00 之间的可用空档，可直接复制发给队友约讨论或社团排班。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { fm.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '📋 复制文本',
          onclick: function () {
            var text = ta.value;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () {
                UI.toast('已复制空闲时间段文本', 'ok');
              }).catch(function () {
                ta.select();
                document.execCommand('copy');
                UI.toast('已复制空闲时间段文本', 'ok');
              });
            } else {
              ta.select();
              document.execCommand('copy');
              UI.toast('已复制空闲时间段文本', 'ok');
            }
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 建议 3：学期末一键归档 / 开启新学期向导
   * ========================================================== */
  function openNewSemesterWizard(onDone) {
    var sug = Store.suggestNextSemester ? Store.suggestNextSemester() : {
      name: '新学期', startDate: DateUtil.toStr(DateUtil.weekStart(DateUtil.today())), weeks: 20
    };
    var fName = V.input({ value: sug.name, placeholder: '例如：2026–2027 学年 春季学期', dataset: { autofocus: '1' } });
    var fStart = V.input({ type: 'date', value: sug.startDate });
    var fWeeks = V.input({ type: 'number', min: '1', max: '30', value: String(sug.weeks || 20) });
    var chkArchive = el('input', { type: 'checkbox', checked: 'checked' });

    var tplOpts = [{ value: '', label: '空白新课表（推荐）' }].concat(
      (Store.semesters || []).map(function (s) {
        return { value: s.id, label: '复制「' + s.name + '」的课程' };
      })
    );
    var fTpl = V.select(tplOpts, '');

    var wm = V.modal({
      title: '🎓 开启新学期向导',
      width: '480px',
      autofocus: true,
      body: [
        el('div', {
          class: 'preview-box',
          style: { marginBottom: '12px', fontSize: '12.5px' },
          text: '✨ 开启新学期后，当前学期的课表与成绩会自动保留在历史学期中（随时可切回查阅），无需手动删课。'
        }),
        V.field('新学期名称', fName),
        el('div', { class: 'field-row' }, [
          V.field('第一周周一日期', fStart, '选任意一天会自动对齐到所在周周一'),
          V.field('学期总周数', fWeeks)
        ]),
        V.field('初始课表模板', fTpl),
        el('label', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '13px', cursor: 'pointer' }
        }, [
          chkArchive,
          el('span', { text: '顺手归档已完成的旧待办（未完成待办保留，统计不受影响）' })
        ])
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { wm.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '🎓 开启新学期',
          onclick: function () {
            var nm = fName.value.trim();
            if (!nm) { UI.toast('请填写新学期名称', 'err'); fName.focus(); return; }
            if (!fStart.value) { UI.toast('请选择开学日期', 'err'); fStart.focus(); return; }
            var res = Store.startNewSemester({
              name: nm,
              startDate: fStart.value,
              weeks: parseInt(fWeeks.value, 10) || 20,
              archiveDoneTasks: !!chkArchive.checked,
              copyFromSemesterId: fTpl.value || ''
            });
            wm.close();
            var msg = '🎉 已开启新学期「' + res.semester.name + '」' +
              (res.archivedTasks ? '，已归档 ' + res.archivedTasks + ' 项已完成旧待办' : '');
            UI.toast(msg, 'ok');
            if (typeof onDone === 'function') onDone(res);
          }
        })
      ])
    });
  }

  global.exportFreeTimeDialog = exportFreeTimeDialog;
  global.openNewSemesterWizard = openNewSemesterWizard;

  global.__LessonDialog = LessonDialog;

  /* ==========================================================
   * 课堂所学记录弹窗（新增 / 编辑「这节课学了什么」）
   * ========================================================== */
  var CourseLogDialog = {
    open: function (logId, preset) {
      preset = preset || {};
      var existing = logId && Store.getCourseLog ? Store.getCourseLog(logId) : null;
      var isEdit = !!existing;
      var semCourses = semesterCourses();
      var defaultCourseId = existing ? existing.courseId : (preset.courseId || (semCourses[0] ? semCourses[0].id : ''));
      var todayStr = DateUtil.toStr(DateUtil.today());
      var defaultWeek = existing ? existing.week : (preset.week || view.week || Store.currentWeek() || 1);
      var defaultDay = existing ? existing.day : (preset.day || DateUtil.isoDow(DateUtil.today()) || 1);
      var defaultDate = existing ? existing.date : (preset.date || DateUtil.toStr(Store.dateOf(defaultWeek, defaultDay)) || todayStr);
      var curMastery = existing ? existing.mastery : (preset.mastery || 'normal');

      var courseOpts = semCourses.map(function (c) { return { value: c.id, label: c.name }; });
      if (!courseOpts.length) courseOpts.push({ value: '', label: '通用课程（请先在课表添加课程）' });

      var fCourse = V.select(courseOpts, defaultCourseId);
      var fWeek = V.input({ type: 'number', min: '1', max: String(Store.semester.weeks || 25), value: String(defaultWeek) });
      var fDay = V.select(
        Store.DAY_NAMES.map(function (n, idx) { return { value: String(idx + 1), label: n }; }),
        String(defaultDay)
      );
      var fDate = V.input({ type: 'date', value: defaultDate });

      // 当切换课程或周次/星期时，自动同步对应上课日期与节次提示
      function syncDateFromWeekDay() {
        var w = Math.max(1, parseInt(fWeek.value, 10) || 1);
        var d = Math.max(1, Math.min(7, parseInt(fDay.value, 10) || 1));
        var calcDate = Store.dateOf(w, d);
        if (calcDate) fDate.value = DateUtil.toStr(calcDate);
      }
      fWeek.addEventListener('change', syncDateFromWeekDay);
      fDay.addEventListener('change', syncDateFromWeekDay);
      fCourse.addEventListener('change', function () {
        var cid = fCourse.value;
        var c = Store.getCourse(cid);
        if (c && !isEdit) {
          var slots = Store.courseSlots(c);
          if (slots && slots.length) {
            fDay.value = String(slots[0].day || 1);
            syncDateFromWeekDay();
          }
        }
      });

      var fTopic = V.input({
        placeholder: '例如：第 4 章 特征值与特征向量 / 二次型化标准形',
        value: existing ? existing.topic : (preset.topic || '')
      });
      var fLearned = V.textarea({
        rows: 4,
        placeholder: '记录这节课讲了哪些核心概念、公式定理、案例或实验结论…',
        value: existing ? existing.learned : (preset.learned || '')
      });
      var fKeyPoints = V.textarea({
        rows: 2,
        placeholder: '可选：没听懂的疑点、易错点、老师划的重点或课后要补的练习…',
        value: existing ? existing.keyPoints : (preset.keyPoints || '')
      });

      var masteryRow = el('div', { class: 'cp-seg-row' });
      var chkReviewTask = el('input', { type: 'checkbox', checked: preset.createReviewTask ? 'checked' : null });
      var chkSyncNote = el('input', { type: 'checkbox' });

      function paintMastery() {
        masteryRow.innerHTML = '';
        (Store.COURSE_MASTERY || [
          { key: 'mastered', name: '已吃透', icon: '🟢' },
          { key: 'normal', name: '基本掌握', icon: '🔵' },
          { key: 'review', name: '需重点复习', icon: '🟠' }
        ]).forEach(function (m) {
          var on = curMastery === m.key;
          masteryRow.appendChild(el('button', {
            type: 'button',
            class: 'cp-seg-btn' + (on ? ' cp-on' : ''),
            onclick: function () {
              curMastery = m.key;
              if (m.key === 'review' && !isEdit) chkReviewTask.checked = true;
              paintMastery();
            }
          }, [m.icon + ' ' + m.name]));
        });
      }
      paintMastery();

      var modalBody = [
        el('div', { class: 'cp-field-row' }, [
          V.field('所属课程', fCourse),
          V.field('上课日期', fDate)
        ]),
        el('div', { class: 'cp-field-row' }, [
          V.field('第几周', fWeek),
          V.field('星期', fDay)
        ]),
        V.field('本节章节 / 核心主题 *', fTopic, '一眼看清这节课讲到了哪里'),
        V.field('本节学了什么（核心知识点与收获）', fLearned),
        V.field('重难点 / 课后待消化（可选）', fKeyPoints),
        V.field('课堂掌握程度', masteryRow)
      ];

      if (!isEdit) {
        modalBody.push(el('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '8px', fontSize: '12.5px' }
        }, [
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            chkReviewTask,
            el('span', { text: '📌 同时生成一条课后巩固待办（自动关联本课程与一轮复习看板）' })
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
            chkSyncNote,
            el('span', { text: '💡 同步抄送一份到「课堂灵感笔记」（带 #课程名 与 #课堂所学 标签）' })
          ])
        ]));
      }

      var md = V.modal({
        title: isEdit ? '✏️ 编辑课堂所学记录' : '📖 记录课堂所学（这节课学了什么）',
        width: '540px',
        body: modalBody,
        footer: el('div', { class: 'cp-modal-foot' }, [
          el('button', { class: 'cp-btn', text: '取消', onclick: function () { md.close(); } }),
          el('button', {
            class: 'cp-btn cp-btn-primary',
            text: isEdit ? '保存修改' : '保存记录',
            onclick: function () {
              var topicVal = fTopic.value.trim();
              var learnedVal = fLearned.value.trim();
              if (!topicVal && !learnedVal) {
                UI.toast('请填写本节章节主题或所学内容', 'err');
                fTopic.focus();
                return;
              }
              var cid = fCourse.value;
              var courseObj = Store.getCourse(cid);
              var payload = {
                courseId: cid,
                courseName: courseObj ? courseObj.name : '通用课程',
                week: Math.max(1, parseInt(fWeek.value, 10) || 1),
                day: Math.max(1, Math.min(7, parseInt(fDay.value, 10) || 1)),
                date: fDate.value || todayStr,
                topic: topicVal || learnedVal.split(/\r?\n/)[0].slice(0, 36),
                learned: learnedVal,
                keyPoints: fKeyPoints.value.trim(),
                mastery: curMastery,
                createReviewTask: !isEdit && !!chkReviewTask.checked,
                syncToNotes: !isEdit && !!chkSyncNote.checked
              };
              if (isEdit) {
                Store.updateCourseLog(existing.id, payload);
                UI.toast('已更新课堂所学记录', 'ok');
              } else {
                Store.addCourseLog(payload);
                UI.toast('已记录《' + payload.courseName + '》课堂所学', 'ok');
              }
              md.close();
              if (typeof preset.onDone === 'function') preset.onDone();
              else if (view.root) view.render();
            }
          })
        ])
      });
    }
  };

  global.CourseLogDialog = CourseLogDialog;
  global.__CourseLogDialog = CourseLogDialog;
  global.__CourseDialog = CourseDialog;
  global.__SampleData = Sample;
  global.ScheduleLayout = ScheduleLayout;

  // 一门课有多个时段时格子上会有多个块，定位到第一个即可；支持课堂所学记录定位
  view.focusRecord = function (type, id) {
    if (!global.Search) return false;
    if (type === 'courseLog') {
      this.subMode = 'logs';
      this.logCourseFilter = '';
      this.logMasteryFilter = 'all';
      this.logQuery = '';
      this.render();
      return Search.flash(Search.findRec(type, id));
    }
    if (type !== 'course') return false;
    if (this.subMode !== 'table') {
      this.subMode = 'table';
      this.render();
    }
    return Search.flash(Search.findRec(type, id));
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


