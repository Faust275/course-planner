

/* ==========================================================
 * 视图：收集（干员图鉴 + 寻访数据 + 我的森林）
 * 森林与干员图鉴原本在「专注」模块，现统一迁移到这里，
 * 专注模块只保留计时与统计。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var NS = 'http://www.w3.org/2000/svg';

  /* 动画标记（不进 Store，避免每帧写磁盘） */
  var justPlantedId = '';

  /** 成就获得时间格式化 */
  function fmtAchTime(ts) {
    var d = new Date(ts);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var view = {
    id: 'collection',
    name: '收集',
    icon: V.icons.box,
    title: '我的收集',
    order: 23,
    nav: true,

    root: null,
    tab: 'ops',   // ops 干员图鉴 / forest 我的森林

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-collection' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    onLeave: function () { /* 无需处理 */ },

    render: function () {
      var self = this;
      var root = this.root;
      root.innerHTML = '';

      var s = Store.gachaStats();
      var pm = Store.pomodoro;
      var isForest = pm.mode === 'forest';
      if (isForest && this.tab === 'ops') this.tab = 'forest';
      var done = 0;
      Store.achievementList().forEach(function (a) {
        // 抽卡 / 集卡 未解锁的成就不在总数里计入（其本身也隐藏）
        if ((a.group === '抽卡' || a.group === '集卡') && !Store.isAchieved(a)) return;
        if (Store.isAchieved(a)) done++;
      });

      // 商店页不需要「森林 / 成就」概览卡，直接看余额
      if (this.tab !== 'shop') {
        var statCards = [];
        if (!isForest) statCards.push(V.statCard(s.owned, '已获得干员', 'var(--amber)'));
        statCards.push(V.statCard(pm.trees.length, '我的森林（棵）', 'var(--green)'));
        statCards.push(V.statCard(done, '成就', 'var(--text-2)'));
        root.appendChild(el('div', { class: 'task-summary' }, statCards));
      }

      var tabs = el('div', { class: 'gacha-tabs' }, [
        (!isForest) ? el('button', {
          class: 'gacha-tab' + (this.tab === 'ops' ? ' active' : ''),
          text: '干员图鉴 ' + s.owned + '/' + s.total,
          onclick: function () { self.tab = 'ops'; self.render(); }
        }) : null,
        el('button', {
          class: 'gacha-tab' + (this.tab === 'forest' ? ' active' : ''),
          text: '我的森林 ' + pm.trees.length,
          onclick: function () { self.tab = 'forest'; self.render(); }
        }),
        el('button', {
          class: 'gacha-tab' + (this.tab === 'ach' ? ' active' : ''),
          text: '成就 ' + done,
          onclick: function () { self.tab = 'ach'; self.render(); }
        }),
        el('button', {
          class: 'gacha-tab' + (this.tab === 'shop' ? ' active' : ''),
          text: '商店',
          onclick: function () { self.tab = 'shop'; self.render(); }
        })
      ].filter(Boolean));
      root.appendChild(tabs);

      if (this.tab === 'ach') root.appendChild(this.achPane());
      else if (this.tab === 'forest') root.appendChild(this.forestPane());
      else if (this.tab === 'shop') root.appendChild(this.shopPane());
      else root.appendChild(this.opsPane());
    },

    /** 限定干员选择弹窗（六星在前，标注已拥有） */
    limitedPicker: function (cb) {
      var owned = {};
      (Store.state.pomodoro.gacha.ops || []).forEach(function (o) { owned[o.n] = 1; });
      var list = Store.limitedOps();
      list.sort(function (a, b) { return (b.r - a.r) || (a.n < b.n ? -1 : 1); });
      var body = el('div', { class: 'limited-picker' });
      list.forEach(function (o) {
        body.appendChild(el('button', {
          class: 'btn btn-block limited-pick' + (owned[o.n] ? ' owned' : ''),
          text: o.r + '★ ' + o.n + (owned[o.n] ? '（已拥有）' : ''),
          onclick: function () {
            var w = this.closest('.cp-modal-wrap');
            if (w) w.remove();
            cb(o.n);
          }
        }));
      });
      V.modal({
        title: '选择限定干员',
        width: '420px',
        body: [body],
        footer: el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn', text: '取消', onclick: function () { this.closest('.cp-modal-wrap').remove(); } })
        ])
      });
    },

    /* ==========================================================
     * 商店：月卡 + 满潜重复兑换 + 限定专区
     * ========================================================== */
    shopPane: function () {
      var self = this;
      var wrap = el('div', { class: 'shop-pane' });
      var bal = Store.shopBalance();
      var info = Store.cardInfo();
      var dup = Store.dupPoolInfo();

      /* ---- 余额（两币不互通，各花各的）---- */
      var gacha = bal.mode === 'gacha';
      var unit = gacha ? '合成玉' : '积分';
      var balCard = el('div', { class: 'card shop-bal' });
      [
        [bal.points, '森林积分'],
        [bal.jade, '合成玉'],
        [bal.current, '当前可用']
      ].forEach(function (x) {
        balCard.appendChild(el('div', { class: 'shop-bal-item' }, [
          el('b', { text: String(x[0]) }),
          el('span', { text: x[1] })
        ]));
      });
      wrap.appendChild(balCard);
      wrap.appendChild(el('div', {
        class: 'shop-note',
        text: '积分与合成玉不互通：森林模式花积分，抽卡模式花合成玉。月卡按当前模式的币种计价。'
      }));

      /* ---- 月卡 ---- */
      var cardBox = el('div', { class: 'card shop-block' });
      cardBox.appendChild(el('div', { class: 'section-title' }, ['月卡']));

      var cardPrice = gacha ? POMO.CARD_PRICE_GACHA : POMO.CARD_PRICE;
      var dailyTxt = gacha ? (POMO.CARD_DAILY * POMO.JADE_PER_POINT + ' 合成玉') : (POMO.CARD_DAILY + ' 积分');
      function buy() {
        var r = Store.buyCard();
        if (!r.ok) { V.toast(r.msg, 'err'); return; }
        V.toast('月卡已开通，今天已返 ' + dailyTxt);
        self.render();
      }

      if (!info.active) {
        if (info.bought) {
          cardBox.appendChild(el('div', {
            class: 'shop-sub', text: '上一张月卡已在 ' + info.endDate + ' 到期'
          }));
        }
        cardBox.appendChild(el('div', {
          class: 'shop-desc',
          text: '花 ' + cardPrice + ' ' + unit + ' 开通 30 天：每天完成 2 次有效动作返 ' + dailyTxt +
            '；任意连续 7 天全勤额外奖励；30 天一天不漏再奖励。' +
            '坚持一个月的总返还约为售价的 3 倍。漏签只损失当天和该窗口，有效期不顺延。' +
            '全勤奖（摸鱼券 / 定向券）人人可得，月卡只多给积分。同一时间只能持有一个模式的月卡。'
        }));
        cardBox.appendChild(el('button', {
          class: 'btn btn-primary btn-block btn-lg',
          text: '开通月卡（' + cardPrice + ' ' + unit + '）',
          onclick: buy
        }));
      } else {
        cardBox.appendChild(el('div', { class: 'shop-row' }, [
          el('b', { text: (info.mode === 'gacha' ? '抽卡月卡 · ' : '森林月卡 · ') + '剩余 ' + info.daysLeft + ' 天' }),
          el('span', { text: '已签 ' + info.signedDays + '/' + info.daysTotal + ' 天' })
        ]));

        /* 30 天进度条 */
        var bar = el('div', { class: 'shop-bar' });
        bar.appendChild(el('i', {
          style: { width: Math.round(info.signedDays / info.daysTotal * 100) + '%' }
        }));
        cardBox.appendChild(bar);

        /* 最近 7 天的「有效日」（不是有效日的那天可以用摸鱼券补上） */
        var dots = el('div', { class: 'shop-dots' });
        var fq7 = Store.fishQuota();
        var todayKey = DateUtil.toStr(DateUtil.today());
        for (var i = 6; i >= 0; i--) {
          var d = DateUtil.addDays(DateUtil.today(), -i);
          var key = DateUtil.toStr(d);
          var on = Store.isValidDay(key);
          var mendable = !on && fq7.hold > 0 && fq7.left > 0 && key <= todayKey;
          var attrs = {
            class: 'shop-dot' + (on ? ' on' : '') + (mendable ? ' mendable' : ''),
            title: key + (on ? ' 有效日' : (mendable ? ' 点一下用摸鱼券补上' : ' 不是有效日')),
            text: String(d.getDate())
          };
          if (mendable) {
            attrs.onclick = function (k) {
              return function () {
                V.confirm({
                  title: '补上 ' + k,
                  message: '将消耗 1 张摸鱼券，把 ' + k + ' 补成有效日（与真实达成同等参与全勤判定）。确定继续吗？',
                  ok: '用券补上',
                  onOk: function () {
                    var r = Store.useFishCard('mend', k);
                    if (!r.ok) { V.toast(r.msg, 'err'); return; }
                    V.toast('已把 ' + k + ' 补成有效日');
                    self.render();
                  }
                });
              };
            }(key);
          }
          dots.appendChild(el('span', attrs));
        }
        cardBox.appendChild(el('div', {
          class: 'shop-label',
          text: '最近 7 天（有效日 = 当天完成 ' + POMO.VALID_DAY_MIN + ' 次以上有效动作；' +
                '连续 7 天全勤另发 1 张摸鱼券）' +
                (fq7.hold ? '　·　持 ' + fq7.hold + ' 张，近 7 天还可再用 ' + fq7.left + '/' + fq7.max + ' 次' : '')
        }));
        cardBox.appendChild(dots);

        var cardGacha = info.mode === 'gacha';
        var gainedTxt = cardGacha ? (info.gained * POMO.JADE_PER_POINT + ' 合成玉') : (info.gained + ' 积分');
        var todayTxt = cardGacha ? (POMO.CARD_DAILY * POMO.JADE_PER_POINT + ' 合成玉') : (POMO.CARD_DAILY + ' 积分');
        cardBox.appendChild(el('div', { class: 'shop-row shop-row-sub' }, [
          el('span', {
            text: info.todaySigned ? '今天已返 ' + todayTxt : '今天还没完成有效动作（再做 2 件小事返 ' + dailyTxt + '）'
          }),
          el('b', { text: '累计返 ' + gainedTxt })
        ]));
        if (info.fullAwarded) {
          cardBox.appendChild(el('div', { class: 'shop-badge', text: '30 天全勤奖励已领取' }));
        }
      }
      wrap.appendChild(cardBox);

      /* ---- 满潜重复兑换 ---- */
      var exBox = el('div', { class: 'card shop-block' });
      exBox.appendChild(el('div', { class: 'section-title' }, ['满潜重复兑换']));
      if (dup.count > 0) {
        exBox.appendChild(el('div', {
          class: 'shop-desc',
          text: '待兑换 ' + dup.count + ' 份重复干员，按 1 积分 = ' + POMO.JADE_PER_POINT +
            ' 合成玉折算，共 ' + dup.jade + ' 合成玉。'
        }));
        exBox.appendChild(el('button', {
          class: 'btn btn-primary btn-block',
          onclick: function () {
            var r = Store.exchangeDup();
            if (!r.ok) { V.toast('没有可兑换的重复干员', 'err'); return; }
            V.toast('已兑换 ' + r.jade + ' 合成玉');
            self.render();
          }
        }, [V.jade(16), '兑换为 ' + dup.jade + ' 合成玉']));
      } else {
        exBox.appendChild(el('div', {
          class: 'q-empty',
          text: '暂无待兑换的重复干员。抽到满潜（6 份）之后，多余的复制会存到这里。'
        }));
      }
      wrap.appendChild(exBox);

      /* ---- 摸鱼券 / 全勤（人人可得）---- */
      (function () {
        var fq = Store.fishQuota();
        var tk = Store.ticketInfo();
        var streak = Store.validStreak();
        var box = el('div', { class: 'card shop-block' });
        box.appendChild(el('div', { class: 'section-title' }, ['摸鱼券 · 全勤']));
        box.appendChild(el('div', {
          class: 'shop-desc',
          text: '每天完成 2 次以上有效动作（新建/完成待办、合格专注、写日记、记账、推进目标…）算一个「有效日」；' +
                '连续 7 天发 1 张券 + ' + POMO.STREAK_WEEK_POINTS + ' 分，连续 30 天再发 1 张券 + ' +
                POMO.STREAK_MONTH_POINTS + ' 分 + 1 张定向券。' +
                '另外每攒满 ' + POMO.GROWTH_PER_TICKET + ' 点成长值（合格专注 2 分 / 其他 1 分）也送 1 张。'
        }));
        box.appendChild(el('div', { class: 'shop-row' }, [
          el('b', { text: '连续有效日 ' + streak + ' 天' }),
          el('span', { text: '摸鱼券 ' + fq.hold + '/' + fq.holdMax + ' 张 · 定向券 ' + tk.selection + ' 张' })
        ]));
        var sbar = el('div', { class: 'shop-bar' });
        sbar.appendChild(el('i', { style: { width: Math.min(100, Math.round(streak / 30 * 100)) + '%' } }));
        box.appendChild(sbar);
        box.appendChild(el('div', {
          class: 'shop-label',
          text: '摸鱼券四种用法（每次 1 张）：补签漏掉的日子 · 护住中断的树苗 · 专注中途休整 · 复活枯桩　' +
                '近 7 天还可再用 ' + fq.left + '/' + fq.max + ' 次'
        }));
        if (Store.state.shop.streak && Store.state.shop.streak.weekEnd) {
          box.appendChild(el('div', { class: 'shop-badge', text: '最近一次周全勤：' + Store.state.shop.streak.weekEnd }));
        }
        wrap.appendChild(box);
      })();

      /* ---- 限定专区（限定井 / 定向券）：森林模式没有合成玉、井也不涨，完全不显示 ---- */
      if (gacha) (function () {
        var tk = Store.ticketInfo();
        var lk = Store.limitedSparkInfo();
        var box = el('div', { class: 'card shop-block' });
        box.appendChild(el('div', { class: 'section-title' }, ['限定专区']));
        box.appendChild(el('div', {
          class: 'shop-desc',
          text: '限定干员不进轮换池，只能靠限定井或定向券获取：每次寻访都累计限定井' +
                '（与 UP 井并行各计，但不叠加使用），攒满 ' + lk.need + ' 抽可兑换已登记的限定；' +
                '定向券由月全勤发放；漏签的日子可以用摸鱼券补。'
        }));
        box.appendChild(el('div', { class: 'shop-row' }, [
          el('b', { text: '限定井 ' + lk.count + ' / ' + lk.need }),
          el('span', { text: '定向券 ' + tk.selection + ' 张 · 摸鱼券 ' + tk.fish + ' 张' })
        ]));
        var bar2 = el('div', { class: 'shop-bar' });
        bar2.appendChild(el('i', { style: { width: Math.round(lk.count / lk.need * 100) + '%' } }));
        box.appendChild(bar2);
        box.appendChild(el('div', { class: 'shop-row shop-row-sub' }, [
          el('span', { text: '已登记目标' }),
          el('b', { text: lk.target || '未登记' })
        ]));
        var btnRow = el('div', { class: 'shop-btn-row' });
        btnRow.appendChild(el('button', {
          class: 'btn', text: '登记限定',
          onclick: function () {
            self.limitedPicker(function (name) {
              var r = Store.setLimitedTarget(name);
              if (!r.ok) { V.toast(r.msg, 'err'); return; }
              V.toast('已登记限定井目标：' + name);
              self.render();
            });
          }
        }));
        btnRow.appendChild(el('button', {
          class: 'btn' + (lk.ready ? ' btn-primary' : ''), text: '井兑换',
          onclick: function () {
            V.confirm({
              title: '限定井兑换',
              message: '将消耗攒满的限定井（计数清零），兑换已登记的限定「' +
                       (lk.target || '未登记') + '」。确定继续吗？',
              ok: '兑换',
              onOk: function () {
                var r = Store.redeemLimitedSpark();
                if (!r.ok) { V.toast(r.msg, 'err'); return; }
                V.toast('限定井兑换成功：' + r.n);
                self.render();
              }
            });
          }
        }));
        btnRow.appendChild(el('button', {
          class: 'btn' + (tk.selection ? ' btn-primary' : ''),
          text: '定向券兑换' + (tk.selection ? '（' + tk.selection + '）' : ''),
          onclick: function () {
            if (!tk.selection) { V.toast('没有定向券，坚持一个月月卡全勤可得', 'err'); return; }
            self.limitedPicker(function (name) {
              V.confirm({
                title: '定向券兑换',
                message: '将消耗 1 张定向券，兑换限定「' + name + '」。确定继续吗？',
                ok: '兑换',
                onOk: function () {
                  var r = Store.useSelectionTicket(name);
                  if (!r.ok) { V.toast(r.msg, 'err'); return; }
                  V.toast('定向券兑换成功：' + r.n);
                  self.render();
                }
              });
            });
          }
        }));
        box.appendChild(btnRow);
        wrap.appendChild(box);
      })();

      /* ---- 记录 ---- */
      var logs = (Store.state.shop.log || []).slice(0, 8);
      if (logs.length) {
        var lg = el('div', { class: 'card shop-block' });
        lg.appendChild(el('div', { class: 'section-title' }, ['最近记录']));
        logs.forEach(function (l) {
          var d = new Date(l.at);
          var p = function (x) { return (x < 10 ? '0' : '') + x; };
          lg.appendChild(el('div', { class: 'shop-log' }, [
            el('span', { text: (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) }),
            el('b', { text: l.text })
          ]));
        });
        wrap.appendChild(lg);
      }

      return wrap;
    },

    /* ==========================================================
     * 干员图鉴 + 寻访数据
     * ========================================================== */
    opsPane: function () {
      var s = Store.gachaStats();
      var owned = Store.gachaOwned();
      var card = el('div', { class: 'card', style: { padding: '14px 16px' } });

      card.appendChild(el('div', { class: 'section-title' }, [
        '我的干员',
        el('button', {
          class: 'btn btn-sm', style: { marginLeft: 'auto' },
          onclick: function () { Gacha.openOps(); }
        }, ['全部图鉴'])
      ]));

      card.appendChild(el('button', {
        class: 'btn btn-primary btn-block btn-lg', style: { marginBottom: '12px' },
        onclick: function () { Gacha.open(); }
      }, [V.jade(17), '去寻访（' + POMO.PULL_COST + ' 合成玉 / 次）']));

      if (!owned.length) {
        card.appendChild(el('div', {
          class: 'q-empty',
          text: '还没有干员 · 攒够 ' + POMO.PULL_COST + ' 合成玉（1 积分）就能寻访一次'
        }));
      } else {
        card.appendChild(el('div', {
          style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '8px' },
          text: '累计 ' + s.pulls + ' 抽 · 距上次六星 ' + s.pity + ' 抽 · 当前六星概率 ' + s.rate6 + '%　·　按阵营分组 · 满潜五星/六星高亮'
        }));
        card.appendChild(Gacha.wall());
      }

      card.appendChild(el('div', {
        class: 'section-title', style: { marginTop: '20px' }
      }, ['寻访数据']));
      card.appendChild(Gacha.records());

      // ---- 一键清空当前寻访（危险操作，二次确认）----
      card.appendChild(el('div', {
        style: {
          marginTop: '18px', paddingTop: '14px', borderTop: '1px dashed var(--line)'
        }
      }, [
        el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '8px', lineHeight: '1.6' },
          text: '清空后将移除「我的干员」「寻访数据」以及抽卡 / 集卡相关成就；已获得的积分、森林与种树成就不受影响，操作不可恢复。'
        }),
        el('button', {
          class: 'btn btn-danger btn-block',
          onclick: function () {
            V.confirm({
              title: '清空当前寻访',
              message: '确认清空「我的干员」「寻访数据」以及抽卡 / 集卡相关成就吗？此操作不可恢复。',
              okText: '确认清空', cancelText: '取消', danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.clearGacha();
              UI.toast('已清空当前寻访');
              var v = App.views.filter(function (x) { return x.id === 'collection'; })[0];
              if (v) v.render();
            });
          }
        }, ['一键清空当前寻访'])
      ]));

      return card;
    },

    /* ==========================================================
     * 成就（从设置迁入：抽卡/集卡未解锁隐藏、历练逐级解锁、记录获得时间）
     * ========================================================== */
    achPane: function () {
      var self = this;
      var st = Store.state;
      var card = el('div', { class: 'card', style: { padding: '14px 16px' } });
      card.appendChild(el('div', { class: 'section-title' }, ['全部成就']));

      (Store.ACH_GROUPS || []).forEach(function (grp) {
        var items = Store.achievementList().filter(function (a) {
          if (a.group !== grp) return false;
          // 抽卡 / 集卡：未解锁的成就全部隐藏
          if ((grp === '抽卡' || grp === '集卡') && !Store.isAchieved(a)) return false;
          // 历练：需先完成前置成就才出现
          if (a.req && !Store.achievementDone(a.req)) return false;
          return true;
        });
        if (!items.length) return;

        var doneG = items.filter(function (a) { return Store.isAchieved(a); }).length;
        card.appendChild(el('div', { class: 'ach-group-head' }, [
          el('b', { text: grp }),
          el('span', { text: doneG + ' / ' + items.length })
        ]));

        var grid = el('div', { class: 'ach-grid' });
        items.forEach(function (a) {
          var done = Store.isAchieved(a);
          var isCounted = !!a.metric;
          var val = isCounted ? Store.achievementValue(a.metric) : (done ? 1 : 0);
          var denom = isCounted ? a.threshold : 1;
          var tier = Store.ACH_TIERS[a.tier] || { color: '#888', label: '' };
          var pct = Math.max(0, Math.min(100, Math.round(val / denom * 100)));
          var rec = (st.achievements && st.achievements.done && st.achievements.done[a.id]) || null;

          var body = el('div', { class: 'ach-body' }, [
            el('div', { class: 'ach-name' }, [
              el('b', { text: a.name }),
              el('span', { class: 'ach-tier', style: { color: tier.color }, text: tier.label })
            ]),
            el('div', { class: 'ach-desc', text: a.desc })
          ]);
          body.appendChild(el('div', { class: 'ach-progress' }, [
            el('div', { class: 'ach-bar' }, [el('i', { style: { width: (done ? 100 : pct) + '%', background: tier.color } })]),
            el('span', { class: 'ach-count', text: isCounted ? (Math.min(val, a.threshold) + ' / ' + a.threshold) : (done ? '已达成' : '待触发') })
          ]));
          if (done && rec && rec.at) {
            body.appendChild(el('div', { class: 'ach-time', text: '获得于 ' + fmtAchTime(rec.at) }));
          }

          grid.appendChild(el('div', { class: 'ach-item' + (done ? ' done' : '') }, [
            el('div', { class: 'ach-icon tier-' + a.tier }, [V.svg(V.icons[a.icon] || V.icons.sparkle, 22)]),
            body,
            el('div', { class: 'ach-points' + (done ? ' got' : '') }, [
              el('span', { class: 'ach-status', text: done ? '已完成' : '待解锁' })
            ])
          ]));
        });
        card.appendChild(grid);
      });

      card.appendChild(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.7' },
        text: '成就只发徽章、不发放任何资源（积分 / 合成玉都不发）。达成条件即解锁；' +
              '抽卡与集卡类成就在解锁前默认隐藏；历练类成就按「初出茅庐(1 次) → 小有心得(10 次) → 炉火纯青(100 次)」逐级解锁。'
      }));
      return card;
    },

    /* ==========================================================
     * 我的森林（种树 / 浇水）
     * ========================================================== */
    forestPane: function () {
      var self = this;
      var pm = Store.pomodoro;
      var wrap = el('div', {});
      var card = el('div', { class: 'card', style: { padding: '16px 18px' } });

      card.appendChild(el('div', { class: 'section-title' }, [
        '我的森林',
        el('span', { class: 'q-count', text: pm.trees.length + ' / ' + POMO.GROVE_SLOTS + ' 个树位' })
      ]));

      // 当前树种
      var sel = speciesOf(pm.selectedSpecies);
      card.appendChild(el('div', { class: 'grove-pick' }, [
        el('div', { class: 'grove-pick-img' }, [treeSVG(3, sel)]),
        el('div', { class: 'grove-pick-main' }, [
          el('b', { text: '下次种下：' + sel.name }),
          el('span', { text: '专注 ≥' + POMO.FOCUS_MIN_MIN + ' 分钟即种下 / 养护；点右侧可换树种' })
        ]),
        el('button', { class: 'btn btn-sm', onclick: function () { openSpeciesDialog(self); } }, ['选择树种'])
      ]));

      // 4 个树位
      var grid = el('div', { class: 'grove-grid' });
      for (var i = 0; i < POMO.GROVE_SLOTS; i++) {
        var tr = pm.trees[i];
        if (tr) grid.appendChild(treeCard(tr, self));
        else {
          grid.appendChild(el('div', { class: 'grove-slot empty' }, [
            el('div', { class: 'grove-slot-plus', text: '+' }),
            el('span', { text: '空树位' })
          ]));
        }
      }
      card.appendChild(grid);

      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', margin: '10px 0 2px', lineHeight: '1.75' },
        text: '一次专注 ≥' + POMO.FOCUS_MIN_MIN + ' 分钟会种下 / 养护一棵树（≥60 分钟记 2 次）；中途中断则本次种子枯萎，满 60 分钟提醒起来走走。' +
          '养分（当前 ' + Math.round(pm.points) + '）用于浇水（' + POMO.WATER_COST + '）与复活枯桩（' + POMO.REVIVE_COST + '）。已收获 ' + (pm.harvested || 0) + ' 棵。'
      }));
      wrap.appendChild(card);

      // 树种图鉴（只显示已解锁的资料）
      var codex = el('div', { class: 'card', style: { padding: '16px 18px', marginTop: '14px' } });
      var unlocked = Store.unlockedSpecies();
      codex.appendChild(el('div', { class: 'section-title' }, [
        '树种图鉴',
        el('span', { class: 'q-count', text: unlocked.length + ' / ' + TREE_SPECIES.length })
      ]));
      var cg = el('div', { class: 'codex-grid' });
      unlocked.forEach(function (sp) {
        cg.appendChild(el('button', { class: 'codex-item', onclick: function () { openCodexInfo(sp); } }, [
          el('div', { class: 'codex-img' }, [treeSVG(5, sp)]),
          el('b', { text: sp.name })
        ]));
      });
      codex.appendChild(cg);
      var next = TREE_SPECIES.filter(function (sp) { return (sp.unlockH || 0) > Store.focusHours(); })
        .sort(function (a, b) { return a.unlockH - b.unlockH; })[0];
      codex.appendChild(el('div', {
        class: 'codex-next',
        text: next
          ? ('累计专注 ' + next.unlockH + ' 小时解锁下一树种（当前 ' + Store.focusHours().toFixed(1) + ' 小时）')
          : '全部树种已解锁 🎉'
      }));
      wrap.appendChild(codex);
      return wrap;
    }
  };

  /* ==========================================================
   * 树木渲染：5 个阶段 + 枯萎态（参数化 SVG，按树种形态分化）
   * ========================================================== */
  function rerender() {
    var v = App.views.filter(function (x) { return x.id === 'collection'; })[0];
    if (v) v.render();
  }

  /** stage：1~5；withered：枯桩；sp：树种（shape/crown/crown2/trunk/bloom） */
  function treeSVG(stage, sp, withered) {
    sp = sp || speciesOf('camphor');
    stage = stage || 1;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 120');
    svg.setAttribute('class', 'cp-tree-svg' + (withered ? ' cp-withered' : ''));

    function add(tag, attrs, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      (parent || svg).appendChild(n);
      return n;
    }

    add('ellipse', { cx: 50, cy: 114, rx: 28, ry: 5, fill: '#e7dfc8' });

    if (withered) {
      add('path', { d: 'M50 110 V58', stroke: '#8a7f6f', 'stroke-width': 6, 'stroke-linecap': 'round' });
      add('path', { d: 'M50 80 l-17 -15 M50 72 l16 -14 M50 64 l-11 -17 M50 60 l12 -16', stroke: '#8a7f6f', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' });
      add('path', { d: 'M33 65 q-4 7 0 11 M67 58 q4 7 0 11', stroke: '#a89a86', 'stroke-width': 2.2, fill: 'none' });
      return svg;
    }

    if (stage <= 1) {
      add('path', { d: 'M50 112 V92', stroke: sp.crown, 'stroke-width': 3, 'stroke-linecap': 'round' });
      add('ellipse', { cx: 43, cy: 90, rx: 9, ry: 5, fill: sp.crown, transform: 'rotate(-26 43 90)' });
      add('ellipse', { cx: 57, cy: 87, rx: 9, ry: 5, fill: sp.crown2, transform: 'rotate(26 57 87)' });
      return svg;
    }

    if (stage === 2) {
      add('path', { d: 'M50 112 V80', stroke: sp.trunk, 'stroke-width': 5, 'stroke-linecap': 'round' });
      add('circle', { cx: 50, cy: 74, r: 14, fill: sp.crown });
      add('circle', { cx: 43, cy: 79, r: 8, fill: sp.crown2 });
      return svg;
    }

    var big = stage >= 4;
    var trunkW = big ? 11 : 8;
    var topY = big ? 48 : 64;
    add('path', { d: 'M50 112 V' + topY, stroke: sp.trunk, 'stroke-width': trunkW, 'stroke-linecap': 'round' });
    add('path', { d: 'M50 82 l-12 -11', stroke: sp.trunk, 'stroke-width': 4, 'stroke-linecap': 'round' });
    add('path', { d: 'M50 76 l12 -10', stroke: sp.trunk, 'stroke-width': 4, 'stroke-linecap': 'round' });

    var g = add('g', { class: 'cp-crown' });
    var r = big ? 30 : 22;
    var cy = big ? 42 : 58;
    var shape = sp.shape || 'round';

    if (shape === 'cone') {
      var layers = big ? [[50, 12, 44, 38], [50, 32, 58, 60], [50, 52, 70, 84]]
                       : [[50, 30, 42, 56], [50, 48, 54, 80]];
      layers.forEach(function (L, i) {
        add('polygon', {
          points: L[0] + ',' + L[1] + ' ' + (L[0] - L[2] / 2) + ',' + L[3] + ' ' + (L[0] + L[2] / 2) + ',' + L[3],
          fill: i % 2 ? sp.crown2 : sp.crown
        }, g);
      });
    } else if (shape === 'fan') {
      var baseX = 50, baseY = cy + r * 0.55;
      [-42, -21, 0, 21, 42].forEach(function (ang, i) {
        var rad = ang * Math.PI / 180, len = r * 1.25;
        var ex = baseX + Math.sin(rad) * len, ey = baseY - Math.cos(rad) * len;
        add('ellipse', {
          cx: (baseX + ex) / 2, cy: (baseY + ey) / 2, rx: r * 0.4, ry: r * 0.72,
          fill: i % 2 ? sp.crown2 : sp.crown,
          transform: 'rotate(' + ang + ' ' + ((baseX + ex) / 2) + ' ' + ((baseY + ey) / 2) + ')'
        }, g);
      });
    } else if (shape === 'droop') {
      add('circle', { cx: 50, cy: cy, r: r, fill: sp.crown }, g);
      add('circle', { cx: 50 - r * 0.5, cy: cy + r * 0.3, r: r * 0.7, fill: sp.crown2 }, g);
      for (var k = -2; k <= 2; k++) {
        add('path', {
          d: 'M' + (50 + k * 9) + ' ' + (cy + r * 0.45) + ' q' + (k * 4) + ' ' + (r * 0.75) + ' ' + (k * 6) + ' ' + (r * 1.15),
          stroke: sp.crown2, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round'
        }, g);
      }
    } else if (shape === 'palm') {
      for (var a = -64; a <= 64; a += 32) {
        var rd = a * Math.PI / 180;
        var px = 50 + Math.sin(rd) * r * 1.4, py = topY - Math.cos(rd) * r * 1.15;
        add('path', { d: 'M50 ' + topY + ' Q' + ((50 + px) / 2) + ' ' + (topY - 15) + ' ' + px + ' ' + py, stroke: sp.crown, 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, g);
        add('path', { d: 'M50 ' + topY + ' Q' + ((50 + px) / 2) + ' ' + (topY - 15) + ' ' + px + ' ' + py, stroke: sp.crown2, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }, g);
      }
    } else {
      add('circle', { cx: 50, cy: cy, r: r, fill: sp.crown }, g);
      add('circle', { cx: 50 - r * 0.55, cy: cy + r * 0.42, r: r * 0.62, fill: sp.crown2 }, g);
      add('circle', { cx: 50 + r * 0.55, cy: cy + r * 0.38, r: r * 0.58, fill: sp.crown }, g);
    }

    if (stage >= 5 && sp.bloom) {
      [[38, cy - 2], [62, cy + 2], [50, cy + 12], [31, cy + 10], [69, cy + 8]].forEach(function (q) {
        add('circle', { cx: q[0], cy: q[1], r: 3, fill: sp.bloom }, g);
      });
    }
    return svg;
  }

  function treeCard(tree, view) {
    var sp = speciesOf(tree.species);
    var grown = tree.stage >= 5;
    var need = stageNeed(sp, tree.stage);
    var prog = grown ? 1 : Math.max(0, Math.min(1, (tree.prog || 0) / need));

    var cls = 'tree-card' + (tree.withered ? ' withered' : '') + (tree.id === justPlantedId ? ' just-planted' : '');
    var card = el('div', { class: cls, dataset: { id: tree.id } });
    card.appendChild(treeSVG(tree.stage, sp, tree.withered));
    card.appendChild(el('div', { class: 'tree-name', text: sp.name + ' · ' + (tree.withered ? '枯桩' : TREE_STAGES[tree.stage].name) }));

    card.appendChild(el('div', { class: 'tree-bar' }, [
      el('i', { style: { width: Math.round(prog * 100) + '%' } })
    ]));
    card.appendChild(el('div', {
      class: 'tree-growth',
      text: grown ? '已长成，可收获'
        : tree.withered ? ('已枯萎 · 复活后本阶段重攒')
        : tree.dormant ? ('休眠中 · 进度保留 ' + Math.min(tree.prog || 0, need) + ' / ' + need + ' 记，下次专注接着长')
        : ('成长 ' + Math.min(tree.prog || 0, need) + ' / ' + need + ' 记')
    }));

    if (tree.withered) {
      var fqR = Store.fishQuota();
      if (fqR.hold > 0 && fqR.left > 0) {
        card.appendChild(el('button', {
          class: 'btn btn-sm btn-primary btn-block',
          onclick: function () {
            var r = Store.useFishCard('revive', tree.id);
            if (!r.ok) { UI.toast(r.msg, 'err'); return; }
            UI.toast('摸鱼券复活了这棵树');
            if (view) view.render();
          }
        }, ['用摸鱼券复活（免养分）']));
      }
      card.appendChild(el('button', {
        class: 'btn btn-sm btn-block',
        onclick: function () {
          if (!Store.reviveTree(tree.id)) { UI.toast('养分不足，复活需 ' + POMO.REVIVE_COST + ' 养分', 'err'); return; }
          UI.toast('已复活，本阶段重新攒记');
          if (view) view.render();
        }
      }, ['复活 -' + POMO.REVIVE_COST + ' 养分']));
    } else if (grown) {
      card.appendChild(el('button', {
        class: 'btn btn-sm btn-primary btn-block',
        onclick: function () {
          if (Store.harvestTree(tree.id)) { UI.toast('已收获，移入收藏'); if (view) view.render(); }
        }
      }, ['收获入收藏']));
    } else {
      var canWater = Store.pomodoro.points >= POMO.WATER_COST;
      card.appendChild(el('button', {
        class: 'btn btn-sm btn-block' + (canWater ? '' : ' disabled'),
        onclick: function (e) {
          e.stopPropagation();
          if (!Store.waterTree(tree.id)) { UI.toast('养分不足，浇水需 ' + POMO.WATER_COST + ' 养分', 'err'); return; }
          UI.toast('浇了一次水，成长 +1 记');
          if (view) view.render();
          var node = V.$('.cp-tree-card[data-id="' + tree.id + '"]', view ? view.root : null);
          if (node) { node.classList.add('cp-watered'); setTimeout(function () { node.classList.remove('cp-watered'); }, 900); }
        }
      }, ['浇水 -' + POMO.WATER_COST + ' 养分']));
    }
    return card;
  }

  /** 选择下一次种下的树种（只列已解锁） */
  function openSpeciesDialog(view) {
    var m;
    var grid = el('div', { class: 'species-grid' });
    Store.unlockedSpecies().forEach(function (sp) {
      var active = Store.pomodoro.selectedSpecies === sp.key;
      grid.appendChild(el('button', {
        class: 'species-item' + (active ? ' active' : ''),
        onclick: function () {
          Store.setSelectedSpecies(sp.key);
          m.close();
          UI.toast('下次将种下「' + sp.name + '」');
          if (view) view.render();
        }
      }, [
        el('div', { class: 'species-img' }, [treeSVG(3, sp)]),
        el('b', { text: sp.name }),
        el('span', { text: '成熟需 ' + sp.lastK + ' 次' })
      ]));
    });
    var next = TREE_SPECIES.filter(function (sp) { return (sp.unlockH || 0) > Store.focusHours(); })
      .sort(function (a, b) { return a.unlockH - b.unlockH; })[0];
    m = V.modal({
      title: '选择树种',
      body: [
        el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
          text: '种植不花养分——一次 ≥' + POMO.FOCUS_MIN_MIN + ' 分钟的专注，就会在空树位种下当前树种并开始生长。' +
                (next ? ('累计专注 ' + next.unlockH + ' 小时可解锁「' + next.name + '」。') : '')
        }),
        grid
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-block', text: '关闭', onclick: function () { m.close(); } })
      ])
    });
  }

  /** 图鉴资料卡：五形态 + 资料 */
  function openCodexInfo(sp) {
    var strip = el('div', { class: 'codex-strip' });
    [1, 2, 3, 4, 5].forEach(function (st) {
      strip.appendChild(el('div', { class: 'codex-strip-cell' }, [
        treeSVG(st, sp),
        el('span', { text: TREE_STAGES[st].name })
      ]));
    });
    var info = sp.info || {};
    var m;
    m = V.modal({
      title: sp.name + ' · 图鉴',
      body: [
        strip,
        el('div', { class: 'codex-info' }, [
          el('div', {}, [el('b', { text: '学名' }), el('span', { text: info.sci || '—' })]),
          el('div', {}, [el('b', { text: '科属' }), el('span', { text: info.family || '—' })]),
          el('div', {}, [el('b', { text: '保护级别' }), el('span', { text: info.protect || '—' })]),
          el('div', {}, [el('b', { text: '趣闻' }), el('span', { text: info.note || '—' })]),
          el('div', {}, [el('b', { text: '成熟' }), el('span', { text: '第 4→5 阶段需 ' + (sp.lastK || 3) + ' 次专注' })])
        ])
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-block', text: '关闭', onclick: function () { m.close(); } })
      ])
    });
  }

  // 供首页森林预览复用
  global.TreeArt = { svg: treeSVG };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


