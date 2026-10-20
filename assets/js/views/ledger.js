

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
            '换个时间范围看看，或点右上角「记一笔」。在「象限」记录饮食时填了花费，也会自动出现在这里。')
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
      root.appendChild(cc);

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
      root.appendChild(dayCard);

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
            onclick: function () { imm.close(); App.go('quadrant'); }
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
    var fTags = V.tagInput(e ? (e.tags || []).join(',') : '', {
      placeholder: '如 餐饮/外卖、学习/书籍'
    });
    var fDate = V.input({ type: 'date', value: e ? e.date : DateUtil.toStr(DateUtil.today()) });
    var fTime = V.input({ type: 'time', value: e ? e.time : DateUtil.nowHM() });

    var m = V.modal({
      title: isEdit ? '编辑账目' : '记一笔',
      body: [
        V.field('类型', fType),
        V.field('金额', fAmount),
        V.field('分类', catBox),
        V.field('标签', fTags, '支持一级/二级，用于「按标签」统计'),
        V.field('备注', fNote),
        el('div', { class: 'field-row' }, [
          V.field('日期', fDate),
          V.field('时间', fTime)
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
            var amt = parseFloat(fAmount.value);
            if (!amt || amt <= 0) { UI.toast('请填写金额', 'err'); fAmount.focus(); return; }
            var d = {
              type: type, amount: amt, category: catKey,
              note: fNote.value, date: fDate.value, time: fTime.value,
              tags: fTags.getValue()
            };
            if (isEdit) Store.updateLedger(id, d);
            else {
              Store.addLedger(d);
              // 若记录的日期不在当前范围内，自动切到能覆盖它的范围
              var rr = rangeDates(curRange);
              if (d.date < rr.from || d.date > rr.to) curRange = 'recent30';
            }
            m.close();
            UI.toast(isEdit ? '已更新' : '已记一笔');
            if (view) view.render();
            else if (App.currentId === 'ledger') {
              App.views.filter(function (x) { return x.id === 'ledger'; })[0].render();
            }
          }
        })
      ])
    });
  }

  global.openLedgerDialog = function () { openEntryDialog(); };
  view.openDialog = openEntryDialog;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


