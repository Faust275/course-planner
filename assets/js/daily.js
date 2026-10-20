/* ==========================================================
 * 每日一句（古诗/古文） + 每日一词（专四词汇）
 * 首页卡片 + 详情弹窗
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /* ---------------- 卡片区 ---------------- */
  function section() {
    var wrap = el('div', { class: 'daily-row' });
    if (Store.dailyOn('poem')) wrap.appendChild(poemCard());
    if (Store.dailyOn('word')) wrap.appendChild(wordCard());
    return wrap;
  }

  /** 收藏按钮（卡片与详情共用） */
  function favBtn(on, onToggle, stop) {
    return el('button', {
      class: 'dc-next fav-btn' + (on ? ' on' : ''),
      title: on ? '取消收藏' : '收藏',
      onclick: function (e) {
        if (stop) e.stopPropagation();
        V.toast(onToggle() ? '已收藏' : '已取消收藏');
        // Store.emit 会触发当前视图重绘，卡片状态自动更新
      }
    }, [V.svg(V.icons.star, 13)]);
  }

  function head(title, btnText, onNext, extra) {
    return el('div', { class: 'dc-head' }, [
      el('span', { class: 'dc-title', text: title }),
      extra || null,
      el('button', {
        class: 'dc-next',
        onclick: function (e) { e.stopPropagation(); onNext(); }
      }, [btnText, V.svg(V.icons.right, 14)])
    ]);
  }

  function poemCard() {
    var p = Daily.poem();
    var idx = Store.state.settings.daily.poem % Daily.poems.length;

    return el('div', {
      class: 'daily-card dc-poem',
      onclick: function () { openPoem(); }
    }, [
      head('每日一句', '换一篇', function () {
        Daily.nextPoem();
        V.toast('换了一篇');
      }, favBtn(Store.isFavPoem(idx), function () {
        return Store.toggleFavPoem(idx);
      }, true)),
      el('div', { class: 'dc-body' }, [
        el('div', { class: 'poem-ex', text: p.ex }),
        el('div', {
          class: 'poem-src',
          text: (p.d ? p.d + ' · ' : '') + p.a + (p.a.indexOf('《') === 0 ? '' : '《' + p.t + '》')
        })
      ]),
      el('div', { class: 'dc-foot', text: '点开看全文' })
    ]);
  }

  function wordCard() {
    var w = Daily.word();
    var idx = Store.state.settings.daily.word % Daily.words.length;

    return el('div', {
      class: 'daily-card dc-word',
      onclick: function () { openWord(); }
    }, [
      head('每日一词', '换一个', function () {
        Daily.nextWord();
        V.toast('换了一个单词');
      }, el('span', { class: 'dc-extra' }, [
        el('button', {
          class: 'dc-next quiz-btn',
          onclick: function (e) { e.stopPropagation(); openQuiz(w); }
        }, [V.svg(V.icons.check, 13), '小测验']),
        favBtn(Store.isFavWord(w.w), function () {
          return Store.toggleFavWord(w.w);
        }, true)
      ])),
      el('div', { class: 'dc-body' }, [
        el('div', { class: 'word-line' }, [
          el('b', { text: w.w }),
          w.ph ? el('span', { class: 'word-ph', text: w.ph }) : null,
          w.pos ? el('em', { class: 'word-pos', text: w.pos }) : null
        ]),
        el('div', { class: 'word-def', text: w.def })
      ]),
      el('div', { class: 'dc-foot', text: '点开看例句' })
    ]);
  }

  /** 弹窗底部的收藏按钮（点击后原地切换文案） */
  function favTextBtn(isOn, toggle) {
    var b = el('button', { class: 'btn' }, []);
    function paint() {
      var on = isOn();
      b.innerHTML = '';
      b.appendChild(V.svg(V.icons.star, 15));
      b.appendChild(document.createTextNode(on ? '取消收藏' : '收藏'));
      b.className = 'btn' + (on ? ' btn-on' : '');
    }
    b.onclick = function () {
      V.toast(toggle() ? '已收藏' : '已取消收藏');
      paint();
    };
    paint();
    return b;
  }

  /* ---------------- 诗词详情 ---------------- */
  function openPoem(poemIdx) {
    var cur = Store.state.settings.daily.poem % Daily.poems.length;
    var idx = (poemIdx == null) ? cur : Number(poemIdx);
    var p = Daily.poems[idx];
    if (!p) return;
    var isDaily = (idx === cur);

    var body = el('div', {});
    body.appendChild(el('div', { class: 'pf-title', text: p.t }));
    body.appendChild(el('div', { class: 'pf-by', text: (p.d ? p.d + ' · ' : '') + p.a }));
    if (p.g) body.appendChild(el('div', { class: 'pf-genre', text: p.g }));

    var lines = el('div', { class: 'pf-lines' });
    p.body.forEach(function (l) {
      lines.appendChild(el('p', { text: l }));
    });
    body.appendChild(lines);

    if (p.note) {
      body.appendChild(el('div', { class: 'pf-note' }, [
        el('b', { text: '赏析' }),
        el('p', { text: p.note })
      ]));
    }

    body.appendChild(el('div', {
      class: 'pf-meta',
      text: '随机取自 ' + Daily.poems.length + ' 篇诗词'
    }));

    var m = V.modal({
      title: '每日一句',
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        favTextBtn(function () { return Store.isFavPoem(idx); },
                   function () { return Store.toggleFavPoem(idx); }),
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
        isDaily ? el('button', {
          class: 'btn btn-primary', text: '换一篇',
          onclick: function () {
            Daily.nextPoem();
            m.close();
            setTimeout(function () { openPoem(); }, 220);
          }
        }) : el('button', {
          class: 'btn btn-primary', text: '关闭', onclick: function () { m.close(); }
        })
      ])
    });
  }

  /* ---------------- 单词详情 ---------------- */
  function openWord(wordIdx) {
    var cur = Store.state.settings.daily.word % Daily.words.length;
    var idx = (wordIdx == null) ? cur : Number(wordIdx);
    var w = Daily.words[idx];
    if (!w) return;
    var isDaily = (idx === cur);

    var body = el('div', {});

    body.appendChild(el('div', { class: 'wd-head' }, [
      el('b', { class: 'wd-word', text: w.w }),
      w.ph ? el('span', { class: 'wd-ph', text: w.ph }) : null,
      w.pos ? el('em', { class: 'wd-pos', text: w.pos }) : null
    ]));

    body.appendChild(el('div', { class: 'wd-def', text: w.def }));

    if (w.star) {
      body.appendChild(el('div', { class: 'wd-star' }, [
        el('span', { class: 'wd-label', text: '常用度' }),
        el('span', { class: 'wd-stars', text: '★'.repeat(w.star) + '☆'.repeat(5 - w.star) })
      ]));
    }

    if (w.ex) {
      body.appendChild(el('div', { class: 'wd-block' }, [
        el('span', { class: 'wd-label', text: '例句' }),
        el('p', { class: 'wd-ex', text: w.ex }),
        w.exCn ? el('p', { class: 'wd-ex-cn', text: w.exCn }) : null
      ]));
    }

    if (w.tip) {
      body.appendChild(el('div', { class: 'wd-block' }, [
        el('span', { class: 'wd-label', text: '助记 / 搭配' }),
        el('p', { class: 'wd-tip', text: w.tip })
      ]));
    }

    body.appendChild(el('div', {
      class: 'pf-meta',
      text: '随机取自 ' + Daily.words.length + ' 词 · 专四范围'
    }));

    var m = V.modal({
      title: '每日一词',
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        favTextBtn(function () { return Store.isFavWord(w.w); },
                   function () { return Store.toggleFavWord(w.w); }),
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn', text: '考考我',
          onclick: function () { m.close(); setTimeout(function () { openQuiz(w); }, 200); }
        }),
        isDaily ? el('button', {
          class: 'btn btn-primary', text: '换一个',
          onclick: function () {
            Daily.nextWord();
            m.close();
            setTimeout(function () { openWord(); }, 220);
          }
        }) : el('button', {
          class: 'btn btn-primary', text: '关闭', onclick: function () { m.close(); }
        })
      ])
    });
  }

  /* ==========================================================
   * 拼写小测验
   * ========================================================== */
  function quizStats() {
    var q = Store.state.settings.quiz;
    return q && typeof q === 'object' ? q : { right: 0, wrong: 0 };
  }

  function saveQuizStats(q) { Store.updateSettings({ quiz: q }); }

  function maskOf(word, revealed) {
    var parts = [];
    for (var i = 0; i < word.length; i++) {
      if (i < revealed) parts.push(word[i]);
      else if (word[i] === '-' || word[i] === ' ') parts.push(word[i]);
      else parts.push('_');
    }
    return parts.join(' ');
  }

  /** 随机抽一个词（避免与当前词重复） */
  function randomWord(avoid) {
    var n = Daily.words.length;
    if (!n) return null;
    for (var t = 0; t < 8; t++) {
      var w = Daily.words[Math.floor(Math.random() * n)];
      if (!avoid || w.w !== avoid) return w;
    }
    return Daily.words[Math.floor(Math.random() * n)];
  }

  function openQuiz(word) {
    if (!Daily.words.length) return;
    var cur = word || Daily.word();
    var revealed = 1;
    var finished = false;

    var m;
    var metaEl = el('div', { class: 'qz-meta' });
    var defEl = el('div', { class: 'qz-def' });
    var maskEl = el('div', { class: 'qz-mask' });
    var lenEl = el('div', { class: 'qz-len' });
    var resultEl = el('div', { class: 'qz-result' });
    var statEl = el('div', { class: 'qz-stat' });

    var input = V.input({
      class: 'input qz-input',
      placeholder: '输入完整拼写后按回车',
      autocomplete: 'off', spellcheck: 'false'
    });

    function paint() {
      metaEl.textContent = (cur.pos ? cur.pos + ' · ' : '') + (cur.ph || '');
      defEl.textContent = cur.def || '';
      maskEl.textContent = maskOf(cur.w, revealed);
      var L = cur.w.length;
      maskEl.className = 'qz-mask' + (L > 11 ? ' long' : L > 8 ? ' mid' : '');
      lenEl.textContent = '共 ' + cur.w.replace(/[^a-zA-Z]/g, '').length + ' 个字母';
      var q = quizStats();
      statEl.textContent = '答对 ' + q.right + ' · 答错 ' + q.wrong;
    }

    function setResult(type, text) {
      resultEl.className = 'qz-result ' + type;
      resultEl.textContent = text;
    }

    function load(next) {
      cur = next || cur;
      revealed = 1;
      finished = false;
      input.value = '';
      input.disabled = false;
      resultEl.className = 'qz-result';
      resultEl.textContent = '';
      paint();
    }

    function submit() {
      if (finished) return;
      var val = (input.value || '').trim().toLowerCase().replace(/\s+/g, '');
      if (!val) { V.toast('先输入单词', 'err'); input.focus(); return; }
      var q = quizStats();
      if (val === cur.w.toLowerCase()) {
        finished = true;
        q.right = (q.right || 0) + 1;
        saveQuizStats(q);
        setResult('ok', '✓ 正确！ ' + cur.w + ' ' + (cur.ph || ''));
        input.disabled = true;
      } else {
        q.wrong = (q.wrong || 0) + 1;
        saveQuizStats(q);
        // 找出第一个不一致的位置，给个方向
        var target = cur.w.toLowerCase(), pos = -1;
        for (var i = 0; i < Math.min(val.length, target.length); i++) {
          if (val[i] !== target[i]) { pos = i; break; }
        }
        var tip = val.length !== target.length
          ? '长度不对，正确答案是 ' + target.length + ' 个字母'
          : (pos >= 0 ? '第 ' + (pos + 1) + ' 个字母起就不对了' : '拼写有误');
        setResult('bad', '✗ ' + tip + '，再试一次');
        input.focus();
        input.select();
      }
      paint();
    }

    function reveal() {
      if (finished) return;
      if (revealed < cur.w.length) {
        revealed++;
        paint();
      }
      var q = quizStats();
      if (revealed >= cur.w.length && !finished) {
        finished = true;
        q.wrong = (q.wrong || 0) + 1;
        saveQuizStats(q);
        setResult('show', '答案是 ' + cur.w + ' ' + (cur.ph || '') + ' · ' + (cur.def || ''));
        input.disabled = true;
        paint();
      }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    load(cur);

    var body = el('div', { class: 'quiz' }, [
      metaEl, defEl, maskEl, lenEl, input, resultEl, statEl
    ]);

    m = V.modal({
      title: '拼写小测验',
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '提示', onclick: reveal }),
        el('button', { class: 'btn', text: '换一题', onclick: function () { load(randomWord(cur.w)); input.focus(); } }),
        el('button', { class: 'btn btn-primary', text: '提交', onclick: submit })
      ])
    });

    setTimeout(function () { input.focus(); }, 120);
  }

  global.DailyCards = {
    section: section, openPoem: openPoem, openWord: openWord, openQuiz: openQuiz
  };
})(window);
