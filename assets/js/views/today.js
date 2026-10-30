

/* ==========================================================
 * 视图：今日（今天有什么课 / 什么作业该交了）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  function timeToDate(hhmm) {
    var p = (hhmm || '00:00').split(':');
    var d = DateUtil.today();
    d.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
    return d;
  }

  var view = {
    id: 'today',
    name: '今日',
    icon: V.icons.today,
    title: '今日',
    order: 5,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { TaskDialog.open(); }
      }, [V.svg(V.icons.plus, 16), '新建待办']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-today' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },
    onLeave: function () {
      if (this._cdTimer) { clearInterval(this._cdTimer); this._cdTimer = null; }
    },

    render: function () {
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      var now = new Date();
      var today = DateUtil.today();
      var dow = DateUtil.isoDow(today);
      var weekNo = Store.currentWeek();
      var inTerm = weekNo >= 1 && weekNo <= Store.semester.weeks;
      var todayStr = DateUtil.toStr(today);
      // 单次例外生效后的课表：停课/调走的不算节数，调进来的算
      var courses = Store.coursesOnDate(todayStr);
      // 「今日」只看顶层任务：子任务在父任务里展开看，避免同一件事刷两遍
      var todayTasks = Store.todayTasks().filter(function (t) { return !t.parentId; });
      var overdue = Store.overdueTasks().filter(function (t) { return !t.parentId; });

      /* ---------- 问候卡（支持轻松愉快的心情签名：自动应景 + 点击可换/自定义） ---------- */
      var hour = now.getHours();
      var greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
      var lightMottos = [
        '步子不用迈太大，今天把眼前的小事做完就很棒 ✨',
        '不管今天几节课，下课记得去吃顿热乎的 🍜',
        '允许偶尔发呆十分钟，电量满了再出发 🔋',
        '写完这一条待办，就去听会儿雨声或者晒晒太阳 🌤️',
        '不咕不咕，今天也是稳稳推进的一天 🕊️',
        '难题拆成小块就不难了，先专注 25 分钟试试 🍅'
      ];
      var customMotto = (Store.state && Store.state.settings && Store.state.settings.motto) || '';
      var holidayToday = Store.holidayPaused ? Store.holidayPaused(todayStr) : null;
      var autoMotto = holidayToday ? ('今天是' + holidayToday.name + ' · 放假，课表与提醒已自动停课 🎏')
        : !inTerm ? '假期模式已开启，尽情充电、好好生活 🏖️'
        : (courses.length === 0 ? '今天没有课，泡杯喜欢的饮品按自己的节奏来 ☕'
        : (courses.length >= 4 ? '今天课有点满，课间记得伸个懒腰喝口水 🥤'
        : lightMottos[(today.getDate() + today.getMonth()) % lightMottos.length]));
      var subText = greet + ' · ' + (customMotto || autoMotto);

      var hero = el('div', {
        class: 'card hero',
        style: {
          color: '#fff', border: 'none',
          marginBottom: '16px'
        }
      }, [
        el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } }, [
          el('div', { style: { flex: '1', minWidth: '180px' } }, [
            el('div', {
              class: 'hero-sub',
              title: '点一下换一句今日签名',
              style: { fontSize: '12.5px', opacity: '.88', marginBottom: '4px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' },
              onclick: function () {
                var fMotto = V.input({
                  placeholder: '留空则每天按课表与心情自动换一句轻松签名',
                  value: (Store.state.settings && Store.state.settings.motto) || ''
                });
                var pickBox = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } });
                lightMottos.forEach(function (line) {
                  pickBox.appendChild(el('button', {
                    class: 'btn btn-sm',
                    style: { fontSize: '11.5px' },
                    text: line,
                    onclick: function () { fMotto.value = line; }
                  }));
                });
                var mm = V.modal({
                  title: '✨ 今日轻松签名',
                  width: '440px',
                  body: [
                    V.field('自定义签名（留空 = 每日自动应景切换）', fMotto),
                    el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }, text: '或者挑一句喜欢的：' }),
                    pickBox
                  ],
                  footer: el('div', { class: 'modal-foot' }, [
                    el('button', {
                      class: 'btn', text: '恢复每日自动',
                      onclick: function () {
                        Store.state.settings.motto = '';
                        Store.save();
                        mm.close();
                        view.render();
                      }
                    }),
                    el('button', {
                      class: 'btn btn-primary', text: '保存',
                      onclick: function () {
                        Store.state.settings.motto = fMotto.value.trim();
                        Store.save();
                        mm.close();
                        view.render();
                      }
                    })
                  ])
                });
              },
              text: subText + ' ✎'
            }),
            el('div', { class: 'hero-title', style: { fontSize: '24px', fontWeight: '700', letterSpacing: '.4px', lineHeight: '1.25' },
              text: (today.getMonth() + 1) + ' 月 ' + today.getDate() + ' 日 · ' + Store.DAY_NAMES[dow - 1] }),
            el('div', { class: 'hero-desc', style: { fontSize: '12.5px', opacity: '.86', marginTop: '4px' },
              text: !inTerm ? '学期外 · 假期愉快' : (courses.length ? ('第 ' + weekNo + ' 周 · 今天 ' + courses.length + ' 节课') : ('第 ' + weekNo + ' 周 · 今天没有课')) })
          ]),
          el('div', { class: 'hero-stats', style: { display: 'flex', gap: '18px', textAlign: 'center' } }, [
            statBlock(courses.length, '今日课程'),
            statBlock(todayTasks.length + overdue.length, '待完成'),
            statBlock(doneTodayCount(), '今日已完成')
          ])
        ])
      ]);
      root.appendChild(hero);

      /* ---------- 今日要点速览条（下一节课实时状态 + 昨夜睡眠速览） ---------- */
      (function () {
        var snap = Store.snapshotForWidget ? Store.snapshotForWidget(now) : null;
        var nc = (snap && snap.nextCourse) || { state: 'none', title: '', start: '', end: '', room: '', remain: 0 };
        var cDot = 'cp-tb-dot', cTitle = '今天没有课', cSub = '自由安排自习或推进待办', cTag = '空闲';
        if (!inTerm) {
          cTitle = '假期模式';
          cSub = '当前不在学期周次内';
          cTag = '假期';
        } else if (nc.state === 'now') {
          cDot += ' cp-is-now';
          cTitle = '正在上课 · ' + nc.title;
          cSub = [nc.start + '–' + nc.end, nc.room || ''].filter(Boolean).join(' · ');
          cTag = '进行中';
        } else if (nc.state === 'upcoming') {
          cDot += ' cp-is-upcoming';
          cTitle = '下节课 · ' + nc.title;
          var diffM = Math.max(0, TimeUtil.toMin(nc.start) - (now.getHours() * 60 + now.getMinutes()));
          var waitTxt = diffM >= 60 ? (Math.floor(diffM / 60) + 'h' + (diffM % 60 ? (diffM % 60) + 'm' : '') + '后') : (diffM + '分钟后');
          cSub = [nc.start + '–' + nc.end, nc.room || ''].filter(Boolean).join(' · ');
          cTag = waitTxt;
        } else if (nc.state === 'done') {
          cDot += ' cp-is-done';
          cTitle = '今日 ' + courses.length + ' 节课已全部上完';
          cSub = '最后一节：' + nc.title + (nc.end ? '（' + nc.end + ' 下课）' : '');
          cTag = '已结课';
        }

        var sRec = Store.sleepForDay ? Store.sleepForDay(todayStr) : null;
        var sTier = Store.sleepQualityTier ? Store.sleepQualityTier(sRec) : { tier: 'none', label: '未记录', totalMin: 0 };
        var sDot = 'cp-tb-dot' + (sTier.tier === 'good' ? ' cp-is-good' : (sTier.tier === 'warn' ? ' cp-is-warn' : (sTier.tier === 'bad' ? ' cp-is-bad' : '')));
        var sTitle = sTier.totalMin > 0 ? ('昨晚睡眠 · ' + TimeUtil.humanMin(sTier.totalMin)) : '昨晚睡眠未记录';
        var sSub = sRec
          ? ([sRec.start + ' → ' + sRec.end, sRec.deep ? ('深睡 ' + sRec.deep + 'm') : '', sRec.efficiency ? ('效率 ' + sRec.efficiency + '%') : ''].filter(Boolean).join(' · '))
          : '点此用一句话速记或同步手环睡眠';

        root.appendChild(el('div', { class: 'today-brief' }, [
          el('div', {
            class: 'tb-chip',
            onclick: function () { App.go('schedule'); }
          }, [
            el('i', { class: cDot }),
            el('div', { class: 'tb-main' }, [
              el('b', { text: cTitle }),
              el('span', { text: cSub })
            ]),
            el('span', { class: 'tb-tag', text: cTag })
          ]),
          el('div', {
            class: 'tb-chip',
            onclick: function () {
              if (sTier.totalMin > 0 && Store.healthEnabled && Store.healthEnabled()) {
                App.go('health');
              } else if (global.SleepDialog && SleepDialog.open) {
                SleepDialog.open(todayStr);
              } else {
                App.go('tasks', { tab: 'quadrant' });
              }
            }
          }, [
            el('i', { class: sDot }),
            el('div', { class: 'tb-main' }, [
              el('b', { text: sTitle }),
              el('span', { text: sSub })
            ]),
            el('span', { class: 'tb-tag', text: sTier.label || '去记录' })
          ])
        ]));
      })();

      /* ---------- 健康联动快捷条（精力 / 净热量 / 步数） ----------
         健康看板没开启就整条不出现：没数据时它只会显示「—」，
         对不用健康的人纯属噪音。已有睡眠/活动数据的老档会自动算作已开启。 */
      (function () {
        if (Store.healthEnabled && !Store.healthEnabled()) return;
        var hh = Store.dayHealth(todayStr);
        var eInfo = hh.sleepQ >= 0.8 ? ['充沛', '#22c55e']
                   : hh.sleepQ >= 0.65 ? ['良好', '#84cc16']
                   : hh.sleepQ >= 0.5 ? ['一般', '#eab308']
                   : ['低电量', '#ef4444'];
        var netTxt = hh.netKcal != null
          ? ('净热量 ' + (hh.netKcal > 0 ? '+' : '') + hh.netKcal + ' kcal') : '净热量 —';
        var stepTxt = hh.steps >= hh.stepGoal
          ? ('步数达标 ' + hh.steps) : ('步数 ' + hh.steps + '/' + hh.stepGoal);
        root.appendChild(el('div', {
          class: 'card',
          style: { padding: '12px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            V.svg(V.icons.moon, 16),
            el('span', { style: { fontWeight: '700', color: eInfo[1] }, text: eInfo[0] }),
            el('span', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: '精力' })
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            V.svg(V.icons.drop, 16),
            el('span', { style: { fontSize: '13px' }, text: netTxt })
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            V.svg(V.icons.heart, 16),
            el('span', { style: { fontSize: '13px' }, text: stepTxt })
          ])
        ]));
      })();

      /* ---------- 今日出门清单（只读，不写数据） ---------- */
      (function () {
        var P = global.Packing;
        if (!P || !P.forDate) return;
        var items = P.forDate(todayStr);
        if (!items.length) return;
        var box = el('div', {
          class: 'card',
          style: { padding: '14px 16px', marginBottom: '14px' }
        }, [
          el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }
          }, [
            el('div', {
              style: { fontSize: '13.5px', fontWeight: '650', flex: '1' },
              text: '🎒 今天带什么'
            }),
            el('button', {
              class: 'btn btn-sm',
              text: '复制清单',
              onclick: function () {
                var text = P.toText(todayStr);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).then(function () {
                    UI.toast('清单已复制', 'ok');
                  }).catch(function () { UI.toast('复制失败', 'err'); });
                } else {
                  UI.toast('当前环境不支持复制', 'err');
                }
              }
            })
          ]),
          el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, items.map(function (it) {
            return el('span', {
              class: 'chip',
              title: it.why,
              style: {
                fontSize: '12px', padding: '4px 10px', borderRadius: '999px',
                background: 'var(--surface-2)', border: '1px solid var(--line)'
              },
              text: it.text
            });
          })),
          el('div', {
            style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '8px' },
            text: '按今天的课程和到期作业自动生成，不联网。'
          })
        ]);
        root.appendChild(box);
      })();

      /* ---------- ⏳ 未来 7 天 DDL 冲刺线 ---------- */
      (function () {
        var D = global.Deadline;
        if (!D || !D.upcoming) return;
        var all = D.upcoming(7, now);
        if (!all.length) return;
        var show = all.slice(0, 6);
        var tone = { over: '#ef4444', '24h': '#f59e0b', '72h': '#0ea5e9', normal: '#94a3b8' };

        var card = el('div', {
          class: 'card',
          style: { padding: '14px 16px', marginBottom: '14px' }
        }, [
          el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }
          }, [
            el('div', { style: { fontSize: '13.5px', fontWeight: '650', flex: '1' }, text: '⏳ 未来 7 天' }),
            el('a', {
              class: 'more', href: 'javascript:void 0', text: '全部待办 →',
              onclick: function () { App.go('tasks'); }
            })
          ])
        ]);

        show.forEach(function (it) {
          var t = it.task;
          var color = tone[D.urgency(it.leftMin)] || tone.normal;
          card.appendChild(el('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '7px 0', borderTop: '1px solid var(--line)', cursor: 'pointer'
            },
            onclick: function () {
              if (global.TaskDialog && TaskDialog.open) TaskDialog.open(t.id);
            }
          }, [
            el('span', {
              style: {
                width: '6px', height: '26px', borderRadius: '3px',
                background: color, flex: 'none'
              }
            }),
            el('div', { style: { flex: '1', minWidth: '0' } }, [
              el('div', {
                style: {
                  fontSize: '13px', fontWeight: '600',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                },
                text: t.title || '未命名待办'
              }),
              el('div', {
                style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '1px' },
                text: D.dayLabel(it.at, now) + ' ' + (t.dueTime || '全天')
              })
            ]),
            el('span', {
              style: { fontSize: '11.5px', color: color, fontWeight: '600', flex: 'none' },
              text: D.leftText(it.leftMin)
            })
          ]));
        });

        if (all.length > show.length) {
          card.appendChild(el('div', {
            style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '6px' },
            text: '还有 ' + (all.length - show.length) + ' 条，去「待办」看全部'
          }));
        }
        root.appendChild(card);
      })();

      /* ---------- 🌙 今晚几点睡（按明早第一节课倒推） ---------- */
      (function () {
        if (!global.Remind || !Remind.bedtimePlan) return;
        if (now.getHours() < 15) return;          // 白天不打扰
        var plan = Remind.bedtimePlan();
        if (!plan || !plan.hhmm) return;

        var cap = global.Capacitor;
        var np = cap && cap.Plugins && cap.Plugins.Notify;
        var alarmBtn = null;
        if (np && typeof np.setSystemAlarm === 'function') {
          alarmBtn = el('button', {
            class: 'btn btn-sm',
            text: '设闹钟',
            onclick: function () {
              var p = String(plan.hhmm).split(':');
              np.setSystemAlarm({
                hour: Number(p[0]) || 23,
                minute: Number(p[1]) || 0,
                label: '该睡了 · 课表'
              }).then(function () {
                UI.toast('已打开系统闹钟', 'ok');
              }).catch(function () {
                UI.toast('无法打开系统闹钟，请手动设置', 'err');
              });
            }
          });
        }

        root.appendChild(el('div', {
          class: 'card',
          style: {
            padding: '12px 16px', marginBottom: '14px',
            display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'
          }
        }, [
          el('div', { style: { flex: '1', minWidth: '180px' } }, [
            el('div', { style: { fontSize: '13.5px', fontWeight: '650' }, text: '🌙 今晚 ' + plan.hhmm + ' 前睡' }),
            el('div', {
              style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' },
              text: plan.reason || ('目标睡眠 ' + plan.need + ' 小时')
            })
          ]),
          alarmBtn
        ]));
      })();

      /* ---------- 昨晚睡成什么样 → 今天怎么安排 ----------
         只在「健康看板开着 + 昨晚有记录 + 有明确倾向」时出现。
         睡差了给「挪到明天」按钮，睡够了指个目标——都靠用户点，不自动改任何数据。 */
      (function () {
        var adv = Store.bodyAdvice(todayStr);
        if (!adv.has || adv.dismissed) return;
        if (adv.level !== 'low' && adv.level !== 'mild' && adv.level !== 'good') return;

        var tone = adv.level === 'low'
          ? { c: '#f59e0b', bg: 'rgba(245,158,11,.10)', bd: 'rgba(245,158,11,.35)', icon: V.icons.moon }
          : adv.level === 'mild'
            ? { c: '#ca8a04', bg: 'rgba(234,179,8,.09)', bd: 'rgba(234,179,8,.28)', icon: V.icons.moon }
            : { c: '#16a34a', bg: 'rgba(34,197,94,.09)', bd: 'rgba(34,197,94,.30)', icon: V.icons.sun };

        var qTxt = adv.q >= 0.7 ? '良好' : adv.q >= 0.55 ? '一般' : '偏差';
        var title = (adv.moodFatigue && !(adv.total > 0))
          ? '最近连续两天心情疲惫/低落 · 今天先别硬扛'
          : adv.level === 'low'
            ? ('昨晚只睡了 ' + TimeUtil.humanMin(adv.total) + ' · 今天先别扛')
            : adv.level === 'mild'
              ? ('昨晚 ' + TimeUtil.humanMin(adv.total) + (adv.moodFatigue ? '（叠加连续情绪疲惫）' : '') + ' · 略微欠了一点')
              : ('昨晚 ' + TimeUtil.humanMin(adv.total) + ' · 状态在线');

        var body;
        if (adv.level === 'low') {
          body = adv.heavy.length
            ? ('这 ' + adv.heavy.length + ' 项是高耗能任务，建议挪到明天再做：')
            : '今天没有必须今天完成的高耗能任务，先把轻松的推进，晚上早点躺下。';
        } else if (adv.level === 'mild') {
          body = '今天照常推进就好，但别再给自己加码，晚上早点躺下把这 40 分钟补回来。';
        } else {
          body = adv.heavy.length
            ? ('适合啃硬骨头，建议首选「' + adv.heavy[0].title + '」。')
            : '适合啃硬骨头，挑一件最难的先做。';
        }

        var rows = [];
        if (adv.level === 'low' && adv.heavy.length) {
          adv.heavy.forEach(function (t) {
            rows.push(el('div', {
              style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' }
            }, [
              el('span', {
                style: { flex: '1', minWidth: '0', fontSize: '13px', overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                text: t.title,
                title: t.title
              }),
              el('button', {
                class: 'btn btn-sm',
                style: { flex: 'none', padding: '2px 8px', fontSize: '12px' },
                onclick: function () {
                  Store.deferTaskTo(t.id, adv.tomorrow);
                  V.toast('已挪到明天：' + t.title, 'ok');
                  view.render();
                }
              }, ['→ 明天'])
            ]));
          });
        }

        root.appendChild(el('div', {
          class: 'card cp-body-advice',
          style: {
            padding: '12px 14px', marginBottom: '14px',
            background: tone.bg, border: '1px solid ' + tone.bd,
            borderLeft: '3px solid ' + tone.c
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } }, [
            el('span', { style: { color: tone.c, display: 'flex', flex: 'none', marginTop: '1px' } },
              [V.svg(tone.icon, 16)]),
            el('div', { style: { flex: '1', minWidth: '0' } }, [
              el('div', { style: { fontWeight: '700', fontSize: '13.5px', color: tone.c }, text: title }),
              el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px', lineHeight: '1.5' },
                          text: body }),
              el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '3px' },
                          text: '睡眠质量 ' + qTxt + ' · 数据来自昨夜睡眠记录' + (adv.shortMin > 0 ? '，比目标少 ' + adv.shortMin + ' 分钟' : '') })
            ]),
            el('button', {
              class: 'link-btn',
              style: { flex: 'none', padding: '0 2px', fontSize: '15px', lineHeight: '1', color: 'var(--text-3)' },
              title: '今天不再提示',
              onclick: function () {
                Store.dismissBodyTip(todayStr);
                view.render();
              }
            }, ['×'])
          ]),
          rows.length ? el('div', { style: { marginTop: '6px' } },
            rows.concat([el('button', {
              class: 'link-btn',
              style: { fontSize: '12px', marginTop: '2px' },
              onclick: function () {
                adv.heavy.forEach(function (t) { Store.deferTaskTo(t.id, adv.tomorrow); });
                V.toast('已把 ' + adv.heavy.length + ' 项挪到明天', 'ok');
                view.render();
              }
            }, ['全部挪到明天 ›'])])
          ) : null,
          adv.level === 'good' ? el('div', { style: { marginTop: '6px' } }, [
            el('button', {
              class: 'btn btn-sm',
              style: { fontSize: '12px', padding: '3px 10px' },
              onclick: function () { App.go('pomodoro'); }
            }, ['去开始专注'])
          ]) : null
        ]));
      })();

      /* ---------- 💰 当月预算预警条（超支或已达 85% 时温和提示） ---------- */
      (function () {
        if (!Store.getBudget || !Store.ledgerBudgetStatus) return;
        var b = Store.getBudget();
        if (!b || !(b.monthly > 0)) return;
        var ym = todayStr.slice(0, 7);
        var bst = Store.ledgerBudgetStatus(ym);
        if (!bst || (!bst.over && (bst.pct == null || bst.pct < 0.85))) return;
        var isOver = !!bst.over;
        var pctNum = Math.round((bst.pct || 0) * 100);
        var bTone = isOver
          ? { c: '#ef4444', bg: 'rgba(239,68,68,.08)', bd: 'rgba(239,68,68,.30)' }
          : { c: '#d97706', bg: 'rgba(245,158,11,.08)', bd: 'rgba(245,158,11,.30)' };
        var bTitle = isOver
          ? ('本月预算已超支 ¥' + Math.round((bst.spent - b.monthly) * 100) / 100 + '（已用 ' + pctNum + '%）')
          : ('本月预算已用 ' + pctNum + '% · 剩余 ¥' + bst.remaining);
        var bSub = bst.daysLeft > 0
          ? ('距月底还有 ' + bst.daysLeft + ' 天' + (bst.dailyLeft != null && bst.dailyLeft >= 0 ? '，日均可用 ¥' + bst.dailyLeft : '，接下来几天留意控制开销'))
          : '月底最后一天，留意收尾账目';

        root.appendChild(el('div', {
          class: 'card cp-budget-advice',
          style: {
            padding: '10px 14px', marginBottom: '14px',
            background: bTone.bg, border: '1px solid ' + bTone.bd,
            borderLeft: '3px solid ' + bTone.c,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'
          }
        }, [
          el('div', { style: { minWidth: '0', flex: '1' } }, [
            el('div', { style: { fontWeight: '700', fontSize: '13px', color: bTone.c }, text: '💰 ' + bTitle }),
            el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: bSub })
          ]),
          el('button', {
            class: 'btn btn-sm',
            style: { flex: 'none', fontSize: '12px' },
            onclick: function () { App.go('ledger'); }
          }, ['看账本 ›'])
        ]));
      })();

      /* ---------- 🔥 联动 D：7 天内考前冲刺黄金专注直达横幅 ---------- */
      (function () {
        var limitStr = DateUtil.toStr(DateUtil.addDays(today, 7));
        var allExams = Store.courseExams ? Store.courseExams() : (Store.courses || []);
        var urgentExams = allExams.filter(function (c) {
          return c && c.exam && c.exam.date && c.exam.date >= todayStr && c.exam.date <= limitStr;
        }).sort(function (a, b) { return a.exam.date < b.exam.date ? -1 : 1; });
        if (!urgentExams.length) return;
        var c0 = urgentExams[0];
        var ed0 = DateUtil.parse(c0.exam.date);
        var dLeft = Math.max(0, DateUtil.diffDays(ed0, today));
        var revTask = (Store.tasks || []).find(function (t) {
          return t && t.status !== 'done' && (t.courseId === c0.id || (t.title && t.title.indexOf(c0.name) >= 0));
        });
        var risk0 = Store.examRiskOf ? Store.examRiskOf(c0) : null;
        var subParts = [
          dLeft === 0 ? '今天开考' : ('距考试仅剩 ' + dLeft + ' 天（' + c0.exam.date.slice(5) + '）')
        ];
        if (risk0 && risk0.scored && risk0.weightLeft > 0 && risk0.needFor60 != null) {
          subParts.push('平时分 ' + risk0.partial + ' · 期末需 ≥' + risk0.needFor60 + ' 分及格');
        }
        if (revTask) {
          subParts.push('待复习：' + revTask.title);
        }

        root.appendChild(el('div', {
          class: 'card cp-exam-sprint-banner',
          style: {
            padding: '11px 14px', marginBottom: '14px',
            background: 'rgba(239, 68, 68, .08)', border: '1px solid rgba(239, 68, 68, .28)',
            borderLeft: '3px solid #ef4444',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap'
          }
        }, [
          el('div', { style: { minWidth: '0', flex: '1' } }, [
            el('div', { style: { fontWeight: '700', fontSize: '13px', color: '#dc2626' }, text: '🔥 考前冲刺 · 《' + c0.name + '》' + (c0.examLabel ? '（' + c0.examLabel + '）' : '') }),
            el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: subParts.join(' · ') })
          ]),
          el('button', {
            class: 'btn btn-sm btn-primary',
            style: { flex: 'none', fontSize: '12px', background: '#ef4444', borderColor: '#ef4444' },
            onclick: function () {
              var targetTask = revTask;
              if (!targetTask) {
                targetTask = Store.addTask({
                  title: '冲刺复习《' + c0.name + '》',
                  courseId: c0.id,
                  dueDate: todayStr,
                  priority: 'high',
                  important: true,
                  energy: 'high',
                  examStage: 'sprint',
                  tags: ['学习/' + c0.name]
                });
              }
              if (App.focusTask) App.focusTask(targetTask.id);
            }
          }, [revTask ? '🍅 立即冲刺专注' : '🍅 生成复习并专注'])
        ]));
      })();




      /* ---------- ⚠️ 智能联动：今日日程时间冲突检测与高负荷预警 ---------- */
      (function () {
        if (!Store.detectDayConflicts) return;
        var conflicts = Store.detectDayConflicts(todayStr);
        if (!conflicts || !conflicts.length) return;
        var cf0 = conflicts[0];
        root.appendChild(el('div', {
          class: 'card cp-day-conflict-banner',
          style: {
            padding: '10px 14px', marginBottom: '12px',
            background: 'rgba(245, 158, 11, .08)', border: '1px solid rgba(245, 158, 11, .32)',
            borderLeft: '3px solid var(--amber)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap'
          }
        }, [
          el('div', { style: { minWidth: '0', flex: '1' } }, [
            el('div', { style: { fontWeight: '700', fontSize: '12.5px', color: 'var(--amber)' }, text: '⚠️ 今日时间冲突提醒（共 ' + conflicts.length + ' 处）' }),
            el('div', { style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px' }, text: cf0.summary })
          ]),
          el('button', {
            class: 'btn btn-sm',
            type: 'button',
            onclick: function () { App.go('tasks'); }
          }, ['去调整日程 →'])
        ]));
      })();

      /* ---------- 🛡️ 周期性数据防丢提醒（连续 ≥7 天未导出备份且有数据时温和提醒） ---------- */
      (function () {
        if (!Store.backupHealth) return;
        var bh = Store.backupHealth();
        if (!bh || !bh.shouldRemind) return;
        var tipText = bh.daysSinceBackup == null
          ? ('当前已积累 ' + bh.totalRecords + ' 条课程与待办记录，建议导出一份本地 JSON 备份防丢失。')
          : ('距离上次导出备份已过 ' + bh.daysSinceBackup + ' 天，建议一键导出最新备份。');
        root.appendChild(el('div', {
          class: 'card cp-backup-remind-banner',
          style: {
            padding: '10px 14px', marginBottom: '12px',
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap'
          }
        }, [
          el('div', { style: { minWidth: '0', flex: '1', fontSize: '12px', color: 'var(--text-2)' } }, [
            el('b', { style: { color: 'var(--primary)', marginRight: '6px' }, text: '🛡️ 数据防丢提醒' }),
            el('span', { text: tipText })
          ]),
          el('div', { style: { display: 'flex', gap: '6px', flex: 'none' } }, [
            el('button', {
              class: 'btn btn-sm btn-primary',
              type: 'button',
              onclick: function () {
                // App 内直接写到「下载/CoursePlanner」，网页端再去设置页导出
                if (global.Capacitor && App.exportBackupToDownloads) {
                  App.exportBackupToDownloads(false);
                  view.render();
                } else if (global.SettingsView && SettingsView.exportBackup) {
                  SettingsView.exportBackup();
                  view.render();
                } else {
                  App.go('settings', { tab: 'data' });
                }
              }
            }, ['一键导出备份']),
            el('button', {
              class: 'btn btn-sm',
              type: 'button',
              onclick: function () {
                if (Store.snoozeBackupRemind) Store.snoozeBackupRemind(7);
                view.render();
              }
            }, ['7天后再提醒'])
          ])
        ]));
      })();

      /* ---------- 倒数纪念日 ---------- */
      (function () {
        var anns = Store.anniversaries();
        if (!anns.length) return;
        // 只显示 60 天内的，或最近的 3 条
        var near = anns.filter(function (a) { return a.daysLeft <= 60; });
        if (!near.length) near = anns.slice(0, 3);
        near = near.slice(0, 4);

        var KIND_ICON = { birthday: '🎂', anniversary: '💝', countdown: '⏳' };
        root.appendChild(el('div', { class: 'card anniv-card' }, [
          el('div', { class: 'anniv-head' }, [
            el('span', { class: 'anniv-title', text: '倒数纪念日' }),
            el('button', {
              class: 'link-btn', text: '全部 ›',
              onclick: function () { App.go('calendar', { tab: 'agenda' }); }
            })
          ]),
          el('div', { class: 'anniv-list' }, near.map(function (a) {
            var e = a.ev;
            var days = a.daysLeft;
            return el('div', {
              class: 'anniv-row' + (days === 0 ? ' is-today' : ''),
              dataset: { rec: 'event:' + e.id },
              onclick: function () { if (global.openAnnivDialog) global.openAnnivDialog(e.id); }
            }, [
              el('span', { class: 'anniv-ico', text: KIND_ICON[e.kind] || '🎉' }),
              el('div', { class: 'anniv-main' }, [
                el('div', { class: 'anniv-name', text: e.title }),
                el('div', { class: 'anniv-sub', text: a.next + (e.lunar ? ' · 农历' : '') + (e.repeat === 'yearly' && a.nth > 1 ? ' · 第 ' + a.nth + ' 年' : '') })
              ]),
              days <= 14 ? el('button', {
                class: 'chip chip-blue',
                style: { cursor: 'pointer', border: 'none', marginRight: '4px' },
                title: '为该纪念日/倒数日一键创建准备待办',
                text: '+ 准备待办',
                onclick: function (evClick) {
                  evClick.stopPropagation();
                  if (!Store.createAnnivPrepTask) return;
                  var tk = Store.createAnnivPrepTask(e, todayStr);
                  if (tk) UI.toast('已创建准备待办：「' + tk.title + '」', 'ok');
                }
              }) : null,
              el('div', { class: 'anniv-days' + (days <= 7 ? ' near' : '') }, [
                el('b', { text: days === 0 ? '今天' : String(days) }),
                days === 0 ? null : el('span', { text: '天' })
              ])
            ]);
          }))
        ]));
      })();
      if (global.DailyCards) root.appendChild(DailyCards.section());

      /* ---------- 最近的重要日程倒计时 ---------- */
      (function () {
        var todayStr = DateUtil.toStr(today);
        var items = [];
        Store.tasks.forEach(function (t) {
          if (!t.important || t.status === 'done' || t.parentId) return;
          var d = t.dueDate || todayStr;
          items.push({ kind: 'task', title: t.title, date: d, time: t.dueTime || '23:59' });
        });
        Store.events.forEach(function (e) {
          if (!e.important || e.done) return;
          items.push({ kind: 'event', title: e.title, date: e.date, time: e.start || '00:00' });
        });
        Store.plans.forEach(function (pl) {
          if (!pl.important || pl.done) return;
          var sd = DateUtil.parse(pl.startDate);
          var ed = sd ? DateUtil.addDays(sd, (pl.days || 1) - 1) : null;
          items.push({ kind: 'plan', title: pl.title, date: ed ? DateUtil.toStr(ed) : pl.startDate, time: '23:59' });
        });
        items = items.filter(function (x) { return x.date >= todayStr; })
          .sort(function (a, b) {
            var aa = a.date + ' ' + a.time, bb = b.date + ' ' + b.time;
            return aa < bb ? -1 : aa > bb ? 1 : 0;
          });
        var near = items[0];
        if (!near) return;
        function fmt() {
          var target = new Date(near.date.replace(/-/g, '/') + ' ' + near.time);
          var diff = target.getTime() - Date.now();
          if (diff <= 0) return '已到期';
          var dd = Math.floor(diff / 86400000);
          var hh = Math.floor((diff % 86400000) / 3600000);
          var mm = Math.floor((diff % 3600000) / 60000);
          if (dd > 0) return dd + ' 天 ' + hh + ' 时';
          if (hh > 0) return hh + ' 时 ' + mm + ' 分';
          return mm + ' 分钟';
        }
        var val = el('b', { style: { fontSize: '19px', color: 'var(--primary)' }, text: fmt() });
        var card = el('div', {
          class: 'card',
          style: { display: 'flex', alignItems: 'center', gap: '14px', padding: '13px 16px', marginBottom: '16px', cursor: 'pointer', borderLeft: '4px solid var(--primary)' },
          onclick: function () {
            if (near.kind === 'task') App.go('tasks');
            else if (near.kind === 'event') App.go('calendar', { tab: 'agenda' });
            else App.go('plans');
          }
        }, [
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '★ 最近的重要日程' }),
            el('div', { style: { fontSize: '14.5px', fontWeight: '650', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text: near.title }),
            el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: near.date + ' ' + near.time })
          ]),
          el('div', { style: { flex: '0 0 auto', textAlign: 'right' } }, [
            el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: '倒计时' }),
            val
          ])
        ]);
        root.appendChild(card);
        if (view._cdTimer) clearInterval(view._cdTimer);
        view._cdTimer = setInterval(function () { if (val.isConnected) val.textContent = fmt(); }, 30000);
      })();

      var leftCol = el('div', { class: 'today-left' });
      var rightCol = el('div', { class: 'today-right' });

      /* ---------- 今天的课 ---------- */
      var section = el('div', { style: { marginBottom: '18px' } });
      var coursesCollapsed = !!(Store.state.settings && Store.state.settings.todayCoursesCollapsed);
      section.appendChild(el('div', { class: 'section-title' }, [
        '今天的课',
        el('button', {
          class: 'chip', type: 'button',
          'aria-label': coursesCollapsed ? '展开今日课程' : '折叠今日课程',
          text: coursesCollapsed ? '展开 ▾' : '折叠 ▴',
          style: { cursor: 'pointer', border: 'none', marginLeft: '6px' },
          onclick: function (e) {
            e.stopPropagation();
            Store.updateSettings({ todayCoursesCollapsed: !coursesCollapsed });
          }
        }),
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('schedule'); }
        }, ['查看完整课表 →'])
      ]));

      if (coursesCollapsed) {
        // 折叠时不构建列表，省一次 DOM 组装
      } else if (!inTerm) {
        section.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.calendar, '今天是学期外', '当前日期不在学期范围内，可在设置中调整学期起止日期。')
        ]));
      } else if (!Store.courses.length) {
        section.appendChild(el('div', { class: 'card' }, [
          V.empty(
            V.icons.book, '还没有添加课程',
            '先到课程表里排好每周的课，之后每天打开这里就能看到今天的安排。也可以先载入一份示例课表试试。',
            el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } }, [
              el('button', {
                class: 'btn btn-primary',
                onclick: function () { App.go('schedule'); }
              }, ['去添加课程']),
              el('button', {
                class: 'btn',
                onclick: function () {
                  if (global.__SampleData) global.__SampleData.load();
                }
              }, ['载入示例课表'])
            ])
          )
        ]));
      } else {
        // 生效课 + 被停/被调走的（灰显）一起进时间线；全被调走也不至于误以为没课
        var dayItems = buildDayItems(courses, todayStr, true);
        if (dayItems.length) section.appendChild(courseTimeline(dayItems, now));
        else section.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.today, '今天没有课', '可以安排自习，或者处理一下待办清单。')
        ]));
      }
      leftCol.appendChild(section);

      /* ---------- 作业 ---------- */
      var nowHM0 = DateUtil.nowHM();
      var todayTimeoutCount = todayTasks.filter(function (t) {
        return t.dueTime && t.dueTime < nowHM0;
      }).length;
      var totalOverdueOrTimeout = overdue.length + todayTimeoutCount;

      var taskSection = el('div');
      taskSection.appendChild(el('div', { class: 'section-title' }, [
        '作业与待办',
        totalOverdueOrTimeout ? el('button', {
          class: 'btn btn-sm',
          style: { marginLeft: '8px', height: '22px', padding: '0 8px', fontSize: '11px', color: 'var(--primary)' },
          onclick: function () {
            if (!Store.deferOverdueTasksToToday) return;
            var res = Store.deferOverdueTasksToToday();
            if (res && res.count > 0 && UI.toastAction && Store.restoreTaskDueDates) {
              UI.toastAction('已将 ' + res.count + ' 项逾期/超时任务顺延到今天', {
                actionText: '撤销',
                duration: 6000,
                onAction: function () { Store.restoreTaskDueDates(res.prevDates); }
              });
            }
          }
        }, ['⚡ 逾期顺延到今天 (' + totalOverdueOrTimeout + ')']) : null,
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('tasks'); }
        }, ['全部待办 →'])
      ]));
      var all = overdue.slice().sort(function (a, b) {
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        return (a.dueTime || '23:59') < (b.dueTime || '23:59') ? -1 : 1;
      }).concat(todayTasks.filter(function (t) {
        return overdue.indexOf(t) < 0;
      }));
      if (!all.length) {
        taskSection.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.check, '今天没有要交的东西', '截止日期为今天或已逾期的任务会出现在这里。')
        ]));
      } else {
        var box = el('div', { class: 'card', style: { padding: '6px 8px' } });
        all.forEach(function (t) { box.appendChild(TaskRow.build(t)); });
        taskSection.appendChild(box);
      }
      rightCol.appendChild(taskSection);

      /* ---------- 在办目标 ---------- */
      var activeGoals = (Store.state.goals || []).filter(function (g) { return !g.archivedAt; })
        .sort(function (a, b) { return String(a.endDate) < String(b.endDate) ? -1 : 1; });
      if (activeGoals.length) {
        var goalSec = el('div', { style: { marginTop: '18px' } });
        goalSec.appendChild(el('div', { class: 'section-title' }, [
          '在办目标',
          el('a', {
            class: 'more', href: 'javascript:void 0',
            onclick: function () { App.go('goals'); }
          }, ['全部目标 →'])
        ]));
        var gbox = el('div', { class: 'card', style: { padding: '10px 14px' } });
        activeGoals.slice(0, 3).forEach(function (g, idx) {
          var pgInfo = Store.goalProgressOf(g);
          var gpct = pgInfo.pct;
          var left = DateUtil.diffDays(DateUtil.parse(g.endDate), today);
          var leftText = left < 0 ? ('已过期 ' + (-left) + ' 天')
            : (left === 0 ? '今天到期' : ('剩 ' + left + ' 天'));
          var krGrid = el('div', {
            style: {
              display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '6px', marginTop: '7px'
            }
          });
          (pgInfo.rows || []).slice(0, 4).forEach(function (r) {
            var rp = r.pct != null ? Math.max(0, Math.min(100, Math.round(r.pct * 100))) : 0;
            krGrid.appendChild(el('div', {
              style: {
                padding: '5px 8px', borderRadius: '8px', border: '1px solid var(--line)',
                background: 'linear-gradient(90deg, rgba(79,70,229,0.14) ' + rp + '%, var(--surface-2) ' + rp + '%)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
                fontSize: '11.5px', width: '100%', boxSizing: 'border-box'
              }
            }, [
              el('span', {
                style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '600', color: 'var(--text-1)', flex: '1', minWidth: '0' },
                text: r.title
              }),
              el('span', {
                style: { fontSize: '11px', fontWeight: '700', color: 'var(--primary)', flex: '0 0 auto' },
                text: rp + '%'
              })
            ]));
          });
          gbox.appendChild(el('div', {
            style: { padding: '8px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' },
            onclick: function () { App.go('goals'); }
          }, [
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } }, [
              el('b', { style: { fontSize: '13px' }, text: g.title }),
              el('span', { style: { fontSize: '11.5px', color: left < 0 ? '#ef4444' : 'var(--text-3)' }, text: leftText })
            ]),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } }, [
              el('div', { style: { flex: '1', height: '7px', background: 'var(--line)', borderRadius: '4px', overflow: 'hidden' } }, [
                el('div', { style: { width: Math.max(0, Math.min(100, gpct)) + '%', height: '100%', background: 'var(--primary)' } })
              ]),
              el('span', { style: { fontSize: '11.5px', color: 'var(--text-2)', width: '34px', textAlign: 'right' }, text: gpct + '%' })
            ]),
            (pgInfo.rows && pgInfo.rows.length) ? krGrid : null
          ]));
        });
        goalSec.appendChild(gbox);
        rightCol.appendChild(goalSec);
      }

      /* ---------- 本周考试（含平时分及格线风险预警 + 一键建复习待办） ---------- */
      var wsExam = DateUtil.weekStart(today), weExam = DateUtil.addDays(wsExam, 6);
      var wsS = DateUtil.toStr(wsExam), weS = DateUtil.toStr(weExam);
      var allSemExams = Store.courseExams ? Store.courseExams() : (Store.courses || []);
      var weekExams = allSemExams.filter(function (c) {
        return c.exam && c.exam.date && c.exam.date >= wsS && c.exam.date <= weS;
      }).sort(function (a, b) { return a.exam.date < b.exam.date ? -1 : 1; });
      if (weekExams.length) {
        var examSec = el('div', { style: { marginTop: '18px' } });
        examSec.appendChild(el('div', { class: 'section-title' }, ['本周考试']));
        var ebox = el('div', { class: 'card', style: { padding: '6px 8px' } });
        weekExams.forEach(function (c) {
          var ed = DateUtil.parse(c.exam.date);
          var tt = c.exam.start ? (c.exam.start + (c.exam.end ? '–' + c.exam.end : '')) : '';
          var loc = c.exam.location || c.location || '';
          var risk = Store.examRiskOf ? Store.examRiskOf(c) : { scored: false };
          var riskChip = null;
          if (risk && risk.scored && risk.weightLeft > 0) {
            var rColor = (risk.status === 'impossible' || risk.status === 'hard') ? ' chip-red'
              : (risk.status === 'warn' ? ' chip-amber' : ' chip-green');
            var rText = risk.status === 'impossible'
              ? ('平时 ' + risk.partial + ' · 期末满分仍差及格线')
              : ('平时 ' + risk.partial + ' · 期末需 ≥' + risk.needFor60 + ' 保过');
            riskChip = el('span', {
              class: 'chip' + rColor,
              style: { fontSize: '10.5px', marginTop: '3px', alignSelf: 'flex-start' },
              text: rText
            });
          }
          var hasRevTask = (Store.tasks || []).some(function (t) {
            return t && t.status !== 'done' && (t.courseId === c.id || (t.title && t.title.indexOf(c.name) >= 0));
          });
          ebox.appendChild(el('div', { class: 'rec-row', style: { borderTop: 'none' } }, [
            el('i', { class: 'rec-dot', style: { background: '#ef4444' } }),
            el('span', { class: 'rec-main' }, [
              el('b', { text: c.name + (c.examLabel ? ' · ' + c.examLabel : '') }),
              el('span', { text: (ed.getMonth() + 1) + '/' + ed.getDate() + (tt ? ' · ' + tt : '') + (loc ? ' · ' + loc : '') }),
              riskChip
            ]),
            hasRevTask
              ? el('span', { class: 'rec-val', text: '备考中' })
              : el('button', {
                  class: 'btn btn-sm',
                  style: { fontSize: '11.5px', height: '26px', padding: '0 8px' },
                  onclick: function (e) {
                    e.stopPropagation();
                    var dueRev = DateUtil.toStr(DateUtil.addDays(ed, -1));
                    if (dueRev < todayStr) dueRev = todayStr;
                    Store.addTask({
                      title: '复习《' + c.name + '》期末备考',
                      courseId: c.id,
                      dueDate: dueRev,
                      priority: 'high',
                      important: true,
                      energy: 'high',
                      tags: ['学习/考试']
                    });
                    UI.toast('已生成《' + c.name + '》复习待办');
                    view.render();
                  }
                }, ['＋复习待办'])
          ]));
        });
        examSec.appendChild(ebox);
        rightCol.appendChild(examSec);
      }

      /* ---------- 今日记录 ---------- */
      var recSection = el('div', { style: { marginTop: '18px' } });
      recSection.appendChild(el('div', { class: 'section-title' }, [
        '今日记录',
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('tasks', { tab: 'quadrant' }); }
        }, ['打开象限 →'])
      ]));

      var todayStr0 = DateUtil.toStr(today);
      var showSleep = Store.settings.trackSleep;
      var showMeal = Store.settings.trackMeal;
      var recBox = el('div', { class: 'card', style: { padding: '8px 14px' } });
      var rowCount = 0;

      function pushRec(label, value, tone) {
        rowCount++;
        recBox.appendChild(el('div', {
          class: 'rec-row', style: { borderTop: rowCount === 1 ? 'none' : '1px solid var(--line)' },
          onclick: function () { App.go('tasks', { tab: 'quadrant' }); }
        }, [
          el('i', { class: 'rec-dot', style: { background: tone } }),
          el('span', { class: 'rec-main' }, [el('b', { text: label })]),
          el('span', { class: 'rec-val', text: value })
        ]));
      }

      if (showSleep) {
        var sm = Store.sleepMinutes(todayStr0);
        pushRec('睡眠', sm ? TimeUtil.humanMin(sm) : '未记录', '#6366f1');
      }
      if (showMeal) {
        var ms = Store.mealSummary(todayStr0);
        pushRec('饮食', ms.count ? (ms.count + ' 餐 · ¥' + ms.cost + ' · ' + ms.kcal + ' kcal') : '未记录', '#ef4444');
      }
      var acts = Store.activitiesOf(todayStr0);
      var am = 0;
      acts.forEach(function (a) { am += TimeUtil.diffMin(a.start, a.end); });
      pushRec('活动', acts.length ? (acts.length + ' 项 · ' + TimeUtil.humanMin(am)) : '未记录', '#10b981');

      recSection.appendChild(recBox);
      rightCol.appendChild(recSection);

      /* ---------- 健康提示（阈值用户自定，可关） ---------- */
      var hc = Store.settings.health;
      if (hc && hc.on) {
        var hints = [];
        var smH = Store.sleepMinutes(todayStr0);
        if (hc.sleepMinH > 0 && smH > 0 && smH < hc.sleepMinH * 60) {
          hints.push('昨晚只睡了 ' + TimeUtil.humanMin(smH) + '，注意补觉');
        }
        var dietGoal = (Store.settings.diet && Store.settings.diet.goal) || 0;
        if (hc.kcalOver && dietGoal > 0) {
          var kcalToday = Store.mealSummary(todayStr0).kcal;
          if (kcalToday > dietGoal) hints.push('今天热量已超目标 ' + (kcalToday - dietGoal) + ' kcal');
        }
        if (hc.activityMinH > 0) {
          var amAct = 0;
          Store.activitiesOf(todayStr0).forEach(function (a) { amAct += TimeUtil.diffMin(a.start, a.end); });
          if (amAct < hc.activityMinH * 60) {
            hints.push('今天活动还差 ' + TimeUtil.humanMin(hc.activityMinH * 60 - amAct));
          }
        }
        if (hints.length) {
          var hintSec = el('div', { style: { marginTop: '18px' } });
          hintSec.appendChild(el('div', { class: 'section-title' }, ['健康提示']));
          var hBox = el('div', { class: 'card', style: { padding: '10px 14px' } });
          hints.forEach(function (t) {
            hBox.appendChild(el('div', { class: 'rec-row', style: { borderTop: 'none' } }, [
              el('i', { class: 'rec-dot', style: { background: '#14b8a6' } }),
              el('span', { class: 'rec-main' }, [el('span', { text: t })])
            ]));
          });
          hintSec.appendChild(hBox);
          rightCol.appendChild(hintSec);
        }
      }

      /* 今日页不再放「时间统计 / 积分累计」卡片：统计入口统一在「待办 → 统计」，
         积分只在奖励页看，首页保持只讲今天该做什么。 */

      /* ---------- 今日计划 ---------- */
      var planSec = planSection();
      if (planSec) rightCol.appendChild(planSec);

      /* ---------- 即将到来 ---------- */
      var upcoming = Store.rootPending().filter(function (t) {
        var left = t.dueDate ? DateUtil.daysLeft(t.dueDate) : 999;
        return left > 0 && left <= 7;
      }).sort(function (a, b) {
        if (!!a.important !== !!b.important) return a.important ? -1 : 1;
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        var ta = a.dueTime || '23:59', tb = b.dueTime || '23:59';
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      }).slice(0, 4);

      if (upcoming.length) {
        var up = el('div', { style: { marginTop: '18px' } });
        up.appendChild(el('div', { class: 'section-title' }, ['未来 7 天']));
        var upBox = el('div', { class: 'card', style: { padding: '6px 8px' } });
        upcoming.forEach(function (t) { upBox.appendChild(TaskRow.build(t, { compact: true })); });
        up.appendChild(upBox);
        rightCol.appendChild(up);
      }

      root.appendChild(el('div', { class: 'today-cols' }, [leftCol, rightCol]));
    }
  };

  /** 今日计划：未完成计划 + 一键打卡 */
  function planSection() {
    var list = Store.plans.filter(function (p) { return !p.done; });
    if (!list.length) return null;

    var sec = el('div', { style: { marginTop: '18px' } });
    sec.appendChild(el('div', { class: 'section-title' }, [
      '今日计划',
      el('a', {
        class: 'more', href: 'javascript:void 0',
        onclick: function () { App.go('plans'); }
      }, ['全部 →'])
    ]));

    var box = el('div', { class: 'card', style: { padding: '4px 8px' } });
    list.slice(0, 4).forEach(function (p) {
      var pg = Store.planProgress(p);
      var done = Store.planDoneToday(p);
      var exempt = !done && Store.planExemptedOn(p);
      var isCheckin = global.isCheckinLike ? global.isCheckinLike(p) : (p.type === 'checkin' || p.type === 'quota');

      var mark = el('button', {
        class: 'task-check' + (done ? ' done' : ''),
        title: isCheckin ? '点击打卡' : '查看进度',
        onclick: function (e) {
          e.stopPropagation();
          if (isCheckin) {
            var res = Store.togglePlanCheckin(p.id);
            if (res && res.completed) UI.toast('计划完成！+' + (res.gain || 0) + ' 积分');
            else if (res && res.gain) UI.toast('打卡成功，+' + res.gain + ' 积分');
          } else {
            App.go('plans');
          }
        }
      }, done ? [V.svg(V.icons.check, 13)] : []);

      var row = el('div', {
        class: 'task-row',
        onclick: function () { App.go('plans'); }
      }, [
        mark,
        el('div', { class: 'task-main' }, [
          el('div', { class: 'task-title', text: p.title }),
          el('div', { class: 'task-meta' }, [
            el('span', { text: isCheckin
              ? (done ? '今日已打卡' : exempt ? '今天缓一缓 · 不算断签' : '今日待打卡')
              : ('进度 ' + pg.value + ' / ' + pg.target + (p.unit ? ' ' + p.unit : '')) }),
            el('span', { class: 'plan-mini-bar' }, [
              el('i', { style: { width: pg.pct + '%', background: p.color } })
            ])
          ])
        ]),
        el('span', {
          style: { fontSize: '11.5px', fontWeight: '600', color: p.color, flex: '0 0 auto' },
          text: pg.pct + '%'
        }),
        el('button', {
          class: 'icon-btn',
          title: '查看打卡日程历史',
          style: { width: '26px', height: '26px', fontSize: '12px', flex: '0 0 auto' },
          onclick: function (e) {
            e.stopPropagation();
            if (global.openCheckinScheduleModal) global.openCheckinScheduleModal(p);
          }
        }, ['🗓️'])
      ]);
      box.appendChild(row);
    });
    sec.appendChild(box);
    return sec;
  }

  function statBlock(num, label) {
    return el('div', { style: { minWidth: '52px' } }, [
      el('div', { style: { fontSize: '21px', fontWeight: '700', lineHeight: '1.15' }, text: String(num) }),
      el('div', { style: { fontSize: '10.5px', opacity: '.78', marginTop: '2px' }, text: label })
    ]);
  }

  function doneTodayCount() {
    var todayStr = DateUtil.toStr(DateUtil.today());
    return Store.tasks.filter(function (t) {
      return t.status === 'done' && t.doneAt && t.doneAt.slice(0, 10) === todayStr;
    }).length;
  }

  /** 今日时间线：课程 + 一次性日程合并；withOff=true 时把被停/调走的课灰显带出来 */
  function buildDayItems(courses, dateStr, withOff) {
    var items = [];
    courses.forEach(function (c) {
      var t = Store.courseTime(c) || { start: '--:--', end: '--:--', label: '—' };
      items.push({
        kind: 'course', sort: t.start, start: t.start, end: t.end,
        title: c.name,
        sub: [c.location, c.teacher].filter(Boolean).join(' · ') || t.label,
        color: c.color, course: c,
        moveFrom: c._moveIn ? c._moveFrom : '',      // 调进来的：显示「调自 X/X」
        roomChanged: c._exRoom || ''                 // 换过教室的：显示「换教室」
      });
    });
    if (withOff) {
      Store.canceledLessonsOn(dateStr).forEach(function (c) {
        var t = Store.courseTime(c) || { start: '--:--', end: '--:--', label: '—' };
        items.push({
          kind: 'course-off', sort: t.start, start: t.start, end: t.end,
          title: c.name,
          sub: [c.location, c.teacher].filter(Boolean).join(' · ') || t.label,
          color: c.color, course: c,
          offType: c._off, moveTo: c._moveTo || ''
        });
      });
    }
    Store.examsOf(dateStr).forEach(function (e) {
      items.push({
        kind: 'exam', sort: e.start || '08:00', start: e.start || '—', end: e.end || '—',
        title: e.name + ' 考试',
        sub: [e.location, '课程考试'].filter(Boolean).join(' · '),
        color: '#ef4444', courseId: e.courseId
      });
    });
    Store.eventsOf(dateStr).forEach(function (e) {
      items.push({
        kind: 'event', sort: e.start, start: e.start, end: e.end,
        title: e.title, sub: [e.location, e.note].filter(Boolean).join(' · ') || '一次性日程',
        color: '#ec4899', event: e
      });
    });
    items.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    return items;
  }

  /** 今日时间线 */
  function courseTimeline(items, now) {
    var wrap = el('div', { class: 'card', style: { padding: '14px 16px' } });

    items.forEach(function (it, i) {
      var start = timeToDate(it.start);
      var end = timeToDate(it.end);
      var isOff = it.kind === 'course-off';
      var state = isOff ? 'off' : (now < start ? 'future' : (now > end ? 'past' : 'now'));

      var stateChip;
      if (state === 'off') {
        // 停课 / 已调走：灰色说明chip，不再给倒计时
        stateChip = el('span', { class: 'chip', style: { background: 'var(--bg-2, #eef0f5)', color: 'var(--text-3)' },
          text: it.offType === 'move' ? ('已调走 · 调至 ' + (it.moveTo || '').slice(5).replace('-', '/')) : '本次停课' });
      } else if (state === 'now') stateChip = el('span', { class: 'chip chip-green', text: '进行中' });
      else if (state === 'past') stateChip = el('span', { class: 'chip', text: '已结束' });
      else {
        var mins = Math.round((start - now) / 60000);
        stateChip = el('span', {
          class: 'chip ' + (mins <= 60 ? 'chip-amber' : 'chip-blue'),
          text: mins <= 60 ? (mins + ' 分钟后') : ('约 ' + Math.round(mins / 60) + ' 小时后')
        });
      }

      var row = el('div', {
        style: {
          display: 'flex', gap: '12px', padding: '11px 0',
          borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--line)',
          opacity: state === 'past' ? '.62' : (isOff ? '.55' : '1')
        }
      }, [
        el('div', { style: { width: '48px', flex: '0 0 48px', textAlign: 'right', paddingTop: '1px' } }, [
          el('div', { style: { fontSize: '13px', fontWeight: '650', color: state === 'now' ? 'var(--primary)' : 'var(--text)' }, text: it.start }),
          el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: it.end })
        ]),
        el('div', { style: { position: 'relative', width: '10px', flex: '0 0 10px' } }, [
          el('i', {
            style: {
              position: 'absolute', left: '2px', top: '6px', width: '8px', height: '8px',
              borderRadius: '50%', background: it.color,
              boxShadow: state === 'now' ? '0 0 0 4px ' + hexA(it.color, .18) : 'none'
            }
          })
        ]),
        el('div', {
          style: { flex: '1', minWidth: '0', cursor: 'pointer' },
          onclick: function () {
            if (it.kind === 'course' || isOff) global.__CourseDialog.detail(it.course.id);
            else if (it.kind === 'exam') { if (it.courseId) global.__CourseDialog.detail(it.courseId); }
            else global.EventDetail.open(it.event.id);
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('b', {
              style: { fontSize: '14px', fontWeight: '650', textDecoration: isOff ? 'line-through' : 'none' },
              text: it.title
            }),
            it.kind === 'course' && it.moveFrom ? el('span', { class: 'chip chip-blue', text: '调自 ' + it.moveFrom.slice(5).replace('-', '/') }) : null,
            it.kind === 'course' && it.roomChanged ? el('span', { class: 'chip chip-amber', text: '换教室' }) : null,
            it.kind === 'event' ? el('span', { class: 'chip chip-primary', text: '日程' }) : null,
            it.kind === 'exam' ? el('span', { class: 'chip chip-red', text: '考试' }) : null,
            stateChip,
            // 单次调整入口：今天这节课 停课/换教室/调课 就在这里点
            (it.kind === 'course' || isOff) ? el('button', {
              class: 'chip lesson-adj-btn',
              text: '调整',
              onclick: function (e) {
                e.stopPropagation();
                if (global.__LessonDialog) global.__LessonDialog.open(it.course.id, DateUtil.toStr(DateUtil.today()));
              }
            }) : null,
            // 考勤：点一下选出勤 / 缺勤 / 请假，同一天只留一条
            (it.kind === 'course' && !isOff) ? (function () {
              var ds = DateUtil.toStr(DateUtil.today());
              var rec = Store.attendanceFor ? Store.attendanceFor(it.course.id, ds) : null;
              var meta = rec && {
                present: ['chip-green', '✅ 出勤'],
                absent: ['chip-red', '❌ 缺勤'],
                leave: ['chip-amber', '📝 请假']
              }[rec.status];
              return el('button', {
                class: 'chip ' + (meta ? meta[0] : ''),
                style: { cursor: 'pointer', border: 'none' },
                text: meta ? meta[1] : '考勤',
                onclick: function (e) {
                  e.stopPropagation();
                  openAttendanceMenu(it.course, ds, view);
                }
              });
            })() : null,
            // 联动 1.5：今日课程一键记录「本节课学了什么」（章节进度/知识点/掌握度）
            (it.kind === 'course' && !isOff) ? el('button', {
              class: 'cp-chip cp-lesson-adj-btn',
              text: '📖 记所学',
              onclick: function (e) {
                e.stopPropagation();
                if (global.CourseLogDialog) {
                  global.CourseLogDialog.open(null, {
                    courseId: it.course.id,
                    date: DateUtil.toStr(DateUtil.today()),
                    week: Store.currentWeek(),
                    day: DateUtil.isoDow(DateUtil.today()),
                    onDone: function () { view.render(); }
                  });
                }
              }
            }) : null,
            // 联动 2：今日课程一键记课堂灵感/笔记（自动带 #课程名 标签）
            (it.kind === 'course' && !isOff) ? el('button', {
              class: 'cp-chip cp-lesson-adj-btn',
              text: '📝 记笔记',
              onclick: function (e) {
                e.stopPropagation();
                openQuickCourseNoteDialog(it.course);
              }
            }) : null,
            // 联动 A：体育/运动类课程一键记入锻炼
            (it.kind === 'course' && !isOff && Store.isPeCourse && Store.isPeCourse(it.course)) ? (function () {
              var dsNow = DateUtil.toStr(DateUtil.today());
              var loggedW = (Store.workouts || []).some(function (w) {
                return w && w.date === dsNow && (w.courseId === it.course.id || w.name === it.course.name);
              });
              return el('button', {
                class: 'chip ' + (loggedW ? 'chip-green' : 'chip-blue'),
                style: { cursor: 'pointer', border: 'none' },
                text: loggedW ? '✓ 已记锻炼' : '🏃 记入锻炼',
                onclick: function (e) {
                  e.stopPropagation();
                  if (loggedW) {
                    App.go('health', { tab: 'workout' });
                    return;
                  }
                  var w = Store.logCourseWorkout(it.course.id, dsNow);
                  if (w) {
                    UI.toast('已将《' + it.course.name + '》记入今日锻炼（+' + w.duration + ' 分钟，已同步象限与计划）！', 'ok');
                    view.render();
                  }
                }
              });
            })() : null
          ]),
          el('div', {
            style: {
              fontSize: '12px', color: 'var(--text-3)', marginTop: '2px',
              textDecoration: isOff ? 'line-through' : 'none'
            },
            text: it.sub
          })
        ])
      ]);
      wrap.appendChild(row);
    });

    return wrap;
  }

  /** 今日课程卡上的考勤快捷入口：出勤 / 缺勤 / 请假 / 清除 */
  function openAttendanceMenu(course, dateStr, view) {
    if (!course || !Store.markAttendance) return;
    var cur = Store.attendanceFor ? Store.attendanceFor(course.id, dateStr) : null;
    var pick = function (status, label) {
      Store.markAttendance(course.id, dateStr, status);
      V.toast(label);
      if (view && view.render) view.render();
    };
    var items = [
      { label: '✅ 出勤', hint: cur && cur.status === 'present' ? '当前' : '', onClick: function () { pick('present', '已记出勤'); } },
      { label: '❌ 缺勤', hint: cur && cur.status === 'absent' ? '当前' : '', onClick: function () { pick('absent', '已记缺勤'); } },
      { label: '📝 请假', hint: cur && cur.status === 'leave' ? '当前' : '', onClick: function () { pick('leave', '已记请假'); } }
    ];
    if (cur) {
      items.push({
        label: '清除标记', danger: true,
        onClick: function () {
          Store.markAttendance(course.id, dateStr, '');
          V.toast('已清除考勤标记');
          if (view && view.render) view.render();
        }
      });
    }
    V.moveMenu('考勤 · ' + (course.name || '课程'), items);
  }

  function openQuickCourseNoteDialog(course) {
    if (!course) return;
    var ta = V.textarea({
      rows: 4,
      placeholder: '随手记下《' + course.name + '》的课堂重点、公式、老师划的考点或作业要求…',
      dataset: { autofocus: '1' }
    });
    var nm = V.modal({
      title: '📝 课堂笔记 · ' + course.name,
      width: '440px',
      autofocus: true,
      body: [
        ta,
        el('div', { class: 'ocr-hint', text: '保存后会自动打上 #' + course.name + ' 与 #课堂笔记 标签，可在「课程详情」或「灵感」页随时查看。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { nm.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存笔记',
          onclick: function () {
            var val = ta.value.trim();
            if (!val) { UI.toast('先写点内容吧', 'err'); ta.focus(); return; }
            if (Store.addCourseNote) Store.addCourseNote(course.id, val);
            else Store.addNote({ content: val, tags: [course.name, '课堂笔记'] });
            nm.close();
            UI.toast('已保存到《' + course.name + '》课堂笔记', 'ok');
          }
        })
      ])
    });
  }
  global.openQuickCourseNoteDialog = openQuickCourseNoteDialog;

  function hexA(hex, a) {
    var h = (hex || '#4f46e5').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


