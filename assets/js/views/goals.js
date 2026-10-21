/* ==========================================================
 * 目标（计划页的第二个分页）
 * ----------------------------------------------------------
 * 一个目标 = 一句「想变成什么样」+ 2–4 条关键结果（KR）。
 * 每条 KR 只回答一个问题：到某个时间点，用什么数字证明它成了。
 *
 * 刻意的取舍（与路线图决策一致）：
 * - 进度等权平均，不做权重：个人场景里权重基本靠拍脑袋。
 * - 没有可统计数据的 KR 不进分母：刚建好就显示 0% 会让人不想再打开。
 * - 到期不删除、不扣分，只是挪到「已归档」，进度按周期冻结。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var ICON = (V.icons && (V.icons.target || V.icons.flag)) || [];

  function todayStr() { return DateUtil.toStr(DateUtil.today()); }

  function daysBetween(a, b) {
    var d1 = DateUtil.parse(a), d2 = DateUtil.parse(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  }

  function kindOf(key) {
    var list = Store.KR_KINDS || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[list.length - 1];
  }

  function fmtNum(n) {
    var v = Number(n) || 0;
    return String(Math.round(v * 10) / 10);
  }

  /* ==========================================================
   * 卡片
   * ========================================================== */
  function krRow(g, kr, row) {
    var node = el('div', { class: 'goal-kr' });
    var left = el('div', { class: 'goal-kr-main' }, [
      el('span', { class: 'goal-kr-dot', style: { background: kr.kind === 'manual' ? 'var(--text-3)' : 'var(--primary)' } }),
      el('span', { class: 'goal-kr-title', text: kr.title })
    ]);
    node.appendChild(left);

    var right = el('div', { class: 'goal-kr-val' });
    if (row.missing) {
      right.appendChild(el('span', { class: 'goal-kr-warn', text: '绑定的计划已删除' }));
    } else if (row.empty) {
      right.appendChild(el('span', { class: 'goal-kr-warn', text: '周期内还没有待办' }));
    } else if (row.pct == null) {
      right.appendChild(el('span', { class: 'goal-kr-warn', text: '未填' }));
    } else {
      right.appendChild(el('span', {
        class: 'goal-kr-count',
        text: fmtNum(row.value) + '/' + fmtNum(row.target) + (row.unit ? ' ' + row.unit : '')
      }));
      right.appendChild(el('span', {
        class: 'chip' + (row.pct >= 1 ? ' chip-green' : ''),
        text: Math.round(row.pct * 100) + '%'
      }));
    }
    node.appendChild(right);

    // 自己填的 KR：点一下就能改数字，不用进编辑弹窗
    if (kr.kind === 'manual') {
      node.classList.add('cp-is-manual');
      node.title = '点一下填当前值';
      node.addEventListener('click', function () { quickFill(g, kr); });
    }
    return node;
  }

  function goalCard(g, archived) {
    var pg = Store.goalProgressOf(g);
    var today = todayStr();
    var left = daysBetween(today, g.endDate);
    var overdue = Store.goalsArchived().indexOf(g) >= 0 && !g.archivedAt;

    var card = el('div', {
      class: 'card plan-card goal-card' + (archived ? ' is-archived' : ''),
      dataset: { id: g.id, rec: 'goal:' + g.id }
    });

    /* 标题行 */
    var chip = g.archivedAt
      ? el('span', { class: 'chip', text: '已归档' })
      : (overdue ? el('span', { class: 'chip chip-amber', text: '已到期' }) : null);

    card.appendChild(el('div', { class: 'plan-top' }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { class: 'plan-title', text: g.title }),
        g.note ? el('div', { class: 'goal-note', text: g.note }) : null
      ]),
      chip
    ]));

    /* 进度条 */
    card.appendChild(el('div', { class: 'plan-bar' }, [
      el('i', { style: { width: pg.pct + '%' } })
    ]));

    /* 关键结果 */
    var krBox = el('div', { class: 'goal-krs' });
    if (!pg.rows.length) {
      krBox.appendChild(el('div', { class: 'goal-empty-kr', text: '还没有关键结果，编辑目标补一条。' }));
    } else {
      pg.rows.forEach(function (row) {
        var kr = (g.krs || []).filter(function (k) { return k.id === row.id; })[0] || {};
        krBox.appendChild(krRow(g, kr, row));
      });
    }
    card.appendChild(krBox);

    /* 底部：整体进度 + 周期 */
    var foot = el('div', { class: 'plan-foot', style: { marginTop: '10px' } }, [
      el('span', { class: 'plan-num', text: pg.pct + '%' }),
      el('span', {
        text: '总进度' + (pg.counted ? '（' + pg.counted + '/' + pg.total + ' 条可统计）' : '（暂无可统计的关键结果）')
      }),
      el('span', {
        style: { marginLeft: 'auto', color: 'var(--text-3)' },
        text: archived ? (g.endDate + ' 截止')
          : (left >= 0 ? '还剩 ' + left + ' 天' : '已过期')
      })
    ]);
    card.appendChild(foot);

    /* 操作 */
    var acts = el('div', { class: 'plan-foot', style: { marginTop: '8px', gap: '8px' } });
    if (!archived) {
      acts.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: function () { openGoalDialog(g.id); }
      }, [V.svg(V.icons.pen, 14), '编辑']));
      acts.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: function () { archive(g); }
      }, ['归档']));
    } else {
      acts.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: function () { Store.archiveGoal(g.id, false); V.toast('已恢复到在办'); renderPane(); }
      }, ['恢复']));
      acts.appendChild(el('button', {
        class: 'btn btn-sm btn-danger',
        onclick: function () { remove(g); }
      }, [V.svg(V.icons.trash, 14), '删除']));
    }
    card.appendChild(acts);
    return card;
  }

  function archive(g) {
    V.confirm({
      title: '归档这个目标？',
      message: '归档不会删除任何数据，进度会按目标周期停住，之后还能在「已归档」里找到并恢复。没达成就没达成，不算失败。',
      okText: '归档'
    }).then(function (ok) {
      if (!ok) return;
      Store.archiveGoal(g.id, true);
      V.toast('已归档');
      renderPane();
    });
  }

  function remove(g) {
    V.confirm({
      title: '删除这个目标？',
      message: '只删目标本身，它引用的计划、待办都不动。',
      danger: true, okText: '删除'
    }).then(function (ok) {
      if (!ok) return;
      Store.removeGoal(g.id);
      V.toast('已删除');
      renderPane();
    });
  }

  /* ==========================================================
   * 月末复盘
   * ========================================================== */
  function reviewCard() {
    var today = todayStr();
    if (!Store.goalReviewDue(Store.state.settings, today)) return null;
    var active = Store.goalsActive();
    if (!active.length) return null;

    var lines = active.map(function (g) {
      return { title: g.title, pct: Store.goalProgressOf(g).pct };
    });
    var text = Store.goalReviewText(lines, today);

    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '12px' } }, [
      el('div', { class: 'section-title' }, ['月末了，回顾一下']),
      el('div', { class: 'goal-note', text: '这个月几个目标推进得怎么样？点「写进日记」会把下面的数字填进今天的日记，剩下的交给你自己写。' }),
      el('pre', {
        style: {
          margin: '10px 0 12px', padding: '10px 12px', background: 'var(--surface-2)',
          border: '1px solid var(--line)', borderRadius: '8px',
          fontSize: '12.5px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: '1.8'
        },
        text: text
      })
    ]);

    var row = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    row.appendChild(el('button', {
      class: 'btn btn-primary',
      onclick: function () {
        if (!global.DiaryPane) return;
        DiaryPane.appendPlain(text, today, function () {
          // 写完跳到日记分页，正好接着往下写
          if (global.App) App.go('tasks', { tab: 'diary' });
        });
      }
    }, [V.svg(V.icons.book, 16), '写进今天的日记']));
    row.appendChild(el('button', {
      class: 'btn',
      onclick: function () {
        Store.state.settings.goals.reviewDismissed = today.slice(0, 7);
        Store.save();
        V.toast('这个月不再提醒');
        renderPane();
      }
    }, ['这个月不再提醒']));
    card.appendChild(row);
    return card;
  }

  /* ==========================================================
   * 分页渲染
   * ========================================================== */
  var HOST = null;

  function renderPane() {
    if (HOST) GoalsPane.render(HOST);
  }

  var GoalsPane = {
    render: function (host) {
      HOST = host;
      host.innerHTML = '';

      var active = Store.goalsActive();
      var archived = Store.goalsArchived();
      var avg = active.length
        ? Math.round(active.reduce(function (s, g) { return s + Store.goalProgressOf(g).pct; }, 0) / active.length)
        : 0;
      var krTotal = active.reduce(function (s, g) { return s + (g.krs || []).length; }, 0);

      host.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(active.length + '/' + Store.GOAL_MAX_ACTIVE, '在办目标', 'var(--primary)'),
        V.statCard(avg + '%', '平均进度', 'var(--green)'),
        V.statCard(krTotal, '关键结果', 'var(--amber)'),
        V.statCard(archived.length, '已归档', 'var(--text-2)')
      ]));

      var rc = reviewCard();
      if (rc) host.appendChild(rc);

      if (!active.length) {
        host.appendChild(V.empty(ICON, '还没有在办的目标',
          '目标不是待办清单：先写一句「想变成什么样」，再补 2–4 条能算出结果的数字。',
          el('button', {
            class: 'btn btn-primary',
            onclick: function () { openGoalDialog(); }
          }, [V.svg(V.icons.plus, 16), '新建目标'])));
      } else {
        active.forEach(function (g) { host.appendChild(goalCard(g, false)); });
      }

      if (archived.length) {
        var box = el('div', { class: 'card goal-archive', style: { padding: '12px 14px' } });
        var open = false;
        var body = el('div', {});
        var head = el('button', {
          class: 'btn btn-sm',
          style: { width: '100%', justifyContent: 'space-between' },
          onclick: function () {
            open = !open;
            body.style.display = open ? '' : 'none';
            this.textContent = (open ? '收起已归档（' : '已归档（') + archived.length + (open ? '）' : '）');
          }
        }, ['已归档（' + archived.length + '）']);
        body.style.display = 'none';
        archived.forEach(function (g) { body.appendChild(goalCard(g, true)); });
        box.appendChild(head);
        box.appendChild(body);
        host.appendChild(box);
      }

      if (active.length) {
        host.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.8' },
          text: '同时在办最多 ' + Store.GOAL_MAX_ACTIVE + ' 个目标——目标页最大的失败形态不是功能少，是变成一张谁也不看的表。'
        }));
      }
    }
  };

  /* ==========================================================
   * 快速填写（自己填的 KR）
   * ========================================================== */
  function quickFill(g, kr) {
    var f = V.input({
      type: 'number', step: '0.5', min: '0',
      value: String(kr.current || 0)
    });
    var m;
    m = V.modal({
      title: '填一个数',
      body: [
        el('div', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
          text: kr.title + '（目标 ' + fmtNum(kr.target) + (kr.unit ? ' ' + kr.unit : '') + '）'
        }),
        V.field('当前值', f, '出了结果就填进来；没出结果就留 0')
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            var v = Math.max(0, parseFloat(f.value) || 0);
            var krs = (g.krs || []).map(function (k) {
              return k.id === kr.id ? Object.assign({}, k, { current: v }) : k;
            });
            Store.updateGoal(g.id, { krs: krs });
            V.toast('已更新');
            m.close();
            renderPane();
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 新建 / 编辑弹窗
   * ========================================================== */
  function termRange() {
    var sem = Store.semester;
    var start = Store.weekStartDate(1) || DateUtil.today();
    var end = DateUtil.addDays(Store.weekStartDate(sem.weeks || 18), 6);
    return { start: DateUtil.toStr(start), end: DateUtil.toStr(end) };
  }

  function openGoalDialog(id) {
    var origin = id ? Store.getGoal(id) : null;
    if (!origin && !Store.canAddGoal()) {
      V.toast('在办目标已经有 ' + Store.GOAL_MAX_ACTIVE + ' 个了，先归档一个', 'err');
      return;
    }

    var tr = termRange();
    var draft = {
      title: origin ? origin.title : '',
      note: origin ? origin.note : '',
      period: origin ? origin.period : 'term',
      startDate: origin ? origin.startDate : tr.start,
      endDate: origin ? origin.endDate : tr.end,
      krs: origin ? origin.krs.map(function (k) { return Object.assign({}, k); }) : []
    };
    if (!draft.krs.length) draft.krs.push({ title: '', kind: 'manual', target: 100, current: 0, unit: '' });

    var fTitle = V.input({ placeholder: '例如：这学期把高数补上来', value: draft.title });
    var fNote = V.input({ placeholder: '选填：为什么要做这件事', value: draft.note });
    var fStart = V.input({ type: 'date', value: draft.startDate });
    var fEnd = V.input({ type: 'date', value: draft.endDate });
    var krBox = el('div', { class: 'goal-kr-edit' });
    var periodSeg = el('div', {});

    function drawPeriod() {
      periodSeg.innerHTML = '';
      periodSeg.appendChild(V.segment([
        { value: 'term', label: '本学期' },
        { value: 'custom', label: '自定义' }
      ], draft.period, function (v) {
        draft.period = v;
        if (v === 'term') {
          draft.startDate = tr.start;
          draft.endDate = tr.end;
          fStart.value = tr.start;
          fEnd.value = tr.end;
        }
        drawPeriod();
      }));
    }
    drawPeriod();

    /* ---- KR 编辑行 ---- */
    function drawKrs() {
      krBox.innerHTML = '';
      draft.krs.forEach(function (kr, i) {
        var row = el('div', { class: 'goal-kr-edit-row' });

        var fKrTitle = V.input({
          placeholder: '关键结果，例如：每周自习 5 天', value: kr.title,
          oninput: function () { kr.title = this.value; }
        });
        row.appendChild(V.field('第 ' + (i + 1) + ' 条', fKrTitle));

        var fKind = V.select(Store.KR_KINDS.map(function (k) {
          return { value: k.key, label: k.name };
        }), kr.kind);
        fKind.addEventListener('change', function () {
          kr.kind = fKind.value;
          if (kr.kind === 'manual' && !kr.target) kr.target = 100;
          drawKrs();
        });
        row.appendChild(V.field('怎么衡量', fKind, kindOf(kr.kind).desc));

        if (kr.kind === 'plan') {
          var plans = Store.plans.slice().sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
          var opts = [{ value: '', label: plans.length ? '选择一条计划…' : '还没有计划，先去「计划」里建一条' }]
            .concat(plans.map(function (p) { return { value: p.id, label: p.title }; }));
          var fPlan = V.select(opts, kr.planId || '');
          fPlan.addEventListener('change', function () { kr.planId = fPlan.value; });
          row.appendChild(V.field('绑定计划', fPlan, '只统计目标周期内的打卡'));
        } else if (kr.kind === 'task') {
          var fTags = V.input({
            placeholder: '标签，空格分隔（留空 = 全部）',
            value: (kr.tags || []).join(' '),
            oninput: function () {
              kr.tags = this.value.split(/[\s,，、]+/).filter(function (x) { return x; }).slice(0, 6);
            }
          });
          row.appendChild(V.field('按标签圈定', fTags, '任一标签命中就算；统计周期内有截止日期的顶层待办'));

          var courses = Store.courses || [];
          var cOpts = [{ value: '', label: '不限课程' }].concat(courses.map(function (c) {
            return { value: c.id, label: c.name };
          }));
          var fCourse = V.select(cOpts, kr.courseId || '');
          fCourse.addEventListener('change', function () { kr.courseId = fCourse.value; });
          row.appendChild(V.field('限定课程（可选）', fCourse));
        } else {
          var fTarget = V.input({
            type: 'number', step: '0.5', min: '1', value: String(kr.target || 1),
            oninput: function () { kr.target = Math.max(1, parseFloat(this.value) || 1); }
          });
          var fUnit = V.input({
            placeholder: '分 / 篇 / 次', value: kr.unit || '',
            oninput: function () { kr.unit = this.value; }
          });
          var fCur = V.input({
            type: 'number', step: '0.5', min: '0', value: String(kr.current || 0),
            oninput: function () { kr.current = Math.max(0, parseFloat(this.value) || 0); }
          });
          row.appendChild(V.field('目标值 / 单位', el('div', { style: { display: 'flex', gap: '8px' } }, [fTarget, fUnit])));
          row.appendChild(V.field('当前值', fCur, '之后也能在卡片上直接点开填'));
        }

        if (draft.krs.length > 1) {
          row.appendChild(el('div', { style: { textAlign: 'right' } }, [
            el('button', {
              class: 'btn btn-sm',
              onclick: function () {
                draft.krs = draft.krs.filter(function (x) { return x !== kr; });
                drawKrs();
              }
            }, ['删掉这条'])
          ]));
        }
        krBox.appendChild(row);
      });

      if (draft.krs.length < 4) {
        krBox.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            draft.krs.push({ title: '', kind: 'manual', target: 100, current: 0, unit: '' });
            drawKrs();
          }
        }, [V.svg(V.icons.plus, 14), '添加关键结果']));
      }
    }
    drawKrs();

    var m;
    m = V.modal({
      title: origin ? '编辑目标' : '新建目标',
      width: '620px',
      body: [
        V.field('目标', fTitle, '一句话说清「想变成什么样」，不用写具体做什么'),
        V.field('周期', periodSeg, '只做「本学期」和「自定义」两种：日/周目标和计划、待办完全重叠'),
        el('div', { style: { display: 'flex', gap: '10px' } }, [
          el('div', { style: { flex: '1' } }, [V.field('开始', fStart)]),
          el('div', { style: { flex: '1' } }, [V.field('结束', fEnd)])
        ]),
        V.field('关键结果', krBox, '每条只回答一个问题：到那时候，用什么数字证明它成了'),
        V.field('备注', fNote),
        el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', lineHeight: '1.75' },
          text: '总进度 = 各条关键结果的等权平均；没有数据的（比如期中还没考）先不计入。到期不会删除，只是归档留档。'
        })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            var title = fTitle.value.trim();
            if (!title) { V.toast('先写一句目标', 'err'); fTitle.focus(); return; }
            var start = fStart.value || draft.startDate;
            var end = fEnd.value || draft.endDate;
            if (end < start) { V.toast('结束日期不能早于开始日期', 'err'); return; }
            var krs = draft.krs.filter(function (k) { return String(k.title || '').trim(); });
            if (!krs.length) { V.toast('至少写一条关键结果，否则没法算进度', 'err'); return; }
            krs = krs.map(function (k, i) {
              return Object.assign({}, k, { title: k.title.trim(), id: k.id || ('kr_' + Date.now() + '_' + i) });
            });
            var data = {
              title: title, note: fNote.value.trim(),
              period: draft.period, startDate: start, endDate: end, krs: krs
            };
            if (origin) { Store.updateGoal(origin.id, data); V.toast('已更新'); }
            else { Store.addGoal(data); V.toast('目标已创建'); }
            m.close();
            renderPane();
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 导出
   * ========================================================== */
  GoalsPane.open = openGoalDialog;
  GoalsPane.focusRecord = function (type, id) {
    if (type !== 'goal') return false;
    var g = Store.getGoal(id);
    if (!g) return false;
    var node = HOST ? HOST.querySelector('[data-rec="goal:' + id + '"]') : null;
    // 归档里的目标默认折叠：先展开再定位
    if (!node && HOST) {
      var head = HOST.querySelector('.goal-archive .btn');
      if (head) head.click();
      node = HOST.querySelector('[data-rec="goal:' + id + '"]');
    }
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (node) {
      node.classList.add('goal-flash');
      setTimeout(function () { node.classList.remove('goal-flash'); }, 1200);
    }
    return !!node;
  };

  global.GoalsPane = GoalsPane;
  global.openGoalDialog = openGoalDialog;
})(window);
