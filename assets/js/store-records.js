/* ==========================================================
 * Store 记录域（v1.4.6 从 store.js 拆出）
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
  var tagMeta = ctx.tagMeta;
  var tagStyle = ctx.tagStyle;
  var tagParts = ctx.tagParts;
  var tagFull = ctx.tagFull;
  var moodOf = ctx.moodOf;
  var diaryDatePrompt = ctx.diaryDatePrompt;
  var moodStats = ctx.moodStats;
  var diaryOn = ctx.diaryOn;
  var diariesSorted = ctx.diariesSorted;
  var TAG_PRESETS = ctx.TAG_PRESETS;
  var TAG_GROUPS = ctx.TAG_GROUPS;
  var MOODS = ctx.MOODS;
  var MOOD_MIN_DAYS = ctx.MOOD_MIN_DAYS;
  var MOOD_CROSS_MIN_DAYS = ctx.MOOD_CROSS_MIN_DAYS;

  Object.assign(Store, {
  /* ===== 一次性日程 ===== */
  addEvent: function (data) {
    data = data || {};
    var e = {
      id: ctx.uid('e'),
      title: (data.title || '').trim() || '未命名日程',
      date: data.date || DateUtil.toStr(DateUtil.today()),
      start: data.start || '08:00',
      end: data.end || '09:00',
      location: (data.location || '').trim(),
      note: (data.note || '').trim(),
      courseId: data.courseId || '',
      done: !!data.done,
      doneAt: data.doneAt || (data.done ? new Date().toISOString() : ''),
      important: !!data.important,
      repeat: data.repeat || 'none',       // none | yearly | monthly
      kind: data.kind || '',               // birthday | anniversary | countdown | ''
      lunar: !!data.lunar,
      lunarMonth: data.lunarMonth || 0,
      lunarDay: data.lunarDay || 0,
      lunarLeap: !!data.lunarLeap,
      createdAt: new Date().toISOString()
    };
    Store.state.events.push(e);
    this.bumpUsage('event');
    this.emit();
    return e;
  },

  toggleEvent: function (id) {
    var e = this.getEvent(id);
    if (!e) return null;
    e.done = !e.done;
    e.doneAt = e.done ? new Date().toISOString() : '';
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
    Store.state.events = Store.state.events.filter(function (e) { return e.id !== id; });
    this.emit();
  },

  getEvent: function (id) {
    for (var i = 0; i < Store.state.events.length; i++) {
      if (Store.state.events[i].id === id) return Store.state.events[i];
    }
    return null;
  },

  eventsOf: function (dateStr) {
    return Store.state.events.filter(function (e) { return e.date === dateStr; })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  },

  /** 从今天起 n 天内的一次性日程 */
  upcomingEvents: function (n) {
    var from = DateUtil.toStr(DateUtil.today());
    var to = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), n - 1));
    return Store.state.events.filter(function (e) { return e.date >= from && e.date <= to; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
      });
  },

  /* ===== 活动记录 ===== */
  addActivity: function (data) {
    var aCourseId = String(data.courseId || '');
    var aCourseName = String(data.courseName || '');
    if (!aCourseName && aCourseId) {
      var aCourse = this.getCourse ? this.getCourse(aCourseId) : null;
      if (aCourse) aCourseName = aCourse.name || '';
    }
    var a = {
      id: ctx.uid('a'),
      date: data.date || DateUtil.toStr(DateUtil.today()),
      start: data.start || '00:00',
      end: data.end || '00:00',
      name: (data.name || '').trim() || '未命名活动',
      type: data.type || 'other',
      tags: ctx.normalizeTags(data.tags),
      note: (data.note || '').trim(),
      taskId: String(data.taskId || ''),   // 挂在哪条待办上：双向关联的这一头
      courseId: aCourseId,   // 关联课程（可选）：用于「课程投入」统计
      courseName: aCourseName,
      from: String(data.from || ''),       // 记录来源：'block' = 月历里补录的时间块
      planned: !!data.planned              // true = 计划专注块（还没发生，不进统计与投入）
    };
    Store.state.activities.push(a);
    this.emit();
    this.checkAchievements(true);
    // 记录类发分：手动在象限记的活动给积分；月历时间块(from:'block')与番茄钟自动记录(noAward)不重复发
    if (!data.noAward && a.from !== 'block') this.awardActivityPoints(a);
    return a;
  },

  /** 活动记录发分：0.25 分/分钟，每天上限 60 分（按活动所属日计） */
  awardActivityPoints: function (a) {
    var mins = TimeUtil.diffMin(a.start, a.end);
    if (!mins || mins <= 0) return;
    var gain = POMO.ACTIVITY_PER_MIN * mins;
    var todayAct = (Store.state.pomodoro.pointLog || [])
      .filter(function (l) { return l.date === a.date && l.src === 'activity'; })
      .reduce(function (s, l) { return s + l.n; }, 0);
    var allowed = Math.max(0, POMO.ACTIVITY_MAX_DAY - todayAct);
    var award = Math.min(gain, allowed);
    if (award > 0) this.addPoints(award, 'activity', a.date);
  },

  updateActivity: function (id, data) {
    var a = this.getActivity(id);
    if (!a) return null;
    Object.keys(data).forEach(function (k) {
      if (k === 'tags') a.tags = ctx.normalizeTags(data.tags);
      else a[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
    });
    this.emit();
    return a;
  },

  removeActivity: function (id) {
    Store.state.activities = Store.state.activities.filter(function (a) { return a.id !== id; });
    this.emit();
  },

  getActivity: function (id) {
    for (var i = 0; i < Store.state.activities.length; i++) {
      if (Store.state.activities[i].id === id) return Store.state.activities[i];
    }
    return null;
  },

  activitiesOf: function (dateStr) {
    return Store.state.activities.filter(function (a) { return a.date === dateStr; })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  },

  /* ===== 灵感速记 ===== */
addNote: function (data) {
  var n = {
    id: ctx.uid('n'),
    content: (data.content || '').trim(),
    tags: ctx.normalizeTags(data.tags),
    converted: false,
    createdAt: new Date().toISOString()
  };
  Store.state.notes.unshift(n);
  this.bumpUsage('note');
  this.emit();
  return n;
},

updateNote: function (id, data) {
  var n = this.getNote(id);
  if (!n) return null;
  Object.keys(data).forEach(function (k) {
    if (k === 'tags') n.tags = ctx.normalizeTags(data.tags);
    else n[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
  });
  this.emit();
  return n;
},

removeNote: function (id) {
  Store.state.notes = Store.state.notes.filter(function (n) { return n.id !== id; });
  this.emit();
},

getNote: function (id) {
  for (var i = 0; i < Store.state.notes.length; i++) {
    if (Store.state.notes[i].id === id) return Store.state.notes[i];
  }
  return null;
},

/* ===== 日记（一天一篇） ===== */
/**
 * 写入某天的日记。已有则更新，没有则新建 —— 一天只可能有一条。
 * @param {object} data { date, content, mood, sourceNoteId }
 * @returns {object} 日记对象
 */
saveDiary: function (data) {
  if (this.markAction) this.markAction('diary', 1);
  var date = (data.date || '').trim() || DateUtil.toStr(DateUtil.today());
  var exist = this.diaryOf(date);
  var content = typeof data.content === 'string' ? data.content : '';
  var mood = data.mood && moodOf(data.mood) ? data.mood : '';

  if (exist) {
    exist.content = content;
    exist.mood = mood;
    exist.updatedAt = new Date().toISOString();
    // sourceNoteId 只记录"最初从哪条灵感来的"，后续编辑不清空
    if (data.sourceNoteId) exist.sourceNoteId = data.sourceNoteId;
    this.emit();
    return exist;
  }

  var d = {
    id: ctx.uid('d'),
    date: date,
    content: content,
    mood: mood,                     // 选填，空串表示没标
    sourceNoteId: data.sourceNoteId || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  Store.state.diaries.unshift(d);
  this.bumpUsage('diary');
  this.emit();
  return d;
},

/** 只改心情（日历上快速标记用） */
setDiaryMood: function (date, mood) {
  var d = this.diaryOf(date);
  if (!d) return null;
  d.mood = mood && moodOf(mood) ? mood : '';
  d.updatedAt = new Date().toISOString();
  this.emit();
  return d;
},

removeDiary: function (id) {
  Store.state.diaries = Store.state.diaries.filter(function (d) { return d.id !== id; });
  this.emit();
},

getDiary: function (id) {
  for (var i = 0; i < Store.state.diaries.length; i++) {
    if (Store.state.diaries[i].id === id) return Store.state.diaries[i];
  }
  return null;
},

/** 某天的日记（一天一篇） */
diaryOf: function (dateStr) {
  return diaryOn(Store.state.diaries, dateStr);
},

/** 心情统计（把纯函数挂到 Store 上，界面层统一从 Store 取） */
moodStats: function (from, to) {
  return moodStats(Store.state.diaries, from, to);
},

/** 心情枚举 / 门槛，供界面层读取 */
MOODS: MOODS,
MOOD_MIN_DAYS: MOOD_MIN_DAYS,
MOOD_CROSS_MIN_DAYS: MOOD_CROSS_MIN_DAYS,
moodOf: moodOf,
diaryDatePrompt: diaryDatePrompt,
diariesSorted: function () { return diariesSorted(Store.state.diaries); },

/**
 * 全站标签（待办 / 灵感 / 活动 / 账目 / 专注 / 计划）
 * @returns [{ full, lv1, lv2, count, sources }]
 */
allTags: function (sources) {
  var map = {};
  var buckets = {
    task: Store.state.tasks, note: Store.state.notes, activity: Store.state.activities,
    ledger: Store.state.ledger, session: Store.state.pomodoro.sessions || [], plan: Store.state.plans
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
    Store.state.tasks, Store.state.notes, Store.state.activities,
    Store.state.ledger, Store.state.plans, Store.state.pomodoro.sessions || []
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
    Store.state.tasks, Store.state.notes, Store.state.activities,
    Store.state.ledger, Store.state.plans, Store.state.pomodoro.sessions || []
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
    t: Store.state.tasks, n: Store.state.notes, a: Store.state.activities,
    l: Store.state.ledger, s: Store.state.pomodoro.sessions || [], p: Store.state.plans
  }).forEach(function (k) {
    var b = { t: Store.state.tasks, n: Store.state.notes, a: Store.state.activities,
              l: Store.state.ledger, s: Store.state.pomodoro.sessions || [], p: Store.state.plans }[k];
    (b || []).forEach(function (item) {
      (item.tags || []).forEach(function (x) { set[x] = 1; });
    });
  });
  Object.keys(set).forEach(function (k) { out.push(k); });
  return out.sort();
},
  });
})(window);
