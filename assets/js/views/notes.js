

/* ==========================================================
 * 灵感速记（随手记一笔，可一键转成待办）
 * 已并入「待办」板块作为一个分页，功能保持不变
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /**
   * 把「灵感速记」整块渲染进任意容器
   * @param {HTMLElement} host
   * @returns {Function} refresh 重新渲染列表
   */
  function renderNotesInto(host) {
    host.innerHTML = '';

    /* ---------- 记录区 ---------- */
    var input = V.textarea({
      placeholder: '想到什么就写下来…（Ctrl / ⌘ + Enter 快速保存）',
      style: 'min-height:84px'
    });
    var tagInput = V.tagInput('', { placeholder: '标签（可选），如 学习/英语, 灵感' });

    var listBox = el('div', { class: 'note-list' });

    function refresh() { drawList(); }

    function save() {
      var text = input.value.trim();
      if (!text) { UI.toast('先写点什么吧', 'err'); input.focus(); return; }
      Store.addNote({ content: text, tags: tagInput.getValue() });
      input.value = '';
      tagInput.setValue('');
      drawList();
      UI.toast('已记下');
      input.focus();
    }

    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
    });

    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, [V.svg(V.icons.idea, 16), '随手记一笔']),
      input,
      el('div', { style: { height: '10px' } }),
      tagInput,
      el('div', { style: { height: '12px' } }),
      el('button', { class: 'btn btn-primary btn-block btn-lg', onclick: save },
        [V.svg(V.icons.plus, 17), '记下来'])
    ]);
    host.appendChild(card);

    /* ---------- 列表 ---------- */
    host.appendChild(listBox);

    function drawList() {
      listBox.innerHTML = '';
      var notes = Store.notes;
      if (!notes.length) {
        listBox.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.note, '还没有灵感记录',
            '想到什么随手记在这里，之后可以一键变成待办。')
        ]));
        return;
      }
      notes.forEach(function (n) {
        listBox.appendChild(noteCard(n, refresh));
      });
    }

    drawList();
    return refresh;
  }

  /** 单条灵感卡片 */
  function noteCard(n, refresh) {
    var d = new Date(n.createdAt);
    var when = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
      (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();

    var body = el('div', {
      class: 'note-content',
      text: n.content
    });

    var foot = el('div', { class: 'note-foot' }, [
      el('span', { class: 'note-time', text: when }),
      (n.tags && n.tags.length) ? n.tags.map(function (x) {
        return V.tagChip(x);
      }) : null,
      n.converted ? el('span', { class: 'chip chip-green', text: '已转待办' }) : null,
      el('span', { class: 'note-actions' }, [
        el('button', {
          class: 'btn btn-sm' + (n.converted ? '' : ' btn-primary'),
          onclick: function (e) {
            e.stopPropagation();
            toTask(n, refresh);
          }
        }, [V.svg(V.icons.check, 15), n.converted ? '再转一次' : '转为待办']),
        el('button', {
          class: 'btn btn-sm',
          title: '把这段内容放进今天的日记',
          onclick: function (e) {
            e.stopPropagation();
            if (!global.DiaryPane) return;
            // 两个方向都只是「拷贝」：灵感原文保留，日记里是独立的一份副本
            DiaryPane.appendToDiary(n.content || '', DiaryPane.autoDate(), n.id, refresh);
          }
        }, [V.svg(V.icons.book, 15), '写进日记']),
        el('button', {
          class: 'icon-btn', title: '删除',
          onclick: function (e) {
            e.stopPropagation();
            V.confirm({
              title: '删除这条灵感', message: '删除后无法恢复。', danger: true, okText: '删除'
            }).then(function (ok) {
              if (ok) { Store.removeNote(n.id); refresh(); UI.toast('已删除'); }
            });
          }
        }, [V.svg(V.icons.trash, 16)])
      ])
    ]);

    return el('div', {
      class: 'card note-card' + (n.converted ? ' converted' : ''),
      dataset: { rec: 'note:' + n.id },     // 全局搜索跳转后靠它定位
      onclick: function () { editNote(n, refresh); }
    }, [body, foot]);
  }

  /** 一键转为待办 */
  function toTask(n, refresh) {
    var text = (n.content || '').trim();
    if (!text) return;
    var lines = text.split('\n');
    var title = lines[0].trim().slice(0, 60);
    var rest = lines.slice(1).join('\n').trim();

    Store.addTask({
      title: title,
      note: rest || text,
      tags: n.tags,
      dueDate: DateUtil.toStr(DateUtil.today()),
      dueTime: DateUtil.nowHM()
    });
    Store.updateNote(n.id, { converted: true });
    refresh();
    UI.toast('已加入待办：' + title);
  }

  /** 编辑内容 */
  function editNote(n, refresh) {
    var m;
    var ta = V.textarea({ value: n.content, style: 'min-height:140px' });
    var tagI = V.tagInput((n.tags || []).join(','));

    m = V.modal({
      title: '编辑灵感',
      body: [V.field('内容', ta), V.field('标签', tagI)],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            if (!ta.value.trim()) { UI.toast('内容不能为空', 'err'); return; }
            Store.updateNote(n.id, { content: ta.value, tags: tagI.getValue() });
            m.close();
            refresh();
          }
        })
      ])
    });
  }

  global.NotesPane = { render: renderNotesInto };

  /* 视图本身保留（数据兼容、排序等），但不再单独出现在导航里 */
  var view = {
    id: 'notes',
    name: '灵感',
    icon: V.icons.idea,
    title: '灵感速记',
    order: 24,
    nav: false,

    root: null,

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-notes' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () { renderNotesInto(this.root); },

    focusRecord: function (type, id) {
      if (!global.Search) return false;
      // 日记和灵感同在「待办」的三个分页里，搜索跳过来时要先把分页切对。
      // 注意不能只靠 tasks 视图自己的 focusRecord：它只处理 task 类型，
      // 收到 diary / note 会直接返回 false，分页就切不过去了。
      if (global.App && (type === 'diary' || type === 'note')) {
        var tv = App.views.filter(function (x) { return x.id === 'tasks'; })[0];
        if (tv && tv.setTab) tv.setTab(type === 'diary' ? 'diary' : 'notes');
      }
      return Search.flash(Search.findRec(type, id));
    }
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


