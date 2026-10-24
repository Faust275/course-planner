/* ==========================================================
 * 视图：健康看板（联动展示，不做主动推送）
 * ----------------------------------------------------------
 * 把分散在 sleeps / metrics / meals / diet 的健康数据，经 Store.dayHealth
 * 收敛成每日档案，再以「看板」形式呈现 7 个联动洞察：
 *   1) 精力预测（昨夜睡眠质量 → 今日精力，复用 SleepModel 质量系数）
 *   2) 睡眠债务（近 7 天滚动缺口 + 债务走势）
 *   3) 步数达成（今日 + 近 7 天迷你条）
 *   4) 热量收支（摄入 / 消耗 TDEE / 净热量 + 体重）
 *   5) 本周健康达成（睡眠达标夜 / 运动达标日 / 平均睡眠质量）
 *   6) 课表联动（早八日 vs 非早八日的睡眠对比 + 早八时刻的警觉度）
 *   7) 昼夜节律（今日警觉度曲线 + 瞌睡时段，复用 SleepModel）
 * 数据源：安卓端 Health Connect 自动同步 + 手动/OCR 录入；网页端手动/OCR。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var SM = (typeof window !== 'undefined' && window.SleepModel) ||
           (typeof global !== 'undefined' && global.SleepModel) || null;

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

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () {
          var v = App.views.filter(function (x) { return x.id === 'activity'; })[0];
          if (v) App.go('activity');
        }
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

      var todayStr = DateUtil.toStr(DateUtil.today());
      var h = Store.dayHealth(todayStr);

      root.appendChild(this.energyCard(h));
      root.appendChild(this.debtCard());
      root.appendChild(this.stepsCard());
      root.appendChild(this.kcalCard(h));
      root.appendChild(this.weekCard());
      root.appendChild(this.courseLinkCard());
      root.appendChild(this.rhythmCard());
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
    }
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(typeof window !== 'undefined' ? window : this);
