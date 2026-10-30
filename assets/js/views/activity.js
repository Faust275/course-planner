/* ==========================================================
 * 视图：我的活动（小米运动健康风格：活力三环 / 步数 / 锻炼记录 / 跨板块联动）
 * ----------------------------------------------------------
 * 数据来自三处：
 *   1) Store.metrics  —— 已持久化的每日活动量（健康联动同步或手动录入）；
 *   2) Store.workouts —— 手环同步或手动记录的运动/锻炼会话（跑步/骑行/跳绳/球类等）；
 *   3) HealthConnect 内存缓存 —— 本次启动刚拉到、还没落盘的数据。
 * 展示：今日活动 + 活力彩虹三环 + 锻炼会话（联动象限与计划） + 近 7 天趋势 + 近 7 天汇总 + 14 天明细。
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

  /**
   * 绘制小米运动健康风格「活力彩虹三环」SVG（外环：活动热量 kcal，中环：锻炼时长 min，内环：步数 steps）
   */
  function buildVitalityRingsSVG(kcalPct, workoutPct, stepPct, size) {
    var S = size || 136;
    var cx = S / 2, cy = S / 2;
    var rings = [
      { r: S * 0.41, sw: 11, pct: kcalPct,    color: '#ff4d4f', bg: 'rgba(255, 77, 79, .15)' },
      { r: S * 0.30, sw: 11, pct: workoutPct, color: '#22c55e', bg: 'rgba(34, 197, 94, .15)' },
      { r: S * 0.19, sw: 11, pct: stepPct,    color: '#0ea5e9', bg: 'rgba(14, 165, 233, .15)' }
    ];
    var svgParts = ['<svg viewBox="0 0 ' + S + ' ' + S + '" style="width:' + S + 'px;height:' + S + 'px;display:block;fill:none">'];
    rings.forEach(function (rg) {
      var c = 2 * Math.PI * rg.r;
      var clamped = Math.max(0.02, Math.min(1, (Number(rg.pct) || 0) / 100));
      var dash = (clamped * c).toFixed(1);
      svgParts.push(
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + rg.r.toFixed(1) + '" style="fill:none;stroke:' + rg.bg + ';stroke-width:' + rg.sw + '"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + rg.r.toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')" ' +
        'style="fill:none;stroke:' + rg.color + ';stroke-width:' + rg.sw + ';stroke-linecap:round;stroke-dasharray:' + dash + ' ' + c.toFixed(1) + '"/>'
      );
    });
    svgParts.push('</svg>');
    var box = el('div', { class: 'xm-rings-svg-box', style: { width: S + 'px', height: S + 'px', flex: '0 0 ' + S + 'px' } });
    box.innerHTML = svgParts.join('');
    var avgPct = Math.round(((Math.min(100, kcalPct) + Math.min(100, workoutPct) + Math.min(100, stepPct)) / 3));
    box.appendChild(el('div', { class: 'xm-rings-center' }, [
      el('b', { style: { fontSize: '15px', fontWeight: '800', color: 'var(--text-1)' }, text: avgPct + '%' }),
      el('span', { style: { fontSize: '9.5px', color: 'var(--text-3)' }, text: '活力三环' })
    ]));
    return box;
  }

  /* ==========================================================
   * 锻炼 / 运动记录弹窗（支持小米手环 11 种运动模式 + 自动写入象限 + 自动打卡计划）
   * ========================================================== */
  var WorkoutDialog = {
    open: function (dateStr, id, onDone, defaultType) {
      dateStr = dateStr || DateUtil.toStr(DateUtil.today());
      var isEdit = !!id;
      var w0 = id && Store.getWorkout ? Store.getWorkout(id) : null;
      var types = Store.WORKOUT_TYPES || [
        { value: 'run', label: '户外跑', icon: '🏃', met: 8.5, color: '#10b981', hasDist: true }
      ];
      var curType = w0 ? w0.type : (defaultType || 'run');
      var manualCal = isEdit;

      var fDate = V.input({ type: 'date', value: w0 ? w0.date : dateStr });
      var fStart = V.input({ type: 'time', value: w0 ? w0.start : '17:00' });
      var fDur = V.input({ type: 'number', min: '1', max: '600', step: '5', value: String(w0 ? w0.duration : 30), placeholder: '分钟' });
      var fCal = V.input({ type: 'number', min: '0', step: '10', value: String(w0 ? w0.calories : ''), placeholder: '自动按体重与运动强度估算' });
      var fDist = V.input({ type: 'number', min: '0', step: '100', value: w0 && w0.distance ? String(w0.distance) : '', placeholder: '米，例如 5000 = 5公里' });
      var fHr = V.input({ type: 'number', min: '40', max: '220', value: w0 && w0.avgHr ? String(w0.avgHr) : '', placeholder: '可选，如 148' });
      var fNote = V.input({ value: w0 ? (w0.note || '') : '', placeholder: '可选：操场夜跑 / 手环同步等' });

      var sportGrid = el('div', { class: 'xm-sport-grid' });
      var paceHint = el('div', { style: { fontSize: '11.5px', color: 'var(--primary)', marginTop: '4px', fontWeight: '600' } });

      function getSport(k) {
        return Store.workoutType ? Store.workoutType(k) : types[0];
      }

      function updateDerived() {
        var sp = getSport(curType);
        var dur = Math.max(1, parseInt(fDur.value, 10) || 30);
        var wt = (Store.latestWeight && Store.latestWeight()) || 62;
        if (!manualCal) {
          fCal.value = String(Math.round(sp.met * wt * (dur / 60)));
        }
        var dist = parseInt(fDist.value, 10) || 0;
        var pace = Store.calcPace ? Store.calcPace(dur, dist) : '';
        var endHM = TimeUtil.addMin(fStart.value || '17:00', dur);
        paceHint.textContent = '⏱ 预计时段 ' + (fStart.value || '17:00') + '–' + endHM +
          (dist >= 100 ? (' · 距离 ' + (Math.round(dist / 100) / 10) + ' km') : '') +
          (pace ? (' · 平均配速 ' + pace) : '');
      }

      function drawSports() {
        sportGrid.innerHTML = '';
        types.forEach(function (t) {
          var active = t.value === curType;
          sportGrid.appendChild(el('button', {
            type: 'button',
            class: 'xm-sport-btn' + (active ? ' active' : ''),
            onclick: function () {
              curType = t.value;
              drawSports();
              updateDerived();
            }
          }, [
            el('span', { style: { fontSize: '18px' }, text: t.icon }),
            el('span', { text: t.label })
          ]));
        });
      }
      drawSports();
      updateDerived();

      fStart.addEventListener('input', updateDerived);
      fDur.addEventListener('input', updateDerived);
      fDist.addEventListener('input', updateDerived);
      fCal.addEventListener('input', function () { manualCal = true; });

      var syncQuad = Store.settings.syncWorkoutToQuadrant !== false;
      var syncPlan = Store.settings.autoPlanWorkout !== false;
      var chkQuad = el('input', { type: 'checkbox', checked: syncQuad });
      var chkPlan = el('input', { type: 'checkbox', checked: syncPlan });

      var linkBox = el('div', {
        style: {
          padding: '10px 12px', borderRadius: '10px', background: 'var(--surface-2)',
          border: '1px solid var(--line)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px'
        }
      }, [
        el('div', { style: { fontWeight: '650', color: 'var(--text-1)' }, text: '🔗 跨板块联动' }),
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-2)' } }, [
          chkQuad,
          el('span', { text: '自动将该运动时段加入「象限」24 小时时间环（标记运动与卡路里）' })
        ]),
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-2)' } }, [
          chkPlan,
          el('span', { text: '自动完成「计划」中关联运动计划的今日打卡，并计入「目标·锻炼 KR」' })
        ])
      ]);

      var m = V.modal({
        title: isEdit ? '编辑锻炼记录' : '🏃 记录运动 / 锻炼',
        width: '480px',
        body: [
          V.field('运动类型（小米手环运动模式）', sportGrid),
          el('div', { class: 'field-row' }, [
            V.field('日期', fDate),
            V.field('开始时间', fStart)
          ]),
          el('div', { class: 'field-row' }, [
            V.field('运动时长（分钟）', fDur),
            V.field('消耗热量（千卡）', fCal)
          ]),
          el('div', { class: 'field-row' }, [
            V.field('距离（米，跑/走/骑行选填）', fDist),
            V.field('平均心率（bpm，手环选填）', fHr)
          ]),
          paceHint,
          el('div', { style: { height: '10px' } }),
          linkBox,
          el('div', { style: { height: '10px' } }),
          V.field('备注', fNote)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              Store.removeWorkout(id);
              m.close();
              UI.toast('已删除锻炼记录并同步移除象限时间块');
              if (onDone) onDone();
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '保存记录',
            onclick: function () {
              var dur = Math.max(1, parseInt(fDur.value, 10) || 30);
              var sp = getSport(curType);
              var payload = {
                date: fDate.value || dateStr,
                type: curType,
                name: sp.label,
                start: fStart.value || '17:00',
                duration: dur,
                calories: Math.max(0, parseInt(fCal.value, 10) || 0),
                distance: Math.max(0, parseInt(fDist.value, 10) || 0),
                avgHr: parseInt(fHr.value, 10) || null,
                note: fNote.value.trim(),
                source: w0 ? w0.source : 'manual'
              };
              Store.updateSettings({
                syncWorkoutToQuadrant: !!chkQuad.checked,
                autoPlanWorkout: !!chkPlan.checked
              });
              var saved;
              if (isEdit) {
                saved = Store.updateWorkout(id, payload);
              } else {
                saved = Store.addWorkout(payload, {
                  syncQuadrant: !!chkQuad.checked,
                  syncPlan: !!chkPlan.checked
                });
              }
              m.close();
              var msg = isEdit ? '已更新锻炼记录' : ('已记录 ' + sp.label + ' ' + dur + ' 分钟');
              if (saved && saved.autoCheckedPlans && saved.autoCheckedPlans.length) {
                msg += '，并自动打卡计划「' + saved.autoCheckedPlans.join('、') + '」';
              } else if (chkQuad.checked) {
                msg += '（已同步至象限时间环）';
              }
              UI.toast(msg, 'ok');
              if (onDone) onDone();
            }
          })
        ])
      });
    }
  };

  /* ==========================================================
   * 活动分页（原「我的活动」独立模块，已并入健康模块的「活动」分页）
   * ========================================================== */
  var view = {
    root: null,
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

    render: function (host) {
      var self = this;
      if (host) this.root = host;
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      var todayStr = DateUtil.toStr(DateUtil.today());
      var h = Store.dayHealth ? Store.dayHealth(todayStr) : null;
      var goal = num(Store.settings.stepGoal) || DEFAULT_GOAL;
      var all = series(14);
      var week = all.slice(-7);
      var cur = all[all.length - 1];

      root.appendChild(this.heroCard(cur, goal, h));
      root.appendChild(this.workoutCard(todayStr, h));
      root.appendChild(this.trendCard(week, goal));
      root.appendChild(this.summaryCard(week, goal));
      if (!cur.has && !week.some(function (x) { return x.has; })) {
        root.appendChild(this.emptyCard());
      }
      root.appendChild(this.listCard(all));

      // 今日还没有数据：静默补拉一次
      if (!cur.has && Store.settings.healthAutoSync !== false && global.HealthConnect &&
          !self._fetching) {
        self._fetching = true;
        HealthConnect.autoSync().then(function (ok) {
          self._fetching = false;
          if (ok) { persistCachedMetrics(); self.render(); }
        }).catch(function () { self._fetching = false; });
      }
    },

    /* ---------- 今日主卡（含活力彩虹三环 + 步数/活动消耗/距离） ---------- */
    heroCard: function (cur, goal, h) {
      var self = this;
      var pct = goal > 0 ? Math.min(100, Math.round(cur.steps / goal * 100)) : 0;
      var done = cur.steps >= goal && goal > 0;
      var left = Math.max(0, goal - cur.steps);

      var kcalVal = h ? h.activeKcal : cur.calories;
      var kcalGoal = (h && h.kcalGoal) || num(Store.settings.kcalGoal) || 300;
      var kcalPct = kcalGoal > 0 ? Math.min(200, Math.round(kcalVal / kcalGoal * 100)) : 0;
      var wkMin = h ? h.workoutMin : 0;
      var wkGoal = (h && h.workoutGoal) || num(Store.settings.workoutGoal) || 30;
      var wkPct = wkGoal > 0 ? Math.min(200, Math.round(wkMin / wkGoal * 100)) : 0;
      var distVal = (h && h.distance > cur.distance) ? h.distance : cur.distance;

      var card = el('div', { class: 'card', style: { padding: '16px' } });
      card.appendChild(el('div', { class: 'section-title' }, [
        V.svg(V.icons.heartbeat, 16),
        '今日活动',
        el('span', {
          class: 'q-count',
          text: cur.has ? (cur.source === 'manual' ? '手动记录' : '健康联动') : '暂无数据'
        }),
        el('button', {
          class: 'btn btn-sm',
          style: { marginLeft: 'auto', fontSize: '11.5px', height: '26px', padding: '0 9px' },
          onclick: function () {
            WorkoutDialog.open(cur.date, null, function () { self.render(); });
          }
        }, ['＋ 记锻炼'])
      ]));

      // 顶部：小米运动健康风格活力彩虹三环 + 步数主标题
      card.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '6px' }
      }, [
        buildVitalityRingsSVG(kcalPct, wkPct, pct, 112),
        el('div', { style: { flex: '1', minWidth: '170px' } }, [
          el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '8px' } }, [
            el('div', {
              style: { fontSize: '34px', fontWeight: '800', lineHeight: '1', color: 'var(--text-1)' },
              text: fmt(cur.steps)
            }),
            el('div', {
              style: { fontSize: '13px', color: 'var(--text-3)', paddingBottom: '4px' },
              text: '步' + (goal > 0 ? ' / 目标 ' + fmt(goal) : '')
            })
          ]),
          (cur.has && goal > 0) ? el('div', { class: 'dp-bar', style: { marginTop: '10px' } }, [
            el('i', {
              style: { width: pct + '%', background: done ? 'var(--green)' : 'var(--primary)' }
            })
          ]) : null,
          (cur.has && goal > 0) ? el('div', {
            style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '6px' },
            text: pct + '%' + (done ? ' · 今日目标已达成' : ' · 还差 ' + fmt(left) + ' 步')
          }) : (!cur.has ? el('div', {
            style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' },
            text: '今天还没有数据，可点右上角「同步」或「手动记录」'
          }) : null)
        ])
      ]));

      card.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        this.metricBox('👟', '步数', fmt(cur.steps), '步'),
        this.metricBox('🔥', '活动消耗', fmt(kcalVal), '千卡'),
        this.metricBox('⚡', '锻炼时长', fmt(wkMin), '分钟'),
        this.metricBox('📏', '距离', km(distVal), '公里')
      ]));

      card.appendChild(el('div', {
        style: { marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }
      }, [
        el('button', { class: 'dp-link', onclick: function () { self.setGoal(); } }, ['改三环目标 →'])
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
        el('div', { style: { fontSize: '19px', lineHeight: '1.2' }, text: icon }),
        el('div', { style: { fontSize: '16px', fontWeight: '700', color: 'var(--text-1)', marginTop: '2px' }, text: value }),
        el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: label + (unit ? '（' + unit + '）' : '') })
      ]);
    },

    /* ---------- 手环 / 运动锻炼记录卡（直接联动象限 24h 环与计划打卡） ---------- */
    workoutCard: function (todayStr, h) {
      var self = this;
      var todayStr = DateUtil.toStr(DateUtil.today());
      var allW = (Store.workouts || []).slice().sort(function (a, b) {
        var ka = (a.date || '') + ' ' + (a.start || '');
        var kb = (b.date || '') + ' ' + (b.start || '');
        return ka < kb ? 1 : -1;
      }).slice(0, 6);
      var recSlot = Store.recommendWorkoutSlot ? Store.recommendWorkoutSlot(todayStr) : null;

      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, [
        '🏃 运动与锻炼记录',
        el('span', { class: 'q-count', text: '联动象限 · 计划 · 目标' }),
        el('button', {
          class: 'btn btn-sm btn-primary',
          style: { marginLeft: 'auto', height: '26px', padding: '0 10px', fontSize: '11.5px' },
          onclick: function () { WorkoutDialog.open(todayStr, null, function () { self.render(); }); }
        }, ['＋ 记录锻炼'])
      ]));

      if (recSlot) {
        var spSug = Store.workoutType ? Store.workoutType(recSlot.suggestedType) : { icon: '🏃', label: '户外跑' };
        card.appendChild(el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            padding: '9px 11px', borderRadius: '10px', marginBottom: '8px',
            background: recSlot.lowSleep ? 'rgba(245, 158, 11, .09)' : 'rgba(16, 185, 129, .08)',
            border: '1px solid ' + (recSlot.lowSleep ? 'rgba(245, 158, 11, .25)' : 'rgba(16, 185, 129, .22)')
          }
        }, [
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', {
              style: { fontSize: '12px', fontWeight: '650', color: recSlot.lowSleep ? '#d97706' : '#059669' },
              text: '💡 今日最佳运动窗：' + recSlot.start + '–' + recSlot.end + '（推荐 ' + spSug.icon + ' ' + spSug.label + ' ' + recSlot.suggestedDuration + ' 分钟）'
            }),
            el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '2px' }, text: recSlot.reason })
          ]),
          el('button', {
            class: 'btn btn-sm',
            style: { flex: '0 0 auto', fontSize: '11px', height: '25px', padding: '0 8px' },
            onclick: function () {
              Store.addWorkout({
                date: todayStr,
                type: recSlot.suggestedType,
                start: recSlot.start,
                duration: recSlot.suggestedDuration
              });
              UI.toast('已按推荐时段记入锻炼并同步至象限！', 'ok');
              self.render();
            }
          }, ['一键打卡'])
        ]));
      }

      if (!allW.length) {
        card.appendChild(el('div', {
          class: 'q-empty',
          text: '还没有锻炼记录。手环同步或点击「＋ 记录锻炼」添加跑步、骑行、跳绳、力量训练等，会自动写入「象限」24h 时间环并自动完成运动计划打卡。'
        }));
        return card;
      }

      var listWrap = el('div', {});
      allW.forEach(function (w) {
        var sp = Store.workoutType ? Store.workoutType(w.type) : { icon: '🏃', label: '运动', color: '#10b981' };
        var metaBits = [w.date === todayStr ? '今天' : w.date.slice(5), w.start + '–' + w.end, w.duration + ' 分钟'];
        if (w.distance >= 100) metaBits.push((Math.round(w.distance / 100) / 10) + ' km');
        if (w.pace) metaBits.push('配速 ' + w.pace);
        if (w.avgHr) metaBits.push('❤️ ' + w.avgHr + ' bpm');

        listWrap.appendChild(el('div', {
          class: 'xm-workout-row',
          onclick: function () { WorkoutDialog.open(w.date, w.id, function () { self.render(); }); }
        }, [
          el('div', {
            class: 'xm-sport-ico',
            style: { background: 'rgba(16, 185, 129, .12)', color: sp.color }
          }, [sp.icon]),
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
              el('b', { style: { fontSize: '13.5px' }, text: w.name || sp.label }),
              w.activityId ? el('span', {
                class: 'chip chip-green',
                style: { fontSize: '10px', padding: '1px 6px' },
                text: '已入象限'
              }) : el('button', {
                class: 'btn btn-sm',
                style: { fontSize: '10px', height: '20px', padding: '0 6px' },
                onclick: function (e) {
                  e.stopPropagation();
                  Store.syncWorkoutToQuadrant(w);
                  Store.emit();
                  UI.toast('已将该锻炼时段写入象限 24h 时间环');
                }
              }, ['⚡ 写入象限'])
            ]),
            el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: metaBits.join(' · ') })
          ]),
          el('div', { style: { textAlign: 'right', flex: '0 0 auto' } }, [
            el('b', { style: { fontSize: '13.5px', color: '#ff4d4f' }, text: (w.calories || 0) + ' kcal' }),
            el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: w.source === 'hc' ? '手环同步' : '手动记录' })
          ])
        ]));
      });
      card.appendChild(listWrap);
      return card;
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

    /* ---------- 无数据提示（带一键跳 Health Connect 设置页） ---------- */
    emptyCard: function () {
      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, ['怎么拿到数据']));
      card.appendChild(el('div', { class: 'q-empty', text: '活动量来自系统 Health Connect。请确认：① 手机已安装 Health Connect；② 小米运动健康 / Zepp Life 里开启了「同步到 Health Connect」；③ 点下方按钮完成一次授权。' }));
      card.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn btn-primary', onclick: function () { view.sync(); } }, ['授权并同步']),
        el('button', { class: 'btn', onclick: function () { view.editDay(DateUtil.toStr(DateUtil.today())); } }, ['先手动填']),
        (global.HealthConnect && HealthConnect.openSettings) ? el('button', {
          class: 'btn',
          onclick: function () {
            HealthConnect.openSettings().then(function (r) {
              if (r && r.opened === false && r.error) UI.toast(r.error, 'err');
            });
          }
        }, ['打开 Health Connect 设置']) : null
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
          if (UI.toastAction && HealthConnect.openSettings) {
            UI.toastAction('没读到数据，请确认小米运动健康已开启同步', {
              actionText: '去设置',
              onAction: function () { HealthConnect.openSettings(); }
            });
          } else {
            UI.toast('没读到数据，请确认小米运动健康已开启「同步到 Health Connect」', 'err');
          }
          return;
        }
        persistCachedMetrics();
        self.render();
        UI.toast('已同步睡眠、活动与锻炼数据', 'ok');
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : '未授权或 Health Connect 不可用';
        if (UI.toastAction && HealthConnect.openSettings) {
          UI.toastAction('同步失败：' + msg, {
            actionText: '打开设置',
            onAction: function () { HealthConnect.openSettings(); }
          });
        } else {
          UI.toast('同步失败：' + msg, 'err');
        }
      });
    },

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

    /** 改每日三环目标（步数 / 活动热量 / 锻炼时长） */
    setGoal: function () {
      var self = this;
      var curStep = num(Store.settings.stepGoal) || DEFAULT_GOAL;
      var curKcal = num(Store.settings.kcalGoal) || 300;
      var curWk   = num(Store.settings.workoutGoal) || 30;
      var fStep = V.input({ type: 'number', min: '0', step: '500', value: String(curStep) });
      var fKcal = V.input({ type: 'number', min: '50', step: '50', value: String(curKcal) });
      var fWk   = V.input({ type: 'number', min: '10', step: '5', value: String(curWk) });
      var m = V.modal({
        title: '🎯 活力三环每日目标',
        width: '360px',
        body: [
          V.field('👟 每日步数目标（步）', fStep, '设 0 则不显示进度条'),
          V.field('🔥 每日活动热量目标（千卡）', fKcal, '外环目标（默认 300 kcal）'),
          V.field('⚡ 每日锻炼时长目标（分钟）', fWk, '中环目标（默认 30 分钟）')
        ]
      });
      m.setFooter(el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
        el('button', { class: 'btn', onclick: function () { m.close(); } }, ['取消']),
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            Store.updateSettings({
              stepGoal: Math.max(0, Math.round(Number(fStep.value) || 0)),
              kcalGoal: Math.max(50, Math.round(Number(fKcal.value) || 300)),
              workoutGoal: Math.max(5, Math.round(Number(fWk.value) || 30))
            });
            m.close();
            self.render();
          }
        }, ['保存'])
      ]));
    },

    /* ==========================================================
     * 第三分页：🏋️ 锻炼（小米手环运动模式快记 / 黄金空档与体育课联动 / 分类筛选 / CSV 导入）
     * ========================================================== */
    _sportFilter: 'all',

    workoutActions: function (host) {
      var self = this;
      host.appendChild(el('button', {
        class: 'btn',
        onclick: function () { HealthCsvImporter.openDialog(function () { self.renderWorkout(); }); }
      }, [V.svg(V.icons.upload, 16), '导入手环 CSV']));
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          WorkoutDialog.open(DateUtil.toStr(DateUtil.today()), null, function () { self.renderWorkout(); });
        }
      }, ['＋ 记录锻炼']));
    },

    renderWorkout: function (host) {
      var self = this;
      if (host) this.workoutRoot = host;
      var root = this.workoutRoot;
      if (!root) return;
      root.innerHTML = '';
      var todayStr = DateUtil.toStr(DateUtil.today());

      var allW = (Store.workouts || []).slice().sort(function (a, b) {
        var ka = (a.date || '') + ' ' + (a.start || '');
        var kb = (b.date || '') + ' ' + (b.start || '');
        return ka < kb ? 1 : -1;
      });

      // 1. 顶部：运动概览与黄金空档 + 今日体育课一键入环
      var summaryCard = el('div', { class: 'card', style: { padding: '16px', marginBottom: '14px' } });
      var weekFrom = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -6));
      var weekW = allW.filter(function (w) { return w.date >= weekFrom && w.date <= todayStr; });
      var weekMin = weekW.reduce(function (s, w) { return s + (Number(w.duration) || 0); }, 0);
      var weekKcal = weekW.reduce(function (s, w) { return s + (Number(w.calories) || 0); }, 0);
      var weekDist = weekW.reduce(function (s, w) { return s + (Number(w.distance) || 0); }, 0);

      summaryCard.appendChild(el('div', { class: 'section-title' }, [
        '🏋️ 锻炼中心 · 近 7 天运动负荷',
        el('span', { class: 'q-count', text: weekW.length + ' 次锻炼' }),
        el('button', {
          class: 'btn btn-sm',
          style: { marginLeft: 'auto', height: '26px', padding: '0 9px', fontSize: '11.5px' },
          onclick: function () { HealthCsvImporter.openDialog(function () { self.renderWorkout(); }); }
        }, ['📥 导入小米/手环 CSV'])
      ]));

      summaryCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
        this.metricBox('⚡', '近7天时长', fmt(weekMin), '分钟'),
        this.metricBox('🔥', '运动消耗', fmt(weekKcal), '千卡'),
        this.metricBox('🏅', '运动次数', fmt(weekW.length), '次'),
        this.metricBox('📏', '累计里程', km(weekDist), '公里')
      ]));

      // 今日体育课联动提示
      var peCourses = (Store.coursesOnDate ? Store.coursesOnDate(todayStr) : []).filter(function (c) {
        return Store.isPeCourse && Store.isPeCourse(c);
      });
      peCourses.forEach(function (pe) {
        var ct = Store.courseTime(pe) || { start: '14:00', end: '15:35' };
        var already = (Store.workouts || []).some(function (w) {
          return w && w.date === todayStr && (w.courseId === pe.id || w.name === pe.name);
        });
        summaryCard.appendChild(el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            padding: '9px 12px', borderRadius: '10px', marginTop: '10px',
            background: 'rgba(20, 184, 166, .09)', border: '1px solid rgba(20, 184, 166, .28)'
          }
        }, [
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { fontSize: '12.5px', fontWeight: '650', color: '#0d9488' }, text: '🎓 今日课表有体育课：《' + pe.name + '》（' + ct.start + '–' + ct.end + '）' }),
            el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '2px' }, text: '一键转为今日锻炼记录，自动同步至象限 24h 时间环、运动计划与目标 KR' })
          ]),
          already ? el('span', { class: 'chip chip-green', text: '✓ 已记入锻炼' }) : el('button', {
            class: 'btn btn-sm btn-primary',
            style: { flex: '0 0 auto', height: '26px', padding: '0 10px', fontSize: '11.5px' },
            onclick: function () {
              var w = Store.logCourseWorkout(pe.id, todayStr);
              if (w) {
                UI.toast('已将《' + pe.name + '》记入今日锻炼（+' + w.duration + ' 分钟）！', 'ok');
                self.renderWorkout();
              }
            }
          }, ['🏃 记入锻炼'])
        ]));
      });

      // 最佳运动空档推荐
      var recSlot = Store.recommendWorkoutSlot ? Store.recommendWorkoutSlot(todayStr) : null;
      if (recSlot) {
        var spSug = Store.workoutType ? Store.workoutType(recSlot.suggestedType) : { icon: '🏃', label: '户外跑' };
        summaryCard.appendChild(el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            padding: '9px 12px', borderRadius: '10px', marginTop: '10px',
            background: recSlot.lowSleep ? 'rgba(245, 158, 11, .09)' : 'rgba(16, 185, 129, .08)',
            border: '1px solid ' + (recSlot.lowSleep ? 'rgba(245, 158, 11, .25)' : 'rgba(16, 185, 129, .22)')
          }
        }, [
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', {
              style: { fontSize: '12px', fontWeight: '650', color: recSlot.lowSleep ? '#d97706' : '#059669' },
              text: '💡 今日最佳运动空档：' + recSlot.start + '–' + recSlot.end + '（推荐 ' + spSug.icon + ' ' + spSug.label + ' ' + recSlot.suggestedDuration + ' 分钟）'
            }),
            el('div', { style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '2px' }, text: recSlot.reason })
          ]),
          el('button', {
            class: 'btn btn-sm',
            style: { flex: '0 0 auto', fontSize: '11px', height: '25px', padding: '0 8px' },
            onclick: function () {
              Store.addWorkout({
                date: todayStr,
                type: recSlot.suggestedType,
                start: recSlot.start,
                duration: recSlot.suggestedDuration
              });
              UI.toast('已按推荐时段记入锻炼并同步至象限！', 'ok');
              self.renderWorkout();
            }
          }, ['一键打卡'])
        ]));
      }
      root.appendChild(summaryCard);

      // 2. 小米手环 11 种运动模式快记台
      var quickCard = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
      quickCard.appendChild(el('div', { class: 'section-title' }, [
        '⚡ 手环运动模式快记',
        el('span', { class: 'q-count', text: '点击任意项目直接记一次' })
      ]));
      var sGrid = el('div', { class: 'xm-sport-grid', style: { marginTop: '8px' } });
      (Store.WORKOUT_TYPES || []).forEach(function (t) {
        sGrid.appendChild(el('button', {
          type: 'button',
          class: 'xm-sport-btn',
          onclick: function () {
            WorkoutDialog.open(todayStr, null, function () { self.renderWorkout(); }, t.value);
          }
        }, [
          el('span', { style: { fontSize: '19px' }, text: t.icon }),
          el('span', { text: t.label })
        ]));
      });
      quickCard.appendChild(sGrid);
      root.appendChild(quickCard);

      // 3. 历史锻炼记录（带分类筛选）
      var listCard = el('div', { class: 'card', style: { padding: '14px 16px' } });
      listCard.appendChild(el('div', { class: 'section-title' }, [
        '📋 锻炼记录明细',
        el('span', { class: 'q-count', text: '共 ' + allW.length + ' 条 · 点击可编辑' })
      ]));

      var filters = [
        { k: 'all', l: '全部' },
        { k: 'run', l: '🏃 跑步/健走' },
        { k: 'ball', l: '🏸 球类' },
        { k: 'cardio', l: '🚴 骑行/游泳/跳绳' },
        { k: 'body', l: '💪 力量/拉伸' }
      ];
      var fBar = el('div', { class: 'filter-bar', style: { marginBottom: '10px' } });
      filters.forEach(function (f) {
        fBar.appendChild(el('button', {
          class: 'filter-tab' + (self._sportFilter === f.k ? ' active' : ''),
          text: f.l,
          onclick: function () {
            self._sportFilter = f.k;
            self.renderWorkout();
          }
        }));
      });
      listCard.appendChild(fBar);

      var filtered = allW.filter(function (w) {
        var tp = w.type || 'run';
        if (self._sportFilter === 'run') return tp === 'run' || tp === 'walk' || tp === 'treadmill';
        if (self._sportFilter === 'ball') return tp === 'badminton' || tp === 'basketball' || tp === 'football' || tp === 'pingpong' || tp === 'tennis' || tp === 'volleyball';
        if (self._sportFilter === 'cardio') return tp === 'cycle' || tp === 'swim' || tp === 'rope' || tp === 'hiit';
        if (self._sportFilter === 'body') return tp === 'strength' || tp === 'yoga';
        return true;
      });

      if (!filtered.length) {
        listCard.appendChild(el('div', {
          class: 'q-empty',
          text: '当前分类下还没有锻炼记录。可点上方运动图标快记，或导入小米运动健康 CSV。'
        }));
      } else {
        filtered.slice(0, 30).forEach(function (w) {
          var sp = Store.workoutType ? Store.workoutType(w.type) : { icon: '🏃', label: '运动', color: '#10b981' };
          var metaBits = [w.date === todayStr ? '今天' : w.date, w.start + '–' + w.end, w.duration + ' 分钟'];
          if (w.distance >= 100) metaBits.push((Math.round(w.distance / 100) / 10) + ' km');
          if (w.pace) metaBits.push('配速 ' + w.pace);
          if (w.avgHr) metaBits.push('❤️ ' + w.avgHr + ' bpm');
          if (w.note) metaBits.push(w.note);

          listCard.appendChild(el('div', {
            class: 'xm-workout-row',
            onclick: function () { WorkoutDialog.open(w.date, w.id, function () { self.renderWorkout(); }); }
          }, [
            el('div', {
              class: 'xm-sport-ico',
              style: { background: 'rgba(16, 185, 129, .12)', color: sp.color }
            }, [sp.icon]),
            el('div', { style: { flex: '1', minWidth: '0' } }, [
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
                el('b', { style: { fontSize: '13.5px' }, text: w.name || sp.label }),
                w.activityId ? el('span', {
                  class: 'chip chip-green',
                  style: { fontSize: '10px', padding: '1px 6px' },
                  text: '已入象限'
                }) : el('button', {
                  class: 'btn btn-sm',
                  style: { fontSize: '10px', height: '20px', padding: '0 6px' },
                  onclick: function (e) {
                    e.stopPropagation();
                    Store.syncWorkoutToQuadrant(w);
                    Store.emit();
                    UI.toast('已将该锻炼时段写入象限 24h 时间环');
                  }
                }, ['⚡ 写入象限'])
              ]),
              el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: metaBits.join(' · ') })
            ]),
            el('div', { style: { textAlign: 'right', flex: '0 0 auto' } }, [
              el('b', { style: { fontSize: '13.5px', color: '#ff4d4f' }, text: (w.calories || 0) + ' kcal' }),
              el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: w.source === 'hc' ? '手环同步' : (w.source === 'csv' ? 'CSV导入' : (w.source === 'course' ? '体育课联动' : '手动记录')) })
            ])
          ]));
        });
      }
      root.appendChild(listCard);
    }
  };

  /* ==========================================================
   * P0 小米运动健康 / Zepp Life CSV 批量导入弹窗
   * ========================================================== */
  var HealthCsvImporter = {
    openDialog: function (onDone) {
      var ta = V.textarea({
        style: 'min-height:130px;font-family:var(--font-mono);font-size:12px',
        placeholder: '支持直接粘贴 CSV 文本，或点击上方「选择 CSV 文件」。\n支持表头示例：\n1) 睡眠：date,start,end,deep,light,rem,awake,efficiency\n2) 活动：date,steps,calories,distance\n3) 锻炼：date,start,type,duration,calories,distance,avgHr\n4) 小米运动健康导出：Uid,Sid,Key,Time,Value'
      });
      var fileInput = el('input', {
        type: 'file',
        accept: '.csv,text/csv,text/plain',
        multiple: 'multiple',
        style: { display: 'none' }
      });

      function doImportText(text) {
        if (!text || !text.trim()) {
          UI.toast('请先选择 CSV 文件或粘贴 CSV 内容', 'err');
          return;
        }
        var res = Store.importHealthCsv ? Store.importHealthCsv(text) : null;
        if (!res || !res.ok) {
          UI.toast('未能从 CSV 中解析出有效的睡眠、步数或锻炼记录，请检查表头格式', 'err');
          return;
        }
        m.close();
        UI.toast('CSV 导入成功：新增睡眠 ' + res.sleepsAdded + ' 晚 · 活动 ' + res.metricsAdded + ' 天 · 锻炼 ' + res.workoutsAdded + ' 次', 'ok');
        if (onDone) onDone(res);
      }

      fileInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(fileInput.files || []);
        if (!files.length) return;
        Promise.all(files.map(function (f) {
          return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { resolve(''); };
            reader.readAsText(f, 'utf-8');
          });
        })).then(function (texts) {
          var totalS = 0, totalM = 0, totalW = 0, anyOk = false;
          texts.forEach(function (t) {
            var r = Store.importHealthCsv ? Store.importHealthCsv(t) : null;
            if (r && r.ok) {
              anyOk = true;
              totalS += r.sleepsAdded;
              totalM += r.metricsAdded;
              totalW += r.workoutsAdded;
            }
          });
          if (!anyOk) {
            UI.toast('所选 CSV 文件未识别到有效健康数据', 'err');
            return;
          }
          m.close();
          UI.toast('已从 ' + files.length + ' 个文件导入：睡眠 ' + totalS + ' 晚 · 活动 ' + totalM + ' 天 · 锻炼 ' + totalW + ' 次', 'ok');
          if (onDone) onDone();
        });
      });

      var m = V.modal({
        title: '📥 导入小米运动健康 / Zepp Life CSV',
        width: '500px',
        body: [
          el('p', {
            style: { margin: '0 0 10px', fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.65' },
            text: '支持导入小米运动健康（Xiaomi Fitness）、Zepp Life（原小米运动）导出的睡眠、每日步数热量、运动锻炼 CSV 文件。同日已有记录会自动去重保护，不会覆盖你的手动记录。'
          }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } }, [
            el('button', {
              class: 'btn btn-primary',
              onclick: function () { fileInput.click(); }
            }, [V.svg(V.icons.upload, 16), '选择 CSV 文件（支持多选）']),
            el('button', {
              class: 'btn',
              onclick: function () {
                var td = DateUtil.toStr(DateUtil.today());
                var yd = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), -1));
                ta.value = [
                  'date,start,end,deep,light,rem,awake,efficiency',
                  td + ',23:25,07:20,108,242,105,10,95',
                  yd + ',23:45,07:30,96,250,98,15,92'
                ].join('\n');
              }
            }, ['填入睡眠 CSV 示例']),
            fileInput
          ]),
          V.field('或者直接粘贴 CSV 内容', ta)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary',
            text: '解析并导入',
            onclick: function () { doImportText(ta.value); }
          })
        ])
      });
    }
  };

  function persistCachedMetrics() {
    if (global.HealthConnect && HealthConnect.persistAllToStore) {
      HealthConnect.persistAllToStore({ toastOnSleepAdd: false });
      return;
    }
    var arr = global.HealthConnect && HealthConnect.getCachedMetrics();
    if (arr && arr.length) Store.addMetrics(arr);
    var ws = global.HealthConnect && HealthConnect.getCachedWorkouts && HealthConnect.getCachedWorkouts();
    if (ws && ws.length && Store.addWorkouts) Store.addWorkouts(ws);
  }

  global.WorkoutDialog = WorkoutDialog;
  global.HealthCsvImporter = HealthCsvImporter;
  global.VitalityRings = { buildSVG: buildVitalityRingsSVG };
  global.ActivityPane = {
    render: function (host) { view.render(host); },
    actions: function (host) { view.actions(host); },
    renderWorkout: function (host) { view.renderWorkout(host); },
    workoutActions: function (host) { view.workoutActions(host); },
    refresh: function () { view.render(); },
    setGoal: function () { view.setGoal(); },
    _test: { series: series, km: km, metricOf: metricOf }
  };
})(typeof window !== 'undefined' ? window : this);
