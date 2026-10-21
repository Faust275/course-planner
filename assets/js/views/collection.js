

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

    /* ==========================================================
     * 商店：月卡 + 满潜重复兑换
     * ========================================================== */
    shopPane: function () {
      var self = this;
      var wrap = el('div', { class: 'shop-pane' });
      var bal = Store.shopBalance();
      var info = Store.cardInfo();
      var dup = Store.dupPoolInfo();

      /* ---- 余额 ---- */
      var balCard = el('div', { class: 'card shop-bal' });
      [
        [bal.points, '森林积分'],
        [bal.jade, '合成玉'],
        [bal.total, '等值积分']
      ].forEach(function (x) {
        balCard.appendChild(el('div', { class: 'shop-bal-item' }, [
          el('b', { text: String(x[0]) }),
          el('span', { text: x[1] })
        ]));
      });
      wrap.appendChild(balCard);
      wrap.appendChild(el('div', {
        class: 'shop-note',
        text: '商城统一按积分计价（1 积分 = ' + POMO.JADE_PER_POINT +
          ' 合成玉）。扣款先扣森林积分，不够的部分再按比例扣合成玉。'
      }));

      /* ---- 月卡 ---- */
      var cardBox = el('div', { class: 'card shop-block' });
      cardBox.appendChild(el('div', { class: 'section-title' }, ['月卡']));

      function buy() {
        var r = Store.buyCard();
        if (!r.ok) { V.toast(r.msg, 'err'); return; }
        V.toast('月卡已开通，今天已返 ' + POMO.CARD_DAILY + ' 积分');
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
          text: '花 ' + POMO.CARD_PRICE + ' 积分开通 30 天：每天用任意功能返 ' +
            POMO.CARD_DAILY + ' 分；任意连续 7 天全勤额外 +' + POMO.CARD_WEEK_BONUS +
            '；30 天一天不漏再 +' + POMO.CARD_FULL_BONUS + '。漏签只损失当天和该窗口，有效期不顺延。'
        }));
        cardBox.appendChild(el('button', {
          class: 'btn btn-primary btn-block btn-lg',
          text: '开通月卡（' + POMO.CARD_PRICE + ' 积分）',
          onclick: buy
        }));
      } else {
        cardBox.appendChild(el('div', { class: 'shop-row' }, [
          el('b', { text: '剩余 ' + info.daysLeft + ' 天' }),
          el('span', { text: '已签 ' + info.signedDays + '/' + info.daysTotal + ' 天' })
        ]));

        /* 30 天进度条 */
        var bar = el('div', { class: 'shop-bar' });
        bar.appendChild(el('i', {
          style: { width: Math.round(info.signedDays / info.daysTotal * 100) + '%' }
        }));
        cardBox.appendChild(bar);

        /* 滚动 7 天：最近 7 天的签到点 */
        var dots = el('div', { class: 'shop-dots' });
        var c = Store.state.shop.card;
        for (var i = 6; i >= 0; i--) {
          var d = DateUtil.addDays(DateUtil.today(), -i);
          var key = DateUtil.toStr(d);
          var on = !!(c.days && c.days[key]);
          dots.appendChild(el('span', {
            class: 'shop-dot' + (on ? ' on' : ''),
            title: key + (on ? ' 已签到' : ' 未签到'),
            text: String(d.getDate())
          }));
        }
        cardBox.appendChild(el('div', { class: 'shop-label', text: '最近 7 天（连续 7 天全勤 +' + POMO.CARD_WEEK_BONUS + '）' }));
        cardBox.appendChild(dots);

        cardBox.appendChild(el('div', { class: 'shop-row shop-row-sub' }, [
          el('span', {
            text: info.todaySigned ? '今天已返 ' + POMO.CARD_DAILY + ' 积分' : '今天还没结算，进入任意模块即可'
          }),
          el('b', { text: '累计返 ' + info.gained + ' 积分' })
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
          text: '待兑换 ' + dup.count + ' 份重复干员，按星级折算共 ' + dup.points +
            ' 积分，可换 ' + dup.jade + ' 合成玉。'
        }));
        exBox.appendChild(el('button', {
          class: 'btn btn-primary btn-block',
          onclick: function () {
            var r = Store.exchangeDup();
            if (!r.ok) { V.toast('没有可兑换的重复干员', 'err'); return; }
            V.toast('已兑换 ' + r.jade + ' 合成玉');
            self.render();
          }
        }, [V.jade(16), '一键兑换 ' + dup.jade + ' 合成玉']));
      } else {
        exBox.appendChild(el('div', {
          class: 'q-empty',
          text: '暂无待兑换的重复干员。抽到满潜（6 份）之后，多余的复制会存到这里。'
        }));
      }
      wrap.appendChild(exBox);

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
              el('span', { class: 'ach-pts', text: '+' + a.points }),
              el('span', { class: 'ach-status', text: done ? '已完成' : '待解锁' })
            ])
          ]));
        });
        card.appendChild(grid);
      });

      card.appendChild(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.7' },
        text: '成就分「抽卡 / 集卡 / 种树 / 历练」四类：达成条件即可解锁并获得对应积分（抽卡模式下折算成合成玉）。' +
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
      var card = el('div', { class: 'card', style: { padding: '16px 18px' } });

      card.appendChild(el('div', { class: 'section-title' }, [
        '我的森林',
        el('span', { class: 'q-count', text: pm.trees.length + ' 棵' })
      ]));

      var baseCost = Store.plantCost(TREE_SPECIES[0].key);
      var canPlant = pm.points >= baseCost;
      var plantBtn = el('button', {
        class: 'btn ' + (canPlant ? 'btn-primary' : '') + ' btn-block',
        onclick: function () {
          if (Store.pomodoro.points < baseCost) {
            UI.toast('还差 ' + (baseCost - Store.pomodoro.points) + ' 分才能种树', 'err');
            return;
          }
          openPlantDialog(self);
        }
      }, [V.svg(V.icons.leaf, 16), canPlant
        ? '选树种 · 种一棵树'
        : '还差 ' + (baseCost - pm.points) + ' 分可种树']);
      plantBtn.style.marginBottom = '14px';
      card.appendChild(plantBtn);

      if (!pm.trees.length) {
        card.appendChild(V.empty(
          V.icons.tree, '森林还是空的',
          '专注攒够 ' + Store.plantCost(TREE_SPECIES[0].key) + ' 分就能种下第一棵树。不同树种价格不同，种得越多越贵（每棵 +' +
          POMO.PLANT_STEP + ' 分）；浇水（' + POMO.WATER_COST + ' 分）可以让它长大。'
        ));
        return card;
      }

      var grid = el('div', { class: 'tree-grid' });
      pm.trees.slice().reverse().forEach(function (tree) {
        grid.appendChild(treeCard(tree));
      });
      card.appendChild(grid);
      return card;
    }
  };

  /* ==========================================================
   * 树木渲染（从专注模块迁移而来）
   * ========================================================== */
  /** 根据成长阶段与树种画一棵树 */
  function treeSVG(stage, sp) {
    sp = sp || speciesOf('camphor');
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '16 2 68 118');
    svg.setAttribute('class', 'cp-tree-svg');

    function add(tag, attrs, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      (parent || svg).appendChild(n);
      return n;
    }

    add('ellipse', { cx: 50, cy: 112, rx: 30, ry: 5, fill: '#e7dfc8' });

    if (stage <= 0) {
      add('ellipse', { cx: 50, cy: 106, rx: 6, ry: 7, fill: sp.trunk });
      add('path', { d: 'M50 100 q1 -8 7 -11', stroke: sp.crown, 'stroke-width': 2.6, fill: 'none', 'stroke-linecap': 'round' });
      return svg;
    }

    if (stage === 1) {
      add('path', { d: 'M50 110 V84', stroke: sp.crown, 'stroke-width': 3.4, 'stroke-linecap': 'round' });
      add('ellipse', { cx: 41, cy: 88, rx: 10, ry: 5.5, fill: sp.crown, transform: 'rotate(-22 41 88)' });
      add('ellipse', { cx: 59, cy: 83, rx: 10, ry: 5.5, fill: sp.crown2, transform: 'rotate(22 59 83)' });
      return svg;
    }

    var big = stage >= 3;
    var trunkW = big ? 11 : 7.5;
    var topY = big ? 50 : 66;
    add('path', {
      d: 'M50 110 V' + topY,
      stroke: sp.trunk, 'stroke-width': trunkW, 'stroke-linecap': 'round'
    });
    if (big) {
      add('path', { d: 'M50 80 l-13 -12', stroke: sp.trunk, 'stroke-width': 5, 'stroke-linecap': 'round' });
      add('path', { d: 'M50 74 l13 -11', stroke: sp.trunk, 'stroke-width': 5, 'stroke-linecap': 'round' });
    }

    var g = add('g', { class: 'crown' });

    if (sp.shape === 'cone') {
      // 松树：三层塔形
      var layers = big ? [[50, 18, 44, 40], [50, 38, 56, 60], [50, 56, 66, 82]]
                       : [[50, 32, 40, 54], [50, 50, 52, 78]];
      layers.forEach(function (L, i) {
        add('polygon', {
          points: L[0] + ',' + L[1] + ' ' + (L[0] - L[2] / 2) + ',' + L[3] + ' ' + (L[0] + L[2] / 2) + ',' + L[3],
          fill: i % 2 ? sp.crown2 : sp.crown
        }, g);
      });
    } else {
      var r = big ? 30 : 23;
      var cy = big ? 42 : 56;
      add('circle', { cx: 50, cy: cy, r: r, fill: sp.crown }, g);
      add('circle', { cx: 50 - r * 0.55, cy: cy + r * 0.42, r: r * 0.62, fill: sp.crown2 }, g);
      add('circle', { cx: 50 + r * 0.55, cy: cy + r * 0.38, r: r * 0.58, fill: sp.crown }, g);
    }

    if (stage >= 4) {
      [[36, 48], [64, 45], [50, 60], [30, 62], [70, 58]].forEach(function (q) {
        add('circle', { cx: q[0], cy: q[1], r: 3.4, fill: '#e53935' });
      });
    }
    return svg;
  }

  function treeCard(tree) {
    var stage = treeStage(tree.growth || 0);
    var sp = speciesOf(tree.species);
    var next = TREE_STAGES[stage + 1];
    var prevMin = TREE_STAGES[stage].min;
    var nextMin = next ? next.min : null;
    var prog = nextMin ? (tree.growth - prevMin) / (nextMin - prevMin) : 1;
    prog = Math.max(0, Math.min(1, prog));

    var cls = 'tree-card';
    if (tree.id === justPlantedId) cls += ' just-planted';

    var card = el('div', { class: cls, dataset: { id: tree.id } });
    card.appendChild(treeSVG(stage, sp));
    card.appendChild(el('div', { class: 'tree-name', text: sp.name + ' · ' + TREE_STAGES[stage].name }));

    card.appendChild(el('div', { class: 'tree-bar' }, [
      el('i', { style: { width: Math.round(prog * 100) + '%' } })
    ]));
    card.appendChild(el('div', {
      class: 'tree-growth',
      text: nextMin ? ('成长 ' + tree.growth + ' / ' + nextMin) : ('成长 ' + tree.growth + ' · 已长成')
    }));

    var canWater = Store.pomodoro.points >= POMO.WATER_COST;
    card.appendChild(el('button', {
      class: 'btn btn-sm btn-block' + (canWater ? '' : ' disabled'),
      onclick: function (e) {
        e.stopPropagation();
        if (!Store.waterTree(tree.id)) {
          UI.toast('积分不足，浇水需要 ' + POMO.WATER_COST + ' 分', 'err');
          return;
        }
        UI.toast('浇了一次水，成长 +' + POMO.WATER_COST);
        var v = App.views.filter(function (x) { return x.id === 'collection'; })[0];
        if (v) v.render();
        // 直接在对应卡片上打特效，避免整页重渲染后特效错位（修复：右边树浇水左边树出特效）
        var node = V.$('.cp-tree-card[data-id="' + tree.id + '"]', v ? v.root : null);
        if (node) {
          node.classList.add('cp-watered');
          setTimeout(function () { node.classList.remove('cp-watered'); }, 900);
        }
      }
    }, ['浇水 -' + POMO.WATER_COST + ' 分']));

    return card;
  }

  /** 选择树种后种下（不同树种价格不同） */
  function openPlantDialog(view) {
    var m;
    var grid = el('div', { class: 'species-grid' });
    var maxPrice = TREE_SPECIES.reduce(function (mx, sp) { return Math.max(mx, sp.price); }, 0);
    TREE_SPECIES.forEach(function (sp) {
      var cost = Store.plantCost(sp.key);
      grid.appendChild(el('button', {
        class: 'species-item',
        onclick: function () {
          m.close();
          if (Store.pomodoro.points < cost) { UI.toast('积分不足，' + sp.name + '需 ' + cost + ' 分', 'err'); return; }
          var tree = Store.plantTree(sp.key);
          if (!tree) { UI.toast('积分不足', 'err'); return; }
          justPlantedId = tree.id;
          UI.toast('种下了一棵' + sp.name + '，积分 -' + cost);
          view.render();
          var node = V.$('.cp-tree-card[data-id="' + tree.id + '"]', view.root);
          if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, [
        el('div', { class: 'species-img' }, [treeSVG(3, sp)]),
        el('b', { text: sp.name }),
        el('span', { text: cost + ' 分' })
      ]));
    });

    m = V.modal({
      title: '选择树种',
      body: [
        el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
          text: '这是你的第 ' + (Store.pomodoro.trees.length + 1) + ' 棵树。不同树种基础价不同（' +
                TREE_SPECIES[0].price + '~' + maxPrice + ' 分），且种得越多下一棵越贵。当前可用 ' +
                Store.pomodoro.points + ' 分。'
        }),
        grid
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-block', text: '再等等', onclick: function () { m.close(); } })
      ])
    });
  }

  // 供首页森林预览复用
  global.TreeArt = { svg: treeSVG };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


