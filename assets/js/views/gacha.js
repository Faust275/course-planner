

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

  /** 干员元数据：名称 → { faction, limited, reserve }（来源 ak_ops.js 的扩展字段） */
  var OP_META = (function () {
    var m = {};
    (global.AK_OPS || []).forEach(function (o) {
      m[o[0]] = { faction: o[4], limited: !!o[6], reserve: !!o[5] };
    });
    return m;
  })();

  /** 由阵营名生成一个稳定的颜色（用于分组小圆点） */
  function facColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 52%, 56%)';
  }

  /** 把已获得干员按阵营分组（按人数降序），返回 [{name, ops}] */
  function groupByFaction(owned) {
    var groups = {};
    owned.forEach(function (o) {
      var f = (OP_META[o.n] && OP_META[o.n].faction) || '其他';
      (groups[f] = groups[f] || []).push(o);
    });
    var names = Object.keys(groups).sort(function (a, b) {
      return groups[b].length - groups[a].length || (a < b ? -1 : 1);
    });
    return names.map(function (f) {
      return {
        name: f,
        ops: groups[f].sort(function (x, y) {
          return (y.r - x.r) || (String(x.n) < String(y.n) ? -1 : 1);
        })
      };
    });
  }

  /** 阵营分组后的干员墙 DOM */
  function factionGroupsEl(owned, opts) {
    opts = opts || {};
    var wrap = el('div', { class: 'ops-groups' });
    if (!owned.length) {
      wrap.appendChild(el('div', { class: 'q-empty', text: opts.empty || '还没有寻访到干员' }));
      return wrap;
    }
    groupByFaction(owned).forEach(function (g) {
      var section = el('div', { class: 'ops-group' });
      section.appendChild(el('div', { class: 'ops-group-title' }, [
        el('span', { class: 'dot', style: { background: facColor(g.name) } }),
        el('span', { text: g.name }),
        el('span', { class: 'cnt', text: g.ops.length + ' 名' })
      ]));
      var grid = el('div', { class: 'ops-grid' });
      g.ops.forEach(function (o) {
        grid.appendChild(opCard(o, { onclick: function () { opDetail(o); } }));
      });
      section.appendChild(grid);
      wrap.appendChild(section);
    });
    return wrap;
  }

  function stars(r) { return '★'.repeat(Math.max(0, Math.min(6, r))); }

  /** 合成玉图标 + 数字 */
  function jadeTag(n) {
    return el('span', { class: 'jade-tag', title: '合成玉' }, [
      V.jade(13),
      el('b', { text: String(Math.round(n)) })
    ]);
  }

  /** 一张干员卡 */
  function opCard(op, opts) {
    opts = opts || {};
    var meta = OP_META[op.n] || {};
    var pot = Math.max(0, Math.min((op.count || 1) - 1, POMO.POT_MAX));
    var maxpot = op.r >= 5 && pot >= POMO.POT_MAX;
    var box = el('div', {
      class: 'op-card r' + op.r + (maxpot ? ' op-maxpot' : '') + (opts.big ? ' big' : ''),
      style: { '--sc': starColor(op.r) },
      onclick: opts.onclick || null,
      title: op.n + '（' + op.r + '★ · ' + (op.p || '') +
        (meta.faction ? ' · ' + meta.faction : '') +
        (meta.limited ? ' · 限定' : '') + (meta.reserve ? ' · 预备' : '') + '）'
    });

    if (op.img) {
      var img = el('img', {
        class: 'op-img', src: op.img, alt: op.n,
        loading: 'lazy', decoding: 'async'
      });
      // 最佳努力的离线头像缓存：首载成功后把图片存进持久化层，
      // 下次离线优先用本地副本；跨域不允许缓存时静默忽略，行为不变。
      var avKey = 'avatar:' + op.n;
      if (Store.persist) {
        Store.persist.load(avKey).then(function (d) { if (d) img.src = d; }).catch(function () {});
        img.addEventListener('load', function () {
          try {
            fetch(op.img, { mode: 'cors' }).then(function (r) {
              if (!r || !r.ok) throw new Error('bad status');
              return r.blob();
            }).then(function (b) {
              if (!b || !b.type || b.type.indexOf('image/') !== 0) return;
              var fr = new FileReader();
              fr.onload = function () { Store.persist.save(avKey, fr.result); };
              fr.readAsDataURL(b);
            }).catch(function () {});
          } catch (e) {}
        });
      }
      img.addEventListener('error', function () {
        img.style.display = 'none';
        if (!box.querySelector('.cp-op-fallback')) {
          box.insertBefore(el('span', { class: 'op-fallback', text: op.n.slice(0, 2) }), box.firstChild);
        }
      });
      box.appendChild(img);
    } else {
      box.appendChild(el('span', { class: 'op-fallback', text: op.n.slice(0, 2) }));
    }

    box.appendChild(el('span', { class: 'op-stars', text: stars(op.r) }));
    box.appendChild(el('span', { class: 'op-name', text: op.n }));
    if (op.count > 1) box.appendChild(el('span', { class: 'op-count', text: '×' + op.count }));
    // 潜能（右下角）：潜能 = max(0, min(复制数-1, 上限))
    if (pot > 0) {
      box.appendChild(el('span', {
        class: 'op-pot',
        title: '潜能 ' + pot + (op.dupPts ? '（累计满潜重复 ' + op.dupPts + ' 积分）' : ''),
        text: '★'.repeat(pot)
      }));
    }
    // 标签：限定 / 预备 / 满潜（覆盖在头像左上角）
    var tags = [];
    if (meta.limited) tags.push(el('span', { class: 'op-tag op-tag-limited', title: '限定干员', text: '限定' }));
    if (meta.reserve) tags.push(el('span', { class: 'op-tag op-tag-reserve', title: '预备干员', text: '预备' }));
    if (maxpot) tags.push(el('span', { class: 'op-tag op-tag-maxpot', title: '已满潜能（满潜）', text: '满潜' }));
    if (tags.length) box.appendChild(el('div', { class: 'op-tags' }, tags));
    if (opts.isNew) box.appendChild(el('span', { class: 'op-new', text: 'NEW' }));
    return box;
  }

  /* ==========================================================
   * 抽卡弹窗
   * ========================================================== */
  /** 井兑换：只能在「含当期在内的最近 N 期 UP」里选 */
  function sparkPicker(poolId, done) {
    var sp = Store.sparkInfo(poolId);
    if (!sp.ready) { V.toast('井还没攒够（' + sp.count + '/' + sp.need + '）', 'err'); return; }
    var list = Store.gachaSparkPool(poolId);
    if (!list.length) { V.toast('暂时没有可兑换的干员', 'err'); return; }
    var mSpark;
    var box = el('div', { class: 'limited-picker' });
    list.forEach(function (x) {
      var rec = Store.opByName(x.n);
      box.appendChild(el('button', {
        class: 'btn btn-block limited-pick',
        text: (rec ? rec.r + '★ ' : '') + x.n +
              (x.periodsAgo === 0 ? '（本期）' : '（' + x.periodsAgo + ' 期前）'),
        onclick: function () {
          if (mSpark) mSpark.close();
          setTimeout(function () {
            V.confirm({
              title: '井兑换',
              message: '将消耗攒满的井（计数清零），兑换「' + x.n + '」。确定继续吗？',
              okText: '兑换'
            }).then(function (ok) {
              if (!ok) return;
              var r = Store.redeemSpark(poolId, x.n);
              if (!r.ok) { V.toast(r.msg, 'err'); return; }
              V.toast('井兑换成功：' + r.n);
              if (done) done();
            });
          }, 210);
        }
      }));
    });
    mSpark = V.modal({
      title: '井兑换 · ' + sp.name,
      width: '420px',
      body: [
        el('div', { class: 'ocr-hint', text: '可兑换范围：含当期在内的最近 ' +
          (POMO.GACHA_POOLS[poolId].sparkHistory || 5) + ' 期 UP。' }),
        box
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { mSpark.close(); } })
      ])
    });
  }


  /* ---------- 🎯 心愿单管理弹窗 ---------- */
  function openWishlistModal(onDone) {
    var all = global.AK_OPS || [];
    var highStarOps = all.filter(function (o) { return o[1] >= 5; });
    var searchVal = '';

    var listWrap = el('div', { style: { maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' } });

    function renderList() {
      listWrap.innerHTML = '';
      var curWish = Store.getWishlist ? Store.getWishlist() : [];
      var filtered = highStarOps.filter(function (o) {
        if (!searchVal) return true;
        return o[0].toLowerCase().indexOf(searchVal.toLowerCase()) >= 0;
      });

      if (!filtered.length) {
        listWrap.appendChild(el('div', { style: { textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }, text: '未找到匹配的干员' }));
        return;
      }

      filtered.forEach(function (o) {
        var isW = curWish.indexOf(o[0]) >= 0;
        var row = el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderRadius: '6px', background: isW ? 'var(--primary-weak)' : 'var(--bg-weak)',
            border: '1px solid ' + (isW ? 'var(--primary)' : 'var(--border)'), cursor: 'pointer'
          },
          onclick: function () {
            if (Store.toggleWishlist) {
              Store.toggleWishlist(o[0]);
              renderList();
              if (onDone) onDone();
            }
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
            el('b', { style: { color: starColor(o[1]) }, text: '★' + o[1] }),
            el('span', { style: { fontWeight: isW ? 'bold' : 'normal' }, text: o[0] }),
            el('span', { style: { fontSize: '11px', color: 'var(--text-muted)' }, text: o[7] === 'classic' ? '中坚' : '标准' })
          ]),
          el('button', {
            class: 'btn btn-sm ' + (isW ? 'btn-primary' : ''),
            style: { padding: '2px 8px', fontSize: '12px' }
          }, [isW ? '❤️ 已锁定' : '+ 加入心愿'])
        ]);
        listWrap.appendChild(row);
      });
    }

    var searchInput = V.input({
      type: 'text', placeholder: '搜索 5★/6★ 干员名称...',
      oninput: function () { searchVal = this.value.trim(); renderList(); }
    });

    renderList();

    var mWish = V.modal({
      title: '🎯 锁定心愿干员 (最多 2 位)',
      width: '420px',
      body: [
        el('div', { class: 'ocr-hint', text: '锁定心愿后，系统将持续追踪其在标准/中坚池的轮换周期，并在临近到货时在首页提醒你加速备考攒玉。' }),
        searchInput,
        listWrap
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '完成', onclick: function () { mWish.close(); } })
      ])
    });
  }

  function openGacha() {
    var pm = Store.pomodoro;

    var balanceEl = el('div', { class: 'gc-balance' });
    var poolEl = el('div', { class: 'gc-pool' });
    var sparkEl = el('div', { class: 'gc-spark' });
    var previewEl = el('div', { class: 'gc-preview' });
    var wishEl = el('div', { class: 'gc-wishlist' });
    var rateEl = el('div', { class: 'gc-rate' });
    var lkBox = el('div', { class: 'gc-rate cp-gc-spark-box' });
    var resultBox = el('div', { class: 'gc-result' });

    function drawHead() {
      balanceEl.innerHTML = '';
      balanceEl.appendChild(jadeTag(pm.jade));
      balanceEl.appendChild(el('span', {
        class: 'gc-sub',
        text: '≈ ' + (Math.round(pm.jade / POMO.JADE_PER_POINT * 10) / 10) + ' 积分'
      }));
      balanceEl.appendChild(V.ruleHelpBtn('寻访与积分折算规则', [
        { label: '单抽 / 十连', text: POMO.PULL_COST + ' 合成玉单抽一次，' + POMO.TEN_COST + ' 合成玉十连' },
        { label: '积分折算', text: '1 积分 = ' + POMO.JADE_PER_POINT + ' 合成玉，单抽约需 3.33 积分' },
        { label: '概率与保底', text: '六星基础概率 2%（50 抽后递增），每自然天首个十连保底五星' }
      ], { style: { marginLeft: '6px' } }));

      var poolId = pm.gacha.currentPool || 'standard';
      var st = Store.gachaPoolState(poolId);
      var sp = Store.sparkInfo(poolId);
      var up = Store.gachaCurrentUp(poolId);

      /* 池切换 */
      poolEl.innerHTML = '';
      poolEl.appendChild(el('div', { class: 'gc-pool-tabs' }, Object.keys(POMO.GACHA_POOLS).map(function (id) {
        return el('button', {
          class: 'gc-pool-tab' + (id === poolId ? ' active' : ''),
          text: POMO.GACHA_POOLS[id].name,
          onclick: function () {
            Store.setGachaPool(id);
            drawHead();
            V.toast('已切到' + POMO.GACHA_POOLS[id].name);
          }
        });
      })));
      poolEl.appendChild(el('div', { class: 'gc-pool-desc', text: POMO.GACHA_POOLS[poolId].desc }));
      poolEl.appendChild(el('div', { class: 'gc-up-line' }, [
        el('span', { class: 'gc-up-tag', text: '本期 UP' }),
        el('b', { class: 'gc-up-six', text: up.six.join(' · ') || '—' })
      ]));
      if (up.five.length) {
        poolEl.appendChild(el('div', { class: 'gc-up-line gc-up-dim' }, [
          el('span', { text: '五星 UP' }),
          el('span', { text: up.five.join(' · ') })
        ]));
      }
      if (st.guaranteed) {
        poolEl.appendChild(el('div', { class: 'gc-guarantee', text: '上次歪了 → 下一个六星必为当期 UP' }));
      }

      /* 井进度 + 兑换按钮 */
      sparkEl.innerHTML = '';
      var pct = Math.min(100, Math.round(sp.count / sp.need * 100));
      sparkEl.appendChild(el('div', { class: 'gc-up-line' }, [
        el('span', { text: sp.name + ' 井 ' }),
        el('b', { text: sp.count + ' / ' + sp.need }),
        el('span', { class: 'gc-up-dim', text: '　跨期不清零' })
      ]));
      var bar = el('div', { class: 'cp-gc-spark' });
      bar.appendChild(el('i', { style: { width: pct + '%' } }));
      sparkEl.appendChild(bar);
      sparkEl.appendChild(el('button', {
        class: 'btn' + (sp.ready ? ' btn-primary' : ''),
        text: sp.ready ? '井兑换（近 5 期 UP）' : '井兑换（还差 ' + (sp.need - sp.count) + ' 抽）',
        onclick: function () { sparkPicker(poolId, function () { drawHead(); }); }
      }));

      /* 未来 3 期预告 */
      var soon = Store.gachaUpcoming(poolId, 3);
      previewEl.innerHTML = '';
      previewEl.appendChild(el('div', { class: 'gc-prev-title', text: '后续 3 期 UP 预告（每 ' + POMO.GACHA_POOLS[poolId].rotDays + ' 天轮换）' }));
      soon.forEach(function (p) {
        previewEl.appendChild(el('div', { class: 'gc-prev-row' }, [
          el('span', { class: 'gc-prev-day', text: '+' + (p.offset * POMO.GACHA_POOLS[poolId].rotDays) + '天' }),
          el('span', { text: p.six.join(' · ') })
        ]));
      });

      /* 心愿单到货预报 */
      wishEl.innerHTML = '';
      if (Store.wishlistForecast) {
        var forecasts = Store.wishlistForecast();
        var wishCard = el('div', { class: 'card cp-wish-card', style: { padding: '12px 14px', marginBottom: '12px' } });
        var wishHead = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
          el('div', { style: { fontWeight: 'bold', fontSize: '13.5px' } }, ['🎯 我的心愿干员与到货预警']),
          el('button', {
            class: 'btn btn-sm', style: { padding: '2px 8px', fontSize: '12px' },
            onclick: function () { openWishlistModal(function () { drawHead(); }); }
          }, ['管理心愿单 (最多2位)'])
        ]);
        wishCard.appendChild(wishHead);

        if (!forecasts.length) {
          wishCard.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' }, text: '暂未锁定心愿干员。点击「管理心愿单」设置，系统将为你计算未来轮换倒计时与攒玉进度。' }));
        } else {
          var fGrid = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
          forecasts.forEach(function (f) {
            var row = el('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-weak)', padding: '6px 10px', borderRadius: '6px' }
            }, [
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                el('b', { style: { color: starColor(f.star) }, text: f.name }),
                el('span', { style: { fontSize: '12px', color: 'var(--text-muted)' }, text: '· ' + f.poolName })
              ]),
              el('div', { style: { textAlign: 'right', fontSize: '12px' } }, [
                el('span', {
                  style: { fontWeight: 'bold', color: f.isCurrent ? 'var(--red)' : (f.daysLeft <= 7 ? 'var(--amber)' : 'var(--text-2)') },
                  text: f.isCurrent ? '🔥 当期 UP 寻访中！' : (f.daysLeft > 0 ? ('还有 ' + f.daysLeft + ' 天轮换') : '即将到来')
                }),
                el('span', { style: { marginLeft: '8px', color: 'var(--text-muted)' }, text: '备考玉 ' + f.readyPct + '%' })
              ])
            ]);
            fGrid.appendChild(row);
          });
          wishCard.appendChild(fGrid);
        }
        wishEl.appendChild(wishCard);
      }


      var s = Store.gachaStats();
      rateEl.innerHTML =
        '<div class="cp-gcr-line">六星 <b>' + s.rate6 + '%</b>' +
        (s.pity >= POMO.PITY_START ? '<em>保底中</em>' : '') +
        '　·　距上次六星 <b>' + s.pity + '</b> 抽</div>' +
        '<div class="cp-gcr-line cp-gcr-dim">五星 8% · 四星 50% · 三星 40%　每自然天首个十连保底五星</div>';

      // 限定井进度：与抽卡同屏呈现，攒井过程看得见
      var lk = Store.limitedSparkInfo();
      lkBox.innerHTML = '';
      var pct = Math.min(100, Math.round(lk.count / lk.need * 100));
      lkBox.appendChild(el('div', { class: 'cp-gcr-line' }, [
        el('span', { text: '限定井 ' }),
        el('b', { text: lk.count + ' / ' + lk.need }),
        el('span', { class: 'cp-gcr-dim', text: lk.target ? '　目标 ' + lk.target : '　未登记目标' })
      ]));
      var bar = el('div', { class: 'cp-gc-spark' });
      bar.appendChild(el('i', { style: { width: pct + '%' } }));
      lkBox.appendChild(bar);
      if (lk.ready) {
        lkBox.appendChild(el('div', {
          class: 'cp-gcr-line cp-gc-spark-ready',
          text: '已攒满，可到「收集 → 商店 → 限定专区」兑换'
        }));
      }
    }

    function showResult(list, newSet) {
      resultBox.innerHTML = '';
      if (!list || !list.length) return;
      newSet = newSet || {};
      var grid = el('div', { class: 'gc-grid' });
      list.forEach(function (o, i) {
        var flip = el('div', { class: 'op-flip' });
        var card = opCard(o, { isNew: !!newSet[o.n] });
        var back = el('div', { class: 'op-back' });
        flip.appendChild(back);
        flip.appendChild(card);
        if (o.r >= 6) flip.appendChild(el('div', { class: 'op-beam' }));
        grid.appendChild(flip);
        setTimeout(function () { flip.classList.add('cp-flipped'); }, 250 + i * 95);
      });
      resultBox.appendChild(grid);

      var best = 0;
      list.forEach(function (o) { if (o.r > best) best = o.r; });
      var settle = 250 + (list.length - 1) * 95 + 620;
      setTimeout(function () {
        if (best >= 6) V.toast('六星干员！');
        else if (best === 5) V.toast('五星干员');
      }, settle);
    }

    function canPull(cost) { return pm.jade >= cost; }

    var pulling = false;
    function lockFoot(on) {
      var btns = footBox.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].disabled = on;
        btns[i].style.opacity = on ? '.55' : '';
      }
    }
    function playIntro(times, done) {
      resultBox.innerHTML = '';
      var nBack = times === 10 ? 5 : 1;
      var cards = el('div', { class: 'gc-intro-cards' });
      for (var k = 0; k < nBack; k++) cards.appendChild(el('span', { class: 'gc-ib' }));
      cards.appendChild(el('div', { class: 'gc-scan' }));
      var intro = el('div', { class: 'gc-intro' }, [
        cards,
        el('div', { class: 'gc-intro-text', text: '寻访中…' })
      ]);
      resultBox.appendChild(intro);
      var dur = times === 10 ? 1150 : 850;
      setTimeout(function () {
        intro.classList.add('cp-out');
        setTimeout(done, 220);
      }, dur);
    }

    function pull(times) {
      var cost = times === 10 ? POMO.TEN_COST : POMO.PULL_COST;
      if (!canPull(cost)) {
        V.toast('合成玉不够，还差 ' + (cost - pm.jade) + '（约 ' +
          (Math.round((cost - pm.jade) / POMO.JADE_PER_POINT * 10) / 10) + ' 积分）', 'err');
        return;
      }
      if (pulling) return;
      pulling = true;
      lockFoot(true);
      playIntro(times, function () {
        var before = {};
        Store.pomodoro.gacha.ops.forEach(function (o) { before[o.n] = 1; });
        var list = Store.gachaPull(times);
        var newSet = {};
        list.forEach(function (o) { if (!before[o.n]) newSet[o.n] = true; });
        showResult(list, newSet);
        drawHead();
        drawFoot();
        pulling = false;
        lockFoot(false);
        if (list && list.converted) {
          V.toast('满潜重复 ' + (list.convertedCount || 1) + ' 份已存入商店，可换 ' +
            (list.converted * POMO.JADE_PER_POINT) + ' 合成玉');
        }
      });
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
        el('div', { class: 'gc-head' }, [balanceEl, poolEl, sparkEl, rateEl, lkBox, previewEl]),
        resultBox,

      ],
      footer: footBox
    });

    drawHead();
    drawFoot();
  }

  /* ==========================================================
   * 已获得干员墙（按阵营分组）
   * ========================================================== */
  function opsWall(limit) {
    return factionGroupsEl(Store.gachaOwned(), {
      empty: '还没有寻访到干员，先去专注攒合成玉吧'
    });
  }

  /** 干员大图详情 */
  function opDetail(op) {
    var got = null;
    Store.pomodoro.gacha.ops.forEach(function (o) { if (o.n === op.n) got = o; });
    var rec = got || op;
    var meta = OP_META[rec.n] || {};
    var pot = Math.max(0, Math.min((rec.count || 1) - 1, POMO.POT_MAX));
    var maxpot = rec.r >= 5 && pot >= POMO.POT_MAX;

    var tags = [];
    if (meta.faction) tags.push(meta.faction);
    if (meta.limited) tags.push('限定');
    if (meta.reserve) tags.push('预备');
    if (maxpot) tags.push('满潜');

    var body = el('div', { class: 'op-detail' }, [
      el('div', {
        class: 'od-avatar', style: { '--sc': starColor(rec.r) }
      }, [
        rec.img ? el('img', { src: rec.img, alt: rec.n }) : null,
        el('span', { class: 'od-stars', text: stars(rec.r) })
      ]),
      el('div', { class: 'od-info' }, [
        el('b', { text: rec.n }),
        el('span', { text: rec.r + '★ · ' + (rec.p || '—') + (tags.length ? ' · ' + tags.join(' / ') : '') }),
        el('span', { class: 'od-dim', text: '已获得 ' + (rec.count || 1) + ' 次 · 潜能 ' + pot + (maxpot ? '（满潜）' : '') + (rec.dupPts ? ' · 累计满潜重复 ' + rec.dupPts + ' 积分' : '') })
      ])
    ]);

    var mOpDetail = V.modal({
      title: '干员详情',
      width: '380px',
      body: [body],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-primary', text: '关闭', onclick: function () { mOpDetail.close(); } })
      ])
    });
  }

  /** 全部干员图鉴弹窗（按阵营分组） */
  function openOps() {
    var s = Store.gachaStats();
    var owned = Store.gachaOwned();

    var rows = [6, 5, 4, 3].map(function (r) {
      var g = s.byR[r] || [0, 0];
      return '<span class="cp-macro" style="background:' + starColor(r) + '22;color:' + starColor(r) + '">' +
        r + '★ ' + g[0] + '/' + g[1] + '</span>';
    }).join('');

    var box = factionGroupsEl(owned, { empty: '还没有寻访到干员' });

    var limitedCount = owned.filter(function (o) { var m = OP_META[o.n]; return m && m.limited; }).length;
    var reserveCount = owned.filter(function (o) { var m = OP_META[o.n]; return m && m.reserve; }).length;
    var statKids = [
      el('b', { text: s.owned + ' / ' + s.total }),
      el('span', { text: '已收集' }),
      el('span', { class: 'ops-pulls', text: '累计 ' + s.pulls + ' 抽' })
    ];
    if (limitedCount) statKids.push(el('span', { class: 'ops-pulls', text: '限定 ' + limitedCount }));
    if (reserveCount) statKids.push(el('span', { class: 'ops-pulls', text: '预备 ' + reserveCount }));

    var mOps = V.modal({
      title: '我的干员',
      width: '640px',
      body: [
        el('div', { class: 'ops-stat' }, statKids),
        el('div', { class: 'dp-macros', html: rows }),
        box
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-primary', text: '关闭', onclick: function () { mOps.close(); } })
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


