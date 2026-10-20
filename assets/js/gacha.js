/* ==========================================================
 * 抽卡机制（明日方舟标准寻访）
 * - 合成玉单抽 600 / 十连 6000
 * - 六星 2%、五星 8%、四星 50%、三星 40%
 * - 50 抽后六星概率每抽 +2%；每自然天第一个十连保底五星，其余十连不保底
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var STAR_COLOR = {
    6: '#ff9300', 5: '#f7d547', 4: '#c79bff', 3: '#6bc8ff', 2: '#8ee87f', 1: '#c4cbd6'
  };

  function starColor(r) { return STAR_COLOR[r] || '#c4cbd6'; }

  function stars(r) { return '★'.repeat(Math.max(0, Math.min(6, r))); }

  /** 合成玉图标 + 数字 */
  function jadeTag(n) {
    return el('span', { class: 'jade-tag', title: '合成玉' }, [
      V.svg(V.icons.jade, 13),
      el('b', { text: String(Math.round(n)) })
    ]);
  }

  /** 一张干员卡 */
  function opCard(op, opts) {
    opts = opts || {};
    var box = el('div', {
      class: 'op-card r' + op.r + (opts.big ? ' big' : ''),
      style: { '--sc': starColor(op.r) },
      onclick: opts.onclick || null,
      title: op.n + '（' + op.r + '★ · ' + (op.p || '') + '）'
    });

    if (op.img) {
      var img = el('img', {
        class: 'op-img', src: op.img, alt: op.n,
        loading: 'lazy', decoding: 'async'
      });
      img.addEventListener('error', function () {
        img.style.display = 'none';
        box.appendChild(el('span', { class: 'op-fallback', text: op.n.slice(0, 2) }));
      });
      box.appendChild(img);
    } else {
      box.appendChild(el('span', { class: 'op-fallback', text: op.n.slice(0, 2) }));
    }

    box.appendChild(el('span', { class: 'op-stars', text: stars(op.r) }));
    box.appendChild(el('span', { class: 'op-name', text: op.n }));
    if (op.count > 1) box.appendChild(el('span', { class: 'op-count', text: '×' + op.count }));
    // 潜能（右下角）：潜能 = max(0, min(复制数-1, 上限))
    var pot = Math.max(0, Math.min((op.count || 1) - 1, POMO.POT_MAX));
    if (pot > 0) {
      box.appendChild(el('span', {
        class: 'op-pot',
        title: '潜能 ' + pot + (op.dupPts ? '（已转化 ' + op.dupPts + ' 积分）' : ''),
        text: '★'.repeat(pot)
      }));
    }
    return box;
  }

  /* ==========================================================
   * 抽卡弹窗
   * ========================================================== */
  function openGacha() {
    var pm = Store.pomodoro;

    var balanceEl = el('div', { class: 'gc-balance' });
    var rateEl = el('div', { class: 'gc-rate' });
    var resultBox = el('div', { class: 'gc-result' });

    function drawHead() {
      balanceEl.innerHTML = '';
      balanceEl.appendChild(jadeTag(pm.jade));
      balanceEl.appendChild(el('span', {
        class: 'gc-sub',
        text: '≈ ' + (Math.round(pm.jade / POMO.JADE_PER_POINT * 10) / 10) + ' 积分'
      }));

      var s = Store.gachaStats();
      rateEl.innerHTML =
        '<div class="gcr-line">六星 <b>' + s.rate6 + '%</b>' +
        (s.pity >= POMO.PITY_START ? '<em>保底中</em>' : '') +
        '　·　距上次六星 <b>' + s.pity + '</b> 抽</div>' +
        '<div class="gcr-line gcr-dim">五星 8% · 四星 50% · 三星 40%　每自然天首个十连保底五星</div>';
    }

    function showResult(list) {
      resultBox.innerHTML = '';
      if (!list || !list.length) return;
      var grid = el('div', { class: 'gc-grid' });
      list.forEach(function (o, i) {
        var c = opCard(o);
        c.style.animationDelay = (i * 70) + 'ms';
        grid.appendChild(c);
      });
      resultBox.appendChild(grid);

      var best = 0;
      list.forEach(function (o) { if (o.r > best) best = o.r; });
      if (best >= 6) V.toast('六星干员！');
      else if (best === 5) V.toast('五星干员');
    }

    function canPull(cost) { return pm.jade >= cost; }

    function pull(times) {
      var cost = times === 10 ? POMO.TEN_COST : POMO.PULL_COST;
      if (!canPull(cost)) {
        V.toast('合成玉不够，还差 ' + (cost - pm.jade) + '（约 ' +
          (Math.round((cost - pm.jade) / POMO.JADE_PER_POINT * 10) / 10) + ' 积分）', 'err');
        return;
      }
      var list = Store.gachaPull(times);
      showResult(list);
      drawHead();
      drawFoot();
      if (list && list.converted) {
        V.toast('满潜能重复干员，已转化 ' + list.converted + ' 积分');
      }
    }

    var footBox = el('div', { class: 'modal-foot' });
    function drawFoot() {
      footBox.innerHTML = '';
      footBox.appendChild(el('button', {
        class: 'btn', text: '关闭', onclick: function () { m.close(); }
      }));
      footBox.appendChild(el('button', {
        class: 'btn' + (canPull(POMO.PULL_COST) ? ' btn-primary' : ''),
        onclick: function () { pull(1); }
      }, [jadeTag(POMO.PULL_COST), el('span', { text: '单抽' })]));
      footBox.appendChild(el('button', {
        class: 'btn' + (canPull(POMO.TEN_COST) ? ' btn-primary' : ''),
        onclick: function () { pull(10); }
      }, [jadeTag(POMO.TEN_COST), el('span', { text: '十连' })]));
    }

    var m = V.modal({
      title: '寻访 · 标准池',
      width: '560px',
      body: [
        el('div', { class: 'gc-head' }, [balanceEl, rateEl]),
        resultBox,
        el('p', {
          class: 'ocr-hint',
          text: '消耗合成玉寻访干员。600 玉单抽一次，6000 玉十连；1 积分 = 600 合成玉，也就是 1 积分能抽一次。'
        })
      ],
      footer: footBox
    });

    drawHead();
    drawFoot();
  }

  /* ==========================================================
   * 已获得干员墙
   * ========================================================== */
  function opsWall(limit) {
    var owned = Store.gachaOwned();
    var wrap = el('div', { class: 'ops-wall' });

    if (!owned.length) {
      wrap.appendChild(el('div', { class: 'q-empty', text: '还没有寻访到干员，先去专注攒合成玉吧' }));
      return wrap;
    }

    var shown = limit ? owned.slice(0, limit) : owned;
    shown.forEach(function (o) {
      wrap.appendChild(opCard(o, { onclick: function () { opDetail(o); } }));
    });

    if (limit && owned.length > limit) {
      wrap.appendChild(el('button', {
        class: 'ops-more',
        onclick: function () { global.Gacha.openOps(); }
      }, ['+' + (owned.length - limit)]));
    }
    return wrap;
  }

  /** 干员大图详情 */
  function opDetail(op) {
    var got = null;
    Store.pomodoro.gacha.ops.forEach(function (o) { if (o.n === op.n) got = o; });
    var rec = got || op;

    var body = el('div', { class: 'op-detail' }, [
      el('div', {
        class: 'od-avatar', style: { '--sc': starColor(rec.r) }
      }, [
        rec.img ? el('img', { src: rec.img, alt: rec.n }) : null,
        el('span', { class: 'od-stars', text: stars(rec.r) })
      ]),
      el('div', { class: 'od-info' }, [
        el('b', { text: rec.n }),
        el('span', { text: rec.r + '★ · ' + (rec.p || '—') }),
        el('span', { class: 'od-dim', text: '已获得 ' + (rec.count || 1) + ' 次 · 潜能 ' + Math.max(0, Math.min((rec.count || 1) - 1, POMO.POT_MAX)) + (rec.dupPts ? ' · 已转化 ' + rec.dupPts + ' 积分' : '') })
      ])
    ]);

    V.modal({
      title: '干员详情',
      width: '380px',
      body: [body],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-primary', text: '关闭', onclick: function () { this.closest('.modal-wrap').remove(); } })
      ])
    });
  }

  /** 全部干员图鉴弹窗 */
  function openOps() {
    var s = Store.gachaStats();
    var owned = Store.gachaOwned();

    var rows = [6, 5, 4, 3].map(function (r) {
      var g = s.byR[r] || [0, 0];
      return '<span class="macro" style="background:' + starColor(r) + '22;color:' + starColor(r) + '">' +
        r + '★ ' + g[0] + '/' + g[1] + '</span>';
    }).join('');

    var box = el('div', { class: 'ops-all' });
    if (!owned.length) {
      box.appendChild(el('div', { class: 'q-empty', text: '还没有寻访到干员' }));
    } else {
      owned.forEach(function (o) {
        box.appendChild(opCard(o, { onclick: function () { opDetail(o); } }));
      });
    }

    V.modal({
      title: '我的干员',
      width: '600px',
      body: [
        el('div', { class: 'ops-stat' }, [
          el('b', { text: s.owned + ' / ' + s.total }),
          el('span', { text: '已收集' }),
          el('span', { class: 'ops-pulls', text: '累计 ' + s.pulls + ' 抽' })
        ]),
        el('div', { class: 'dp-macros', html: rows }),
        box
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-primary', text: '关闭', onclick: function () { this.closest('.modal-wrap').remove(); } })
      ])
    });
  }

  /* ==========================================================
   * 寻访数据
   * ========================================================== */
  function sumChip(label, val, color) {
    return el('div', { class: 'grec-chip' }, [
      el('b', { text: String(val), style: color ? { color: color } : {} }),
      el('span', { text: label })
    ]);
  }

  function recordsView() {
    var h = Store.gachaHistory();
    var box = el('div', { class: 'grec' });

    if (!h.set.length) {
      box.appendChild(el('div', {
        class: 'q-empty',
        text: '窗口（近 30 天 ∩ 最近 100 抽）内还没有寻访记录'
      }));
      return box;
    }

    var s = h.stats;
    var rate6 = s.pulls ? Math.round(s.r6 / s.pulls * 1000) / 10 : 0;

    box.appendChild(el('div', { class: 'grec-sum' }, [
      sumChip('抽数', s.pulls, ''),
      sumChip('六星', s.r6, '#ff9300'),
      sumChip('五星', s.r5, '#f7d547'),
      sumChip('四星', s.r4, '#c79bff'),
      sumChip('三星', s.r3, '#6bc8ff'),
      sumChip('六星率', rate6 + '%', '#ff9300')
    ]));

    box.appendChild(el('div', {
      class: 'grec-note',
      text: '窗口：近 30 天 ∩ 最近 100 抽　（最近100抽 ' + h.last100 + ' · 窗口内 ' + s.pulls + ' 抽）'
    }));

    h.days.forEach(function (d) {
      var items = h.set.filter(function (p) {
        return (p.t ? DateUtil.toStr(new Date(p.t)) : '未知') === d;
      });
      var row = el('div', { class: 'grec-day' }, [
        el('div', { class: 'grec-date', text: d + '　·　' + items.length + ' 抽' })
      ]);
      var chips = el('div', { class: 'grec-chips' });
      items.forEach(function (p) {
        chips.appendChild(el('span', { class: 'grec-pull r' + p.r, title: p.r + '★', text: p.n }));
      });
      row.appendChild(chips);
      box.appendChild(row);
    });

    return box;
  }

  global.Gacha = {
    open: openGacha,
    openOps: openOps,
    wall: opsWall,
    card: opCard,
    records: recordsView,
    jadeTag: jadeTag,
    starColor: starColor,
    stars: stars
  };
})(window);
