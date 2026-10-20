
/* ==========================================================
 * 日记（一天一篇，可与灵感双向拷贝）
 * 渲染进「待办 → 日记」分页；数据层在 store.js（DiaryPane 只做界面）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 界面态（只存内存，不进 localStorage） */
  var ui = {
    /** 当前查看的月份 'YYYY-MM' */
    month: '',
    /** 已打开过的「凌晨问日期」日期集：同一天只问一次 */
    asked: {}
  };

  function moodOf(key) { return Store.moodOf(key); }

  function todayStr() { return DateUtil.toStr(DateUtil.today()); }

  function monthKeyOf(dateStr) {
    return (dateStr || todayStr()).slice(0, 7);
  }

  function monthLabel(mk) {
    var p = mk.split('-');
    return p[0] + ' 年 ' + (+p[1]) + ' 月';
  }

  function shiftMonth(mk, delta) {
    var p = mk.split('-');
    var d = new Date(+p[0], (+p[1]) - 1 + delta, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  /** 「10 月 21 日 周二」 */
  function humanDate(dateStr) {
    var d = DateUtil.parse(dateStr);
    if (!d) return dateStr;
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + DateUtil.weekdayCN(d);
  }

  /** 某个日期相对今天的说法 */
  function dayWord(dateStr) {
    var diff = DateUtil.diffDays(DateUtil.parse(dateStr), DateUtil.today());
    if (diff === 0) return '今天';
    if (diff === -1) return '昨天';
    if (diff === -2) return '前天';
    return '';
  }

  /* ==========================================================
   * 入口：渲染整块日记面板
   * ========================================================== */
  function renderDiaryInto(host) {
    host.innerHTML = '';
    if (!ui.month) ui.month = monthKeyOf(todayStr());

    // 本月的心情概览（够 7 天才显示）
    host.appendChild(moodCard(ui.month));

    // 月历
    host.appendChild(calendarCard(host));

    // 这个月的日记列表
    host.appendChild(listCard(host));

    // 右下角固定「写日记」——放在列表底部作为一个大按钮，不用悬空按钮
    var write = el('button', {
      class: 'btn btn-primary btn-block btn-lg diary-write-btn',
      onclick: function () { openEditor(autoDate(), null, function () { renderDiaryInto(host); }); }
    }, [V.svg(V.icons.book, 17), '写今天的日记']);
    host.appendChild(write);
  }

  /** 打开编辑器时的默认日期：凌晨则按 diaryDatePrompt 的建议 */
  function autoDate() {
    var t = todayStr();
    var p = Store.diaryDatePrompt(new Date().getHours(), t, '');
    return p.ask ? p.suggest : t;
  }

  /* ==========================================================
   * 心情概览
   * ========================================================== */
  function moodCard(mk) {
    var from = mk + '-01';
    var d = DateUtil.parse(from);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    var to = DateUtil.toStr(last);

    var st = Store.moodStats(from, to);
    var card = el('div', { class: 'card diary-mood-card' });

    card.appendChild(el('div', { class: 'section-title' }, [
      V.svg(V.icons.sparkle, 16), '本月心情'
    ]));

    if (!Store.state.settings.diary.showMoodStats) {
      card.appendChild(el('div', {
        class: 'cp-diary-note',
        text: '心情统计已在「设置 → 日记」里关掉。需要时再打开就行，日记本身不受影响。'
      }));
      return card;
    }

    if (!st.eligible) {
      card.appendChild(el('div', {
        class: 'cp-diary-note',
        text: st.rated === 0
          ? '这个月还没标过心情。写完日记顺手点一下心情，攒够 ' + Store.MOOD_MIN_DAYS + ' 天就能看到统计。'
          : '已经标了 ' + st.rated + ' 天，再攒 ' + st.need + ' 天就能看到本月心情统计。' +
            '样本太少得出的"规律"基本都是巧合，所以先不让它显示。'
      }));
      return card;
    }

    // 平均分 + 最常出现
    var top = moodOf(st.top);
    var head = el('div', { class: 'cp-mood-head' }, [
      el('div', { class: 'cp-mood-avg' }, [
        el('b', { text: st.avg.toFixed(2) }),
        el('span', { text: '平均心情 / 5' })
      ]),
      top ? el('div', { class: 'cp-mood-top' }, [
        el('span', { class: 'cp-mood-emoji', text: top.emoji }),
        el('span', { text: '最常是「' + top.name + '」' })
      ]) : null
    ]);
    card.appendChild(head);

    // 五档分布条
    var bar = el('div', { class: 'cp-mood-bars' });
    Store.MOODS.forEach(function (m) {
      var n = st.counts[m.key] || 0;
      if (!n) return;
      // 不在色块里放 emoji：条高只有 26px，字形缩到 13px 后糊成一团，
      // 且部分系统只有单色 emoji 字体，压在饱和底色上更难认。色块负责比例，
      // 紧挨着的图例负责「颜色→心情」的对应。
      bar.appendChild(el('div', {
        class: 'cp-mood-bar',
        style: { flex: String(n), background: m.color },
        title: m.name + ' ' + n + ' 天',
        'aria-label': m.name + ' ' + n + ' 天'
      }));
    });
    card.appendChild(bar);

    var legend = el('div', { class: 'cp-mood-legend' });
    Store.MOODS.forEach(function (m) {
      var n = st.counts[m.key] || 0;
      legend.appendChild(el('div', { class: 'cp-mood-legend-row' + (n ? '' : ' is-empty') }, [
        el('i', { style: { background: m.color } }),
        el('span', { text: m.emoji + ' ' + m.name }),
        el('b', { text: n ? n + ' 天' : '—' })
      ]));
    });
    card.appendChild(legend);

    // 冷暖倾向：只并列数字，不给因果结论。
    // 门槛比平均分更严（14 天）：冷暖是「分布形状」层面的结论，
    // 一周的数据画出来的形状几乎必然偏到某一边，那是指纹不是规律。
    var t = st.tones;
    var toneTotal = t.warm + t.neutral + t.cold;
    if (toneTotal && st.rated >= Store.MOOD_CROSS_MIN_DAYS) {
      var warmPct = Math.round(t.warm / toneTotal * 100);
      var coldPct = Math.round(t.cold / toneTotal * 100);
      card.appendChild(el('div', {
        class: 'cp-mood-tone',
        text: '其中偏暖 ' + warmPct + '%（' + t.warm + ' 天），中性 ' +
              Math.round(t.neutral / toneTotal * 100) + '%（' + t.neutral + ' 天），偏冷 ' +
              coldPct + '%（' + t.cold + ' 天）。'
      }));
    }

    card.appendChild(el('div', {
      class: 'cp-diary-note',
      text: '本月写了 ' + st.days + ' 天，其中 ' + st.rated + ' 天标了心情。心情是你自己打的标签，' +
            '这份统计只反映"你怎么记录"，不等于"你过得怎么样"。'
    }));
    return card;
  }

  /* ==========================================================
   * 月历：有日记的日子按心情上色
   * ========================================================== */
  function calendarCard(host) {
    var mk = ui.month;
    var first = DateUtil.parse(mk + '-01');
    var daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    // 月历从周一开始
    var lead = DateUtil.isoDow(first) - 1;
    var today = todayStr();

    var card = el('div', { class: 'card diary-cal-card' });

    var head = el('div', { class: 'section-title' }, ['日历']);
    head.appendChild(el('div', { class: 'cp-cal-nav' }, [
      el('button', {
        class: 'icon-btn', title: '上个月',
        onclick: function () { ui.month = shiftMonth(mk, -1); renderDiaryInto(host); }
      }, [V.svg(V.icons.left, 16)]),
      el('span', { class: 'cp-cal-title', text: monthLabel(mk) }),
      el('button', {
        class: 'icon-btn', title: '下个月',
        onclick: function () { ui.month = shiftMonth(mk, 1); renderDiaryInto(host); }
      }, [V.svg(V.icons.right, 16)])
    ]));
    card.appendChild(head);

    var grid = el('div', { class: 'cp-diary-cal' });
    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (w) {
      grid.appendChild(el('div', { class: 'cp-dc-dow', text: w }));
    });
    for (var i = 0; i < lead; i++) grid.appendChild(el('div', { class: 'cp-dc-blank' }));

    for (var day = 1; day <= daysInMonth; day++) {
      (function (day) {
        var dateStr = mk + '-' + ('0' + day).slice(-2);
        var d = Store.diaryOf(dateStr);
        var m = d && d.mood ? moodOf(d.mood) : null;
        // el() 只给「不带前缀」的 class 补 cp-，这里是整串拼好的，
        // 必须自己写全 cp- 前缀，否则 CSS 里的 .cp-dc-day.cp-has-diary 匹配不上
        var cls = 'cp-dc-day';
        if (dateStr === today) cls += ' cp-is-today';
        if (d) cls += ' cp-has-diary';
        if (dateStr > today) cls += ' cp-is-future';

        var cell = el('button', {
          class: cls,
          style: m ? { background: m.color + '2e', borderColor: m.color } : null,
          title: d ? (m ? m.name : '有日记（未标心情）') : '没有日记',
          onclick: function () {
            openEditor(dateStr, d ? d.id : null, function () { renderDiaryInto(host); });
          }
        }, [
          el('span', { class: 'cp-dc-num', text: String(day) }),
          m ? el('span', { class: 'cp-dc-dot', style: { background: m.color } }) : null,
          d && !m ? el('span', { class: 'cp-dc-dot is-plain' }) : null,
          d && d.content ? el('span', { class: 'cp-dc-mark' }) : null
        ]);
        grid.appendChild(cell);
      })(day);
    }
    card.appendChild(grid);

    card.appendChild(el('div', {
      class: 'cp-diary-note',
      text: '点任意一天就能写 / 改那天的日记。一天只存一篇，所以同一天不会出现两条互相矛盾的记录。'
    }));
    return card;
  }

  /* ==========================================================
   * 本月的日记列表
   * ========================================================== */
  function listCard(host) {
    var mk = ui.month;
    var list = Store.diariesSorted(Store.state.diaries).filter(function (d) {
      return d.date.slice(0, 7) === mk;
    });

    var card = el('div', { class: 'card diary-list-card' });
    card.appendChild(el('div', { class: 'section-title' }, ['这个月写了 ' + list.length + ' 篇']));

    if (!list.length) {
      card.appendChild(V.empty(V.icons.book, '这个月还没有日记',
        '点下面「写今天的日记」开始。日记只存在本机，换设备时用「设置 → 导出备份」传文件。'));
      return card;
    }

    list.forEach(function (d) {
      var m = d.mood ? moodOf(d.mood) : null;
      var src = d.sourceNoteId ? Store.getNote(d.sourceNoteId) : null;
      var preview = (d.content || '').replace(/\s+/g, ' ').trim();
      if (preview.length > 90) preview = preview.slice(0, 90) + '…';

      card.appendChild(el('div', {
        class: 'cp-diary-row',
        dataset: { rec: 'diary:' + d.id },
        onclick: function () { openEditor(d.date, d.id, function () { renderDiaryInto(host); }); }
      }, [
        el('div', { class: 'cp-diary-row-head' }, [
          el('span', { class: 'cp-diary-row-date', text: humanDate(d.date) }),
          m ? el('span', {
            class: 'cp-diary-mood-tag',
            style: { background: m.color + '1f', color: m.color },
            text: m.emoji + ' ' + m.name
          }) : null,
          src ? el('span', { class: 'cp-diary-src', text: '来自灵感' }) : null
        ]),
        el('div', { class: 'cp-diary-row-body', text: preview || '（只有心情，没写正文）' })
      ]));
    });
    return card;
  }

  /* ==========================================================
   * 编辑器
   * ========================================================== */
  /**
   * @param {string} dateStr 归属日期
   * @param {string|null} id 已有日记的 id
   * @param {Function} done 保存/删除后回调
   * @param {object} [pre] 预填：{ content, sourceNoteId }
   */
  function openEditor(dateStr, id, done, pre) {
    var existing = id ? Store.getDiary(id) : Store.diaryOf(dateStr);
    var sourceNoteId = (pre && pre.sourceNoteId) || (existing && existing.sourceNoteId) || '';
    var initContent = pre && pre.content != null ? pre.content
      : (existing ? existing.content : '');

    var curDate = dateStr;
    var mood = existing ? existing.mood : '';

    var dateLabel = el('b', { class: 'cp-de-date' });
    var ta = V.textarea({ value: initContent, style: 'min-height:200px',
      placeholder: '今天发生了什么？想到什么写什么，不用管格式。' });
    var moodBar = el('div', { class: 'cp-mood-pick' });
    var statusTip = el('div', { class: 'cp-diary-note' });
    var m;

    function refreshDateLabel() {
      dateLabel.textContent = humanDate(curDate) + (dayWord(curDate) ? '（' + dayWord(curDate) + '）' : '');
      var own = Store.diaryOf(curDate);
      statusTip.textContent = (own && own.id !== (existing ? existing.id : ''))
        ? '这一天已经有日记了，保存会覆盖它。'
        : '';
    }

    function renderMoodBar() {
      moodBar.innerHTML = '';
      // 「不标」也是合法选项：心情是选填的
      moodBar.appendChild(el('button', {
        class: 'cp-mood-pick-btn is-none' + (mood ? '' : ' active'),
        text: '不标',
        onclick: function () { mood = ''; renderMoodBar(); }
      }));
      Store.MOODS.forEach(function (x) {
        var b = el('button', {
          class: 'cp-mood-pick-btn' + (mood === x.key ? ' active' : ''),
          style: mood === x.key ? { borderColor: x.color, background: x.color + '1f', color: x.color } : null,
          title: x.name,
          onclick: function () { mood = x.key; renderMoodBar(); }
        }, [el('span', { class: 'cp-mood-pick-emoji', text: x.emoji }),
            el('span', { text: x.name })]);
        moodBar.appendChild(b);
      });
    }

    /* ---- 保存 ---- */
    function save() {
      var text = ta.value;
      if (!text.trim() && !mood) {
        UI.toast('写点正文，或者至少标一个心情', 'err');
        ta.focus();
        return;
      }

      var doWrite = function (finalDate) {
        Store.saveDiary({
          date: finalDate,
          content: text,
          mood: mood,
          sourceNoteId: sourceNoteId
        });
        // 同步回灵感：从灵感来的日记，保存时把「已写进日记」标记回去
        if (sourceNoteId) Store.updateNote(sourceNoteId, { converted: true });
        m.close();
        UI.toast('日记已保存');
        if (done) done();
      };

      // 凌晨写作：问一次归属日。同一天只问一次，且设置里可关
      var hour = new Date().getHours();
      var canAsk = Store.state.settings.diary.askDateAtNight && !ui.asked[curDate];
      var prompt = Store.diaryDatePrompt(hour, todayStr(), curDate);

      if (!canAsk || !prompt.ask || prompt.other === prompt.suggest && prompt.suggest === curDate) {
        doWrite(curDate);
        return;
      }

      ui.asked[curDate] = true;
      var a = prompt.suggest, b2 = prompt.other;
      V.confirm({
        title: '这篇日记算哪天的？',
        message: '现在是凌晨，写下的内容既可以算作「' + humanDate(a) + '」，也可以算作刚过去的「' +
                 humanDate(b2) + '」。\n\n选哪一天只是决定它出现在日历的哪一格，内容不会变；选完这一次，' +
                 '今天再保存就不会再问了。',
        okText: '算 ' + (dayWord(b2) || b2.slice(5)),
        cancelText: '算 ' + (dayWord(a) || a.slice(5))
      }).then(function (pickOther) {
        doWrite(pickOther ? b2 : a);
      });
    }

    var body = [
      el('div', { class: 'cp-de-date-row' }, [
        dateLabel,
        el('button', {
          class: 'btn btn-sm', text: '换一天',
          onclick: function () {
            var inp = V.input({ type: 'date', value: curDate, style: 'max-width:160px' });
            var mm = V.modal({
              title: '选择日期',
              body: [V.field('归属日期', inp)],
              footer: el('div', { class: 'modal-foot' }, [
                el('button', { class: 'btn', text: '取消', onclick: function () { mm.close(); } }),
                el('button', {
                  class: 'btn btn-primary', text: '确定',
                  onclick: function () {
                    if (inp.value) { curDate = inp.value; refreshDateLabel(); }
                    mm.close();
                  }
                })
              ])
            });
          }
        })
      ]),
      el('div', { class: 'cp-de-label', text: (dateStr === todayStr() ? '今天' : '这一天') + '的心情（选填）' }),
      moodBar,
      el('div', { class: 'cp-de-label', text: '正文' }),
      ta,
      statusTip
    ];

    m = V.modal({
      title: existing ? '编辑日记' : '写日记',
      width: '600px',
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        existing ? el('button', {
          class: 'btn btn-danger', text: '删除',
          onclick: function () {
            V.confirm({
              title: '删除这篇日记',
              message: '删除后无法恢复。如果只是写得不好，可以直接改内容再保存。',
              danger: true, okText: '删除'
            }).then(function (ok) {
              if (!ok) return;
              Store.removeDiary(existing.id);
              m.close();
              UI.toast('已删除');
              if (done) done();
            });
          }
        }) : null,
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: '保存', onclick: save })
      ])
    });

    refreshDateLabel();
    renderMoodBar();
  }

  /* ==========================================================
   * 「引用灵感 / 写进今天日记」—— 两个方向都只是拷贝
   * ========================================================== */
  /**
   * 把一段灵感文本放进某天的日记。
   * 带来源时用「两个全角空格 + ——」缩进，让人一眼看出这是引用来的段落。
   * 用纯文本 + 缩进，不用 Markdown 引用语法：本项目的正文一律按纯文本存，
   * 免得以后有人把 HTML 塞进来（见 ROADMAP 的 XSS 说明）。
   */
  function appendToDiary(noteText, dateStr, noteId, done) {
    var d = Store.diaryOf(dateStr);
    var quoted = '\u3000\u3000' + noteText.trim().split('\n').join('\n\u3000\u3000');
    var base = d && d.content ? d.content.replace(/\s+$/, '') + '\n\n' : '';
    openEditor(dateStr, d ? d.id : null, done, {
      content: base + quoted,
      sourceNoteId: noteId || ''
    });
  }

  /** 从日记反向摘一段回灵感 */
  function copyToNote(text, done) {
    var t = (text || '').trim();
    if (!t) { UI.toast('这篇日记还没写正文', 'err'); return; }
    var firstLine = t.split('\n')[0].trim().slice(0, 40);
    V.confirm({
      title: '复制到灵感',
      message: '会把这篇日记的全文复制成一条新灵感（原文保留，两边各自独立）。',
      okText: '复制'
    }).then(function (ok) {
      if (!ok) return;
      Store.addNote({ content: t, tags: ['日记摘录'] });
      UI.toast('已复制到灵感：' + firstLine);
      if (done) done();
    });
  }

  global.DiaryPane = {
    render: renderDiaryInto,
    open: openEditor,
    appendToDiary: appendToDiary,
    copyToNote: copyToNote,
    autoDate: autoDate
  };
})(window);
