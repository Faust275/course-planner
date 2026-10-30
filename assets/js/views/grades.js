

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
      if (!root) return;
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

      // 自动分项是可选项，默认关闭；这里只做一次轻提示，不挡路
      if (!(Store.settings && Store.settings.gradeAutoAttendance) && !(Store.settings && Store.settings.gradeAutoTasks)) {
        root.appendChild(el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
            margin: '-2px 0 10px', fontSize: '12px', color: 'var(--text-3)'
          }
        }, [
          el('span', { text: '💡 平时分还能按「出勤率 / 待办完成率」自动折算（默认关闭）。' }),
          el('button', {
            class: 'btn btn-sm', type: 'button', text: '去开启',
            onclick: function () { App.go('settings', { tab: 'gpa' }); }
          })
        ]));
      }

      /* ---- 课程列表（只显示已填学分的课程；未设学分的课表课程不再自动出现） ---- */
      var list = [];
      ids.forEach(function (sid) {
        Store.gradeList(sid, false).forEach(function (r) {
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
        var disp = Store.gradeScoreOf ? Store.gradeScoreOf(r) : { scale: 'percent', score: r.root ? Store.computeGrade(r.root) : null, gp: null, label: '' };
        var score = disp.score;
        var wCheck = (r.root && r.scale !== 'level' && r.scale !== 'pass' && Store.validateGradeWeights) ? Store.validateGradeWeights(r.root) : { valid: true };
        var hasSavedStruct = disp.scale === 'percent' && !!(r.root && Array.isArray(r.root.children) && r.root.children.length);
        var structSummary = hasSavedStruct
          ? r.root.children.map(function (c) { return (c.name || '分项') + ' ' + (Number(c.weight) || 0) + '%'; }).join(' + ')
          : '';
        var semName = ids.length > 1 ? (Store.semesterById(item.semesterId) || {}).name : '';
        var isPass = disp.scale === 'pass';
        var isEmpty = !isPass && disp.scale !== 'level' && score == null;
        var dotColor = isPass ? (disp.label === '通过' ? '#10b981' : '#ef4444')
          : (score == null ? (hasSavedStruct ? '#0ea5e9' : '#cbd5e1') : gradeColor(score));
        box.appendChild(el('div', {
          class: 'grade-row' + (isEmpty ? ' pending' : ''),
          onclick: function () { gradeDialog(item.semesterId, r); }
        }, [
          el('span', { class: 'gr-dot', style: { background: dotColor } }),
          el('div', { class: 'gr-main' }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
              el('b', { text: r.name }),
              disp.scale === 'level' ? el('span', {
                class: 'chip', style: { fontSize: '10px', padding: '0 5px' }, text: '等级制'
              }) : null,
              isPass ? el('span', {
                class: 'chip', style: { fontSize: '10px', padding: '0 5px' }, text: '通过制'
              }) : null,
              !wCheck.valid ? el('span', {
                class: 'chip chip-amber',
                style: { fontSize: '10px', padding: '0 5px' },
                text: '⚠️ 占比待配平'
              }) : null
            ]),
            el('span', { text: [
              r.credit ? r.credit + ' 学分' : '未设学分（点此设置）',
              semName ? semName.slice(0, 12) : '',
              r.source === 'manual' ? '手动添加' : '来自课程表',
              structSummary ? ('构成：' + structSummary) : '',
              (function () {
                if (!r.courseId || !Store.courseInvest) return '';
                var iv = Store.courseInvest(r.courseId, r.name);
                if (!iv || iv.minutes < 30) return '';
                return '投入 ' + (Math.round(iv.minutes / 6) / 10) + 'h / ' + iv.sessions + ' 次';
              })()
            ].filter(Boolean).join(' · ') })
          ]),
          el('div', { class: 'gr-score' }, [
            el('b', { text: disp.label || (hasSavedStruct ? '已设构成' : '未录入') }),
            isPass
              ? el('span', { text: 'P/F · 不计 GPA' })
              : (isEmpty
                ? (hasSavedStruct ? el('span', { text: '待填小分' }) : null)
                : el('span', { text: '总评 · ' + gpa2(disp.gp != null ? disp.gp : Store.gpaOf(score)) + ' 绩点' }))
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
  var GRADE_TEMPLATES = [
    {
      label: '四六开（平时40 + 期末60）',
      children: [
        { name: '平时', weight: 40, children: [] },
        { name: '期末', weight: 60, children: [] }
      ]
    },
    {
      label: '三七开（平时30 + 期末70）',
      children: [
        { name: '平时', weight: 30, children: [] },
        { name: '期末', weight: 70, children: [] }
      ]
    },
    {
      label: '含期中（平时20 + 期中30 + 期末50）',
      children: [
        { name: '平时', weight: 20, children: [
          { name: '考勤', weight: 40, children: [] },
          { name: '作业', weight: 60, children: [] }
        ] },
        { name: '期中', weight: 30, children: [] },
        { name: '期末', weight: 50, children: [] }
      ]
    },
    {
      label: '含实验（平时20 + 实验30 + 期末50）',
      children: [
        { name: '平时', weight: 20, children: [] },
        { name: '实验', weight: 30, children: [] },
        { name: '期末', weight: 50, children: [] }
      ]
    },
    {
      label: '五五开（平时50 + 期末50）',
      children: [
        { name: '平时', weight: 50, children: [] },
        { name: '期末', weight: 50, children: [] }
      ]
    }
  ];

  function gradeDialog(semesterId, rec, opts) {
    opts = opts || {};
    var sid = semesterId || Store.currentSemesterId;
    var latestRec = Store.gradeRecord(sid, rec.key, rec.courseId) || rec;
    var isNew = !latestRec.root;
    var root = latestRec.root
      ? Store.sanitizeGradeTree(JSON.parse(JSON.stringify(latestRec.root)), true)
      : Store.defaultGradeTree();
    var data = {
      name: latestRec.name || '',
      credit: Number(latestRec.credit) || 0
    };
    // 计分方式：percent / level（五级制）/ pass（通过制）
    var scale = (latestRec.scale === 'level' || latestRec.scale === 'pass') ? latestRec.scale : 'percent';
    var levelKey = latestRec.level || 'B';
    var passed = latestRec.passed !== false;

    var computedEls = [];
    var groupStatusEls = [];
    var totalEl = null;
    var gpaEl = el('i', { class: 'gr-gpa', text: '' });
    var treeBox = el('div', { class: 'gr-tree' });
    // 自动分项入口：只有在设置里开启后才出现（默认关闭）
    var autoTools = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 8px' } });
    (function () {
      function addAuto(source, label) {
        syncTreeFromDOM();
        root.children = root.children || [];
        root.children.push({
          id: uid(), name: label, weight: 10, score: null, children: [], source: source
        });
        dirty = true;
        drawTree();
        refresh();
        UI.toast('已添加「' + label + '」，记得把占比调成你要的比例');
      }
      if (Store.settings && Store.settings.gradeAutoAttendance) {
        autoTools.appendChild(el('button', {
          class: 'btn btn-sm', type: 'button',
          title: '按「已标记考勤」的出勤率自动折算这一项',
          onclick: function () { addAuto('attendance', '出勤率（自动）'); }
        }, ['＋ 出勤率（自动）']));
      }
      if (Store.settings && Store.settings.gradeAutoTasks) {
        autoTools.appendChild(el('button', {
          class: 'btn btn-sm', type: 'button',
          title: '按这门课的待办完成率自动折算这一项',
          onclick: function () { addAuto('tasks', '作业完成率（自动）'); }
        }, ['＋ 作业完成率（自动）']));
      }
      if (!autoTools.children.length) autoTools.style.display = 'none';
    })();
    var weightAuditBox = el('div', { class: 'gr-weight-audit' });
    var dirty = false; void dirty;
    var explicitCancel = false;
    var savedOnce = false;

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
        wiOut.innerHTML = '<span class="cp-gr-wi-hint gr-wi-hint">输入一个假设总评，看看整体 GPA 怎么变</span>';
        return;
      }
      var after = Store.gradeSummary(ids, [{ semesterId: sid, key: latestRec.key, score: hy }]);
      var dg = (base.gpa != null && after.gpa != null) ? after.gpa - base.gpa : null;
      var dw = (base.weighted != null && after.weighted != null) ? after.weighted - base.weighted : null;
      var gColor = dg == null ? 'inherit' : (dg > 0.004 ? 'var(--green)' : dg < -0.004 ? 'var(--red)' : 'inherit');
      var parts = [];
      parts.push('整体 GPA <b>' + gpa2(base.gpa) + '</b> → <b style="color:' + gColor + '">' + gpa2(after.gpa) + '</b>');
      if (dg != null && Math.abs(dg) > 0.004) parts.push('<span class="cp-gr-wi-delta gr-wi-delta ' + (dg > 0 ? 'cp-up up' : 'cp-down down') + '">' + (dg > 0 ? '+' : '') + gpa2(dg) + '</span>');
      parts.push('加权均分 ' + fmt(base.weighted, 1) + ' → <b>' + fmt(after.weighted, 1) + '</b>');
      if (dw != null && Math.abs(dw) > 0.05) parts.push('<span class="cp-gr-wi-delta gr-wi-delta ' + (dw > 0 ? 'cp-up up' : 'cp-down down') + '">' + (dw > 0 ? '+' : '') + fmt(dw, 1) + '</span>');
      wiOut.innerHTML = parts.join('　');
    }
    wiInp.addEventListener('input', refreshWhatIf);

    function findNodeById(node, id) {
      if (!node) return null;
      if (node.id === id) return node;
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          var hit = findNodeById(node.children[i], id);
          if (hit) return hit;
        }
      }
      return null;
    }

    function renderWeightAudit() {
      weightAuditBox.innerHTML = '';
      if (!Store.validateGradeWeights) return;
      var report = Store.validateGradeWeights(root);
      var groupMap = {};
      (report.groups || []).forEach(function (g) {
        groupMap[g.nodeId] = g;
      });

      // 实时刷新每个有子项的父行内联占比提示
      groupStatusEls.forEach(function (item) {
        var g = groupMap[item.node.id];
        if (!g) { item.el.textContent = ''; return; }
        if (g.match100) {
          item.el.textContent = '子项Σ=100%';
          item.el.style.color = 'var(--green)';
        } else if (g.matchParent) {
          item.el.textContent = '子项Σ=' + g.sumWeight + '%(=母值)';
          item.el.style.color = 'var(--primary)';
        } else {
          var dTxt = g.diff100 > 0 ? ('+' + g.diff100 + '%') : (g.diff100 + '%');
          item.el.textContent = '⚠️ 子项Σ=' + g.sumWeight + '%(' + dTxt + ')';
          item.el.style.color = 'var(--red)';
        }
      });

      if (!report.groups.length) return;

      if (report.valid) {
        var hasRelativeParent = report.groups.some(function (g) { return g.matchParent && !g.match100; });
        weightAuditBox.appendChild(el('div', {
          style: {
            marginTop: '8px', padding: '7px 11px', borderRadius: '8px',
            background: 'rgba(16, 185, 129, 0.09)', border: '1px solid rgba(16, 185, 129, 0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap',
            fontSize: '12px', color: 'var(--green)'
          }
        }, [
          el('span', {
            text: hasRelativeParent
              ? '✓ 各层子成绩占比校验通过（子项之和等于母项占比，已自动按相对比例折算）'
              : '✓ 各层子成绩占比之和均等于 100%，成绩构成校验通过'
          }),
          hasRelativeParent ? el('button', {
            type: 'button',
            class: 'btn btn-sm',
            style: { height: '24px', padding: '0 8px', fontSize: '11px' },
            onclick: function () {
              report.groups.forEach(function (g) {
                if (g.matchParent && !g.match100) {
                  var nd = findNodeById(root, g.nodeId);
                  if (nd) Store.normalizeGradeWeights(nd, 100);
                }
              });
              dirty = true;
              drawTree();
              silentPersist();
              UI.toast('已将子项占比转换为标准 100% 制并自动保存');
            }
          }, ['转为 100% 制']) : null
        ]));
        return;
      }

      // 存在子项占比之和不等于母值的情况：逐项列出并提供一键配平
      var warnWrap = el('div', {
        style: {
          marginTop: '8px', padding: '9px 11px', borderRadius: '8px',
          background: 'rgba(245, 158, 11, 0.10)', border: '1px solid rgba(245, 158, 11, 0.35)',
          display: 'flex', flexDirection: 'column', gap: '6px'
        }
      });
      report.issues.forEach(function (iss) {
        var row = el('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }
        }, [
          el('span', {
            style: { color: '#d97706', fontWeight: '600' },
            text: '⚠️ ' + iss.message
          }),
          el('div', { style: { display: 'flex', gap: '5px' } }, [
            el('button', {
              type: 'button',
              class: 'btn btn-sm',
              style: { height: '24px', padding: '0 8px', fontSize: '11px' },
              onclick: function () {
                var targetNode = findNodeById(root, iss.nodeId);
                if (targetNode && Store.normalizeGradeWeights) {
                  Store.normalizeGradeWeights(targetNode, 100);
                  dirty = true;
                  drawTree();
                  silentPersist();
                  UI.toast('已将「' + iss.nodeName + '」的子项占比配平为 100% 并自动保存');
                }
              }
            }, ['⚡ 配平为 100%']),
            (!iss.isRoot && iss.parentWeight > 0 && iss.parentWeight !== 100) ? el('button', {
              type: 'button',
              class: 'btn btn-sm',
              style: { height: '24px', padding: '0 8px', fontSize: '11px' },
              onclick: function () {
                var targetNode = findNodeById(root, iss.nodeId);
                if (targetNode && Store.normalizeGradeWeights) {
                  Store.normalizeGradeWeights(targetNode, iss.parentWeight);
                  dirty = true;
                  drawTree();
                  silentPersist();
                  UI.toast('已将「' + iss.nodeName + '」的子项占比配平为母值 ' + iss.parentWeight + '% 并自动保存');
                }
              }
            }, ['配平为母值 ' + iss.parentWeight + '%']) : null
          ])
        ]);
        warnWrap.appendChild(row);
      });
      weightAuditBox.appendChild(warnWrap);
    }

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
      renderWeightAudit();
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
      if (scale === 'percent' && treeBox && treeBox.children && treeBox.children.length) {
        syncTreeFromDOM();
      }
      if (scale !== 'percent') { drawScalePanel(); return; }
      // 从等级制/通过制切回百分制时，要把模板栏重新显示出来（drawScalePanel 里隐藏过）
      tplBar.style.display = '';
      treeBox.innerHTML = '';
      computedEls = [];
      groupStatusEls = [];
      walk(root, 0, null);
      refresh();
    }

    /* ---- 等级制 / 通过制：不画成绩构成树，只给一个选择器 ---- */
    function drawScalePanel() {
      treeBox.innerHTML = '';
      tplBar.style.display = 'none';
      weightAuditBox.innerHTML = '';
      if (scale === 'level') {
        var rules = Store.gradeLevels();
        treeBox.appendChild(V.field('等级', V.segment(rules.map(function (r) {
          return { value: r.key, label: r.name };
        }), levelKey, function (v) {
          levelKey = v;
          dirty = true;
          refreshScaleTotal();
        }), '分数换算是为了算加权均分；绩点按这张表单独给'));
      } else {
        treeBox.appendChild(V.field('是否通过', V.toggle(passed, function (v) {
          passed = v;
          dirty = true;
          refreshScaleTotal();
        }), 'P/F 课程只计学分，不计入 GPA 与加权均分'));
      }
      refreshScaleTotal();
    }

    function refreshScaleTotal() {
      if (scale === 'level') {
        var lv = Store.gradeLevel(levelKey);
        if (totalEl) totalEl.textContent = lv.name + '（' + lv.score + ' 分）';
        if (gpaEl) gpaEl.textContent = 'GPA ' + gpa2(lv.gp);
      } else {
        if (totalEl) totalEl.textContent = passed ? '通过' : '未通过';
        if (gpaEl) gpaEl.textContent = '不计 GPA';
      }
    }

    function walk(node, depth, parent) {
      var hasKids = node.children && node.children.length;

      var nameInp = V.input({
        value: node.name,
        placeholder: depth === 0 ? '总评' : '分项名称（如平时、作业、期末）',
        class: 'input gr-name'
      });
      function commitName() {
        var nv = nameInp.value.trim();
        if (nv) node.name = nv;
        dirty = true;
        renderWeightAudit();
      }
      nameInp.addEventListener('input', commitName);
      nameInp.addEventListener('change', commitName);
      nameInp.addEventListener('blur', commitName);

      var wInp = V.input({
        type: 'number', min: '0', max: '100', step: '0.5',
        value: node.weight != null ? node.weight : 0,
        disabled: depth === 0 ? 'disabled' : null,
        title: depth === 0 ? '总评固定为 100%' : '占上一级的百分比权重',
        class: 'input gr-weight'
      });
      function commitWeight() {
        if (depth === 0) { node.weight = 100; wInp.value = '100'; return; }
        var raw = parseFloat(wInp.value);
        node.weight = isNaN(raw) ? 0 : Math.max(0, Math.min(100, Math.round(raw * 100) / 100));
        dirty = true;
        refresh();
      }
      wInp.addEventListener('input', commitWeight);
      wInp.addEventListener('change', commitWeight);
      wInp.addEventListener('blur', function () {
        commitWeight();
        if (depth === 0) { wInp.value = '100'; return; }
        wInp.value = String(node.weight);
      });

      var scoreCell = el('span', { class: 'gr-val' });
      if (hasKids) {
        var valSpan = el('i', { text: '' });
        scoreCell.appendChild(valSpan);
        computedEls.push({ node: node, el: valSpan });
        var subBadge = el('small', { text: ' 自动', style: { whiteSpace: 'nowrap' } });
        scoreCell.appendChild(subBadge);
        groupStatusEls.push({ node: node, el: subBadge });
      } else {
        var sInp = V.input({
          type: 'number', min: '0', max: '150', step: '0.5',
          value: (node.score == null || node.score === '' ? '' : node.score),
          placeholder: '得分(可空)', class: 'input gr-score-inp'
        });
        function commitScore() {
          var vStr = String(sInp.value || '').trim();
          if (vStr === '') {
            node.score = null;
          } else {
            var num = parseFloat(vStr);
            node.score = isNaN(num) ? null : Math.max(0, Math.min(150, Math.round(num * 100) / 100));
          }
          dirty = true;
          refresh();
        }
        sInp.addEventListener('input', commitScore);
        sInp.addEventListener('change', commitScore);
        sInp.addEventListener('blur', function () {
          commitScore();
          sInp.value = (node.score == null || node.score === '') ? '' : String(node.score);
        });
        scoreCell.appendChild(sInp);
      }

      var row = el('div', { class: 'gr-node', style: { paddingLeft: (depth * 18) + 'px' } }, [
        nameInp,
        el('span', { class: 'gr-w-cell' }, [wInp, el('i', { text: '%' })]),
        scoreCell,
        el('span', { class: 'gr-ops' }, [
          el('button', {
            type: 'button',
            class: 'icon-btn', title: '在此项下添加子成绩项',
            onclick: function () {
              syncTreeFromDOM();
              node.children = node.children || [];
              if (node.children.length === 0) {
                // 首次把叶子拆分为父节点时，直接帮用户生成两个加起来 100% 的默认子项（保留原分数到子项1），避免单子项 0% 导致算不出分
                var prevScore = node.score;
                node.score = null;
                node.children.push(
                  { id: uid(), name: (node.name || '分项') + '明细 1', weight: 50, score: prevScore != null ? prevScore : null, children: [] },
                  { id: uid(), name: (node.name || '分项') + '明细 2', weight: 50, score: null, children: [] }
                );
              } else {
                var curSum = node.children.reduce(function (s, c) { return s + (Number(c.weight) || 0); }, 0);
                var rem = Math.max(0, Math.round((100 - curSum) * 10) / 10);
                node.children.push({
                  id: uid(),
                  name: '新子项 ' + (node.children.length + 1),
                  weight: rem > 0 ? rem : 10,
                  score: null,
                  children: []
                });
              }
              dirty = true;
              drawTree();
            }
          }, [V.svg(V.icons.plus, 14)]),
          parent ? el('button', {
            type: 'button',
            class: 'icon-btn', title: '删除这一项',
            onclick: function () {
              syncTreeFromDOM();
              var hit = findParent(root, node.id, null);
              if (hit) hit.parent.children.splice(hit.idx, 1);
              dirty = true;
              drawTree();
            }
          }, [V.svg(V.icons.trash, 14)]) : null
        ])
      ]);
      row._node = node;
      row._nameInp = nameInp;
      row._wInp = wInp;
      row._sInp = hasKids ? null : sInp;
      treeBox.appendChild(row);

      if (hasKids) {
        node.children.forEach(function (ch) { walk(ch, depth + 1, node); });
      }
    }

    /* ---- 常用成绩构成模板栏（保留已填同名的分数） ---- */
    function applyTemplate(tpl) {
      syncTreeFromDOM();
      var oldScores = {};
      (function collectScores(nd) {
        if (!nd) return;
        if (nd.name && nd.score != null && (!nd.children || !nd.children.length)) {
          oldScores[nd.name.trim()] = nd.score;
        }
        (nd.children || []).forEach(collectScores);
      })(root);

      function buildFromTpl(list) {
        return (list || []).map(function (item) {
          var kids = item.children && item.children.length ? buildFromTpl(item.children) : [];
          return {
            id: uid(),
            name: item.name,
            weight: Number(item.weight) || 0,
            score: (!kids.length && Object.prototype.hasOwnProperty.call(oldScores, item.name)) ? oldScores[item.name] : null,
            children: kids
          };
        });
      }
      root.children = buildFromTpl(tpl.children);
      dirty = true;
      drawTree();
      silentPersist();
      UI.toast('已套用「' + tpl.label + '」构成模板并自动保存');
    }

    var tplBar = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }
    }, [
      el('span', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '快捷构成模板：' })
    ].concat(GRADE_TEMPLATES.map(function (tpl) {
      return el('button', {
        type: 'button',
        class: 'btn btn-sm',
        style: { height: '24px', padding: '0 8px', fontSize: '11px' },
        text: tpl.label.replace(/（.*）/, ''),
        title: tpl.label,
        onclick: function () { applyTemplate(tpl); }
      });
    })));

    var fName = V.input({ value: data.name, class: 'input' });
    var fCredit = V.input({ type: 'number', min: '0', max: '30', step: '0.5', value: data.credit || '', placeholder: '例如 3', class: 'input' });

    var scaleBar = V.field('计分方式', V.segment([
      { value: 'percent', label: '百分制' },
      { value: 'level', label: '等级制' },
      { value: 'pass', label: '通过制' }
    ], scale, function (v) {
      syncTreeFromDOM();
      scale = v;
      dirty = true;
      drawTree();
    }), '等级制按「优/良/中/及格/不及格」记；通过制只记学分，不进 GPA 与加权均分');

    var m = V.modal({
      title: isNew ? '录入成绩与构成' : '成绩构成与明细',
      width: '580px',
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
        scaleBar,
        tplBar,
        autoTools,
        treeBox,
        weightAuditBox,
        el('div', { class: 'gr-whatif' }, [
          el('div', { class: 'gr-whatif-head' }, ['模拟：这门考多少？']),
          el('div', { class: 'gr-whatif-row' }, [wiInp]),
          wiOut
        ]),
        (function () {
          var matchedCourse = null;
          var courses = Store.courses || [];
          if (latestRec.courseId) {
            matchedCourse = courses.filter(function (c) { return c.id === latestRec.courseId; })[0] || null;
          }
          if (!matchedCourse && data.name) {
            matchedCourse = courses.filter(function (c) { return c.name === data.name; })[0] || null;
          }
          var cid = matchedCourse ? matchedCourse.id : (latestRec.courseId || '');
          var cname = (matchedCourse && matchedCourse.name) || data.name || '本课程';
          var sessions = (Store.pomodoro && Store.pomodoro.sessions) || [];
          var focusMin = 0, focusCnt = 0;
          sessions.forEach(function (ss) {
            if (!ss) return;
            var hit = (cid && ss.courseId === cid);
            if (!hit && ss.taskId) {
              var tk = Store.getTask(ss.taskId);
              if (tk && ((cid && tk.courseId === cid) || tk.title.indexOf(cname) >= 0)) hit = true;
            }
            if (!hit && Array.isArray(ss.tags) && ss.tags.indexOf('学习/' + cname) >= 0) hit = true;
            if (hit) { focusMin += (Number(ss.minutes) || 0); focusCnt++; }
          });
          var cTasks = (Store.tasks || []).filter(function (t) {
            return !t.parentId && ((cid && t.courseId === cid) || (t.tags || []).indexOf('学习/' + cname) >= 0);
          });
          var doneTasks = cTasks.filter(function (t) { return t.status === 'done'; }).length;

          var prepBox = el('div', {
            class: 'gr-prep-link',
            style: {
              marginTop: '10px', padding: '10px 12px', borderRadius: '8px',
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              display: 'flex', flexDirection: 'column', gap: '8px'
            }
          });
          prepBox.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', fontSize: '12px', color: 'var(--text-2)' }
          }, [
            el('span', { text: '🍅 课程累计投入：' + (focusMin > 0 ? (TimeUtil.humanMin(focusMin) + '（' + focusCnt + ' 🍅）') : '暂无专注记录') }),
            el('span', { text: '📋 关联待办：' + doneTasks + '/' + cTasks.length + ' 已完成' })
          ]));

          var actRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
          actRow.appendChild(el('button', {
            class: 'btn btn-sm',
            type: 'button',
            onclick: function () {
              var curName = fName.value.trim() || cname;
              var stages = [
                { key: 'round1', title: '📖 【' + curName + '】一轮通读与梳理核心考点', priority: 'medium', offset: -10 },
                { key: 'papers', title: '✍️ 【' + curName + '】历年真题与错题复盘', priority: 'high', offset: -5 },
                { key: 'sprint', title: '🔥 【' + curName + '】考前背诵与查漏补缺冲刺', priority: 'high', offset: -1 }
              ];
              var examDateStr = (matchedCourse && matchedCourse.exam && matchedCourse.exam.date)
                || (latestRec.exam && latestRec.exam.date) || '';
              var createdIds = [];
              stages.forEach(function (st) {
                var exists = (Store.tasks || []).some(function (t) {
                  return !t.parentId && t.examStage === st.key &&
                    ((cid && t.courseId === cid) || (t.title && t.title.indexOf(curName) >= 0));
                });
                if (exists) return;
                var due = '';
                if (examDateStr) {
                  var ed = DateUtil.parse(examDateStr);
                  if (ed) {
                    var targetD = DateUtil.addDays(ed, st.offset);
                    var todayD = DateUtil.today();
                    due = DateUtil.toStr(targetD < todayD ? todayD : targetD);
                  }
                }
                var nt = Store.addTask({
                  title: st.title,
                  courseId: cid || '',
                  examStage: st.key,
                  priority: st.priority,
                  dueDate: due,
                  tags: ['学习/' + curName, '备考']
                });
                if (nt && nt.id) createdIds.push(nt.id);
              });
              if (!createdIds.length) {
                UI.toast('「' + curName + '」的三阶段备考待办已存在，无需重复生成');
              } else {
                m.close();
                if (UI.toastAction) {
                  UI.toastAction('已为「' + curName + '」生成 ' + createdIds.length + ' 项三阶段备考待办', {
                    actionText: '🍅 立即专注首项',
                    duration: 6000,
                    onAction: function () {
                      if (global.App && App.focusTask) App.focusTask(createdIds[0]);
                    }
                  });
                } else {
                  UI.toast('已生成 ' + createdIds.length + ' 项备考待办', 'ok');
                }
              }
            }
          }, ['🛟 考前自救：一键生成三阶段复习待办']));

          if (matchedCourse) {
            actRow.appendChild(el('button', {
              class: 'btn btn-sm',
              type: 'button',
              onclick: function () {
                m.close();
                App.go('schedule');
              }
            }, ['📅 去课表 / 备考看板 ›']));
          }
          prepBox.appendChild(actRow);
          return prepBox;
        })(),
        el('div', { class: 'ocr-hint', text: '💡 每一项都可以只填占比先保存构成（得分留空即可），出分后再随时补录；系统会自动检测各层子项占比之和是否等于母值（100% 或父项占比）。' })
      ],
      onClose: function () {
        if (!explicitCancel && !savedOnce) {
          syncTreeFromDOM();
          silentPersist();
          UI.toast('已自动保存成绩构成与明细', 'ok');
          if (opts && typeof opts.onSaved === 'function') {
            try { opts.onSaved(); } catch (e) {}
          }
          if (view.root) view.render();
        }
      },
      footer: el('div', { class: 'modal-foot' }, [
        isNew ? null : el('button', {
          class: 'btn btn-danger', text: '清除成绩',
          onclick: function () {
            explicitCancel = true;
            m.close();
            V.confirm({
              title: '清除成绩', message: '会删掉「' + data.name + '」已经录入的分数与构成，课程本身保留。',
              danger: true, okText: '清除'
            }).then(function (ok) {
              if (!ok) return;
              Store.removeGrade(sid, latestRec.key);
              UI.toast('已清除');
              view.render();
            });
          }
        }),
        el('button', { class: 'btn', text: '取消', onclick: function () { explicitCancel = true; m.close(); } }),
        el('button', { class: 'btn btn-primary', text: '保存', onclick: function () { save(false); } })
      ])
    });

    fName.addEventListener('input', function () { dirty = true; });
    fCredit.addEventListener('input', function () { dirty = true; });

    drawTree();

    function syncTreeFromDOM() {
      if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (e) {}
      }
      if (scale !== 'percent') return;
      var rows = treeBox.querySelectorAll('.gr-node');
      rows.forEach(function (row) {
        var n = row._node;
        if (!n) return;
        if (row._nameInp) {
          var nm = String(row._nameInp.value || '').trim();
          n.name = nm || n.name || (n === root ? '总评' : '分项');
        }
        if (row._wInp && !row._wInp.disabled) {
          var raw = parseFloat(row._wInp.value);
          if (!isNaN(raw)) n.weight = Math.max(0, Math.min(100, Math.round(raw * 100) / 100));
        }
        if (row._sInp) {
          var vStr = String(row._sInp.value || '').trim();
          if (vStr === '') {
            n.score = null;
          } else {
            var num = parseFloat(vStr);
            if (!isNaN(num)) n.score = Math.max(0, Math.min(150, Math.round(num * 100) / 100));
          }
        }
      });
      dirty = true;
    }

    function writeGradeToStore(name, creditVal) {
      syncTreeFromDOM();
      var saveKey = latestRec.key || ('c:' + name);
      if (latestRec.source === 'course' || String(saveKey).indexOf('c:') === 0) {
        saveKey = 'c:' + name;
        if (latestRec.key && latestRec.key !== saveKey && Store.state.grades[sid]) {
          delete Store.state.grades[sid][latestRec.key];
        }
      }
      Store.saveGrade(sid, {
        key: saveKey,
        source: latestRec.source || 'manual',
        courseId: latestRec.courseId || '',
        name: name,
        credit: creditVal,
        root: root,
        scale: scale,
        level: scale === 'level' ? levelKey : '',
        passed: scale === 'pass' ? passed : undefined,
        exam: latestRec.exam || null
      });
      latestRec.key = saveKey;
      dirty = false;
    }

    function silentPersist() {
      var name = (fName && fName.value ? fName.value.trim() : '') || data.name;
      if (!name) return false;
      var creditVal = Math.max(0, parseFloat(fCredit && fCredit.value) || data.credit || 0);
      writeGradeToStore(name, creditVal);
      return true;
    }

    function doPersist(name, creditVal) {
      savedOnce = true;
      writeGradeToStore(name, creditVal);
      if (Store.flushSave) Store.flushSave();
      m.close();
      var gSync = Store.lastGradeGoalSync;
      if (gSync && gSync.gpa != null && gSync.matchedKRs && gSync.matchedKRs.length) {
        var kr0 = gSync.matchedKRs[0];
        var krNote = kr0.reached
          ? (' 🎉 已达成目标「' + kr0.goalTitle + '」GPA 要求！')
          : (' · 目标「' + kr0.goalTitle + '」进度已更新至 ' + (kr0.pct || 0) + '%');
        UI.toast('成绩构成与分数已保存 · 当前学期 GPA ' + gSync.gpa.toFixed(2) + krNote, 'ok');
      } else {
        UI.toast('成绩构成与分数已保存', 'ok');
      }
      if (opts && typeof opts.onSaved === 'function') {
        try { opts.onSaved(); } catch (e) {}
      }
      if (view.root) view.render();
    }

    function save(skipAuditConfirm) {
      syncTreeFromDOM();
      var name = fName.value.trim() || data.name;
      if (!name) { UI.toast('请填写课程名称', 'err'); fName.focus(); return; }
      var creditVal = Math.max(0, parseFloat(fCredit.value) || 0);
      // 等级制 / 通过制没有成绩构成，跳过占比校验
      if (scale !== 'percent') { doPersist(name, creditVal); return; }
      var report = Store.validateGradeWeights ? Store.validateGradeWeights(root) : { valid: true, issues: [] };
      if (!report.valid && !skipAuditConfirm) {
        var msgLines = report.issues.map(function (iss) { return '· ' + iss.message; });
        msgLines.push('');
        msgLines.push('是否一键将异常子项自动按比例配平为 100% 并保存？（点「直接保存原值」将保留当前填写的原占比）');
        V.confirm({
          title: '子成绩占比之和不等于母值',
          message: msgLines.join('\n'),
          okText: '⚡ 自动配平并保存',
          cancelText: '直接保存原值',
          closeValue: null
        }).then(function (autoFix) {
          if (autoFix === null) return;
          if (autoFix === true) {
            report.issues.forEach(function (iss) {
              var nd = findNodeById(root, iss.nodeId);
              if (nd && Store.normalizeGradeWeights) Store.normalizeGradeWeights(nd, 100);
            });
          }
          doPersist(name, creditVal);
        });
        return;
      }
      doPersist(name, creditVal);
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
        var disp = Store.gradeScoreOf ? Store.gradeScoreOf(r) : { scale: 'percent', score: r.root ? Store.computeGrade(r.root) : null, gp: null, label: '' };
        out.push({
          semester: sem ? sem.name : '',
          name: r.name || '',
          credit: Number(r.credit) || 0,
          score: disp.score,
          // 等级制/通过制在成绩单上显示等级文字，而不是编一个分数
          scoreLabel: disp.scale === 'percent' ? (disp.score == null ? '' : fmt(disp.score, 1)) : disp.label,
          scale: disp.scale,
          gp: disp.gp,
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
        r.scoreLabel != null ? r.scoreLabel : (r.score == null ? '' : fmt(r.score, 1)),
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
        '<td class="num">' + (r.scoreLabel ? UI.escapeHTML(r.scoreLabel) : (r.score == null ? '—' : fmt(r.score, 1))) + '</td>' +
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
            var htmlStr = toHtml(t);
            var fname = '成绩单-' + t.scope.replace(/[\\/:*?"<>|]/g, '') + '-' + t.generated + '.html';
            m.close();
            if (global.SaveFile && SaveFile.openHtmlPrintModal) {
              SaveFile.openHtmlPrintModal('📄 成绩单预览与打印 / 导出', htmlStr, fname);
            } else {
              var w = global.open('', '_blank');
              if (!w) { UI.toast('请允许弹出窗口后重试', 'err'); return; }
              w.document.write(htmlStr);
              w.document.close();
            }
          }
        }, [V.svg(V.icons.download, 16), '打印 / PDF'])
      ])
    });

    drawPick();
    drawPreview();
  }

  (window.VIEWS = window.VIEWS || []).push(view);
  function openForCourse(courseId, opts) {
    var c = Store.getCourse(courseId);
    if (!c) { if (global.App) App.go('grades'); return; }
    var sid = c.semesterId || Store.currentSemesterId;
    var rec = Store.gradeRecord(sid, 'c:' + c.name, c.id) || {
      key: 'c:' + c.name,
      source: 'course',
      courseId: c.id,
      name: c.name,
      credit: (Number(c.credit) > 0) ? Number(c.credit) : 0,
      root: null,
      exam: c.exam || null
    };
    gradeDialog(sid, rec, opts);
  }

  global.GradeDialog = { add: addDialog, open: gradeDialog, openForCourse: openForCourse };
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
      var htmlStr = toHtml(t);
      var fname = '成绩单-' + t.scope.replace(/[\/:*?"<>|]/g, '') + '-' + t.generated + '.html';
      if (global.SaveFile && SaveFile.openHtmlPrintModal) {
        SaveFile.openHtmlPrintModal('📄 成绩单预览与打印 / 导出', htmlStr, fname);
        return;
      }
      var w = global.open('', '_blank');
      if (!w) { UI.toast('请允许弹出窗口后重试', 'err'); return; }
      w.document.write(htmlStr);
      w.document.close();
    }
  };
})(window);


