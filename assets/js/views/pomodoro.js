

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
            : V.statCard(pm.trees.length, '我的森林（棵）', 'var(--amber)'),
          V.statCard(pm.earned, '累计获得', 'var(--text-2)')
        ]));
      }

      /* ================= 计时器 ================= */
      root.appendChild(this.timerCard());

      /* ================= 🎧 白噪音伴音 ================= */
      var wnCard = whiteNoiseCard();
      if (wnCard) root.appendChild(wnCard);

      /* ================= 专注里程碑 / 统计 ================= */
      if (isAcademic) {
        root.appendChild(academicMilestoneCard(pm));
      }
      root.appendChild(statsCard());

      /* ================= 规则 ================= */
      root.appendChild(el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } }, [
        el('div', { class: 'section-title' }, ['积分规则']),
        el('ul', { class: 'rule-list' }, [
          el('li', {}, [el('b', { text: '+' + POMO.POINT_PER_MIN + ' 分' }), document.createTextNode('　每专注满 1 分钟')]),
          el('li', {}, [el('b', { text: '+' + POMO.TASK_DONE + ' 分' }), document.createTextNode('　每完成一个待办')]),
          el('li', {}, [el('b', { text: '+' + POMO.PLAN_CHECKIN + ' 分' }), document.createTextNode('　计划每打卡一次')]),
          el('li', {}, [el('b', { text: '+' + POMO.PLAN_DONE + ' 分' }), document.createTextNode('　完成一个计划')]),
          el('li', {}, [el('b', { text: '-' + POMO.PLANT_COST + ' 分' }), document.createTextNode('　种下一棵树')]),
          el('li', {}, [el('b', { text: '-' + POMO.WATER_COST + ' 分' }), document.createTextNode('　给树浇水，成长值 +' + POMO.WATER_COST)]),
          isGacha ? el('li', {}, [
            el('b', { text: '×' + POMO.JADE_PER_POINT }),
            document.createTextNode('　当前是抽卡机制：每 1 积分换成 ' + POMO.JADE_PER_POINT +
              ' 合成玉，' + POMO.PULL_COST + ' 玉寻访一次')
          ]) : null
        ])
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
      var prog = circle('tr-prog', {
        'stroke-width': 12,
        'stroke-linecap': 'round',
        'stroke-dasharray': C.toFixed(2),
        'stroke-dashoffset': (C * (1 - pct)).toFixed(2),
        'transform': 'rotate(-90 100 100)'
      });

      var ringWrap = el('div', { class: 'timer-ring-wrap' }, [svg]);

      var timeText = el('div', { class: 'timer-time', text: fmt(leftSec) });
      var stateText = el('div', {
        class: 'timer-state',
        text: T.running ? '专注中，别分心' : (T.left && T.left < T.duration * 60 ? '已暂停' : '准备好就开始吧')
      });
      ringWrap.appendChild(el('div', { class: 'timer-center' }, [timeText, stateText]));
      ringWrap.appendChild(el('div', { class: 'fly-layer' }));

      card.appendChild(ringWrap);

      // 关联待办
      var task = T.taskId ? Store.getTask(T.taskId) : null;
      if (task) {
        card.appendChild(el('div', { class: 'timer-task' }, [
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

      // 选择待办（只列顶层任务，子任务进父任务里做）
      var pending = Store.rootPending();
      if (pending.length) {
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
        card.appendChild(V.field('本次专注的待办', sel));
      }

      // 本次标签（用于按标签统计）
      var tagInput = V.tagInput(T.tags, {
        placeholder: '如 学习/英语（用于时间统计）'
      });
      tagInput.input.addEventListener('change', function () { T.tags = tagInput.getValue(); });
      tagInput.input.addEventListener('input', function () { T.tags = tagInput.getValue(); });
      card.appendChild(V.field('本次标签', tagInput, '结算后按此标签汇总专注时长'));

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
    var root = V.$('#view-pomodoro');
    if (!root) return;
    var timeEl = V.$('.cp-timer-time', root);
    var progEl = V.$('.cp-tr-prog', root);
    if (timeEl) timeEl.textContent = fmt(T.left);

    var total = T.total || T.duration * 60;
    if (progEl && total > 0) {
      var C = 2 * Math.PI * 84;
      var pct = 1 - Math.max(0, T.left) / total;
      progEl.setAttribute('stroke-dashoffset', (C * (1 - pct)).toFixed(2));
    }
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
    Store.saveTimer({ running: true, endAt: T.endAt, left: 0, duration: T.duration, taskId: T.taskId, tags: T.tags, treeId: T.treeId });
    startTick();
    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();
    UI.toast('开始专注 ' + T.duration + ' 分钟');
  }

  function pause() {
    T.running = false;
    stopTick();
    if (global.WhiteNoise) WhiteNoise.stop();
    Store.saveTimer({ running: false, endAt: 0, left: Math.round(T.left), duration: T.duration, taskId: T.taskId, tags: T.tags, treeId: T.treeId });
    var v = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v && App.currentId === 'pomodoro') v.render();
    UI.toast('已暂停');
  }

  function resume() {
    T.endAt = Date.now() + T.left * 1000;
    T.running = true;
    Store.saveTimer({ running: true, endAt: T.endAt, left: 0, duration: T.duration, taskId: T.taskId, tags: T.tags, treeId: T.treeId });
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
          cancelText: '结束并让它枯'
        }).then(function (yes) {
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
        cancelText: '让它枯'
      }).then(function (yes) {
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
    Store.saveTimer({ running: false, endAt: 0, left: 0, duration: T.duration, taskId: '', tags: T.tags, treeId: '' });
    T.left = T.duration * 60;
    T.total = T.duration * 60;
    var v0 = App.views.filter(function (x) { return x.id === 'pomodoro'; })[0];
    if (v0 && App.currentId === 'pomodoro') v0.render();
    UI.toast('不足 1 分钟，本次不计分');
  }

  function complete() {
    T.running = false;
    stopTick();
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

    var onPage = App.currentId === 'pomodoro';
    if (gain <= 0) {
      UI.toast('专注不足 ' + POMO.FOCUS_MIN_MIN + ' 分钟，本次不计分' + (Store.pomodoro.mode === 'forest' ? '，本次树苗枯萎' : ''));
      return;
    }
    if (!onPage) {
      UI.toast('专注完成，获得 ' + gainTxt);
      return;
    }
    if (task && task.status !== 'done') {
      setTimeout(function () {
        V.confirm({
          title: '专注完成',
          message: '本次专注 ' + minutes + ' 分钟，获得 ' + gainTxt + '。\n要把「' + task.title + '」标记为完成吗？（额外 +' + POMO.TASK_DONE + ' 分）',
          okText: '标记完成', cancelText: '先不了'
        }).then(function (ok) {
          if (ok) {
            Store.updateTask(taskId, { status: 'done' });
            bumpScore();
            UI.toast('已完成待办，+' + POMO.TASK_DONE + ' 分');
            if (v && App.currentId === 'pomodoro') v.render();
          }
        });
      }, 400);
    } else {
      UI.toast('专注完成，获得 ' + gainTxt);
    }
  }

  /** 页面刷新后恢复计时 */
  function restoreTimer() {
    var t = Store.pomodoro.timer;
    if (!t) return;
    T.duration = t.duration || 45;
    T.taskId = t.taskId || '';
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

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


