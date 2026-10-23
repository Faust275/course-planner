

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

      // 1) 汇总每格课程（一门课的多时段在此展开为多条伪记录）
      Store.courses.forEach(function (c) {
        if (c.semesterId && c.semesterId !== sid) return;
        if (!Store.courseInWeek(c, weekNo)) return;
        Store.expandCourse(c).forEach(function (p) {
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



  var view = {
    id: 'schedule',
    name: '课程表',
    icon: V.icons.calendar,
    title: '课程表',
    order: 10,
    nav: true,

    root: null,
    week: null,

    /** 当前学期的时间冲突列表（渲染提示卡与批量导入预览都用它） */
    conflicts: function () {
      return findConflicts(semesterCourses(), Store.semester.weeks);
    },

    /** 顶栏右侧操作按钮（由 App.go 每次切页时调用） */
    actions: function (host) {
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { App.go('calendar'); }
        }, [V.svg(V.icons.calendar, 16), '月历'])
      );
      host.appendChild(
        el('button', {
          class: 'btn' + (pickMode ? ' btn-on' : ''),
          onclick: function () {
            pickMode = !pickMode;
            if (!pickMode) picked = {};
            view.render();
            var box = V.$('#viewActions');
            if (box) { box.innerHTML = ''; view.actions(box); }
          }
        }, [V.svg(V.icons.grid || V.icons.calendar, 16), pickMode ? '退出选择' : '按节次添加'])
      );
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { if (global.OcrDialog) global.OcrDialog.open(); }
        }, [V.svg(V.icons.camera, 16), '导入课表'])
      );
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { batchImportDialog(); }
        }, [V.svg(V.icons.upload || V.icons.download, 16), '批量导入'])
      );
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { if (global.Remind) Remind.exportDialog(); }
        }, [V.svg(V.icons.clock, 16), '导出日历'])
      );
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { if (global.ScheduleExport) ScheduleExport.previewDialog(); }
        }, [V.svg(V.icons.download || V.icons.upload, 16), '导出图片'])
      );
      host.appendChild(
        el('button', {
          class: 'btn btn-primary',
          onclick: function () { CourseDialog.open(); }
        }, [V.svg(V.icons.plus, 16), '自定义添加'])
      );
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

    goWeek: function (n) {
      this.week = Math.max(1, n);
      this.render();
    },

    render: function () {
      var self = this;
      var root = this.root;
      root.innerHTML = '';

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

      var weekBar = el('div', { class: 'week-bar' }, [
        el('div', { class: 'week-nav' }, [
          el('button', { class: 'icon-btn', onclick: function () { self.goWeek(weekNo - 1); } }, [V.svg(V.icons.left)]),
          label,
          el('button', { class: 'icon-btn', onclick: function () { self.goWeek(weekNo + 1); } }, [V.svg(V.icons.right)])
        ]),
        el('div', { class: 'week-meta' }, [
          el('span', { class: 'chip ' + (weekNo === Store.currentWeek() ? 'chip-primary' : ''),
            text: weekNo === Store.currentWeek() ? '本周' : '非本周' }),
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
      var exams = Store.examsOfWeek(weekNo);
      if (exams.length) {
        root.appendChild(el('div', { class: 'exam-card' }, [
          el('div', { class: 'exam-title' }, ['本周考试']),
          exams.map(function (e) {
            var tm = e.start ? (e.start + (e.end ? '–' + e.end : '')) : '时间待定';
            return el('div', {
              class: 'exam-row',
              onclick: function () { if (e.courseId) CourseDialog.detail(e.courseId); }
            }, [
              el('i', { class: 'exam-dot', style: { background: e.color || '#ef4444' } }),
              el('b', { text: e.name }),
              el('span', {
                text: Store.DAY_NAMES[e.day - 1] + ' ' + e.date.slice(5) + ' · ' + tm +
                      (e.location ? ' · ' + e.location : '')
              })
            ]);
          })
        ]));
      }

      /* ---- 时间冲突提示 ---- */
      var conflicts = self.conflicts();
      if (conflicts.length) root.appendChild(conflictCard(conflicts));

      /* ---- 表格 ---- */
      var matrix = Store.weekMatrix(weekNo);
      var todayStr = DateUtil.toStr(DateUtil.today());
      var sid = Store.semester.id;

      // 布局指令统一由 ScheduleLayout 计算，导出图片时复用同一套规则
      var renderAt = ScheduleLayout.build(weekNo);


      var thead = el('thead', { class: 'tt-head' });
      var trh = el('tr');
      trh.appendChild(el('th', { class: 'col-time' }));
      for (var d = 1; d <= dayCount; d++) {
        var date = Store.dateOf(weekNo, d);
        var isToday = DateUtil.toStr(date) === todayStr;
        trh.appendChild(el('th', { class: isToday ? 'today' : '' }, [
          el('div', { class: 'day-cell' }, [
            el('span', { class: 'dow', text: Store.DAY_NAMES[d - 1] }),
            el('span', { class: 'date', text: DateUtil.mdShort(date) })
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
                if (e.target.closest('.course-block')) return;
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
                if (e.target.closest('.course-block')) return;
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

          var weekend = dc >= 6;
          var isPicked = !!picked[pickKey(dc, p.id)];
          var cell = el('td', {
            class: 'cell' + (weekend ? ' we-off' : '') +
                   (pickMode ? ' pickable' : '') + (isPicked ? ' picked' : ''),
            dataset: { day: dc, period: p.id },
            onclick: function (e) {
              if (pickMode) {
                if (!e.target.closest('.course-block')) togglePick(+this.dataset.day, this.dataset.period);
                return;
              }
              if (e.target.closest('.course-block')) return;
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

      var table = el('table', { class: 'tt' + (dayCount < 7 ? ' no-weekend' : '') }, [thead, tbody]);

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
    },

    block: function (p) {
      var t = Store.courseTime(p);
      var loc = p.location || '';
      var meta = [];
      if (loc) meta.push(loc);
      if (t && t.mode === 'custom') meta.unshift(t.start + '-' + t.end);
      else if (t) meta.push(t.start);

      var hasBadge = (p.weekType !== 'all' || p.startWeek > 1 || p.endWeek < Store.semester.weeks);
      var hasExam = !!(p.exam && p.exam.date);
      var cid = p.courseId || p.id;

      return el('button', {
        class: 'course-block' + ((hasExam || hasBadge) ? ' has-marks' : ''),
        style: { '--c': p.color },
        dataset: { rec: 'course:' + cid },     // 全局搜索跳转后靠它定位
        title: p.name + ' · ' + (p.teacher || '') + ' · ' + (loc || '') +
               (hasExam ? '\n考试：' + p.exam.date + ' ' + (p.exam.start || '') : ''),
        onclick: function (e) {
          e.stopPropagation();
          if (pickMode) { togglePick(p.day, p.periodId || ''); return; }
          CourseDialog.detail(cid);
        }
      }, [
        (hasExam || hasBadge) ? el('span', { class: 'cb-marks' }, [
          hasExam ? el('span', { class: 'cb-exam', text: '考', title: '考试 ' + p.exam.date }) : null,
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
      var fExamDate = V.input({ type: 'date', value: (data.exam && data.exam.date) || '' });
      var fExamStart = V.input({ type: 'text', inputmode: 'numeric', placeholder: 'HH:MM', value: (data.exam && data.exam.start) || '' });
      var fExamEnd = V.input({ type: 'text', inputmode: 'numeric', placeholder: 'HH:MM', value: (data.exam && data.exam.end) || '' });
      bindTimeInput(fExamStart);
      bindTimeInput(fExamEnd);

      var body = [
        V.field('课程名称', fName),
        el('div', { class: 'field-row' }, [
          V.field('任课教师', fTeacher),
          V.field('上课地点', fLocation)
        ]),
        V.field('上课时间', el('div', { class: 'tm-box' }, [fMode, periodBox, customBox])),
        el('div', { class: 'field-row' }, [
          V.field('学分', fCredit, '填了会自动出现在「成绩」里'),
          V.field('考试日期', fExamDate, '会同时显示在课程表和日程上')
        ]),
        el('div', { class: 'field-row' }, [
          V.field('考试开始', fExamStart),
          V.field('考试结束', fExamEnd)
        ]),
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
        var name = fName.value.trim();
        if (!name) { UI.toast('请填写课程名称', 'err'); fName.focus(); return; }
        var wk = weekPair();

        var examDate = fExamDate.value;
        var base = {
          name: name,
          teacher: fTeacher.value.trim(),
          color: data.color,
          credit: Math.max(0, parseFloat(fCredit.value) || 0),
          exam: examDate ? { date: examDate, start: fExamStart.value || '', end: fExamEnd.value || '' } : null,
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
          m.close();
          UI.toast('课程已更新');
        } else {
          Store.addCourse(Object.assign({}, base, { slots: newSlots }));
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
          (c.exam && c.exam.date
            ? '<div>考试：' + c.exam.date + (c.exam.start ? ' ' + c.exam.start + (c.exam.end ? '–' + c.exam.end : '') : '') + '</div>'
            : '') +
          (c.teacher ? '<div>教师：' + V.escapeHTML(c.teacher) + '</div>' : '') +
          (c.note ? '<div style="margin-top:6px">备注：' + V.escapeHTML(c.note) + '</div>' : '')
      });

      var taskList = el('div', { class: 'card', style: { padding: '10px 12px' } });
      if (!tasks.length) {
        taskList.appendChild(el('div', { text: '这门课暂无作业/待办', style: { fontSize: '12.5px', color: 'var(--text-3)' } }));
      } else {
        tasks.forEach(function (t) {
          taskList.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', fontSize: '13px' }
          }, [
            el('i', { style: { width: '6px', height: '6px', borderRadius: '50%', background: UI.hStatusColor(t), flex: '0 0 6px' } }),
            el('span', { text: t.title, style: { flex: '1', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--text-3)' : 'var(--text)' } }),
            el('span', { text: t.dueDate ? DateUtil.human(t.dueDate) : '—', style: { fontSize: '11.5px', color: 'var(--text-3)' } })
          ]));
        });
      }

      var exCount = Store.lessonExceptionsOfCourse(courseId).length;
      var exField = V.field('单次调整', el('div', {}, [
        el('button', {
          class: 'btn btn-sm',
          text: exCount ? ('本次停课 / 换教室 / 调课（已有 ' + exCount + ' 条）') : '本次停课 / 换教室 / 调课',
          onclick: function () {
            m.close();
            setTimeout(function () { LessonDialog.open(courseId, DateUtil.toStr(DateUtil.today())); }, 200);
          }
        })
      ]));

      var m = V.modal({
        title: '课程详情',
        body: [
          info,
          exField,
          V.field('作业与待办', taskList)
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

  global.__LessonDialog = LessonDialog;

  global.__CourseDialog = CourseDialog;
  global.__SampleData = Sample;
  global.ScheduleLayout = ScheduleLayout;

  // 一门课有多个时段时格子上会有多个块，定位到第一个即可
  view.focusRecord = function (type, id) {
    if (type !== 'course' || !global.Search) return false;
    return Search.flash(Search.findRec(type, id));
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


