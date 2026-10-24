/* ==========================================================
 * 视图：健康看板（联动展示，不做主动推送）
 * ----------------------------------------------------------
 * 把分散在 sleeps / metrics / meals / diet 的健康数据，经 Store.dayHealth
 * 收敛成每日档案，再以「看板」形式呈现 10 个联动洞察：
 *   1) 精力预测（昨夜睡眠质量 → 今日精力，复用 SleepModel 质量系数）
 *   2) 睡眠债务（近 7 天滚动缺口 + 债务走势）
 *   3) 睡眠规律性（近 n 夜就寝/起床时刻圆周分散度 -> 规律性得分）
 *   4) 深睡 / REM 占比（平均占比 + 是否落在健康区间）
 *   5) 昼夜节律（今日警觉度曲线 + 瞌睡时段，复用 SleepModel）
 *   6) 步数达成（今日 + 近 7 天迷你条）
 *   7) 热量收支（摄入 / 消耗 TDEE / 净热量 + 体重）
 *   8) 本周健康达成（睡眠达标夜 / 运动达标日 / 平均睡眠质量）
 *   9) 课表联动（早八日 vs 非早八日的睡眠对比 + 早八时刻的警觉度）
 *  10) 社交时差（上课日 vs 自由日睡眠中点差）
 * 数据源：安卓端 Health Connect 自动同步 + 手动/OCR 录入；网页端手动/OCR。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var SM = (typeof window !== 'undefined' && window.SleepModel) ||
           (typeof global !== 'undefined' && global.SleepModel) || null;

  /* 分页：overview（睡眠/热量/体重/联动洞察，默认） | activity（步数/消耗/距离，
     由 activity.js 的 ActivityPane 提供）。两者原本是两个独立模块，现已合并。 */
  var healthTab = 'overview';

  function num(v) { return Number(v) || 0; }
  function fmt(v) { return num(v).toLocaleString(); }
  function round1(v) { return Math.round(num(v) * 10) / 10; }
  function weekdayCN(dateStr) {
    var d = DateUtil.parse(dateStr);
    return d ? '日一二三四五六'[d.getDay()] : '';
  }

  /** 取某天活动量：本地存储优先，其次健康联动本次会话的缓存 */
  function metricOf(dateStr) {
    var m = Store.getMetric(dateStr);
    if (m) return m;
    return global.HealthConnect ? HealthConnect.getMetricForDate(dateStr) : null;
  }

  /** 最近 n 天（含今天）步数序列，缺失补 0 */
  function stepsSeries(n) {
    var out = [], today = DateUtil.today();
    for (var i = n - 1; i >= 0; i--) {
      var ds = DateUtil.toStr(DateUtil.addDays(today, -i));
      var m = metricOf(ds);
      out.push({ date: ds, steps: m ? num(m.steps) : 0, has: !!m });
    }
    return out;
  }

  function energyInfo(q) {
    if (q >= 0.8) return { t: '充沛', c: '#22c55e' };
    if (q >= 0.65) return { t: '良好', c: '#84cc16' };
    if (q >= 0.5) return { t: '一般', c: '#eab308' };
    return { t: '低电量', c: '#ef4444' };
  }

  function card(children) {
    return el('div', { class: 'card', style: { padding: '14px', marginBottom: '14px' } },
      children.filter(Boolean));
  }

  function sectionTitle(icon, text) {
    return el('div', { class: 'section-title', style: { marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
      V.svg(icon, 16), el('span', { text: text })
    ]);
  }

  function stat(value, label, color) {
    return el('div', { style: { flex: '1', minWidth: '0', padding: '8px 4px', borderRadius: '10px', background: 'var(--surface-2)', textAlign: 'center' } }, [
      el('div', { style: { fontSize: '16px', fontWeight: '700', color: color || 'var(--text-1)' }, text: String(value) }),
      el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }, text: label })
    ]);
  }

  var view = {
    id: 'health',
    name: '健康',
    icon: V.icons.heart,
    title: '健康看板',
    order: 17,
    nav: true,
    root: null,

    getTab: function () { return healthTab; },
    setTab: function (t) {
      healthTab = (t === 'activity') ? 'activity' : 'overview';
      this.render();
      this.refreshActions();
    },
    defaultTab: 'overview',

    /** 页内切分页不会走 App.go，顶栏操作区得自己重建，否则还留着上一个分页的按钮 */
    refreshActions: function () {
      var box = V.$('#viewActions');
      if (!box) return;
      if (V.cleanupMenus) V.cleanupMenus();
      box.innerHTML = '';
      this.actions(box);
    },

    actions: function (host) {
      // 「活动」分页有自己的操作区（手动记录 / 同步）
      if (healthTab === 'activity') {
        if (global.ActivityPane) global.ActivityPane.actions(host);
        return;
      }
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () { view.setTab('activity'); }
      }, [V.svg(V.icons.heartbeat, 16), '去记录']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-health' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      /* ---- 分页：概览（睡眠/热量/体重/联动洞察） | 活动（步数/消耗/距离） ---- */
      root.appendChild(el('div', { class: 'pane-tabs', style: { marginBottom: '12px' } }, [
        el('button', {
          class: 'pane-tab' + (healthTab !== 'activity' ? ' active' : ''),
          text: '📊 概览',
          onclick: function () { view.setTab('overview'); }
        }),
        el('button', {
          class: 'pane-tab' + (healthTab === 'activity' ? ' active' : ''),
          text: '🏃 活动',
          onclick: function () { view.setTab('activity'); }
        })
      ]));

      if (healthTab === 'activity') {
        var pane = el('div', { id: 'activityPane' });
        root.appendChild(pane);
        if (global.ActivityPane) global.ActivityPane.render(pane);
        return;
      }

      var todayStr = DateUtil.toStr(DateUtil.today());
      var h = Store.dayHealth(todayStr);

      root.appendChild(this.energyCard(h));
      root.appendChild(this.debtCard());
      root.appendChild(this.regularityCard());
      root.appendChild(this.deepRemCard());
      root.appendChild(this.rhythmCard());
      root.appendChild(this.stepsCard());
      root.appendChild(this.kcalCard(h));
      root.appendChild(this.weightCard());
      root.appendChild(this.weekCard());
      root.appendChild(this.courseLinkCard());
      root.appendChild(this.socialJetLagCard());
      root.appendChild(this.lowSleepCard());
      root.appendChild(this.focusCorrCard());
    },

    /* ---------- 1) 精力预测 ---------- */
    energyCard: function (h) {
      var e = energyInfo(h.sleepQ);
      var pct = Math.round(h.sleepQ * 100);
      var children = [
        sectionTitle(V.icons.moon, '今日精力预测'),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } }, [
          el('div', { style: { fontSize: '30px', fontWeight: '800', color: e.c }, text: e.t }),
          el('div', { style: { flex: '1' } }, [
            el('div', { style: { height: '10px', borderRadius: '6px', background: 'var(--surface-2)', overflow: 'hidden' } }, [
              el('div', { style: { height: '100%', width: pct + '%', background: e.c } })
            ]),
            el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '6px' },
              text: '睡眠质量系数 ' + pct + '%' +
                (h.hasSleep ? ' · 昨夜睡眠 ' + (Math.round(h.sleepMin / 6) / 10) + ' 小时' : ' · 昨夜暂无睡眠记录') })
          ])
        ])
      ];
      if (h.sleepQ < 0.5) {
        children.push(el('div', { class: 'cp-tip', style: { marginTop: '10px', color: '#ef4444' },
          text: '⚠ 低电量：今天若有早八 / 考试，注意预留缓冲时间，别排太满' }));
      }
      return card(children);
    },

    /* ---------- 2) 步数达成 ---------- */
    stepsCard: function () {
      var goal = num(Store.settings.stepGoal) || 8000;
      var wk = stepsSeries(7);
      var cur = wk[wk.length - 1];
      var pct = goal > 0 ? Math.min(200, Math.round(cur.steps / goal * 100)) : 0;

      var bars = el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '54px', marginTop: '10px', maxWidth: '560px' } });
      wk.forEach(function (d) {
        var hp = goal > 0 ? Math.min(100, Math.round(d.steps / goal * 100)) : 0;
        bars.appendChild(el('div', { style: {
          flex: '1', height: Math.max(4, hp) + '%', borderRadius: '3px',
          background: d.steps >= goal ? 'var(--primary)' : 'var(--line-strong)'
        } }));
      });

      return card([
        sectionTitle(V.icons.heartbeat, '步数达成'),
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } }, [
          el('div', { style: { fontSize: '26px', fontWeight: '800' }, text: fmt(cur.steps) }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: '/ ' + fmt(goal) + ' 步 · ' + pct + '%' })
        ]),
        bars
      ]);
    },

    /* ---------- 3) 热量收支 ---------- */
    kcalCard: function (h) {
      var children = [
        sectionTitle(V.icons.drop, '热量收支'),
        el('div', { style: { display: 'flex', gap: '10px' } }, [
          stat(h.kcalIn, '摄入 kcal', 'var(--text-1)'),
          stat(h.tdee != null ? h.tdee : '—', '消耗 kcal', 'var(--text-1)'),
          stat(h.netKcal != null ? (h.netKcal > 0 ? ('+' + h.netKcal) : h.netKcal) : '—', '净热量', h.netKcal > 0 ? '#ef4444' : '#22c55e')
        ])
      ];
      if (h.weight != null) {
        children.push(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '8px' },
          text: '当前体重 ' + h.weight + ' kg（消耗按 Mifflin-St Jeor + 活动系数估算）' }));
      }
      if (h.kcalIn === 0 && h.tdee == null) {
        children.push(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '8px' },
          text: '还没有饮食记录。记一笔饮食、补上身高体重后，这里才会算出消耗与净热量。' }));
      }
      return card(children);
    },

    /* ---------- 3.5) 体重曲线 ---------- */
    weightCard: function () {
      var series = Store.weightSeries(90);      // 近 90 天有记录的点
      var latest = Store.latestWeight();

      var fDate = V.input({ type: 'date', value: DateUtil.toStr(DateUtil.today()) });
      var fKg = V.input({
        type: 'number', step: '0.1', min: '20', max: '300', placeholder: 'kg',
        value: latest != null ? String(latest) : ''
      });
      var btn = el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: function () {
          var kg = parseFloat(fKg.value);
          if (!kg || kg < 20 || kg > 300) { UI.toast('请输入合理体重（20–300kg）', 'err'); return; }
          Store.logWeight(fDate.value || DateUtil.toStr(DateUtil.today()), kg);
          UI.toast('已记录体重');
          view.render();
        }
      }, ['记录']);

      var children = [
        sectionTitle(V.icons.heartbeat, '体重曲线'),
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } }, [
          fDate, fKg, btn
        ])
      ];

      if (!series.length) {
        children.push(el('div', {
          style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.7' },
          text: '还没有体重记录。先记一次今天的体重，之后每天记一笔就能看到趋势（也可以选过去的日期补记）。'
        }));
        return card(children);
      }

      var first = series[0], last = series[series.length - 1];
      var diff = Math.round((last.kg - first.kg) * 10) / 10;
      var diffColor = diff > 0.05 ? '#ef4444' : diff < -0.05 ? '#22c55e' : 'var(--text-3)';
      children.push(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' } }, [
        el('div', { style: { fontSize: '26px', fontWeight: '800' }, text: last.kg + ' kg' }),
        el('div', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: last.date + ' · 共 ' + series.length + ' 次' }),
        el('div', { style: { fontSize: '12px', color: diffColor }, text: (diff > 0 ? '+' : '') + diff + ' kg（近 90 天）' })
      ]));
      children.push(V.chartLine(series.map(function (p) {
        return { label: p.date.slice(5), value: p.kg };
      }), { color: 'var(--primary)', fmt: function (v) { return v + ' kg'; } }));
      return card(children);
    },

    /* ---------- 4) 本周健康达成 ---------- */
    weekCard: function () {
      var w = Store.healthWeek(7);
      var h0 = Store.dayHealth(DateUtil.toStr(DateUtil.today()));
      return card([
        sectionTitle(V.icons.sun, '本周健康达成'),
        el('div', { style: { display: 'flex', gap: '10px' } }, [
          stat(w.sleepMetNights + '/' + w.days, '睡眠达标夜(≥' + h0.sleepMinH + 'h)', 'var(--text-1)'),
          stat(w.activeDays + '/' + w.days, '运动达标日(步数)', 'var(--text-1)'),
          stat(Math.round(w.avgQ * 100) + '%', '平均睡眠质量', 'var(--text-1)')
        ])
      ]);
    },

    /* ---------- 2) 睡眠债务 ---------- */
    debtCard: function () {
      var d = Store.sleepDebt(7);
      var debtH = d.debtH;
      var color = debtH >= 4 ? '#ef4444' : debtH >= 2 ? '#eab308' : '#22c55e';

      var c = card([
        sectionTitle(V.icons.moon, '睡眠债务'),
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } }, [
          el('div', { style: { fontSize: '26px', fontWeight: '800', color: color },
            text: debtH > 0 ? debtH + ' h' : '0 h' }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
            text: '累积缺口 · 需求 ' + round1(d.need / 60) + ' h/夜 · 已记录 ' + d.knownNights + '/7 夜' })
        ])
      ]);

      if (!d.knownNights) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' },
          text: '近 7 天没有睡眠记录，暂时算不出债务。记录后这里会显示每日实睡与债务走势。' }));
        return c;
      }

      /* 柱：每日实睡，虚线 = 需求 */
      var W = 300, H = 66, slot = W / d.days.length, barW = slot * 0.52;
      var maxMin = d.need;
      d.days.forEach(function (x) { if (x.total && x.total > maxMin) maxMin = x.total; });
      maxMin = maxMin * 1.08;

      var needY = H - (d.need / maxMin) * H;
      var bars = '', labels = '';
      d.days.forEach(function (x, i) {
        var cx = slot * i + slot / 2;
        if (x.has) {
          var hgt = Math.max(2, (x.total / maxMin) * H);
          var fill = x.total < d.need ? '#f59e0b' : '#22c55e';
          bars += '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + (H - hgt).toFixed(1) +
            '" width="' + barW.toFixed(1) + '" height="' + hgt.toFixed(1) +
            '" rx="2" style="fill:' + fill + ';stroke:none"/>';
        }
        labels += '<text x="' + cx.toFixed(1) + '" y="' + (H + 11) +
          '" text-anchor="middle" font-size="9" style="fill:#8b8f9e;stroke:none">' + weekdayCN(x.date) + '</text>';
      });

      /* 折线：滚动债务（用自己的峰值刻度，避免和柱共用 Y 轴看不清） */
      var H2 = 38, peak = 60, pts = [];
      d.days.forEach(function (x) { if (x.debt > peak) peak = x.debt; });
      d.days.forEach(function (x, i) {
        var cx = slot * i + slot / 2;
        var y = H2 - 3 - (x.debt / peak) * (H2 - 8);
        pts.push(cx.toFixed(1) + ',' + y.toFixed(1));
      });

      // 注意：style.css 里有全局 svg{width:20px;height:20px;fill:none;stroke:currentColor}，
      // 内联图表必须用 style 覆盖尺寸与填充，否则会被压成图标大小。
      var chart = el('div', { style: { marginTop: '10px', maxWidth: '560px' } });
      chart.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + (H + 14) + '" style="width:100%;height:' + (H + 14) +
          'px;display:block;fill:none;stroke:none" preserveAspectRatio="none">' +
          '<line x1="0" y1="' + needY.toFixed(1) + '" x2="' + W + '" y2="' + needY.toFixed(1) +
            '" style="stroke:#9aa0ae;stroke-width:1;stroke-dasharray:4 3" opacity="0.55"/>' +
          bars + labels +
        '</svg>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-top:2px">' +
          '<span>每日实睡（虚线 = 需求）</span><span>低于需求标黄</span>' +
        '</div>' +
        '<svg viewBox="0 0 ' + W + ' ' + H2 + '" style="width:100%;height:' + H2 +
          'px;display:block;fill:none;stroke:none;margin-top:5px" preserveAspectRatio="none">' +
          '<polyline points="' + pts.join(' ') +
            '" style="fill:none;stroke:#ef4444;stroke-width:1.6;stroke-linejoin:round"/>' +
        '</svg>' +
        '<div style="font-size:10px;color:var(--text-3)">债务走势（分钟，近 7 天）</div>';
      c.appendChild(chart);

      if (d.recoverDays > 0) {
        c.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' },
          text: '若每晚多睡 1 小时，约 ' + d.recoverDays + ' 天可还清' }));
      } else {
        c.appendChild(el('div', { style: { fontSize: '11px', color: '#22c55e', marginTop: '4px' },
          text: '没有累积缺口，作息保持得不错' }));
      }
      return c;
    },

    /* ---------- 3) 睡眠规律性 ---------- */
    regularityCard: function () {
      var r = Store.sleepRegularity(14);
      var c = card([sectionTitle(V.icons.clock, '睡眠规律性')]);
      if (!r.hasData) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '需要至少 2 夜带起止时刻的睡眠记录，才能算规律性。' }));
        return c;
      }
      var color = r.score >= 75 ? '#22c55e' : (r.score >= 60 ? '#eab308' : '#ef4444');
      var label = r.score >= 75 ? '规律' : (r.score >= 60 ? '尚可' : '紊乱');
      c.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } }, [
        el('div', { style: { fontSize: '26px', fontWeight: '800', color: color }, text: r.score + ' 分' }),
        el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '规律性 · ' + label + ' · 近 ' + r.known + ' 夜' })
      ]));
      c.appendChild(el('div', { style: { display: 'flex', gap: '10px', marginTop: '8px' } }, [
        stat('±' + r.bedSD + '′', '就寝波动', 'var(--text-1)'),
        stat('±' + r.wakeSD + '′', '起床波动', 'var(--text-1)')
      ]));

      /* 夜轨散布图：18:00 -> 次日 12:00，红=就寝 绿=起床，阴影带 = 均值±SD */
      var W = 300, H = 70, T0 = 1080, T1 = 2160;
      function mapX(t) {
        var t2 = ((t % 1440) + 1440) % 1440;
        if (t2 < T0) t2 += 1440;
        if (t2 > T1) t2 = T1;
        return (t2 - T0) / (T1 - T0) * W;
      }
      function band(mean, sd, color) {
        var a = mapX(mean - sd), b = mapX(mean + sd);
        return '<rect x="' + a.toFixed(1) + '" y="6" width="' + Math.max(2, (b - a)).toFixed(1) +
          '" height="' + (H - 12) + '" style="fill:' + color + ';opacity:0.16;stroke:none"/>';
      }
      function meanLine(mean, color) {
        var x = mapX(mean);
        return '<line x1="' + x.toFixed(1) + '" y1="4" x2="' + x.toFixed(1) + '" y2="' + (H - 4) +
          '" style="stroke:' + color + ';stroke-width:1.2;stroke-dasharray:3 3" opacity="0.85"/>';
      }
      function dots(arr, color) {
        var s = '';
        arr.forEach(function (t) {
          var x = mapX(t);
          s += '<circle cx="' + x.toFixed(1) + '" cy="' + (H / 2) + '" r="2.4" style="fill:' + color + ';stroke:none"/>';
        });
        return s;
      }
      var wrap = el('div', { style: { marginTop: '10px', maxWidth: '560px' } });
      wrap.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;display:block;fill:none;stroke:none" preserveAspectRatio="none">' +
          band(r.bedMean, r.bedSD, '#ef4444') + band(r.wakeMean, r.wakeSD, '#22c55e') +
          meanLine(r.bedMean, '#ef4444') + meanLine(r.wakeMean, '#22c55e') +
          dots(r.nights.map(function (x) { return x.bed; }), '#ef4444') +
          dots(r.nights.map(function (x) { return x.wake; }), '#22c55e') +
        '</svg>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-top:2px">' +
          '<span>就寝 ' + SM.minToHHMM(r.bedMean) + ' · 起床 ' + SM.minToHHMM(r.wakeMean) + '</span>' +
          '<span><span style="color:#ef4444">●</span>就寝 <span style="color:#22c55e">●</span>起床</span>' +
        '</div>';
      c.appendChild(wrap);
      c.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '4px', lineHeight: '1.55' },
        text: '阴影带是各时刻的「均值 ± 标准差」。带越窄越规律；就寝与起床都集中，分数就高。' }));
      return c;
    },

    /* ---------- 4) 深睡 / REM 占比 ---------- */
    deepRemCard: function () {
      var d = Store.deepRemRatio(14);
      var c = card([sectionTitle(V.icons.moon, '深睡 / REM 占比')]);
      if (!d.hasData) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '需要带深睡/REM 时长的睡眠记录（手环同步或 OCR 录入）才能算占比。' }));
        return c;
      }
      function row(label, val, range, ok, color) {
        var W = 300, max = 50;
        function x(p) { return Math.max(0, Math.min(W, p / max * W)); }
        var a = x(range[0]), b = x(range[1]), v = x(val);
        var svg =
          '<svg viewBox="0 0 ' + W + ' 20" style="width:100%;height:20px;display:block;fill:none;stroke:none" preserveAspectRatio="none">' +
            '<rect x="0" y="6" width="' + W + '" height="8" rx="4" style="fill:var(--line-strong);opacity:0.5;stroke:none"/>' +
            '<rect x="' + a.toFixed(1) + '" y="6" width="' + Math.max(1, (b - a)).toFixed(1) + '" height="8" style="fill:#22c55e;opacity:0.35;stroke:none"/>' +
            '<rect x="0" y="6" width="' + v.toFixed(1) + '" height="8" rx="4" style="fill:' + color + ';stroke:none"/>' +
            '<line x1="' + v.toFixed(1) + '" y1="2" x2="' + v.toFixed(1) + '" y2="18" style="stroke:#fff;stroke-width:1.5"/>' +
          '</svg>';
        var svgWrap = el('div', { style: { maxWidth: '560px' } });
        svgWrap.innerHTML = svg;
        return el('div', { style: { marginTop: '6px' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px' } }, [
            el('span', { text: label }),
            el('span', { style: { color: ok ? '#22c55e' : '#eab308', fontWeight: '700' },
              text: val + '% · 参考 ' + range[0] + '–' + range[1] + '%' + (ok ? ' ✓' : ' 偏离') })
          ]),
          svgWrap
        ]);
      }
      c.appendChild(row('深睡', d.avgDeep, d.deepRange, d.deepOk, '#6366f1'));
      c.appendChild(row('REM', d.avgRem, d.remRange, d.remOk, '#0ea5e9'));
      var verdict;
      if (d.deepOk && d.remOk) verdict = '深睡与 REM 都落在健康区间，睡眠结构完整，身体修复与记忆巩固都到位。';
      else if (!d.deepOk && !d.remOk) verdict = '深睡、REM 都偏离参考区间，多半是睡眠不足或质量差，留意总时长与睡前刺激。';
      else if (!d.deepOk) verdict = '深睡偏低：身体修复不够，试试提前就寝、减少睡前屏幕与酒精。';
      else verdict = 'REM 偏低：梦境睡眠偏少，可能与压力、药物或饮酒有关，注意睡前放松。';
      c.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '8px', lineHeight: '1.55' }, text: verdict }));
      return c;
    },

    /* ---------- 10) 社交时差 ---------- */
    socialJetLagCard: function () {
      var s = Store.socialJetLag(28);
      var c = card([sectionTitle(V.icons.sun, '社交时差')]);
      if (!s.hasData) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '需要睡眠记录才能算时差。上课日与自由日都会纳入对比。' }));
        return c;
      }
      if (!s.both) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '目前只覆盖一侧（' + (s.schoolN ? '仅上课日 ' + s.schoolN + ' 夜' : '仅自由日 ' + s.freeN + ' 夜') + '），暂无可比结论。' }));
        return c;
      }
      function fmtGap(g) {
        if (g <= 0) return '0′';
        var h = Math.floor(g / 60), m = g % 60;
        if (h && m) return h + 'h' + m + '′';
        if (h) return h + 'h';
        return m + '′';
      }
      var gap = s.gapMin || 0;
      var color = gap <= 30 ? '#22c55e' : (gap <= 60 ? '#eab308' : '#ef4444');
      var label = gap <= 30 ? '几乎无' : (gap <= 60 ? '轻度' : '明显');
      c.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } }, [
        el('div', { style: { fontSize: '26px', fontWeight: '800', color: color }, text: fmtGap(gap) }),
        el('div', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: '社交时差 · ' + label })
      ]));
      c.appendChild(el('div', { style: { display: 'flex', gap: '10px', marginTop: '8px' } }, [
        stat(SM.minToHHMM(s.schoolMid), '上课日睡眠中点 · ' + s.schoolN + ' 夜', 'var(--text-1)'),
        stat(SM.minToHHMM(s.freeMid), '自由日睡眠中点 · ' + s.freeN + ' 夜', 'var(--text-1)')
      ]));

      /* 夜轨：上课日中点 vs 自由日中点 */
      var W = 300, H = 56, T0 = 1080, T1 = 2160;
      function mapX(t) {
        var t2 = ((t % 1440) + 1440) % 1440;
        if (t2 < T0) t2 += 1440;
        if (t2 > T1) t2 = T1;
        return (t2 - T0) / (T1 - T0) * W;
      }
      function mk(mid, color) {
        var x = mapX(mid);
        return '<line x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) +
            '" style="stroke:#9aa0ae;stroke-width:1;stroke-dasharray:3 3" opacity="0.4"/>' +
          '<line x1="' + x.toFixed(1) + '" y1="6" x2="' + x.toFixed(1) + '" y2="' + (H - 6) +
            '" style="stroke:' + color + ';stroke-width:2"/>' +
          '<circle cx="' + x.toFixed(1) + '" cy="' + (H / 2) + '" r="4" style="fill:' + color + ';stroke:none"/>';
      }
      var wrap = el('div', { style: { marginTop: '10px', maxWidth: '560px' } });
      wrap.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;display:block;fill:none;stroke:none" preserveAspectRatio="none">' +
          mk(s.schoolMid, '#ef4444') + mk(s.freeMid, '#22c55e') +
        '</svg>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-top:2px">' +
          '<span><span style="color:#ef4444">●</span>上课日中点 ' + SM.minToHHMM(s.schoolMid) + '</span>' +
          '<span><span style="color:#22c55e">●</span>自由日中点 ' + SM.minToHHMM(s.freeMid) + '</span>' +
        '</div>';
      c.appendChild(wrap);
      var verdict;
      if (gap <= 30) verdict = '几乎没有社交时差，作息与课表一致，生物钟没有被周末「补觉」打乱。';
      else if (gap <= 60) verdict = '轻度社交时差：自由日比上课日晚起约 ' + gap + ' 分钟，周末别一次补太多觉，免得周一更难起。';
      else verdict = '明显社交时差（约 ' + Math.floor(gap / 60) + ' 小时）：自由日大幅后移，相当于每周末飞一个时区。慢慢把就寝往前挪，别靠周一强行早起硬扛。';
      c.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '6px', lineHeight: '1.55' }, text: verdict }));
      return c;
    },

    /* ---------- 6) 课表联动 ---------- */
    courseLinkCard: function () {
      var lk = Store.courseLink(28);
      var c = card([sectionTitle(V.icons.book, '课表联动 · 早八 vs 非早八')]);

      if (!lk.hasData) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '需要「有课 + 有睡眠记录」的日子才能对比，当前样本不足。' }));
        return c;
      }

      var eq = Math.round(lk.earlyAvgQ * 100);
      var lq = Math.round(lk.lateAvgQ * 100);
      var dq = Math.round(Math.abs(lk.deltaQ) * 100);
      var dm = Math.round(Math.abs(lk.deltaMin));
      var both = lk.earlyDays.length > 0 && lk.lateDays.length > 0;

      c.appendChild(el('div', { style: { display: 'flex', gap: '10px' } }, [
        stat(eq + '%', '早八日均质量 · ' + lk.earlyDays.length + ' 天',
          (both && lk.deltaQ < -0.03) ? '#ef4444' : 'var(--text-1)'),
        stat(lq + '%', '非早八日均质量 · ' + lk.lateDays.length + ' 天', 'var(--text-1)'),
        stat(both ? ((lk.deltaQ >= 0 ? '+' : '−') + dq + ' pt') : '—', '质量差',
          (both && lk.deltaQ < 0) ? '#ef4444' : '#22c55e')
      ]));

      var verdict;
      if (!both) {
        verdict = '样本只覆盖一侧（' + (lk.earlyDays.length ? '仅早八日' : '仅非早八日') + '），暂无可比结论。';
      } else if (lk.deltaQ <= -0.05) {
        verdict = '早八日的睡眠质量平均低 ' + dq + ' 分、少睡 ' + dm +
          ' 分钟——早课正在挤压睡眠，值得往后调 20–30 分钟就寝。';
      } else if (lk.deltaQ >= 0.05) {
        verdict = '早八日反而睡得更好（+' + dq + ' 分），作息大概已经适应早课节奏。';
      } else {
        verdict = '早八与否对睡眠影响不明显（差 ' + dq + ' 分、' + dm + ' 分钟）。';
      }
      c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '8px', lineHeight: '1.55' },
        text: verdict }));

      /* 把早八时刻叠到警觉度曲线上：直观显示「那天这个时候你到底清不清醒」 */
      var ec = Store.nextEarlyClass(7);
      if (!ec || !SM) return c;

      var todayStr = DateUtil.toStr(DateUtil.today());
      // 优先用「早八那天的真实昨夜」；没有就退回今天作息推算，并在标注里讲明
      var ownRec = Store.nightOn(ec.date);
      var rec = ownRec || Store.nightOn(todayStr);
      var night = rec ? SM.normalizeNight(rec) : null;
      if (!night) return c;

      var curve = SM.alertnessCurve(night, { step: 15, spanHours: 18 });
      if (!curve.length) return c;

      var CW = 300, CH = 96;
      var line = '';
      curve.forEach(function (p, i) {
        var x = (i / (curve.length - 1)) * CW;
        var y = CH - (p.score / 100) * CH;
        line += (i ? ' ' : '') + x.toFixed(1) + ',' + y.toFixed(1);
      });

      var wakeClock = ((night.wake % 1440) + 1440) % 1440;
      var clsMin = SM.toMin(ec.start);
      var delta = clsMin == null ? 0 : (((clsMin - wakeClock) % 1440) + 1440) % 1440;
      var spanMin = 18 * 60;
      var cx = Math.min(CW, (delta / spanMin) * CW);
      var score = Math.max(0, Math.min(100, SM.alertnessAt(night, delta / 60)));
      var markColor = score < 60 ? '#ef4444' : (score < 75 ? '#eab308' : '#22c55e');

      var wrap = el('div', { style: { marginTop: '10px', maxWidth: '560px' } });
      wrap.innerHTML =
        '<svg viewBox="0 0 ' + CW + ' ' + CH + '" style="width:100%;height:' + CH +
          'px;display:block;fill:none;stroke:none" preserveAspectRatio="none">' +
          '<line x1="0" y1="' + (CH * 0.4) + '" x2="' + CW + '" y2="' + (CH * 0.4) +
            '" style="stroke:#9aa0ae;stroke-width:1;stroke-dasharray:3 3" opacity="0.5"/>' +
          '<polyline points="' + line +
            '" style="fill:none;stroke:var(--primary);stroke-width:2;stroke-linejoin:round"/>' +
          '<line x1="' + cx.toFixed(1) + '" y1="0" x2="' + cx.toFixed(1) + '" y2="' + CH +
            '" style="stroke:' + markColor + ';stroke-width:1.5;stroke-dasharray:4 3"/>' +
          '<circle cx="' + cx.toFixed(1) + '" cy="' + (CH - (score / 100) * CH).toFixed(1) +
            '" r="3.5" style="fill:' + markColor + ';stroke:none"/>' +
        '</svg>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-top:2px">' +
          '<span>醒来 ' + (rec.end || '') + ' 起的警觉度</span>' +
          '<span style="color:' + markColor + '">' +
          (ownRec ? '' : '按今天作息推算 · ') +
          (ec.date === todayStr ? '今天' : ec.date.slice(5)) +
          ' ' + ec.start + ' ' + ec.name + ' · 警觉度 ' + score + '</span>' +
        '</div>';
      c.appendChild(wrap);

      if (score < 60) {
        c.appendChild(el('div', { class: 'cp-tip', style: { marginTop: '6px', color: '#ef4444', fontSize: '11px' },
          text: '这个点警觉度偏低，早八前留 10 分钟清醒缓冲，别把最难的复习放在第一节前。' }));
      }
      return c;
    },

    /* ---------- 7) 昼夜节律 ---------- */
    rhythmCard: function () {
      var rec = Store.sleepForDay(DateUtil.toStr(DateUtil.today()));
      var night = (rec && SM) ? SM.normalizeNight(rec) : null;
      var c = card([sectionTitle(V.icons.bed, '昼夜节律')]);
      if (!night) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '暂无昨夜睡眠记录。记录后可看今日警觉度曲线与瞌睡时段建议。' }));
        return c;
      }
      var curve = SM.alertnessCurve(night, { step: 20, spanHours: 18 });
      var W = 300, H = 110, max = 100;
      var pts = curve.map(function (p, i) {
        var x = (i / (curve.length - 1)) * W;
        var y = H - (p.score / max) * H;
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      var wrap = el('div', { style: { marginTop: '4px', maxWidth: '560px' } });
      wrap.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H +
          'px;display:block;fill:none;stroke:none" preserveAspectRatio="none">' +
        '<line x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) +
          '" style="stroke:#9aa0ae;stroke-width:1;stroke-dasharray:3 3" opacity="0.5"/>' +
        '<polyline points="' + pts +
          '" style="fill:none;stroke:var(--primary);stroke-width:2;stroke-linejoin:round"/>' +
        '</svg>';
      c.appendChild(wrap);

      var drow = SM.drowsinessWindows(night);
      c.appendChild(el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
        drow.map(function (w) {
          var label = w.type === 'inertia' ? '刚醒' : (w.type === 'afternoon' ? '午后低谷' : '睡前收尾');
          return el('span', {
            style: { fontSize: '11px', padding: '3px 8px', borderRadius: '12px', background: 'var(--surface-2)', color: 'var(--text-2)' },
            text: label + ' ' + w.start + '–' + w.end
          });
        })));
      return c;
    },

    /* ---------- 低质量睡眠连续预警 ---------- */
    lowSleepCard: function () {
      var s = Store.lowSleepStreak();
      var c = card([sectionTitle(V.icons.moon, '睡眠预警')]);
      if (!s.has) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '近 14 天没有睡眠记录，录入后这里会提示连续低质量睡眠与近 7 天平均质量。' }));
        return c;
      }
      if (s.streak >= 2) {
        c.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
            borderRadius: '10px', background: 'var(--red-tint, #fde8e8)', color: 'var(--red)',
            fontSize: '13px', fontWeight: '600', marginBottom: '8px' }
        }, [
          el('span', { text: '⚠️ 已连续 ' + s.streak + ' 天睡眠不佳（质量<50%），注意补觉' })
        ]));
      } else {
        c.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
            borderRadius: '10px', background: 'var(--surface-2)', color: 'var(--text-2)',
            fontSize: '13px', marginBottom: '8px' }
        }, [
          el('span', { text: s.lowCount7 ? ('近 14 天有 ' + s.lowCount7 + ' 天睡眠不佳，但已中断') : '近期睡眠节奏平稳，没有连续低质量' })
        ]));
      }
      c.appendChild(el('div', { style: { display: 'flex', gap: '10px' } }, [
        stat(s.avg7 == null ? '—' : s.avg7 + '%', '近 7 天平均质量', 'var(--text-1)'),
        stat(s.lowCount7, '近 14 天低质夜', 'var(--text-1)')
      ]));
      return c;
    },

    /* ---------- 睡眠 ↔ 专注相关性 ---------- */
    focusCorrCard: function () {
      var r = Store.sleepFocusCorr(28);
      var c = card([sectionTitle(V.icons.clock, '睡眠 × 专注')]);
      if (!r.has) {
        c.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '需要「同时有睡眠记录 + 专注记录」的日期 ≥ 5 天才能看出相关性（当前 ' +
            (r.n || 0) + ' 天）。多记几天睡眠、多用番茄钟即可解锁。' }));
        return c;
      }
      var rColor = r.r >= 0.3 ? '#22c55e' : (r.r >= 0 ? '#eab308' : '#ef4444');
      var rText = r.r >= 0.5 ? '强正相关' : (r.r >= 0.3 ? '中等正相关' : (r.r >= 0 ? '弱正相关' : '负相关'));
      c.appendChild(el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } }, [
        el('div', { style: { fontSize: '26px', fontWeight: '800', color: rColor }, text: (r.r > 0 ? '+' : '') + r.r }),
        el('div', { style: { fontSize: '12px', color: 'var(--text-3)' },
          text: 'Pearson 相关系数 · ' + rText + ' · 样本 ' + r.n + ' 天' })
      ]));
      var goodTxt = r.goodAvg == null ? '—' : r.goodAvg + ' 分钟';
      var badTxt = r.badAvg == null ? '—' : r.badAvg + ' 分钟';
      c.appendChild(el('div', { style: { display: 'flex', gap: '10px', marginTop: '8px' } }, [
        stat(goodTxt, '睡眠好(≥70%)日均专注', 'var(--green)'),
        stat(badTxt, '睡眠差(<50%)日均专注', 'var(--red)')
      ]));
      return c;
    }
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(typeof window !== 'undefined' ? window : this);
