

/* ==========================================================
 * 视图：设置（学期 / 节次 / 数据备份）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 当前所在的具体设置页（空 = 不在具体页） */
  var SUB = '';

  /** 当前所在的分类页（空 = 设置首页） */
  var CAT = '';

  /** 标签页里当前选中的预设分组 */
  var TAG_GROUP = '学习';

  var SUB_META = {
    periods: { name: '课程时间', desc: '设置每天几节课、每节课的起止时间' },
    semester: { name: '学期与周次', desc: '学期列表、起止日期与周数' },
    look: { name: '外观', desc: '主题配色与背景图片' },
    tags: { name: '标签', desc: '图标、颜色与常用标签组合' },
    nav: { name: '模块显示', desc: '决定底部导航里出现哪些模块' },
    desktop: { name: '桌面与快捷', desc: '安装到主屏幕、直达某个模块的链接' },
    goals: { name: '目标', desc: '月末复盘提示与在办数量' },
    rec: { name: '记录偏好', desc: '饮食与睡眠记录的开关' },
    stats: { name: '时间统计', desc: '本周时间投入的卡片与分页开关' },
    subtask: { name: '子任务', desc: '父子任务在完成、删除时怎么联动' },
    reward: { name: '奖励机制', desc: '森林与抽卡两种奖励的积分与切换' },
    speech: { name: '语音识别', desc: '待办的语音输入方式与讯飞配置' },
    ocr: { name: '图片识别', desc: '导入课表的识别方式与云端接口' },
    gpa: { name: '成绩与 GPA', desc: '学分绩点的换算规则与成绩单导出' },
    fav: { name: '收藏的词句', desc: '收藏过的每日一句与每日一词' },
    diary: { name: '日记', desc: '凌晨归属与心情统计' },
    diet: { name: '饮食与热量', desc: '每日热量目标、三餐配比与营养素' },
    data: { name: '数据管理', desc: '同步码、备份文件与清空' },
    remind: { name: '上课提醒', desc: '页面内提醒，以及导出到系统日历' },
    about: { name: '使用提示', desc: '各模块的用法说明' },
    pet: { name: '桌宠（开发）', desc: '龙泡泡桌宠：开发者开关与本地素材注入，仅自用' }
  };

  /**
   * 设置首页的一级分类。顺序决定卡片顺序，`group` 字段把下面的条目挂上来。
   * 具体页的 key 不能和这里的 key 重名（reward 是具体页，分类用 award）。
   */
  var CATS = [
    { key: 'basic', name: '基础设置', desc: '课程时间、学期周次、外观与标签', icon: V.icons.settings, color: '#4f46e5' },
    { key: 'module', name: '首页与模块', desc: '底部导航显示哪些模块、桌面快捷方式', icon: V.icons.home, color: '#0ea5e9' },
    { key: 'record', name: '记录与统计', desc: '子任务联动、饮食、统计与 GPA', icon: V.icons.chart, color: '#10b981' },
    { key: 'award', name: '奖励与目标', desc: '目标复盘、森林积分、抽卡与收藏', icon: V.icons.jade, color: '#00a89a' },
    { key: 'sync', name: '识别与数据', desc: '语音、图片识别与备份同步', icon: V.icons.download, color: '#f59e0b' },
    { key: 'help', name: '帮助', desc: '新手教程与各模块说明', icon: V.icons.bookOpen, color: '#8b5cf6' }
  ];

  function catOf(key) {
    return CATS.filter(function (c) { return c.key === key; })[0] || null;
  }

  function groupOf(subKey) {
    var it = SUBS.filter(function (s) { return s.key === subKey; })[0];
    return it ? it.group : '';
  }

  /**
   * 打开标签编辑弹窗
   * @param {string} name 原标签名（空 = 新建）
   */
  function openTagEditor(name) {
    V.tagEditor(name, function (res) {
      if (name && res.name !== name) {
        var n = Store.renameTag(name, res.name);
        if (n) UI.toast('已把 ' + n + ' 条记录的标签改成「' + res.name + '」');
      }
      Store.setTagMeta(res.name, { icon: res.icon, color: res.color });
      UI.toast('已保存');
      view.render();
    }, {
      canDelete: !!name,
      canReset: !!name && Store.tagStyle(name).own,
      onReset: function () {
        Store.clearTagMeta(name);
        UI.toast('已恢复「' + name + '」的预设图标与颜色');
        view.render();
      },
      onDelete: function () {
        V.confirm({
          title: '删除标签',
          message: '会把「' + name + '」及其下的二级标签从所有记录上去掉（记录本身保留），同时清除对应的图标设置。',
          danger: true, okText: '删除'
        }).then(function (ok) {
          if (!ok) return;
          var n = Store.removeTagEverywhere(name);
          UI.toast('已从 ' + n + ' 条记录中移除');
          view.render();
        });
      }
    });
  }

  var view = {
    id: 'settings',
    name: '设置',
    icon: V.icons.settings,
    title: '设置',
    order: 30,
    nav: true,
    noAutoRender: true,

    root: null,

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-settings' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { SUB = ''; CAT = ''; this.render(); },

    /**
     * 深链接直接落到分类页或具体页：
     * #/settings/basic → 基础设置列表；#/settings/desktop → 桌面与快捷，返回时回到它所在的分类
     */
    setTab: function (key) {
      if (!key) return;
      if (catOf(key)) { CAT = key; SUB = ''; this.render(); return; }
      if (!SUB_META[key]) return;
      SUB = key;
      CAT = groupOf(key);
      this.render();
    },

    getTab: function () { return SUB || CAT || null; },

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      // 分类页与具体页都进地址（#/settings/basic、#/settings/desktop）
      if (global.Router && global.App && App.currentId === 'settings') {
        Router.set('settings', SUB || CAT || null);
      }

      // 「新手教程」没有独立页面，直接弹引导
      if (SUB === 'guide') {
        SUB = ''; CAT = '';
        // 地址别停在 #/settings/guide：界面其实是首页，刷新也不该再弹一次
        if (global.Router && global.App && App.currentId === 'settings') Router.set('settings', null);
        this.home();
        if (global.Onboard) Onboard.start({ from: 'settings' });
        return;
      }
      root.style.maxWidth = '760px';

      if (!SUB && !CAT) { this.home(); return; }

      if (!SUB) { this.catPage(); return; }

      /* ---- 具体页：返回条（返回分类页） ---- */
      var meta = SUB_META[SUB] || { name: '设置', desc: '' };
      var parent = catOf(CAT);
      root.appendChild(el('div', { class: 'set-head' }, [
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            if (SUB === 'periods' && document.activeElement && document.activeElement.blur) {
              document.activeElement.blur();
              setTimeout(function () { SUB = ''; view.render(); }, 350);
              return;
            }
            SUB = ''; view.render();
          }
        }, [V.svg(V.icons.left, 15), parent ? parent.name : '设置']),
        el('div', { class: 'set-head-title' }, [
          el('b', { text: meta.name }),
          el('span', { text: meta.desc })
        ])
      ]));

            if (SUB === 'pet') { this.renderPet(root); return; }

            if (SUB === 'subtask') { renderSubtaskPage(root); return; }

            if (SUB === 'look') {
  /* ===================== 外观 ===================== */
        var st = Store.state.settings;
        var lookCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        lookCard.appendChild(el('div', { class: 'section-title' }, ['外观']));

        /* --- 主题色 --- */
        var grid = el('div', { class: 'theme-grid' });
        Theme.THEMES.forEach(function (t) {
          var sw = el('button', {
            class: 'theme-swatch' + (st.theme === t.key ? ' active' : ''),
            style: { '--c': t.c },
            title: t.name,
            onclick: function () {
              Theme.setThemeColor(t.key);
              V.$$('.cp-theme-swatch', grid).forEach(function (x) { x.classList.remove('cp-active'); });
              sw.classList.add('cp-active');
              UI.toast('已切换到「' + t.name + '」');
            }
          });
          grid.appendChild(sw);
        });

        var colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = st.customColor || '#4f46e5';
        colorInput.addEventListener('input', function () { Theme.previewColor(colorInput.value); });
        colorInput.addEventListener('change', function () {
          Theme.setThemeColor('custom', colorInput.value);
          UI.toast('已保存自定义主题色');
        });
        grid.appendChild(el('div', { class: 'theme-custom' }, [
          colorInput,
          el('span', { text: '自定义' })
        ]));
        lookCard.appendChild(V.field('主题色', grid, '切换会立刻应用到整个界面'));

        /* --- 机制主题皮肤开关 --- */
        var skinOn = st.themeSkin !== false;
        var skinSw = el('button', {
          class: 'switch' + (skinOn ? ' on' : ''),
          type: 'button',
          onclick: function () {
            skinOn = !skinOn;
            skinSw.classList.toggle('cp-on', skinOn);
            Theme.setThemeSkin(skinOn);
            UI.toast(skinOn ? '已开启机制主题皮肤' : '已关闭机制主题皮肤');
          }
        }, [el('i')]);
        lookCard.appendChild(el('div', { class: 'switch-row', style: { marginTop: '2px' } }, [
          el('div', { class: 'switch-text' }, [
            el('b', { text: '机制主题皮肤' }),
            el('span', { text: '开启后自动跟随奖励机制：森林=自然生机、抽卡=工厂硬核；主色仍可自定义覆盖' })
          ]),
          skinSw
        ]));

        /* --- 明暗模式 --- */
        var modeVal = st.themeMode || 'auto';
        var modeRow = el('div', { class: 'seg-row' });
        [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].forEach(function (x) {
          var seg = el('button', {
            class: 'seg-btn' + (modeVal === x[0] ? ' on' : ''),
            type: 'button',
            onclick: function () {
              Theme.setThemeMode(x[0]);
              V.$$('.cp-seg-btn', modeRow).forEach(function (y) { y.classList.remove('cp-on'); });
              seg.classList.add('cp-on');
              UI.toast('明暗：' + x[1]);
            }
          }, [x[1]]);
          modeRow.appendChild(seg);
        });
        lookCard.appendChild(V.field('明暗模式', modeRow, '「跟随系统」会随手机的深色模式自动切换；机制主题在两种明暗下各有配色'));

        /* --- 背景图 --- */
        var bgData = st.background.dataUrl || '';
        var preview = el('div', { class: 'bg-preview' + (bgData ? ' has-img' : '') });
        if (bgData) preview.style.backgroundImage = 'url("' + bgData + '")';
        else preview.appendChild(el('span', { text: '暂无背景图' }));

        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', function () {
          var f = fileInput.files && fileInput.files[0];
          if (!f) return;
          Theme.compressImage(f, function (dataUrl, err) {
            if (!dataUrl) { UI.toast(err || '处理图片失败', 'err'); return; }
            Theme.setBackground(dataUrl);
            UI.toast('背景已更新');
            view.render();
          });
        });

        var maskVal = st.background.mask == null ? 0.5 : st.background.mask;
        var maskInput = el('input', {
          type: 'range', min: '0', max: '0.85', step: '0.05', value: String(maskVal)
        });
        maskInput.addEventListener('input', function () { Theme.previewMask(maskInput.value); });
        maskInput.addEventListener('change', function () {
          Theme.setBackground(undefined, Number(maskInput.value));
        });

        lookCard.appendChild(V.field('背景图片', el('div', {}, [
          preview,
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } }, [
            el('button', {
              class: 'btn', onclick: function () { fileInput.click(); }
            }, [V.svg(V.icons.upload, 16), '选择图片']),
            bgData ? el('button', {
              class: 'btn btn-danger', onclick: function () {
                Theme.setBackground('');
                UI.toast('已移除背景');
                view.render();
              }
            }, [V.svg(V.icons.trash, 16), '移除']) : null,
            fileInput
          ]),
          bgData ? el('div', { class: 'slider-row' }, [
            el('span', { text: '背景更明显', style: { flex: '0 0 auto' } }),
            maskInput,
            el('span', { text: '更淡', style: { flex: '0 0 auto', color: 'var(--text-3)' } })
          ]) : null
        ]), '图片会压缩后存在本地，建议用浅色、低对比的图'));

        root.appendChild(lookCard);

            }

      if (SUB === 'diet') {
  /* ===================== 饮食与热量 ===================== */
        renderDietPage(root);
      }

      if (SUB === 'fav') {
  /* ===================== 收藏的词句 ===================== */
        renderFavPage(root);
      }

      if (SUB === 'gpa') {
  /* ===================== 成绩与 GPA ===================== */
        renderGpaPage(root);
      }

      if (SUB === 'semester') {
  /* ===================== 学期 ===================== */
        renderSemesterPage(root);
      }

      if (SUB === 'periods') {
  /* ===================== 节次 ===================== */
        var periodCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        periodCard.appendChild(el('div', { class: 'section-title' }, [
          '上课节次',
          el('span', { style: { marginLeft: 'auto', fontSize: '11.5px', color: 'var(--text-3)', fontWeight: '400' },
            text: '共 ' + Store.periods.length + ' 节' })
        ]));

        // 实时自动保存：任何改动都会自动落盘，切页 / 返回不会丢
        var draft = Store.periods.map(function (p) {
          return { id: p.id, name: p.name, start: p.start, end: p.end };
        });

        var listBox = el('div', { class: 'period-list' });
        periodCard.appendChild(listBox);

        var saveTimer = null;
        var savedHint = el('div', { class: 'ocr-hint', text: '修改会自动保存' });

        function flushSave(silent) {
          if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
          if (!draft.length) { if (!silent) UI.toast('至少保留一节', 'err'); return false; }
          var empty = draft.some(function (p) { return !p.start || !p.end; });
          if (empty) {
            if (!silent) UI.toast('时间不能为空', 'err');
            savedHint.textContent = '有节次时间未填写，暂未保存';
            return false;
          }
          Store.setPeriods(draft.map(function (p) {
            return { id: p.id, name: (p.name || '').trim() || '未命名节次', start: p.start, end: p.end };
          }));
          savedHint.textContent = '已自动保存';
          return true;
        }

        function queueSave() {
          savedHint.textContent = '正在保存…';
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(function () { flushSave(true); }, 300);
        }

        function drawPeriods() {
          listBox.innerHTML = '';
          draft.forEach(function (p, idx) {
            var nameInp = V.input({
              value: p.name, placeholder: '节次名', class: 'input p-name',
              oninput: function () { p.name = this.value; queueSave(); }
            });
            var startInp = V.input({ type: 'time', value: p.start, class: 'input p-start' });
            var endInp = V.input({ type: 'time', value: p.end, class: 'input p-end' });
            startInp.addEventListener('input', function () { p.start = startInp.value; queueSave(); });
            startInp.addEventListener('change', function () { p.start = startInp.value; queueSave(); });
            endInp.addEventListener('input', function () { p.end = endInp.value; queueSave(); });
            endInp.addEventListener('change', function () { p.end = endInp.value; queueSave(); });

            var row = el('div', { class: 'period-row' }, [
              el('span', { class: 'period-idx', text: String(idx + 1) }),
              nameInp,
              startInp,
              el('span', { class: 'period-dash', text: '—' }),
              endInp,
              el('button', {
                class: 'icon-btn', title: '删除该节',
                onclick: function () { removePeriod(p); }
              }, [V.svg(V.icons.trash, 17)])
            ]);
            listBox.appendChild(row);
          });
        }

        function removePeriod(p) {
          var used = Store.courses.filter(function (c) {
            return Store.courseSlots(c).some(function (s) { return s.periodId === p.id; });
          });
          var doRemove = function () {
            draft = draft.filter(function (x) { return x.id !== p.id; });
            if (used.length) {
              used.forEach(function (c) {
                var rest = Store.courseSlots(c).filter(function (s) { return s.periodId !== p.id; });
                if (!rest.length) { Store.removeCourse(c.id); }
                else { Store.updateCourse(c.id, { slots: rest }); }
              });
            }
            drawPeriods();
            flushSave(true);
            UI.toast('已删除节次');
          };
          if (!used.length) { doRemove(); return; }
          V.confirm({
            title: '删除节次',
            message: '有 ' + used.length + ' 门课程安排在这一节（' +
              used.map(function (c) { return c.name; }).join('、') +
              '），删除节次会移除这些课程的该时段。确定继续吗？',
            danger: true, okText: '一并删除'
          }).then(function (ok) { if (ok) doRemove(); });
        }

        periodCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' } }, [
          el('button', {
            class: 'btn',
            onclick: function () {
              var last = draft[draft.length - 1];
              var n = draft.length + 1;
              var start = last ? last.end : '08:00';
              var end = addMinutes(start, 45);
              draft.push({ id: 'p_' + Date.now().toString(36), name: '第' + n + '节', start: start, end: end });
              drawPeriods();
              queueSave();
            }
          }, [V.svg(V.icons.plus, 16), '添加一节']),
          savedHint,
          el('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } }, [
            el('button', {
              class: 'btn',
              onclick: function () {
                draft = Store.periods.map(function (p) { return { id: p.id, name: p.name, start: p.start, end: p.end }; });
                drawPeriods();
                savedHint.textContent = '已重新载入';
              }
            }, ['重新载入']),
            el('button', {
              class: 'btn btn-primary',
              onclick: function () { flushSave(false); }
            }, ['保存节次'])
          ])
        ]));

        drawPeriods();
        root.appendChild(periodCard);

            }

      if (SUB === 'reward') {
  /* ===================== 奖励机制 ===================== */
        renderRewardPage(root);
      }

      if (SUB === 'rec') {
  /* ===================== 记录偏好 ===================== */
        var recCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        recCard.appendChild(el('div', { class: 'section-title' }, ['记录偏好']));
        recCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '6px', lineHeight: '1.7' },
          text: '关掉后，象限页不再显示对应卡片，「记一笔」里也不会出现。已有记录会保留。'
        }));

        function switchRow(title, desc, key) {
          var on = Store.settings[key];
          var sw = el('button', {
            class: 'switch' + (on ? ' on' : ''),
            onclick: function () {
              on = !on;
              sw.classList.toggle('cp-on', on);
              var patch = {};
              patch[key] = on;
              Store.updateSettings(patch);
            }
          }, [el('i')]);
          return el('div', { class: 'switch-row' }, [
            el('div', { class: 'switch-text' }, [
              el('b', { text: title }),
              el('span', { text: desc })
            ]),
            sw
          ]);
        }

        recCard.appendChild(switchRow('饮食记录', '记录每餐内容、消费与热量，并在象限中统计', 'trackMeal'));
        recCard.appendChild(switchRow('睡眠记录', '记录入睡与醒来时间，并统计睡眠时长', 'trackSleep'));
        root.appendChild(recCard);

        /* ---- 健康提示（阈值用户自定，可关） ---- */
        var hcfg = Object.assign({ on: true, sleepMinH: 6, kcalOver: true, activityMinH: 0 }, Store.settings.health || {});
        function saveHealth() { Store.updateSettings({ health: hcfg }); }
        var hCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        hCard.appendChild(el('div', { class: 'section-title' }, ['健康提示']));
        hCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '8px', lineHeight: '1.7' },
          text: '在今日页给出轻提示（睡眠不足 / 热量超标 / 活动不足）。标准自己定，关掉即不显示。'
        }));
        var hOn = hcfg.on;
        var hSw = el('button', {
          class: 'switch' + (hOn ? ' on' : ''),
          onclick: function () { hOn = !hOn; hSw.classList.toggle('cp-on', hOn); hcfg.on = hOn; saveHealth(); }
        }, [el('i')]);
        hCard.appendChild(el('div', { class: 'switch-row' }, [
          el('div', { class: 'switch-text' }, [el('b', { text: '开启健康提示' }), el('span', { text: '今日页显示健康小提示' })]),
          hSw
        ]));
        hCard.appendChild(el('div', { class: 'switch-row' }, [
          el('div', { class: 'switch-text' }, [el('b', { text: '睡眠下限' }), el('span', { text: '少于这个小时数时提示' })]),
          el('input', {
            class: 'input', type: 'number', min: '0', step: '0.5', value: String(hcfg.sleepMinH),
            style: { width: '84px' },
            onchange: function (e) { hcfg.sleepMinH = Math.max(0, Number(e.target.value) || 0); saveHealth(); }
          })
        ]));
        var kOn = hcfg.kcalOver;
        var kSw = el('button', {
          class: 'switch' + (kOn ? ' on' : ''),
          onclick: function () { kOn = !kOn; kSw.classList.toggle('cp-on', kOn); hcfg.kcalOver = kOn; saveHealth(); }
        }, [el('i')]);
        hCard.appendChild(el('div', { class: 'switch-row' }, [
          el('div', { class: 'switch-text' }, [el('b', { text: '热量超标提示' }), el('span', { text: '超过每日热量目标时提示（需先设目标）' })]),
          kSw
        ]));
        hCard.appendChild(el('div', { class: 'switch-row' }, [
          el('div', { class: 'switch-text' }, [el('b', { text: '活动下限' }), el('span', { text: '少于这个小时数时提示（0=不提示）' })]),
          el('input', {
            class: 'input', type: 'number', min: '0', step: '0.5', value: String(hcfg.activityMinH),
            style: { width: '84px' },
            onchange: function (e) { hcfg.activityMinH = Math.max(0, Number(e.target.value) || 0); saveHealth(); }
          })
        ]));
        root.appendChild(hCard);

            }

      if (SUB === 'stats') {
  /* ===================== 时间统计 ===================== */
        var sOn = !!Store.settings.statsOn;
        var statsCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        statsCard.appendChild(el('div', { class: 'section-title' }, ['时间统计']));
        statsCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '8px', lineHeight: '1.7' },
          text: '开启后，两处会同时出现「时间统计」：待办页里的「统计」分页，以及今日板块的「本周已记录」卡片。' +
                '关闭则两处一起消失（双隐藏）——既不占底部导航，也不占今日板块。'
        }));
        var sSw = el('button', {
          class: 'switch' + (sOn ? ' on' : ''),
          onclick: function () {
            sOn = !sOn;
            sSw.classList.toggle('cp-on', sOn);
            Store.updateSettings({ statsOn: sOn });
            UI.toast(sOn ? '已开启时间统计' : '已关闭时间统计');
          }
        }, [el('i')]);
        statsCard.appendChild(el('div', { class: 'switch-row' }, [
          el('div', { class: 'switch-text' }, [
            el('b', { text: '开启时间统计' }),
            el('span', { text: '统计分页 + 今日记录卡片（双隐藏）' })
          ]),
          sSw
        ]));
        root.appendChild(statsCard);

        /* 统计分页显示哪些卡片 */
        var wCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        wCard.appendChild(el('div', { class: 'section-title' }, ['统计分页显示哪些']));
        wCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '8px', lineHeight: '1.7' },
          text: '只影响待办页「统计」分页里显示哪些卡片，不影响数据本身。'
        }));
        function widgetRow(title, desc, key) {
          var cur = Object.assign({ time: true, curve: true, sources: true, spend: true, course: true }, Store.settings.statsWidgets || {});
          var on = cur[key] !== false;
          var sw = el('button', {
            class: 'switch' + (on ? ' on' : ''),
            onclick: function () {
              on = !on;
              sw.classList.toggle('cp-on', on);
              var next = Object.assign({ time: true, curve: true, sources: true, spend: true, course: true }, Store.settings.statsWidgets || {});
              next[key] = on;
              Store.updateSettings({ statsWidgets: next });
            }
          }, [el('i')]);
          return el('div', { class: 'switch-row' }, [
            el('div', { class: 'switch-text' }, [
              el('b', { text: title }),
              el('span', { text: desc })
            ]),
            sw
          ]);
        }
        wCard.appendChild(widgetRow('时间统计', '睡眠 / 上课 / 日程 / 活动 / 用餐的时长分布', 'time'));
        wCard.appendChild(widgetRow('积分曲线', '每日获得 / 累计，可在分页内切换', 'curve'));
        wCard.appendChild(widgetRow('积分来源', '各渠道累计获得积分的构成', 'sources'));
        wCard.appendChild(widgetRow('消费构成', '每日支出与分类占比', 'spend'));
        wCard.appendChild(widgetRow('课程投入', '按课程汇总的实际投入时长', 'course'));
        root.appendChild(wCard);
            }

      if (SUB === 'diary') {
  /* ===================== 日记 ===================== */
        var dcfg = Store.state.settings.diary;

        function diarySwitch(title, desc, key) {
          var on = !!dcfg[key];
          var sw = el('button', {
            class: 'switch' + (on ? ' on' : ''),
            onclick: function () {
              on = !on;
              sw.classList.toggle('cp-on', on);
              dcfg[key] = on;
              Store.save();
              // 开关影响的是「日记」分页里的心情概览，回到那里才能看到变化
              if (UI.toast) UI.toast(on ? '已打开「' + title + '」' : '已关闭「' + title + '」');
            }
          }, [el('i')]);
          return el('div', { class: 'switch-row' }, [
            el('div', { class: 'switch-text' }, [
              el('b', { text: title }),
              el('span', { text: desc })
            ]),
            sw
          ]);
        }

        var diaryCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        diaryCard.appendChild(el('div', { class: 'section-title' }, ['日记']));
        diaryCard.appendChild(diarySwitch(
          '凌晨保存时问日期',
          '凌晨 0–3 点保存日记时，问一句这篇算「昨天」还是「今天」。关了就一直按当天算，需要时可以在编辑器里「换一天」。',
          'askDateAtNight'
        ));
        diaryCard.appendChild(diarySwitch(
          '心情统计',
          '在日记页顶部显示本月心情概览（平均分、分布、冷暖倾向）。样本不足 ' + Store.MOOD_MIN_DAYS +
          ' 天时无论如何都不显示。日记本身和心情标签不受影响。',
          'showMoodStats'
        ));
        diaryCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.7' },
          text: '日记一天只存一篇，写在「待办 → 日记」里。心情是选填的固定五档，标了才能在日历上看出颜色。' +
                '日记只存在本机，也不进同步码——换设备时用「数据管理 → 导出备份」传文件。'
        }));
        root.appendChild(diaryCard);

        var diaryRule = el('div', { class: 'card', style: { padding: '16px 18px' } }, [
          el('div', { class: 'section-title' }, ['心情是怎么算的']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', lineHeight: '1.9' },
            text: '五档依次是「很好 / 还行 / 一般 / 疲惫 / 低落」，分别记 5 / 4 / 3 / 2 / 1 分，' +
                  '平均分就是这些分数的简单平均，不是加权。颜色按冷暖排：很好偏暖（橙），还行偏中性（绿），' +
                  '一般中性（灰），疲惫与低落下偏冷（靛、紫）。冷暖占比只是把这几档按颜色归了类，' +
                  '不代表心情好坏的程度差别。'
          }),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: '1.9' },
            text: '为什么不满 ' + Store.MOOD_MIN_DAYS + ' 天不给看：样本太少时，几天的波动画成图会像「规律」，' +
                  '实际上只是巧合。与其给一个不可信的结论，不如先不显示。'
          })
        ]);
        root.appendChild(diaryRule);

            }

      if (SUB === 'speech') {
        var asr = Store.state.settings.asr || {};
        var spCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        spCard.appendChild(el('div', { class: 'section-title' }, ['语音识别']));

        var modeNow = global.Speech ? global.Speech.mode() : 'none';
        var nativeOK = global.Speech ? global.Speech.nativeSupported() : false;
        spCard.appendChild(el('div', {
          style: { fontSize: '12.5px', lineHeight: '1.7', marginBottom: '12px', color: 'var(--text-2)' },
          text: nativeOK
            ? '当前浏览器支持原生语音识别（iPhone Safari 可用；安卓 Chrome 需要访问 Google 服务，国内常常失败）。'
            : '当前浏览器不支持原生语音识别，需要配置讯飞后才能用语音输入。'
        }));

        spCard.appendChild(el('div', { class: 'preview-box', style: { marginBottom: '12px' } }, [
          el('div', { text: '当前生效方案：' + (
            modeNow === 'native' ? '浏览器原生（免费）' :
            modeNow === 'xunfei' ? '讯飞语音听写' : '不可用') })
        ]));

        spCard.appendChild(V.field('优先方式', V.segment([
          { value: 'auto', label: '自动' },
          { value: 'native', label: '仅浏览器' },
          { value: 'xunfei', label: '仅讯飞' }
        ], asr.prefer || 'auto', function (v) {
          // 重新取最新配置，避免覆盖刚填的密钥
          var cur = Store.state.settings.asr || {};
          Store.updateSettings({ asr: Object.assign({}, cur, { prefer: v }) });
          view.render();
        }), '自动＝优先用浏览器原生，不支持时回落到讯飞'));

        var fAppId = V.input({ placeholder: '例如 5f7a8b2c', value: asr.appId || '' });
        var fKey = V.input({ placeholder: 'APIKey', value: asr.apiKey || '' });
        var fSecret = V.input({ placeholder: 'APISecret', value: asr.apiSecret || '' });

        function saveAsr() {
          var cur = Store.state.settings.asr || {};
          Store.updateSettings({
            asr: {
              prefer: cur.prefer || 'auto',
              appId: fAppId.value.trim(),
              apiKey: fKey.value.trim(),
              apiSecret: fSecret.value.trim()
            }
          });
          UI.toast('已保存语音配置');
        }

        spCard.appendChild(V.field('讯飞 AppID', fAppId));
        spCard.appendChild(V.field('讯飞 APIKey', fKey));
        spCard.appendChild(V.field('讯飞 APISecret', fSecret));

        spCard.appendChild(el('p', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', lineHeight: '1.7', marginTop: '10px' },
          text: '在讯飞开放平台创建「语音听写」应用即可拿到这三个值，有免费额度。密钥只存在这台设备的浏览器里。'
        }));

        spCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
          el('button', { class: 'btn btn-primary', text: '保存', onclick: saveAsr }),
          el('button', {
            class: 'btn', text: '清空',
            onclick: function () {
              Store.updateSettings({ asr: { prefer: 'auto', appId: '', apiKey: '', apiSecret: '' } });
              UI.toast('已清空');
              view.render();
            }
          })
        ]));

        root.appendChild(spCard);
      }

      if (SUB === 'ocr') {
        var oc = Store.state.settings.ocr || {};
        var ocCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        ocCard.appendChild(el('div', { class: 'section-title' }, ['图片识别']));

        ocCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.7', marginBottom: '12px' },
          text: '默认在本机识别（免费、图片不出设备）。如果版式复杂或识别不准，可以填一个 OpenAI 兼容的视觉接口，用云端识别。'
        }));

        ocCard.appendChild(V.field('优先方式', V.segment([
          { value: 'local', label: '本地识别' },
          { value: 'cloud', label: '云端识别' }
        ], oc.prefer === 'cloud' ? 'cloud' : 'local', function (v) {
          var cur = Store.state.settings.ocr || {};
          Store.updateSettings({ ocr: Object.assign({}, cur, { prefer: v }) });
          view.render();
        }), '本地＝Tesseract（约 1.8MB 模型按需下载）；云端＝调用下面的接口'));

        var fEndpoint = V.input({ placeholder: 'https://api.openai.com/v1', value: oc.endpoint || '' });
        var fKey = V.input({ placeholder: 'sk-…', value: oc.apiKey || '' });
        var fModel = V.input({ placeholder: 'gpt-4o-mini', value: oc.model || '' });

        ocCard.appendChild(V.field('接口地址', fEndpoint, 'OpenAI 兼容的 base URL，会自动补 /chat/completions'));
        ocCard.appendChild(V.field('API Key', fKey));
        ocCard.appendChild(V.field('模型', fModel, '需要支持图片输入，例如 gpt-4o-mini / qwen-vl-max'));

        ocCard.appendChild(el('p', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', lineHeight: '1.7', marginTop: '10px' },
          text: '密钥只保存在本机浏览器里，请求直接从浏览器发往你填的接口。'
        }));

        ocCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              var cur = Store.state.settings.ocr || {};
              Store.updateSettings({
                ocr: {
                  prefer: cur.prefer === 'cloud' ? 'cloud' : 'local',
                  provider: 'openai',
                  endpoint: fEndpoint.value.trim(),
                  apiKey: fKey.value.trim(),
                  model: fModel.value.trim()
                }
              });
              UI.toast('已保存图片识别配置');
            }
          }),
          el('button', {
            class: 'btn', text: '清空云端配置',
            onclick: function () {
              Store.updateSettings({
                ocr: { prefer: 'local', provider: '', endpoint: '', apiKey: '', model: '' }
              });
              UI.toast('已清空');
              view.render();
            }
          })
        ]));

        root.appendChild(ocCard);
      }

      if (SUB === 'tags') {
  /* ===================== 标签 ===================== */
        var tagCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        tagCard.appendChild(el('div', { class: 'section-title' }, ['标签']));
        tagCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
          text: '标签可以带图标和颜色。像「学习」「生活」「运动」这类常用标签不用设置就会自动配上图标；点开任意一个标签，都能换成别的图标、改成想要的颜色，也可以改名（改名会同步到所有打过这个标签的记录）。'
        }));

        /* ---- 已有标签（含只设置过样式、还没用到的） ---- */
        var tree = Store.tagTree();
        var seen = {};
        tree.forEach(function (g) {
          seen[g.name] = 1;
          g.children.forEach(function (c) { seen[c.full] = 1; });
        });
        var extra = Object.keys(Store.state.settings.tagMeta || {}).filter(function (k) {
          return !seen[k];
        });
        if (extra.length) {
          var emap = {}, eorder = [];
          extra.forEach(function (k) {
            var p = tagParts(k);
            if (!emap[p.lv1]) { emap[p.lv1] = { name: p.lv1, count: 0, children: [] }; eorder.push(p.lv1); }
            if (p.lv2) emap[p.lv1].children.push({ full: k, name: p.lv2, count: 0 });
          });
          tree = tree.concat(eorder.map(function (k) { return emap[k]; }));
        }
        var usedCard = el('div', { style: { marginBottom: '14px' } });

        function tagRowBtn(name, count, indent) {
          var s = Store.tagStyle(name);
          var parts = tagParts(name);
          var ico = s.icon && V.icons[s.icon]
            ? V.svg(V.icons[s.icon], 15)
            : el('i', { class: 'tc-dot' });
          return el('button', {
            class: 'tag-row' + (indent ? ' indent' : ''),
            onclick: function () { openTagEditor(name); }
          }, [
            el('span', { class: 'tr-icon', style: { '--tc': s.color } }, [ico]),
            el('span', { class: 'tr-text' }, [
              el('b', { text: indent ? parts.lv2 : name }),
              el('span', { text: count ? count + ' 条记录' : '尚未使用' })
            ]),
            s.own ? el('span', { class: 'tr-badge', text: '自定义' })
                  : (s.preset ? el('span', { class: 'tr-badge preset', text: '预设' }) : null),
            V.svg(V.icons.right, 15)
          ]);
        }

        if (tree.length) {
          usedCard.appendChild(el('div', { class: 'sub-title', text: '已有标签' }));
          tree.forEach(function (g) {
            usedCard.appendChild(tagRowBtn(g.name, g.count, false));
            g.children.forEach(function (c) {
              usedCard.appendChild(tagRowBtn(c.full, c.count, true));
            });
          });
        } else {
          usedCard.appendChild(el('div', {
            class: 'q-empty',
            text: '还没有用过标签。在待办、灵感、记账里加上标签后，就能在这里统一改图标和颜色。'
          }));
        }
        tagCard.appendChild(usedCard);

        tagCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm',
            onclick: function () { openTagEditor(''); }
          }, [V.svg(V.icons.plus, 15), '新建标签'])
        ]));

        /* ---- 常用标签组合 ---- */
        var presetCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        presetCard.appendChild(el('div', { class: 'section-title' }, ['常用标签组合']));
        presetCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
          text: '下面这些是常用的图标组合，点一个可以直接改它的图标、颜色和文字；也可以整组一键套用。'
        }));

        var groups = Store.tagGroups();
        var gbar = el('div', { class: 'pg-bar' });
        groups.forEach(function (g) {
          gbar.appendChild(el('button', {
            class: 'pg-tab' + (TAG_GROUP === g ? ' active' : ''),
            text: g,
            onclick: function () { TAG_GROUP = g; view.render(); }
          }));
        });
        presetCard.appendChild(gbar);

        var presets = Store.tagPresets().filter(function (p) { return p.group === TAG_GROUP; });
        var pgrid = el('div', { class: 'pg-grid' });
        presets.forEach(function (p) {
          var s = Store.tagStyle(p.name);
          var parts = tagParts(p.name);
          var meta = Store.state.settings.tagMeta || {};
          var custom = !!meta[p.name];
          pgrid.appendChild(el('button', {
            class: 'pg-item' + (custom ? ' custom' : ''),
            onclick: function () { openTagEditor(p.name); }
          }, [
            el('span', { class: 'tr-icon', style: { '--tc': s.color } },
              [s.icon && V.icons[s.icon] ? V.svg(V.icons[s.icon], 15) : el('i', { class: 'tc-dot' })]),
            el('span', { class: 'pg-name', text: parts.lv2 || p.name }),
            custom ? el('span', { class: 'pg-flag', text: '已改' }) : null
          ]));
        });
        presetCard.appendChild(pgrid);

        presetCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              presets.forEach(function (p) {
                Store.setTagMeta(p.name, { icon: p.icon, color: p.color });
              });
              UI.toast('已套用「' + TAG_GROUP + '」这组图标');
              view.render();
            }
          }, ['套用整组（' + presets.length + ' 个）']),
          el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              V.confirm({
                title: '恢复默认',
                message: '清除全部标签的自定义图标与颜色，回到系统预设效果。标签名字不会变。',
                okText: '恢复'
              }).then(function (ok) {
                if (!ok) return;
                Store.updateSettings({ tagMeta: {} });
                UI.toast('已恢复默认图标与颜色');
                view.render();
              });
            }
          }, ['全部恢复默认'])
        ]));

        root.appendChild(tagCard);
        root.appendChild(presetCard);
      }

      if (SUB === 'remind') { this.renderRemind(root); return; }

      if (SUB === 'nav') {
  /* ===================== 模块显示 ===================== */
        var navCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        navCard.appendChild(el('div', { class: 'section-title' }, ['模块显示']));
        navCard.appendChild(el('p', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '8px', lineHeight: '1.7' },
          text: '关掉的模块不会出现在导航里（数据仍保留）。用上下箭头调整顺序，排在最前面的会出现在底部导航；开启的模块超过 5 个时，多出来的会自动收进「更多」。'
        }));

        /** 当前完整顺序（按 App.views，已应用自定义顺序） */
        function orderedIds() {
          return App.views.filter(function (x) { return x.nav !== false; })
            .map(function (x) { return x.id; });
        }

        function setOrder(ids) {
          Store.updateSettings({ navOrder: ids });
          if (App.rebuildNav) App.rebuildNav();
          view.render();
        }

        function move(id, dir) {
          var ids = orderedIds();
          var i = ids.indexOf(id);
          var j = i + dir;
          if (i < 0 || j < 0 || j >= ids.length) return;
          var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
          var v = App.views.filter(function (x) { return x.id === id; })[0];
          setOrder(ids);
          UI.toast('「' + (v ? v.name : '') + '」移到第 ' + (j + 1) + ' 位');
        }

        function moveBtn(icon, title, disabled, onclick) {
          var attrs = { class: 'icon-btn', title: title, onclick: onclick };
          if (disabled) attrs.disabled = 'disabled';
          return el('button', attrs, [V.svg(icon, 15)]);
        }

        var ids = orderedIds();
        var cfg = Store.state.settings.nav || {};

        ids.forEach(function (id, idx) {
          var v = App.views.filter(function (x) { return x.id === id; })[0];
          if (!v) return;
          var locked = (id === 'today' || id === 'settings');
          var on = locked ? true : (cfg[id] !== false);

          var sw = el('button', {
            class: 'switch' + (on ? ' on' : '') + (locked ? ' locked' : ''),
            onclick: function () {
              if (locked) { UI.toast('「' + v.name + '」需要保留入口'); return; }
              var next = !sw.classList.contains('cp-on');
              sw.classList.toggle('cp-on', next);
              var nav = Object.assign({}, Store.state.settings.nav || {});
              nav[id] = next;
              Store.updateSettings({ nav: nav });
              if (App.rebuildNav) App.rebuildNav();
              UI.toast(next ? '已显示「' + v.name + '」' : '已隐藏「' + v.name + '」');
            }
          }, [el('i')]);

          navCard.appendChild(el('div', { class: 'switch-row nav-row' + (on ? '' : ' off') }, [
            el('span', { class: 'nav-idx', text: String(idx + 1) }),
            el('div', { class: 'switch-text' }, [
              el('b', { text: v.name }),
              el('span', { text: locked ? '始终显示' : (v.title || '') })
            ]),
            el('div', { class: 'nav-move' }, [
              moveBtn(V.icons.up, '上移', idx === 0, function () { move(id, -1); }),
              moveBtn(V.icons.down, '下移', idx === ids.length - 1, function () { move(id, 1); })
            ]),
            sw
          ]));
        });

        navCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
          el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              V.confirm({
                title: '恢复默认顺序',
                message: '把模块顺序恢复为系统默认（今日 / 课程表 / 日程 / 象限…）。',
                okText: '恢复'
              }).then(function (ok) {
                if (!ok) return;
                setOrder([]);
                UI.toast('已恢复默认顺序');
              });
            }
          }, ['恢复默认顺序'])
        ]));

        root.appendChild(navCard);

        /* ---- 首页卡片开关 ---- */
        var dailyCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
        dailyCard.appendChild(el('div', { class: 'section-title' }, ['首页卡片']));
        dailyCard.appendChild(el('p', {
          style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
          text: '决定「今日」页顶部要不要显示每日一句 / 每日一词。关掉不影响数据，收藏过的词句仍然保留。'
        }));

        [
          { k: 'poem', name: '每日一句', desc: '古诗 / 古文，共 ' + ((global.Daily && Daily.poems.length) || 0) + ' 篇' },
          { k: 'word', name: '每日一词', desc: '专四词汇，共 ' + ((global.Daily && Daily.words.length) || 0) + ' 词' }
        ].forEach(function (d) {
          var on = Store.dailyOn(d.k);
          var sw = el('button', {
            class: 'switch' + (on ? ' on' : ''),
            onclick: function () {
              var next = !sw.classList.contains('cp-on');
              sw.classList.toggle('cp-on', next);
              Store.setDailyOn(d.k, next);
              UI.toast(next ? '首页已显示「' + d.name + '」' : '首页已隐藏「' + d.name + '」');
            }
          }, [el('i')]);
          dailyCard.appendChild(el('div', { class: 'switch-row' + (on ? '' : ' off') }, [
            el('div', { class: 'switch-text' }, [
              el('b', { text: d.name }),
              el('span', { text: d.desc })
            ]),
            sw
          ]));
        });

        dailyCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
          el('button', {
            class: 'btn btn-sm',
            onclick: function () { SUB = 'fav'; view.render(); }
          }, ['查看收藏的词句 →'])
        ]));
        root.appendChild(dailyCard);

            }

      if (SUB === 'goals') {
  /* ===================== 目标 ===================== */
        var gcfg = Store.state.settings.goals;
        var gOn = gcfg.monthlyReview !== false;
        var gSw = el('button', {
          class: 'switch' + (gOn ? ' on' : ''),
          onclick: function () {
            gOn = !gOn;
            gSw.classList.toggle('cp-on', gOn);
            gcfg.monthlyReview = gOn;
            Store.save();
            if (UI.toast) UI.toast(gOn ? '已打开月末复盘提醒' : '已关闭月末复盘提醒');
          }
        }, [el('i')]);

        var goalCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
          el('div', { class: 'section-title' }, ['月末复盘']),
          el('div', { class: 'switch-row' }, [
            el('div', { class: 'switch-text' }, [
              el('b', { text: '每月最后三天提醒' }),
              el('span', { text: '目标页顶部出现一张复盘卡，点一下把各目标的进度写进当天日记，后面自己接着写。只提示，不会自动写。' })
            ]),
            gSw
          ]),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.8' },
            text: '同时在办最多 ' + Store.GOAL_MAX_ACTIVE + ' 个目标，上限写死、不提供设置：目标页最大的失败形态不是功能少，' +
                  '是变成一张谁也不看的表。到期的目标不会删除，只是挪到「已归档」，进度按目标周期冻结。'
          })
        ]);
        root.appendChild(goalCard);

        root.appendChild(el('div', { class: 'card', style: { padding: '16px 18px' } }, [
          el('div', { class: 'section-title' }, ['目标怎么算进度']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', lineHeight: '1.9' },
            text: '每条关键结果按自己的方式算：挂计划的看周期内打卡进度，挂待办的看周期内相关待办的完成率，' +
                  '自己填的就是「当前值 ÷ 目标值」。总进度是这些的等权平均，不做权重——个人场景里权重基本靠拍脑袋，' +
                  '拍出来的数比不填更误导。'
          }),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: '1.9' },
            text: '没有可统计数据的（绑定的计划被删了、周期内还没有待办、期中还没考）先不计入平均，' +
                  '免得刚建好就显示 0%，看着像什么都没做。'
          }),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginTop: '8px', lineHeight: '1.9' },
            text: '积分：目标推进到 100% 并归档，发 ' + POMO.GOAL_DONE + ' 积分，每个目标只发一次，' +
                  '周期不满 ' + Store.GOAL_MIN_DAYS + ' 天的不发（免得「建一个 100% 的目标立刻归档」刷分）。' +
                  '成就在「收集 → 成就 → 目标」里：第一个目标、同时 5 个目标、达成留档、写过一次月末复盘。'
          }),
          el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
            el('button', {
              class: 'btn btn-primary',
              onclick: function () { App.go('plans', { tab: 'goals' }); }
            }, [V.svg(V.icons.target, 16), '去目标页'])
          ])
        ]));
      }

      if (SUB === 'desktop') {
  /* ===================== 桌面与快捷 ===================== */
        var online = /^https?:$/.test(location.protocol || '');
        var installed = !!(global.App && App.isStandalone && App.isStandalone());
        var canInstall = !!(global.App && App.installReady && App.installReady());

        function absLink(hash) { return location.href.split('#')[0] + hash; }

        function copyLink(text) {
          function done() { UI.toast('链接已复制'); }
          function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            if (ok) done();
            else UI.toast('复制失败：长按上面的链接手动复制', 'err');
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
          } else fallback();
        }

        /* ---- 安装 ---- */
        var installCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
          el('div', { class: 'section-title' }, ['安装到桌面']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
            text: '装到桌面后是个独立窗口：没有地址栏和标签页，点图标就像开一个 App。数据仍然只存在这台设备的浏览器里，不会因为「安装」上传到任何地方。'
          })
        ]);

        if (installed) {
          installCard.appendChild(el('div', {
            class: 'ocr-hint',
            text: '当前已经是从桌面图标启动的独立窗口了。'
          }));
        } else if (canInstall) {
          installCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            el('button', {
              class: 'btn btn-primary',
              onclick: function () {
                if (!App.promptInstall()) { UI.toast('浏览器暂时没有再给安装入口，请用菜单里的「安装应用」', 'err'); return; }
                UI.toast('已弹出安装确认');
              }
            }, [V.svg(V.icons.download, 16), '立即安装'])
          ]));
        } else if (!online) {
          installCard.appendChild(el('div', {
            class: 'ocr-hint',
            text: '现在是以本地文件（file://）打开的：浏览器不允许把本地文件装成应用，加书签也只会记住这个路径。把 index.html 和 manifest.webmanifest、两个图标一起放到任意静态托管（或局域网地址）再打开，才会有完整的安装效果。'
          }));
        } else {
          installCard.appendChild(el('div', {
            class: 'ocr-hint',
            text: '这台浏览器还没给出安装入口。Chrome / Edge 看地址栏右侧的安装图标，或「⋮ → 安装应用」；iOS Safari 用「分享 → 添加到主屏幕」。'
          }));
        }

        installCard.appendChild(el('ul', {
          style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.9', marginTop: '12px', paddingLeft: '18px' }
        }, [
          el('li', { text: '· Android / 桌面 Chrome、Edge：地址栏右侧「安装」图标，或菜单 →「安装应用 / 添加到主屏幕」。' }),
          el('li', { text: '· iOS / iPadOS Safari：底部分享按钮 →「添加到主屏幕」（Safari 不认 manifest 里的快捷方式，只能装图标）。' }),
          el('li', { text: '· 装好后长按桌面图标，会多出「今日课表 / 写日记 / 待办」三个快捷入口，一按直达。' })
        ]));
        root.appendChild(installCard);

        /* ---- 直达链接 ---- */
        var linkCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
          el('div', { class: 'section-title' }, ['直达链接']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '6px', lineHeight: '1.7' },
            text: '每个模块都有自己的地址（#/today、#/tasks/diary 这种）。复制下来存成书签、发给自己，或者做成手机桌面的快捷指令，打开就是那一个页面。'
          })
        ]);

        [
          { hash: '#/today', label: '今日课表', icon: V.icons.today },
          { hash: '#/tasks', label: '作业与待办', icon: V.icons.check },
          { hash: '#/diary', label: '写日记', icon: V.icons.book }
        ].forEach(function (x) {
          var url = absLink(x.hash);
          linkCard.appendChild(el('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '9px 0', borderBottom: '1px solid var(--line)'
            }
          }, [
            el('span', {
              style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600' }
            }, [V.svg(x.icon, 16), x.label]),
            el('code', {
              style: {
                flex: '1 1 auto', minWidth: '0', margin: '0 4px',
                fontSize: '11.5px', color: 'var(--text-2)',
                background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: '6px',
                padding: '3px 8px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              },
              title: url,
              text: x.hash
            }),
            el('button', {
              class: 'btn btn-sm',
              onclick: function () { copyLink(url); }
            }, [V.svg(V.icons.copy, 14), '复制'])
          ]));
        });

        linkCard.appendChild(el('div', {
          class: 'ocr-hint',
          style: { marginTop: '10px' },
          text: '页面内切换模块时，地址栏会跟着变，所以随手复制地址栏也是准的。地址里的 # 后面只是「看哪一页」，不影响数据。'
        }));
        root.appendChild(linkCard);
      }

      if (SUB === 'data') {
  /* ===================== 数据 ===================== */
        /* ---- 设备间同步 ---- */
        var syncCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
          el('div', { class: 'section-title' }, ['手机 ⇄ 电脑同步']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
            text: '数据只存在各自设备的浏览器里，没有服务器，所以要手动同步。点「生成同步文件」导出一份 .json，用微信 / QQ 发到另一台设备，在那台设备点「导入同步文件」选文件或粘贴即可。'
          }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            el('button', { class: 'btn btn-primary', onclick: syncFileDialog },
              [V.svg(V.icons.download, 16), '生成同步文件']),
            el('button', { class: 'btn', onclick: pasteSyncDialog },
              [V.svg(V.icons.upload, 16), '导入同步文件'])
          ]),
          el('div', {
            class: 'ocr-hint',
            style: { marginTop: '10px' },
            text: '注意：同步是「整体覆盖」不是「合并」。建议固定一个方向，比如始终以手机为准同步到电脑。另外不同浏览器各存各的（手机 Safari 和 Chrome 是两套），固定用一个就不会乱。'
          })
        ]);
        root.appendChild(syncCard);

        /* ---- 文件备份 ---- */
        var dataCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
          el('div', { class: 'section-title' }, ['文件备份']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
            text: '课程、日程、计划、待办、灵感、日记、记账、时间记录与设置都保存在当前浏览器本地（localStorage），不会上传到任何服务器。清理浏览器数据前，建议导出一份文件备份。'
          }),
          el('p', {
            style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
            text: '文件备份是唯一包含「日记」的迁移方式（同步不含日记）。导出的 json 里带着全部日记正文，请存在自己放心的位置。'
          }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            el('button', { class: 'btn', onclick: exportData }, [V.svg(V.icons.download, 16), '导出备份']),
            el('button', { class: 'btn', onclick: importData }, [V.svg(V.icons.upload, 16), '导入备份']),
            el('button', {
              class: 'btn btn-danger', onclick: function () {
                V.confirm({
                  title: '清空全部数据',
                  message: '将删除所有课程、作业与设置。清空前会自动存一份本地备份，可在下方「自动备份」里恢复。',
                  danger: true, okText: '清空'
                }).then(function (ok) {
                  if (!ok) return;
                  Store.backupNow('清空数据前').then(function () {
                    Store.reset();
                    UI.toast('已重置为初始状态（原数据已自动备份）');
                    App.go('today');
                  });
                });
              }
            }, [V.svg(V.icons.trash, 16), '清空数据'])
          ])
        ]);
        root.appendChild(dataCard);

        /* ---- 自动备份（清空 / 覆盖前的回滚点） ---- */
        var bkCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
          el('div', { class: 'section-title' }, ['自动备份']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
            text: '清空数据、导入备份或粘贴同步码覆盖前，会自动在本机存一份快照（最多保留 ' +
                  Store.BK_MAX + ' 份）。误操作后可以回到上一份，不用手动先导出。'
          }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } }, [
            el('button', {
              class: 'btn', onclick: function () {
                Store.backupNow('手动').then(function (meta) {
                  UI.toast(meta ? '已创建备份' : '当前没有数据可备份');
                  renderBackups();
                });
              }
            }, [V.svg(V.icons.download, 16), '立即备份'])
          ]),
          el('div', { id: 'cpBackupList' })
        ]);
        root.appendChild(bkCard);

        function renderBackups() {
          var host = bkCard.querySelector('#cpBackupList');
          if (!host) return;
          host.innerHTML = '';
          Store.listBackups().then(function (list) {
            if (!list.length) {
              host.appendChild(el('div', { class: 'ocr-hint', text: '还没有自动备份。' }));
              return;
            }
            list.forEach(function (m) {
              var d = new Date(m.ts);
              var when = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
                         String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
              var desc = [m.courses + ' 课', m.tasks + ' 待办', m.ledger + ' 账', m.notes + ' 笔记']
                .filter(function (x) { return !/^0 /.test(x); }).join(' · ');
              host.appendChild(el('div', {
                class: 'setting-row',
                style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--line)' }
              }, [
                el('div', { style: { flex: '1', minWidth: '0' } }, [
                  el('div', { style: { fontSize: '13px', fontWeight: '600' }, text: when + '（' + m.reason + '）' }),
                  el('div', { class: 'ocr-hint', text: desc || '（空数据）' })
                ]),
                el('button', {
                  class: 'btn btn-sm',
                  onclick: function () {
                    V.confirm({
                      title: '恢复这份备份',
                      message: '将用 ' + when + ' 的备份覆盖当前数据（当前状态也会先自动备份一次）。',
                      danger: true, okText: '恢复'
                    }).then(function (ok) {
                      if (!ok) return;
                      Store.restoreBackup(m.key).then(function () {
                        UI.toast('已恢复');
                        App.go('schedule');
                      }).catch(function (e) {
                        UI.toast('恢复失败：' + e.message, 'err');
                      });
                    });
                  }
                }, ['恢复']),
                el('button', {
                  class: 'btn btn-sm',
                  onclick: function () {
                    Store.deleteBackup(m.key).then(function () {
                      UI.toast('已删除该备份');
                      renderBackups();
                    });
                  }
                }, ['删除'])
              ]));
            });
          });
        }
        renderBackups();

        /* ---- 开发者选项 ---- */
        var devInput = V.input({ placeholder: '输入开发者口令', class: 'input', style: { maxWidth: '220px' } });
        var devCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px', border: '1px dashed var(--text-3)' } }, [
          el('div', { class: 'section-title' }, ['开发者选项']),
          el('p', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
            text: '仅供调试种树与奖励机制使用。口令：『我已经太烧了』一次性发放 100000 养分；『明日方舟』开启抽卡系统（含寻访/干员图鉴/抽卡商店），『关闭抽卡』恢复为仅种树。'
          }),
          el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
            devInput,
            el('button', {
              class: 'btn btn-primary',
              onclick: function () {
                var pwd = String(devInput.value || '').trim();
                if (pwd === '我已经太烧了') {
                  var G = 100000;
                  var pm = Store.state.pomodoro;
                  pm.points += G;
                  pm.earned += G;
                  Store.emit();
                  UI.toast('已发放 ' + G + ' 养分');
                  view.render();
                } else if (pwd === '明日方舟') {
                  Store.setGachaEnabled(true);
                  UI.toast('已开启抽卡系统');
                  if (global.App) App.rebuildNav();
                  // 开启后弹出抽卡 / 合成玉 的专门引导（不进主流程，默认只种树看不到）
                  if (global.Onboard && Onboard.startGacha) Onboard.startGacha({ from: 'settings' });
                  else view.render();
                } else if (pwd === '关闭抽卡') {
                  Store.setGachaEnabled(false);
                  UI.toast('已关闭抽卡系统，仅保留种树');
                  if (global.App) App.rebuildNav();
                  view.render();
                } else {
                  UI.toast('口令不正确', 'err');
                }
              }
            }, ['执行'])
          ])
        ]);
        root.appendChild(devCard);

            }

      if (SUB === 'about') {
  /* ===================== 说明 ===================== */
        var about = el('div', { class: 'card', style: { padding: '16px 18px' } }, [
          el('div', { class: 'section-title' }, ['使用提示']),
          el('ul', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '2' } }, [
            el('li', { text: '· 在「课程表」点击任意空白格子，就能为该星期、该节次安排一门课。' }),
            el('li', { text: '· 课程可设置单双周与起止周次，适合两周一次的实验课。' }),
            el('li', { text: '· 「日程」把未来 7 天的课程与一次性安排放在一起，按天排列。' }),
          el('li', { text: '· 「日历」用月视图回看过去的记录，也能看到未来的课程与日程。' }),
            el('li', { text: '· 课程可以填学分和考试时间；学分填了会自动进「成绩」，考试会显示在课程表和日程上。' }),
            el('li', { text: '· 「成绩」支持多层占比（总评 → 平时 → 作业/考勤），按学分加权算均分，可分学期查看。' }),
            el('li', { text: '· 绩点换算规则在「成绩与 GPA」里自己填（4.0 / 5.0 制或线性均可），成绩单可导出 CSV 或打印成 PDF。' }),
            el('li', { text: '· 「计划」支持打卡与进度条两种方式，达标后自动完成并奖励积分。' }),
            el('li', { text: '· 奖励机制有「森林」和「抽卡」两种，积分各自独立不通用；切换时不清零、不兑换，已攒的都保留。' }),
            el('li', { text: '· 抽卡按明日方舟标准寻访：600 合成玉单抽、6000 十连，1 积分 = 180 合成玉（单抽约需 3.33 积分）；六星 2%，50 抽后概率递增；每自然天第一个十连保底至少一位五星，其余十连不保底；重复干员提升潜能（0~5），满潜能后多余复制转化为积分。' }),
            el('li', { text: '· 「象限」用 24 小时环形图统计时间去向，可记录睡眠、饮食与活动。' }),
            el('li', { text: '· 记饮食时可以搜食物名（米饭、鸡胸、奶茶…），热量和蛋白质/脂肪/碳水会自动估算，也能手动改。' }),
            el('li', { text: '· 在「设置 → 饮食与热量」里设每日热量目标、三餐配比和营养素目标，记录时会提示这餐还剩多少额度。' }),
          el('li', { text: '· 象限与记账支持「今天 / 一周 / 一月 / 一季」，图表可切饼图或方形图。' }),
            el('li', { text: '· 标签支持二级：写成「学习/高数」，就能按一级或二级分别统计。' }),
            el('li', { text: '· 标签自带图标和颜色：常用标签（学习、生活、运动…）自动配上，也能在「设置 → 标签」里换图标、改颜色、改名。' }),
            el('li', { text: '· 「待办」可关联课程，设置截止日期后，到期会出现在「今日」页。' }),
            el('li', { text: '· 展开一个待办，点「添加子任务」就能把一件事拆成几步；只做一层，父任务上显示 2/4 进度。' }),
            el('li', { text: '· 子任务的默认行为是「各算各的」：子任务全完成不自动完成父任务，勾父任务也不连带子任务；删除父任务时子任务会保留并提升为顶层。这四条都能在「设置 → 子任务」里改。' }),
            el('li', { text: '· 灵感已并入「待办」：切到顶部的「灵感」分页就能随手记，点「转为待办」一键搬过去。' }),
            el('li', { text: '· 每日一句 / 每日一词可以单独关掉（模块显示 → 首页卡片）；喜欢的话点星标收藏，在「收藏的词句」里回看。' }),
            el('li', { text: '· 外观可换 20 套配色或自选颜色，也能传一张图做背景。' }),
            el('li', { text: '· 「每日一词」右上角有「小测验」，看释义拼单词，答错会提示差在哪。' }),
          el('li', { text: '· 「导入课表」会自动跳过「星期几 / 第几节」表头，并把课程名、地点、老师拆开，核对后一键导入。' }),
          el('li', { text: '· 新建待办时点麦克风可以说话输入，会自动拆出日期和时间。' }),
          el('li', { text: '· 设置按分类整理，点「课程时间」可改每天节数与上下课时间。' }),
          el('li', { text: '· 「模块显示」里可以开关模块，也能用上下箭头调整它们在导航里的顺序。' }),
          el('li', { text: '· 手机竖屏用底部导航，横屏自动收到左侧，网页宽屏变成两栏。' }),
            el('li', { text: '· 手机上可把本页「添加到主屏幕」，用起来更接近原生 App；装好后长按图标能直接进「今日课表」「写日记」。' }),
            el('li', { text: '· 每个模块都有自己的地址（#/today、#/tasks/diary 这种），在「设置 → 桌面与快捷」里可以一键复制。' }),
            el('li', { text: '· 「计划」页顶部可以切到「目标」：目标是「想变成什么样」，往下挂 2–4 条关键结果，分别挂计划、挂待办或自己填数字。' }),
            el('li', { text: '· 目标最多同时 5 个，到期不会删除、也不扣分，只是挪进「已归档」；每月最后三天会提示做一次复盘，可以一键写进当天日记。' }),
            el('li', { text: '· 番茄钟关联待办后，那段时间会自动算进待办的「已投入」；象限里手动记活动时也能挂到某条待办上。' }),
            el('li', { text: '· 「日历」页选中某天后，下面有一条 48 格的时间带（半小时一格），睡前点几下就能把一天补录完。' })
          ])
        ]);
        root.appendChild(about);
      }

      /* 成就页已迁移至「收集」视图（collection.js 的「成就」标签页） */

    }
  };

  /* ==========================================================
   * 设置首页：分类入口
   * ========================================================== */
  var SUBS = [
    /* 基础设置 */
    { key: 'periods', name: '课程时间', desc: '每天几节课、上下课时间', icon: V.icons.clock, color: '#4f46e5', group: 'basic' },
    { key: 'semester', name: '学期与周次', desc: '学期名称、开学日期、总周数', icon: V.icons.calendar, color: '#0ea5e9', group: 'basic' },
    { key: 'look', name: '外观', desc: '主题配色、自定义颜色、背景图片', icon: V.icons.palette, color: '#ec4899', group: 'basic' },
    { key: 'tags', name: '标签', desc: '标签图标、颜色与常用标签组合', icon: V.icons.tag, color: '#8b5cf6', group: 'basic' },
    /* 首页与模块 */
    { key: 'nav', name: '模块显示', desc: '选择底部导航里显示哪些模块', icon: V.icons.settings, color: '#7c3aed', group: 'module' },
    { key: 'desktop', name: '桌面与快捷', desc: '安装到主屏幕、直达某个模块', icon: V.icons.home, color: '#0ea5e9', group: 'module' },
    { key: 'rec', name: '记录偏好', desc: '饮食与睡眠记录的开关', icon: V.icons.quadrant, color: '#14b8a6', group: 'module' },
    { key: 'diary', name: '日记', desc: '凌晨归属、心情统计的开关', icon: V.icons.book, color: '#8b5cf6', group: 'module' },
    /* 记录与统计 */
    { key: 'subtask', name: '子任务', desc: '完成与删除时父子任务怎么联动', icon: V.icons.check, color: '#0ea5e9', group: 'record' },
    { key: 'diet', name: '饮食与热量', desc: '每日热量目标、三餐配比、营养素', icon: V.icons.quadrant, color: '#f97316', group: 'record' },
    { key: 'stats', name: '时间统计', desc: '待办统计分页与今日本周记录卡片', icon: V.icons.chart, color: '#10b981', group: 'record' },
    { key: 'gpa', name: '成绩与 GPA', desc: '自定义绩点换算规则、导出成绩单', icon: V.icons.chart, color: '#10b981', group: 'record' },
    { key: 'remind', name: '上课提醒', desc: '页面内提醒与导出 .ics 到系统日历', icon: V.icons.clock, color: '#f59e0b', group: 'record' },
    /* 奖励与目标 */
    { key: 'goals', name: '目标', desc: '月末复盘提示、在办数量上限', icon: V.icons.target, color: '#f59e0b', group: 'award' },
    { key: 'reward', name: '奖励机制', desc: '森林积分与抽卡合成玉，可切换', icon: V.icons.jade, color: '#00a89a', group: 'award' },
    { key: 'fav', name: '收藏的词句', desc: '回看收藏的诗词与单词', icon: V.icons.star, color: '#f59e0b', group: 'award' },
    { key: 'pet', name: '桌宠（开发）', desc: '龙泡泡桌宠 · 开发者自用开关', icon: V.icons.paw, color: '#f59e0b', group: 'award' },
    /* 识别与数据 */
    { key: 'speech', name: '语音识别', desc: '语音输入待办：浏览器原生 / 讯飞', icon: V.icons.mic, color: '#f04438', group: 'sync' },
    { key: 'ocr', name: '图片识别', desc: '拍照/截图导入课表，本地或云端识别', icon: V.icons.camera, color: '#7c3aed', group: 'sync' },
    { key: 'data', name: '数据管理', desc: '同步到别的设备、备份与恢复', icon: V.icons.download, color: '#f59e0b', group: 'sync' },
    /* 帮助 */
    { key: 'guide', name: '新手教程', desc: '重新看一遍每个模块怎么用', icon: V.icons.bookOpen, color: '#0ea5e9', group: 'help' },
    { key: 'about', name: '使用提示', desc: '各模块的细节说明', icon: V.icons.idea, color: '#94a3b8', group: 'help' }
  ];

  /* ===================== 上课提醒 ===================== */
  view.renderRemind = function (root) {
    var o = global.Remind ? Remind.opts() : { on: true, lead: 15, sound: true };
    function save() { Store.save(); }

    function row(label, hint, node) {
      return el('div', {
        class: 'setting-row',
        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }
      }, [
        el('div', { style: { flex: '1' } }, [
          el('b', { style: { fontSize: '13px' }, text: label }),
          el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: hint })
        ]),
        node
      ]);
    }

    /* --- 页面内提醒 --- */
    var inPage = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    inPage.appendChild(el('div', { class: 'section-title' }, ['页面内提醒']));
    inPage.appendChild(el('p', {
      class: 'ocr-hint',
      text: '页面开着、并且是你在看的那个标签页时，上课前会弹一条提示（可选一声轻响）。' +
            '它是「兜底」，不是推送 —— 手机锁屏或切到别的 App 就不会响。'
    }));
    inPage.appendChild(row('开启页面内提醒', '关掉后只在课表页看，不弹提示', el('input', {
      type: 'checkbox', checked: !!o.on,
      onchange: function (e) { o.on = e.target.checked; save(); }
    })));
    inPage.appendChild(row('提前多久', '课表类 App 普遍是课前 15 分钟', el('select', {
      class: 'input', style: { width: '120px' },
      onchange: function (e) { o.lead = +e.target.value; save(); }
    }, [0, 5, 10, 15, 20, 30].map(function (v) {
      return el('option', {
        value: String(v), selected: o.lead === v,
        text: v === 0 ? '上课时刻' : ('提前 ' + v + ' 分钟')
      });
    }))));
    inPage.appendChild(row('提示音', '一声很短的正弦音，不会打断别人', el('input', {
      type: 'checkbox', checked: !!o.sound,
      onchange: function (e) { o.sound = e.target.checked; save(); }
    })));
    if (global.Remind) {
      var today = Remind.todayLessons();
      inPage.appendChild(el('div', {
        class: 'ocr-hint',
        text: today.length
          ? ('今天有 ' + today.length + ' 节课：' + today.map(function (t) {
              return t.period.start + ' ' + t.course.name;
            }).join('、'))
          : '今天没有课。'
      }));
    }
    root.appendChild(inPage);

    /* --- 导出到系统日历 --- */
    var cal = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    cal.appendChild(el('div', { class: 'section-title' }, ['导出到系统日历（推荐）']));
    cal.appendChild(el('p', {
      class: 'ocr-hint',
      text: '生成一个 .ics 文件，双击导入手机或电脑的日历后，提醒就由系统负责 —— ' +
            '锁屏会响、关机也准、不用挂着这个页面，数据也不经过任何服务器。' +
            '课程按周重复导出，单双周会自动拆成隔周重复。'
    }));
    cal.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } }, [
      el('button', {
        class: 'btn btn-primary',
        onclick: function () { if (global.Remind) Remind.exportDialog(); }
      }, [V.svg(V.icons.download, 16), '导出 .ics'])
    ]));
    root.appendChild(cal);

    /* --- 为什么不弹系统通知 --- */
    var why = el('div', { class: 'card', style: { padding: '16px 18px' } });
    why.appendChild(el('div', { class: 'section-title' }, ['为什么不直接弹系统通知']));
    why.appendChild(el('ul', {
      class: 'ocr-hint',
      style: { margin: 0, paddingLeft: '18px', lineHeight: '1.8' }
    }, [
      el('li', { text: '预定未来时刻弹通知的 Notification Triggers，Chrome 已停止开发且从未发布，没有它就只能靠服务器推送。' }),
      el('li', { text: '直接双击打开的单文件是 file:// 协议，不是安全上下文，通知权限根本申请不了。' }),
      el('li', { text: 'iOS Safari 要 16.4 以上、且必须先把页面「添加到主屏幕」才给权限，而后台标签页 5–10 秒就停止执行。' }),
      el('li', { text: '所以定时那部分交给系统日历更可靠，页面内这条只负责「你正看着它」的时候。' })
    ]));
    root.appendChild(why);
  };

  view.renderPet = function (root) {
    window.Pet.ensureStyle();
    var cfg = Store.settings.pet;
    function save() { Store.updateSettings({ pet: Object.assign({}, cfg) }); cfg = Store.settings.pet; }

    /* --- 开发者开关 --- */
    var sw = el('button', {
      class: 'switch' + (cfg.enabled ? ' on' : ''),
      onclick: function () {
        cfg.enabled = !cfg.enabled;
        sw.classList.toggle('cp-on', cfg.enabled);
        save();
        window.Pet.refresh();
      }
    }, [el('i')]);
    root.appendChild(el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'switch-row' }, [
        el('div', { class: 'switch-text' }, [
          el('b', { text: '启用龙泡泡桌宠' }),
          el('span', { text: '默认关闭，仅供个人自用。素材仅存于本机，请勿将含素材的成品对外分发。' })
        ]),
        sw
      ])
    ]));

    /* --- 用法提示 --- */
    root.appendChild(el('div', { class: 'card', style: { padding: '14px 18px', marginBottom: '14px' } }, [
      el('p', { style: { margin: 0, fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' }, text: '本功能不内置任何方舟美术。请自行准备一张「横向等宽排列的龙泡泡行走帧」精灵图（或单张 PNG），在下方上传，会以 base64 保存在本机浏览器。反应帧可放在另一行（可选）。' })
    ]));

    /* --- 素材上传 --- */
    var card = el('div', { class: 'card', style: { padding: '16px 18px' } });
    var fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'block', margin: '6px 0 2px' } });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) { UI.toast('图片过大（>4MB），请压缩后重试'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        cfg.src = reader.result;
        var img = new Image();
        img.onload = function () {
          if (cfg.frameW === 0 && cfg.frameH === 0) {
            cfg.frameH = img.height;
            cfg.frameW = Math.round(img.width / Math.max(1, cfg.frames || 1));
          }
          save();
          syncInputs();
          drawPreview();
          window.Pet.refresh();
        };
        img.src = reader.result;
        UI.toast('已载入素材');
      };
      reader.readAsDataURL(f);
    });
    card.appendChild(el('div', { class: 'section-title', text: '本地精灵图（龙泡泡）' }));
    card.appendChild(fileInput);

    /* --- 帧参数 --- */
    var fields = [
      ['frames', '行走帧数', 3, 1],
      ['fps', '帧率 fps', 8, 1],
      ['scale', '显示缩放', 1, 0.2],
      ['speed', '游走速度 px/s', 70, 1],
      ['rowWalk', '行走帧所在行(0起)', 0, 0],
      ['rowReact', '反应帧行(-1=无)', -1, -1],
      ['reactFrames', '反应帧数', 0, 0]
    ];
    var grid = el('div', { class: 'form-grid', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginTop: '10px' } });
    var inputs = {};
    fields.forEach(function (f) {
      var input = el('input', { type: 'number', step: f[3], value: cfg[f[0]], style: { width: '100%', boxSizing: 'border-box' } });
      input.addEventListener('change', function () {
        var v = parseFloat(input.value);
        cfg[f[0]] = isNaN(v) ? f[2] : v;
        save();
        drawPreview();
        window.Pet.refresh();
      });
      inputs[f[0]] = input;
      grid.appendChild(el('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' } }, [
        el('span', { text: f[1] }), input
      ]));
    });
    function syncInputs() { fields.forEach(function (f) { if (inputs[f[0]]) inputs[f[0]].value = cfg[f[0]]; }); }
    card.appendChild(el('div', { class: 'section-title', style: { marginTop: '16px' }, text: '帧参数' }));
    card.appendChild(grid);

    /* --- 行走预览 --- */
    var preview = el('div', { style: { marginTop: '12px', height: '130px', border: '1px dashed var(--border)', borderRadius: '10px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', background: 'var(--bg-2)' } });
    function drawPreview() {
      preview.innerHTML = '';
      if (!cfg.src || cfg.frameW <= 0 || cfg.frameH <= 0) {
        preview.appendChild(el('span', { style: { color: 'var(--text-2)', fontSize: '13px', alignSelf: 'center', marginBottom: '40px' }, text: '上传精灵图后在此预览行走效果' }));
        return;
      }
      var ds = Math.max(0.2, cfg.scale || 1);
      var w = cfg.frameW * ds, h = cfg.frameH * ds;
      var totalW = cfg.frameW * (cfg.frames || 1) * ds;
      var box = el('div', { style: {
        width: w + 'px', height: h + 'px',
        backgroundImage: 'url(' + cfg.src + ')', backgroundRepeat: 'no-repeat',
        backgroundSize: totalW + 'px ' + h + 'px',
        backgroundPositionY: (-(cfg.rowWalk || 0) * h) + 'px',
        animation: (cfg.frames > 1 ? ('petWalk ' + (cfg.frames / (cfg.fps || 8)) + 's steps(' + cfg.frames + ') infinite') : 'none')
      } });
      box.style.setProperty('--pet-total', totalW + 'px');
      preview.appendChild(box);
    }
    card.appendChild(el('div', { class: 'section-title', style: { marginTop: '16px' }, text: '行走预览' }));
    card.appendChild(preview);
    drawPreview();

    /* --- 清除素材 --- */
    card.appendChild(el('button', {
      class: 'btn btn-sm', style: { marginTop: '16px' },
      onclick: function () {
        cfg.src = '';
        save();
        drawPreview();
        window.Pet.refresh();
        UI.toast('已清除本地素材');
      }
    }, ['清除素材']));

    root.appendChild(card);
  };

  /* ===================== 设置首页：一级分类 ===================== */
  view.home = function () {
    var root = this.root;

    /* ---- 数据概览 ---- */
    var st = {
      courses: Store.courses.length,
      events: Store.events.length,
      plans: Store.plans.length,
      tasks: Store.tasks.length,
      notes: Store.notes.length,
      ledger: Store.ledger.length
    };
    root.appendChild(el('div', { class: 'task-summary' }, [
      V.statCard(st.courses, '课程', 'var(--primary)'),
      V.statCard(st.plans, '计划', 'var(--green)'),
      V.statCard(st.tasks, '待办', 'var(--amber)'),
      V.statCard(st.ledger, '账目', 'var(--text-2)')
    ]));

    /* ---- 分类卡片：点进去再看这一类有哪几项 ---- */
    root.appendChild(el('div', {
      class: 'section-title',
      style: { marginTop: '20px', marginBottom: '8px' }
    }, ['全部设置']));

    var grid = el('div', { class: 'set-cats' });
    CATS.forEach(function (c) {
      var n = SUBS.filter(function (it) { return it.group === c.key; }).length;
      grid.appendChild(el('button', {
        class: 'set-cat',
        onclick: function () { CAT = c.key; SUB = ''; view.render(); }
      }, [
        el('span', { class: 'set-cat-icon', style: { background: c.color } }, [V.svg(c.icon, 19)]),
        el('span', { class: 'set-cat-body' }, [
          el('span', { class: 'set-cat-top' }, [
            el('b', { text: c.name }),
            el('em', { text: n + ' 项' })
          ]),
          el('span', { class: 'set-cat-desc', text: c.desc })
        ]),
        V.svg(V.icons.right, 15)
      ]));
    });
    root.appendChild(grid);

    root.appendChild(el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '12px', lineHeight: '1.7' },
      text: '所有数据只保存在这台设备的浏览器里，不会上传。换设备前记得在「数据管理」里导出一份备份。'
    }));
  };

  /* ===================== 分类页：列出这一类下的条目 ===================== */
  view.catPage = function () {
    var root = this.root;
    var c = catOf(CAT) || { name: '设置', desc: '' };
    var items = SUBS.filter(function (it) { return it.group === CAT; });

    root.appendChild(el('div', { class: 'set-head' }, [
      el('button', {
        class: 'btn btn-sm',
        onclick: function () { CAT = ''; SUB = ''; view.render(); }
      }, [V.svg(V.icons.left, 15), '设置']),
      el('div', { class: 'set-head-title' }, [
        el('b', { text: c.name }),
        el('span', { text: c.desc })
      ])
    ]));

    var list = el('div', { class: 'card', style: { padding: '4px 6px' } });
    items.forEach(function (item) {
      list.appendChild(el('button', {
        class: 'set-item',
        onclick: function () { SUB = item.key; view.render(); }
      }, [
        el('span', { class: 'set-icon', style: { background: item.color } }, [V.svg(item.icon, 18)]),
        el('span', { class: 'set-text' }, [
          el('b', { text: item.name }),
          el('span', { text: item.desc })
        ]),
        V.svg(V.icons.right, 16)
      ]));
    });
    root.appendChild(list);
  };

  function addMinutes(hhmm, mins) {
    var p = (hhmm || '08:00').split(':');
    var total = (+p[0]) * 60 + (+p[1]) + mins;
    total = Math.max(0, Math.min(23 * 60 + 59, total));
    var h = Math.floor(total / 60), m = total % 60;
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }

  function exportData() {
    var text = Store.exportJSON();   // 完整备份（含日记、图片、设置）
    var name = '课表备份-' + DateUtil.toStr(DateUtil.today()) + '.json';
    var sizeKB = Math.max(1, Math.round(new Blob([text]).size / 1024));
    SaveFile.save(name, text, {
      mime: 'application/json',
      ext: 'json',
      panelTitle: '备份已生成',
      panelHint: '备份文件包含日记正文，请存在自己放心的位置。换设备时在「设置 → 数据管理 → 导入备份」选择该文件即可恢复。',
      sizeText: sizeKB + ' KB'
    }).then(function (r) {
      if (r.canceled) { UI.toast('已取消'); return; }
      if (r.method === 'picker') UI.toast('已保存到本地', 'ok');
      else if (r.method === 'share') UI.toast('已发起分享', 'ok');
      // download / copy-fallback：诚实面板已由 SaveFile 弹出
    }).catch(function (e) {
      UI.toast('导出失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(String(reader.result));
          var nc = (obj.courses || []).length;
          var nt = (obj.tasks || []).length;
          V.confirm({
            title: '导入备份',
            message: '将用备份中的 ' + nc + ' 门课程、' + nt + ' 条待办覆盖当前数据。当前数据无法恢复，确定继续吗？',
            danger: true, okText: '覆盖导入'
          }).then(function (ok) {
            if (!ok) return;
            Store.backupNow('导入备份前').then(function () {
              try {
                Store.importJSON(String(reader.result));
                UI.toast('导入成功（已自动备份原数据）');
                App.go('schedule');
              } catch (err) {
                // importJSON 内部失败会整体回滚，原数据原样还在
                UI.toast('导入失败，已保留原数据：' + err.message, 'err');
              }
            });
          });
        } catch (e) {
          UI.toast('文件不是有效的 JSON', 'err');
        }
      };
      reader.readAsText(file, 'utf-8');
    });
    input.click();
  }

  /* ==========================================================
   * 设备间同步：导出一份「不含图片」的 JSON 文件，发到另一台设备恢复
   * （取代旧版 base64 同步码——数据一大要发上百条消息，体验差）
   * ========================================================== */

  /**
   * 两档同步内容的说明。
   * 两档都**不含日记**：日记只走「导出备份 / 恢复」，原因见下方 DIARY_SYNC_TIP。
   * 两档都**不含自定义图片**与**脱敏密钥**：图片 base64 撑大文件、换设备本就要重选图；
   * 密钥属于本机凭据，不随同步文件外传（文件走你自己发，不像纯文本码经过不可控中转）。
   */
  var SYNC_SCOPES = [
    { key: 'lite',     name: '精简', desc: '只带课表：学期、课程、上课时段与节次。不含任务、记账、灵感、成绩，换设备后其它模块是空的。' },
    { key: 'standard', name: '标准', desc: '除日记与自定义图片外的全部内容：课程、待办、计划、记账、灵感、成绩、成就。不含背景图和桌宠素材，换设备后需重新选图。' }
  ];

  /** 「为什么日记不在同步里」的统一说明，两处（生成 / 导入）都显示 */
  var DIARY_SYNC_TIP =
    '日记不随同步走。同步文件要经过聊天工具搬运，中途被谁看到无从控制；' +
    '日记只通过「导出备份」传文件，那个通道是你自己的文件。本机已有的日记不会因为导入同步而丢失。';

  /** 同步文件存盘（移动端长文本复制易截断，发文件最稳）。降级：复制纯 JSON 文本。 */
  function saveSyncFile(json, scopeKey) {
    if (!json) { UI.toast('同步文件还没生成好', 'err'); return; }
    var name = '课表同步-' + DateUtil.toStr(DateUtil.today()) + '-' + scopeKey + '.json';
    SaveFile.save(name, json, {
      mime: 'application/json', ext: 'json',
      panelTitle: '同步文件已生成',
      panelHint: '把这份 .json 直接用微信 / QQ 发给另一台设备，在那台设备「设置 → 数据管理 → 导入同步文件」选文件或粘贴即可恢复。',
      sizeText: (new Blob([json]).size / 1024).toFixed(0) + ' KB'
    }).then(function (r) {
      if (r.canceled) { UI.toast('已取消'); return; }
      if (r.method === 'picker' || r.method === 'share') UI.toast('已保存同步文件', 'ok');
      // download / copy-fallback：诚实面板已由 SaveFile 弹出
    }).catch(function (e) {
      UI.toast('保存失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  /** 复制纯 JSON 文本（弱网 / WebView 下最可靠的降级通道）。 */
  function copyToClipboard(text) {
    SaveFile.copyText(text).then(function (ok) {
      UI.toast(ok ? '已复制，去粘贴到另一台设备' : '复制失败，请长按文本框手动复制', ok ? 'ok' : 'err');
    });
  }

  /** base64 → 字节（仅用于兼容旧版 CP1G/CP1R 同步码解码） */
  /** 同步内容 → 备份 JSON（兼容：纯 JSON 文本 / 旧版 CP1G/CP1R 同步码） */
  function unpackSync(text) {
    var s = String(text || '').trim();
    if (!s) return Promise.reject(new Error('请先选择文件或粘贴同步内容'));
    if (s.charAt(0) === '{') return Promise.resolve(s);   // 直接是 JSON 文本

    var head = s.slice(0, 4), body = s.slice(4);
    var bytes;
    try { bytes = UI.b64ToBytes(body); } catch (e) { return Promise.reject(new Error('同步内容不完整或已损坏')); }
    var txt;
    if (head === 'CP1R') {
      txt = new TextDecoder().decode(bytes);
      try { JSON.parse(txt); } catch (e) { return Promise.reject(new Error('同步内容不完整（复制时被截断），请重新完整复制一遍')); }
      return Promise.resolve(txt);
    }
    if (head === 'CP1G') {
      if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('这台设备不支持解压，请改用「导出备份」传文件'));
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
        .arrayBuffer().then(function (buf) {
          var t = new TextDecoder().decode(buf);
          try { JSON.parse(t); } catch (e) { throw new Error('内容不完整'); }
          return t;
        }).catch(function () {
          return Promise.reject(new Error('同步内容不完整，多半是复制时漏了开头或结尾，请重新完整复制'));
        });
    }
    return Promise.reject(new Error('不是有效的同步内容（应为 JSON 文本，或旧版同步码）'));
  }

  /** 生成并展示同步文件 */
  function syncFileDialog() {
    var scope = 'standard';          // 默认推荐标准档
    var code = '';
    var ta = V.textarea({ class: 'textarea sync-code', rows: 5, readonly: 'readonly' });
    var sizeTip = el('div', { class: 'ocr-hint', text: '' });
    var scopeTip = el('p', { class: 'ocr-hint', text: '' });
    var chipBar = el('div', { class: 'tag-bar' });
    var m = V.modal({
      title: '生成同步文件',
      width: '520px',
      body: [
        el('p', {
          class: 'ocr-hint',
          text: '点「保存同步文件」把 .json 直接发给另一台设备（微信 / QQ 都行，文件比文本长也不怕截断）；' +
                '在那台设备打开「设置 → 数据管理 → 导入同步文件」选文件或粘贴即可恢复。'
        }),
        el('div', { class: 'section-title', text: '带哪些内容' }),
        chipBar,
        scopeTip,
        el('p', { class: 'ocr-hint sync-diary-tip', text: DIARY_SYNC_TIP }),
        ta,
        sizeTip
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn', text: '复制 JSON 文本',
          onclick: function () { if (code) copyToClipboard(code); }
        }),
        el('button', {
          class: 'btn btn-primary', text: '保存同步文件',
          onclick: function () { if (code) saveSyncFile(ta.value, scope); }
        })
      ])
    });

    function renderChips() {
      chipBar.innerHTML = '';
      SYNC_SCOPES.forEach(function (s) {
        var active = s.key === scope;
        var chip = el('button', {
          class: 'tag-chip' + (active ? ' active' : ''),
          text: s.name,
          onclick: function () { if (scope !== s.key) { scope = s.key; renderChips(); refresh(); } }
        });
        chipBar.appendChild(chip);
      });
      var cur = SYNC_SCOPES.filter(function (x) { return x.key === scope; })[0];
      scopeTip.textContent = cur ? cur.desc : '';
    }

    function refresh() {
      sizeTip.textContent = '正在生成…';
      ta.value = '';
      try {
        code = Store.exportJSON(scope);   // 已是标准/精简档：不含图片、不含日记、密钥脱敏
        var kb = (code.length / 1024).toFixed(1);
        ta.value = code;
        sizeTip.textContent = '大小约 ' + kb + ' KB（' + code.length + ' 字符）。数据量大时请用「保存同步文件」，别用复制文本。';
      } catch (e) {
        code = '';
        sizeTip.textContent = '生成失败：' + e.message;
      }
    }

    renderChips();
    refresh();
  }

  /** 导入同步文件：支持选 .json 文件 或 粘贴纯 JSON 文本 */
  function pasteSyncDialog() {
    var ta = V.textarea({
      class: 'textarea sync-code', rows: 5,
      placeholder: '把另一台设备的同步内容粘贴到这里，或点「选择文件」'
    });
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.cssText = 'margin-top:8px;';
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { ta.value = String(reader.result); };
      reader.readAsText(f, 'utf-8');
    });
    var m = V.modal({
      title: '导入同步文件',
      width: '480px',
      autofocus: true,
      body: [
        el('p', {
          class: 'ocr-hint',
          text: '导入会把这份数据整体覆盖到这台设备（课程、待办、记账、计划、灵感、设置都会一起过来）。'
        }),
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } }, [
          el('button', { class: 'btn btn-sm', text: '选择文件', onclick: function () { fileInput.click(); } }),
          fileInput
        ]),
        el('p', { class: 'ocr-hint sync-diary-tip', text: DIARY_SYNC_TIP }),
        ta
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '同步到这台设备',
          onclick: function () { doImportSync(ta.value, m); }
        })
      ])
    });
  }

  function doImportSync(code, m) {
    unpackSync(code).then(function (json) {
      var obj;
      try { obj = JSON.parse(json); } catch (e) { throw new Error('内容不是有效的备份'); }
      var parts = [];
      if ((obj.courses || []).length) parts.push(obj.courses.length + ' 门课程');
      if ((obj.tasks || []).length) parts.push(obj.tasks.length + ' 条待办');
      if ((obj.plans || []).length) parts.push(obj.plans.length + ' 个计划');
      if ((obj.ledger || []).length) parts.push(obj.ledger.length + ' 条账目');
      if ((obj.notes || []).length) parts.push(obj.notes.length + ' 条灵感');
      return V.confirm({
        title: '同步到这台设备',
        message: '将用这份备份' + (parts.length ? '（' + parts.join('、') + '）' : '') +
                 '覆盖当前数据。这台设备上的现有内容会被替换，无法恢复。',
        danger: true, okText: '覆盖同步'
      }).then(function (ok) {
        if (!ok) return;
        Store.backupNow('同步覆盖前').then(function () {
          try {
            Store.importJSON(json);
            m.close();
            UI.toast('同步完成（已自动备份原数据）');
            App.go('schedule');
          } catch (err) {
            // importJSON 内部失败会整体回滚，原数据原样还在
            UI.toast('同步失败，已保留原数据：' + err.message, 'err');
          }
        });
      });
    }).catch(function (e) {
      UI.toast('同步失败：' + e.message, 'err');
    });
  }

  /* ==========================================================
   * 二级页：学期与周次
   * 起止日期可以随便选，保存时自动对齐到整周（开始=周一，结束=周日）
   * ========================================================== */
  function renderSemesterPage(root) {
    /* ---- 所有学期 ---- */
    var listCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    listCard.appendChild(el('div', { class: 'section-title' }, ['所有学期']));
    listCard.appendChild(el('p', {
      style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.7', marginBottom: '10px' },
      text: '点一个学期就切换过去，课程表和成绩都跟着换。旧学期会一直留着，随时能回来补录。'
    }));

    Store.semesters.forEach(function (sem) {
      var isCur = sem.id === Store.currentSemesterId;
      var st = DateUtil.parse(sem.startDate);
      var en = st ? DateUtil.addDays(DateUtil.weekStart(st), (sem.weeks || 20) * 7 - 1) : null;
      var cr = Store.creditsOf(sem.id);
      listCard.appendChild(el('div', {
        class: 'sem-row' + (isCur ? ' is-cur' : ''),
        onclick: function () {
          if (isCur) return;
          Store.switchSemester(sem.id);
          UI.toast('已切换到「' + sem.name + '」');
          view.render();
        }
      }, [
        el('div', { class: 'sem-main' }, [
          el('b', { text: sem.name }),
          el('span', {
            text: (st ? DateUtil.toStr(st).slice(0, 10) + ' – ' + DateUtil.toStr(en).slice(0, 10) : '') +
                  ' · ' + sem.weeks + ' 周 · ' + cr + ' 学分'
          })
        ]),
        isCur ? el('span', { class: 'chip chip-primary', text: '当前' })
              : el('span', { class: 'chip', text: '切换' }),
        Store.semesters.length > 1 ? el('button', {
          class: 'icon-btn', title: '删除这个学期',
          onclick: function (ev) {
            ev.stopPropagation();
            var n = Store.courses.filter(function (c) { return c.semesterId === sem.id; }).length;
            V.confirm({
              title: '删除学期',
              message: '会同时删掉「' + sem.name + '」里的 ' + n + ' 门课程和它们的成绩，无法恢复。',
              danger: true, okText: '删除'
            }).then(function (ok) {
              if (!ok) return;
              Store.removeSemester(sem.id);
              UI.toast('已删除学期');
              view.render();
            });
          }
        }, [V.svg(V.icons.trash, 15)]) : null
      ]));
    });

    listCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: function () { addSemesterDialog(); }
      }, [V.svg(V.icons.plus, 15), '新建学期'])
    ]));
    root.appendChild(listCard);

    /* ---- 当前学期的起止日期 ---- */
    var cur = Store.semester;
    var fName = V.input({ value: cur.name, placeholder: '例如：2026–2027 学年 秋季学期' });
    var d0 = DateUtil.parse(cur.startDate) || DateUtil.today();
    var m0 = DateUtil.weekStart(d0);
    var fStart = V.input({ type: 'date', value: DateUtil.toStr(m0) });
    var fEnd = V.input({
      type: 'date',
      value: DateUtil.toStr(DateUtil.addDays(m0, (cur.weeks || 20) * 7 - 1))
    });
    var preview = el('div', { class: 'preview-box', id: 'semPreview' });

    /** 起止日期 → 对齐后的整周区间 */
    function align() {
      var a = DateUtil.parse(fStart.value);
      var b = DateUtil.parse(fEnd.value);
      if (!a || !b) return null;
      var monday = DateUtil.weekStart(a);
      var sunday = DateUtil.weekEnd(b);
      var days = DateUtil.diffDays(sunday, monday) + 1;
      return {
        monday: monday, sunday: sunday,
        weeks: Math.max(1, Math.round(days / 7)),
        moved: (monday.getTime() !== a.getTime()) || (sunday.getTime() !== b.getTime())
      };
    }

    function refreshPreview() {
      var a = align();
      if (!a) { preview.textContent = '请选择开始和结束日期'; return; }
      preview.innerHTML = '对齐后：<b>' + DateUtil.toStr(a.monday) + '（周一）</b> 至 <b>' +
        DateUtil.toStr(a.sunday) + '（周日）</b>，共 <b>' + a.weeks + '</b> 周' +
        (a.moved ? '<span class="cp-pv-note">已自动对齐到整周</span>' : '');
    }

    var semesterCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, ['当前学期']),
      V.field('学期名称', fName),
      el('div', { class: 'field-row' }, [
        V.field('开始日期', fStart),
        V.field('结束日期', fEnd)
      ]),
      preview,
      el('div', { class: 'ocr-hint',
        text: '随便选哪一天都行：开始日会自动退回所在周的周一，结束日会延伸到所在周的周日，周数按整周算。' }),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            var a = align();
            if (!a) { UI.toast('请选择开始和结束日期', 'err'); return; }
            Store.updateSemester({
              name: fName.value.trim() || '我的学期',
              startDate: DateUtil.toStr(a.monday),
              weeks: a.weeks
            });
            UI.toast(a.moved ? '已保存，起止日期已对齐到整周' : '学期设置已保存');
            view.render();
          }
        }, ['保存学期设置']),
        el('button', {
          class: 'btn',
          onclick: function () {
            var w = Store.currentWeek();
            UI.toast(w >= 1 && w <= Store.semester.weeks
              ? ('今天是第 ' + w + ' 周')
              : '今天不在学期范围内');
            view.render();
          }
        }, ['检查当前周次'])
      ])
    ]);
    root.appendChild(semesterCard);

    refreshPreview();
    fStart.addEventListener('change', refreshPreview);
    fEnd.addEventListener('change', refreshPreview);
  }

  /* ---- 新建学期：同样填起止日期，自动对齐整周 ---- */
  function addSemesterDialog() {
    var cur = Store.semester;
    var curStart = DateUtil.parse(cur.startDate);
    var nextStart = curStart
      ? DateUtil.weekStart(DateUtil.addDays(curStart, (cur.weeks || 20) * 7 + 7))
      : DateUtil.weekStart(DateUtil.today());
    var fName = V.input({ value: cur.name.replace(/秋/g, '春'), dataset: { autofocus: '1' } });
    var fStart = V.input({ type: 'date', value: DateUtil.toStr(nextStart) });
    var fEnd = V.input({
      type: 'date',
      value: DateUtil.toStr(DateUtil.addDays(nextStart, (cur.weeks || 20) * 7 - 1))
    });
    var preview = el('div', { class: 'preview-box' });

    function align() {
      var a = DateUtil.parse(fStart.value), b = DateUtil.parse(fEnd.value);
      if (!a || !b) return null;
      var monday = DateUtil.weekStart(a);
      var sunday = DateUtil.weekEnd(b);
      var days = DateUtil.diffDays(sunday, monday) + 1;
      return { monday: monday, sunday: sunday, weeks: Math.max(1, Math.round(days / 7)) };
    }

    function refreshPreview() {
      var a = align();
      if (!a) { preview.textContent = '请选择开始和结束日期'; return; }
      preview.innerHTML = '对齐后：<b>' + DateUtil.toStr(a.monday) + '（周一）</b> 至 <b>' +
        DateUtil.toStr(a.sunday) + '（周日）</b>，共 <b>' + a.weeks + '</b> 周' +
        ((a.monday.getTime() !== DateUtil.parse(fStart.value).getTime() ||
          a.sunday.getTime() !== DateUtil.parse(fEnd.value).getTime())
          ? '<span class="cp-pv-note">已自动对齐到整周</span>' : '');
    }

    var mm = V.modal({
      title: '新建学期',
      width: '460px',
      autofocus: true,
      body: [
        V.field('学期名称', fName),
        el('div', { class: 'field-row' }, [
          V.field('开始日期', fStart),
          V.field('结束日期', fEnd)
        ]),
        preview,
        el('div', { class: 'ocr-hint',
          text: '不用挑周一：选任意一天都会自动对齐到整周。新建后自动切换过去，原来的学期和成绩都还在。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { mm.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '创建并切换',
          onclick: function () {
            var d1 = DateUtil.parse(fStart.value), d2 = DateUtil.parse(fEnd.value);
            if (!d1) { UI.toast('请选择开始日期', 'err'); return; }
            if (!d2) { UI.toast('请选择结束日期', 'err'); return; }
            if (DateUtil.diffDays(d2, d1) < 0) { UI.toast('结束日期不能早于开始日期', 'err'); return; }
            var a = align();
            Store.addSemester({
              name: fName.value.trim() || '新学期',
              startDate: DateUtil.toStr(a.monday),
              weeks: a.weeks
            });
            mm.close();
            UI.toast('已创建并切换');
            view.render();
          }
        })
      ])
    });

    refreshPreview();
    fStart.addEventListener('change', refreshPreview);
    fEnd.addEventListener('change', refreshPreview);
  }

  /* ==========================================================
   * 二级页：成绩与 GPA
   * 1) 自定义绩点换算规则
   * 2) 成绩单导出（CSV / 打印 PDF）
   * ========================================================== */
  function renderGpaPage(root) {
    var esc = (global.Transcript && Transcript.esc) || function (s) {
      return String(s == null ? '' : s);
    };
    var fmt = (global.Transcript && Transcript.fmt) || function (v, d) {
      if (v == null || v === '' || isNaN(v)) return '—';
      var p = Math.pow(10, d || 0);
      return String(Math.round(Number(v) * p) / p);
    };

    var cfg = Store.gpaConfig();
    var draft = {
      scale: Number(cfg.scale) || 4,
      linear: !!cfg.linear,
      rules: cfg.rules.map(function (r) {
        return { min: Number(r.min) || 0, gp: Number(r.gp) || 0 };
      })
    };
    if (!draft.rules.length) draft.rules = [{ min: 60, gp: draft.scale }];

    var tableBox = el('div', { class: 'gpa-table' });
    var sampleBox = el('div', { class: 'preview-box' });

    function sorted() {
      return draft.rules.slice().sort(function (a, b) { return b.min - a.min; });
    }

    /** 用草稿规则试算绩点（不落库） */
    function gpOf(score) {
      if (draft.linear) return Math.round(score / 100 * draft.scale * 100) / 100;
      var sr = sorted();
      for (var i = 0; i < sr.length; i++) {
        if (score >= sr[i].min) return sr[i].gp;
      }
      return sr.length ? sr[sr.length - 1].gp : 0;
    }

    function refreshSample() {
      if (draft.linear) {
        sampleBox.innerHTML = '<div class="cp-pv-line">线性换算：绩点 = 分数 ÷ 100 × <b>' +
          fmt(draft.scale, 1) + '</b>　例如 88 分 → <b>' + fmt(88 / 100 * draft.scale, 2) + '</b></div>';
        return;
      }
      if (!draft.rules.length) {
        sampleBox.textContent = '至少保留一档，否则没法换算绩点';
        return;
      }
      var samples = [95, 90, 86, 82, 78, 74, 71, 66, 63, 55];
      var parts = samples.map(function (s) {
        return s + ' → ' + Number(gpOf(s)).toFixed(2);
      });
      sampleBox.innerHTML = '<div class="cp-pv-line">试算（分数 → 绩点）：' + parts.join('　') + '</div>';
    }

    function drawRules() {
      tableBox.innerHTML = '';
      var list = sorted();
      list.forEach(function (item) {
        var minInp = V.input({
          type: 'number', min: '0', max: '100', step: '1',
          value: item.min, class: 'input gp-min'
        });
        minInp.addEventListener('input', function () {
          item.min = Math.max(0, Math.min(100, parseFloat(minInp.value) || 0));
          refreshSample();
        });

        var gpInp = V.input({
          type: 'number', min: '0', max: '100', step: '0.1',
          value: item.gp, class: 'input gp-gp'
        });
        gpInp.addEventListener('input', function () {
          item.gp = Math.max(0, Math.min(100, parseFloat(gpInp.value) || 0));
          refreshSample();
        });

        tableBox.appendChild(el('div', { class: 'gp-row' }, [
          el('span', { class: 'gp-lb', text: '分数 ≥' }),
          minInp,
          el('span', { class: 'gp-lb', text: '→ 绩点' }),
          gpInp,
          el('button', {
            class: 'icon-btn', title: '删除这一档',
            onclick: function () {
              draft.rules = draft.rules.filter(function (x) { return x !== item; });
              drawRules();
              refreshSample();
            }
          }, [V.svg(V.icons.trash, 15)])
        ]));
      });
      if (!list.length) {
        tableBox.appendChild(el('div', { class: 'q-empty', text: '没有规则了，点下面「添加一档」' }));
      }
    }

    var fScale = V.input({
      type: 'number', min: '1', max: '10', step: '0.5',
      value: String(draft.scale), class: 'input'
    });
    fScale.addEventListener('input', function () {
      draft.scale = Math.max(1, Math.min(10, parseFloat(fScale.value) || 4));
      refreshSample();
    });

    var fMode = V.segment(
      [{ value: 'step', label: '分段换算' }, { value: 'linear', label: '线性换算' }],
      draft.linear ? 'linear' : 'step',
      function (v) {
        draft.linear = (v === 'linear');
        var want = draft.linear ? '线性换算' : '分段换算';
        V.$$('button', fMode).forEach(function (b) {
          b.classList.toggle('cp-active', b.textContent === want);
        });
        drawRules();
        refreshSample();
      }
    );

    /* ---- 卡片：换算规则 ---- */
    var ruleCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, ['GPA 换算规则']),
      el('p', {
        class: 'ocr-hint', style: { marginBottom: '10px' },
        text: '决定「考试分数」怎么折成「绩点」。每所学校算法不同，按自己的规则改就行；改完所有学期的 GPA 会按新规则立刻重算。'
      }),
      V.field('换算方式', fMode),
      V.field('满分绩点', fScale, '4.0 制填 4，5.0 制填 5'),
      el('div', { class: 'sub-title', style: { marginTop: '14px' }, text: '分段规则（从高到低）' }),
      tableBox,
      el('button', {
        class: 'btn btn-sm', style: { marginTop: '8px' },
        onclick: function () {
          var low = 60;
          sorted().forEach(function (r) { if (r.min < low) low = r.min; });
          draft.rules.push({ min: Math.max(0, low - 5), gp: 0 });
          drawRules();
          refreshSample();
        }
      }, [V.svg(V.icons.plus, 14), '添加一档']),
      sampleBox,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            var clean = draft.rules
              .map(function (r) {
                return { min: Math.max(0, Math.min(100, Number(r.min) || 0)),
                         gp: Math.max(0, Math.min(100, Number(r.gp) || 0)) };
              })
              .sort(function (a, b) { return b.min - a.min; });
            if (!clean.length) clean = Store.defaultGpaRules();
            Store.setGpaConfig({ scale: draft.scale, linear: draft.linear, rules: clean });
            UI.toast('GPA 规则已保存');
            view.render();
          }
        }, ['保存规则']),
        el('button', {
          class: 'btn',
          onclick: function () {
            applyPreset(0);
          }
        }, ['恢复默认'])
      ])
    ]);
    root.appendChild(ruleCard);

    /* ---- 卡片：常用方案 ---- */
    var presetCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    presetCard.appendChild(el('div', { class: 'section-title' }, ['常用方案']));
    presetCard.appendChild(el('p', {
      class: 'ocr-hint', style: { marginBottom: '10px' },
      text: '挑一个靠近学校规则的方案，再在上面微调，最后点保存。'
    }));
    var presetGrid = el('div', { class: 'pg-grid' });
    Store.GPA_PRESETS.forEach(function (pr, idx) {
      presetGrid.appendChild(el('button', {
        class: 'pg-item', type: 'button',
        onclick: function () { applyPreset(idx); }
      }, [
        el('span', { class: 'tr-icon', style: { '--tc': '#10b981' } }, [V.svg(V.icons.chart, 15)]),
        el('span', { class: 'pg-name', text: pr.name })
      ]));
    });
    presetCard.appendChild(presetGrid);
    root.appendChild(presetCard);

    /* ---- 卡片：成绩单导出 ---- */
    var scope = 'current';
    var scopeBox = el('div', { class: 'pg-bar' });
    var expPreview = el('div', { class: 'preview-box' });

    var scopeOpts = [{ key: 'current', name: '当前学期' }];
    Store.semesters.forEach(function (sm) { scopeOpts.push({ key: sm.id, name: sm.name }); });
    scopeOpts.push({ key: 'all', name: '全部' });

    function drawScope() {
      scopeBox.innerHTML = '';
      scopeOpts.forEach(function (o) {
        scopeBox.appendChild(el('button', {
          class: 'pg-tab' + (scope === o.key ? ' active' : ''),
          text: o.name, type: 'button',
          onclick: function () { scope = o.key; drawScope(); drawExpPreview(); }
        }));
      });
    }

    function drawExpPreview() {
      if (!global.Transcript) { expPreview.textContent = '正在准备…'; return; }
      var t = Transcript.build(scopeIdsOf(scope));
      var txt = '共 <b>' + t.summary.count + '</b> 门 · <b>' + fmt(t.summary.credits, 1) + '</b> 学分';
      if (t.summary.gpa != null) txt += ' · GPA <b>' + fmt(t.summary.gpa, 2) + '</b>';
      expPreview.innerHTML = '<div class="cp-pv-line">' + txt + '</div>';
    }

    var expCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, ['成绩单导出']),
      el('p', {
        class: 'ocr-hint', style: { marginBottom: '10px' },
      text: 'CSV 可以用 Excel、数字表格直接打开；打印会在新窗口打开排版好的成绩单，可直接存成 PDF。'
      }),
      scopeBox,
      expPreview,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn',
          onclick: function () {
            Transcript.downloadCsv(scopeIdsOf(scope), scopeNameOf(scope));
            UI.toast('已导出 CSV');
          }
        }, [V.svg(V.icons.download, 16), '导出 CSV']),
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            Transcript.print(scopeIdsOf(scope), scopeNameOf(scope));
          }
        }, [V.svg(V.icons.download, 16), '打印 / 存 PDF'])
      ])
    ]);
    root.appendChild(expCard);

    function applyPreset(idx) {
      var pr = Store.GPA_PRESETS[idx];
      if (!pr) return;
      draft.linear = !!pr.linear;
      draft.scale = pr.scale || 4;
      var rs = pr.rules || Store.defaultGpaRules();
      draft.rules = rs.map(function (r) { return { min: r.min, gp: r.gp }; });
      fScale.value = String(draft.scale);
      var want = draft.linear ? '线性换算' : '分段换算';
      V.$$('button', fMode).forEach(function (b) {
        b.classList.toggle('cp-active', b.textContent === want);
      });
      drawRules();
      refreshSample();
      UI.toast('已套用「' + pr.name + '」，确认后点保存');
    }

    drawRules();
    refreshSample();
    drawScope();
    drawExpPreview();

    function scopeIdsOf(sc) {
      if (sc === 'all') return Store.semesters.map(function (sm) { return sm.id; });
      if (sc === 'current') return [Store.currentSemesterId];
      return [sc];
    }

    /** 导出时用真实学期名，别写成「当前学期」 */
    function scopeNameOf(sc) {
      if (sc === 'all') return '全部学期';
      var id = (sc === 'current') ? Store.currentSemesterId : sc;
      var sm = Store.semesterById(id);
      return sm ? sm.name : '当前学期';
    }
  }

  /* ==========================================================
   * 二级页：收藏的词句
   * ========================================================== */
  function renderFavPage(root) {
    var poems = Store.favPoems();
    var words = Store.favWords();

    /* ---- 诗词 ---- */
    var pCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    pCard.appendChild(el('div', { class: 'section-title' }, [
      '收藏的诗词',
      el('span', {
        style: { marginLeft: 'auto', fontSize: '11.5px', color: 'var(--text-3)', fontWeight: '400' },
        text: poems.length + ' 篇'
      })
    ]));

    if (!poems.length) {
      pCard.appendChild(el('p', { class: 'ocr-hint', style: { marginBottom: '0' },
        text: '还没有收藏。在「今日」页点「每日一句」卡片右上角的星标，或在诗词详情里点「收藏」。' }));
    } else {
      poems.forEach(function (x) {
        var p = x.item;
        var src = (p.d ? p.d + ' · ' : '') + p.a +
          (String(p.a).indexOf('《') === 0 ? '' : '《' + p.t + '》');
        pCard.appendChild(el('div', {
          class: 'fav-row',
          onclick: function () {
            if (global.DailyCards) DailyCards.openPoem(x.idx);
          }
        }, [
          el('span', { class: 'fv-quote', text: '“' }),
          el('div', { class: 'fav-main' }, [
            el('b', { text: p.ex }),
            el('span', { text: src })
          ]),
          el('button', {
            class: 'icon-btn', title: '取消收藏',
            onclick: function (e) {
              e.stopPropagation();
              Store.toggleFavPoem(x.idx);
              UI.toast('已取消收藏');
              view.render();
            }
          }, [V.svg(V.icons.trash, 15)])
        ]));
      });
    }
    root.appendChild(pCard);

    /* ---- 单词 ---- */
    var wCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    wCard.appendChild(el('div', { class: 'section-title' }, [
      '收藏的单词',
      el('span', {
        style: { marginLeft: 'auto', fontSize: '11.5px', color: 'var(--text-3)', fontWeight: '400' },
        text: words.length + ' 词'
      })
    ]));

    if (!words.length) {
      wCard.appendChild(el('p', { class: 'ocr-hint', style: { marginBottom: '0' },
        text: '还没有收藏。在「每日一词」卡片上点星标，或在单词详情里点「收藏」。' }));
    } else {
      words.forEach(function (x) {
        var w = x.item;
        wCard.appendChild(el('div', {
          class: 'fav-row',
          onclick: function () {
            if (x.idx >= 0 && global.DailyCards) DailyCards.openWord(x.idx);
          }
        }, [
          el('div', { class: 'fav-main' }, [
            el('b', { text: w.w + (w.ph ? '  ' + w.ph : '') }),
            el('span', { text: w.def || '（没有更多释义）' })
          ]),
          el('button', {
            class: 'icon-btn', title: '取消收藏',
            onclick: function (e) {
              e.stopPropagation();
              Store.toggleFavWord(w.w);
              UI.toast('已取消收藏');
              view.render();
            }
          }, [V.svg(V.icons.trash, 15)])
        ]));
      });

      wCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            var first = Store.favWords()[0];
            if (first && first.idx >= 0 && global.DailyCards) DailyCards.openQuiz(first.item);
            else UI.toast('没有可以测验的收藏词', 'err');
          }
        }, ['考考我（第一个收藏词）'])
      ]));
    }
    root.appendChild(wCard);

    /* ---- 回到卡片开关 ---- */
    root.appendChild(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
      el('button', {
        class: 'btn btn-sm',
        onclick: function () { SUB = 'nav'; view.render(); }
      }, ['首页卡片的显示开关 →'])
    ]));
  }

  /* ==========================================================
   * 二级页：饮食与热量
   * 每日目标 kcal、三餐配比、三大营养素目标
   * ========================================================== */
  function renderDietPage(root) {
    var d = Store.dietConfig();
    var pf = d.profile || {};

    var fGoal = V.input({
      type: 'number', min: '0', step: '50',
      value: d.goal ? String(d.goal) : '', placeholder: '例如 1800',
      class: 'input'
    });

    var ratioInputs = {};
    var ratioBox = el('div', { class: 'diet-ratio' });
    [
      { k: 'breakfast', l: '早餐' },
      { k: 'lunch', l: '午餐' },
      { k: 'dinner', l: '晚餐' },
      { k: 'snack', l: '加餐' }
    ].forEach(function (t) {
      var inp = V.input({
        type: 'number', min: '0', max: '100', step: '5',
        value: String(d.ratio[t.k] == null ? 0 : d.ratio[t.k]),
        class: 'input'
      });
      ratioInputs[t.k] = inp;
      ratioBox.appendChild(el('div', { class: 'dr-item' }, [
        el('span', { class: 'dr-label', text: t.l }),
        inp,
        el('i', { text: '%' })
      ]));
    });

    var ratioHint = el('div', { class: 'ocr-hint' });
    function drawRatioHint() {
      var sum = 0;
      Object.keys(ratioInputs).forEach(function (k) {
        sum += parseFloat(ratioInputs[k].value) || 0;
      });
      var goal = parseFloat(fGoal.value) || 0;
      var ok = Math.abs(sum - 100) < 0.5;
      ratioHint.innerHTML = '合计 <b>' + Math.round(sum) + '%</b>' +
        (ok ? '' : '<span class="cp-pv-note">不是 100%，配额会按比例算</span>') +
        (goal ? '　·　早餐 <b>' + Math.round(goal * (parseFloat(ratioInputs.breakfast.value) || 0) / 100) +
          '</b> / 午餐 <b>' + Math.round(goal * (parseFloat(ratioInputs.lunch.value) || 0) / 100) +
          '</b> / 晚餐 <b>' + Math.round(goal * (parseFloat(ratioInputs.dinner.value) || 0) / 100) +
          '</b> / 加餐 <b>' + Math.round(goal * (parseFloat(ratioInputs.snack.value) || 0) / 100) + '</b> 千卡' : '');
    }
    Object.keys(ratioInputs).forEach(function (k) {
      ratioInputs[k].addEventListener('input', drawRatioHint);
    });
    fGoal.addEventListener('input', drawRatioHint);

    /* ---- 个人资料（估算用） ---- */
    var fSex = V.select([
      { value: 'female', label: '女' }, { value: 'male', label: '男' }
    ], pf.sex || 'female');
    var fAge = V.input({ type: 'number', min: '10', max: '90', value: pf.age || '', placeholder: '20', class: 'input' });
    var fH = V.input({ type: 'number', min: '120', max: '220', value: pf.height || '', placeholder: '165', class: 'input' });
    var fW = V.input({ type: 'number', min: '30', max: '200', step: '0.5', value: pf.weight || '', placeholder: '55', class: 'input' });
    var fAct = V.select([
      { value: '1.2', label: '久坐（几乎不动）' },
      { value: '1.375', label: '轻度（每周 1-3 次运动）' },
      { value: '1.55', label: '中度（每周 3-5 次）' },
      { value: '1.725', label: '高强度（每周 6-7 次）' }
    ], pf.activity || '1.375');

    var estBox = el('div', { class: 'preview-box' });
    function drawEst() {
      Store.setDiet({
        profile: {
          sex: fSex.value, age: fAge.value, height: fH.value,
          weight: fW.value, activity: fAct.value
        }
      });
      var r = Store.estimateTDEE();
      estBox.innerHTML = r
        ? ('基础代谢 <b>' + r.bmr + '</b> 千卡　×　活动系数 → 每日消耗约 <b>' + r.tdee + '</b> 千卡' +
           '<div class="cp-pv-note">减脂一般在这个数上减 300～500，增肌加 200～300</div>')
        : '填全年龄、身高、体重就能估算';
    }
    [fSex, fAge, fH, fW, fAct].forEach(function (x) {
      x.addEventListener('change', drawEst);
      x.addEventListener('input', drawEst);
    });

    /* ---- 营养素 ---- */
    var fP = V.input({ type: 'number', min: '0', value: d.protein || '', placeholder: '自动', class: 'input' });
    var fF = V.input({ type: 'number', min: '0', value: d.fat || '', placeholder: '自动', class: 'input' });
    var fC = V.input({ type: 'number', min: '0', value: d.carb || '', placeholder: '自动', class: 'input' });

    function saveAll() {
      Store.setDiet({
        goal: parseFloat(fGoal.value) || 0,
        ratio: {
          breakfast: parseFloat(ratioInputs.breakfast.value) || 0,
          lunch: parseFloat(ratioInputs.lunch.value) || 0,
          dinner: parseFloat(ratioInputs.dinner.value) || 0,
          snack: parseFloat(ratioInputs.snack.value) || 0
        },
        protein: parseFloat(fP.value) || 0,
        fat: parseFloat(fF.value) || 0,
        carb: parseFloat(fC.value) || 0
      });
      UI.toast('已保存');
      view.render();
    }

    var goalCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, ['每日热量目标']),
      el('p', {
        class: 'ocr-hint', style: { marginBottom: '10px' },
        text: '设一个每天想吃到多少千卡。有了目标，记录饮食时会提示这一餐还剩多少额度，超过会标红。填 0 就是只用记录、不设目标。'
      }),
      V.field('每日目标（千卡）', fGoal),
      el('div', { class: 'sub-title', style: { marginTop: '12px' }, text: '三餐配比' }),
      ratioBox,
      ratioHint,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            ratioInputs.breakfast.value = '30';
            ratioInputs.lunch.value = '40';
            ratioInputs.dinner.value = '30';
            ratioInputs.snack.value = '0';
            drawRatioHint();
          }
        }, ['恢复 30/40/30']),
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            ratioInputs.breakfast.value = '25';
            ratioInputs.lunch.value = '35';
            ratioInputs.dinner.value = '30';
            ratioInputs.snack.value = '10';
            drawRatioHint();
          }
        }, ['留出加餐 25/35/30/10'])
      ])
    ]);
    root.appendChild(goalCard);

    var estCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, ['用个人资料估算']),
      el('p', {
        class: 'ocr-hint', style: { marginBottom: '10px' },
        text: '不知道该定多少就先估一下。这是公式估算值，只作参考，不能替代专业建议。'
      }),
      el('div', { class: 'field-row' }, [
        V.field('性别', fSex),
        V.field('年龄', fAge)
      ]),
      el('div', { class: 'field-row' }, [
        V.field('身高（cm）', fH),
        V.field('体重（kg）', fW)
      ]),
      V.field('活动量', fAct),
      estBox,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: function () {
            var r = Store.estimateTDEE();
            if (!r) { UI.toast('先填全年龄、身高、体重', 'err'); return; }
            fGoal.value = String(r.tdee);
            drawRatioHint();
            UI.toast('已填为 ' + r.tdee + ' 千卡，记得保存');
          }
        }, ['用这个数当目标']),
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            var r = Store.estimateTDEE();
            if (!r) { UI.toast('先填全资料', 'err'); return; }
            fGoal.value = String(Math.round((r.tdee - 400) / 50) * 50);
            drawRatioHint();
            UI.toast('已填为减脂档 ' + fGoal.value + ' 千卡');
          }
        }, ['减脂档（−400）'])
      ])
    ]);
    root.appendChild(estCard);

    var macroCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } }, [
      el('div', { class: 'section-title' }, ['三大营养素目标（克）']),
      el('p', {
        class: 'ocr-hint', style: { marginBottom: '10px' },
        text: '选填。填了之后，一天吃够不够蛋白、脂肪是不是偏高，一眼能看到。留空就只统计、不设目标。'
      }),
      el('div', { class: 'field-row' }, [
        V.field('蛋白质（g）', fP),
        V.field('脂肪（g）', fF),
        V.field('碳水（g）', fC)
      ]),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            var goal = parseFloat(fGoal.value) || 0;
            if (!goal) { UI.toast('先填每日目标', 'err'); return; }
            fP.value = String(Math.round(goal * 0.2 / 4));
            fF.value = String(Math.round(goal * 0.3 / 9));
            fC.value = String(Math.round(goal * 0.5 / 4));
            UI.toast('按 20% / 30% / 50% 算好了，记得保存');
          }
        }, ['按 20/30/50 自动算']),
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            var w = parseFloat(fW.value) || 0;
            if (!w) { UI.toast('先填体重', 'err'); return; }
            fP.value = String(Math.round(w * 1.6));
            UI.toast('按体重 ×1.6 g 填好了');
          }
        }, ['蛋白按体重 ×1.6g'])
      ]),
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } }, [
        el('button', { class: 'btn btn-primary', onclick: saveAll }, ['保存'])
      ])
    ]);
    root.appendChild(macroCard);

    drawRatioHint();
    drawEst();
  }

  /* ==========================================================
   * 二级页：子任务行为
   * 前三项互相影响（能形成「勾了 A 就等于勾了 B」的闭环），
   * 所以每一项都写明「当前组合下会发生什么」，并对冲突组合给出警告。
   * ========================================================== */
  function renderSubtaskPage(root) {
    var cur = Store.subtaskOpts();

    function save(patch) {
      Store.updateSettings({ subtask: Object.assign({}, Store.subtaskOpts(), patch) });
      view.render();
    }

    /* ---- 说明 ---- */
    var intro = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    intro.appendChild(el('div', { class: 'section-title' }, ['子任务怎么用']));
    intro.appendChild(el('ul', {
      style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.9', margin: '0', paddingLeft: '18px' }
    }, [
      el('li', { text: '在「待办」里展开一个父任务，点最下面的「添加子任务」，就能把一件事拆成几步。' }),
      el('li', { text: '子任务默认折叠，父任务右边显示 2/4 的进度徽章。' }),
      el('li', { text: '只支持一层：子任务下面不能再挂子任务。想再细，说明这件事该拆成两个父任务。' }),
      el('li', { text: '「今日」、四象限、导航角标只算顶层任务，不会因为拆了子任务就把数字放大。' })
    ]));
    root.appendChild(intro);

    /* ---- 逐项开关 ---- */
    var card = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, ['行为设置']));

    function row(label, hint, key, onText, offText) {
      var node = el('button', {
        class: 'switch' + (cur[key] ? ' on' : ''),
        title: cur[key] ? '点击关闭' : '点击开启',
        onclick: function () {
          var patch = {};
          patch[key] = !cur[key];
          save(patch);
        }
      }, [el('i')]);
      // 开关和文字之间不要拉太开：限一个宽度，右侧留白比中间开洞好看
      return el('div', { class: 'subtask-set-row' }, [
        el('div', { class: 'subtask-set-text' }, [
          el('b', { text: label }),
          el('span', { class: 'subtask-set-hint', text: hint }),
          el('span', {
            class: 'subtask-state' + (cur[key] ? ' is-on' : ''),
            text: '当前：' + (cur[key] ? onText : offText)
          })
        ]),
        node
      ]);
    }

    card.appendChild(row(
      '子任务全部完成时，自动完成父任务',
      '关掉的话父任务要自己点完成，只靠 2/4 的徽章看进度。',
      'autoDoneParent', '子任务勾完 → 父任务自动变成已完成', '父任务保持未完成，只更新进度'
    ));
    card.appendChild(row(
      '父任务完成时，把未完成的子任务一并完成',
      '适合「父任务只是个分组」的用法；如果你会先完成任务条目、再回头补细节，建议关掉。',
      'cascadeDone', '勾父任务 → 子任务全部被勾上', '子任务保持原样，不会被改动'
    ));
    card.appendChild(row(
      '删除父任务时保留子任务',
      '开启 = 子任务留下来、提升为顶层待办；关闭 = 连子任务一起删掉。删除前都会再确认一次。',
      'orphanKeep', '子任务保留并提升为顶层', '子任务随父任务一起删除'
    ));
    card.appendChild(row(
      '父任务上显示 2/4 进度徽章',
      '关掉后父任务行更清爽，但看不出还有几步没做。',
      'showProgress', '显示进度徽章', '不显示徽章'
    ));
    root.appendChild(card);

    /* ---- 组合影响提示 ---- */
    var warn = [];
    if (cur.autoDoneParent && cur.cascadeDone) {
      warn.push('「自动完成父任务」和「一并完成子任务」同时开着：勾完最后一个子任务，父任务会被自动勾上，' +
                '父任务一勾又反过来把其余子任务全勾上——实际上只要完成任意一个子任务，整组就会全绿。' +
                '如果你不想要这个效果，关掉其中一项。');
    }
    if (!cur.autoDoneParent && cur.cascadeDone) {
      warn.push('当前是「父完成任务时子任务一并完成，但子任务全完成不会自动完成父任务」：' +
                '方向是单向的，从子任务往上不会触发任何联动。');
    }
    if (cur.autoDoneParent && !cur.cascadeDone) {
      warn.push('当前是「子任务全完成 → 父任务自动完成」：父任务的完成状态由子任务决定，' +
                '手动点父任务完成时子任务不会被改动，所以可以出现「父任务已完成、子任务还没完成」。');
    }

    var tipCard = el('div', { class: 'card', style: { padding: '16px 18px' } });
    tipCard.appendChild(el('div', { class: 'section-title' }, ['当前组合的效果']));
    if (!warn.length) {
      tipCard.appendChild(el('p', {
        class: 'ocr-hint',
        text: '父任务和子任务完全独立：勾谁只影响谁。这是最不容易误操作的一档。'
      }));
    } else {
      tipCard.appendChild(el('div', { class: 'subtask-warn' }, warn.map(function (w) {
        return el('p', { style: { margin: '0 0 8px', fontSize: '12.5px', lineHeight: '1.75' }, text: '· ' + w });
      })));
    }
    tipCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, [
      el('button', {
        class: 'btn btn-sm', text: '恢复默认',
        onclick: function () {
          Store.updateSettings({ subtask: Object.assign({}, global.SUBTASK_DEFAULTS) });
          UI.toast('已恢复默认的子任务行为');
          view.render();
        }
      })
    ]));
    root.appendChild(tipCard);
  }

  /** 供其它页面直接跳到某个设置分类或具体页 */
  global.SettingsView = {
    go: function (key) {
      // 不在设置页时不能只改 SUB：go() 会先走 onEnter 把状态清掉，
      // 所以交给深链接参数带过去
      if (global.App && App.currentId === 'settings') view.setTab(key);
      else if (global.App) App.go('settings', { tab: key });
      else view.setTab(key);
    }
  };

  /* ==========================================================
   * 二级页：奖励机制（森林 / 抽卡）
   * ========================================================== */
  function renderRewardPage(root) {
    var pm = Store.pomodoro;
    var gachaOn = Store.gachaEnabled();
    if (!gachaOn && pm.mode === 'gacha') { Store.setRewardMode('forest'); pm = Store.pomodoro; }
    var mode = pm.mode;

    var pickCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
    pickCard.appendChild(el('div', { class: 'section-title' }, ['选择奖励机制']));
    pickCard.appendChild(el('p', {
      style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' },
      text: '两种机制的奖励积分各自独立、不能互相花费。切换时不会清零、也不会兑换——已经攒下的森林积分和合成玉都原样保留，之后获得的积分进入当前选中的机制。'
    }));

    var opts = [
      {
        k: 'forest', name: '森林', icon: V.icons.tree || V.icons.idea, color: '#4c8c4a',
        desc: '用积分种树、浇水，看着森林一天天长起来',
        bal: pm.points + ' 积分'
      }
    ];
    if (gachaOn) opts.push({
      k: 'gacha', name: '抽卡寻访', icon: V.icons.jade, color: '#00a89a',
      desc: '攒合成玉寻访明日方舟干员，主页展示已获得的角色',
      bal: pm.jade + ' 合成玉'
    });

    var gridBox = el('div', { class: 'reward-grid' });
    opts.forEach(function (o) {
      var on = mode === o.k;
      gridBox.appendChild(el('button', {
        class: 'rw-item' + (on ? ' on' : ''), type: 'button',
        style: { '--rc': o.color },
        onclick: function () {
          if (mode === o.k) return;
          Store.setRewardMode(o.k);
          if (global.Theme) Theme.applyMech();
          UI.toast('已切换到「' + o.name + '」');
          view.render();
        }
      }, [
        el('span', { class: 'rw-icon' }, [V.svg(o.icon, 22)]),
        el('span', { class: 'rw-main' }, [
          el('b', { text: o.name }),
          el('span', { text: o.desc }),
          el('i', { text: o.bal })
        ]),
        on ? el('span', { class: 'rw-flag', text: '使用中' }) : null
      ]));
    });
    pickCard.appendChild(gridBox);

    pickCard.appendChild(el('div', { class: 'rw-balance' }, [
      el('div', { class: 'rwb-item' }, [
        el('b', { text: String(pm.points) }),
        el('span', { text: '森林积分' })
      ]),
      gachaOn ? el('span', { class: 'rwb-plus', text: '｜' }) : null,
      gachaOn ? el('div', { class: 'rwb-item' }, [
        el('b', { text: String(pm.jade) }),
        el('span', { text: '合成玉' })
      ]) : null
    ]));
    pickCard.appendChild(el('p', {
      class: 'ocr-hint', style: { marginBottom: '0' },
      text: '积分与合成玉不互通，各花各的：森林模式花积分，抽卡模式花合成玉。当前在「' +
            (pm.mode === 'gacha' ? '抽卡 · 花合成玉' : '森林 · 花积分') + '」。'
    }));
    root.appendChild(pickCard);

    /* ---- 抽卡机制：规则与图鉴 ---- */
    if (mode === 'gacha') {
      var s = Store.gachaStats();
      var gCard = el('div', { class: 'card', style: { padding: '16px 18px', marginBottom: '14px' } });
      gCard.appendChild(el('div', { class: 'section-title' }, [
        '寻访规则',
        el('span', {
          style: { marginLeft: 'auto', fontSize: '11.5px', color: 'var(--text-3)', fontWeight: '400' },
          text: '明日方舟标准寻访'
        })
      ]));

      var rows = [
        ['单抽', POMO.PULL_COST + ' 合成玉（≈ ' + (Math.round(POMO.PULL_COST / POMO.JADE_PER_POINT * 100) / 100) + ' 积分）'],
        ['十连', POMO.TEN_COST + ' 合成玉（= 10 积分）'],
        ['六星概率', POMO.RATE_6 + '%'],
        ['五星 / 四星 / 三星', POMO.RATE_5 + '% / ' + POMO.RATE_4 + '% / 40%'],
        ['保底', '连续 ' + POMO.PITY_START + ' 抽没出六星后，每抽 +' + POMO.PITY_STEP + '%'],
        ['十连保底', '十连内至少一位五星及以上'],
        ['当前六星概率', s.rate6 + '%（距上次六星 ' + s.pity + ' 抽）']
      ];
      rows.forEach(function (r) {
        gCard.appendChild(el('div', { class: 'rw-rule' }, [
          el('span', { text: r[0] }),
          el('b', { text: r[1] })
        ]));
      });

      gCard.appendChild(el('div', { class: 'dp-macros', style: { marginTop: '10px' } }, [
        el('span', { class: 'macro', style: { background: '#ff930022', color: '#ff9300' },
          text: '6★ ' + (s.byR[6] || [0, 0])[0] + '/' + (s.byR[6] || [0, 0])[1] }),
        el('span', { class: 'macro', style: { background: '#f7d54733', color: '#c99a00' },
          text: '5★ ' + (s.byR[5] || [0, 0])[0] + '/' + (s.byR[5] || [0, 0])[1] }),
        el('span', { class: 'macro', style: { background: '#c79bff22', color: '#8b5cf6' },
          text: '4★ ' + (s.byR[4] || [0, 0])[0] + '/' + (s.byR[4] || [0, 0])[1] }),
        el('span', { class: 'macro', style: { background: '#6bc8ff22', color: '#0284c7' },
          text: '3★ ' + (s.byR[3] || [0, 0])[0] + '/' + (s.byR[3] || [0, 0])[1] })
      ]));

      gCard.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: function () { if (global.Gacha) Gacha.open(); }
        }, [V.jade(16), '去寻访']),
        el('button', {
          class: 'btn',
          onclick: function () { if (global.Gacha) Gacha.openOps(); }
        }, ['我的干员 ' + s.owned + '/' + s.total])
      ]));
      root.appendChild(gCard);
    }
  }

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


