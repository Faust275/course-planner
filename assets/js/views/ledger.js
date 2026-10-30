

/* ==========================================================
 * 视图：记账（饮食消费自动入账）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 统计范围：day / week / month / recent30（见 store.js 的 LEDGER_RANGES） */
  var curRange = 'month';
  /** 构成统计维度：cat 分类 / tag 标签 */
  var dim = 'cat';
  /** 图表类型：pie 饼状图 / bar 方形图 */
  var chartType = 'pie';
  /** 明细的标签筛选 */
  var tagSel = '';

  function money(n) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    var neg = n < 0;
    var s = Math.abs(n).toFixed(2);
    if (s.slice(-3) === '.00') s = s.slice(0, -3);
    return (neg ? '-¥' : '¥') + s;
  }

  var view = {
    id: 'ledger',
    name: '记账',
    icon: V.icons.wallet,
    title: '记账',
    order: 26,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn',
        title: '导入 CSV / 微信 / 支付宝账单数据',
        onclick: function () { importLedgerDialog(); }
      }, [V.svg(V.icons.upload || V.icons.download, 16), '导入CSV']));
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () { budgetDialog(); }
      }, [V.svg(V.icons.wallet, 16), '预算']));
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () { reportDialog(); }
      }, [V.svg(V.icons.chart, 16), '报表']));
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { openEntryDialog(); }
      }, [V.svg(V.icons.plus, 16), '记一笔']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-ledger' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      var r = rangeDates(curRange);
      var st = Store.ledgerRange(r.from, r.to);
      var all = st.list;

      /* ---------- 概览（随范围） ---------- */
      root.appendChild(el('div', { class: 'task-summary three' }, [
        V.statCard(money(st.expense),
          RANGES[curRange].name + '支出', 'var(--red)'),
        V.statCard(money(st.income), '收入', 'var(--green)'),
        V.statCard(money(st.balance), '结余', st.balance < 0 ? 'var(--red)' : 'var(--primary)', 'is-big')
      ]));

      /* ---------- 当月预算 ---------- */
      root.appendChild(budgetCard());

      /* ---------- 吃饭的钱（近 30 天，有记录才出现） ---------- */
      var foodK = foodCard();
      if (foodK) root.appendChild(foodK);

      /* ---------- 范围切换 ---------- */
      var bar = el('div', { class: 'week-bar', style: { marginBottom: '12px' } }, [
        el('div', { class: 'week-label' }, [
          el('span', { text: RANGES[curRange].name + '账单' }),
          el('small', { text: r.from.slice(5) + ' – ' + r.to.slice(5) + ' · ' + all.length + ' 笔' })
        ]),
        V.rangeTabs(curRange, function (k) { curRange = k; tagSel = ''; view.render(); }, LEDGER_RANGES)
      ]);
      root.appendChild(bar);

      if (!all.length) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.wallet, '这段时间还没有账目',
            '换个时间范围看看，或点右上角「记一笔」/「导入CSV」。支持直接导入通用 CSV 表格、微信支付与支付宝导出的账单。',
            el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, [
              el('button', {
                class: 'btn',
                onclick: function () { importLedgerDialog(); }
              }, ['📥 导入 CSV 账单']),
              el('button', {
                class: 'btn btn-primary',
                onclick: function () { openEntryDialog(); }
              }, [V.svg(V.icons.plus, 16), '记一笔'])
            ]))
        ]));
        return;
      }

      /* ---------- 支出构成 ---------- */
      var cc = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
      var head = el('div', { class: 'section-title' }, ['支出构成']);
      head.appendChild(el('div', { class: 'dim-tabs' }, [
        { v: 'cat', n: '按分类' },
        { v: 'tag', n: '按标签' }
      ].map(function (o) {
        return el('button', {
          class: 'dim-tab' + (dim === o.v ? ' active' : ''),
          text: o.n,
          onclick: function () { dim = o.v; view.render(); }
        });
      })));
      cc.appendChild(head);

      // 图型切换
      cc.appendChild(el('div', { class: 'dim-tabs', style: { margin: '2px 0 12px' } }, [
        { v: 'pie', n: '饼状图' },
        { v: 'bar', n: '方形图' }
      ].map(function (o) {
        return el('button', {
          class: 'dim-tab' + (chartType === o.v ? ' active' : ''),
          text: o.n,
          onclick: function () { chartType = o.v; view.render(); }
        });
      })));

      var palette = ['#ef4444', '#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#14b8a6', '#ec4899', '#94a3b8'];
      var items = [];

      if (dim === 'cat') {
        var cats = Store.ledgerCatRange(r.from, r.to);
        items = cats.map(function (c, i) {
          return {
            label: c.cat.name, value: c.total,
            color: c.cat.color || palette[i % palette.length],
            key: c.key
          };
        });
      } else {
        // 一级标签汇总（饼图），二级在下方列表
        var flat = Store.ledgerTagRange(r.from, r.to);
        var groups = {}, order = [];
        flat.forEach(function (t) {
          if (!groups[t.lv1]) { groups[t.lv1] = { total: 0, children: [] }; order.push(t.lv1); }
          groups[t.lv1].total += t.amount;
          if (t.lv2) groups[t.lv1].children.push(t);
        });
        order.sort(function (a, b) { return groups[b].total - groups[a].total; });
        items = order.map(function (k, i) {
          return {
            label: k, value: Math.round(groups[k].total * 100) / 100,
            color: Store.tagColor(k) || palette[i % palette.length], key: k
          };
        });
        cc._groups = groups;
        cc._order = order;
      }

      if (!items.length) {
        cc.appendChild(el('div', { class: 'q-empty', text: '这段时间没有支出记录。' }));
      } else if (chartType === 'pie') {
        cc.appendChild(V.chartPie(items, { centerTop: money(st.expense), centerSub: '总支出', fmt: money }));
      } else {
        cc.appendChild(V.chartBars(items, { fmt: money }));
        if (dim === 'tag') {
          // 二级标签明细
          var subBox = el('div', { style: { marginTop: '14px' } });
          cc._order.forEach(function (k) {
            var g = cc._groups[k];
            if (!g.children.length) return;
            subBox.appendChild(el('div', {
              style: { fontSize: '11.5px', fontWeight: '600', color: 'var(--text-2)', margin: '8px 0 4px' },
              text: k
            }));
            g.children.sort(function (a, b) { return b.amount - a.amount; }).forEach(function (c) {
              subBox.appendChild(el('div', { class: 'cat-row lv2' }, [
                el('span', { class: 'cat-name', text: '↳ ' + c.lv2 }),
                el('span', { class: 'cat-bar' }, [
                  el('i', {
                    style: {
                      width: Math.max(4, Math.round(c.amount / (items[0].value || 1) * 100)) + '%',
                      background: Store.tagColor(c.full) || Store.tagColor(k) || 'var(--primary)',
                      opacity: '.55'
                    }
                  })
                ]),
                el('span', { class: 'cat-val', text: money(c.amount) })
              ]));
            });
          });
          cc.appendChild(subBox);
        }
      }
      /* ---------- 每日趋势 ---------- */
      var days = Store.ledgerDaily(r.from, r.to);
      var dayItems = days.map(function (d) {
        return { date: d.date, d: d.d, value: d.expense };
      });
      var dayCard = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } }, [
        el('div', { class: 'section-title' }, [curRange === 'season' ? '每周支出' : '每天支出']),
        V.chartDaily(dayItems, {
          color: 'var(--primary)',
          activeDate: DateUtil.toStr(DateUtil.today()),
          fmt: function (v) { return v ? money(v) : ''; }
        })
      ]);

      /* 宽屏（≥1024px）下两卡并排，平板/横屏更透气 */
      var twoCol = el('div', { class: 'lg-two-col' }, [cc, dayCard]);
      root.appendChild(twoCol);

      /* ---------- 明细（可按标签筛选） ---------- */
      var list = tagSel ? all.filter(function (e) { return hasTag(e.tags, tagSel); }) : all;

      var tf = V.tagFilter(tagSel, function (v) { tagSel = v; view.render(); }, ['ledger']);
      if (tf) root.appendChild(tf);

      if (!list.length) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.wallet, '没有匹配的账目',
            '当前标签下还没有记录，换个标签或清空筛选试试。',
            el('button', {
              class: 'btn', onclick: function () { tagSel = ''; view.render(); }
            }, ['清空筛选']))
        ]));
        return;
      }

      var byDate = {};
      list.forEach(function (e) {
        (byDate[e.date] = byDate[e.date] || []).push(e);
      });

      Object.keys(byDate).sort().reverse().forEach(function (ds) {
        var dayTotal = byDate[ds].reduce(function (sum, e) {
          return e.type === 'income' ? sum : sum + e.amount;
        }, 0);

        var d = DateUtil.parse(ds);
        var head = el('div', { class: 'group-head' }, [
          el('span', { text: (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + DateUtil.weekdayCN(d) }),
          el('span', { class: 'group-count', text: '-' + money(dayTotal) })
        ]);
        root.appendChild(head);

        var box = el('div', { class: 'card', style: { padding: '4px 8px', marginBottom: '14px' } });
        byDate[ds].forEach(function (e) {
          box.appendChild(entryRow(e, view));
        });
        root.appendChild(box);
      });
    }
  };

  /** 单条账目 */
  function entryRow(e, view) {
    var cat = ledgerCat(e.type, e.category);
    var isIncome = e.type === 'income';
    var auto = e.source === 'meal';

    return el('div', {
      class: 'lg-row',
      onclick: function () { openEntryDialog(e.id, view); }
    }, [
      el('i', { class: 'lg-dot', style: { background: cat.color } }),
      el('span', { class: 'lg-main' }, [
        el('b', { text: cat.name }),
        el('span', { class: 'lg-note', text: e.note || '—' })
      ]),
      auto ? V.tagChip('饮食') : null,
      el('span', {
        class: 'lg-amt' + (isIncome ? ' in' : ''),
        text: (isIncome ? '+' : '-') + money(e.amount)
      })
    ]);
  }

  /** 新增 / 编辑弹窗 */
  function openEntryDialog(id, view) {
    var e = id ? Store.getLedgerEntry(id) : null;
    var isEdit = !!e;
    var auto = e && e.source === 'meal';

    var type = e ? e.type : 'expense';
    var catKey = e ? e.category : 'food';

    // 自动账目：只读，引导去象限改
    if (auto) {
      var imm = V.modal({
        title: '来自饮食记录',
        body: el('div', { class: 'preview-box' }, [
          el('div', { text: '金额：' + money(e.amount) }),
          el('div', { text: '日期：' + e.date + ' ' + e.time }),
          e.note ? el('div', { text: '内容：' + e.note }) : null,
          el('div', { style: { marginTop: '8px' }, text: '这条账目由「象限」里的饮食记录自动生成，请到那里修改或删除。' })
        ]),
        footer: el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn', text: '关闭', onclick: function () { imm.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '去象限',
            onclick: function () { imm.close(); App.go('tasks', { tab: 'quadrant' }); }
          })
        ])
      });
      return;
    }

    var fAmount = V.input({
      type: 'number', step: '0.01', min: '0', placeholder: '0.00',
      value: e ? String(e.amount) : '',
      dataset: { autofocus: '1' },
      style: 'font-size:20px;height:48px;font-weight:600'
    });

    var catBox = el('div', { class: 'cat-picker' });
    function drawCats() {
      catBox.innerHTML = '';
      LEDGER_CATS[type].forEach(function (c) {
        catBox.appendChild(el('button', {
          class: 'cat-opt' + (c.key === catKey ? ' active' : ''),
          onclick: function () { catKey = c.key; drawCats(); }
        }, [
          el('i', { style: { background: c.color } }),
          el('span', { text: c.name })
        ]));
      });
    }
    drawCats();

    var fType = V.segment([
      { value: 'expense', label: '支出' },
      { value: 'income', label: '收入' }
    ], type, function (v) {
      type = v;
      catKey = LEDGER_CATS[v][0].key;
      drawCats();
    });

    var fNote = V.input({ placeholder: '备注（可选）', value: e ? e.note : '' });
    // 可选关联课程：用于「每门课花销」统计（教材、打印、班费…）
    var courseList = (Store.courses || []).filter(function (c) {
      return !c.semesterId || c.semesterId === Store.currentSemesterId;
    });
    var fCourse = V.select(
      [{ value: '', label: '不关联课程' }].concat(courseList.map(function (c) {
        return { value: c.id, label: c.name || '未命名课程' };
      })),
      e ? (e.courseId || '') : '',
      { style: 'width:100%' }
    );
    var fTags = V.tagInput(e ? (e.tags || []).join(',') : '', {
      placeholder: '如 餐饮/外卖、学习/书籍'
    });
    var todayStr = DateUtil.toStr(DateUtil.today());
    var rememberedDate = (!e && Store.getLastLedgerDate) ? Store.getLastLedgerDate() : '';
    var initDate = e ? e.date : (rememberedDate || todayStr);
    var fDate = V.input({ type: 'date', value: initDate, style: { flex: '1', minWidth: '0' } });
    var dateHintEl = el('div', {
      style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '3px' },
      text: (!e && rememberedDate && rememberedDate !== todayStr)
        ? ('已自动沿用上次记账日期（' + rememberedDate + '），点「✕ 清除」可重置回今天')
        : ''
    });
    var clearDateBtn = el('button', {
      type: 'button',
      class: 'btn btn-sm',
      title: '清除记忆的上次记账日期并恢复为今天',
      style: { height: '34px', padding: '0 8px', fontSize: '11.5px', flex: '0 0 auto' },
      onclick: function () {
        if (Store.clearLastLedgerDate) Store.clearLastLedgerDate();
        fDate.value = todayStr;
        dateHintEl.textContent = '已重置为今天（' + todayStr + '）';
        UI.toast('已清除记忆日期并重置为今天');
      }
    }, ['✕ 清除']);
    var dateWrap = el('div', {}, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [fDate, clearDateBtn]),
      dateHintEl
    ]);

    var fTime = V.input({ type: 'time', value: e ? (e.time || '') : DateUtil.nowHM(), style: { flex: '1', minWidth: '0' } });
    var clearTimeBtn = el('button', {
      type: 'button',
      class: 'btn btn-sm',
      title: '一键清除记账时间',
      style: { height: '34px', padding: '0 8px', fontSize: '11.5px', flex: '0 0 auto' },
      onclick: function () {
        fTime.value = '';
        UI.toast('已清除时间');
      }
    }, ['✕ 清除']);
    var nowTimeBtn = el('button', {
      type: 'button',
      class: 'btn btn-sm',
      title: '设为当前时间',
      style: { height: '34px', padding: '0 8px', fontSize: '11.5px', flex: '0 0 auto' },
      onclick: function () {
        fTime.value = DateUtil.nowHM();
      }
    }, ['现在']);
    var timeWrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [fTime, clearTimeBtn, nowTimeBtn]);

    var m = V.modal({
      title: isEdit ? '编辑账目' : '记一笔',
      body: [
        V.field('类型', fType),
        V.field('金额', fAmount),
        V.field('分类', catBox),
        V.field('关联课程', fCourse, '可空；填了之后学期报告会按课程汇总花销'),
        V.field('标签', fTags, '支持一级/二级，用于「按标签」统计'),
        V.field('备注', fNote),
        el('div', { class: 'field-row' }, [
          V.field('日期', dateWrap),
          V.field('时间', timeWrap)
        ])
      ],
      footer: el('div', { class: 'modal-foot' }, [
        isEdit ? el('button', {
          class: 'btn btn-danger', text: '删除',
          onclick: function () {
            m.close();
            setTimeout(function () {
              V.confirm({ title: '删除账目', message: '确定删除这条记录吗？', danger: true, okText: '删除' })
                .then(function (ok) {
                  if (ok) { Store.removeLedger(id); UI.toast('已删除'); if (view) view.render(); }
                });
            }, 200);
          }
        }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
              try { document.activeElement.blur(); } catch (e) {}
            }
            var amt = parseFloat(fAmount.value);
            if (!amt || amt <= 0) { UI.toast('请填写金额', 'err'); fAmount.focus(); return; }
            var d = {
              type: type, amount: amt, category: catKey,
              note: fNote.value, date: fDate.value, time: fTime.value,
              tags: fTags.getValue(),
              courseId: fCourse.value || '',
              courseName: (function () {
                var c = (Store.courses || []).filter(function (x) { return x.id === fCourse.value; })[0];
                return c ? (c.name || '') : '';
              })()
            };
            if (isEdit) Store.updateLedger(id, d);
            else {
              Store.addLedger(d);
              // 若记录的日期不在当前范围内，自动切到能覆盖它的范围
              var rr = rangeDates(curRange);
              if (d.date < rr.from || d.date > rr.to) curRange = 'recent30';
            }
            if (Store.flushSave) Store.flushSave();
            m.close();
            var alertNote = (!isEdit && Store.lastBudgetAlert) ? (' · ' + Store.lastBudgetAlert) : '';
            UI.toast((isEdit ? '已更新' : '已记一笔') + alertNote);
            if (view) view.render();
            else if (App.currentId === 'ledger') {
              App.views.filter(function (x) { return x.id === 'ledger'; })[0].render();
            }
          }
        })
      ])
    });
  }

  view.openDialog = openEntryDialog;

  /* ==========================================================
   * 当月预算卡片
   * ========================================================== */
  function hasCatBudget(b) {
    return b && b.categories && Object.keys(b.categories).length > 0;
  }

  /* ==========================================================
   * 吃饭的钱：把饮食记录里的花费与热量放在一起看
   * 记饮食时填的花费由 addMeal 自动进账本，这里只做汇总，不重复记账。
   * ========================================================== */
  function foodCard() {
    var f = Store.foodSpend(30);
    if (!f.has || f.cost <= 0) return null;

    var c = el('div', { class: 'card lg-food', style: { padding: '14px 16px', marginBottom: '14px' } });
    var head = el('div', { class: 'section-title' }, ['最近 30 天 · 吃饭']);
    head.appendChild(el('button', {
      class: 'btn btn-sm',
      onclick: function () { App.go('health'); }
    }, ['看饮食 ›']));
    c.appendChild(head);

    function cell(value, label, color) {
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '86px' } }, [
        el('span', { style: { fontSize: '18px', fontWeight: '700', color: color || 'var(--text-1)' }, text: value }),
        el('span', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: label })
      ]);
    }

    c.appendChild(el('div', { style: { display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '4px' } }, [
      cell(money(f.cost), f.count + ' 顿合计'),
      cell(f.perDayCost ? money(f.perDayCost) : '—', '日均（' + f.costDays + ' 天）'),
      cell(f.perDayKcal ? f.perDayKcal + ' kcal' : '—', '日均热量'),
      cell(f.costPer1k != null ? money(f.costPer1k) : '—', '每千卡')
    ]));

    var notes = [];
    if (f.top && f.top.cost > 0) notes.push('最贵的一天 ' + f.top.date.slice(5) + ' · ' + money(f.top.cost));
    if (f.freeMeals > 0) notes.push(f.freeMeals + ' 顿没记花费（日均只按记了的天数算）');
    var goal = Number((Store.dietConfig() || {}).goal) || 0;
    if (goal > 0 && f.perDayKcal > goal * 1.1) {
      notes.push('日均热量比目标 ' + goal + ' kcal 高 ' + (f.perDayKcal - goal) + ' kcal');
    }
    if (notes.length) {
      c.appendChild(el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.7' },
        text: notes.join(' · ') }));
    }
    return c;
  }

  function budgetCard() {
    var ym = DateUtil.toStr(DateUtil.today()).slice(0, 7);
    var b = Store.getBudget();
    var st = Store.ledgerBudgetStatus(ym);

    var card = el('div', { class: 'card lg-budget' });
    var head = el('div', { class: 'section-title' }, [ym + ' 预算']);
    var headActs = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } });
    if (b.monthly > 0) {
      headActs.appendChild(el('button', {
        class: 'btn btn-sm',
        title: '将本月预算同步为目标页的关键结果（KR）',
        onclick: function () {
          var mb = monthBounds(DateUtil.today());
          var mStart = DateUtil.toStr(mb.start);
          var mEnd = DateUtil.toStr(mb.end);
          App.go('goals');
          if (global.openGoalDialog) {
            setTimeout(function () {
              global.openGoalDialog(null, {
                title: ym + ' 理性消费与预算控制',
                period: 'custom',
                startDate: mStart,
                endDate: mEnd,
                krs: [{
                  title: '当月总支出控制在 ¥' + b.monthly + ' 以内',
                  kind: 'budget',
                  target: b.monthly,
                  category: '',
                  unit: '元'
                }].concat(b.categories && b.categories.food ? [{
                  title: '当月餐饮支出不超过 ¥' + b.categories.food,
                  kind: 'budget',
                  target: b.categories.food,
                  category: 'food',
                  unit: '元'
                }] : [])
              });
            }, 60);
          }
        }
      }, ['🎯 设为目标 KR']));
    }
    headActs.appendChild(el('button', {
      class: 'btn btn-sm', onclick: function () { budgetDialog(); }
    }, ['设置']));
    head.appendChild(headActs);
    card.appendChild(head);

    if (b.monthly <= 0 && !hasCatBudget(b)) {
      card.appendChild(el('div', { class: 'lg-budget-empty' }, [
        el('span', { text: '还没设预算。设一个每月总预算，或给重点分类设额度，这里会显示花得怎么样。' }),
        el('button', {
          class: 'btn btn-primary btn-sm', onclick: function () { budgetDialog(); }
        }, ['去设置'])
      ]));
      return card;
    }

    if (b.monthly > 0) {
      var pct = Math.min(100, Math.round(st.pct * 100));
      card.appendChild(el('div', { class: 'lg-prog' + (st.over ? ' over' : '') }, [
        el('i', { style: { width: pct + '%' } })
      ]));
      card.appendChild(el('div', { class: 'lg-budget-info' }, [
        el('span', { text: '已花 ' + money(st.spent) + ' / ' + money(b.monthly) }),
        el('span', {
          class: 'lg-budget-rem' + (st.over ? ' over' : ''),
          text: st.over ? ('超支 ' + money(st.spent - b.monthly)) : ('剩余 ' + money(st.remaining))
        })
      ]));
      var sub = el('div', { class: 'lg-budget-sub' });
      if (st.daysLeft > 0) {
        sub.appendChild(el('span', { text: '距月底 ' + st.daysLeft + ' 天' }));
        sub.appendChild(el('span', { text: '日均已花 ' + money(st.dailyAvg) }));
        if (st.dailyLeft != null) sub.appendChild(el('span', { text: '日均可用 ' + money(st.dailyLeft) }));
        if (st.estMonth != null) sub.appendChild(el('span', { text: '预计月底 ' + money(st.estMonth) }));
      } else {
        sub.appendChild(el('span', { text: '本月已结束' }));
      }
      card.appendChild(sub);
    }

    if (st.cats.length) {
      card.appendChild(el('div', { class: 'lg-cb-title', text: '分类预算' }));
      var catBox = el('div', { class: 'lg-cat-budgets' });
      st.cats.forEach(function (c) {
        var cp = Math.min(100, Math.round(c.pct * 100));
        catBox.appendChild(el('div', { class: 'lg-cat-budget' }, [
          el('div', { class: 'lg-cb-head' }, [
            el('span', { class: 'lg-cb-name' }, [
              el('i', { class: 'lg-dot', style: { background: c.color } }),
              ' ' + c.name
            ]),
            el('span', {
              class: 'lg-cb-val' + (c.over ? ' over' : ''),
              text: money(c.spent) + ' / ' + money(c.budget)
            })
          ]),
          el('div', { class: 'lg-prog sm' + (c.over ? ' over' : '') }, [
            el('i', { style: { width: cp + '%', background: c.color } })
          ])
        ]));
      });
      card.appendChild(catBox);
    }
    return card;
  }

  /* ==========================================================
   * 预算设置弹窗
   * ========================================================== */
  function budgetDialog() {
    var b = Store.getBudget();
    var fMonthly = V.input({
      type: 'number', min: '0', step: '10', value: b.monthly || '', placeholder: '不限'
    });
    var catInputs = {};
    var catBox = el('div', { class: 'cat-budget-grid' });
    LEDGER_CATS.expense.forEach(function (c) {
      var inp = V.input({
        type: 'number', min: '0', step: '10', value: b.categories[c.key] || '', placeholder: '0'
      });
      catInputs[c.key] = inp;
      catBox.appendChild(el('div', { class: 'cat-budget-row' }, [
        el('span', { class: 'cb-cat-name' }, [
          el('i', { class: 'lg-dot', style: { background: c.color } }), ' ' + c.name
        ]),
        inp
      ]));
    });

    var m = V.modal({
      title: '预算设置',
      width: '460px',
      body: [
        V.field('当月总预算（元，0 或留空 = 不限）', fMonthly),
        el('div', { class: 'section-title', text: '分类预算（可选，按当月额度）' }),
        catBox,
        el('div', {
          class: 'ocr-hint',
          text: '预算只用于本页的进度展示与提醒，不影响任何已记的账目。'
        })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            var data = { monthly: parseFloat(fMonthly.value) || 0, categories: {} };
            LEDGER_CATS.expense.forEach(function (c) {
              var v = parseFloat(catInputs[c.key].value);
              if (v > 0) data.categories[c.key] = v;
            });
            Store.setBudget(data);
            m.close();
            UI.toast('预算已保存');
            view.render();
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 月度报表（可打印 / CSV，含分类占比 + 环比）
   * ========================================================== */
  function buildReport(ym) {
    var stats = Store.ledgerStats(ym);
    var total = stats.expense || 0;
    var cats = Store.ledgerByCategory(ym).map(function (c) {
      return {
        key: c.key, name: c.cat.name, color: c.cat.color, amount: c.total,
        pct: total > 0 ? Math.round(c.total / total * 1000) / 10 : 0
      };
    });
    // 环比：上月
    var prevDate = DateUtil.addMonths(DateUtil.parse(ym + '-01'), -1);
    var prevYm = DateUtil.toStr(prevDate).slice(0, 7);
    var prevStats = Store.ledgerStats(prevYm);
    var prevMap = {};
    Store.ledgerByCategory(prevYm).forEach(function (c) { prevMap[c.key] = c.total; });
    cats.forEach(function (r) {
      var pv = prevMap[r.key] || 0;
      r.prev = pv;
      r.delta = Math.round((r.amount - pv) * 100) / 100;
      r.deltaPct = pv > 0 ? Math.round((r.amount - pv) / pv * 1000) / 10 : null;
    });
    return { ym: ym, summary: stats, cats: cats, prevYm: prevYm, prevSummary: prevStats };
  }

  function reportCsv(t) {
    var lines = ['月份,' + t.ym, '', '分类,金额,占比,上月,环比'];
    t.cats.forEach(function (r) {
      lines.push([
        r.name, r.amount, r.pct + '%', r.prev,
        (r.deltaPct == null ? '—' : (r.delta > 0 ? '+' : '') + r.deltaPct + '%')
      ].join(','));
    });
    lines.push('');
    lines.push([
      '合计', t.summary.expense, '100%', t.prevSummary.expense,
      (t.prevSummary.expense > 0 ? Math.round((t.summary.expense - t.prevSummary.expense) / t.prevSummary.expense * 1000) / 10 + '%' : '—')
    ].join(','));
    lines.push(['收入', t.summary.income, '', t.prevSummary.income, ''].join(','));
    lines.push(['结余', t.summary.balance, '', t.prevSummary.balance, ''].join(','));
    return lines.join('\r\n');
  }

  function downloadReportCsv(t) {
    SaveFile.save('记账报表-' + t.ym + '.csv', '\ufeff' + reportCsv(t), {
      mime: 'text/csv', ext: 'csv'
    }).then(function (r) {
      if (r.canceled) { UI.toast('已取消'); return; }
      if (r.method === 'picker' || r.method === 'share') UI.toast('已保存 记账报表-' + t.ym + '.csv', 'ok');
    }).catch(function (e) { UI.toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
  }

  function printReport(t) {
    var rows = t.cats.map(function (r) {
      var cls = r.delta > 0 ? 'neg' : (r.delta < 0 ? 'pos' : '');
      var deltaTxt = r.deltaPct == null ? '—' : (r.delta > 0 ? '+' : '') + r.deltaPct + '%';
      return '<tr>' +
        '<td class="nm">' + UI.escapeHTML(r.name) + '</td>' +
        '<td class="num">' + money(r.amount) + '</td>' +
        '<td class="num">' + r.pct + '%</td>' +
        '<td class="num">' + money(r.prev) + '</td>' +
        '<td class="num ' + cls + '">' + deltaTxt + '</td></tr>';
    }).join('');

    var html = [
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>记账报表</title><style>',
      '* { box-sizing: border-box; }',
      'body { margin: 0; padding: 30px 24px; background: #fff; color: #111827;',
      ' font: 14px/1.65 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }',
      '.wrap { max-width: 780px; margin: 0 auto; }',
      'h1 { font-size: 21px; margin: 0 0 6px; letter-spacing: .5px; }',
      '.meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }',
      '.sum { display: flex; gap: 18px; margin-bottom: 18px; flex-wrap: wrap; }',
      '.sum div { font-size: 13px; color: #374151; }',
      '.sum b { display: block; font-size: 18px; color: #111827; }',
      'h2 { font-size: 15px; margin: 18px 0 8px; }',
      'table { width: 100%; border-collapse: collapse; }',
      'th, td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; }',
      'th { background: #f3f4f6; font-weight: 600; font-size: 12.5px; }',
      '.num { text-align: right; font-variant-numeric: tabular-nums; }',
      '.neg { color: #ef4444; }',
      '.pos { color: #10b981; }',
      'tfoot td { background: #f9fafb; font-weight: 700; }',
      '@media print { body { padding: 0; } th { background: #eee !important; } }',
      '</style></head><body><div class="wrap">',
      '<h1>记账报表</h1>',
      '<div class="meta">月份：' + UI.escapeHTML(t.ym) + '　环比对照：' + UI.escapeHTML(t.prevYm) + '</div>',
      '<div class="sum">',
      '<div>支出<b>' + money(t.summary.expense) + '</b></div>',
      '<div>收入<b>' + money(t.summary.income) + '</b></div>',
      '<div>结余<b>' + money(t.summary.balance) + '</b></div>',
      '</div>',
      '<h2>分类支出</h2>',
      '<table><thead><tr><th>分类</th><th class="num">金额</th><th class="num">占比</th>',
      '<th class="num">上月</th><th class="num">环比</th></tr></thead><tbody>',
      rows,
      '</tbody><tfoot><tr><td>合计</td><td class="num">' + money(t.summary.expense) +
      '</td><td class="num">100%</td><td class="num">' + money(t.prevSummary.expense) +
      '</td><td class="num">' + (t.prevSummary.expense > 0 ? Math.round((t.summary.expense - t.prevSummary.expense) / t.prevSummary.expense * 1000) / 10 + '%' : '—') +
      '</td></tr></tfoot></table>',
      '</div><script>window.addEventListener("load",function(){window.print();});<\/script></body></html>'
    ].join('');
    if (global.SaveFile && SaveFile.openHtmlPrintModal) {
      SaveFile.openHtmlPrintModal('记账收支报表 · ' + (t.ym || ''), html, '收支报表-' + (t.ym || ''));
      return;
    }
    var w = global.open('', '_blank');
    if (!w) { UI.toast('请允许弹出窗口后重试', 'err'); return; }
    w.document.write(html);
    w.document.close();
  }

  function reportDialog() {
    var ym = DateUtil.toStr(DateUtil.today()).slice(0, 7);
    var months = [];
    for (var i = 0; i < 12; i++) {
      var d = DateUtil.addMonths(DateUtil.today(), -i);
      months.push(DateUtil.toStr(d).slice(0, 7));
    }
    var sel = V.select(months.map(function (m) { return { value: m, label: m }; }), ym);
    var preview = el('div', { class: 'preview-box' });
    function drawPreview() {
      var t = buildReport(sel.value);
      var line = t.summary.expense + ' 支出 · ' + t.summary.income + ' 收入 · 结余 ' +
        t.summary.balance + ' · ' + t.cats.length + ' 个分类';
      preview.innerHTML = '<div class="cp-pv-line">' + line + '</div>';
    }
    var m = V.modal({
      title: '月度报表',
      width: '460px',
      body: [
        V.field('选择月份', sel),
        preview,
        el('div', {
          class: 'ocr-hint',
          text: '报表含收入 / 支出 / 结余、各分类金额与占比，以及与上月对比（环比）。'
        })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn', onclick: function () {
            var t = buildReport(sel.value); downloadReportCsv(t); m.close();
          }
        }, ['CSV']),
        el('button', {
          class: 'btn btn-primary', onclick: function () {
            var t = buildReport(sel.value); printReport(t); m.close();
          }
        }, ['打印 / PDF'])
      ])
    });
    drawPreview();
  }

  /* ==========================================================
   * 导入 CSV / 微信 / 支付宝账单弹窗（含格式说明、模板下载与实时预览）
   * ========================================================== */
  function importLedgerDialog() {
    var todayStr = DateUtil.toStr(DateUtil.today());
    var sampleCsv = [
      '日期,收支,分类,金额,备注,时间,标签',
      todayStr + ',支出,餐饮,16.50,二食堂午餐黄焖鸡,12:15,餐饮/食堂',
      todayStr + ',支出,交通,4.00,地铁往返图书馆,08:30,出行/地铁',
      todayStr + ',支出,学习,35.80,线性代数辅导书,15:20,学习/教材',
      todayStr + ',收入,兼职,120.00,周末高数家教课时费,19:00,兼职/家教'
    ].join('\n');

    var guideBox = el('div', {
      class: 'preview-box',
      style: { fontSize: '12px', lineHeight: '1.7', marginBottom: '10px' }
    }, [
      el('div', { style: { fontWeight: '700', color: 'var(--text-1)', marginBottom: '4px' }, text: '📋 可接受的数据格式说明（自动识别 UTF-8 / GBK 编码）：' }),
      el('div', { text: '1. 通用 CSV / TSV 表格（推荐）：首行表头可包含「日期, 收支, 分类, 金额, 备注, 时间, 标签」（列顺序任意，仅「日期」与「金额」必填；也支持无表头按「日期, 分类, 金额, 备注」逐行填写）。' }),
      el('div', { text: '2. 微信支付 / 支付宝导出账单 (.csv)：直接选择微信或支付宝导出的原始 CSV 账单文件，会自动跳过文件头说明、过滤「不计收支 / 已退款」流水，并根据商户与商品名称智能归类。' }),
      el('div', { style: { color: 'var(--text-3)', marginTop: '3px' }, text: '• 支持支出分类：餐饮、交通、购物、学习、娱乐、医疗、其他' }),
      el('div', { style: { color: 'var(--text-3)' }, text: '• 支持收入分类：奖学金、兼职、生活费、其他（未匹配分类会自动按关键词智能归类）' })
    ]);

    var fText = V.textarea({
      placeholder: '在此粘贴 CSV / TSV 文本，或点击上方「选择 CSV 文件」上传…\n示例：\n日期,收支,分类,金额,备注\n' + todayStr + ',支出,餐饮,15.5,食堂午饭',
      style: 'min-height:110px;font-family:monospace;font-size:12px'
    });

    var previewEl = el('div', {
      class: 'preview-box',
      style: { marginTop: '8px', fontSize: '12px', maxHeight: '150px', overflowY: 'auto' }
    }, [
      el('div', { style: { color: 'var(--text-3)' }, text: '等待选择文件或粘贴数据…' })
    ]);

    function updatePreview() {
      var raw = fText.value.trim();
      previewEl.innerHTML = '';
      if (!raw) {
        previewEl.appendChild(el('div', { style: { color: 'var(--text-3)' }, text: '等待选择文件或粘贴数据…' }));
        return;
      }
      var list = Store.parseLedgerCsv ? Store.parseLedgerCsv(raw) : [];
      if (!list.length) {
        previewEl.appendChild(el('div', { style: { color: 'var(--red)' }, text: '未能识别到有效账目，请检查是否包含「日期（如 2026-10-24）」和「金额（大于 0 的数字）」。' }));
        return;
      }
      var expSum = 0, incSum = 0;
      list.forEach(function (it) {
        if (it.type === 'income') incSum += it.amount;
        else expSum += it.amount;
      });
      previewEl.appendChild(el('div', {
        style: { fontWeight: '600', color: 'var(--primary)', marginBottom: '6px' },
        text: '✓ 已识别 ' + list.length + ' 笔账目（支出 ' + money(expSum) + ' / 收入 ' + money(incSum) + '）'
      }));
      list.slice(0, 6).forEach(function (it) {
        var cat = ledgerCat(it.type, it.category);
        previewEl.appendChild(el('div', {
          style: { display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '2px 0', borderTop: '1px dashed var(--line)' }
        }, [
          el('span', { text: it.date + ' ' + (it.time || '') + ' · [' + cat.name + '] ' + (it.note || '—') }),
          el('b', {
            style: { color: it.type === 'income' ? 'var(--green)' : 'var(--text-1)' },
            text: (it.type === 'income' ? '+' : '-') + money(it.amount)
          })
        ]));
      });
      if (list.length > 6) {
        previewEl.appendChild(el('div', {
          style: { color: 'var(--text-3)', marginTop: '4px' },
          text: '… 其余 ' + (list.length - 6) + ' 笔将在确认后一并导入'
        }));
      }
    }

    fText.addEventListener('input', updatePreview);

    var fileInput = el('input', {
      type: 'file',
      accept: '.csv,.tsv,.txt,text/csv,text/plain',
      style: { display: 'none' }
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var buf = ev.target.result;
        var text = '';
        try {
          var decUtf8 = new TextDecoder('utf-8', { fatal: true });
          text = decUtf8.decode(buf);
        } catch (_) {
          try {
            var decGbk = new TextDecoder('gb18030');
            text = decGbk.decode(buf);
          } catch (e2) {
            text = new TextDecoder('utf-8').decode(buf);
          }
        }
        fText.value = text;
        updatePreview();
      };
      reader.readAsArrayBuffer(file);
    });

    var toolBar = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } }, [
      fileInput,
      el('button', {
        type: 'button',
        class: 'btn btn-sm btn-primary',
        onclick: function () { fileInput.click(); }
      }, ['📂 选择 CSV / TXT 文件']),
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        onclick: function () {
          SaveFile.save('记账导入模板.csv', '\ufeff' + sampleCsv, { mime: 'text/csv', ext: 'csv' });
        }
      }, ['📄 下载 CSV 模板']),
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        onclick: function () {
          fText.value = sampleCsv;
          updatePreview();
        }
      }, ['📋 填入示例数据'])
    ]);

    var m = V.modal({
      title: '导入记账 CSV / 账单数据',
      width: '520px',
      body: [
        guideBox,
        toolBar,
        V.field('账单 CSV 文本（可上传文件或直接粘贴）', fText),
        previewEl
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary',
          text: '确认导入',
          onclick: function () {
            var raw = fText.value.trim();
            if (!raw) { UI.toast('请先选择 CSV 文件或粘贴账单内容', 'err'); return; }
            var res = Store.importLedgerCsv(raw);
            if (!res.ok) {
              UI.toast('未识别到有效账单记录，请检查格式说明', 'err');
              return;
            }
            m.close();
            if (res.added > 0) {
              var dates = res.items.map(function (x) { return x.date; }).sort();
              var rr = rangeDates(curRange);
              if (dates[0] < rr.from || dates[dates.length - 1] > rr.to) {
                curRange = 'recent30';
              }
            }
            view.render();
            var msg = '成功导入 ' + res.added + ' 笔账目' + (res.skipped ? '（跳过重复 ' + res.skipped + ' 笔）' : '');
            if (res.added > 0 && res.addedIds && res.addedIds.length && UI.toastAction && Store.removeLedgerEntries) {
              UI.toastAction(msg, {
                actionText: '撤销导入',
                duration: 7000,
                onAction: function () {
                  var rm = Store.removeLedgerEntries(res.addedIds);
                  view.render();
                  UI.toast('已撤销本次导入的 ' + rm + ' 笔账目');
                }
              });
            } else {
              UI.toast(msg, 'ok');
            }
          }
        })
      ])
    });
  }

  view.openImportDialog = importLedgerDialog;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


