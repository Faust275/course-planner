

/* ==========================================================
 * 视图：作业 / 待办
 * 同时提供全局 TaskRow（任务行）与 TaskDialog（编辑弹窗）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /* ==========================================================
   * 任务行组件
   * ========================================================== */
  var TaskRow = {
    /**
     * 已展开子任务的父任务 id。只存在内存里——刷新后回到折叠态，
     * 避免列表越用越长。
     */
    expanded: {},

    /** 状态圆点按钮 */
    check: function (t) {
      var cls = 'task-check ' + t.status;
      var btn = el('button', {
        class: cls,
        title: '点击切换状态',
        onclick: function (e) {
          e.stopPropagation();
          var was = t.status;
          Store.cycleTask(t.id);
          var now = Store.getTask(t.id);
          if (was !== 'done' && now && now.status === 'done') {
            UI.toast('完成待办，+' + POMO.TASK_DONE + ' 分');
          }
        }
      });
      if (t.status === 'doing') btn.appendChild(el('i'));
      if (t.status === 'done') btn.appendChild(V.svg('M4 12l5 5L20 6', 13));
      return btn;
    },

    /**
     * 子任务进度徽章 2/4。
     * 只在有子任务、且设置里开了 showProgress 时出现。
     */
    progBadge: function (t) {
      if (!Store.subtaskOpts().showProgress) return null;
      var pr = Store.subtaskProgress(t.id);
      if (!pr.total) return null;
      return el('span', {
        class: 'chip subtask-prog' + (pr.allDone ? ' is-done' : ''),
        style: { padding: '0 6px', fontSize: '10.5px' },
        title: '子任务进度 ' + pr.done + '/' + pr.total,
        text: pr.done + '/' + pr.total
      });
    },

    dueChip: function (t) {
      if (!t.dueDate) return el('span', { class: 'chip', text: '无截止' });
      var left = DateUtil.daysLeft(t.dueDate);
      var label = DateUtil.human(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '');
      var cls = 'chip';
      if (t.status === 'done') cls = 'chip';
      else if (left < 0) { cls = 'chip chip-red'; label = '逾期 ' + Math.abs(left) + ' 天'; }
      else if (left === 0) { cls = 'chip chip-amber'; label = '今天' + (t.dueTime ? ' ' + t.dueTime : ''); }
      else if (left <= 2) cls = 'chip chip-blue';
      return el('span', { class: cls, text: label });
    },

    LABELS: { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' },

    repLabel: function (t) {
      return (t.repeat && TaskRow.LABELS[t.repeat.type]) ? TaskRow.LABELS[t.repeat.type] : '';
    },

    build: function (t, opts) {
      opts = opts || {};
      var course = t.courseId ? Store.getCourse(t.courseId) : null;
      var kids = opts.noKids ? [] : Store.subtasksOf(t.id);
      var open = !!TaskRow.expanded[t.id];
      var pr = kids.length ? Store.subtaskProgress(t.id) : null;

      var meta = [];
      // 时间投入：待办 → 时间记录 的这一头（番茄钟关联后自动累计）
      var inv = Store.taskInvest(t.id);
      if (inv.minutes > 0) {
        meta.push(el('span', {
          class: 'chip chip-green',
          style: { padding: '0 6px', fontSize: '10.5px' },
          title: inv.count + ' 条记录' + (inv.pomodoros ? ' · ' + inv.pomodoros + ' 个番茄' : ''),
          text: '已投入 ' + TimeUtil.humanMin(inv.minutes)
        }));
      }
      if (course) {
        meta.push(el('span', {
          style: { display: 'inline-flex', alignItems: 'center', gap: '4px' }
        }, [
          el('i', { style: { width: '7px', height: '7px', borderRadius: '2px', background: course.color } }),
          document.createTextNode(course.name)
        ]));
      }
      if (opts.compact && t.dueDate) meta.push(document.createTextNode(DateUtil.human(t.dueDate)));

      var row = el('div', {
        class: 'task-row' + (t.status === 'done' ? ' done' : '') + (opts.compact ? ' compact' : '') +
               (kids.length ? ' has-kids' : '') + (t.parentId ? ' is-child' : ''),
        dataset: { rec: 'task:' + t.id },     // 全局搜索跳转后靠它定位
        onclick: function () { TaskDialog.open(t.id); }
      }, [
        TaskRow.check(t),
        el('div', { class: 'task-main' }, [
          el('div', { class: 'task-title-row' }, [
            el('div', { class: 'task-title', text: t.title }),
            pr ? TaskRow.progBadge(t) : null
          ]),
          (meta.length || t.note || (t.tags && t.tags.length) || TaskRow.repLabel(t)) ? el('div', { class: 'task-meta' }, [
            meta.length ? el('span', { class: 'task-course' }, meta) : null,
            t.priority === 'high' ? el('span', { class: 'chip chip-red', text: '重要', style: { padding: '0 6px', fontSize: '10.5px' } }) : null,
            (t.repeat && t.repeat.type !== 'none') ? el('span', { class: 'chip', style: { padding: '0 6px', fontSize: '10.5px' }, text: '↻ ' + TaskRow.repLabel(t) }) : null,
            (t.tags && t.tags.length) ? t.tags.map(function (x) {
              return V.tagChip(x);
            }) : null,
            t.note && !opts.compact ? el('span', { class: 'task-note', text: t.note }) : null
          ]) : null
        ]),
        kids.length ? el('button', {
          class: 'subtask-toggle' + (open ? ' open' : ''),
          title: open ? '收起子任务' : '展开 ' + kids.length + ' 个子任务',
          onclick: function (e) {
            e.stopPropagation();
            TaskRow.expanded[t.id] = !TaskRow.expanded[t.id];
            if (opts.onToggle) opts.onToggle();
          }
        }, [V.svg(V.icons.down, 14)]) : null,
        opts.compact ? null : TaskRow.dueChip(t)
      ]);

      if (!kids.length) return row;

      // 子任务默认折叠：外面套一层容器，展开时把子行插到父行下面
      var wrap = el('div', { class: 'subtask-wrap' }, [row]);
      if (open) {
        var box = el('div', { class: 'subtask-box' });
        kids.forEach(function (c) { box.appendChild(TaskRow.build(c, { noKids: true })); });
        box.appendChild(el('button', {
          class: 'subtask-add',
          onclick: function (e) {
            e.stopPropagation();
            TaskDialog.open(null, { parentId: t.id });
          }
        }, [V.svg(V.icons.plus, 13), '添加子任务']));
        wrap.appendChild(box);
      }
      return wrap;
    }
  };

  /* ==========================================================
   * 任务编辑弹窗
   * ========================================================== */
  var TaskDialog = {
    open: function (taskId, preset) {
      preset = preset || {};
      var isEdit = !!taskId;
      var t = taskId ? Store.getTask(taskId) : null;
      var data = {
        status: t ? t.status : 'todo',
        priority: t ? t.priority : 'normal'
      };

      /* ---- 子任务关系 ---- */
      var parent = t ? (t.parentId ? Store.getTask(t.parentId) : null)
                     : (preset.parentId ? Store.getTask(preset.parentId) : null);
      // 已有子任务的父任务不能再挂到别人下面（只允许一层）
      var myKids = isEdit ? Store.subtasksOf(taskId) : [];
      // 反查：这条待办上挂了哪些时间记录（番茄钟结束会自动写一条）
      var inv0 = isEdit ? Store.taskInvest(taskId) : null;

      var courseOpts = [{ value: '', label: '不关联课程' }].concat(
        Store.courses.map(function (c) { return { value: c.id, label: c.name }; })
      );

      var fTitle = V.input({
        placeholder: '例如：完成高数第三章习题',
        value: t ? t.title : '',
        dataset: { autofocus: '1' }
      });

      /* ---- 语音输入 ---- */
      var liveEl = el('div', { class: 'mic-live' });
      var handle = null;
      var listening = false;
      var micTimer = null;

      function clearMic() {
        if (micTimer) { clearTimeout(micTimer); micTimer = null; }
      }

      function stopMic() {
        listening = false;
        micBtn.classList.remove('cp-listening');
        clearMic();
      }

      /** 语音结果填表：标题 + 日期 + 时间 */
      function fillFromSpeech(text) {
        var parsed = global.Speech.parse(text);
        fTitle.value = parsed.title || text;
        if (parsed.dueDate) fDate.value = parsed.dueDate;
        if (parsed.dueTime) fTime.value = parsed.dueTime;
        liveEl.textContent = '';
        var extra = [];
        if (parsed.dueDate) extra.push(parsed.dueDate.slice(5));
        if (parsed.dueTime) extra.push(parsed.dueTime);
        UI.toast(extra.length ? ('已识别：' + extra.join(' ')) : '已填入标题');
      }

      var micBtn = el('button', {
        class: 'btn mic-btn',
        title: '语音输入',
        onclick: function () {
          if (listening) { if (handle && handle.stop) handle.stop(); return; }
          if (!global.Speech) return;
          if (global.Speech.mode() === 'none') {
            UI.toast(global.Speech.nativeSupported()
              ? '语音暂不可用'
              : '浏览器不支持语音识别，可在设置 → 语音识别里配置讯飞', 'err');
            return;
          }
          listening = true;
          micBtn.classList.add('cp-listening');
          liveEl.textContent = '正在听…（说完停顿一下）';

          // 兜底：8 秒无任何反馈就认为不可用
          clearMic();
          micTimer = setTimeout(function () {
            if (!listening) return;
            if (handle && handle.abort) handle.abort();
            stopMic();
            liveEl.textContent = '';
            UI.toast('语音没有响应，可能设备或网络不支持，请手动输入', 'err');
          }, 8000);

          handle = global.Speech.start({
            onResult: function (r) {
              clearMic();
              liveEl.textContent = r.text;
              if (r.final && r.text) { fillFromSpeech(r.text); stopMic(); }
            },
            onError: function (err) {
              stopMic();
              liveEl.textContent = '';
              UI.toast(err.message, 'err');
            },
            onEnd: function () { stopMic(); }
          });
        }
      }, [V.svg(V.icons.mic, 17)]);
      var fCourse = V.select(courseOpts, t ? t.courseId : (preset && preset.courseId) || '');
      var fDate = V.input({ type: 'date', value: t ? t.dueDate : (preset && preset.dueDate) || DateUtil.toStr(DateUtil.today()) });
      var fTime = V.input({ type: 'time', value: t ? t.dueTime : DateUtil.nowHM() });

      var fStatus = V.segment([
        { value: 'todo', label: '未开始' },
        { value: 'doing', label: '进行中' },
        { value: 'done', label: '已完成' }
      ], data.status, function (v) { data.status = v; });

      var fPriority = V.segment([
        { value: 'low', label: '低' },
        { value: 'normal', label: '普通' },
        { value: 'high', label: '重要' }
      ], data.priority, function (v) { data.priority = v; });

      var impOn = t ? !!t.important : false;
      var fImp = el('button', {
        class: 'chip', type: 'button',
        style: impOn ? { background: 'var(--primary)', color: '#fff' } : null,
        text: impOn ? '★ 已标记重要' : '标记为重要',
        onclick: function () {
          impOn = !impOn;
          this.style.background = impOn ? 'var(--primary)' : '';
          this.style.color = impOn ? '#fff' : '';
          this.textContent = impOn ? '★ 已标记重要' : '标记为重要';
        }
      });

      var fNote = V.textarea({ placeholder: '可选，补充说明', value: t ? t.note : '' });
      var fTags = V.tagInput(t ? (t.tags || []).join(',') : '');

      /* ---- 重复 ---- */
      var curRep = (t && t.repeat && t.repeat.type && t.repeat.type !== 'none')
        ? t.repeat : { type: 'none', interval: 1, until: '' };
      var repOpts = [
        { value: 'none', label: '不重复' },
        { value: 'daily', label: '每天' },
        { value: 'weekly', label: '每周' },
        { value: 'monthly', label: '每月' },
        { value: 'yearly', label: '每年' }
      ];
      var fRepeatType = V.select(repOpts, curRep.type);
      var fRepeatInterval = V.input({ type: 'number', min: '1', value: curRep.interval || 1, style: { width: '64px' } });
      var fRepeatUntil = V.input({ type: 'date', value: curRep.until || '' });

      var body = [
        /* ---- 子任务关系提示：只读，改关系靠「转为子任务 / 提升为顶层」---- */
        parent ? el('div', { class: 'subtask-parent-bar' }, [
          el('span', { class: 'subtask-parent-label', text: '所属父任务' }),
          el('b', { class: 'subtask-parent-name', text: parent.title }),
          el('button', {
            class: 'link-btn', text: '提升为顶层',
            onclick: function () {
              m.close();
              Store.updateTask(taskId, { parentId: '' });
              TaskRow.expanded[parent.id] = true;
              UI.toast('已提升为顶层待办');
            }
          })
        ]) : null,
        el('div', { class: 'field' }, [
          el('label', { text: parent ? '子任务内容' : '待办内容' }),
          el('div', { class: 'input-mic' }, [fTitle, micBtn]),
          liveEl
        ]),
        V.field('关联课程', fCourse, Store.courses.length ? '' : '还没有课程，可先到「课程表」添加'),
        el('div', { class: 'field-row' }, [
          V.field('截止日期', fDate),
          V.field('截止时间', fTime)
        ]),
        V.field('重复', el('div', { class: 'field-inline' }, [
          fRepeatType,
          el('span', { class: 'rep-iv', text: '每' }),
          fRepeatInterval,
          el('span', { class: 'rep-iv', text: '周期' })
        ]), '完成后自动生成下一期；留空「到」则一直重复'),
        V.field('重复到（可选）', fRepeatUntil, '到达该日期后不再生成新一期'),
        V.field('状态', fStatus),
        V.field('优先级', fPriority),
        V.field('重要日程', fImp, '标记后置顶，并在「今日」页显示倒计时'),
        V.field('标签', fTags, '支持二级标签：一级/二级，如「学习/高数」「生活/健身」'),
        V.field('备注', fNote),
        /* ---- 已投入（时间记录的另一头） ---- */
        (inv0 && inv0.minutes > 0) ? el('div', { class: 'field' }, [
          el('label', { text: '已投入' }),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('span', { class: 'chip chip-green', text: TimeUtil.humanMin(inv0.minutes) }),
            el('span', {
              style: { fontSize: '12.5px', color: 'var(--text-3)' },
              text: inv0.count + ' 条记录' + (inv0.pomodoros ? ' · ' + inv0.pomodoros + ' 个番茄' : '') +
                    (inv0.last ? ' · 最近 ' + inv0.last.slice(5) : '')
            })
          ]),
          el('div', { class: 'task-invest-list' }, inv0.recent.map(function (a) {
            return el('button', {
              class: 'task-invest-row',
              onclick: function () {
                m.close();
                var q = App.views.filter(function (x) { return x.id === 'quadrant'; })[0];
                if (q) q.date = a.date;
                App.go('quadrant');
              }
            }, [
              el('span', { class: 'task-invest-date', text: a.date.slice(5) }),
              el('span', { text: a.start + '–' + a.end }),
              el('span', { class: 'task-invest-name', text: a.name || '活动' })
            ]);
          })),
          el('div', {
            class: 'ocr-hint',
            text: '番茄钟关联这条待办时，那段时间会自动算进来；点上面任意一条会跳到象限页那一天。'
          })
        ]) : null,
        /* ---- 已有子任务时的说明 ---- */
        (isEdit && myKids.length) ? el('div', { class: 'field' }, [
          el('label', { text: '子任务（' + myKids.filter(function (c) { return c.status === 'done'; }).length + '/' + myKids.length + '）' }),
          el('div', { class: 'subtask-inline-list' }, myKids.map(function (c) {
            return el('div', { class: 'subtask-inline-row' + (c.status === 'done' ? ' done' : '') }, [
              TaskRow.check(c),
              el('span', { class: 'subtask-inline-title', text: c.title })
            ]);
          })),
          el('div', { class: 'ocr-hint', text: '子任务只能在父任务里添加，不支持多层嵌套。' })
        ]) : null
      ];

      var m = V.modal({
        title: isEdit ? '编辑待办' : '新建待办',
        body: body,
        autofocus: true,
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                /* 删父任务要说清子任务会怎样——这是最容易后悔的操作 */
                var o = Store.subtaskOpts();
                var tips = [];
                if (myKids.length) {
                  tips.push(o.orphanKeep
                    ? '它的 ' + myKids.length + ' 个子任务会保留，并提升为顶层待办。'
                    : '它的 ' + myKids.length + ' 个子任务也会一起删除。');
                  tips.push(o.orphanKeep
                    ? '（想连子任务一起删，可先到「设置 → 子任务」改这一项）'
                    : '（想保留子任务，可先到「设置 → 子任务」改这一项）');
                }
                V.confirm({
                  title: myKids.length ? '删除待办及其子任务' : '删除待办',
                  message: '确定删除「' + t.title + '」吗？' +
                    (tips.length ? '\n\n' + tips.join('\n') : ''),
                  danger: true, okText: '删除'
                }).then(function (ok) {
                  if (!ok) return;
                  var r = Store.removeTask(taskId);
                  UI.toast(r.kept ? ('已删除，' + r.kept + ' 个子任务已提升为顶层') : '已删除待办');
                });
              }, 220);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              var d = {
                title: fTitle.value,
                courseId: fCourse.value,
                dueDate: fDate.value,
                dueTime: fTime.value,
                status: data.status,
                priority: data.priority,
                important: impOn,
                note: fNote.value,
                tags: fTags.getValue(),
                repeat: (function () {
                  if (fRepeatType.value === 'none') return { type: 'none' };
                  return {
                    type: fRepeatType.value,
                    interval: Math.max(1, parseInt(fRepeatInterval.value, 10) || 1),
                    until: fRepeatUntil.value || ''
                  };
                })()
              };
              if (!d.title.trim()) { UI.toast('请填写待办内容', 'err'); fTitle.focus(); return; }
              if (isEdit) {
                Store.updateTask(taskId, d);
              } else {
                d.parentId = preset.parentId || '';
                var nt = Store.addTask(d);
                if (d.parentId) TaskRow.expanded[d.parentId] = true;   // 加了子任务就展开，让人看得见
                if (nt) TaskDialog.hintIfFirstSubtask();
              }
              m.close();
              UI.toast(isEdit ? '待办已更新' : (d.parentId ? '子任务已添加' : '待办已添加'));
            }
          })
        ])
      });
    },

    /**
     * 第一次创建子任务时弹一次说明，讲清「默认折叠 / 只一层 / 父任务不会自动完成」。
     * 只弹一次，之后可在「设置 → 子任务」里改行为。
     */
    hintIfFirstSubtask: function () {
      var st = Store.state.settings;
      if (st.subtaskHinted) return;
      Store.updateSettings({ subtaskHinted: true });
      var o = Store.subtaskOpts();
      setTimeout(function () {
        V.confirm({
          title: '子任务是这么工作的',
          message: [
            '· 子任务默认折叠，点父任务右边的箭头才展开',
            '· 只支持一层，子任务下面不能再挂子任务',
            '· 子任务全部完成时，父任务' + (o.autoDoneParent ? '会自动完成' : '不会自动完成，只显示进度') ,
            '· 父任务完成时，未完成的子任务' + (o.cascadeDone ? '会一并完成' : '保持原样'),
            '· 删除父任务时，子任务' + (o.orphanKeep ? '会保留并提升为顶层' : '会一起删除'),
            '',
            '这几条都能在「设置 → 子任务」里改。'
          ].join('\n'),
          okText: '知道了',
          cancelText: '去设置'
        }).then(function (ok) {
          if (!ok && global.SettingsView) global.SettingsView.go('subtask');
        });
      }, 320);
    }
  };

  /* ==========================================================
   * 列表视图
   * ========================================================== */
  /** 分页变化后把地址栏对齐（#/tasks/diary）；默认分页不写尾巴 */
  function syncRoute() {
    if (!global.Router || !global.App || App.currentId !== 'tasks') return;
    Router.set('tasks', state.tab === 'tasks' ? null : state.tab);
  }

  var state = { status: 'all', course: 'all', tag: '', q: '', tab: 'tasks' };
  /** 三个分页的可选值；深链接 / 搜索跳转都要按这个列表收口 */
  var TABS = ['tasks', 'notes', 'diary'];
  var searchTimer = null;

  var view = {
    id: 'tasks',
    name: '待办',
    icon: V.icons.check,
    title: '作业与待办',
    order: 20,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { TaskDialog.open(); }
      }, [V.svg(V.icons.plus, 16), '新建待办']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-tasks' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    onDataChange: function () {
      if (App.currentId === 'tasks') App.badge('tasks', Store.rootPending().length);
    },

    /** 当前分页：写进地址栏用（#/tasks/diary），复制出去的链接才对得上 */
    getTab: function () { return state.tab; },

    /** 默认分页：在这个分页上时地址就写 #/tasks，不拖 /tasks 的尾巴 */
    defaultTab: 'tasks',

    /* 搜索跳转 / 深链接用：把分页切到指定 tab。
       若视图还没挂载就先只改 state，等挂载时 render 自然生效——
       否则 setTab 找不到 root 会静默失败，跳过来还是停在「待办」。 */
    setTab: function (tab) {
      state.tab = TABS.indexOf(tab) >= 0 ? tab : 'tasks';
      if (this.root) this.render();
      syncRoute();
    },

    /**
     * 全局搜索跳转过来时定位到某条待办。
     * 难点在于列表有分页 / 状态 / 课程 / 关键词四层筛选，
     * 目标那条可能正好被筛掉，所以先把筛选放宽到能看见它，再定位。
     */
    focusRecord: function (type, id) {
      if (type !== 'task' || !global.Search) return false;
      var dirty = false;
      if (state.tab !== 'tasks') { state.tab = 'tasks'; dirty = true; }
      var t = Store.getTask(id);
      if (t && state.status !== 'all' && state.status !== t.status) { state.status = 'all'; dirty = true; }
      if (t && state.course !== 'all' && state.course !== (t.courseId || '')) { state.course = 'all'; dirty = true; }
      if (state.q) { state.q = ''; dirty = true; }
      // 命中的是子任务：先把父任务展开，否则它在折叠状态里根本看不见
      if (t && t.parentId) {
        TaskRow.expanded[t.parentId] = true;
        dirty = true;
      }
      if (dirty) this.render();
      return Search.flash(Search.findRec(type, id));
    },

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      /* ---- 待办 / 灵感 / 日记 分页 ---- */
      var nt = Store.notes.length;
      var nd = Store.state.diaries.length;
      var paneBar = el('div', { class: 'pane-tabs' });
      [
        { v: 'tasks', l: '待办' },
        { v: 'notes', l: nt ? '灵感 ' + nt : '灵感' },
        { v: 'diary', l: nd ? '日记 ' + nd : '日记' }
      ].forEach(function (x) {
        paneBar.appendChild(el('button', {
          class: 'pane-tab' + (state.tab === x.v ? ' active' : ''),
          text: x.l,
          onclick: function () {
            state.tab = x.v;
            view.render();
            syncRoute();
          }
        }));
      });
      root.appendChild(paneBar);

      if (state.tab === 'notes') {
        var noteHost = el('div', {});
        root.appendChild(noteHost);
        if (global.NotesPane) NotesPane.render(noteHost);
        return;
      }

      if (state.tab === 'diary') {
        var diaryHost = el('div', {});
        root.appendChild(diaryHost);
        if (global.DiaryPane) DiaryPane.render(diaryHost);
        return;
      }

      /* 列表只展示顶层任务，子任务在父任务里展开看，避免同一件事出现两次 */
      var all = Store.rootTasks();
      var pending = all.filter(function (t) { return t.status !== 'done'; });
      var pendingAll = Store.tasks.filter(function (t) { return t.status !== 'done'; }).length;

      /* ---- 概览 ---- */
      var summary = el('div', { class: 'task-summary' }, [
        V.statCard(pending.length, '待完成', 'var(--primary)'),
        V.statCard(Store.overdueTasks().length, '已逾期', 'var(--red)'),
        V.statCard(Store.todayTasks().length, '今天截止', 'var(--amber)'),
        V.statCard(all.length - pending.length, '已完成', 'var(--green)')
      ]);
      root.appendChild(summary);

      /* ---- 筛选 ---- */
      var tabs = [
        { v: 'all', l: '全部 ' + all.length },
        { v: 'todo', l: '未开始' },
        { v: 'doing', l: '进行中' },
        { v: 'done', l: '已完成' }
      ];
      var tabBar = el('div', { class: 'filter-bar' });
      tabs.forEach(function (x) {
        tabBar.appendChild(el('button', {
          class: 'filter-tab' + (state.status === x.v ? ' active' : ''),
          text: x.l,
          onclick: function () { state.status = x.v; view.render(); }
        }));
      });

      if (Store.courses.length) {
        var sel = V.select(
          [{ value: 'all', label: '全部课程' }].concat(Store.courses.map(function (c) {
            return { value: c.id, label: c.name };
          })), state.course, { style: 'height:32px;width:auto;min-width:118px;font-size:12.5px' }
        );
        sel.addEventListener('change', function () { state.course = sel.value; view.render(); });
        tabBar.appendChild(el('div', { style: { marginLeft: 'auto' } }, [sel]));
      }
      root.appendChild(tabBar);

      /* ---- 搜索 ---- */
      var searchInput = V.input({
        placeholder: '搜索标题、备注或标签…',
        value: state.q
      });
      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          state.q = searchInput.value;
          view.render();
        }, 260);
      });

      var searchBox = el('div', { class: 'task-search' }, [
        V.svg(V.icons.search, 17),
        searchInput,
        state.q ? el('button', {
          class: 'icon-btn', title: '清空',
          onclick: function () { state.q = ''; view.render(); }
        }, [V.svg(V.icons.close, 16)]) : null
      ]);
      root.appendChild(searchBox);

      /* ---- 标签筛选（支持一级 / 二级） ---- */
      var tagBar = V.tagFilter(state.tag, function (v) {
        state.tag = v;
        view.render();
      }, ['task']);
      if (tagBar) root.appendChild(tagBar);

      /* ---- 过滤 ---- */
      var kw = (state.q || '').trim().toLowerCase();
      var list = all.filter(function (t) {
        if (state.status !== 'all' && t.status !== state.status) {
          // 父任务未完成、但子任务命中了筛选条件时也留下，否则「未开始」会把父任务筛没
          if (!(state.status === 'todo' && Store.subtasksOf(t.id).some(function (c) { return c.status === 'todo'; }))) return false;
        }
        if (state.course !== 'all' && t.courseId !== state.course) return false;
        if (state.tag && !hasTag(t.tags, state.tag)) return false;
        if (kw) {
          // 父任务自己没命中时，再看它的子任务里有没有命中的
          function hit(x) {
            return [x.title, x.note, (x.tags || []).join(' ')].join(' ').toLowerCase().indexOf(kw) >= 0;
          }
          if (!hit(t) && !Store.subtasksOf(t.id).some(hit)) return false;
        }
        return true;
      }).sort(function (a, b) {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (b.status === 'done' && a.status !== 'done') return -1;
        return 0;
      });

      if (!list.length) {
        root.appendChild(el('div', { class: 'card', style: { marginTop: '4px' } }, [
          V.empty(V.icons.check, kw || state.tag || state.status !== 'all' ? '没有匹配的待办' : '这里还没有待办',
            kw || state.tag ? '换个关键词或标签试试。' :
            '新建一条待办，可以关联到某门课程，并设置截止日期，到期会在「今日」中提醒你。',
            el('button', { class: 'btn btn-primary', onclick: function () { TaskDialog.open(); } },
              [V.svg(V.icons.plus, 16), '新建待办']))
        ]));
        return;
      }

      /* ---- 分组 ---- */
      var groups = buildGroups(list);
      groups.forEach(function (g) {
        if (!g.items.length) return;
        var head = el('div', { class: 'group-head' }, [
          el('span', { text: g.title }),
          el('span', { class: 'group-count', text: String(g.items.length) })
        ]);
        var box = el('div', { class: 'card', style: { padding: '6px 8px', marginBottom: '14px' } });
        g.items.forEach(function (t) {
          // onToggle：展开/收起后不整页重绘，只重建这一组，保住滚动位置
          box.appendChild(TaskRow.build(t, { onToggle: function () { view.render(); } }));
        });
        root.appendChild(head);
        root.appendChild(box);
      });

      if (state.q) {
        var si = V.$('.cp-task-search input', root);
        if (si) setTimeout(function () {
          si.focus();
          try { si.setSelectionRange(si.value.length, si.value.length); } catch (e) {}
        }, 0);
      }
    }
  };


  function buildGroups(list) {
    var overdue = [], today = [], week = [], later = [], nodate = [], done = [];
    list.forEach(function (t) {
      if (t.status === 'done') { done.push(t); return; }
      if (!t.dueDate) { nodate.push(t); return; }
      var left = DateUtil.daysLeft(t.dueDate);
      if (left < 0) overdue.push(t);
      else if (left === 0) today.push(t);
      else if (left <= 7) week.push(t);
      else later.push(t);
    });
    [overdue, today, week, later, nodate, done].forEach(function (arr) {
      arr.sort(function (a, b) {
        if (!!a.important !== !!b.important) return a.important ? -1 : 1;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      });
    });
    return [
      { title: '已逾期', items: overdue },
      { title: '今天截止', items: today },
      { title: '未来 7 天', items: week },
      { title: '更晚', items: later },
      { title: '未设截止日期', items: nodate },
      { title: '已完成', items: done }
    ];
  }

  global.TaskRow = TaskRow;
  global.TaskDialog = TaskDialog;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


