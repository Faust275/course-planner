

/* ==========================================================
 * 视图：成绩（学分 / 多层占比 / 加权均分）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var uid = (function () {
    var n = 0;
    return function () {
      n++;
      return 'g' + Date.now().toString(36) + n.toString(36);
    };
  })();

  /** 当前查看范围：'current' | 'all' | 某个学期 id */
  var SCOPE = 'current';

  function scopeIds() {
    if (SCOPE === 'all') return Store.semesters.map(function (s) { return s.id; });
    if (SCOPE === 'current') return [Store.currentSemesterId];
    return [SCOPE];
  }

  function scopeName() {
    if (SCOPE === 'all') return '全部学期';
    if (SCOPE === 'current') return '当前学期';
    var s = Store.semesterById(SCOPE);
    return s ? s.name : '当前学期';
  }

  var view = {
    id: 'grades',
    name: '成绩',
    icon: V.icons.chart,
    title: '成绩',
    order: 27,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () { exportTranscriptDialog(scopeIds()); }
      }, [V.svg(V.icons.download, 16), '导出']));
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { addDialog(); }
      }, [V.svg(V.icons.plus, 16), '添加课程']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-grades' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      root.innerHTML = '';
      var ids = scopeIds();

      /* ---- 学期切换 ---- */
      var opts = [{ key: 'current', name: '当前学期' }];
      Store.semesters.forEach(function (s) {
        opts.push({ key: s.id, name: s.name });
      });
      opts.push({ key: 'all', name: '全部' });

      var tabs = el('div', { class: 'dim-tabs scope-tabs' });
      opts.forEach(function (o) {
        tabs.appendChild(el('button', {
          class: 'dim-tab' + (SCOPE === o.key ? ' active' : ''),
          text: o.name,
          onclick: function () { SCOPE = o.key; view.render(); }
        }));
      });
      root.appendChild(tabs);

      /* ---- 汇总 ---- */
      var sum = Store.gradeSummary(ids);
      var scale = Store.gpaConfig().scale;
      root.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(sum.weighted == null ? '—' : sum.weighted, '加权均分', 'var(--primary)'),
        V.statCard(gpa2(sum.gpa), 'GPA / ' + fmt(scale, 1), 'var(--green)'),
        V.statCard(sum.credits || 0, '学分', 'var(--amber)'),
        V.statCard(sum.scored + '/' + sum.count, '已出分', 'var(--text-2)')
      ]));

      root.appendChild(el('p', {
        class: 'ocr-hint',
        style: { margin: '-6px 0 10px' },
        text: '加权均分 = Σ(成绩 × 学分) ÷ Σ学分；GPA 按「设置 → 成绩与 GPA」里的规则换算（当前满分 ' +
              fmt(scale, 1) + '），算术均分 ' + fmt(sum.average, 1) + '。' + scopeName() +
              '里，课程表中填了学分的课程会自动出现在这里。'
      }));

      /* ---- 课程列表 ---- */
      var list = [];
      ids.forEach(function (sid) {
        Store.gradeList(sid).forEach(function (r) {
          list.push({ rec: r, semesterId: sid });
        });
      });

      if (!list.length) {
        root.appendChild(V.empty(
          V.icons.chart, '还没有课程',
          '在课程表里给课程填上「学分」，它们会自动出现在这里；也可以点右上角手动添加一门。',
          el('button', {
            class: 'btn btn-primary', onclick: function () { addDialog(); }
          }, [V.svg(V.icons.plus, 16), '手动添加'])
        ));
        return;
      }

      var box = el('div', { class: 'card grade-list' });
      list.forEach(function (item) {
        var r = item.rec;
        var score = r.root ? Store.computeGrade(r.root) : null;
        var semName = ids.length > 1 ? (Store.semesterById(item.semesterId) || {}).name : '';
        box.appendChild(el('div', {
          class: 'grade-row' + (score == null ? ' pending' : ''),
          onclick: function () { gradeDialog(item.semesterId, r); }
        }, [
          el('span', { class: 'gr-dot', style: { background: score == null ? '#cbd5e1' : gradeColor(score) } }),
          el('div', { class: 'gr-main' }, [
            el('b', { text: r.name }),
            el('span', { text: [
              r.credit ? r.credit + ' 学分' : '未填学分',
              semName ? semName.slice(0, 12) : '',
              r.source === 'manual' ? '手动添加' : '来自课程表'
            ].filter(Boolean).join(' · ') })
          ]),
          el('div', { class: 'gr-score' }, [
            el('b', { text: score == null ? '未录入' : String(Math.round(score * 10) / 10) }),
            score == null ? null : el('span', {
              text: '总评 · ' + gpa2(Store.gpaOf(score)) + ' 绩点'
            })
          ]),
          V.svg(V.icons.right, 15)
        ]));
      });
      root.appendChild(box);
    }
  };

  function gradeColor(s) {
    if (s >= 90) return '#10b981';
    if (s >= 80) return '#0ea5e9';
    if (s >= 70) return '#f59e0b';
    if (s >= 60) return '#f97316';
    return '#ef4444';
  }

  /* ==========================================================
   * 成绩详情：多层占比 + 逐项得分
   * ========================================================== */
  function gradeDialog(semesterId, rec) {
    var isNew = !rec.root;
    var root = rec.root ? JSON.parse(JSON.stringify(rec.root)) : Store.defaultGradeTree();
    var data = {
      name: rec.name || '',
      credit: Number(rec.credit) || 0
    };

    var computedEls = [];
    var totalEl = null;
    var gpaEl = el('i', { class: 'gr-gpa', text: '' });
    var treeBox = el('div', { class: 'gr-tree' });

    /* ---- what-if：假设这门总评 X 分，整体 GPA / 加权均分变成多少 ---- */
    var wiInp = V.input({
      type: 'number', min: '0', max: '150', step: '0.5', value: '',
      placeholder: '例如 85', class: 'input'
    });
    var wiOut = el('div', { class: 'gr-whatif-out' });

    function refreshWhatIf() {
      var ids = scopeIds();
      var base = Store.gradeSummary(ids);
      var hy = parseFloat(wiInp.value);
      if (wiInp.value === '' || isNaN(hy)) {
        wiOut.innerHTML = '<span class="gr-wi-hint">输入一个假设总评，看看整体 GPA 怎么变</span>';
        return;
      }
      var after = Store.gradeSummary(ids, [{ semesterId: semesterId, key: rec.key, score: hy }]);
      var dg = (base.gpa != null && after.gpa != null) ? after.gpa - base.gpa : null;
      var dw = (base.weighted != null && after.weighted != null) ? after.weighted - base.weighted : null;
      var gColor = dg == null ? 'inherit' : (dg > 0.004 ? 'var(--green)' : dg < -0.004 ? 'var(--red)' : 'inherit');
      var parts = [];
      parts.push('整体 GPA <b>' + gpa2(base.gpa) + '</b> → <b style="color:' + gColor + '">' + gpa2(after.gpa) + '</b>');
      if (dg != null && Math.abs(dg) > 0.004) parts.push('<span class="gr-wi-delta ' + (dg > 0 ? 'up' : 'down') + '">' + (dg > 0 ? '+' : '') + gpa2(dg) + '</span>');
      parts.push('加权均分 ' + fmt(base.weighted, 1) + ' → <b>' + fmt(after.weighted, 1) + '</b>');
      if (dw != null && Math.abs(dw) > 0.05) parts.push('<span class="gr-wi-delta ' + (dw > 0 ? 'up' : 'down') + '">' + (dw > 0 ? '+' : '') + fmt(dw, 1) + '</span>');
      wiOut.innerHTML = parts.join('　');
    }
    wiInp.addEventListener('input', refreshWhatIf);

    function refresh() {
      computedEls.forEach(function (x) {
        var v = Store.computeGrade(x.node);
        x.el.textContent = v == null ? '—' : String(Math.round(v * 10) / 10);
      });
      var t = Store.computeGrade(root);
      if (totalEl) {
        totalEl.textContent = t == null ? '—' : String(Math.round(t * 10) / 10);
        totalEl.style.color = t == null ? 'var(--text-3)' : gradeColor(t);
      }
      var gp = Store.gpaOf(t);
      gpaEl.textContent = (gp == null ? '' : '折合绩点 ' + gpa2(gp) + ' / ' + fmt(Store.gpaConfig().scale, 1));
      if (wiInp) refreshWhatIf();
    }

    function findParent(node, id, parent) {
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          if (node.children[i].id === id) return { parent: node, idx: i };
          var r = findParent(node.children[i], id, node.children[i]);
          if (r) return r;
        }
      }
      return null;
    }

    function drawTree() {
      treeBox.innerHTML = '';
      computedEls = [];
      walk(root, 0, null);
      refresh();
    }

    function walk(node, depth, parent) {
      var hasKids = node.children && node.children.length;

      var nameInp = V.input({ value: node.name, class: 'input gr-name' });
      nameInp.addEventListener('input', function () { node.name = nameInp.value; });

      var wInp = V.input({
        type: 'number', min: '0', max: '100', step: '1',
        value: node.weight, class: 'input gr-weight'
      });
      wInp.addEventListener('input', function () {
        node.weight = Math.max(0, Math.min(100, parseFloat(wInp.value) || 0));
        refresh();
      });

      var scoreCell = el('span', { class: 'gr-val' });
      if (hasKids) {
        scoreCell.appendChild(el('i', { text: '' }));
        computedEls.push({ node: node, el: scoreCell.firstChild });
        scoreCell.appendChild(el('small', { text: ' 自动' }));
      } else {
        var sInp = V.input({
          type: 'number', min: '0', max: '150', step: '0.5',
          value: (node.score == null ? '' : node.score),
          placeholder: '得分', class: 'input gr-score-inp'
        });
        sInp.addEventListener('input', function () {
          node.score = sInp.value === '' ? null : parseFloat(sInp.value);
          refresh();
        });
        scoreCell.appendChild(sInp);
      }

      var row = el('div', { class: 'gr-node', style: { paddingLeft: (depth * 18) + 'px' } }, [
        nameInp,
        el('span', { class: 'gr-w-cell' }, [wInp, el('i', { text: '%' })]),
        scoreCell,
        el('span', { class: 'gr-ops' }, [
          el('button', {
            class: 'icon-btn', title: '加一个子项',
            onclick: function () {
              node.children = node.children || [];
              node.children.push({ id: uid(), name: '新项', weight: 0, score: null, children: [] });
              drawTree();
            }
          }, [V.svg(V.icons.plus, 14)]),
          parent ? el('button', {
            class: 'icon-btn', title: '删除这一项',
            onclick: function () {
              var hit = findParent(root, node.id, null);
              if (hit) hit.parent.children.splice(hit.idx, 1);
              drawTree();
            }
          }, [V.svg(V.icons.trash, 14)]) : null
        ])
      ]);
      treeBox.appendChild(row);

      if (hasKids) {
        node.children.forEach(function (ch) { walk(ch, depth + 1, node); });
      }
    }

    var fName = V.input({ value: data.name, class: 'input' });
    var fCredit = V.input({ type: 'number', min: '0', max: '30', step: '0.5', value: data.credit || '', class: 'input' });

    var m = V.modal({
      title: isNew ? '录入成绩' : '成绩明细',
      width: '560px',
      body: [
        el('div', { class: 'field-row' }, [
          V.field('课程名称', fName),
          V.field('学分', fCredit)
        ]),
        el('div', { class: 'gr-total' }, [
          el('span', { text: '总评' }),
          (function () {
            totalEl = el('b', { text: '—' });
            return totalEl;
          })(),
          gpaEl
        ]),
        treeBox,
        el('div', { class: 'gr-whatif' }, [
          el('div', { class: 'gr-whatif-head' }, ['模拟：这门考多少？']),
          el('div', { class: 'gr-whatif-row' }, [wiInp]),
          wiOut
        ]),
        el('div', { class: 'ocr-hint', text: '每一行都能加子项：比如「平时」里再拆「作业」和「考勤」，权重按各层自动折算，没填的项不会拉低平均分。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        isNew ? null : el('button', {
          class: 'btn btn-danger', text: '清除成绩',
          onclick: function () {
            m.close();
            V.confirm({
              title: '清除成绩', message: '会删掉「' + data.name + '」已经录入的分数，课程本身保留。',
              danger: true, okText: '清除'
            }).then(function (ok) {
              if (!ok) return;
              Store.removeGrade(semesterId, rec.key);
              UI.toast('已清除');
              view.render();
            });
          }
        }),
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: '保存', onclick: function () { save(); } })
      ])
    });

    drawTree();

    function save() {
      var name = fName.value.trim() || data.name;
      if (!name) { UI.toast('请填写课程名称', 'err'); return; }
      Store.saveGrade(semesterId, {
        key: rec.key,
        source: rec.source || 'manual',
        courseId: rec.courseId || '',
        name: name,
        credit: Math.max(0, parseFloat(fCredit.value) || 0),
        root: root,
        exam: rec.exam || null
      });
      m.close();
      UI.toast('成绩已保存');
      view.render();
    }
  }

  /* ==========================================================
   * 手动添加一门课
   * ========================================================== */
  function addDialog() {
    var sid = SCOPE === 'all' || SCOPE === 'current' ? Store.currentSemesterId : SCOPE;
    var fName = V.input({ placeholder: '例如：线性代数', dataset: { autofocus: '1' } });
    var fCredit = V.input({ type: 'number', min: '0', max: '30', step: '0.5', placeholder: '3' });

    var semOpts = Store.semesters.map(function (s) { return { value: s.id, label: s.name }; });

    var m = V.modal({
      title: '添加一门课',
      width: '440px',
      autofocus: true,
      body: [
        V.field('课程名称', fName),
        el('div', { class: 'field-row' }, [
          V.field('学分', fCredit),
          V.field('归属学期', V.select(semOpts, sid))
        ]),
        el('div', { class: 'ocr-hint', text: '适合记选修、重修或课程表之外的课。加完点进去就能录各项成绩。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '添加',
          onclick: function () {
            var name = fName.value.trim();
            if (!name) { UI.toast('请填写课程名称', 'err'); return; }
            var target = V.$('.cp-modal select').value || sid;
            var key = 'm:' + name + '|' + uid();
            Store.saveGrade(target, {
              key: key, source: 'manual', courseId: '',
              name: name,
              credit: Math.max(0, parseFloat(fCredit.value) || 0),
              root: Store.defaultGradeTree()
            });
            SCOPE = target;
            m.close();
            UI.toast('已添加，可以录入成绩了');
            view.render();
            // 直接打开录入
            var rec = Store.gradeRecord(target, key);
            if (rec) gradeDialog(target, rec);
          }
        })
      ])
    });
  }



  /* ==========================================================
   * 成绩单：导出 CSV / 打印
   * ========================================================== */
  /** 绩点统一两位小数：4 → 4.00 */
  function gpa2(v) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2);
  }

  function fmt(v, digits) {
    if (v == null || v === '' || isNaN(v)) return '—';
    var n = Number(v);
    var p = Math.pow(10, digits || 0);
    return String(Math.round(n * p) / p);
  }

  /** 展开某几个学期的成绩明细 */
  function transcriptRows(ids) {
    var out = [];
    ids.forEach(function (sid) {
      var sem = Store.semesterById(sid);
      Store.gradeList(sid).forEach(function (r) {
        var sc = r.root ? Store.computeGrade(r.root) : null;
        out.push({
          semester: sem ? sem.name : '',
          name: r.name || '',
          credit: Number(r.credit) || 0,
          score: sc,
          gp: sc == null ? null : Store.gpaOf(sc),
          exam: (r.exam && r.exam.date)
            ? (r.exam.date + (r.exam.start ? ' ' + r.exam.start : ''))
            : ''
        });
      });
    });
    return out;
  }

  function csvCell(v) {
    var s = (v == null ? '' : String(v));
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 导出成绩单 CSV（统一走 SaveFile 保存通道，含复制兜底） */
  function downloadText(name, text, mime) {
    SaveFile.save(name, '\ufeff' + text, {
      mime: (mime || 'text/csv').split(';')[0],
      ext: 'csv'
    }).then(function (r) {
      if (r.canceled) { UI.toast('已取消'); return; }
      if (r.method === 'picker' || r.method === 'share') UI.toast('已保存 ' + name, 'ok');
    }).catch(function (e) { UI.toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
  }

  /** 生成一份成绩单数据 */
  function buildTranscript(ids) {
    var cfg = Store.gpaConfig();
    return {
      rows: transcriptRows(ids),
      summary: Store.gradeSummary(ids),
      scale: cfg.scale,
      linear: !!cfg.linear,
      scope: (ids.length === 1)
        ? ((Store.semesterById(ids[0]) || {}).name || '当前学期')
        : ('全部 ' + ids.length + ' 个学期'),
      generated: DateUtil.toStr(new Date())
    };
  }

  function toCsv(t) {
    var lines = ['导出范围,' + t.scope, '导出日期,' + t.generated, ''];
    lines.push(['课程', '学分', '成绩', '绩点（满分 ' + fmt(t.scale, 1) + '）', '学期', '考试时间'].join(','));
    t.rows.forEach(function (r) {
      lines.push([
        csvCell(r.name),
        r.credit,
        r.score == null ? '' : fmt(r.score, 1),
        r.gp == null ? '' : gpa2(r.gp),
        csvCell(r.semester),
        csvCell(r.exam)
      ].join(','));
    });
    lines.push('');
    lines.push([
      csvCell('合计'), t.summary.credits,
      t.summary.weighted == null ? '' : fmt(t.summary.weighted, 1),
      t.summary.gpa == null ? '' : gpa2(t.summary.gpa),
      csvCell(t.summary.scored + '/' + t.summary.count + ' 门已出分'), ''
    ].join(','));
    return lines.join('\r\n');
  }

  function toHtml(t) {
    var sems = {};
    t.rows.forEach(function (r) { sems[r.semester] = 1; });
    var showSem = Object.keys(sems).length > 1;      // 多学期才显示学期列

    var body = t.rows.map(function (r) {
      return '<tr>' +
        '<td class="nm">' + UI.escapeHTML(r.name) + '</td>' +
        (showSem ? '<td class="sm">' + UI.escapeHTML(r.semester) + '</td>' : '') +
        '<td class="num">' + fmt(r.credit, 1) + '</td>' +
        '<td class="num">' + (r.score == null ? '—' : fmt(r.score, 1)) + '</td>' +
        '<td class="num">' + gpa2(r.gp) + '</td>' +
        '<td class="dt">' + UI.escapeHTML(r.exam || '—') + '</td></tr>';
    }).join('');

    return [
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>成绩单</title><style>',
      '* { box-sizing: border-box; }',
      'body { margin: 0; padding: 30px 24px; background: #fff; color: #111827;',
      ' font: 14px/1.65 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }',
      '.wrap { max-width: 780px; margin: 0 auto; }',
      'h1 { font-size: 21px; margin: 0 0 6px; letter-spacing: .5px; }',
      '.meta { font-size: 12px; color: #6b7280; margin-bottom: 18px; }',
      'table { width: 100%; border-collapse: collapse; }',
      'th, td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; }',
      'th { background: #f3f4f6; font-weight: 600; font-size: 12.5px; }',
      '.num { text-align: right; font-variant-numeric: tabular-nums; width: 70px; }',
      '.dt { width: 110px; font-size: 12px; color: #374151; }',
      '.sm { font-size: 11.5px; color: #4b5563; max-width: 150px; }',
      'tfoot td { background: #f9fafb; font-weight: 700; }',
      '@media print { body { padding: 0; } th { background: #eee !important; } }',
      '</style></head><body><div class="wrap">',
      '<h1>成绩单</h1>',
      '<div class="meta">范围：' + UI.escapeHTML(t.scope) + '　导出日期：' + UI.escapeHTML(t.generated) + '</div>',
      '<table><thead><tr><th>课程</th>' + (showSem ? '<th class="sm">学期</th>' : '') +
      '<th class="num">学分</th><th class="num">成绩</th>',
      '<th class="num">绩点</th><th class="dt">考试时间</th></tr></thead><tbody>',
      body,
      '</tbody><tfoot><tr><td>合计</td>' + (showSem ? '<td class="sm">' + UI.escapeHTML(t.scope) + '</td>' : '') +
      '<td class="num">' + fmt(t.summary.credits, 1) +
      '</td><td class="num">' + (t.summary.weighted == null ? '—' : fmt(t.summary.weighted, 1)) +
      '</td><td class="num">' + gpa2(t.summary.gpa) +
      '</td><td class="dt">' + UI.escapeHTML(t.summary.scored + '/' + t.summary.count + ' 门已出分') + '</td></tr></tfoot></table>',
      '</div><script>window.addEventListener("load",function(){window.print();});<\/script></body></html>'
    ].join('');
  }

  /** 导出弹窗：先选学期，再选格式 */
  function exportTranscriptDialog(defaultIds) {
    var allIds = Store.semesters.map(function (s) { return s.id; });
    var ids = (defaultIds && defaultIds.length) ? defaultIds.filter(function (i) {
      return allIds.indexOf(i) >= 0;
    }) : [Store.currentSemesterId];
    if (!ids.length) ids = [Store.currentSemesterId];

    var pickBox = el('div', { class: 'chip-pick days' });
    var previewBox = el('div', { class: 'preview-box' });

    function drawPick() {
      pickBox.innerHTML = '';
      Store.semesters.forEach(function (sem) {
        var on = ids.indexOf(sem.id) >= 0;
        pickBox.appendChild(el('button', {
          class: 'cp-item' + (on ? ' on' : ''), type: 'button',
          onclick: function () {
            var i = ids.indexOf(sem.id);
            if (i >= 0) {
              if (ids.length <= 1) return;
              ids.splice(i, 1);
            } else ids.push(sem.id);
            drawPick();
            drawPreview();
          }
        }, [el('span', { class: 'cp-label', text: sem.name })]));
      });
    }

    function drawPreview() {
      var t = buildTranscript(ids);
      var txt = '已选 <b>' + t.summary.count + '</b> 门课 · <b>' +
        fmt(t.summary.credits, 1) + '</b> 学分';
      if (t.summary.gpa != null) {
        txt += ' · GPA <b>' + fmt(t.summary.gpa, 2) + '</b> / ' + fmt(t.scale, 1) +
               ' · 加权均分 ' + fmt(t.summary.weighted, 1);
      }
      previewBox.innerHTML = '<div class="cp-pv-line">' + txt + '</div>';
    }

    var m = V.modal({
      title: '导出成绩单',
      width: '440px',
      body: [
        el('p', { class: 'ocr-hint', style: { marginBottom: '10px' },
          text: '先选要导出的学期（可多选），再点下面的格式。' }),
        pickBox,
        previewBox
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn',
          onclick: function () {
            var t = buildTranscript(ids);
            downloadText('成绩单-' + t.scope.replace(/[\\/:*?"<>|]/g, '') + '-' + t.generated + '.csv',
              toCsv(t), 'text/csv;charset=utf-8');
            m.close();
          }
        }, [V.svg(V.icons.download, 16), 'CSV']),
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            var t = buildTranscript(ids);
            var w = global.open('', '_blank');
            if (!w) { UI.toast('请允许弹出窗口后重试', 'err'); return; }
            w.document.write(toHtml(t));
            w.document.close();
            m.close();
          }
        }, [V.svg(V.icons.download, 16), '打印 / PDF'])
      ])
    });

    drawPick();
    drawPreview();
  }

  (window.VIEWS = window.VIEWS || []).push(view);
  global.GradeDialog = { add: addDialog, open: gradeDialog };
  global.Transcript = {
    dialog: exportTranscriptDialog,
    build: buildTranscript,
    csv: toCsv,
    html: toHtml,
    fmt: fmt,
    /** 直接按给定学期导出 CSV */
    downloadCsv: function (ids, scopeName) {
      var t = buildTranscript(ids);
      if (scopeName) t.scope = scopeName;
      downloadText('成绩单-' + t.scope.replace(/[\/:*?"<>|]/g, '') + '-' + t.generated + '.csv',
        toCsv(t), 'text/csv;charset=utf-8');
    },
    /** 直接按给定学期打印 */
    print: function (ids, scopeName) {
      var t = buildTranscript(ids);
      if (scopeName) t.scope = scopeName;
      var w = global.open('', '_blank');
      if (!w) { UI.toast('请允许弹出窗口后重试', 'err'); return; }
      w.document.write(toHtml(t));
      w.document.close();
    }
  };
})(window);


