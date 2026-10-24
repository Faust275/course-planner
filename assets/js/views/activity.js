/* ==========================================================
 * 视图：我的活动（步数 / 活动消耗 / 距离）
 * ----------------------------------------------------------
 * 数据来自两处：
 *   1) Store.metrics —— 已持久化的每日活动量（健康联动同步或手动录入）；
 *   2) HealthConnect 内存缓存 —— 本次启动刚拉到、还没落盘的数据。
 * 展示：今日进度 + 近 7 天趋势 + 近 7 天汇总 + 14 天明细。
 * 无数据时提供「授权 / 同步」入口；也支持手动补录任意一天。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var DEFAULT_GOAL = 8000;

  function num(v) { return Number(v) || 0; }

  function fmt(v) { return num(v).toLocaleString(); }

  /** 米 -> 公里（保留 1 位；10km 以上不保留小数） */
  function km(meters) {
    var v = num(meters) / 1000;
    return v >= 10 ? v.toFixed(0) : v.toFixed(1);
  }

  /** 取某天活动量：本地存储优先，其次健康联动本次会话的缓存 */
  function metricOf(dateStr) {
    var m = Store.getMetric(dateStr);
    if (m) return m;
    return global.HealthConnect ? HealthConnect.getMetricForDate(dateStr) : null;
  }

  /** 最近 n 天（含今天，升序）的活动量序列，缺失补 0 */
  function series(n) {
    var out = [];
    var today = DateUtil.today();
    for (var i = n - 1; i >= 0; i--) {
      var d = DateUtil.addDays(today, -i);
      var ds = DateUtil.toStr(d);
      var m = metricOf(ds);
      out.push({
        date: ds,
        d: d,
        steps: m ? num(m.steps) : 0,
        calories: m ? num(m.calories) : 0,
        distance: m ? num(m.distance) : 0,
        source: (m && m.source) || null,
        has: !!m
      });
    }
    return out;
  }

  function statBox(label, value, unit) {
    return el('div', {
      style: {
        flex: '1', minWidth: '0', padding: '10px 6px', borderRadius: '10px',
        background: 'var(--surface-2)', textAlign: 'center'
      }
    }, [
      el('div', { style: { fontSize: '16px', fontWeight: '700', color: 'var(--text-1)' }, text: value }),
      el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }, text: label + (unit ? '（' + unit + '）' : '') })
    ]);
  }

  /* ==========================================================
   * 活动分页（原「我的活动」独立模块，已并入健康模块的「活动」分页）
   * ----------------------------------------------------------
   * 挂在健康页里当分页用，自己不再注册视图；旧深链接 #/activity
   * 由 router 的别名转成 #/health/activity。
   * 其余逻辑（授权 / 同步 / 手动补录 / 改目标）保持原样。
   * ========================================================== */
  var view = {
    root: null,      // 宿主容器（每次 render 传进来）
    _fetching: false,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () { view.editDay(DateUtil.toStr(DateUtil.today())); }
      }, ['手动记录']));
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { view.sync(); }
      }, [V.svg(V.icons.download, 16), '同步']));
    },

    /** @param {HTMLElement} [host] 宿主容器；不传则沿用上次的 */
    render: function (host) {
      var self = this;
      if (host) this.root = host;
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      var todayStr = DateUtil.toStr(DateUtil.today());
      var goal = num(Store.settings.stepGoal) || DEFAULT_GOAL;
      var all = series(14);
      var week = all.slice(-7);
      var cur = all[all.length - 1];

      root.appendChild(this.heroCard(cur, goal));
      root.appendChild(this.trendCard(week, goal));
      root.appendChild(this.summaryCard(week, goal));
      if (!cur.has && !week.some(function (x) { return x.has; })) {
        root.appendChild(this.emptyCard());
      }
      root.appendChild(this.listCard(all));

      // 今日还没有数据：静默补拉一次（开关关闭 / 未安装 / 拉取中都不做）
      if (!cur.has && Store.settings.healthAutoSync !== false && global.HealthConnect &&
          !self._fetching) {
        self._fetching = true;
        HealthConnect.autoSync().then(function (ok) {
          self._fetching = false;
          if (ok) { persistCachedMetrics(); self.render(); }
        }).catch(function () { self._fetching = false; });
      }
    },

    /* ---------- 今日主卡 ---------- */
    heroCard: function (cur, goal) {
      var self = this;
      var pct = goal > 0 ? Math.min(100, Math.round(cur.steps / goal * 100)) : 0;
      var done = cur.steps >= goal && goal > 0;
      var left = Math.max(0, goal - cur.steps);

      var card = el('div', { class: 'card', style: { padding: '16px' } });
      card.appendChild(el('div', { class: 'section-title' }, [
        V.svg(V.icons.heartbeat, 16),
        '今日活动',
        el('span', {
          class: 'q-count',
          text: cur.has ? (cur.source === 'manual' ? '手动记录' : '健康联动') : '暂无数据'
        })
      ]));

      card.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'flex-end', gap: '8px', marginTop: '8px' }
      }, [
        el('div', {
          style: { fontSize: '34px', fontWeight: '800', lineHeight: '1', color: 'var(--text-1)' },
          text: fmt(cur.steps)
        }),
        el('div', {
          style: { fontSize: '13px', color: 'var(--text-3)', paddingBottom: '4px' },
          text: '步' + (goal > 0 ? ' / 目标 ' + fmt(goal) : '')
        })
      ]));

      if (cur.has && goal > 0) {
        card.appendChild(el('div', { class: 'dp-bar', style: { marginTop: '12px' } }, [
          el('i', {
            style: { width: pct + '%', background: done ? 'var(--green)' : 'var(--primary)' }
          })
        ]));
        card.appendChild(el('div', {
          style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' },
          text: pct + '%' + (done ? ' · 今日目标已达成' : ' · 还差 ' + fmt(left) + ' 步')
        }));
      } else if (!cur.has) {
        card.appendChild(el('div', {
          style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' },
          text: '今天还没有数据，可点右上角「同步」或「手动记录」'
        }));
      }

      card.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        this.metricBox('👟', '步数', fmt(cur.steps), '步'),
        this.metricBox('🔥', '活动消耗', fmt(cur.calories), '千卡'),
        this.metricBox('📏', '距离', km(cur.distance), '公里')
      ]));

      card.appendChild(el('div', {
        style: { marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }
      }, [
        el('button', { class: 'dp-link', onclick: function () { self.setGoal(); } }, ['改目标 →'])
      ]));
      return card;
    },

    metricBox: function (icon, label, value, unit) {
      return el('div', {
        style: {
          flex: '1', minWidth: '0', textAlign: 'center', padding: '10px 4px',
          borderRadius: '10px', background: 'var(--surface-2)'
        }
      }, [
        el('div', { style: { fontSize: '20px', lineHeight: '1.2' }, text: icon }),
        el('div', { style: { fontSize: '17px', fontWeight: '700', color: 'var(--text-1)', marginTop: '2px' }, text: value }),
        el('div', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: label + (unit ? '（' + unit + '）' : '') })
      ]);
    },

    /* ---------- 近 7 天趋势 ---------- */
    trendCard: function (week, goal) {
      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, ['近 7 天步数']));

      var items = week.map(function (x) {
        return {
          label: DOW[x.d.getDay()],
          value: x.steps,
          color: (goal > 0 && x.steps >= goal) ? 'var(--green)' : 'var(--primary)',
          title: x.date + ' · ' + fmt(x.steps) + ' 步',
          active: x.date === DateUtil.toStr(DateUtil.today())
        };
      });
      card.appendChild(V.chartBars(items, { fmt: function (v) { return fmt(v); } }));
      if (goal > 0) {
        card.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '8px', textAlign: 'center' },
          text: '绿色表示达成每日 ' + fmt(goal) + ' 步目标'
        }));
      }
      return card;
    },

    /* ---------- 近 7 天汇总 ---------- */
    summaryCard: function (week, goal) {
      var total = 0, activeDays = 0, hit = 0, best = week[0];
      week.forEach(function (x) {
        total += x.steps;
        if (x.has) activeDays++;
        if (goal > 0 && x.steps >= goal) hit++;
        if (x.steps > best.steps) best = x;
      });
      var avg = activeDays ? Math.round(total / activeDays) : 0;

      // 连续达标：从今天往前数；今天还没达标不算断（一天还没过完）
      var streak = 0;
      if (goal > 0) {
        for (var i = week.length - 1; i >= 0; i--) {
          if (week[i].steps >= goal) { streak++; continue; }
          if (i === week.length - 1) continue;
          break;
        }
      }

      var notes = [];
      if (best.steps > 0) {
        notes.push('最活跃是 ' + best.date + '（' + DOW[best.d.getDay()] + '），' + fmt(best.steps) + ' 步');
      }
      if (goal > 0) notes.push(streak > 0 ? ('连续达标 ' + streak + ' 天') : '还没开始达标');

      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, [
        '近 7 天汇总',
        el('span', { class: 'q-count', text: activeDays + ' 天有数据' })
      ]));
      card.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } }, [
        statBox('总步数', fmt(total), ''),
        statBox('日均', fmt(avg), '步'),
        statBox('达标', String(hit), '天')
      ]));
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '10px' },
        text: notes.length ? notes.join(' · ') : '还没有足够的数据来对比'
      }));
      return card;
    },

    /* ---------- 无数据提示 ---------- */
    emptyCard: function () {
      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, ['怎么拿到数据']));
      card.appendChild(el('div', { class: 'q-empty', text: '活动量来自系统 Health Connect。请确认：① 手机已安装 Health Connect；② 小米运动健康 / Zepp Life 里开启了「同步到 Health Connect」；③ 点下方按钮完成一次授权。' }));
      card.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
        el('button', { class: 'btn btn-primary', onclick: function () { view.sync(); } }, ['授权并同步']),
        el('button', { class: 'btn', onclick: function () { view.editDay(DateUtil.toStr(DateUtil.today())); } }, ['先手动填'])
      ]));
      return card;
    },

    /* ---------- 14 天明细 ---------- */
    listCard: function (all) {
      var self = this;
      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, [
        '近 14 天明细',
        el('span', { class: 'q-count', text: '点击一行可修改' })
      ]));

      all.slice().reverse().forEach(function (x) {
        card.appendChild(el('div', {
          class: 'rec-row',
          onclick: function () { self.editDay(x.date); }
        }, [
          el('i', {
            class: 'rec-dot',
            style: { background: x.has ? 'var(--primary)' : 'var(--line-strong)', opacity: '.55' }
          }),
          el('span', { class: 'rec-main' }, [
            el('b', { text: x.date + ' · ' + DOW[x.d.getDay()] }),
            el('span', { text: x.has ? (x.source === 'manual' ? '手动记录' : '健康联动') : '无记录' })
          ]),
          el('span', { class: 'rec-val' }, [
            el('em', { text: fmt(x.steps) + ' 步' }),
            el('em', {
              style: { color: 'var(--text-3)', fontWeight: '400' },
              text: x.calories ? (fmt(x.calories) + ' 千卡') : ''
            })
          ])
        ]));
      });
      return card;
    },

    /* ---------- 交互 ---------- */

    /** 从 Health Connect 拉一次（会弹系统授权），成功后落盘并重绘 */
    sync: function () {
      var self = this;
      if (!global.HealthConnect) {
        UI.toast('网页版没有健康联动，请在安卓 App 里使用', 'err');
        return;
      }
      UI.toast('正在读取健康数据…');
      HealthConnect.request().then(function () {
        return HealthConnect.autoSync();
      }).then(function (ok) {
        if (!ok) {
          UI.toast('没读到数据，请确认小米运动健康已开启「同步到 Health Connect」', 'err');
          return;
        }
        persistCachedMetrics();
        self.render();
        UI.toast('已同步', 'ok');
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : '未授权或 Health Connect 不可用';
        UI.toast('同步失败：' + msg, 'err');
      });
    },

    /** 手动补录/修改某天的活动量 */
    editDay: function (dateStr) {
      var self = this;
      var m = metricOf(dateStr) || {};
      var fSteps = V.input({ type: 'number', min: '0', value: m.steps != null ? String(m.steps) : '', placeholder: '例如 8000' });
      var fCal = V.input({ type: 'number', min: '0', value: m.calories != null ? String(m.calories) : '', placeholder: '例如 320' });
      var fDist = V.input({ type: 'number', min: '0', step: '0.1', value: m.distance != null ? String(m.distance) : '', placeholder: '米，例如 5600' });

      var body = el('div', {}, [
        el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px' }, text: '日期：' + dateStr }),
        V.field('步数', fSteps),
        V.field('活动消耗（千卡）', fCal),
        V.field('距离（米）', fDist, '手动录入的这一天不会被健康联动自动覆盖')
      ]);

      var m2 = V.modal({ title: '记录活动量', width: '380px', body: body });
      m2.setFooter(el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
        el('button', { class: 'btn', onclick: function () { m2.close(); } }, ['取消']),
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            var s = Number(fSteps.value) || 0;
            var c = Number(fCal.value) || 0;
            var dd = Math.round(Number(fDist.value) || 0);
            if (!s && !c && !dd) { UI.toast('至少填一项', 'err'); return; }
            Store.addMetric({ date: dateStr, steps: s, calories: c, distance: dd, source: 'manual' });
            m2.close();
            self.render();
            UI.toast('已保存');
          }
        }, ['保存'])
      ]));
    },

    /** 改每日步数目标 */
    setGoal: function () {
      var self = this;
      var cur = num(Store.settings.stepGoal) || DEFAULT_GOAL;
      var f = V.input({ type: 'number', min: '0', step: '500', value: String(cur) });
      var m;
      m = V.modal({
        title: '每日步数目标',
        width: '340px',
        body: V.field('目标步数', f, '设 0 则不显示进度条')
      });
      m.setFooter(el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
        el('button', { class: 'btn', onclick: function () { m.close(); } }, ['取消']),
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            Store.updateSettings({ stepGoal: Math.max(0, Math.round(Number(f.value) || 0)) });
            m.close();
            self.render();
          }
        }, ['保存'])
      ]));
    }
  };

  /** 把本次会话从 Health Connect 拉到的活动量落盘（手动记录优先，只 emit 一次） */
  function persistCachedMetrics() {
    var arr = global.HealthConnect && HealthConnect.getCachedMetrics();
    if (arr && arr.length) Store.addMetrics(arr);
  }

  /** 供健康页挂载：用 { render(host), actions(host) } 这一套，与 AgendaPane 一致 */
  global.ActivityPane = {
    render: function (host) { view.render(host); },
    actions: function (host) { view.actions(host); },
    refresh: function () { view.render(); },
    _test: { series: series, km: km, metricOf: metricOf }
  };
})(typeof window !== 'undefined' ? window : this);
