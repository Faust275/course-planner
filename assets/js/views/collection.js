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
  var wateredId = '';

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
      var done = 0;
      Store.achievementList().forEach(function (a) { if (Store.isAchieved(a)) done++; });

      root.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(s.owned, '已获得干员', 'var(--amber)'),
        V.statCard(pm.trees.length, '我的森林（棵）', 'var(--green)'),
        V.statCard(done, '成就', 'var(--text-2)')
      ]));

      var tabs = el('div', { class: 'gacha-tabs' }, [
        el('button', {
          class: 'gacha-tab' + (this.tab === 'ops' ? ' active' : ''),
          text: '干员图鉴 ' + s.owned + '/' + s.total,
          onclick: function () { self.tab = 'ops'; self.render(); }
        }),
        el('button', {
          class: 'gacha-tab' + (this.tab === 'forest' ? ' active' : ''),
          text: '我的森林 ' + pm.trees.length,
          onclick: function () { self.tab = 'forest'; self.render(); }
        })
      ]);
      root.appendChild(tabs);

      if (this.tab === 'forest') root.appendChild(this.forestPane());
      else root.appendChild(this.opsPane());
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
      }, [V.svg(V.icons.jade, 17), '去寻访（' + POMO.PULL_COST + ' 合成玉 / 次）']));

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

      var cost = Store.plantCost();
      var canPlant = pm.points >= cost;
      var plantBtn = el('button', {
        class: 'btn ' + (canPlant ? 'btn-primary' : '') + ' btn-block',
        onclick: function () {
          if (Store.pomodoro.points < cost) {
            UI.toast('还差 ' + (cost - Store.pomodoro.points) + ' 分才能种树', 'err');
            return;
          }
          openPlantDialog(cost, self);
        }
      }, [V.svg(V.icons.leaf, 16), canPlant
        ? '种一棵树（-' + cost + ' 分）'
        : '还差 ' + (cost - pm.points) + ' 分可种树']);
      plantBtn.style.marginBottom = '14px';
      card.appendChild(plantBtn);

      if (!pm.trees.length) {
        card.appendChild(V.empty(
          V.icons.tree, '森林还是空的',
          '专注攒够 ' + Store.plantCost() + ' 分就能种下第一棵树。种得越多，下一棵越贵（每棵 +' +
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
    svg.setAttribute('class', 'tree-svg');

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
    if (tree.id === wateredId) cls += ' watered';

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
        wateredId = tree.id;
        UI.toast('浇了一次水，成长 +' + POMO.WATER_COST);
        var v = App.views.filter(function (x) { return x.id === 'collection'; })[0];
        if (v) v.render();
        setTimeout(function () { wateredId = ''; }, 900);
      }
    }, ['浇水 -' + POMO.WATER_COST + ' 分']));

    return card;
  }

  /** 选择树种后种下 */
  function openPlantDialog(cost, view) {
    var m;
    var grid = el('div', { class: 'species-grid' });
    TREE_SPECIES.forEach(function (sp) {
      grid.appendChild(el('button', {
        class: 'species-item',
        onclick: function () {
          m.close();
          var tree = Store.plantTree(sp.key);
          if (!tree) { UI.toast('积分不足', 'err'); return; }
          justPlantedId = tree.id;
          UI.toast('种下了一棵' + sp.name + '，积分 -' + cost);
          view.render();
          var node = V.$('.tree-card[data-id="' + tree.id + '"]', view.root);
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
          text: '这是你的第 ' + (Store.pomodoro.trees.length + 1) + ' 棵树，需要 ' + cost +
                ' 分（当前可用 ' + Store.pomodoro.points + ' 分）。种得越多，下一棵越贵。'
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
