

/* ==========================================================
 * 视图：计划（打卡 / 进度 / 时长）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var state = { status: 'running', tag: '' };
  var justDoneId = '';

  var COLORS = ['#4f46e5', '#0ea5e9', '#14b8a6', '#12b76a', '#e8930c', '#f04438', '#ec4899', '#7c3aed'];

  function fmtNum(n) {
    return String(Math.round(n * 100) / 100);
  }

  var view = {
    id: 'plans',
    name: '计划',
    icon: V.icons.flag,
    title: '我的计划',
    order: 24,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { openPlanDialog(); }
      }, [V.svg(V.icons.plus, 16), '新建计划']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-plans' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      var st = Store.planStats();

      /* ---------- 概览 ---------- */
      root.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(st.running, '进行中', 'var(--primary)'),
        V.statCard(st.todayPending, '今日待打卡', 'var(--amber)'),
        V.statCard(st.finished, '已完成', 'var(--green)'),
        V.statCard(st.total, '全部计划', 'var(--text-2)')
      ]));

      root.appendChild(el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '7px',
          fontSize: '11.5px', color: 'var(--text-3)', margin: '-6px 0 10px'
        }
      }, [
        V.svg(V.icons.tree, 14),
        el('span', {
          text: '每次打卡 +' + POMO.PLAN_CHECKIN + ' 分，完成一个计划 +' + POMO.PLAN_DONE +
                ' 分 · 可用积分 ' + Store.pomodoro.points
        })
      ]));

      /* ---------- 筛选 ---------- */
      var tabBar = el('div', { class: 'filter-bar' }, [
        { v: 'running', n: '进行中' },
        { v: 'done', n: '已完成' },
        { v: 'all', n: '全部' }
      ].map(function (o) {
        return el('button', {
          class: 'filter-tab' + (state.status === o.v ? ' active' : ''),
          text: o.n,
          onclick: function () { state.status = o.v; view.render(); }
        });
      }));
      root.appendChild(tabBar);

      var tagFilter = V.tagFilter(state.tag, function (v) {
        state.tag = v;
        view.render();
      }, ['plan']);
      if (tagFilter) root.appendChild(tagFilter);

      /* ---------- 列表 ---------- */
      var list = Store.plans.filter(function (p) {
        if (state.status === 'running' && p.done) return false;
        if (state.status === 'done' && !p.done) return false;
        if (state.tag && !hasTag(p.tags, state.tag)) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (!!a.important !== !!b.important) return a.important ? -1 : 1;
        return 0;
      });

      if (!list.length) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.flag, state.tag ? '没有匹配的计划' : '还没有计划',
            state.tag ? '换个标签试试。'
              : '新建一个计划，比如「21 天早起打卡」「读完 3 本书」「本月专注 600 分钟」，用打卡或进度条追踪它。',
            el('button', {
              class: 'btn btn-primary',
              onclick: function () { openPlanDialog(); }
            }, ['新建计划']))
        ]));
        return;
      }

      var wrap = el('div', { class: 'plan-list' });
      list.forEach(function (p) { wrap.appendChild(planCard(p, view)); });
      root.appendChild(wrap);
    }
  };

  /* ==========================================================
   * 计划卡片
   * ========================================================== */
  function planCard(p, view) {
    var pg = Store.planProgress(p);
    var today = DateUtil.toStr(DateUtil.today());
    var doneToday = Store.planDoneToday(p);
    var isCheckin = p.type === 'checkin';

    var card = el('div', {
      class: 'card plan-card' + (p.done ? ' is-done' : '') + (p.id === justDoneId ? ' plan-win' : ''),
      style: { '--pl-c': p.color },
      dataset: { id: p.id, rec: 'plan:' + p.id }   // rec 供全局搜索跳转定位
    });

    /* ---- 标题行 ---- */
    var top = el('div', { class: 'plan-top' }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { class: 'plan-title', text: p.title }),
        el('div', { class: 'plan-meta' }, [
          el('span', { text: PLAN_TYPES[p.type].name + ' · ' + PLAN_PERIODS[p.period].name }),
          p.startDate ? el('span', { text: '始于 ' + p.startDate.slice(5) }) : null,
          Store.planStreak(p) >= 2 ? el('span', {
            class: 'chip chip-amber', text: '连续 ' + Store.planStreak(p) + ' 天'
          }) : null
        ].concat(V.tagChips(p.tags)))
      ]),
      p.done ? el('span', { class: 'chip chip-green', text: '已完成' }) : null
    ]);
    top.addEventListener('click', function (e) {
      if (e.target.closest('.plan-check-btn')) return;
      openDetail(p, view);
    });
    card.appendChild(top);

    /* ---- 进度条 ---- */
    card.appendChild(el('div', { class: 'plan-bar' }, [
      el('i', { style: { width: pg.pct + '%' } })
    ]));

    var unit = p.unit ? ' ' + p.unit : '';
    card.appendChild(el('div', { class: 'plan-foot' }, [
      el('span', { class: 'plan-num', text: fmtNum(pg.value) }),
      el('span', { text: '/ ' + fmtNum(pg.target) + unit }),
      el('span', { style: { marginLeft: 'auto', fontWeight: '600', color: p.done ? 'var(--green)' : 'var(--text-2)' }, text: pg.pct + '%' }),
      (!p.done && pg.remain > 0) ? el('span', { style: { color: 'var(--text-3)' }, text: '还差 ' + fmtNum(pg.remain) + unit }) : null
    ]));

    /* ---- 打卡格子 ---- */
    if (isCheckin && p.period !== 'once') {
      var slots = Store.planSlots(p);
      card.appendChild(el('div', { class: 'plan-grid len-' + (slots.length <= 7 ? 7 : slots.length <= 21 ? 21 : 30) },
        slots.map(function (ds) {
          var rec = Store.planRecordOfDate(p, ds);
          return el('div', {
            class: 'plan-cell' + (rec ? ' on' : '') + (ds === today ? ' today' : '') + (ds > today ? ' future' : ''),
            title: ds + (rec ? ' 已打卡' : ' 未打卡'),
            onclick: function (e) {
              e.stopPropagation();
              checkinWithAnim(p.id, ds, view, card);
            }
          });
        })));
    }

    /* ---- 操作 ---- */
    if (!p.done) {
      var row = el('div', { class: 'plan-foot', style: { marginTop: '11px' } });
      if (isCheckin) {
        row.appendChild(el('button', {
          class: 'plan-check-btn' + (doneToday ? ' on' : ''),
          onclick: function (e) {
            e.stopPropagation();
            checkinWithAnim(p.id, today, view, card);
          }
        }, [doneToday ? '今日已打卡 ✓' : '今日打卡']));
      } else {
        row.appendChild(el('button', {
          class: 'plan-check-btn',
          onclick: function (e) { e.stopPropagation(); openAddValueDialog(p, view); }
        }, ['+ 记一笔' + (p.type === 'duration' ? '时长' : '进度')]));
      }
      card.appendChild(row);
    }

    return card;
  }

  function checkinWithAnim(id, dateStr, view, card) {
    var res = Store.togglePlanCheckin(id, dateStr);
    if (!res) return;

    if (res.completed) {
      justDoneId = id;
      // 完成后切到「全部」，让卡片留在视野里展示完成态
      state.status = 'all';
      V.toast('计划完成！+' + (res.gain || 0) + ' 积分');
    } else if (res.gain) {
      V.toast('打卡成功，+' + res.gain + ' 积分');
    }
    view.render();

    if (res.completed) {
      var node = V.$('.cp-plan-card[data-id="' + id + '"]', view.root);
      if (node) {
        celebrate(node);
        if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    setTimeout(function () { justDoneId = ''; }, 1200);
  }

  /** 完成撒花：从卡片底部弹出几个小圆点 */
  function celebrate(card) {
    var host = card;
    if (!host) return;
    var layer = el('div', { class: 'celebrate' });
    var colors = ['#12b76a', '#4f46e5', '#f59e0b', '#ec4899', '#0ea5e9'];
    for (var i = 0; i < 12; i++) {
      var d = el('i', { style: { background: colors[i % colors.length] } });
      d.style.left = (10 + Math.random() * 80) + '%';
      d.style.animationDelay = (Math.random() * 0.25).toFixed(2) + 's';
      d.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(0) + 'px');
      layer.appendChild(d);
    }
    host.appendChild(layer);
    setTimeout(function () { if (layer.parentNode) layer.remove(); }, 1400);
  }

  /* ==========================================================
   * 详情：记录明细
   * ========================================================== */
  function openDetail(p, view) {
    var pg = Store.planProgress(p);
    var m;
    var body = el('div', {});

    body.appendChild(el('div', { class: 'preview-box' }, [
      el('div', { text: '进度：' + fmtNum(pg.value) + ' / ' + fmtNum(pg.target) + (p.unit ? ' ' + p.unit : '') + '（' + pg.pct + '%）' }),
      el('div', { text: '类型：' + PLAN_TYPES[p.type].name + ' · ' + PLAN_PERIODS[p.period].name }),
      el('div', { text: '开始：' + p.startDate }),
      Store.planStreak(p) ? el('div', { text: '连续打卡：' + Store.planStreak(p) + ' 天' }) : null,
      p.note ? el('div', { text: '备注：' + p.note }) : null,
      p.tags && p.tags.length ? el('div', { class: 'plan-meta', style: { marginTop: '6px' } }, V.tagChips(p.tags)) : null
    ]));

    if (p.records.length) {
      body.appendChild(el('div', { class: 'section-title', style: { marginTop: '14px' } }, [
        '记录明细', el('span', { class: 'q-count', text: p.records.length + ' 条' })
      ]));
      var list = el('div', { class: 'rec-list' });
      p.records.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (r) {
        list.appendChild(el('div', { class: 'rec-row' }, [
          el('span', { class: 'rec-main' }, [
            el('b', { text: r.date }),
            r.note ? el('span', { text: r.note }) : null
          ]),
          el('span', { class: 'rec-val' }, [el('em', { text: '+' + fmtNum(r.value) })]),
          el('button', {
            class: 'icon-btn',
            onclick: function () { Store.removePlanRecord(p.id, r.at); openDetailRefresh(p, view, m); }
          }, [V.svg(V.icons.close, 14)])
        ]));
      });
      body.appendChild(list);
    }

    function openDetailRefresh(plan, v, modal) {
      modal.close();
      setTimeout(function () { openDetail(Store.getPlan(plan.id), v); }, 180);
    }

    m = V.modal({
      title: p.title,
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', {
          class: 'btn btn-danger',
          onclick: function () {
            m.close();
            setTimeout(function () {
              V.confirm({ title: '删除计划', message: '确定删除「' + p.title + '」吗？记录会一并消失。', danger: true, okText: '删除' })
                .then(function (ok) { if (ok) { Store.removePlan(p.id); V.toast('已删除'); } });
            }, 200);
          }
        }, ['删除']),
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '编辑',
          onclick: function () { m.close(); setTimeout(function () { openPlanDialog(p.id); }, 180); }
        })
      ])
    });
  }

  /* ==========================================================
   * 累加型：记一笔
   * ========================================================== */
  function openAddValueDialog(p, view) {
    var unit = p.unit || (p.type === 'duration' ? '分钟' : '');
    var fVal = V.input({
      type: 'number', step: '0.5', min: '0',
      placeholder: p.type === 'duration' ? '例如 50' : '例如 20',
      style: 'font-size:18px;height:44px;font-weight:600'
    });
    var fNote = V.input({ placeholder: '备注（可选）' });
    var fDate = V.input({ type: 'date', value: DateUtil.toStr(DateUtil.today()) });

    var m;
    m = V.modal({
      title: '记一笔 · ' + p.title,
      body: [
        V.field('数量' + (unit ? '（' + unit + '）' : ''), fVal),
        V.field('备注', fNote),
        V.field('日期', fDate)
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '记录',
          onclick: function () {
            var res = Store.addPlanValue(p.id, parseFloat(fVal.value), fNote.value, fDate.value);
            if (!res) { V.toast('请填写大于 0 的数值', 'err'); return; }
            m.close();
            if (res.completed) {
              justDoneId = p.id;
              state.status = 'all';
              V.toast('计划完成！+' + (res.gain || 0) + ' 积分');
            } else {
              V.toast('已记录，+' + (res.gain || 0) + ' 积分');
            }
            view.render();
            if (res.completed) {
              var node = V.$('.cp-plan-card[data-id="' + p.id + '"]', view.root);
              if (node) celebrate(node);
            }
            setTimeout(function () { justDoneId = ''; }, 1200);
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 新建 / 编辑
   * ========================================================== */
  function openPlanDialog(id) {
    var p = id ? Store.getPlan(id) : null;
    var type = p ? p.type : 'checkin';
    var period = p ? p.period : 'daily';
    var color = p ? p.color : COLORS[0];

    var fTitle = V.input({ placeholder: '例如：21 天早起打卡', value: p ? p.title : '' });
    var fNote = V.input({ placeholder: '选填', value: p ? p.note : '' });
    var fTags = V.tagInput(p ? (p.tags || []).join(',') : '');
    var fStart = V.input({ type: 'date', value: p ? p.startDate : DateUtil.toStr(DateUtil.today()) });
    var fDays = V.input({ type: 'number', min: '1', max: '365', value: p ? String(p.days) : '21' });
    var fTarget = V.input({
      type: 'number', step: '0.5', min: '1',
      value: p ? String(p.target) : (type === 'duration' ? '600' : '100')
    });
    var fUnit = V.input({ placeholder: '页 / 章 / 个', value: p ? p.unit : '' });

    var impOn = p ? !!p.important : false;
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

    var colorBox = el('div', { class: 'theme-grid' });
    function drawColors() {
      colorBox.innerHTML = '';
      COLORS.forEach(function (c) {
        colorBox.appendChild(el('button', {
          class: 'theme-swatch' + (color === c ? ' active' : ''),
          style: { '--c': c },
          onclick: function () { color = c; drawColors(); }
        }));
      });
    }
    drawColors();

    /* 随类型切换显示的表单区 */
    var optBox = el('div', {});
    function drawOpts() {
      optBox.innerHTML = '';
      if (type === 'checkin') {
        optBox.appendChild(V.field('周期', V.segment([
          { value: 'daily', label: '每天' },
          { value: 'weekly', label: '每周' },
          { value: 'once', label: '单次' }
        ], period, function (v) { period = v; drawOpts(); })));
        if (period !== 'once') optBox.appendChild(V.field('计划天数', fDays, '总目标就是这么多次'));
        else optBox.appendChild(V.field('', el('div', {
          style: { fontSize: '12.5px', color: 'var(--text-3)' }, text: '单次计划：完成一次打卡即达成。'
        })));
      } else {
        optBox.appendChild(V.field('目标值', fTarget, type === 'duration' ? '累计多少分钟算完成' : '累计多少算完成'));
        optBox.appendChild(V.field('单位', fUnit, '比如：页、章、个、分钟'));
      }
    }
    drawOpts();

    var typeSeg = V.segment([
      { value: 'checkin', label: '打卡' },
      { value: 'progress', label: '进度' },
      { value: 'duration', label: '时长' }
    ], type, function (v) {
      type = v;
      if (type === 'duration') fUnit.value = fUnit.value || '分钟';
      if (type === 'progress') fTarget.value = fTarget.value === '600' ? '100' : fTarget.value;
      drawOpts();
    });

    var m;
    m = V.modal({
      title: p ? '编辑计划' : '新建计划',
      body: [
        V.field('计划名称', fTitle),
        V.field('类型', typeSeg, '打卡＝每天/每周打勾；进度＝累加数值；时长＝累计分钟'),
        optBox,
        V.field('开始日期', fStart),
        V.field('重要日程', fImp, '标记后置顶，并在「今日」页显示倒计时'),
        V.field('备注', fNote),
        V.field('标签', fTags, '支持二级标签，如「学习/英语」'),
        V.field('颜色', colorBox),
        el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', lineHeight: '1.7', marginTop: '2px' },
          text: '完成后自动 +' + POMO.PLAN_DONE + ' 积分；每次打卡 +' + POMO.PLAN_CHECKIN + ' 积分，可用于种树。'
        })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            if (!fTitle.value.trim()) { V.toast('请填写计划名称', 'err'); fTitle.focus(); return; }
            var data = {
              title: fTitle.value.trim(),
              type: type, period: type === 'checkin' ? period : 'once',
              days: parseInt(fDays.value, 10) || 21,
              startDate: fStart.value,
              note: fNote.value, tags: fTags.getValue(),
              color: color, important: impOn
            };
            if (type !== 'checkin') {
              data.target = parseFloat(fTarget.value) || 1;
              data.unit = fUnit.value.trim() || (type === 'duration' ? '分钟' : '');
            }
            if (p) { Store.updatePlan(p.id, data); V.toast('已更新'); }
            else { Store.addPlan(data); V.toast('计划已创建'); }
            m.close();
            var v = App.views.filter(function (x) { return x.id === 'plans'; })[0];
            if (v && App.currentId === 'plans') v.render();
          }
        })
      ])
    });
  }

  global.openPlanDialog = openPlanDialog;

  // 计划列表有「进行中 / 已完成」筛选，跳转过来时先把筛选放宽
  view.focusRecord = function (type, id) {
    if (type !== 'plan' || !global.Search) return false;
    var p = Store.getPlan(id);
    var dirty = false;
    if (p && state.status !== 'all' && ((state.status === 'running') === !!p.done)) {
      state.status = 'all';
      dirty = true;
    }
    if (p && state.tag && !hasTag(p.tags, state.tag)) { state.tag = ''; dirty = true; }
    if (dirty) this.render();
    return Search.flash(Search.findRec(type, id));
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


