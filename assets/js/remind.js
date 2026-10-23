
/* ==========================================================
 * 上课提醒
 * ----------------------------------------------------------
 * 为什么不做「Notification 定时通知」：
 *   · Notification Triggers（showTrigger）Chrome 已停止开发且从未发布，
 *     Firefox / WebKit 无实现 —— 没有服务器就预定不了未来时刻的通知；
 *   · file:// 不是安全上下文，Notification 直接被禁（权限不弹、通知静默失败）；
 *   · iOS Safari 需 16.4+ 且必须先「添加到主屏幕」，后台 Tab 5–10 秒即终止 JS。
 * 所以拆成两条腿：
 *   ① 导出 .ics 到系统日历 —— 定时那部分交给操作系统，锁屏也响，桌面移动通吃；
 *   ② 页面内提醒 —— 只覆盖「页面开着」的场景，零权限零兼容问题。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

  /* ==========================================================
   * 一、.ics 生成（全是纯函数，不依赖 Store，可直接单测）
   * ========================================================== */

  /** RFC 5545 文本转义 */
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /**
   * RFC 5545 折行：一行不超过 75 个「字节」（不是字符），续行以单个空格开头。
   * 中文是 3 字节，按字符数折会超长；按码点逐字累加字节数才对，
   * 同时要避免把代理对（emoji）劈成两半。
   */
  function icsFold(line) {
    var out = [], cur = '', curBytes = 0, i = 0;
    while (i < line.length) {
      var cp = line.codePointAt(i);
      var nb = cp < 0x80 ? 1 : (cp < 0x800 ? 2 : (cp < 0x10000 ? 3 : 4));
      if (curBytes + nb > 74) { out.push(cur); cur = ''; curBytes = 0; }
      var w = cp > 0xFFFF ? 2 : 1;
      cur += line.substr(i, w);
      curBytes += nb;
      i += w;
    }
    if (cur) out.push(cur);
    return out.length ? out.join('\r\n ') : line;
  }

  /** 浮动本地时间（不带 TZID / Z）：课表本来就是「墙上时间」，换设备也不会错 */
  function icsDT(dateStr, timeStr) {
    var d = String(dateStr || '').replace(/-/g, '');
    var t = String(timeStr || '00:00').replace(':', '') + '00';
    return d + 'T' + t;
  }

  /** DTSTAMP 必须是 UTC，带 Z */
  function icsStamp(now) {
    var d = now || new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
           p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  }

  /**
   * 把「起止周 + 单双周」翻译成 ICS 的 FIRST OCCURRENCE + COUNT。
   * 返回 { first, count }，返回 null 表示这个区间内一次都排不上。
   */
  function slotOccurrences(startWeek, endWeek, weekType) {
    var s = startWeek == null ? 1 : (+startWeek || 1);
    var e = endWeek == null ? s : (+endWeek || s);
    if (e < s) return null;
    if (weekType === 'odd' || weekType === 'even') {
      var want = weekType === 'odd' ? 1 : 0;
      var first = (s % 2 === want) ? s : s + 1;
      if (first > e) return null;
      return { first: first, count: Math.floor((e - first) / 2) + 1 };
    }
    return { first: s, count: e - s + 1 };
  }

  /** TRIGGER：提前 N 分钟；0 分写成 PT0S，负号不能少 */
  function icsTrigger(leadMinutes) {
    var m = +leadMinutes || 0;
    return m > 0 ? ('-PT' + m + 'M') : 'PT0S';
  }

  function valarm(summary, leadMinutes) {
    return [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(summary),
      'TRIGGER:' + icsTrigger(leadMinutes),
      'END:VALARM'
    ];
  }

  /**
   * 生成 RFC 5545 日历文本。
   * opts: {
   *   semesterName, semesterStart('YYYY-MM-DD' 第1周周一),
   *   periods:[{id,start,end}], courses, exams, events,
   *   include:{courses,exams,events}, leadMinutes, now
   * }
   */
  function buildICS(opts) {
    var o = opts || {};
    var inc = o.include || {};
    var lead = o.leadMinutes == null ? 15 : o.leadMinutes;
    var stamp = icsStamp(o.now);
    var base = DateUtil.parse(o.semesterStart);
    var periods = {};
    (o.periods || []).forEach(function (p) { if (p && p.id) periods[p.id] = p; });

    var lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('PRODID:-//Course Planner//Course Planner//ZH');
    lines.push('VERSION:2.0');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:' + icsEscape(o.semesterName || '课程表'));
    if (o.tz) {
      lines.push('X-WR-TIMEZONE:Asia/Shanghai');
      lines.push('BEGIN:VTIMEZONE');
      lines.push('TZID:Asia/Shanghai');
      lines.push('BEGIN:STANDARD');
      lines.push('DTSTART:19700101T000000');
      lines.push('TZOFFSETFROM:+0800');
      lines.push('TZOFFSETTO:+0800');
      lines.push('TZNAME:CST');
      lines.push('END:STANDARD');
      lines.push('END:VTIMEZONE');
    }

    function dateOfWeekDay(weekNo, day) {
      return DateUtil.toStr(DateUtil.addDays(base, (weekNo - 1) * 7 + (day - 1)));
    }

    /** 该日期如果这门课确实有课，返回那个时段的 {start,end,oldLoc}；否则 null */
    function timeForCourseDate(c, dateStr) {
      var pd = DateUtil.parse(dateStr);
      if (!pd) return null;
      var weekNo = Math.floor(DateUtil.diffDays(pd, base) / 7) + 1;
      var dow = DateUtil.isoDow(pd);
      var hit = null;
      (c.slots || []).forEach(function (s) {
        if (!s || +s.day !== dow || hit) return;
        var occ = slotOccurrences(c.startWeek, c.endWeek, c.weekType);
        if (!occ) return;
        var interval = (c.weekType === 'odd' || c.weekType === 'even') ? 2 : 1;
        for (var k = 0; k < occ.count; k++) {
          if (dateOfWeekDay(occ.first + k * interval, dow) === dateStr) {
            var p = s.timeMode === 'custom'
              ? { start: s.startTime || '08:00', end: s.endTime || s.startTime || '08:00' }
              : periods[s.periodId];
            if (p && p.start) hit = { start: p.start, end: p.end, oldLoc: s.location || c.location || '' };
          }
        }
      });
      return hit;
    }

    /* ---- 课程：每个时段一条重复事件；单次调课例外用 EXDATE 排掉，
     *        换教室/调课在对应日期生成单独事件（RRULE 事件带不了单次变更） ---- */
    if (inc.courses !== false && base) {
      var exList = global.CourseException ? global.CourseException.normalize(o.exceptions) : [];
      (o.courses || []).forEach(function (c) {
        var fc = global.CourseException ? global.CourseException.forCourse(exList, c.id) : { excludes: [], rooms: [], moves: [] };

        (c.slots || []).forEach(function (s, i) {
          if (!s || !s.day) return;
          var p = s.timeMode === 'custom'
            ? { start: s.startTime || '08:00', end: s.endTime || s.startTime || '08:00' }
            : periods[s.periodId];
          if (!p || !p.start) return;
          var occ = slotOccurrences(c.startWeek, c.endWeek, c.weekType);
          if (!occ) return;
          var interval = (c.weekType === 'odd' || c.weekType === 'even') ? 2 : 1;
          // 这个时段的所有上课日期（拿去跟例外的原日期求交集 → EXDATE）
          var occDates = [];
          for (var k = 0; k < occ.count; k++) occDates.push(dateOfWeekDay(occ.first + k * interval, +s.day));
          var exLines = fc.excludes
            .filter(function (d) { return occDates.indexOf(d) >= 0; })
            .map(function (d) { return 'EXDATE:' + icsDT(d, p.start); });
          var date = dateOfWeekDay(occ.first, +s.day);
          var byday = BYDAY[(+s.day) - 1];
          if (!byday) return;
          var rrule = 'FREQ=WEEKLY' +
            (c.weekType === 'odd' || c.weekType === 'even' ? ';INTERVAL=2' : '') +
            ';BYDAY=' + byday + ';COUNT=' + occ.count;
          var loc = s.location || c.location || '';
          lines.push('BEGIN:VEVENT');
          lines.push('UID:' + c.id + '-' + i + '@course-planner');
          lines.push('DTSTAMP:' + stamp);
          lines.push('DTSTART:' + icsDT(date, p.start));
          lines.push('DTEND:' + icsDT(date, p.end || p.start));
          lines.push('RRULE:' + rrule);
          exLines.forEach(function (l) { lines.push(l); });
          lines.push('SUMMARY:' + icsEscape(c.name));
          if (loc) lines.push('LOCATION:' + icsEscape(loc));
          if (c.teacher) lines.push('DESCRIPTION:' + icsEscape(c.teacher));
          valarm(c.name, lead).forEach(function (l) { lines.push(l); });
          lines.push('END:VEVENT');
        });

        /* 换教室：原日期已被 EXDATE 排掉，这里补一条新教室的单次事件 */
        fc.rooms.forEach(function (e) {
          var t = timeForCourseDate(c, e.date);
          if (!t) return;
          lines.push('BEGIN:VEVENT');
          lines.push('UID:cex-' + e.id + '@course-planner');
          lines.push('DTSTAMP:' + stamp);
          lines.push('DTSTART:' + icsDT(e.date, t.start));
          lines.push('DTEND:' + icsDT(e.date, t.end || t.start));
          lines.push('SUMMARY:' + icsEscape(c.name));
          lines.push('LOCATION:' + icsEscape(e.location));
          lines.push('DESCRIPTION:' + icsEscape('临时换教室（原 ' + (t.oldLoc || c.location || '') + '）'));
          valarm(c.name, lead).forEach(function (l) { lines.push(l); });
          lines.push('END:VEVENT');
        });

        /* 调课：原日期已 EXDATE，在调到的日期生成关联原课程的单次事件 */
        fc.moves.forEach(function (e) {
          var t = e.toPeriodId
            ? (periods[e.toPeriodId] || null)
            : (e.toStart ? { start: e.toStart, end: e.toEnd || e.toStart } : timeForCourseDate(c, e.date));
          if (!t || !t.start) return;
          lines.push('BEGIN:VEVENT');
          lines.push('UID:cex-' + e.id + '@course-planner');
          lines.push('DTSTAMP:' + stamp);
          lines.push('DTSTART:' + icsDT(e.toDate, t.start));
          lines.push('DTEND:' + icsDT(e.toDate, t.end || t.start));
          lines.push('SUMMARY:' + icsEscape(c.name + '（调课）'));
          if (c.location || e.location) lines.push('LOCATION:' + icsEscape(e.location || c.location));
          lines.push('DESCRIPTION:' + icsEscape('由 ' + e.date + ' 调至'));
          valarm(c.name + '（调课）', lead).forEach(function (l) { lines.push(l); });
          lines.push('END:VEVENT');
        });
      });
    }

    /* ---- 考试：一次性事件 ---- */
    if (inc.exams) {
      (o.exams || []).forEach(function (e) {
        if (!e || !e.date) return;
        var name = e.name || e.title || '考试';
        lines.push('BEGIN:VEVENT');
        lines.push('UID:exam-' + (e.courseId || e.id || '') + '-' + e.date + '@course-planner');
        lines.push('DTSTAMP:' + stamp);
        if (e.start) {
          lines.push('DTSTART:' + icsDT(e.date, e.start));
          lines.push('DTEND:' + icsDT(e.date, e.end || e.start));
        } else {
          // 没写时间就当全天事件，DTEND 按 iCalendar 的惯例写成次日
          lines.push('DTSTART;VALUE=DATE:' + String(e.date).replace(/-/g, ''));
          lines.push('DTEND;VALUE=DATE:' +
            DateUtil.toStr(DateUtil.addDays(DateUtil.parse(e.date), 1)).replace(/-/g, ''));
        }
        lines.push('SUMMARY:' + icsEscape(name + '（考试）'));
        if (e.location) lines.push('LOCATION:' + icsEscape(e.location));
        valarm(name + '（考试）', Math.max(lead, 30)).forEach(function (l) { lines.push(l); });
        lines.push('END:VEVENT');
      });
    }

    /* ---- 重要日程：一次性事件 ---- */
    if (inc.events) {
      (o.events || []).forEach(function (e) {
        if (!e || !e.date || !e.important) return;
        lines.push('BEGIN:VEVENT');
        lines.push('UID:event-' + (e.id || '') + '-' + e.date + '@course-planner');
        lines.push('DTSTAMP:' + stamp);
        if (e.start) {
          lines.push('DTSTART:' + icsDT(e.date, e.start));
          lines.push('DTEND:' + icsDT(e.date, e.end || e.start));
        } else {
          lines.push('DTSTART;VALUE=DATE:' + String(e.date).replace(/-/g, ''));
          lines.push('DTEND;VALUE=DATE:' +
            DateUtil.toStr(DateUtil.addDays(DateUtil.parse(e.date), 1)).replace(/-/g, ''));
        }
        lines.push('SUMMARY:' + icsEscape(e.title));
        if (e.location) lines.push('LOCATION:' + icsEscape(e.location));
        if (e.note) lines.push('DESCRIPTION:' + icsEscape(e.note));
        valarm(e.title, Math.max(lead, 30)).forEach(function (l) { lines.push(l); });
        lines.push('END:VEVENT');
      });
    }

    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  /** 浏览器里下载成文件（统一走 SaveFile 保存通道，含复制兜底） */
  function downloadText(text, filename, mime) {
    SaveFile.save(filename, text, {
      mime: (mime || 'text/calendar').split(';')[0],
      ext: 'ics'
    }).then(function (r) {
      if (r.canceled) { UI.toast('已取消'); return; }
      if (r.method === 'picker' || r.method === 'share') UI.toast('已保存 ' + filename, 'ok');
    }).catch(function (e) { UI.toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
  }

  var ICS = {
    escape: icsEscape,
    fold: icsFold,
    dt: icsDT,
    stamp: icsStamp,
    occurrences: slotOccurrences,
    trigger: icsTrigger,
    build: buildICS,
    download: downloadText
  };

  /* ==========================================================
   * 二、从 Store 组装参数（唯一碰 Store 的地方，保持上面纯函数干净）
   * ========================================================== */

  function defaultOpts() {
    return {
      on: true,
      lead: 15,      // 提前多少分钟
      sound: true,
      exams: true,   // 导出的日历里含考试
      events: true,  // 含重要日程
      taskDue: true  // 待办到期（已逾期 / 今日到期）页面内提醒
    };
  }

  function opts() {
    var s = Store.state.settings;
    if (!s.remind) { s.remind = defaultOpts(); }
    var d = defaultOpts();
    Object.keys(d).forEach(function (k) { if (s.remind[k] == null) s.remind[k] = d[k]; });
    return s.remind;
  }

  /** 当前学期的课程（和冲突检测保持一致的口径） */
  function semesterCourses() {
    var sid = Store.semester.id;
    return Store.courses.filter(function (c) { return !c.semesterId || c.semesterId === sid; });
  }

  /** 组装 buildICS 需要的参数 */
  function collect(o) {
    var sem = Store.semester;
    var courses = semesterCourses();
    var exams = [];
    courses.forEach(function (c) {
      if (c.exam && c.exam.date) {
        exams.push({
          courseId: c.id, name: c.name, date: c.exam.date,
          start: c.exam.start, end: c.exam.end, location: c.exam.location || c.location
        });
      }
    });
    return {
      semesterName: sem.name,
      semesterStart: DateUtil.toStr(Store.semesterStart()),
      periods: Store.periods,
      courses: courses,
      exceptions: Store.state.courseExceptions || [],
      exams: o.exams ? exams : [],
      events: o.events ? Store.state.events : [],
      include: { courses: true, exams: !!o.exams, events: !!o.events },
      leadMinutes: o.lead
    };
  }

  function exportICS(o) {
    o = o || opts();
    var data = collect(o);
    var text = buildICS(data);
    var n = (text.match(/BEGIN:VEVENT/g) || []).length;
    if (!n) { UI.toast('当前学期还没有可导出的课程'); return 0; }
    var name = (Store.semester.name || '课表').replace(/[\\/:*?"<>|]/g, '') + '.ics';
    downloadText(text, name, 'text/calendar');
    UI.toast('已导出 ' + n + ' 条日程，导入系统日历后就会提醒');
    return n;
  }

  /* ==========================================================
   * 三、导出弹窗
   * ========================================================== */

  function exportDialog() {
    var o = opts();

    function row(label, node, hint) {
      return el('div', { class: 'setting-row', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' } }, [
        el('div', { style: { flex: '1' } }, [
          el('b', { style: { fontSize: '13px' }, text: label }),
          hint ? el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: hint }) : null
        ]),
        node
      ]);
    }

    var m = V.modal({
      title: '导出到系统日历',
      width: '560px',
      body: [
        el('p', {
          class: 'ocr-hint',
          text: '生成一个 .ics 文件，双击就能导入 Apple / 系统 / Google / Outlook 日历。' +
                '提醒由手机和电脑的日历负责 —— 锁屏会响、不用挂着这个页面，也不需要经过任何服务器。'
        }),
        row('提前多久提醒', (function () {
          var sel = el('select', {
            class: 'input',
            onchange: function (e) { o.lead = +e.target.value; }
          }, [0, 5, 10, 15, 20, 30].map(function (v) {
            return el('option', {
              value: String(v), text: v === 0 ? '上课时刻' : ('提前 ' + v + ' 分钟'),
              selected: o.lead === v
            });
          }));
          return sel;
        })(), '课表类 App 普遍是课前 15 分钟'),
        row('包含考试', (function () {
          var c = el('input', {
            type: 'checkbox', checked: !!o.exams,
            onchange: function (e) { o.exams = e.target.checked; }
          });
          return c;
        })(), '有考试时间的话会一起导出，考前 30 分钟提醒'),
        row('包含重要日程', (function () {
          var c = el('input', {
            type: 'checkbox', checked: !!o.events,
            onchange: function (e) { o.events = e.target.checked; }
          });
          return c;
        })(), '只导勾了「重要日程」的那些'),
        el('div', {
          class: 'ocr-hint',
          style: { marginTop: '10px' },
          text: '课程按周重复导出，单双周会自动拆成隔周重复；起止周用 COUNT 限定次数，不会多排。'
        })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '导出 .ics',
          onclick: function () { Store.save(); exportICS(o); m.close(); }
        })
      ])
    });
    return m;
  }

  /* ==========================================================
   * 四、页面内提醒（只在页面可见时跑，不申请任何权限）
   * ========================================================== */

  var fired = {};        // '日期|课程id|节次id' -> 1，避免同一节反复弹
  var tickId = null;
  var lastTimer = null;  // 上一次看到的番茄钟状态，用来判断是否自然跑完

  function todayKey() { return DateUtil.toStr(DateUtil.today()); }

  function beep() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.5);
    } catch (e) { /* 声音不重要，失败就算了 */ }
  }

  /** 今天要上的课（按今天星期几 + 本周是否在上；单次调课例外生效） */
  function todayLessons() {
    var today = DateUtil.today();
    var todayStr = DateUtil.toStr(today);
    var dow = DateUtil.isoDow(today);
    var weekNo = Store.weekOf(today);
    var out = [];
    // 单次例外：停课/调走的不提醒，换教室的用新教室，调进来的照样提醒
    var exByCid = {};
    (Store.canceledLessonsOn(todayStr) || []).forEach(function (c) { exByCid[c.courseId] = c; });
    semesterCourses().forEach(function (c) {
      if (!Store.courseInWeek(c, weekNo)) return;
      if (exByCid[c.id]) return;
      var roomEx = Store.lessonExceptionsOfCourse(c.id).filter(function (e) {
        return e.type === 'room' && e.location && e.date === todayStr;
      })[0];
      (c.slots || []).forEach(function (s) {
        if (!s || +s.day !== dow) return;
        var p = s.timeMode === 'custom'
          ? { id: '', start: s.startTime || '', end: s.endTime || s.startTime || '' }
          : (function () {
              for (var i = 0; i < Store.periods.length; i++) {
                if (Store.periods[i].id === s.periodId) return Store.periods[i];
              }
              return null;
            })();
        if (!p || !p.start) return;
        var courseRef = c;
        if (roomEx) {
          courseRef = {};
          Object.keys(c).forEach(function (k) { courseRef[k] = c[k]; });
          courseRef.location = roomEx.location;
        }
        out.push({ course: courseRef, slot: s, period: p, startMin: TimeUtil.toMin(p.start) });
      });
    });
    // 调进来的课：以原课程为模板，按调到的节次/时间提醒
    (Store.coursesOnDate(todayStr) || []).forEach(function (c) {
      if (!c._moveIn) return;
      var p = c.timeMode === 'custom'
        ? { id: '', start: c.startTime || '', end: c.endTime || c.startTime || '' }
        : (function () {
            for (var i = 0; i < Store.periods.length; i++) {
              if (Store.periods[i].id === c.periodId) return Store.periods[i];
            }
            return null;
          })();
      if (!p || !p.start) return;
      out.push({ course: c, slot: { day: dow, location: c.location || '' }, period: p, startMin: TimeUtil.toMin(p.start) });
    });
    return out.sort(function (a, b) { return a.startMin - b.startMin; });
  }

  /** 'HH:MM' -> 当天分钟数；解析不了返回 null */
  function timeToMin(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }

  /**
   * 待办到期提醒：只管「已逾期」和「今日到期」，每条一天只弹一次。
   * 与上课提醒共用同一套页面内策略（零权限、零兼容问题），见文件头说明。
   * 明天以后的一概不打扰——那属于计划，不属于提醒。
   */

  /** 检测当前环境是否支持 Web Notification（需 HTTPS/localhost，file:// 下通常不可用） */
  function canSysNotify() {
    if (typeof Notification === 'undefined') return false;
    if (typeof location !== 'undefined' && location.protocol === 'file:') return false;
    return true;
  }

  /** 请求系统通知权限，返回 Promise<'granted'|'denied'|'default'|'unsupported'> */
  function requestSysPermission() {
    if (!canSysNotify()) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    try {
      var p = Notification.requestPermission();
      if (p && typeof p.then === 'function') return p;
      return Promise.resolve(Notification.permission);
    } catch (_) {
      return Promise.resolve('denied');
    }
  }

  /** 发送系统级通知（若已开启 sysNotify 且已获授权），失败静默回退不抛错 */
  function fireSysNotify(title, body, tag) {
    var o = opts();
    if (!o.sysNotify || !canSysNotify() || Notification.permission !== 'granted') return false;
    try {
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg && reg.showNotification) {
            reg.showNotification(title, { body: body || '', tag: tag || 'cp-remind', icon: 'icon-192.png' });
          }
        }).catch(function () {});
      } else {
        new Notification(title, { body: body || '', tag: tag || 'cp-remind' });
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function checkTaskDue(o, dk, nowMin) {
    if (!o.taskDue) return;
    var lead = +o.lead || 0;
    var MAX = 3;                                   // 一次最多弹 3 条，剩下的合并成一条汇总

    var overdue = (Store.overdueTasks ? Store.overdueTasks() : []).map(function (t) {
      return { t: t, left: DateUtil.daysLeft(t.dueDate) };
    }).sort(function (a, b) { return a.left - b.left; });        // 逾期最久的在前

    var today = (Store.todayTasks ? Store.todayTasks() : []).filter(function (t) {
      if (!t.dueTime) return true;                              // 只有日期，当天弹一次
      var m = timeToMin(t.dueTime);
      if (m == null) return true;
      return nowMin >= m - lead;                                // 有具体时刻就按 lead 提前
    }).sort(function (a, b) {
      return (a.dueTime || '99:99') < (b.dueTime || '99:99') ? -1 : 1;
    });

    var list = overdue.concat(today.map(function (t) { return { t: t, left: 0 }; }));
    var total = list.length, n = 0;
    list.slice(0, MAX).forEach(function (it) {
      var key = dk + '|task|' + it.t.id;
      if (fired[key]) return;
      fired[key] = 1;
      var txt = (it.left < 0 ? '待办已逾期：' : '今日到期：') + (it.t.title || '未命名待办');
      if (it.t.dueTime) txt += '（' + it.t.dueTime + '）';
      if (it.left < 0) txt += ' · 逾期 ' + Math.abs(it.left) + ' 天';
      UI.toast(txt);
      fireSysNotify(it.left < 0 ? '待办已逾期' : '今日待办到期', txt, key);
      n++;
    });
    if (n && o.sound) beep();
    if (n && total > n) {
      var mk = dk + '|task|__more';
      if (!fired[mk]) {
        fired[mk] = 1;
        UI.toast('另有 ' + (total - n) + ' 条待办到期，去「待办」看看');
      }
    }
  }

  function check() {
    var o = opts();
    if (!o.on) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var dk = todayKey();

    todayLessons().forEach(function (it) {
      var lead = +o.lead || 0;
      var delta = it.startMin - nowMin;                 // 还有几分钟上课
      if (delta > lead || delta < 0) return;            // 还没到窗口，或已经开始/结束
      var key = dk + '|' + it.course.id + '|' + (it.period.id || it.slot.periodId || 'c');
      if (fired[key]) return;
      fired[key] = 1;
      var txt = (delta <= 0 ? '上课了：' : (delta + ' 分钟后上课：')) + it.course.name;
      var where = it.slot.location || it.course.location;
      if (where) txt += ' · ' + where;
      UI.toast(txt);
      fireSysNotify('上课提醒', txt, key);
      if (o.sound) beep();
    });

    // 待办到期（逾期 / 今日到期）
    checkTaskDue(o, dk, nowMin);

    // 番茄钟自然跑完（不是手动停的）时提示一下
    var t = Store.pomodoro && Store.pomodoro.timer;
    if (lastTimer && lastTimer.running && lastTimer.endAt && t && !t.running &&
        lastTimer.endAt <= Date.now()) {
      UI.toast('专注结束，休息一下');
      if (o.sound) beep();
    }
    lastTimer = t ? { running: !!t.running, endAt: t.endAt || 0 } : null;
  }

  var Remind = {
    ICS: ICS,
    opts: opts,
    exportICS: exportICS,
    exportDialog: exportDialog,
    todayLessons: todayLessons,
    canSysNotify: canSysNotify,
    requestSysPermission: requestSysPermission,
    fireSysNotify: fireSysNotify,
    check: check,

    start: function () {
      opts();                                   // 保证 settings.remind 存在
      if (tickId) clearInterval(tickId);
      tickId = setInterval(check, 30000);       // 30 秒一次，够用且省电
      // 切回页面立刻补一次：后台被节流后定时器不准，靠这个兜底
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) setTimeout(check, 60);
        });
      }
      setTimeout(check, 1200);                  // 启动后稍等再查，避免和引导撞车
    }
  };

  global.ICS = ICS;
  global.Remind = Remind;
})(typeof window !== 'undefined' ? window : this);
