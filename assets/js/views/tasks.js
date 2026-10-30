

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
            if (Store.isExpenseTask && Store.isExpenseTask(now) && (!Store.ledgerByRef || !Store.ledgerByRef(now.id)) && UI.toastAction) {
              UI.toastAction('完成待办，+' + POMO.TASK_DONE + ' 分 · 检测到消费待办，顺手记一笔账？', {
                actionText: '💰 记一笔',
                duration: 6500,
                onAction: function () { TaskDialog.openQuickLedger(now); }
              });
            } else {
              UI.toast('完成待办，+' + POMO.TASK_DONE + ' 分');
            }
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
      var hl = (t.dueTime && DateUtil.hoursLeft) ? DateUtil.hoursLeft(t.dueDate, t.dueTime) : null;
      var label = DateUtil.human(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '');
      var cls = 'chip';
      if (t.status === 'done') {
        cls = 'chip';
      } else if (left < 0) {
        cls = 'chip chip-red';
        label = '逾期 ' + Math.abs(left) + ' 天' + (t.dueTime ? ' ' + t.dueTime : '');
      } else if (left === 0) {
        if (hl && hl.hasTime) {
          if (hl.overdue) {
            cls = 'chip chip-red';
            label = '今天 ' + hl.timeStr + ' · ' + hl.shortText;
          } else {
            cls = 'chip chip-amber';
            label = '今天 ' + hl.timeStr + (hl.shortText ? ' · ' + hl.shortText : '');
          }
        } else {
          cls = 'chip chip-amber';
          label = '今天' + (t.dueTime ? ' ' + t.dueTime : '');
        }
      } else if (left <= 2) {
        cls = 'chip chip-blue';
        if (left === 1 && hl && hl.hasTime && hl.shortText) {
          label = label + ' · ' + hl.shortText;
        }
      }
      return el('span', {
        class: cls,
        title: t.dueDate + (t.dueTime ? ' ' + t.dueTime : '（全天）'),
        text: label
      });
    },

    /** 重复标记：↻ 每周五 · 10.30，完整规则放在 title 里 */
    repChip: function (t) {
      if (!t.repeat || t.repeat.type === 'none') return null;
      var d = DateUtil.parse(t.dueDate);
      return el('span', {
        class: 'chip',
        style: { padding: '0 6px', fontSize: '10.5px' },
        title: Store.repeatSummary(t.repeat, t.dueDate),
        text: '↻ ' + Store.repeatShort(t.repeat, t.dueDate) + (d ? ' · ' + DateUtil.mdShort(d) : '')
      });
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
      if (opts.compact && t.dueDate) meta.push(document.createTextNode(DateUtil.human(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '')));

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
          (meta.length || t.note || (t.tags && t.tags.length) || (t.repeat && t.repeat.type !== 'none')) ? el('div', { class: 'task-meta' }, [
            meta.length ? el('span', { class: 'task-course' }, meta) : null,
            t.priority === 'high' ? el('span', { class: 'chip chip-red', text: '重要', style: { padding: '0 6px', fontSize: '10.5px' } }) : null,
            TaskRow.repChip(t),
            t.energy === 'high' ? el('span', { class: 'chip chip-amber', text: '⚡深度', style: { padding: '0 6px', fontSize: '10.5px' }, title: '高精力消耗（建议黄金时段处理）' }) : null,
            t.energy === 'low' ? el('span', { class: 'chip', text: '☕轻松', style: { padding: '0 6px', fontSize: '10.5px' }, title: '低精力消耗（适合午后或疲惫时处理）' }) : null,
            t.examStage ? el('span', {
              class: 'chip chip-blue',
              style: { padding: '0 6px', fontSize: '10.5px' },
              text: t.examStage === 'round1' ? '📖一轮' : (t.examStage === 'papers' ? '✍️真题' : '🔥冲刺')
            }) : null,
            (t.goalId && Store.getGoal(t.goalId)) ? el('span', {
              class: 'chip',
              style: { padding: '0 6px', fontSize: '10.5px', background: 'rgba(16,185,129,0.13)', color: 'var(--green)', fontWeight: '600' },
              title: '关联目标：' + Store.getGoal(t.goalId).title,
              text: '🎯 ' + Store.getGoal(t.goalId).title.slice(0, 8)
            }) : null,
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
        priority: t ? t.priority : 'normal',
        energy: t ? (t.energy || 'medium') : (preset.energy || 'medium'),
        examStage: t ? (t.examStage || '') : (preset.examStage || ''),
        goalId: t ? (t.goalId || '') : (preset.goalId || ''),
        krId: t ? (t.krId || '') : (preset.krId || ''),
        estHours: t ? (Number(t.estHours) || 0) : (Number(preset.estHours) || 0)
      };

      /* ---- 子任务关系 ---- */
      var parent = t ? (t.parentId ? Store.getTask(t.parentId) : null)
                     : (preset.parentId ? Store.getTask(preset.parentId) : null);
      // 已有子任务的父任务不能再挂到别人下面（只允许一层）
      var myKids = isEdit ? Store.subtasksOf(taskId) : [];
      // 反查：这条待办上挂了哪些时间记录（番茄钟结束会自动写一条）
      var inv0 = isEdit ? Store.taskInvest(taskId) : null;
      // 今天为这条待办划了多少计划块（Time-Blocking 的「计划」一头）
      var planMin0 = isEdit ? Store.taskPlannedOn(taskId, DateUtil.toStr(DateUtil.today())) : 0;
      var actualToday0 = isEdit ? (function () {
        var min = 0;
        (Store.activitiesOfTask(taskId) || []).forEach(function (a) {
          if (a.date === DateUtil.toStr(DateUtil.today()) && !a.planned) min += TimeUtil.diffMin(a.start, a.end);
        });
        return min;
      })() : 0;

      var courseOpts = [{ value: '', label: '不关联课程' }].concat(
        Store.courses.map(function (c) { return { value: c.id, label: c.name }; })
      );

      var fTitle = V.input({
        placeholder: '例如：明天下午3点交高数作业 #作业 !重要',
        value: t ? t.title : '',
        dataset: { autofocus: '1' }
      });

      /* ---- 自然语言实时解析与一键填充 ---- */
      var nlpPreview = el('div', { class: 'nlp-preview', style: { display: 'none' } });
      function refreshNLP() {
        if (!global.TaskNLP || isEdit) return;
        var val = fTitle.value.trim();
        var p = TaskNLP.parse(val, { courses: Store.courses });
        if (p && (p.hasDate || p.hasTime || p.hasRepeat || p.courseId || (p.tags && p.tags.length) || p.important)) {
          nlpPreview.innerHTML = '';
          nlpPreview.style.display = 'flex';
          var chips = [];
          if (p.hasDate) chips.push('📅 ' + p.dueDate);
          if (p.hasTime) chips.push('⏰ ' + p.dueTime);
          if (p.hasRepeat && p.repeat && Store.repeatShort) chips.push('🔁 ' + Store.repeatShort(p.repeat, p.dueDate));
          if (p.courseName) chips.push('📚 ' + p.courseName);
          if (p.tags && p.tags.length) chips.push('🏷️ ' + p.tags.join(' '));
          if (p.important) chips.push('★ 重要');
          chips.forEach(function (txt) {
            nlpPreview.appendChild(el('span', { class: 'chip chip-primary', style: { padding: '2px 7px', fontSize: '11px' }, text: txt }));
          });
          var btn = el('button', {
            class: 'btn btn-sm',
            type: 'button',
            style: { marginLeft: 'auto', padding: '2px 8px', fontSize: '11px' },
            text: '一键填入',
            onclick: function (e) {
              e.preventDefault();
              fTitle.value = p.title;
              if (p.hasDate) fDate.value = p.dueDate;
              if (p.hasTime) setExactTime(p.dueTime);
              if (p.hasRepeat && p.repeat && p.repeat.type && p.repeat.type !== 'none') {
                fRepeatType.value = p.repeat.type;
                fRepeatInterval.value = p.repeat.interval || 1;
                if (p.repeat.type === 'weekly' && p.repeat.weekdays && p.repeat.weekdays.length) {
                  wdItems.forEach(function (b) {
                    b.classList.toggle('cp-on', p.repeat.weekdays.indexOf(b._wd) !== -1);
                  });
                }
                if (p.repeat.type === 'monthly' && p.repeat.monthRule) {
                  fMonthRule.value = p.repeat.monthRule;
                }
                refreshRepeat();
              }
              if (p.courseId) fCourse.value = p.courseId;
              if (p.tags && p.tags.length) fTags.setValue(p.tags);
              if (p.important) {
                impOn = true;
                fImp.style.background = 'var(--primary)';
                fImp.style.color = '#fff';
                fImp.textContent = '★ 已标记重要';
              }
              nlpPreview.style.display = 'none';
              UI.toast('已识别并填入表单');
            }
          });
          nlpPreview.appendChild(btn);
        } else {
          nlpPreview.style.display = 'none';
        }
      }
      fTitle.addEventListener('input', refreshNLP);

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
        if (parsed.dueTime) setExactTime(parsed.dueTime);
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
      var initDueTime = t ? (t.dueTime || '') : ((preset && preset.dueTime != null) ? preset.dueTime : DateUtil.nowHM());
      var fTime = V.input({
        type: 'time',
        step: '60',
        value: initDueTime,
        style: { flex: '1', minWidth: '96px' }
      });

      /* 小时与分钟独立直选器（兼容部分端原生 time 控件不易选小时的问题，并支持一键精确到整点） */
      var hourOpts = [{ value: '', label: '时' }];
      for (var hhIdx = 0; hhIdx < 24; hhIdx++) {
        var hPad = (hhIdx < 10 ? '0' : '') + hhIdx;
        hourOpts.push({ value: hPad, label: hPad + '时' });
      }
      var minOpts = [
        { value: '00', label: '00分' },
        { value: '15', label: '15分' },
        { value: '30', label: '30分' },
        { value: '45', label: '45分' },
        { value: '59', label: '59分' }
      ];
      var initHM = (initDueTime && /^\d{1,2}:\d{2}$/.test(initDueTime)) ? initDueTime.split(':') : ['', '00'];
      var initH = initHM[0] ? ((initHM[0].length === 1 ? '0' : '') + initHM[0]) : '';
      var initM = initHM[1] || '00';
      if (!minOpts.some(function (o) { return o.value === initM; })) {
        minOpts.push({ value: initM, label: initM + '分' });
        minOpts.sort(function (a, b) { return a.value < b.value ? -1 : 1; });
      }
      var fHourSel = V.select(hourOpts, initH, {
        title: '精确选择截止小时（00–23时）',
        style: 'width:68px;height:34px;padding:0 4px;font-size:12px;flex:0 0 auto'
      });
      var fMinSel = V.select(minOpts, initM, {
        title: '选择截止分钟',
        style: 'width:68px;height:34px;padding:0 4px;font-size:12px;flex:0 0 auto'
      });

      var quickHoursBar = el('div', {
        class: 'task-hour-pills',
        style: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }
      });

      function syncTimeFromInput() {
        var val = String(fTime.value || '').trim();
        if (/^\d{1,2}:\d{2}/.test(val)) {
          var p = val.split(':');
          var hh = (p[0].length === 1 ? '0' : '') + p[0];
          var mm = p[1].slice(0, 2);
          fHourSel.value = hh;
          if (!Array.prototype.some.call(fMinSel.options, function (o) { return o.value === mm; })) {
            fMinSel.appendChild(el('option', { value: mm, text: mm + '分' }));
          }
          fMinSel.value = mm;
        } else {
          fHourSel.value = '';
        }
        Array.prototype.forEach.call(quickHoursBar.querySelectorAll('button[data-hm]'), function (b) {
          b.classList.toggle('cp-btn-primary', b.dataset.hm === val);
        });
      }

      function setExactTime(hm, dateOverride) {
        if (dateOverride) fDate.value = dateOverride;
        fTime.value = hm || '';
        syncTimeFromInput();
      }

      fTime.addEventListener('input', syncTimeFromInput);
      fTime.addEventListener('change', syncTimeFromInput);
      fHourSel.addEventListener('change', function () {
        if (!fHourSel.value) {
          setExactTime('');
        } else {
          var mm = fMinSel.value || '00';
          setExactTime(fHourSel.value + ':' + mm);
        }
      });
      fMinSel.addEventListener('change', function () {
        var hh = fHourSel.value || (fTime.value ? fTime.value.split(':')[0] : DateUtil.nowHM().split(':')[0]);
        if (hh.length === 1) hh = '0' + hh;
        fHourSel.value = hh;
        setExactTime(hh + ':' + (fMinSel.value || '00'));
      });

      // 相对小时快捷按钮 (+1h / +2h / +4h) + 常用整点胶囊
      [
        { label: '+1h', addMin: 60, title: '当前时间往后推 1 小时' },
        { label: '+2h', addMin: 120, title: '当前时间往后推 2 小时' },
        { label: '+4h', addMin: 240, title: '当前时间往后推 4 小时' }
      ].forEach(function (rel) {
        quickHoursBar.appendChild(el('button', {
          type: 'button',
          class: 'btn btn-sm',
          title: rel.title,
          style: { height: '24px', padding: '0 7px', fontSize: '11px', color: 'var(--primary)' },
          onclick: function () {
            var target = new Date(Date.now() + rel.addMin * 60000);
            var ds = DateUtil.toStr(target);
            var hm = DateUtil.pad(target.getHours()) + ':' + DateUtil.pad(target.getMinutes());
            setExactTime(hm, ds);
            UI.toast('已设为 ' + (ds === DateUtil.toStr(DateUtil.today()) ? '今天 ' : ds.slice(5) + ' ') + hm);
          }
        }, [rel.label]));
      });

      ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '23:59'].forEach(function (hm) {
        var b = el('button', {
          type: 'button',
          class: 'btn btn-sm' + (initDueTime === hm ? ' btn-primary' : ''),
          dataset: { hm: hm },
          style: { height: '24px', padding: '0 7px', fontSize: '11px' },
          onclick: function () {
            setExactTime(hm);
          }
        }, [hm === '23:59' ? '23:59末' : (parseInt(hm.slice(0, 2), 10) + '点')]);
        quickHoursBar.appendChild(b);
      });

      var clearTimeBtn = el('button', {
        type: 'button',
        class: 'btn btn-sm',
        title: '一键清除时间（转为全天待办，不设具体时刻）',
        style: { height: '34px', padding: '0 8px', fontSize: '11.5px', flex: '0 0 auto' },
        onclick: function () {
          setExactTime('');
          UI.toast('已清除截止时间（全天待办）');
        }
      }, ['✕ 全天']);
      var nowTimeBtn = el('button', {
        type: 'button',
        class: 'btn btn-sm',
        title: '设为当前时间',
        style: { height: '34px', padding: '0 8px', fontSize: '11.5px', flex: '0 0 auto' },
        onclick: function () {
          setExactTime(DateUtil.nowHM());
        }
      }, ['现在']);
      var timeWrap = el('div', { style: { display: 'flex', flexDirection: 'column', width: '100%' } }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' } }, [fHourSel, fMinSel, fTime, nowTimeBtn, clearTimeBtn]),
        quickHoursBar
      ]);

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

      var fEnergy = V.segment([
        { value: 'high', label: '⚡ 深度专注' },
        { value: 'medium', label: '🌤️ 常规' },
        { value: 'low', label: '☕ 轻松杂务' }
      ], data.energy, function (v) { data.energy = v; });

      var fExamStage = V.segment([
        { value: '', label: '普通待办' },
        { value: 'round1', label: '📖 一轮复习' },
        { value: 'papers', label: '✍️ 历年真题' },
        { value: 'sprint', label: '🔥 考前冲刺' }
      ], data.examStage, function (v) { data.examStage = v; });

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

      // 钉到桌面小组件：同一时间只有一个（存 settings.widgetTodoId）
      var pinnedId = (Store.settings && Store.settings.widgetTodoId) || '';
      var pinOn = !!(taskId && pinnedId === taskId);
      var fPin = el('button', {
        class: 'chip', type: 'button',
        title: '桌面小组件默认显示「最近一条待办」，钉住后固定显示这一条',
        style: pinOn ? { background: 'var(--primary)', color: '#fff' } : null,
        text: pinOn ? '📌 已钉到小组件' : '📌 钉到小组件',
        onclick: function () {
          if (!taskId) { UI.toast('先保存一次，再钉到小组件'); return; }
          pinOn = !pinOn;
          Store.updateSettings({ widgetTodoId: pinOn ? taskId : '' });
          this.style.background = pinOn ? 'var(--primary)' : '';
          this.style.color = pinOn ? '#fff' : '';
          this.textContent = pinOn ? '📌 已钉到小组件' : '📌 钉到小组件';
          UI.toast(pinOn ? '已钉到桌面小组件' : '已取消钉选');
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

      /* 星期选择器（周重复·多选）：label 一..日 -> getDay 1..6,0 */
      var WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
      function wdOfLabel(i) { return i === 6 ? 0 : i + 1; }
      var curWDs = (curRep.type === 'weekly' && curRep.weekdays && curRep.weekdays.length)
        ? curRep.weekdays.slice()
        : (curRep.type === 'weekly' && fDate.value ? [DateUtil.parse(fDate.value).getDay()] : [1]);
      var wdItems = WEEK_LABELS.map(function (lab, i) {
        var w = wdOfLabel(i);
        var b = el('button', {
          type: 'button',
          class: 'item' + (curWDs.indexOf(w) !== -1 ? ' on' : ''),
          text: '周' + lab
        });
        b._wd = w;
        b.addEventListener('click', function () { b.classList.toggle('cp-on'); refreshRepeat(); });
        return b;
      });
      var fWeekdays = el('div', { class: 'chip-pick days', style: { marginTop: '6px' } }, wdItems);

      /* 月规则子选择器（月重复） */
      var curMonthRule = (curRep.type === 'monthly' && curRep.monthRule) ? curRep.monthRule : 'date';
      var fMonthRule = V.select([
        { value: 'date', label: '按几号' },
        { value: 'pos', label: '按第几个星期几' },
        { value: 'lastday', label: '月末最后一天' }
      ], curMonthRule);
      var curPos = (curRep.type === 'monthly' && curRep.monthRule === 'pos')
        ? (curRep.pos === -1 ? -1 : (curRep.pos || 1)) : 1;
      var fPos = V.select([
        { value: '1', label: '第 1 个' }, { value: '2', label: '第 2 个' },
        { value: '3', label: '第 3 个' }, { value: '4', label: '第 4 个' },
        { value: '-1', label: '最后一个' }
      ], String(curPos));
      var curMWd = (curRep.type === 'monthly' && curRep.monthRule === 'pos' && curRep.wd != null) ? curRep.wd : 3;
      var mwdItems = WEEK_LABELS.map(function (lab, i) {
        var w = wdOfLabel(i);
        var b = el('button', {
          type: 'button',
          class: 'item' + (w === curMWd ? ' on' : ''),
          text: '周' + lab
        });
        b._wd = w;
        b.addEventListener('click', function () {
          mwdItems.forEach(function (x) { x.classList.remove('cp-on'); });
          b.classList.add('cp-on'); refreshRepeat();
        });
        return b;
      });
      var fMonthWd = el('div', { class: 'chip-pick days', style: { marginTop: '6px' } }, mwdItems);

      /* ---- 日期标签、单位与实时摘要：把「日期 = 第一期」讲清楚 ---- */
      var REP_UNITS = { daily: '天', weekly: '周', monthly: '个月', yearly: '年' };
      var dateLabel = el('label', { text: '截止日期' });
      var dateField = el('div', { class: 'field' }, [dateLabel, fDate]);

      var unitEl = el('span', { class: 'rep-iv', text: '周' });
      var everyWrap = el('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px' }
      }, [
        el('span', { class: 'rep-iv', text: '间隔' }),
        fRepeatInterval,
        unitEl
      ]);
      var repeatLine = el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
      }, [fRepeatType, everyWrap]);

      var repeatSummaryEl = el('div', {
        style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '8px', lineHeight: '1.7' }
      });
      var repeatNoteEl = el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' },
        text: '完成后自动生成下一期；把「最后一次」留空就一直重复。'
      });
      var weeklyOpts = el('div', { style: { marginTop: '6px', display: 'none' } }, [
        el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '4px' }, text: '重复在星期几（可多选）' }),
        fWeekdays
      ]);
      var posRow = el('div', { class: 'field-row', style: { marginTop: '6px', display: 'none' } }, [
        V.field('第几个', fPos), V.field('星期', fMonthWd)
      ]);
      var monthlyOpts = el('div', { style: { marginTop: '6px', display: 'none' } }, [
        V.field('按月规则', fMonthRule), posRow
      ]);
      var repeatField = el('div', { class: 'field' }, [
        el('label', { text: '重复' }), repeatLine, repeatSummaryEl, repeatNoteEl, weeklyOpts, monthlyOpts
      ]);
      var untilField = el('div', { class: 'field' }, [
        el('label', { text: '最后一次（可选）' }),
        fRepeatUntil,
        el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '5px' },
          text: '到达该日期后不再生成新一期；留空表示一直重复。'
        })
      ]);

      /* 从控件读出一个干净的 repeat 对象（不含 dueDate） */
      function gatherRepeat() {
        var type = fRepeatType.value;
        if (type === 'none') return { type: 'none' };
        var rep = {
          type: type,
          interval: Math.max(1, parseInt(fRepeatInterval.value, 10) || 1),
          until: fRepeatUntil.value || ''
        };
        if (type === 'weekly') {
          var wds = wdItems.filter(function (b) { return b.classList.contains('cp-on'); })
                           .map(function (b) { return b._wd; }).sort(function (a, b) { return a - b; });
          if (wds.length) rep.weekdays = wds;
        }
        if (type === 'monthly') {
          rep.monthRule = fMonthRule.value;
          if (fMonthRule.value === 'pos') {
            rep.pos = (fPos.value === '-1') ? -1 : (parseInt(fPos.value, 10) || 1);
            var mw = mwdItems.filter(function (b) { return b.classList.contains('cp-on'); })[0];
            rep.wd = mw ? mw._wd : 3;
          }
        }
        return rep;
      }

      function refreshRepeat() {
        var on = fRepeatType.value !== 'none';
        // 不重复时它就是普通截止日；重复时它是这一期（新建则是第一期）的日期
        dateLabel.textContent = on ? (isEdit ? '这一期的日期' : '第一次的日期') : '截止日期';
        everyWrap.style.display = on ? 'inline-flex' : 'none';
        untilField.style.display = on ? '' : 'none';
        repeatSummaryEl.style.display = on ? '' : 'none';
        repeatNoteEl.style.display = on ? '' : 'none';
        weeklyOpts.style.display = (on && fRepeatType.value === 'weekly') ? '' : 'none';
        monthlyOpts.style.display = (on && fRepeatType.value === 'monthly') ? '' : 'none';
        if (!on) return;

        unitEl.textContent = REP_UNITS[fRepeatType.value] || '周期';
        var rep = Store.sanitizeRepeat(gatherRepeat());
        var first = Store.firstOccurrence(fDate.value, rep);
        repeatSummaryEl.textContent = Store.repeatSummary(rep, first);
        // 没有日期时说明里已经带了警告，这里再用琥珀色提醒一次
        repeatSummaryEl.style.color = first ? 'var(--text-2)' : 'var(--amber)';
        posRow.style.display = (fMonthRule.value === 'pos') ? '' : 'none';
      }

      fRepeatType.addEventListener('change', function () {
        if (fRepeatType.value !== 'none' && !fDate.value) {
          fDate.value = DateUtil.toStr(DateUtil.today());
          UI.toast('已把第一期设为今天');
        }
        if (fRepeatType.value === 'weekly') {
          var w = fDate.value ? DateUtil.parse(fDate.value).getDay() : 1;
          wdItems.forEach(function (b) { b.classList.toggle('cp-on', b._wd === w); });
        }
        if (fRepeatType.value === 'monthly') fMonthRule.value = 'date';
        refreshRepeat();
      });
      var dateManuallyChanged = false;
      fRepeatInterval.addEventListener('input', refreshRepeat);
      fRepeatUntil.addEventListener('change', refreshRepeat);
      fDate.addEventListener('change', function () {
        dateManuallyChanged = true;
        // 当用户处于「每周」重复且只选了单个星期时，改截止日期自动同步星期几按钮，避免保存时被旧星期覆盖跳走
        if (fRepeatType.value === 'weekly' && fDate.value) {
          var parsedD = DateUtil.parse(fDate.value);
          if (parsedD) {
            var activeWds = wdItems.filter(function (b) { return b.classList.contains('cp-on'); });
            if (activeWds.length <= 1) {
              var newW = parsedD.getDay();
              wdItems.forEach(function (b) { b.classList.toggle('cp-on', b._wd === newW); });
            }
          }
        }
        refreshRepeat();
      });
      fMonthRule.addEventListener('change', refreshRepeat);
      fPos.addEventListener('change', refreshRepeat);
      refreshRepeat();

      /* ---- 关联目标 / 关键结果（Vis OKR 第 4 级微行动绑定） ---- */
      var activeGoals = Store.goalsActive ? Store.goalsActive() : [];
      var goalOpts = [{ value: '', label: '不关联目标' }];
      activeGoals.forEach(function (g) {
        goalOpts.push({ value: g.id + '|', label: '🎯 ' + g.title });
        (g.krs || []).forEach(function (k) {
          goalOpts.push({ value: g.id + '|' + k.id, label: '  └ KR：' + k.title });
        });
      });
      var curGoalCombo = data.goalId ? (data.goalId + '|' + (data.krId || '')) : '';
      if (curGoalCombo && !goalOpts.some(function (o) { return o.value === curGoalCombo; })) {
        curGoalCombo = data.goalId + '|';
      }
      var fGoalCombo = V.select(goalOpts, curGoalCombo);
      fGoalCombo.addEventListener('change', function () {
        var parts = (fGoalCombo.value || '').split('|');
        data.goalId = parts[0] || '';
        data.krId = parts[1] || '';
      });

      /* ---- ⚡ 一键智能分配时间面板 (Auto Time-Blocking + 睡眠精力推算) ---- */
      var pendingAutoSlots = [];
      var autoMode = 'split'; // 'split' 不连续拆分 | 'contiguous' 连续整块
      var autoHours = data.estHours > 0 ? data.estHours : 2;
      var autoVariant = 0;
      var autoSyncEvents = true;

      var fAutoHours = V.input({
        type: 'number', min: '0.5', max: '40', step: '0.5',
        value: String(autoHours),
        style: { width: '76px', height: '30px', fontSize: '12.5px' },
        oninput: function () { autoHours = Math.max(0.5, parseFloat(this.value) || 1); }
      });

      var hourPills = el('div', { style: { display: 'inline-flex', gap: '4px', flexWrap: 'wrap' } }, [1, 2, 3, 5, 8].map(function (h) {
        return el('button', {
          type: 'button',
          class: 'btn btn-sm',
          style: { height: '28px', padding: '0 8px', fontSize: '11.5px' },
          text: h + 'h',
          onclick: function () {
            autoHours = h;
            fAutoHours.value = String(h);
            runAutoPreview(false);
          }
        });
      }));

      var autoModeSeg = V.segment([
        { value: 'split', label: '🔀 不连续拆分' },
        { value: 'contiguous', label: '🧱 连续整块' }
      ], autoMode, function (v) {
        autoMode = v;
        autoVariant = 0;
        if (pendingAutoSlots.length) runAutoPreview(false);
      });

      var autoPreviewBox = el('div', { style: { marginTop: '8px', display: 'none' } });

      function runAutoPreview(bumpVariant) {
        if (!Store.autoAllocateTaskTime) return;
        if (bumpVariant) autoVariant++;
        var res = Store.autoAllocateTaskTime({
          id: taskId || '',
          title: (fTitle.value || '').trim() || '待办事项',
          dueDate: fDate.value || DateUtil.toStr(DateUtil.today()),
          dueTime: fTime.value || '',
          energy: data.energy || 'high',
          priority: data.priority || 'normal',
          courseId: fCourse.value || '',
          estHours: autoHours
        }, {
          totalMinutes: Math.round(autoHours * 60),
          mode: autoMode,
          variant: autoVariant
        });

        pendingAutoSlots = (res && res.slots) ? res.slots.slice() : [];
        drawAutoPreview(res);
      }

      function drawAutoPreview(res) {
        autoPreviewBox.innerHTML = '';
        autoPreviewBox.style.display = 'block';
        if (!res || !pendingAutoSlots.length) {
          autoPreviewBox.appendChild(el('div', {
            style: { padding: '8px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', color: 'var(--red)', fontSize: '12px' },
            text: '截止日期前未找到足够的空闲时段，建议调晚截止日期或改用「不连续拆分」模式。'
          }));
          return;
        }

        autoPreviewBox.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-2)', marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }
        }, [
          el('span', { text: res.energySummary || '已按精力波峰与空档匹配' }),
          el('span', {
            style: { fontWeight: '700', color: 'var(--primary)' },
            text: '共排入 ' + TimeUtil.humanMin(pendingAutoSlots.reduce(function (s, x) { return s + x.duration; }, 0)) + '（保存待办时自动生效）'
          })
        ]));

        if (res.fallbackUsed && res.fallbackReason) {
          autoPreviewBox.appendChild(el('div', {
            style: { fontSize: '11.5px', color: 'var(--amber)', marginBottom: '6px' },
            text: '💡 ' + res.fallbackReason
          }));
        }

        var slotList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });
        pendingAutoSlots.forEach(function (sl, idx) {
          slotList.appendChild(el('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
              padding: '6px 9px', borderRadius: '7px', background: 'var(--surface)',
              border: '1px solid var(--line)', fontSize: '12px'
            }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
              el('b', { style: { color: 'var(--primary)' }, text: sl.date.slice(5) + ' ' + sl.weekday + ' ' + sl.start + '–' + sl.end }),
              el('span', { class: 'chip', style: { fontSize: '10.5px', padding: '0 5px' }, text: TimeUtil.humanMin(sl.duration) }),
              el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: sl.reason || sl.peakName || '' })
            ]),
            el('button', {
              type: 'button',
              class: 'icon-btn',
              title: '移除这段',
              style: { width: '22px', height: '22px' },
              onclick: function () {
                pendingAutoSlots.splice(idx, 1);
                drawAutoPreview(res);
              }
            }, ['✕'])
          ]));
        });
        autoPreviewBox.appendChild(slotList);
      }

      var autoAllocBox = el('div', {
        class: 'field task-auto-alloc-box',
        style: {
          padding: '11px 12px', borderRadius: '10px',
          background: 'var(--surface-2)', border: '1px solid var(--line)'
        }
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } }, [
          el('b', { style: { fontSize: '13px', color: 'var(--text-1)' }, text: '⚡ 一键智能分配时间（按睡眠精力 + DDL + 空档）' }),
          el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: 'var(--text-2)', cursor: 'pointer' } }, [
            el('input', {
              type: 'checkbox',
              checked: 'checked',
              onchange: function () { autoSyncEvents = !!this.checked; }
            }),
            '同步写入日程'
          ])
        ]),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } }, [
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '预计需要(小时)：' }),
          fAutoHours,
          hourPills
        ]),
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } }, [
          autoModeSeg,
          el('div', { style: { display: 'flex', gap: '6px' } }, [
            el('button', {
              type: 'button',
              class: 'btn btn-sm btn-primary',
              onclick: function () { runAutoPreview(false); }
            }, ['⚡ 智能分配时段']),
            el('button', {
              type: 'button',
              class: 'btn btn-sm',
              title: '换一组不冲突的候选时间段',
              onclick: function () { runAutoPreview(true); }
            }, ['🔄 换一批'])
          ])
        ]),
        autoPreviewBox
      ]);

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
          liveEl,
          nlpPreview
        ]),
        V.field('关联课程', fCourse, Store.courses.length ? '' : '还没有课程，可先到「课程表」添加'),
        el('div', { class: 'field-row' }, [
          dateField,
          V.field('截止时间', timeWrap)
        ]),
        repeatField,
        untilField,
        V.field('状态', fStatus),
        V.field('优先级', fPriority),
        V.field('精力消耗', fEnergy, '结合「睡眠智能推算 / 作息节律」在黄金时段优先推荐深度专注任务'),
        autoAllocBox,
        activeGoals.length ? V.field('关联目标 / KR', fGoalCombo, '关联后作为第 4 级微行动，完成后自动推进目标进度') : null,
        V.field('期末备考阶段', fExamStage, '选择阶段后会同步出现在「课程表 → 考试周备考看板」'),
        V.field('重要日程', fImp, '标记后置顶，并在「今日」页显示倒计时'),
        V.field('桌面小组件', fPin, '钉住后小组件固定显示这一条待办（可随时取消）'),
        V.field('标签', fTags, '支持二级标签：一级/二级，如「学习/高数」「生活/健身」'),
        V.field('备注', fNote),
        /* ---- 已投入（时间记录的另一头） ---- */
        (inv0 && (inv0.minutes > 0 || planMin0 > 0)) ? el('div', { class: 'field' }, [
          el('label', { text: '时间投入' }),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            (inv0 && inv0.minutes > 0) ? el('span', { class: 'chip chip-green', text: '已投入 ' + TimeUtil.humanMin(inv0.minutes) }) : null,
            planMin0 > 0 ? el('span', { class: 'chip chip-blue', text: '今日计划 ' + TimeUtil.humanMin(planMin0) }) : null,
            planMin0 > 0 ? el('span', {
              style: { fontSize: '12.5px', color: actualToday0 >= planMin0 ? 'var(--text-3)' : 'var(--amber)' },
              text: '今日实际 ' + TimeUtil.humanMin(actualToday0) + (actualToday0 >= planMin0 ? ' · 已达成' : ' · 还差 ' + TimeUtil.humanMin(planMin0 - actualToday0))
            }) : null,
            (inv0 && inv0.minutes > 0) ? el('span', {
              style: { fontSize: '12.5px', color: 'var(--text-3)' },
              text: inv0.count + ' 条记录' + (inv0.pomodoros ? ' · ' + inv0.pomodoros + ' 个番茄' : '') +
                    (inv0.last ? ' · 最近 ' + inv0.last.slice(5) : '')
            }) : null
          ]),
          el('div', { class: 'task-invest-list' }, inv0.recent.map(function (a) {
            return el('button', {
              class: 'task-invest-row',
              onclick: function () {
                m.close();
                if (global.openQuadrantAt) global.openQuadrantAt(a.date);
                else App.go('tasks', { tab: 'quadrant' });
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
                  var snap = JSON.parse(JSON.stringify(Store.state.tasks));
                  var r = Store.removeTask(taskId);
                  UI.toastAction(
                    r.kept ? ('已删除，' + r.kept + ' 个子任务已提升为顶层') : '已删除待办',
                    { duration: 6000, onAction: function () { Store.restoreTasks(snap); } }
                  );
                });
              }, 220);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          (isEdit && t) ? el('button', {
            class: 'btn', text: '💰 顺手记账',
            onclick: function () {
              m.close();
              setTimeout(function () { TaskDialog.openQuickLedger(t); }, 180);
            }
          }) : null,
          (isEdit && t && t.status !== 'done') ? el('button', {
            class: 'btn', text: '🍅 去专注',
            onclick: function () {
              m.close();
              if (global.App && App.focusTask) App.focusTask(taskId);
              else if (global.App) App.go('pomodoro');
            }
          }) : null,
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
                try { document.activeElement.blur(); } catch (e) {}
              }
              var rep = Store.sanitizeRepeat(gatherRepeat());
              var firstDue = Store.firstOccurrence(fDate.value, rep);
              if (isEdit && dateManuallyChanged && fDate.value) {
                firstDue = fDate.value;
              }
              var d = {
                title: fTitle.value.trim(),
                courseId: fCourse.value,
                dueDate: firstDue,
                dueTime: fTime.value,
                status: data.status,
                priority: data.priority,
                energy: data.energy,
                examStage: data.examStage,
                goalId: data.goalId || '',
                krId: data.krId || '',
                estHours: pendingAutoSlots.length
                  ? Math.round(pendingAutoSlots.reduce(function (s, x) { return s + x.duration; }, 0) / 60 * 10) / 10
                  : (parseFloat(fAutoHours.value) || 0),
                important: impOn,
                note: fNote.value,
                tags: fTags.getValue(),
                repeat: rep
              };
              if (!d.title.trim()) { UI.toast('请填写待办内容', 'err'); fTitle.focus(); return; }
              if (fRepeatType.value !== 'none' && !fDate.value) {
                UI.toast('重复任务需要先定第一期日期', 'err'); fDate.focus(); return;
              }
              var targetTaskId = taskId;
              if (isEdit) {
                Store.updateTask(taskId, d);
              } else {
                d.parentId = preset.parentId || '';
                var nt = Store.addTask(d);
                targetTaskId = nt ? nt.id : '';
                if (d.parentId) TaskRow.expanded[d.parentId] = true;   // 加了子任务就展开，让人看得见
                if (nt) TaskDialog.hintIfFirstSubtask();
              }
              var schedMsg = '';
              if (targetTaskId && pendingAutoSlots.length && Store.applyTaskSchedule) {
                var sRes = Store.applyTaskSchedule(targetTaskId, pendingAutoSlots, { syncEvents: autoSyncEvents });
                if (sRes && sRes.addedBlocks > 0) {
                  schedMsg = ' · 已智能排入 ' + sRes.addedBlocks + ' 段日程时间块';
                }
              }
              if (Store.flushSave) Store.flushSave();
              m.close();
              UI.toast((isEdit ? '待办已更新' : (d.parentId ? '子任务已添加' : '待办已添加')) + schedMsg);
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
    if (global.App && App.renderHubBar) App.renderHubBar();
    if (!global.Router || !global.App || App.currentId !== 'tasks') return;
    Router.set('tasks', state.tab === 'tasks' ? null : state.tab);
  }

  /** 重绘顶栏操作区：在视图内切换分页（不走 App.go）时，
   *  顶栏按钮不会自动重建，这里手动让 actions 跟上当前分页。 */
  function refreshActions() {
    var bar = UI.$('#viewActions');
    if (bar) { bar.innerHTML = ''; view.actions(bar); }
  }

  var state = {
    status: 'all', course: 'all', tag: '', q: '', tab: 'tasks',
    sortMode: 'auto',
    energyFilter: false,
    selectMode: false,   // 多选批量操作（仅手动排序模式）
    selected: {}         // id -> 1
  };
  /** 五个分页的可选值；深链接 / 搜索跳转都要按这个列表收口
   *  quadrant（时间去向）与 stats（统计与复盘）已不再是独立底部模块，
   *  而是挂在「待办」页里的分页；stats 还额外受 settings.statsOn 开关控制。 */
  var TABS = ['tasks', 'notes', 'diary', 'quadrant', 'stats'];
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
      // 时间去向分页有自己的一套操作（记录设置 / 记一笔）
      if (state.tab === 'quadrant') {
        if (global.QuadrantPane) global.QuadrantPane.actions(host);
        return;
      }
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
      if (tab === 'agenda') {
        state.tab = 'tasks';
        state.subMode = 'agenda';
      } else {
        state.tab = TABS.indexOf(tab) >= 0 ? tab : 'tasks';
        if (tab === 'tasks' || !tab) state.subMode = 'list';
      }
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
      if (!root) return;
      root.innerHTML = '';

      /* ---- 待办与日程 / 灵感 / 日记 / 象限与统计 分页（二级栏精简合并） ---- */
      var nt = Store.notes.length;
      var nd = Store.state.diaries.length;
      var paneTabs = [
        { v: 'tasks', l: '✅ 待办与日程', act: state.tab === 'tasks' },
        { v: 'notes', l: nt ? '💡 灵感 ' + nt : '💡 灵感', act: state.tab === 'notes' },
        { v: 'diary', l: nd ? '📔 日记 ' + nd : '📔 日记', act: state.tab === 'diary' },
        { v: 'quadrant', l: '🧭 象限与统计', act: state.tab === 'quadrant' || state.tab === 'stats' }
      ];
      var paneBar = el('div', { class: 'pane-tabs cp-two-row-tabs' });
      paneTabs.forEach(function (x) {
        paneBar.appendChild(el('button', {
          class: 'pane-tab' + (x.act ? ' active' : ''),
          text: x.l,
          onclick: function () {
            state.tab = x.v;
            view.render();
            refreshActions();
            syncRoute();
          }
        }));
      });
      root.appendChild(paneBar);

      if (state.tab === 'tasks') {
        /* ---------- 待办与日程合并切换栏（清单模式 ⇄ 7日日程流 + 快捷新建日程/纪念日） ---------- */
        if (!state.subMode) state.subMode = 'list';
        var mergeToolbar = el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '8px', flexWrap: 'wrap', marginBottom: '12px',
            padding: '8px 12px', borderRadius: '10px',
            background: 'var(--surface-2)', border: '1px solid var(--line)'
          }
        }, [
          el('div', { class: 'cp-seg-row' }, [
            el('button', {
              class: 'cp-seg-btn' + (state.subMode !== 'agenda' ? ' cp-on' : ''),
              type: 'button',
              onclick: function () { state.subMode = 'list'; view.render(); }
            }, ['📋 待办与日程清单']),
            el('button', {
              class: 'cp-seg-btn' + (state.subMode === 'agenda' ? ' cp-on' : ''),
              type: 'button',
              onclick: function () { state.subMode = 'agenda'; view.render(); }
            }, ['🗓️ 7日日程时间流'])
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
            el('button', {
              class: 'btn btn-sm',
              type: 'button',
              onclick: function () { if (global.EventDialog) EventDialog.open(); }
            }, ['📅 +定格日程']),
            el('button', {
              class: 'btn btn-sm',
              type: 'button',
              onclick: function () { if (global.AnnivDialog) AnnivDialog.open(); }
            }, ['🎂 纪念日']),
            el('button', {
              class: 'btn btn-sm',
              type: 'button',
              onclick: function () { if (global.exportFreeTimeDialog) global.exportFreeTimeDialog(Store.currentWeek()); }
            }, ['📋 空闲时间'])
          ])
        ]);
        root.appendChild(mergeToolbar);

        if (state.subMode === 'agenda') {
          var agWrap = el('div', {});
          root.appendChild(agWrap);
          if (global.AgendaPane) global.AgendaPane.render(agWrap);
          return;
        }
      }

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

      if (state.tab === 'quadrant') {
        if (global.QuadrantPane) {
          var qHost = el('div', {});
          root.appendChild(qHost);
          global.QuadrantPane.render(qHost);
        }
        return;
      }

      if (state.tab === 'stats') {
        // 兜底：万一通过旧地址进来但功能已关，回退到待办列表
        if (!Store.settings.statsOn) { state.tab = 'tasks'; view.render(); refreshActions(); return; }
        if (global.StatsPane) {
          var sHost = el('div', {});
          root.appendChild(sHost);
          global.StatsPane.render(sHost);
        }
        return;
      }

      /* 列表只展示顶层任务，子任务在父任务里展开看，避免同一件事出现两次 */
      var all = Store.rootTasks();
      var pending = all.filter(function (t) { return t.status !== 'done'; });

      /* ---- 概览 ---- */
      var upcomingEvs = Store.upcomingEvents ? Store.upcomingEvents(7) : [];
      var pendingEvs = upcomingEvs.filter(function (e) { return !e.done; });
      var summary = el('div', { class: 'task-summary' }, [
        V.statCard(pending.length, '待完成', 'var(--primary)'),
        V.statCard(Store.overdueTasks().length, '已逾期', 'var(--red)'),
        V.statCard(Store.todayTasks().length + pendingEvs.length, '近7日待办/日程', 'var(--amber)'),
        V.statCard(all.length - pending.length, '已完成', 'var(--green)')
      ]);
      root.appendChild(summary);

      /* ---- 今日日程冲突实时检测提示 ---- */
      var todayConflicts = Store.detectDayConflicts ? Store.detectDayConflicts(DateUtil.toStr(DateUtil.today())) : [];
      if (todayConflicts.length) {
        root.appendChild(el('div', {
          class: 'card',
          style: {
            padding: '9px 12px', marginBottom: '12px',
            background: 'rgba(245, 158, 11, .08)', border: '1px solid rgba(245, 158, 11, .3)',
            borderLeft: '3px solid var(--amber)', fontSize: '12px', color: 'var(--text-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap'
          }
        }, [
          el('span', {}, [
            el('b', { style: { color: 'var(--amber)', marginRight: '6px' }, text: '⚠️ 今日时段重叠提醒：' }),
            el('span', { text: todayConflicts[0].summary })
          ]),
          el('button', {
            class: 'btn btn-sm',
            style: { height: '24px', padding: '0 8px', fontSize: '11.5px' },
            onclick: function () { state.subMode = 'agenda'; view.render(); }
          }, ['查看时间流 →'])
        ]));
      }

      /* ---- 近期定点日程卡片（与待办同页融合展示） ---- */
      if (upcomingEvs.length) {
        var evCard = el('div', { class: 'card', style: { padding: '10px 14px', marginBottom: '12px' } });
        evCard.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }
        }, [
          el('b', { style: { fontSize: '13px', color: 'var(--text-1)' }, text: '📅 近期定点日程（' + upcomingEvs.length + ' 项）' }),
          el('button', {
            class: 'btn btn-sm',
            style: { height: '24px', padding: '0 8px', fontSize: '11.5px' },
            onclick: function () { state.subMode = 'agenda'; view.render(); }
          }, ['查看 7 日时间流 →'])
        ]));
        upcomingEvs.slice(0, 4).forEach(function (ev) {
          evCard.appendChild(el('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
              padding: '6px 8px', borderRadius: '8px', background: 'var(--surface-2)', marginTop: '4px', cursor: 'pointer',
              opacity: ev.done ? 0.6 : 1
            },
            onclick: function () { if (global.EventDetail) EventDetail.open(ev.id); }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1' } }, [
              el('span', { class: 'chip chip-primary', style: { fontSize: '10.5px', padding: '1px 6px' }, text: ev.date.slice(5) + ' ' + (ev.start || '') }),
              el('b', { style: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: ev.done ? 'line-through' : 'none' }, text: ev.title }),
              ev.location ? el('span', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '📍' + ev.location }) : null
            ]),
            el('button', {
              class: 'btn btn-sm',
              style: { height: '24px', padding: '0 8px', fontSize: '11px' },
              onclick: function (eClick) {
                eClick.stopPropagation();
                Store.toggleEvent(ev.id);
                view.render();
              }
            }, [ev.done ? '已完成' : '完成'])
          ]));
        });
        root.appendChild(evCard);
      }

      /* ---- 生理精力节律匹配提示条 ---- */
      if (Store.currentEnergyState) {
        var egState = Store.currentEnergyState();
        var egBanner = el('div', {
          class: 'card',
          style: {
            padding: '10px 14px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
            background: egState.isPeak ? 'var(--primary-weak)' : 'var(--surface-2)',
            borderLeft: '3px solid ' + (egState.isPeak ? 'var(--primary)' : 'var(--amber)')
          }
        }, [
          el('div', { style: { fontSize: '12.5px', lineHeight: '1.5' } }, [
            el('b', { text: egState.icon + ' ' + egState.label + '：' }),
            el('span', { style: { color: 'var(--text-2)' }, text: egState.advice })
          ]),
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [
            el('button', {
              class: 'btn btn-sm' + (state.energyFilter ? ' btn-primary' : ''),
              title: egState.sleepDamp ? '昨夜睡眠不足，黄金期已按睡眠降档' : '',
              onclick: function () {
                state.energyFilter = !state.energyFilter;
                view.render();
              }
            }, [state.energyFilter
              ? (egState.sleepDamp ? '⚡ 已按昨夜睡眠降档' : '⚡ 已开启精力匹配')
              : '⚡ 匹配当前精力']),
            el('button', {
              class: 'btn btn-sm',
              title: '自定义精力高峰时段',
              onclick: function () { if (global.SettingsView) global.SettingsView.go('energy'); }
            }, ['作息设置'])
          ])
        ]);
        root.appendChild(egBanner);
      }

      /* ---- 快速添加条（支持自然语言快速录入） ---- */
      var quickInput = V.input({
        placeholder: '⚡ 快速添加（支持精确到小时，如：3小时后交实验报告 / 明天14:00交高数作业 #作业 !重要）'
      });
      var quickBtn = el('button', {
        class: 'btn btn-primary btn-sm',
        style: { height: '32px', padding: '0 12px', flex: '0 0 auto' },
        text: '添加',
        onclick: doQuickAdd
      });
      function doQuickAdd() {
        var val = (quickInput.value || '').trim();
        if (!val) { UI.toast('请输入待办内容', 'err'); quickInput.focus(); return; }
        var nlp = global.TaskNLP ? TaskNLP.parse(val, { courses: Store.courses }) : { title: val };
        var rep = (nlp.hasRepeat && nlp.repeat) ? Store.sanitizeRepeat(nlp.repeat) : { type: 'none' };
        var baseDue = nlp.dueDate || DateUtil.toStr(DateUtil.today());
        var d = {
          title: nlp.title || val,
          dueDate: Store.firstOccurrence ? Store.firstOccurrence(baseDue, rep) : baseDue,
          dueTime: nlp.dueTime || '',
          courseId: nlp.courseId || '',
          tags: nlp.tags || [],
          priority: nlp.priority || 'normal',
          important: !!nlp.important,
          status: 'todo',
          repeat: rep
        };
        Store.addTask(d);
        quickInput.value = '';
        var repHint = (rep.type !== 'none' && Store.repeatShort) ? ('（' + Store.repeatShort(rep, d.dueDate) + '）') : '';
        UI.toast('已添加待办：' + d.title + repHint);
        view.render();
      }
      quickInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doQuickAdd();
        }
      });
      var quickBar = el('div', { class: 'quick-task-bar' }, [
        V.svg(V.icons.check, 16),
        quickInput,
        el('button', {
          class: 'btn btn-sm', title: '从截图添加待办（活动页 / 通知）',
          style: { height: '32px', padding: '0 10px', flex: '0 0 auto' },
          onclick: function () { if (global.TaskShot) global.TaskShot.open(); }
        }, [V.svg(V.icons.camera, 15)]),
        quickBtn
      ]);
      root.appendChild(quickBar);

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

      // 右侧操作区：课程筛选 + 手动排序开关
      var rightBox = el('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' } });
      if (Store.courses.length) {
        var sel = V.select(
          [{ value: 'all', label: '全部课程' }].concat(Store.courses.map(function (c) {
            return { value: c.id, label: c.name };
          })), state.course, { style: 'height:32px;width:auto;min-width:110px;font-size:12.5px' }
        );
        sel.addEventListener('change', function () { state.course = sel.value; view.render(); });
        rightBox.appendChild(sel);
      }
      if (state.sortMode === 'manual') {
        rightBox.appendChild(el('button', {
          class: 'filter-tab' + (state.selectMode ? ' active' : ''),
          title: '多选后可整组拖动或批量删除',
          onclick: function () {
            state.selectMode = !state.selectMode;
            if (!state.selectMode) state.selected = {};
            view.render();
          }
        }, [el('span', { text: '多选' })]));
      }
      rightBox.appendChild(el('button', {
        class: 'filter-tab' + (state.sortMode === 'manual' ? ' active' : ''),
        title: '开启后可长按拖动调整待办顺序',
        onclick: function () {
          state.sortMode = state.sortMode === 'manual' ? 'auto' : 'manual';
          state.selectMode = false;
          state.selected = {};
          view.render();
          if (state.sortMode === 'manual') {
            UI.hintOnce('tasks-drag', '长按待办卡片可上下拖动调整顺序；拖到底部「日历」可直接去排期。');
          }
        }
      }, [
        V.svg('M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01', 15),
        el('span', { text: '手动排序' })
      ]));
      tabBar.appendChild(rightBox);
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
        if (state.energyFilter && Store.currentEnergyState) {
          var curLv = Store.currentEnergyState().level;
          var te = t.energy || 'medium';
          if (curLv === 'high' && te === 'low') return false;
          if ((curLv === 'low' || curLv === 'rest') && te === 'high') return false;
        }
        if (kw) {
          // 父任务自己没命中时，再看它的子任务里有没有命中的
          function hit(x) {
            return [x.title, x.note, (x.tags || []).join(' ')].join(' ').toLowerCase().indexOf(kw) >= 0;
          }
          if (!hit(t) && !Store.subtasksOf(t.id).some(hit)) return false;
        }
        return true;
      }).sort(function (a, b) {
        // 仅分组模式需要「已完成置底」；手动排序模式走数组顺序，不在此处排序
        if (state.sortMode !== 'manual') {
          if (a.status === 'done' && b.status !== 'done') return 1;
          if (b.status === 'done' && a.status !== 'done') return -1;
        }
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

      /* ---- 手动排序模式：平铺列表；支持多选整组移动与批量删除 ---- */
      if (state.sortMode === 'manual') {
        // 被筛选掉的选中项自动剔除，避免「选中了但看不见」
        if (state.selectMode) {
          var visSet = {};
          list.forEach(function (t) { visSet[t.id] = 1; });
          Object.keys(state.selected).forEach(function (id) { if (!visSet[id]) delete state.selected[id]; });
        }

        function selectedIds() { return Object.keys(state.selected); }

        function toggleSelect(id) {
          if (state.selected[id]) delete state.selected[id];
          else state.selected[id] = 1;
          view.render();
        }

        function bulkDelete(ids) {
          if (!ids.length) return;
          var o = Store.subtaskOpts();
          var childCount = 0;
          ids.forEach(function (id) { childCount += Store.subtasksOf(id).length; });
          var msg = '确定删除选中的 ' + ids.length + ' 项待办吗？';
          if (childCount) {
            msg += '\n\n' + (o.orphanKeep
              ? '其中 ' + childCount + ' 个子任务会保留，并提升为顶层。'
              : '将连同 ' + childCount + ' 个子任务一起删除。');
          }
          V.confirm({ title: '批量删除待办', message: msg, danger: true, okText: '删除' }).then(function (ok) {
            if (!ok) return;
            state.selected = {};
            state.selectMode = false;
            var r = Store.removeTasks(ids);
            if (r.removed) {
              UI.toastAction('已删除 ' + r.removed + ' 项待办' + (r.kept ? '，' + r.kept + ' 个子任务已提升' : ''), {
                duration: 6000,
                onAction: function () { Store.restoreTasks(r.snapshot); }
              });
            }
          });
        }

        function bulkBar() {
          var ids = selectedIds();
          var n = ids.length;
          return el('div', { class: 'task-bulkbar' }, [
            el('span', { class: 'task-bulkcount', text: '已选 ' + n + ' 项' }),
            el('button', {
              class: 'btn btn-sm', text: '取消',
              onclick: function () { state.selectMode = false; state.selected = {}; view.render(); }
            }),
            el('button', {
              class: 'btn btn-sm' + (n ? '' : ' disabled'),
              style: n ? { color: 'var(--red)', borderColor: 'var(--red)' } : null,
              text: '删除',
              onclick: function () { if (n) bulkDelete(ids); }
            })
          ]);
        }

        root.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '0 0 10px' }
        }, [state.selectMode ? '点击卡片勾选；拖动任意已选项可整组移动' : '长按任务卡片可上下拖动调整顺序']));

        var box = el('div', { class: 'card', style: { padding: '6px 8px', marginBottom: '14px' } });

        function buildManualRow(t) {
          var node = TaskRow.build(t, { onToggle: function () { view.render(); } });
          // 顶层条目统一打标记，作为拖拽单元（父任务为 .subtask-wrap，叶子为 .task-row）
          node.classList.add('cp-task-drag');
          node.dataset.id = t.id;

          var rowEl = node.classList.contains('cp-task-row') ? node : node.querySelector('.cp-task-row');
          if (state.selectMode && rowEl) {
            var checked = !!state.selected[t.id];
            rowEl.classList.add('cp-selecting');
            if (checked) node.classList.add('cp-selected');
            var sb = el('span', {
              class: 'task-selbox' + (checked ? ' on' : ''),
              title: checked ? '取消选择' : '选择'
            }, [checked ? V.svg('M4 12l5 5L20 6', 12) : null]);
            rowEl.insertBefore(sb, rowEl.firstChild);
            rowEl.addEventListener('click', function (e) {
              if (!state.selectMode) return;
              if (e.target.closest && e.target.closest('.cp-task-selbox')) {
                e.stopPropagation(); e.preventDefault(); toggleSelect(t.id); return;
              }
              if (e.target.closest && e.target.closest('button, input, a')) return;
              e.stopPropagation(); e.preventDefault();
              toggleSelect(t.id);
            }, true);
          }

          if (global.DragGesture) {
            var beforeOrder = null;
            DragGesture.makeDraggable(node, {
              ignore: 'button, input, textarea, a, .task-check, .subtask-toggle, .icon-btn, .cp-task-selbox',
              menuTitle: '待办「' + t.title + '」',
              menu: state.selectMode ? null : function () {
                var items = DragGesture.orderMenuItems('tasks', t.id, function (x) { return !x.parentId; });
                var dateItems = DragGesture.dateMenuItems('task', t.id);
                if (items.length && dateItems.length) items.push({ sep: true });
                var all = items.concat(dateItems);
                // 无障碍兜底：不依赖拖到 TabBar，也能把待办带到日历排期
                if (all.length) all.push({ sep: true });
                all.push({
                  label: '安排到日历…', hint: '跳到日历并高亮它',
                  onClick: function () {
                    if (global.App && global.App.bus) App.bus.setRelay(t.id);
                    if (global.App && global.App.go) global.App.go('calendar');
                  }
                });
                return all;
              },
              onStart: function () {
                beforeOrder = DragGesture.orderedIds(box, '.cp-task-drag');
              },
              onMove: function (c) {
                DragGesture.moveWithin(box, node, c.overEl, c.evt.clientY, '.cp-task-drag');
                DragGesture.showDropHint(c.overEl, c.evt.clientY, '.cp-task-drag');
              },
              onEnd: function (c) {
                // 跨视图接力：拖到底部/侧边的「日历」入口松手 → 带着这条待办跳过去排期
                var nav = c && c.overEl && c.overEl.closest && c.overEl.closest('[data-view]');
                var vid = nav && nav.getAttribute('data-view');
                if (vid && vid !== 'tasks') {
                  if (vid === 'calendar' || vid === 'schedule') {
                    if (global.App && global.App.bus) App.bus.setRelay(t.id);
                    if (global.App && global.App.go) global.App.go('calendar');
                    return;
                  }
                  if (global.App && global.App.go) global.App.go(vid);
                  return;
                }
                var ids = DragGesture.orderedIds(box, '.cp-task-drag');
                var finalIds = ids;
                var selMap = state.selected;
                var selCount = Object.keys(selMap).length;
                if (state.selectMode && selMap[t.id] && selCount > 1) {
                  // 整组移动：把选中的几条作为一块，落到被拖卡片当前的位置
                  var di = ids.indexOf(t.id);
                  var others = ids.filter(function (id) { return !selMap[id]; });
                  var before = 0;
                  for (var i = 0; i < di; i++) { if (!selMap[ids[i]]) before++; }
                  var selIds = ids.filter(function (id) { return !!selMap[id]; });
                  finalIds = others.slice(0, before).concat(selIds, others.slice(before));
                }
                if (finalIds.length > 1) {
                  Store.reorderInView('tasks', finalIds);
                  if (beforeOrder && beforeOrder.join(',') !== finalIds.join(',')) {
                    UI.toastAction((state.selectMode && selCount > 1) ? '已移动 ' + selCount + ' 项' : '已调整待办顺序', {
                      onAction: function () { Store.reorderInView('tasks', beforeOrder); }
                    });
                  }
                }
              }
            });
          }
          return node;
        }

        if (global.VirtualList && list.length > 20 && !state.selectMode) {
          VirtualList.mount(box, {
            items: list,
            itemHeight: 68,
            renderItem: buildManualRow
          });
        } else {
          var manualFrag = document.createDocumentFragment();
          list.forEach(function (t) {
            manualFrag.appendChild(buildManualRow(t));
          });
          box.appendChild(manualFrag);
        }
        root.appendChild(box);
        if (state.selectMode) root.appendChild(bulkBar());
      } else {
        /* ---- 分组（待办与日程按时间段同流聚合） ---- */
        var filteredEvents = (Store.events || []).filter(function (ev) {
          if (!ev) return false;
          if (state.status === 'todo' && ev.done) return false;
          if (state.status === 'done' && !ev.done) return false;
          if (state.course !== 'all' && ev.courseId !== state.course) return false;
          if (kw) {
            var evHit = [ev.title, ev.location, ev.note].join(' ').toLowerCase().indexOf(kw) >= 0;
            if (!evHit) return false;
          }
          return true;
        });
        var groups = buildGroups(list, filteredEvents);
        groups.forEach(function (g) {
          var totalInGroup = g.items.length + (g.events ? g.events.length : 0);
          if (!totalInGroup) return;
          var head = el('div', { class: 'group-head', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
            el('span', { text: g.title }),
            el('span', { class: 'group-count', text: String(totalInGroup) }),
            g.title === '已逾期' ? el('button', {
              class: 'btn btn-sm',
              style: { marginLeft: 'auto', height: '24px', padding: '0 9px', fontSize: '11.5px', color: 'var(--primary)' },
              title: '将所有已逾期任务一键顺延到今天',
              onclick: function (e) {
                e.stopPropagation();
                if (!Store.deferOverdueTasksToToday) return;
                var res = Store.deferOverdueTasksToToday();
                if (res && res.count > 0) {
                  if (UI.toastAction && Store.restoreTaskDueDates) {
                    UI.toastAction('已将 ' + res.count + ' 项逾期任务顺延到今天', {
                      actionText: '撤销',
                      duration: 6000,
                      onAction: function () {
                        Store.restoreTaskDueDates(res.prevDates);
                        UI.toast('已撤销顺延');
                      }
                    });
                  } else {
                    UI.toast('已将 ' + res.count + ' 项逾期任务顺延到今天', 'ok');
                  }
                }
              }
            }, ['⚡ 全部顺延到今天']) : null
          ]);
          var gbox = el('div', { class: 'card', style: { padding: '6px 8px', marginBottom: '14px' } });
          if (g.events && g.events.length) {
            g.events.forEach(function (ev) {
              var evCourse = ev.courseId ? Store.getCourse(ev.courseId) : null;
              gbox.appendChild(el('div', {
                class: 'cal-merged-event-row',
                style: {
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                  padding: '7px 10px', borderRadius: '8px', background: 'var(--surface-2)', marginBottom: '4px',
                  cursor: 'pointer', opacity: ev.done ? 0.65 : 1
                },
                onclick: function () { if (global.EventDetail) EventDetail.open(ev.id); }
              }, [
                el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', flex: '1', flexWrap: 'wrap' } }, [
                  el('span', { class: 'chip chip-primary', style: { fontSize: '10.5px', padding: '1px 6px' }, text: '📅 日程 ' + ev.date.slice(5) + ' ' + (ev.start || '') + (ev.end ? '–' + ev.end : '') }),
                  el('b', { style: { fontSize: '13px', textDecoration: ev.done ? 'line-through' : 'none' }, text: ev.title }),
                  evCourse ? el('span', { class: 'chip', style: { fontSize: '10.5px' }, text: '📚 ' + evCourse.name }) : null,
                  ev.location ? el('span', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '📍' + ev.location }) : null
                ]),
                el('button', {
                  class: 'btn btn-sm',
                  type: 'button',
                  style: { height: '24px', padding: '0 8px', fontSize: '11px' },
                  onclick: function (eClick) {
                    eClick.stopPropagation();
                    Store.toggleEvent(ev.id);
                    view.render();
                  }
                }, [ev.done ? '已完成' : '完成'])
              ]));
            });
          }
          if (global.VirtualList && g.items.length > 20) {
            VirtualList.mount(gbox, {
              items: g.items,
              itemHeight: 68,
              renderItem: function (t) {
                return TaskRow.build(t, { onToggle: function () { view.render(); } });
              }
            });
          } else {
            var gfrag = document.createDocumentFragment();
            g.items.forEach(function (t) {
              gfrag.appendChild(TaskRow.build(t, { onToggle: function () { view.render(); } }));
            });
            gbox.appendChild(gfrag);
          }
          root.appendChild(head);
          root.appendChild(gbox);
        });
      }

      if (state.q) {
        var si = V.$('.cp-task-search input', root);
        if (si) setTimeout(function () {
          si.focus();
          try { si.setSelectionRange(si.value.length, si.value.length); } catch (e) {}
        }, 0);
      }
    }
  };


  function buildGroups(list, evList) {
    var overdue = [], today = [], week = [], later = [], nodate = [], done = [];
    var evOverdue = [], evToday = [], evWeek = [], evLater = [], evDone = [];
    list.forEach(function (t) {
      if (t.status === 'done') { done.push(t); return; }
      if (!t.dueDate) { nodate.push(t); return; }
      var left = DateUtil.daysLeft(t.dueDate);
      if (left < 0) overdue.push(t);
      else if (left === 0) today.push(t);
      else if (left <= 7) week.push(t);
      else later.push(t);
    });
    (evList || []).forEach(function (ev) {
      if (!ev || !ev.date) return;
      if (ev.done) { evDone.push(ev); return; }
      var left = DateUtil.daysLeft(ev.date);
      if (left < 0) evOverdue.push(ev);
      else if (left === 0) evToday.push(ev);
      else if (left <= 7) evWeek.push(ev);
      else evLater.push(ev);
    });
    [overdue, today, week, later, nodate, done].forEach(function (arr) {
      arr.sort(function (a, b) {
        if (!!a.important !== !!b.important) return a.important ? -1 : 1;
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        var ta = a.dueTime || '23:59';
        var tb = b.dueTime || '23:59';
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    });
    [evOverdue, evToday, evWeek, evLater, evDone].forEach(function (arr) {
      arr.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.start || '') < (b.start || '') ? -1 : 1;
      });
    });
    return [
      { title: '已逾期', items: overdue, events: evOverdue },
      { title: '今天截止', items: today, events: evToday },
      { title: '未来 7 天', items: week, events: evWeek },
      { title: '更晚', items: later, events: evLater },
      { title: '未设截止日期', items: nodate, events: [] },
      { title: '已完成', items: done, events: evDone }
    ];
  }

  TaskDialog.openQuickLedger = function (task) {
    if (!task) return;
    var parsed = Store.extractTaskExpense ? Store.extractTaskExpense(task) : {
      amount: 0, category: 'other', note: task.title || '', date: DateUtil.toStr(DateUtil.today()), tags: task.tags || []
    };
    var catOpts = [
      { value: 'food', label: '餐饮' },
      { value: 'study', label: '学习' },
      { value: 'daily', label: '日用' },
      { value: 'transport', label: '交通' },
      { value: 'fun', label: '娱乐' },
      { value: 'other', label: '其他' }
    ];
    var fAmt = V.input({
      type: 'number', min: '0', step: '0.01',
      placeholder: '输入金额（元）',
      value: parsed.amount > 0 ? String(parsed.amount) : '',
      dataset: { autofocus: '1' }
    });
    var fCat = V.select(catOpts, parsed.category || 'other');
    var fDate = V.input({ type: 'date', value: parsed.date || DateUtil.toStr(DateUtil.today()) });
    var fNote = V.input({ value: parsed.note || task.title || '', placeholder: '账目备注' });

    var qm = V.modal({
      title: '💰 待办顺手记一笔账',
      width: '420px',
      autofocus: true,
      body: [
        el('div', { class: 'field-row' }, [
          V.field('金额（元）', fAmt),
          V.field('分类', fCat)
        ]),
        el('div', { class: 'field-row' }, [
          V.field('日期', fDate),
          V.field('备注', fNote)
        ]),
        el('div', { class: 'ocr-hint', text: '已根据待办「' + (task.title || '') + '」自动预填备注与分类。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { qm.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存账目',
          onclick: function () {
            var amt = parseFloat(fAmt.value);
            if (!(amt > 0)) { UI.toast('请输入有效金额', 'err'); fAmt.focus(); return; }
            var ledgerBody = {
              amount: amt,
              category: fCat.value || 'other',
              date: fDate.value || DateUtil.toStr(DateUtil.today()),
              note: fNote.value.trim() || task.title || ''
            };
            // 走 createLedgerFromTask 才能带上任务标签与预算提醒；没有就走裸账目
            if (Store.createLedgerFromTask) {
              Store.createLedgerFromTask(task, ledgerBody);
            } else {
              Store.addLedger(Object.assign({
                type: 'expense', tags: parsed.tags, source: 'task', refId: task.id
              }, ledgerBody));
            }
            qm.close();
            var alertMsg = Store.lastBudgetAlert ? (' · ' + Store.lastBudgetAlert) : '';
            UI.toast('已记入账本：¥' + amt + alertMsg, 'ok');
          }
        })
      ])
    });
  };
  UI.openQuickLedgerFromTask = TaskDialog.openQuickLedger;

  global.TaskRow = TaskRow;
  global.TaskDialog = TaskDialog;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


