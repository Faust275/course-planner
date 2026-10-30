/* ==========================================================
 * Store 考勤域（v1.4.5）
 * ----------------------------------------------------------
 * 每门课每天一条记录：出勤 / 缺勤 / 请假。
 * 只通过 Object.assign 挂回 Store，对外 API 独立成域，
 * 后续想加「迟到 / 早退」只改 STATUS 与 UI，不动 store.js。
 * ========================================================== */
(function (global) {
  'use strict';
  var Store = global.Store;
  if (!Store || !Store._ctx) return;
  var ctx = Store._ctx;

  var STATUS = { present: '出勤', absent: '缺勤', leave: '请假' };

  function list() {
    var s = Store.state;
    if (!Array.isArray(s.attendance)) s.attendance = [];
    return s.attendance;
  }

  function inSemester(course, sid) {
    if (!course) return false;
    return !course.semesterId || course.semesterId === sid;
  }

  Object.assign(Store, {
    ATTENDANCE_STATUS: STATUS,

    /** 某天的全部考勤记录 */
    attendanceOf: function (dateStr) {
      return list().filter(function (a) { return a && a.date === dateStr; });
    },

    /** 某门课某天的记录（没有则 null） */
    attendanceFor: function (courseId, dateStr) {
      var arr = list();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].courseId === courseId && arr[i].date === dateStr) return arr[i];
      }
      return null;
    },

    /** 标记 / 修改 / 清除（status 传空字符串即删除） */
    markAttendance: function (courseId, dateStr, status, note) {
      if (!courseId || !dateStr) return null;
      var arr = list(), i = -1;
      for (var k = 0; k < arr.length; k++) {
        if (arr[k] && arr[k].courseId === courseId && arr[k].date === dateStr) { i = k; break; }
      }
      if (!status) {
        if (i >= 0) { arr.splice(i, 1); this.emit(); }
        return null;
      }
      if (STATUS[status] == null) return null;
      if (i >= 0) {
        arr[i].status = status;
        if (note != null) arr[i].note = String(note);
        arr[i].updatedAt = new Date().toISOString();
      } else {
        arr.push({
          id: ctx.uid('att'),
          courseId: courseId,
          date: dateStr,
          status: status,
          note: note == null ? '' : String(note),
          updatedAt: new Date().toISOString()
        });
      }
      this.emit();
      return this.attendanceFor(courseId, dateStr);
    },

    /**
     * 统计：不给 courseId 就统计整个学期。
     * rate 只按「已标记」的出勤率算，未标记不计入分母。
     */
    attendanceStats: function (courseId, semesterId) {
      var sid = semesterId || (this.currentSemester ? this.currentSemester().id : '');
      var ids = {};
      (this.courses || []).forEach(function (c) { if (inSemester(c, sid)) ids[c.id] = 1; });
      var out = { present: 0, absent: 0, leave: 0, marked: 0, rate: null };
      list().forEach(function (a) {
        if (!a || STATUS[a.status] == null) return;
        if (courseId ? a.courseId !== courseId : !ids[a.courseId]) return;
        out[a.status] += 1;
        out.marked += 1;
      });
      if (out.marked > 0) out.rate = Math.round(out.present / out.marked * 1000) / 10;
      return out;
    },

    /** 按课程列出出勤率，报告用 */
    courseAttendance: function (semesterId) {
      var sid = semesterId || (this.currentSemester ? this.currentSemester().id : '');
      var self = this;
      return (this.courses || []).filter(function (c) { return inSemester(c, sid); }).map(function (c) {
        return { courseId: c.id, name: c.name || '', stats: self.attendanceStats(c.id, sid) };
      });
    }
  });
})(window);
