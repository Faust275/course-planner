

/* ==========================================================
 * 视图：番茄钟（专注计时 + 积分 + 养树）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var NS = 'http://www.w3.org/2000/svg';

  /* 模块的计时状态（不放在 Store 里，避免每帧写磁盘） */
  var T = {
    running: false,
    endAt: 0,      // 结束时间戳（ms）
    left: 0,       // 剩余秒
    total: 0,      // 本次总秒
    duration: 45,  // 设定分钟（默认 45，便于达到 ≥40 的种树门槛）
    taskId: '',
    queue: [],     // 专注队列：待办 id 顺序，结算后可「开始下一个」
    tags: '',
    treeId: '',    // 本次专注播下/养护的树
    warned60: false
  };
  var statsDim = 'day';   // day 近 7 天 / tag 按标签
  var tickId = null;

  var DURATIONS = [25, 40, 45, 60];

  var view = {
    id: 'pomodoro',
    name: '专注',
    icon: V.icons.tomato,
    title: '番茄钟',
    order: 22,
    nav: true,
    noAutoRender: true,   // 计时中不被数据变化打断

    root: null,

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-pomodoro' });
      host.appendChild(this.root);
      restoreTimer();
      this.render();
      return this.root;
    },

    onEnter: function () {
      restoreTimer();
      this.render();
    },

    onLeave: function () { /* 计时器继续在后台跑 */ },

    render: function () {
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';
      var pm = Store.pomodoro;

      var isAcademic = Store.isAcademicMode && Store.isAcademicMode();
      var isGacha = pm.mode === 'gacha';

      /* ================= 概览卡片 ================= */
      if (isAcademic) {
        var totalH = Math.round((pm.focusMinutes || 0) / 60 * 10) / 10;
        root.appendChild(el('div', { class: 'task-summary' }, [
          V.statCard(totalH, '深度专注（小时）', 'var(--primary)', 'is-big'),
          V.statCard(pm.focusMinutes, '累计专注（分钟）', 'var(--green)'),
          V.statCard((pm.sessions || []).length, '专注次数', 'var(--amber)')
        ]));
      } else {
        root.appendChild(el('div', { class: 'task-summary' }, [
          isGacha
            ? V.statCard(pm.jade, '合成玉', 'var(--primary)', 'is-big')
            : V.statCard(pm.points, '可用积分', 'var(--primary)', 'is-big'),
          V.statCard(pm.focusMinutes, '累计专注（分钟）', 'var(--green)'),
          isGacha
            ? V.statCard(Store.gachaStats().owned, '已获得干员', 'var(--amber)')
            : V.statCard(pm.trees.length, '我的森林（棵）', 'var(--amber)')
        ]));
      }

      /* ================= 计时器 ================= */
      root.appendChild(this.timerCard());

      /* ================= 🌙 夜间自律守夜模式 ================= */
      var ndCard = nightDisciplineCard();
      if (ndCard) root.appendChild(ndCard);

      /* ================= 🎧 白噪音伴音 ================= */
      var wnCard = whiteNoiseCard();
      if (wnCard) root.appendChild(wnCard);

      /* ================= 专注里程碑 / 统计 ================= */
      if (isAcademic) {
        root.appendChild(academicMilestoneCard(pm));
      }
      root.appendChild(statsCard());

      /* ================= 规则（收纳为 ? 按钮） ================= */
      root.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', margin: '-4px 0 12px' }
      }, [
        V.ruleHelpBtn('积分与奖励规则', [
          { label: '+' + POMO.POINT_PER_MIN + ' 分', text: '每专注满 1 分钟（满 ' + POMO.FOCUS_MIN_MIN + ' 分钟合格结算）' },
          { label: '+' + POMO.TASK_DONE + ' 分', text: '每完成一个待办' },
          { label: '+' + POMO.PLAN_CHECKIN + ' 分', text: '计划每打卡/记录一次' },
          { label: '+' + POMO.PLAN_DONE + ' 分', text: '完成一个计划' },
          { label: '-' + POMO.WATER_COST + ' 分', text: '给树浇水，成长 +1 记' },
          { label: '-' + POMO.REVIVE_COST + ' 分', text: '复活枯萎的树苗' },
          isGacha ? {
            label: '×' + POMO.JADE_PER_POINT,
            text: '当前是抽卡机制：每 1 积分换成 ' + POMO.JADE_PER_POINT + ' 合成玉，' + POMO.PULL_COST + ' 玉寻访一次'
          } : null
        ], { label: '积分规则' })
      ]));
    },

    /* ---------- 计时器卡 ---------- */
    timerCard: function () {
      var self = this;
      var card = el('div', { class: 'card timer-card' });

      var totalSec = T.total || T.duration * 60;
      var leftSec = T.running ? Math.max(0, (T.endAt - Date.now()) / 1000) : (T.left || T.duration * 60);
      var pct = totalSec > 0 ? 1 - leftSec / totalSec : 0;

      // 圆环
      var R = 84, C = 2 * Math.PI * R;
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      svg.setAttribute('class', 'cp-timer-ring');

      function circle(cls, extra) {
        var c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', R);
        c.setAttribute('fill', 'none');
        c.setAttribute('class', cls);
        if (extra) Object.keys(extra).forEach(function (k) { c.setAttribute(k, extra[k]); });
        svg.appendChild(c);
        return c;
      }
      circle('tr-bg', { 'stroke-width': 12 });
      circle('tr-prog', {
        'stroke-width': 12,
        'stroke-linecap': 'round',
        'stroke-dasharray': C.toFixed(2),
        'stroke-dashoffset': (C * (1 - pct)).toFixed(2),
        'transform': 'rotate(-90 100 100)'
      });

      var ringWrap = el('div', { class: 'cp-timer-ring-wrap' }, [svg]);

      var timeText = el('div', { class: 'cp-timer-time', text: fmt(leftSec) });
      var stateText = el('div', {
        class: 'cp-timer-state',
        text: T.running ? '专注中，别分心' : (T.left && T.left < T.duration * 60 ? '已暂停' : '准备好就开始吧')
      });
      ringWrap.appendChild(el('div', { class: 'cp-timer-center' }, [timeText, stateText]));
      ringWrap.appendChild(el('div', { class: 'cp-fly-layer' }));

      card.appendChild(ringWrap);

      // 关联待办
      var task = T.taskId ? Store.getTask(T.taskId) : null;
      if (task) {
        card.appendChild(el('div', { class: 'cp-timer-task' }, [
          V.svg(V.icons.check, 15),
          el('span', { text: '正在专注：' + task.title })
        ]));
      }

      // 时长选择
      var durRow = el('div', { class: 'dur-row' });
      DURATIONS.forEach(function (d) {
        durRow.appendChild(el('button', {
          class: 'dur-btn' + (T.duration === d ? ' active' : '') + (T.running ? ' disabled' : ''),
          text: d + ' 分钟',
          onclick: function () {
            if (T.running) return;
            T.duration = d;
            T.left = d * 60;
            T.total = d * 60;
            self.render();
          }
        }));
      });
      var custom = V.input({
        type: 'number', min: '1', max: '180', value: String(T.duration),
        style: 'width:78px;text-align:center;height:34px',
        onchange: function () {
          if (T.running) { UI.toast('正在计时中，先结束后再改'); this.value = String(T.duration); return; }
          var v = Math.max(1, Math.min(180, parseInt(this.value, 10) || 25));
          T.duration = v; T.left = v * 60; T.total = v * 60;
          self.render();
        }
      });
      durRow.appendChild(el('div', { class: 'dur-custom' }, [
        el('span', { text: '自定义' }),
        custom
      ]));
      card.appendChild(durRow);

      // 关联待办：拖到上方圆环=本次专注，拖到下方队列=排队；下拉兜底
      var pending = Store.rootPending();
      if (pending.length) {
        function pickTask(id, silent) {
          T.taskId = id;
          var tk = id ? Store.getTask(id) : null;
          if (tk && tk.tags && tk.tags.length) T.tags = tk.tags.join(',');
          if (tk && !silent) UI.toast('已关联待办：' + tk.title);
          self.render();
        }
        function isOverRing(el0) {
          return !!(el0 && el0.closest && el0.closest('.cp-timer-ring-wrap'));
        }
        function isOverQueue(el0) {
          return !!(el0 && el0.closest && el0.closest('.cp-pomo-queue'));
        }

        /* ---- 队列容器先建好，供托盘拖放引用 ---- */
        var queueWrap = el('div', { class: 'cp-pomo-queue' });
        var queueList = el('div', { class: 'cp-pomo-queue-list' });
        var queueHint = el('div', { class: 'cp-pomo-queue-hint', text: '把待办拖到这里排队，或点待办菜单「加入专注队列」' });
        queueWrap.appendChild(queueList);
        queueWrap.appendChild(queueHint);

        function pruneQueue() {
          T.queue = (T.queue || []).filter(function (id) { return !!Store.getTask(id); });
        }
        function enqueue(id) {
          pruneQueue();
          if (id === T.taskId) { UI.toast('这条正在专注，无需排队'); return; }
          if (T.queue.indexOf(id) >= 0) { UI.toast('已在专注队列中'); return; }
          T.queue.push(id);
          persistTimer();
          UI.toast('已加入专注队列');
          self.render();
        }
        function dequeue(id) {
          T.queue = (T.queue || []).filter(function (x) { return x !== id; });
          persistTimer();
          self.render();
        }
        function startNext() {
          pruneQueue();
          var id = T.queue.shift();
          if (!id) return;
          pickTask(id, true);
          start();
          persistTimer();
        }
        function renderQueue() {
          pruneQueue();
          queueList.innerHTML = '';
          T.queue.forEach(function (id) {
            var t = Store.getTask(id);
            if (!t) return;
            var qchip = el('div', { class: 'cp-pomo-qchip', dataset: { id: id }, title: '拖动可调整顺序' }, [
              el('span', { class: 'cp-pomo-qchip-name', text: t.title }),
              el('button', {
                class: 'cp-pomo-qchip-x', title: '移出队列', text: '×',
                onclick: function (e) { e.stopPropagation(); dequeue(id); }
              })
            ]);
            if (global.DragGesture) {
              DragGesture.makeDraggable(qchip, {
                ignore: 'button',
                onMove: function (c) {
                  DragGesture.moveWithin(queueList, qchip, c.overEl, c.evt.clientY, '.cp-pomo-qchip');
                  DragGesture.showDropHint(c.overEl, c.evt.clientY, '.cp-pomo-qchip');
                },
                onEnd: function () {
                  var ids = DragGesture.orderedIds(queueList, '.cp-pomo-qchip');
                  if (ids.length) { T.queue = ids; persistTimer(); self.render(); }
                }
              });
            }
            queueList.appendChild(qchip);
          });
          queueHint.style.display = T.queue.length ? 'none' : '';
          queueWrap.classList.toggle('cp-has-items', T.queue.length > 0); queueWrap.classList.toggle('has-items', T.queue.length > 0);
        }
        renderQueue();

        var tray = el('div', { class: 'cp-pomo-tray' });
        pending.forEach(function (t) {
          var chip = el('div', {
            class: 'cp-pomo-chip' + (t.id === T.taskId ? ' cp-active' : ''),
            dataset: { id: t.id },
            title: '拖进上方圆环开始专注，或拖进下方队列排队',
            text: t.title
          });
          chip.addEventListener('click', function () { pickTask(t.id); });
          if (global.DragGesture) {
            DragGesture.makeDraggable(chip, {
              menuTitle: '待办「' + t.title + '」',
              noAutoScroll: true,
              menu: function () {
                return [
                  { label: '关联为本次专注', onClick: function () { pickTask(t.id); } },
                  { label: '加入专注队列', hint: '结算后依次专注', onClick: function () { enqueue(t.id); } }
                ];
              },
              onMove: function (c) {
                var ring = isOverRing(c.overEl);
                ringWrap.classList.toggle('cp-drop-active', ring);
                queueWrap.classList.toggle('cp-drop-active', !ring && isOverQueue(c.overEl));
              },
              onEnd: function (c) {
                ringWrap.classList.remove('cp-drop-active');
                queueWrap.classList.remove('cp-drop-active');
                if (isOverRing(c.overEl)) pickTask(t.id);
                else if (isOverQueue(c.overEl)) enqueue(t.id);
              }
            });
          }
          tray.appendChild(chip);
        });
        card.appendChild(V.field('待办（拖进圆环=本次，拖进队列=排队）', tray, '点一下也能直接关联'));
        UI.hintOnce('pomo-drag', '把待办拖进上方圆环开始专注，或拖进下方队列依次专注。');

        card.appendChild(V.field('专注队列', queueWrap,
          T.queue.length ? '队列中 ' + T.queue.length + ' 条，结算后可「开始下一个」' : '把待办拖进来，依次专注'));

        var qfirst = T.queue.length ? Store.getTask(T.queue[0]) : null;
        if (qfirst && !T.running) {
          card.appendChild(el('button', {
            class: 'btn btn-primary',
            style: { width: '100%', marginBottom: '6px' },
            onclick: startNext
          }, ['开始下一个：' + qfirst.title]));
        }

        // 下拉兜底（保留原有交互，方便键盘/无拖动场景）
        var opts = [{ value: '', label: '不关联待办' }].concat(pending.map(function (t) {
          return { value: t.id, label: t.title };
        }));
        var sel = V.select(opts, T.taskId, { style: 'height:34px' });
        sel.addEventListener('change', function () {
          T.taskId = sel.value;
          var tk = T.taskId ? Store.getTask(T.taskId) : null;
          if (tk && tk.tags && tk.tags.length) T.tags = tk.tags.join(',');
          self.render();
        });
        card.appendChild(V.field('或从下拉选择', sel));
      }

      // 本次标签（用于按标签统计）
      var tagInput = V.tagInput(T.tags, {
        placeholder: '如 学习/英语（用于时间统计）'
      });
      tagInput.input.addEventListener('change', function () { T.tags = tagInput.getValue(); });
      tagInput.input.addEventListener('input', function () { T.tags = tagInput.getValue(); });
      card.appendChild(V.field('本次标签', tagInput, '结算后按此标签汇总专注时长'));

      // 🔒 强制前台专注模式开关（传统番茄钟严格锁屏防切出）
      var strictCfg = Store.getPomoStrict ? Store.getPomoStrict() : { enabled: false, graceSec: 15, maxLeaves: 2 };
      var strictRow = el('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
          padding: '9px 12px', marginBottom: '12px', borderRadius: '10px',
          background: strictCfg.enabled ? 'rgba(79,70,229,0.08)' : 'var(--surface-2)',
          border: '1px solid ' + (strictCfg.enabled ? 'rgba(79,70,229,0.28)' : 'var(--line)')
        }
      }, [
        el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('div', { style: { fontSize: '12.5px', fontWeight: '700', color: 'var(--text-1)' }, text: '🔒 强制前台锁屏模式（传统番茄钟防切出）' }),
          el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' },
            text: strictCfg.enabled
              ? ('已开启：专注时进入沉浸锁屏，切出后台超 ' + strictCfg.graceSec + ' 秒或累计切出 >' + strictCfg.maxLeaves + ' 次将自动判枯中断')
              : '开启后专注期间严禁切出页面或刷其他应用，超时未归自动判定专注失败'
          })
        ]),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' } }, [
          (T.running && strictCfg.enabled) ? el('button', {
            class: 'btn btn-sm btn-primary',
            type: 'button',
            onclick: function () { openStrictFocusOverlay(); }
          }, ['进入锁屏']) : null,
          el('button', {
            class: 'switch' + (strictCfg.enabled ? ' on' : ''),
            type: 'button',
            title: '切换强制前台锁屏模式',
            onclick: function () {
              var next = !strictCfg.enabled;
              if (Store.setPomoStrict) Store.setPomoStrict({ enabled: next });
              UI.toast(next ? '已开启「强制前台专注模式」，开始专注后请保持在前台' : '已关闭强制前台专注模式');
              self.render();
            }
          }, [el('i')])
        ])
      ]);
      card.appendChild(strictRow);

      // 控制按钮
      var ctrlRow = el('div', { class: 'ctrl-row' });
      if (T.running) {
        ctrlRow.appendChild(el('button', {
          class: 'btn', onclick: function () { pause(); }
        }, ['暂停']));
        ctrlRow.appendChild(el('button', {
          class: 'btn btn-danger', onclick: function () { stopEarly(); }
        }, ['结束并结算']));
      } else if (T.left && T.left < (T.total || T.duration * 60)) {
        ctrlRow.appendChild(el('button', {
          class: 'btn btn-primary', onclick: function () { resume(); }
        }, ['继续']));
        ctrlRow.appendChild(el('button', {
          class: 'btn btn-danger', onclick: function () { stopEarly(); }
        }, ['结束并结算']));
      } else {
        ctrlRow.appendChild(el('button', {
          class: 'btn btn-primary btn-lg', onclick: function () { start(); }
        }, [V.svg(V.icons.target, 17), '开始专注 ' + T.duration + ' 分钟']));
      }
      card.appendChild(ctrlRow);

      // 联动 8：番茄钟专注伴读（展示收藏的诗词/单词或每日佳句，支持换一句与引用到日记）
      if (Store.pickCompanionQuote) {
        var comp = Store.pickCompanionQuote();
        if (comp) {
          var compTextEl = el('div', { style: { fontSize: '12.5px', fontWeight: '500', color: 'var(--text)' }, text: comp.main });
          var compSubEl = el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: comp.sub });
          var curComp = comp;
          var compBar = el('div', {
            style: {
              marginTop: '12px', padding: '10px 12px', borderRadius: '10px',
              background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: '10px'
            }
          }, [
            el('div', { style: { flex: '1', minWidth: '0' } }, [
              el('div', { style: { fontSize: '11px', color: 'var(--primary)', marginBottom: '2px' }, text: comp.fav ? '📖 专注伴读 · 来自你的收藏' : '📖 专注伴读 · 每日佳句' }),
              compTextEl,
              compSubEl
            ]),
            el('div', { style: { display: 'flex', gap: '6px', flex: '0 0 auto' } }, [
              el('button', {
                class: 'btn btn-sm',
                style: { padding: '2px 8px', fontSize: '11.5px' },
                text: '换一句',
                onclick: function () {
                  var nextC = Store.pickCompanionQuote();
                  if (nextC) {
                    curComp = nextC;
                    compTextEl.textContent = nextC.main;
                    compSubEl.textContent = nextC.sub;
                  }
                }
              }),
              el('button', {
                class: 'btn btn-sm',
                style: { padding: '2px 8px', fontSize: '11.5px' },
                title: '将当前伴读佳句一键引用到今日日记',
                text: '记入日记',
                onclick: function () {
                  if (curComp && curComp.quote && Store.appendQuoteToDiary) {
                    Store.appendQuoteToDiary(curComp.quote);
                    UI.toast('已将伴读佳句引用到今日日记', 'ok');
                  }
                }
              })
            ])
          ]);
          card.appendChild(compBar);
        }
      }

      return card;
    },

  };

  /* ==========================================================
   * 组件
   * ========================================================== */
  /** 专注时长统计：今日 / 本周 / 累计 + 近 7 天柱状图 */
  /* ---------- 🎧 白噪音伴音控制器 ---------- */
  function whiteNoiseCard() {
    if (!global.WhiteNoise) return null;
    var wn = global.WhiteNoise;
    var st = wn.state();

    var card = el('div', { class: 'card cp-wn-card', style: { padding: '14px 16px', marginBottom: '14px' } });
    var titleRow = el('div', { class: 'section-title', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } }, [
      el('span', {}, ['🎧 专注伴音 · 原生白噪音']),
      el('button', {
        class: 'btn btn-sm ' + (st.playing ? 'btn-danger' : 'btn-primary'),
        style: { padding: '4px 12px' },
        onclick: function () {
          wn.toggle();
          view.render();
        }
      }, [st.playing ? '⏸️ 停止伴音' : '▶️ 开启伴音'])
    ]);
    card.appendChild(titleRow);

    // 声音选择标签
    var chipRow = el('div', { class: 'cp-wn-chips', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } });
    Object.keys(wn.SOUNDS).forEach(function (k) {
      var snd = wn.SOUNDS[k];
      var active = st.type === k;
      var chip = el('button', {
        class: 'btn btn-sm ' + (active ? 'btn-primary' : ''),
        style: { borderRadius: '16px', padding: '4px 10px', fontSize: '13px' },
        onclick: function () {
          wn.setType(k);
          if (!st.playing) wn.play(k);
          view.render();
        }
      }, [snd.icon + ' ' + snd.name]);
      chipRow.appendChild(chip);
    });
    card.appendChild(chipRow);

    // 音量调节
    var volRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
      el('span', { style: { fontSize: '13px', color: 'var(--text-muted)' }, text: '音量' }),
      el('input', {
        type: 'range', min: '0', max: '100', value: String(Math.round(st.volume * 100)),
        style: { flex: 1 },
        oninput: function () {
          wn.setVolume(this.value / 100);
        }
      }),
      el('span', { style: { fontSize: '12px', minWidth: '32px', textAlign: 'right', color: 'var(--text-muted)' }, text: Math.round(st.volume * 100) + '%' })
    ]);
    card.appendChild(volRow);

    /* ---- 睡眠定时：到点自动淡出停止，并顺手记下「我躺下了」 ----
       记这一笔不是为了统计播放时长，是为了让健康看板知道你到底几点躺下——
       这是全应用里最准的「准备睡觉」信号，比事后回忆填表靠谱。 */
    var timerRow = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }
    }, [el('span', { style: { fontSize: '13px', color: 'var(--text-muted)' }, text: '睡眠定时' })]);

    [15, 30, 45, 60].forEach(function (min) {
      var on = st.timerMin === min;
      timerRow.appendChild(el('button', {
        class: 'btn btn-sm' + (on ? ' btn-primary' : ''),
        style: { borderRadius: '14px', padding: '3px 10px', fontSize: '12.5px' },
        onclick: function () {
          if (!wn.state().playing) wn.play();
          wn.setTimer(min);
          Store.logSleepOnset('', { min: min });
          V.toast(min + ' 分钟后自动停止，已记下躺下时刻', 'ok');
          view.render();
        }
      }, [min + ' 分钟']));
    });
    timerRow.appendChild(el('button', {
      class: 'btn btn-sm',
      style: { borderRadius: '14px', padding: '3px 10px', fontSize: '12.5px' },
      onclick: function () { wn.setTimer(0); view.render(); }
    }, ['关闭定时']));
    card.appendChild(timerRow);

    var ons = Store.onsetStats ? Store.onsetStats(7) : null;
    if (ons && ons.has) {
      var bedPlan = (global.Remind && global.Remind.bedtimePlan) ? global.Remind.bedtimePlan() : null;
      var gapTxt = '';
      if (bedPlan && bedPlan.hhmm) {
        var gap = Math.round(ons.avgMin - Store.onsetAxisOf(bedPlan.hhmm));
        if (gap >= 20) gapTxt = ' · 比就寝建议 ' + bedPlan.hhmm + ' 晚 ' + gap + ' 分钟';
        else if (gap <= -20) gapTxt = ' · 比就寝建议 ' + bedPlan.hhmm + ' 早 ' + (-gap) + ' 分钟';
      }
      card.appendChild(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: '1.6' }
      }, [
        el('span', { text: '最近 ' + ons.n + ' 次平均 ' + ons.avgHHMM + ' 躺下' + gapTxt }),
        st.timerMin ? el('span', {
          style: { marginLeft: '8px', color: 'var(--primary)', fontWeight: '600' },
          text: '· 剩余 ' + Math.ceil(st.timerLeft / 60) + ' 分钟'
        }) : null
      ]));
    }

    return card;
  }

  /* ---------- 🎓 纯粹学术模式里程碑 ---------- */
  function academicMilestoneCard(pm) {
    var card = el('div', { class: 'card cp-academic-card', style: { padding: '16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title', style: { marginBottom: '12px' } }, ['🎓 深度专注学业里程碑']));

    var totalHours = Math.round((pm.focusMinutes || 0) / 60 * 10) / 10;
    var MILESTONES = [
      { h: 10, name: '初涉学海', desc: '累计深度专注达到 10 小时', icon: '🌱' },
      { h: 30, name: '静水流深', desc: '累计深度专注达到 30 小时', icon: '🌿' },
      { h: 60, name: '专精覃思', desc: '累计深度专注达到 60 小时', icon: '🌳' },
      { h: 100, name: '百炼成钢', desc: '累计深度专注达到 100 小时', icon: '🏆' },
      { h: 200, name: '登堂入室', desc: '累计深度专注达到 200 小时', icon: '👑' }
    ];

    var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    MILESTONES.forEach(function (m) {
      var reached = totalHours >= m.h;
      var pct = Math.min(100, Math.round(totalHours / m.h * 100));
      var row = el('div', {
        class: 'cp-milestone-row',
        style: {
          display: 'flex',
          alignItems: 'center',
          padding: '10px 12px',
          borderRadius: '8px',
          background: reached ? 'var(--bg-weak)' : 'var(--bg)',
          border: '1px solid ' + (reached ? 'var(--primary)' : 'var(--border)'),
          opacity: reached ? 1 : 0.8
        }
      }, [
        el('div', { style: { fontSize: '24px', marginRight: '12px' } }, [m.icon]),
        el('div', { style: { flex: 1 } }, [
          el('div', { style: { fontWeight: 'bold', fontSize: '14px' } }, [
            m.name,
            reached ? el('span', { class: 'badge', style: { marginLeft: '8px', background: 'var(--green)', color: '#fff' } }, ['已达成']) : null
          ]),
          el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, [m.desc + ' · 当前 ' + totalHours + '/' + m.h + 'h (' + pct + '%)'])
        ])
      ]);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function statsCard() {
    var st = Store.focusStats();
    var days = Store.focusByDay(7);
    var max = 30;
    days.forEach(function (x) { if (x.minutes > max) max = x.minutes; });

    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    var head = el('div', { class: 'section-title' }, [
      '专注统计',
      el('span', { class: 'q-count', text: '已自动同步到象限' })
    ]);
    head.appendChild(el('div', { class: 'dim-tabs' }, [
      { v: 'day', n: '近 7 天' },
      { v: 'tag', n: '按标签' }
    ].map(function (o) {
      return el('button', {
        class: 'dim-tab' + (statsDim === o.v ? ' active' : ''),
        text: o.n,
        onclick: function () { statsDim = o.v; view.render(); }
      });
    })));
    card.appendChild(head);

    card.appendChild(el('div', { class: 'focus-stats' }, [
      statBlock(st.today, '今日（分钟）', 'var(--primary)'),
      statBlock(st.week, '本周（分钟）', 'var(--green)'),
      statBlock(st.total, '累计（分钟）', 'var(--text-2)')
    ]));

    if (statsDim === 'tag') {
      card.appendChild(focusTagBreakdown());
      return card;
    }

    var bars = el('div', { class: 'focus-bars' });
    days.forEach(function (x) {
      var h = Math.max(3, Math.round(x.minutes / max * 46));
      var isToday = x.date === DateUtil.toStr(DateUtil.today());
      bars.appendChild(el('div', { class: 'fb-col' + (isToday ? ' today' : '') }, [
        el('div', { class: 'fb-bar-wrap' }, [
          el('i', {
            style: { height: h + 'px' },
            title: x.minutes + ' 分钟'
          })
        ]),
        el('span', { class: 'fb-label', text: DateUtil.weekdayCN(x.d).slice(1) }),
        el('span', { class: 'fb-val', text: x.minutes ? String(x.minutes) : '' })
      ]));
    });
    card.appendChild(bars);
    return card;
  }

  /** 按标签汇总专注时长（一级汇总 + 二级缩进） */
  function focusTagBreakdown() {
    var flat = Store.focusByTag();
    var box = el('div', {});

    if (!flat.length) {
      box.appendChild(el('div', { class: 'q-empty', text: '还没有专注记录。开始一次专注并打上标签，这里会按一级/二级汇总。' }));
      return box;
    }

    // 未打标签单独放最后
    var groups = {}, order = [];
    flat.forEach(function (t) {
      if (t.full === '未打标签') return;
      if (!groups[t.lv1]) { groups[t.lv1] = { minutes: 0, children: [] }; order.push(t.lv1); }
      groups[t.lv1].minutes += t.minutes;
      if (t.lv2) groups[t.lv1].children.push(t);
    });

    var max = 0;
    order.forEach(function (k) { max = Math.max(max, groups[k].minutes); });
    order.sort(function (a, b) { return groups[b].minutes - groups[a].minutes; });

    var COLORS = ['var(--primary)', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6'];
    order.forEach(function (k, i) {
      var g = groups[k];
      var color = Store.tagColor(k) || COLORS[i % COLORS.length];
      box.appendChild(el('div', { class: 'cat-row' }, [
        el('span', { class: 'cat-name', text: k }),
        el('span', { class: 'cat-bar' }, [
          el('i', { style: { width: Math.max(4, Math.round(g.minutes / max * 100)) + '%', background: color } })
        ]),
        el('span', { class: 'cat-val', text: g.minutes + ' 分' })
      ]));
      g.children.sort(function (a, b) { return b.minutes - a.minutes; }).forEach(function (c) {
        box.appendChild(el('div', { class: 'cat-row lv2' }, [
          el('span', { class: 'cat-name', text: '↳ ' + c.lv2 }),
          el('span', { class: 'cat-bar' }, [
            el('i', {
              style: {
                width: Math.max(3, Math.round(c.minutes / max * 100)) + '%',
                background: Store.tagColor(c.full) || color, opacity: '.55'
              }
            })
          ]),
          el('span', { class: 'cat-val', text: c.minutes + ' 分' })
        ]));
      });
    });

    var untagged = flat.filter(function (t) { return t.full === '未打标签'; })[0];
    if (untagged) {
      box.appendChild(el('div', { class: 'cat-row', style: { opacity: '.65' } }, [
        el('span', { class: 'cat-name', text: '未打标签' }),
        el('span', { class: 'cat-bar' }, [
          el('i', { style: { width: Math.max(4, Math.round(untagged.minutes / Math.max(max, untagged.minutes) * 100)) + '%', background: 'var(--text-3)' } })
        ]),
        el('span', { class: 'cat-val', text: untagged.minutes + ' 分' })
      ]));
    }

    box.appendChild(el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: '1.6' },
      text: '一级标签汇总其下所有二级。给专注打上「学习/英语」这类标签，就能分开看各科投入。'
    }));
    return box;
  }

  function statBlock(num, label, color) {
    return el('div', { class: 'fs-item' }, [
      el('div', { class: 'fs-num', style: { color: color }, text: String(num) }),
      el('div', { class: 'fs-label', text: label })
    ]);
  }

  function hmOf(ms) {
    var d = new Date(ms);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
           (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ==========================================================
   * 计时控制
   * ========================================================== */
  function startTick() {
    stopTick();
    tickId = setInterval(tick, 500);
  }

  function stopTick() {
    if (tickId) { clearInterval(tickId); tickId = null; }
  }

  function tick() {
    if (!T.running) return;
    var left = (T.endAt - Date.now()) / 1000;
    if (left <= 0) { complete(); return; }
    T.left = left;
    // 满 60 分钟提醒起来走走（每次专注只提醒一次）
    var elapsed = (T.total || T.duration * 60) - Math.max(0, left);
    if (!T.warned60 && elapsed >= (POMO.FOCUS_REMIND_MIN || 60) * 60) {
      T.warned60 = true;
      UI.toast('已专注 ' + (POMO.FOCUS_REMIND_MIN || 60) + ' 分钟，起来走走、活动一下');
    }
    paintTimer();
  }

  /** 只更新计时相关的 DOM，不重建页面 */
  function paintTimer() {
    var strTime = fmt(T.left);
    var strictTimeEl = document.getElementById('cpStrictTimerVal');
    if (strictTimeEl) strictTimeEl.textContent = strTime;
    var root = V.$('#view-pomodoro');
    if (!root) return;
    var timeEl = V.$('.cp-timer-time', root);
    var progEl = V.$('.cp-tr-prog', root);
    if (timeEl) timeEl.textContent = strTime;

    var total = T.total || T.duration * 60;
    if (progEl && total > 0) {
      var C = 2 * Math.PI * 84;
      var pct = 1 - Math.max(0, T.left) / total;
      progEl.setAttribute('stroke-dashoffset', (C * (1 - pct)).toFixed(2));
    }
  }

  /** 统一持久化计时状态（含队列），避免各处漏传字段 */
  function persistTimer(over) {
    var o = {
      running: T.running, endAt: T.endAt, left: Math.round(T.left), duration: T.duration,
      taskId: T.taskId, tags: T.tags, treeId: T.treeId, queue: (T.queue || []).slice()
    };
    if (over) Object.keys(over).forEach(function (k) { o[k] = over[k]; });
    Store.saveTimer(o);
  }

  function start() {
    T.total = T.duration * 60;
    T.left = T.total;
    T.endAt = Date.now() + T.left * 1000;
    T.running = true;
    T.warned60 = false;
    // 森林模式：开跑即在空树位播下当前树种（中断则枯萎）
    T.treeId = '';
    if (Store.pomodoro.mode === 'forest') {
      var seed = Store.seedTree(Store.pomodoro.selectedSpecies);
      if (seed) T.treeId = seed.id;
    }
    T.strictLeaves = 0;
    persistTimer({ running: true, endAt: T.endAt, left: 0 });
    startTick();
    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();
    if (Store.getPomoStrict && Store.getPomoStrict().enabled) {
      openStrictFocusOverlay();
      UI.toast('🔒 已进入强制前台专注模式，请勿切出页面！', 'ok');
    } else {
      UI.toast('开始专注 ' + T.duration + ' 分钟');
    }
  }

  function pause() {
    T.running = false;
    stopTick();
    if (global.WhiteNoise) WhiteNoise.stop();
    persistTimer({ running: false, endAt: 0, left: Math.round(T.left) });
    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();
    UI.toast('已暂停');
  }

  function resume() {
    T.endAt = Date.now() + T.left * 1000;
    T.running = true;
    persistTimer({ running: true, endAt: T.endAt, left: 0 });
    startTick();
    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();
  }

  /** 提前结束：按已专注的整分钟结算 */
  function stopEarly() {
    var doneMin = Math.floor(((T.total || T.duration * 60) - Math.max(0, T.left)) / 60);
    T.running = false;
    stopTick();
    if (doneMin >= 1) {
      var pm = Store.pomodoro;
      var hasTree = !!(pm.timer && pm.timer.treeId);
      var qualified = doneMin >= POMO.FOCUS_MIN_MIN;
      var fq = Store.fishQuota();
      if (!qualified && hasTree && fq.hold > 0 && fq.left > 0) {
        // 不足 40 分钟：给一次「用券休整」的机会，树苗与进度都不丢
        V.confirm({
          title: '要不要先歇会儿？',
          message: '这次专注 ' + doneMin + ' 分钟，不足 ' + POMO.FOCUS_MIN_MIN + ' 分钟不算合格，树苗会枯。\n' +
                   '用 1 张摸鱼券休整：树苗与进度都保留，本次时长照样记入统计与象限。',
          okText: '用券休整',
          cancelText: '结束并让它枯',
          closeValue: 'resume'
        }).then(function (yes) {
          if (yes === 'resume') {
            T.running = true;
            startTick();
            return;
          }
          if (yes) {
            var r = Store.useFishCard('rest');
            if (!r.ok) { V.toast(r.msg, 'err'); finish(doneMin); return; }
            V.toast('摸鱼券：树苗保留，下次接着长');
            finish(doneMin, true);
          } else {
            finish(doneMin);
          }
        });
        return;
      }
      finish(doneMin);
    } else if (Store.fishQuota().hold > 0 && Store.fishQuota().left > 0) {
      // 有摸鱼券：先问一句要不要护住这棵树，而不是直接判枯
      V.confirm({
        title: '这次不算数？',
        message: '不足 1 分钟，本次不计分。要用 1 张摸鱼券护住这棵树吗（阶段与进度都保留，下次接着长）？\n' +
                 '不用的话树苗会枯萎，之后要花 ' + POMO.REVIVE_COST + ' 养分或 1 张券复活。',
        okText: '用券护住',
        cancelText: '让它枯',
        closeValue: 'resume'
      }).then(function (yes) {
        if (yes === 'resume') {
          T.running = true;
          startTick();
          return;
        }
        if (yes) {
          var r = Store.useFishCard('protect');
          if (!r.ok) V.toast(r.msg, 'err');
          else V.toast('摸鱼券护住了这棵树');
        } else {
          Store.witherActiveTree();
        }
        afterStopEarly();
      });
      return;
    } else {
      Store.witherActiveTree();
      afterStopEarly();
    }
  }

  /** 提前停止后的收尾（清空计时器状态并重绘） */
  function afterStopEarly() {
    T.treeId = '';
    persistTimer({ running: false, endAt: 0, left: 0, taskId: '', treeId: '' });
    T.left = T.duration * 60;
    T.total = T.duration * 60;
    var v0 = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v0 && App.currentId === 'pomodoro') v0.render();
    UI.toast('不足 1 分钟，本次不计分');
  }

  function complete() {
    T.running = false;
    stopTick();
    closeStrictFocusOverlay();
    T.left = 0;
    finish(T.duration);
  }

  function finish(minutes, keepTree) {
    var taskId = T.taskId;
    var task = taskId ? Store.getTask(taskId) : null;

    // 把专注时段写进象限：[结束时间 - 专注时长, 结束时间]
    var endMs = Date.now();
    var startMs = endMs - minutes * 60000;
    var extra = {
      date: DateUtil.toStr(new Date(startMs)),
      start: hmOf(startMs),
      end: hmOf(endMs),
      name: '专注' + (task ? '：' + task.title : ''),
      tags: T.tags
    };

    var gain = Store.finishFocus(minutes, taskId, extra, { keepTree: !!keepTree });
    T.treeId = '';
    T.left = T.duration * 60;
    T.total = T.duration * 60;

    var gacha = Store.pomodoro.mode === 'gacha';
    var gainTxt = gacha ? (gain * POMO.JADE_PER_POINT + ' 合成玉') : (gain + ' 养分');
    flyPoints('+' + (gacha ? (gain * POMO.JADE_PER_POINT) + ' 玉' : gain + ' 分'));
    bumpScore();

    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();

    var syncedPlans = (Store.pomodoro && Store.pomodoro.lastSyncedPlans) || [];
    var planNote = syncedPlans.length ? ('，并已自动累计至计划「' + syncedPlans.join('、') + '」') : '';

    function notifyFocusComplete(prefixMsg) {
      var dh = Store.dayHealth ? Store.dayHealth(extra.date) : null;
      var ringIncomplete = !dh || !dh.workoutMet;
      if (minutes >= 40 && ringIncomplete && UI.toastAction) {
        UI.toastAction(prefixMsg + ' · 久坐专注 ' + minutes + ' 分钟，起身拉伸或散步 10 分钟？', {
          actionText: '🧘 记10分钟拉伸',
          duration: 7000,
          onAction: function () {
            Store.addWorkout({
              date: extra.date,
              start: extra.end,
              duration: 10,
              type: 'yoga',
              name: '专注后拉伸放松',
              note: '番茄钟久坐后起身活动'
            });
            UI.toast('已记入 10 分钟拉伸锻炼，活力三环与象限已同步！', 'ok');
          }
        });
      } else {
        UI.toast(prefixMsg, 'ok');
      }
    }

    var onPage = App.currentId === 'pomodoro';
    if (gain <= 0) {
      UI.toast('专注不足 ' + POMO.FOCUS_MIN_MIN + ' 分钟，本次不计分' + (Store.pomodoro.mode === 'forest' ? '，本次树苗枯萎' : '') + planNote);
      return;
    }
    if (!onPage) {
      notifyFocusComplete('专注完成，获得 ' + gainTxt + planNote);
      return;
    }
    if (task && task.status !== 'done') {
      setTimeout(function () {
        var nextStageMap = { round1: 'papers', papers: 'sprint' };
        var nextStageName = { papers: '✍️ 历年真题', sprint: '🔥 考前冲刺' };
        var nextSt = task.examStage ? nextStageMap[task.examStage] : null;
        V.confirm({
          title: '专注完成',
          message: '本次专注 ' + minutes + ' 分钟，获得 ' + gainTxt + planNote + '。\n要把「' + task.title + '」标记为完成吗？（额外 +' + POMO.TASK_DONE + ' 分）',
          okText: '标记完成',
          cancelText: '保持当前状态',
          extraButtons: nextSt ? [{ text: '推进至「' + nextStageName[nextSt] + '」', value: 'next_stage' }] : []
        }).then(function (ok) {
          if (ok === true) {
            Store.updateTask(taskId, { status: 'done' });
            bumpScore();
            notifyFocusComplete('已完成待办，+' + POMO.TASK_DONE + ' 分');
            if (v && App.currentId === 'pomodoro') v.render();
          } else if (ok === 'next_stage' && nextSt) {
            Store.updateTask(taskId, { status: 'doing', examStage: nextSt });
            notifyFocusComplete('已将备考阶段推进至：' + nextStageName[nextSt]);
            if (v && App.currentId === 'pomodoro') v.render();
          } else {
            notifyFocusComplete('专注完成，获得 ' + gainTxt + planNote);
          }
        });
      }, 400);
    } else {
      notifyFocusComplete('专注完成，获得 ' + gainTxt + planNote);
    }
  }

  /** 页面刷新后恢复计时 */
  function restoreTimer() {
    var t = Store.pomodoro.timer;
    if (!t) return;
    T.duration = t.duration || 45;
    T.taskId = t.taskId || '';
    T.queue = Array.isArray(t.queue) ? t.queue.filter(function (x) { return !!x; }) : [];
    T.tags = t.tags || '';
    T.treeId = t.treeId || '';
    T.total = T.duration * 60;
    if (t.running && t.endAt) {
      var left = (t.endAt - Date.now()) / 1000;
      if (left > 1) {
        T.running = true;
        T.endAt = t.endAt;
        T.left = left;
        startTick();
        return;
      }
      // 已经跑完：结算
      finish(T.duration);
      return;
    }
    T.running = false;
    T.left = t.left || T.duration * 60;
    if (T.left >= T.duration * 60) T.left = T.duration * 60;
  }

  /* ==========================================================
   * 动画
   * ========================================================== */
  function flyPoints(text) {
    var layer = V.$('#view-pomodoro .cp-fly-layer');
    if (!layer) return;
    var n = el('div', { class: 'fly-points', text: text });
    layer.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1700);
  }

  function bumpScore() {
    setTimeout(function () {
      var n = V.$('#view-pomodoro .cp-sum-card.cp-is-big .cp-sum-num');
      if (!n) return;
      n.classList.remove('cp-bump');
      void n.offsetWidth;
      n.classList.add('cp-bump');
    }, 60);
  }


  /* ==========================================================
   * 🔒 强制前台专注模式（Strict Foreground Focus Lock）与 🌙 夜间自律守夜模式
   * ========================================================== */
  var strictHiddenAt = 0;
  var strictFailTimer = null;
  var nightHiddenAt = 0;
  var nightTicker = null;
  var lastAutoNightDate = '';

  function requestWakeLockSafe() {
    try {
      if (typeof navigator !== 'undefined' && navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').catch(function () {});
      }
    } catch (e) {}
  }

  function openStrictFocusOverlay() {
    closeStrictFocusOverlay();
    if (!T.running) return;
    requestWakeLockSafe();
    var cfg = Store.getPomoStrict ? Store.getPomoStrict() : { enabled: true, graceSec: 15, maxLeaves: 2 };
    var task = T.taskId ? Store.getTask(T.taskId) : null;
    var comp = Store.pickCompanionQuote ? Store.pickCompanionQuote() : null;

    var ov = el('div', {
      class: 'cp-strict-overlay',
      id: 'cpStrictFocusOverlay',
      style: {
        position: 'fixed', inset: '0', zIndex: '9500',
        background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 55%, #0f172a 100%)',
        color: '#f8fafc', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '24px',
        textAlign: 'center', userSelect: 'none'
      }
    }, [
      el('div', {
        style: {
          padding: '5px 14px', borderRadius: '999px',
          background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(129,140,248,0.4)',
          fontSize: '12px', color: '#a5b4fc', marginBottom: '18px'
        },
        id: 'cpStrictBadge',
        text: '🔒 强制前台专注锁屏中 · 切出超 ' + cfg.graceSec + ' 秒自动判枯（已切出 ' + (T.strictLeaves || 0) + '/' + cfg.maxLeaves + ' 次）'
      }),
      el('div', {
        id: 'cpStrictTimerVal',
        style: { fontSize: '64px', fontWeight: '800', letterSpacing: '3px', fontVariantNumeric: 'tabular-nums', color: '#ffffff', lineHeight: '1.1' },
        text: fmt(T.left)
      }),
      el('div', {
        style: { fontSize: '15px', color: '#cbd5e1', marginTop: '10px', fontWeight: '600' },
        text: task ? ('🎯 正在攻克：' + task.title) : '🍅 深度专注进行中，请保持当前画面在前台'
      }),
      comp ? el('div', {
        style: {
          maxWidth: '460px', marginTop: '24px', padding: '12px 16px',
          borderRadius: '12px', background: 'rgba(255,255,255,0.06)',
          fontSize: '13px', color: '#e2e8f0', lineHeight: '1.6'
        }
      }, [
        el('div', { text: comp.main }),
        el('div', { style: { fontSize: '11.5px', color: '#94a3b8', marginTop: '4px' }, text: comp.sub })
      ]) : null,
      el('div', { style: { display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap', justifyContent: 'center' } }, [
        global.WhiteNoise ? el('button', {
          class: 'btn',
          style: { background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
          onclick: function () {
            WhiteNoise.toggle();
            this.textContent = WhiteNoise.state().playing ? '⏸️ 停止白噪音' : '🎧 开启白噪音';
          }
        }, [WhiteNoise.state().playing ? '⏸️ 停止白噪音' : '🎧 开启白噪音']) : null,
        el('button', {
          class: 'btn',
          style: { background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.15)' },
          onclick: function () { closeStrictFocusOverlay(); }
        }, ['收起全屏（保持在本页）']),
        el('button', {
          class: 'btn btn-danger',
          onclick: function () {
            closeStrictFocusOverlay();
            stopEarly();
          }
        }, ['放弃并提前结算'])
      ])
    ]);
    document.body.appendChild(ov);
  }

  function closeStrictFocusOverlay() {
    var ov = document.getElementById('cpStrictFocusOverlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function failStrictFocus(reason) {
    if (!T.running) return;
    T.running = false;
    stopTick();
    if (strictFailTimer) { clearTimeout(strictFailTimer); strictFailTimer = null; }
    closeStrictFocusOverlay();
    if (global.WhiteNoise) WhiteNoise.stop();
    Store.witherActiveTree();
    afterStopEarly();
    UI.toast('⚠️ 强制前台专注中断：' + reason + '（本次树苗已枯萎）', 'err');
  }

  /* ---------- 🌙 夜间自律守夜模式卡片与锁屏浮层 ---------- */
  function nightDisciplineCard() {
    if (!Store.getNightDiscipline) return null;
    var cfg = Store.getNightDiscipline();
    var sess = cfg.activeSession;
    var inWin = Store.isInNightDisciplineWindow ? Store.isInNightDisciplineWindow() : false;
    var hist = Array.isArray(cfg.history) ? cfg.history : [];
    var okCount = hist.filter(function (h) { return h && h.success; }).length;

    var card = el('div', {
      class: 'card cp-night-discipline-card',
      style: {
        padding: '15px 16px', marginBottom: '14px',
        background: sess ? 'linear-gradient(135deg, rgba(30,27,75,0.92), rgba(15,23,42,0.95))' : 'var(--surface)',
        color: sess ? '#f8fafc' : 'var(--text-1)',
        border: sess ? '1px solid rgba(129,140,248,0.45)' : '1px solid var(--line)'
      }
    });

    card.appendChild(el('div', {
      class: 'section-title',
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px', color: sess ? '#fff' : 'var(--text-1)' }
    }, [
      el('span', {}, ['🌙 夜间自律模式（自定义守夜锁屏 · 防熬夜刷手机）']),
      el('span', {
        class: 'chip',
        style: {
          background: sess ? '#4f46e5' : (inWin ? 'rgba(245,158,11,0.16)' : 'var(--surface-2)'),
          color: sess ? '#fff' : (inWin ? 'var(--amber)' : 'var(--text-3)'),
          fontSize: '11px', fontWeight: '700'
        },
        text: sess ? '🌌 守夜进行中' : (inWin ? '⏰ 已进入夜间自律时段' : ('累计达标 ' + okCount + ' 夜'))
      })
    ]));

    card.appendChild(el('p', {
      style: { fontSize: '12px', color: sess ? '#cbd5e1' : 'var(--text-3)', margin: '0 0 10px', lineHeight: '1.6' },
      text: '原理与番茄钟强制前台一致：自定义夜间开启与次晨结束时间，开启守夜后锁定前台并自动记下入睡时刻；期间不切出刷手机、次晨打卡结算即可获 +15 积分并自动同步睡眠记录。'
    }));

    // 自定义开启/结束时间设置行
    var stInput = V.input({
      type: 'time', value: cfg.startTime || '23:00',
      style: { width: '112px', height: '32px', fontSize: '12.5px' },
      onchange: function () {
        Store.setNightDiscipline({ startTime: this.value || '23:00' });
        UI.toast('夜间自律开启时间已设为 ' + (this.value || '23:00'));
      }
    });
    var etInput = V.input({
      type: 'time', value: cfg.endTime || '06:30',
      style: { width: '112px', height: '32px', fontSize: '12.5px' },
      onchange: function () {
        Store.setNightDiscipline({ endTime: this.value || '06:30' });
        UI.toast('夜间自律结束(起床)时间已设为 ' + (this.value || '06:30'));
      }
    });

    card.appendChild(el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '10px', flexWrap: 'wrap', padding: '8px 10px', borderRadius: '8px',
        background: sess ? 'rgba(255,255,255,0.08)' : 'var(--surface-2)', marginBottom: '10px'
      }
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
        el('span', { style: { fontSize: '12px', fontWeight: '600' }, text: '⏰ 自定义自律时段：' }),
        stInput,
        el('span', { style: { fontSize: '12px' }, text: '至次日' }),
        etInput
      ]),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
        el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox', checked: !!cfg.enabled,
            onchange: function () {
              Store.setNightDiscipline({ enabled: this.checked });
              UI.toast(this.checked ? '已开启夜间自律定时提醒' : '已关闭夜间自律定时提醒');
              view.render();
            }
          }),
          el('span', { text: '到点自动开启' })
        ]),
        el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox', checked: cfg.strictForeground !== false,
            onchange: function () {
              Store.setNightDiscipline({ strictForeground: this.checked });
              UI.toast(this.checked ? '已开启守夜强制前台防刷手机监测' : '已关闭守夜强制前台监测');
            }
          }),
          el('span', { text: '强制前台防切出' })
        ])
      ])
    ]));

    if (sess) {
      var elapsedMin = Math.max(0, Math.round((Date.now() - (sess.startedAt || Date.now())) / 60000));
      card.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }
      }, [
        el('span', {
          style: { fontSize: '12.5px', color: '#a5b4fc' },
          text: '🌙 从 ' + sess.startHHMM + ' 开始守夜 · 已坚持 ' + elapsedMin + ' 分钟' + (sess.violated ? '（⚠️ 曾超时切出）' : '（状态良好）')
        }),
        el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm',
            style: { background: 'rgba(255,255,255,0.14)', color: '#fff', border: 'none' },
            onclick: function () { openNightDisciplineOverlay(); }
          }, ['🌌 打开守夜锁屏']),
          el('button', {
            class: 'btn btn-sm btn-primary',
            onclick: function () { settleNightDisciplineFromUI(); }
          }, ['☀️ 早安打卡结算']),
          el('button', {
            class: 'btn btn-sm btn-danger',
            onclick: function () {
              Store.cancelNightDiscipline();
              closeNightDisciplineOverlay();
              UI.toast('已退出本次夜间自律守夜');
              view.render();
            }
          }, ['放弃'])
        ])
      ]));
    } else {
      card.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-primary',
          style: { flex: '1' },
          onclick: function () {
            Store.startNightDiscipline();
            if (cfg.whiteNoise && global.WhiteNoise) {
              WhiteNoise.play();
              WhiteNoise.setTimer(30);
            }
            openNightDisciplineOverlay();
            view.render();
            UI.toast('🌙 已开启今夜自律守夜，放下手机安心休息吧！', 'ok');
          }
        }, ['🌙 立即开启今夜自律守夜（' + (cfg.startTime || '23:00') + '–' + (cfg.endTime || '06:30') + '）'])
      ]));
    }

    return card;
  }

  function settleNightDisciplineFromUI() {
    var rec = Store.completeNightDiscipline ? Store.completeNightDiscipline() : null;
    closeNightDisciplineOverlay();
    if (rec) {
      if (rec.success) {
        UI.toast('☀️ 早安！夜间自律守夜达标（' + rec.durationMin + ' 分钟），获得 +' + rec.points + ' 积分，并已同步睡眠记录！', 'ok');
      } else {
        UI.toast('☀️ 已结束夜间守夜（' + rec.durationMin + ' 分钟），因守夜期间切出前台超时，本次未获自律积分');
      }
    }
    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();
  }

  function openNightDisciplineOverlay() {
    closeNightDisciplineOverlay();
    var cfg = Store.getNightDiscipline ? Store.getNightDiscipline() : null;
    if (!cfg || !cfg.activeSession) return;
    requestWakeLockSafe();
    var sess = cfg.activeSession;

    var clockEl = el('div', {
      style: { fontSize: '58px', fontWeight: '800', letterSpacing: '2px', color: '#f8fafc', fontVariantNumeric: 'tabular-nums' },
      text: hmOf(Date.now())
    });
    var subEl = el('div', {
      style: { fontSize: '14px', color: '#94a3b8', marginTop: '8px' },
      text: '已守夜 ' + Math.max(0, Math.round((Date.now() - sess.startedAt) / 60000)) + ' 分钟 · 目标起床时刻 ' + (sess.targetEndTime || cfg.endTime || '06:30')
    });

    var ov = el('div', {
      class: 'cp-night-overlay',
      id: 'cpNightDisciplineOverlay',
      style: {
        position: 'fixed', inset: '0', zIndex: '9550',
        background: 'radial-gradient(circle at 50% 25%, #1e1b4b 0%, #090d16 75%)',
        color: '#f8fafc', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '24px',
        textAlign: 'center', userSelect: 'none'
      }
    }, [
      el('div', {
        style: {
          padding: '5px 14px', borderRadius: '999px',
          background: 'rgba(129,140,248,0.16)', border: '1px solid rgba(129,140,248,0.35)',
          fontSize: '12px', color: '#c7d2fe', marginBottom: '20px'
        },
        text: '🌙 夜间自律守夜锁屏中 · 放下手机好眠一整晚'
      }),
      clockEl,
      subEl,
      el('div', {
        style: {
          maxWidth: '400px', marginTop: '22px', padding: '12px 16px',
          borderRadius: '12px', background: 'rgba(255,255,255,0.05)',
          fontSize: '12.5px', color: '#cbd5e1', lineHeight: '1.7'
        },
        text: cfg.strictForeground !== false
          ? ('🔒 强制前台守夜已生效：从 ' + sess.startHHMM + ' 入睡起，请勿切出刷其他应用。次晨醒来点击下方「我醒了」即可领取 +15 自律积分并自动生成昨晚睡眠记录。')
          : ('从 ' + sess.startHHMM + ' 开始记录守夜，次晨醒来点击下方按钮即可完成结算。')
      }),
      el('div', { style: { display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap', justifyContent: 'center' } }, [
        global.WhiteNoise ? el('button', {
          class: 'btn',
          style: { background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
          onclick: function () {
            if (!WhiteNoise.state().playing) {
              WhiteNoise.play();
              WhiteNoise.setTimer(30);
              this.textContent = '⏸️ 停止助眠白噪音 (30m定时)';
            } else {
              WhiteNoise.stop();
              this.textContent = '🎧 开启30分钟助眠白噪音';
            }
          }
        }, [WhiteNoise.state().playing ? '⏸️ 停止助眠白噪音 (30m定时)' : '🎧 开启30分钟助眠白噪音']) : null,
        el('button', {
          class: 'btn btn-primary',
          style: { padding: '0 18px', height: '40px', fontSize: '14px' },
          onclick: function () { settleNightDisciplineFromUI(); }
        }, ['☀️ 我醒了 · 早安打卡结算']),
        el('button', {
          class: 'btn',
          style: { background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.15)' },
          onclick: function () { closeNightDisciplineOverlay(); }
        }, ['最小化浮层'])
      ])
    ]);
    document.body.appendChild(ov);

    if (nightTicker) clearInterval(nightTicker);
    nightTicker = setInterval(function () {
      if (!document.getElementById('cpNightDisciplineOverlay')) {
        clearInterval(nightTicker);
        nightTicker = null;
        return;
      }
      var curCfg = Store.getNightDiscipline ? Store.getNightDiscipline() : null;
      var curSess = curCfg && curCfg.activeSession;
      if (!curSess) {
        closeNightDisciplineOverlay();
        return;
      }
      clockEl.textContent = hmOf(Date.now());
      var mins = Math.max(0, Math.round((Date.now() - curSess.startedAt) / 60000));
      subEl.textContent = '已守夜 ' + mins + ' 分钟 · 目标起床时刻 ' + (curSess.targetEndTime || curCfg.endTime || '06:30') +
        (curSess.violated ? ' · ⚠️ 曾切出超时' : '');
    }, 5000);
  }

  function closeNightDisciplineOverlay() {
    if (nightTicker) { clearInterval(nightTicker); nightTicker = null; }
    var ov = document.getElementById('cpNightDisciplineOverlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  // 全局前台焦点与可见性守护（同时服务「番茄钟强制前台模式」与「夜间自律模式」）
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function () {
      var strictCfg = Store.getPomoStrict ? Store.getPomoStrict() : { enabled: false, graceSec: 15, maxLeaves: 2 };
      var ndCfg = Store.getNightDiscipline ? Store.getNightDiscipline() : { enabled: false };

      if (document.visibilityState === 'hidden') {
        // 1) 番茄钟强制前台监测
        if (T.running && strictCfg.enabled) {
          strictHiddenAt = Date.now();
          if (strictFailTimer) clearTimeout(strictFailTimer);
          strictFailTimer = setTimeout(function () {
            if (document.visibilityState === 'hidden' && T.running && strictCfg.enabled) {
              failStrictFocus('切出前台超过 ' + strictCfg.graceSec + ' 秒未归');
            }
          }, (strictCfg.graceSec || 15) * 1000);
        }
        // 2) 夜间自律强制前台监测
        if (ndCfg && ndCfg.activeSession && ndCfg.strictForeground !== false) {
          nightHiddenAt = Date.now();
        }
      } else if (document.visibilityState === 'visible') {
        if (strictFailTimer) { clearTimeout(strictFailTimer); strictFailTimer = null; }
        if (strictHiddenAt > 0 && T.running && strictCfg.enabled) {
          var awaySec = Math.max(1, Math.round((Date.now() - strictHiddenAt) / 1000));
          strictHiddenAt = 0;
          if (awaySec >= (strictCfg.graceSec || 15)) {
            failStrictFocus('切出前台达 ' + awaySec + ' 秒（超过 ' + strictCfg.graceSec + ' 秒上限）');
          } else {
            T.strictLeaves = (T.strictLeaves || 0) + 1;
            if (T.strictLeaves > (strictCfg.maxLeaves || 2)) {
              failStrictFocus('单次专注切出前台超过 ' + (strictCfg.maxLeaves || 2) + ' 次');
            } else {
              var badge = document.getElementById('cpStrictBadge');
              if (badge) {
                badge.textContent = '⚠️ 警告：刚才切出 ' + awaySec + ' 秒（已切出 ' + T.strictLeaves + '/' + (strictCfg.maxLeaves || 2) + ' 次，再切出将判枯）';
              }
              UI.toast('⚠️ 强制前台警告：刚才切出 ' + awaySec + ' 秒（' + T.strictLeaves + '/' + (strictCfg.maxLeaves || 2) + ' 次）', 'err');
            }
          }
        }
        if (nightHiddenAt > 0 && ndCfg && ndCfg.activeSession && ndCfg.strictForeground !== false) {
          var nAway = Math.max(1, Math.round((Date.now() - nightHiddenAt) / 1000));
          nightHiddenAt = 0;
          if (Store.recordNightDisciplineLeave) {
            var updatedSess = Store.recordNightDisciplineLeave(nAway);
            if (updatedSess && updatedSess.violated) {
              UI.toast('⚠️ 夜间自律提醒：守夜期间切出前台达 ' + nAway + ' 秒，请放下手机休息！', 'err');
            }
          }
        }
      }
    });
  }

  // 每 60 秒检查一次是否到达用户自定义的「夜间自律模式」开启时间
  setInterval(function () {
    try {
      if (!Store.getNightDiscipline || !Store.isInNightDisciplineWindow) return;
      var cfg = Store.getNightDiscipline();
      if (!cfg.enabled || cfg.autoPopup === false || cfg.activeSession) return;
      if (!Store.isInNightDisciplineWindow()) return;
      var todayKey = DateUtil.toStr(DateUtil.today()) + '_' + (cfg.startTime || '23:00');
      if (lastAutoNightDate === todayKey) return;
      lastAutoNightDate = todayKey;
      Store.startNightDiscipline();
      openNightDisciplineOverlay();
      UI.toast('🌙 已到设定的夜间自律时间（' + cfg.startTime + '），自动进入守夜锁屏', 'ok');
    } catch (e) {}
  }, 60000);

  global.NightDiscipline = {
    openOverlay: openNightDisciplineOverlay,
    closeOverlay: closeNightDisciplineOverlay,
    settle: settleNightDisciplineFromUI
  };
  global.StrictFocus = {
    openOverlay: openStrictFocusOverlay,
    closeOverlay: closeStrictFocusOverlay,
    fail: failStrictFocus
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


