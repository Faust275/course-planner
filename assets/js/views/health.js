/* ==========================================================
 * 视图：健康看板（联动展示，不做主动推送）
 * ----------------------------------------------------------
 * 把分散在 sleeps / metrics / meals / diet 的健康数据，经 Store.dayHealth
 * 收敛成每日档案，再以「看板」形式呈现 5 个联动洞察：
 *   1) 精力预测（昨夜睡眠质量 → 今日精力，复用 SleepModel 质量系数）
 *   2) 步数达成（今日 + 近 7 天迷你条）
 *   3) 热量收支（摄入 / 消耗 TDEE / 净热量 + 体重）
 *   4) 本周健康达成（睡眠达标夜 / 运动达标日 / 平均睡眠质量）
 *   5) 昼夜节律（今日警觉度曲线 + 瞌睡时段，复用 SleepModel）
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
      root.appendChild(this.stepsCard());
      root.appendChild(this.kcalCard(h));
      root.appendChild(this.weekCard());
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

      var bars = el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: '54px', marginTop: '10px' } });
      wk.forEach(function (d) {
        var hp = goal > 0 ? Math.min(100, Math.round(d.steps / goal * 100)) : 0;
        bars.appendChild(el('div', { style: {
          flex: '1', height: Math.max(4, hp) + '%', borderRadius: '3px',
          background: d.steps >= goal ? 'var(--accent)' : 'var(--surface-3)'
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

    /* ---------- 5) 昼夜节律 ---------- */
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
      var wrap = el('div', { style: { marginTop: '4px' } });
      wrap.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">' +
        '<line x1="0" y1="' + (H / 2) + '" x2="' + W + '" y2="' + (H / 2) +
          '" stroke="var(--surface-3)" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
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
