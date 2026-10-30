/* ==========================================================
 * 目标（计划页的第二个分页）
 * ----------------------------------------------------------
 * 一个目标 = 一句「想变成什么样」+ 2–4 条关键结果（KR）。
 * 每条 KR 只回答一个问题：到某个时间点，用什么数字证明它成了。
 *
 * 刻意的取舍（与路线图决策一致）：
 * - 进度等权平均，不做权重：个人场景里权重基本靠拍脑袋。
 * - 没有可统计数据的 KR 不进分母：刚建好就显示 0% 会让人不想再打开。
 * - 到期不删除、不扣分，只是挪到「已归档」，进度按周期冻结。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var ICON = (V.icons && (V.icons.target || V.icons.flag)) || [];

  function todayStr() { return DateUtil.toStr(DateUtil.today()); }

  function daysBetween(a, b) {
    var d1 = DateUtil.parse(a), d2 = DateUtil.parse(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  }

  function kindOf(key) {
    var list = Store.KR_KINDS || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[list.length - 1];
  }

  function fmtNum(n) {
    var v = Number(n) || 0;
    return String(Math.round(v * 10) / 10);
  }

  var activeGroupFilter = 'all';

  function groupMetaOf(key) {
    var list = Store.GOAL_GROUPS || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return list[0] || { key: 'study', name: '学业进阶', icon: '📚', color: '#4f46e5' };
  }

  function krKindIcon(kind) {
    var map = {
      manual: '🎯',
      plan: '📅',
      task: '✅',
      grade: '🎓',
      focus: '🍅',
      sleep: '😴',
      active: '🏃',
      workout: '🏋️',
      diet: '🥗',
      weight: '⚖️',
      budget: '💰'
    };
    return map[kind] || '🎯';
  }

  /* ==========================================================
   * Vis OKR 水位填充式关键结果缩略卡 (2-Column Water-Level KR Card)
   * ========================================================== */
  function krRow(g, kr, row, archived) {
    var grp = groupMetaOf(g.group);
    var accent = kr.color || grp.color || '#4f46e5';
    var pctNum = row.pct != null ? Math.max(0, Math.min(100, Math.round(row.pct * 100))) : 0;

    var node = el('div', {
      class: 'goal-kr goal-kr-water',
      style: {
        position: 'relative',
        overflow: 'hidden',
        padding: '10px 11px 11px',
        borderRadius: '12px',
        border: '1px solid ' + accent + '38',
        background: 'linear-gradient(90deg, ' + accent + '24 ' + pctNum + '%, ' + accent + '08 ' + pctNum + '%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: '8px',
        minHeight: '74px',
        width: '100%',
        boxSizing: 'border-box'
      }
    });

    // 底部水位进度指示细条（即使 0% 也有清晰底槽，推进时呈水位上涨感）
    node.appendChild(el('div', {
      class: 'goal-kr-water-bar',
      style: {
        position: 'absolute', left: '0', right: '0', bottom: '0',
        height: '3px', background: accent + '1f', pointerEvents: 'none'
      }
    }, [
      el('i', {
        style: {
          display: 'block', height: '100%', width: pctNum + '%',
          background: row.pct >= 1 ? 'var(--green)' : accent,
          transition: 'width .25s ease'
        }
      })
    ]));

    var topRow = el('div', {
      class: 'goal-kr-top',
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '6px', width: '100%', boxSizing: 'border-box'
      }
    });
    var left = el('div', {
      class: 'goal-kr-main',
      style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0', flex: '1' }
    }, [
      el('span', {
        class: 'goal-kr-thumb',
        style: {
          width: '20px', height: '20px', borderRadius: '6px',
          background: accent + '22', color: accent, fontSize: '11px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flex: '0 0 20px', lineHeight: '1'
        },
        text: krKindIcon(kr.kind)
      }),
      el('span', {
        class: 'goal-kr-title',
        style: {
          fontWeight: '650', fontSize: '12.5px', color: 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        },
        text: kr.title
      })
    ]);
    topRow.appendChild(left);

    if (row.pct != null && !row.missing && !row.empty) {
      topRow.appendChild(el('span', {
        class: 'chip' + (row.pct >= 1 ? ' chip-green' : ''),
        style: {
          fontSize: '11px', fontWeight: '700', flex: '0 0 auto',
          background: row.pct >= 1 ? '' : (accent + '1c'),
          color: row.pct >= 1 ? '' : accent,
          padding: '1px 6px'
        },
        text: pctNum + '%'
      }));
    }
    node.appendChild(topRow);

    var right = el('div', {
      class: 'goal-kr-val',
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '6px', width: '100%', boxSizing: 'border-box'
      }
    });
    var valLeft = el('div', {
      style: { display: 'flex', alignItems: 'baseline', gap: '4px', flexWrap: 'wrap', minWidth: '0', flex: '1' }
    });

    if (row.missing) {
      valLeft.appendChild(el('span', { class: 'goal-kr-warn', text: '绑定的计划已删除' }));
    } else if (kr.kind === 'grade' && (row.empty || row.pct == null)) {
      valLeft.appendChild(el('span', { class: 'goal-kr-warn', text: '待出分' }));
    } else if (row.empty) {
      valLeft.appendChild(el('span', {
        class: 'goal-kr-warn',
        text: (kr.kind === 'sleep' || kr.kind === 'active' || kr.kind === 'workout') ? '暂无睡眠/运动数据'
          : (kr.kind === 'diet' ? '暂无饮食记录'
          : (kr.kind === 'weight' ? '暂无体重记录'
          : (kr.kind === 'budget' ? '暂无消费账目' : '暂无待办')))
      }));
    } else if (row.pct == null) {
      valLeft.appendChild(el('span', { class: 'goal-kr-warn', text: '未填' }));
    } else if (kr.kind === 'budget') {
      var withinBudget = row.value <= row.target;
      valLeft.appendChild(el('span', {
        class: 'goal-kr-count',
        style: { fontSize: '12px', fontWeight: '650', color: 'var(--text-1)' },
        text: '¥' + fmtNum(row.value) + '/¥' + fmtNum(row.target)
      }));
      valLeft.appendChild(el('span', {
        class: 'chip' + (withinBudget ? ' chip-green' : ' chip-amber'),
        style: { fontSize: '10px', padding: '1px 5px' },
        text: withinBudget ? '守住' : ('超¥' + fmtNum(row.value - row.target))
      }));
    } else {
      valLeft.appendChild(el('span', {
        class: 'goal-kr-count',
        style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' },
        text: fmtNum(row.value) + '/' + fmtNum(row.target) + (row.unit ? ' ' + row.unit : '')
      }));
      if (row.startVal != null && row.startVal !== 0 && row.startVal !== row.target) {
        valLeft.appendChild(el('span', {
          style: { fontSize: '10.5px', color: 'var(--text-3)' },
          text: '(' + fmtNum(row.startVal) + '→' + fmtNum(row.target) + (row.unit || '') + ')'
        }));
      }
    }
    right.appendChild(valLeft);

    // 右下角 Vis OKR 风格「⊕」一键步进按钮（支持 manual / plan / weight）
    if (!archived && (kr.kind === 'manual' || kr.kind === 'plan' || kr.kind === 'weight') && Store.stepKrValue) {
      var stepBtn = el('button', {
        class: 'kr-step-btn',
        type: 'button',
        title: '一键步进打卡 (+' + (kr.step || 1) + (kr.unit || '') + ')',
        style: {
          width: '24px', height: '24px', borderRadius: '50%',
          border: '1.5px solid ' + accent, background: 'var(--surface)',
          color: accent, fontWeight: '700', fontSize: '14px', lineHeight: '1',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flex: '0 0 24px', padding: '0', marginLeft: 'auto'
        },
        onclick: function (ev) {
          ev.stopPropagation();
          var res = Store.stepKrValue(g.id, kr.id);
          if (res && res.ok) {
            V.toast('🎯 「' + kr.title + '」已推进 → ' + fmtNum(res.value) + '/' + fmtNum(res.target) + (res.unit || '') +
                    (res.goalPctDelta > 0 ? ('（目标 +' + res.goalPctDelta + '%）') : ''), 'ok');
            renderPane();
          }
        }
      }, ['+']);
      right.appendChild(stepBtn);
    }

    node.appendChild(right);

    // 自己填的 KR：点卡片主体就能改数字，不用进编辑弹窗
    if (kr.kind === 'manual') {
      node.classList.add('cp-is-manual');
      node.title = '点一下填当前值';
      node.addEventListener('click', function () { quickFill(g, kr); });
    }
    return node;
  }

  function goalRingThumb(pct, color, iconText) {
    var r = 15, c = 2 * Math.PI * r;
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    var dash = (p / 100) * c;
    var box = el('div', {
      class: 'goal-ring-thumb',
      style: {
        width: '38px', height: '38px', flex: '0 0 38px',
        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
      }
    });
    box.innerHTML =
      '<svg width="38" height="38" viewBox="0 0 38 38" style="transform:rotate(-90deg)">' +
      '<circle cx="19" cy="19" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="3.5"></circle>' +
      '<circle cx="19" cy="19" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + c.toFixed(1) + '"></circle>' +
      '</svg>' +
      '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1">' + iconText + '</span>';
    return box;
  }

  function goalCard(g, archived) {
    var pg = Store.goalProgressOf(g);
    var today = todayStr();
    var left = daysBetween(today, g.endDate);
    var overdue = Store.goalsArchived().indexOf(g) >= 0 && !g.archivedAt;
    var grp = groupMetaOf(g.group);

    var card = el('div', {
      class: 'card plan-card goal-card' + (archived ? ' is-archived' : ''),
      style: { borderTop: '3px solid ' + grp.color },
      dataset: { id: g.id, rec: 'goal:' + g.id }
    });

    /* 标题行（带左上角环形进度缩略图 + 右侧领域胶囊与百分比） */
    var chip = g.archivedAt
      ? el('span', { class: 'chip', text: '已归档' })
      : (overdue ? el('span', { class: 'chip chip-amber', text: '已到期' })
      : el('span', { class: 'chip', style: { background: grp.color + '1c', color: grp.color, fontWeight: '600' }, text: grp.icon + ' ' + grp.name }));

    card.appendChild(el('div', { class: 'plan-top', style: { alignItems: 'center', gap: '10px' } }, [
      goalRingThumb(pg.pct, grp.color, grp.icon),
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { class: 'plan-title', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
          el('span', { text: g.title })
        ]),
        g.note ? el('div', { class: 'goal-note', text: g.note }) : el('div', {
          class: 'goal-note',
          style: { marginTop: '2px' },
          text: g.startDate + ' ~ ' + g.endDate + ' · ' + (archived ? '已归档' : (left >= 0 ? ('还剩 ' + left + ' 天') : '已到期'))
        })
      ]),
      el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flex: '0 0 auto' } }, [
        el('span', { style: { fontSize: '16px', fontWeight: '800', color: grp.color, lineHeight: '1.1' }, text: pg.pct + '%' }),
        chip
      ])
    ]));

    /* 进度条 */
    card.appendChild(el('div', { class: 'plan-bar' }, [
      el('i', { style: { width: pg.pct + '%', background: grp.color } })
    ]));

    /* 关键结果（Vis OKR 双列水位缩略图卡片网格：手机与桌面均保持双列缩略图排布） */
    var krBox = el('div', {
      class: 'goal-krs goal-krs-grid',
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '8px',
        marginTop: '10px'
      }
    });
    if (!pg.rows.length) {
      krBox.appendChild(el('div', {
        class: 'goal-empty-kr',
        style: { gridColumn: '1 / -1' },
        text: '还没有关键结果，编辑目标补一条。'
      }));
    } else {
      pg.rows.forEach(function (row) {
        var kr = (g.krs || []).filter(function (k) { return k.id === row.id; })[0] || {};
        krBox.appendChild(krRow(g, kr, row, archived));
      });
      // 若仅有 1 条 KR 且未归档，在双列网格右侧放一张轻量虚线「+ 添加关键结果」缩略槽位，保持双列缩略卡视觉平衡
      if (pg.rows.length === 1 && !archived) {
        krBox.appendChild(el('button', {
          class: 'goal-kr-add-slot',
          type: 'button',
          style: {
            minHeight: '74px', borderRadius: '12px', border: '1px dashed var(--line-strong)',
            background: 'transparent', color: 'var(--text-3)', fontSize: '12px', fontWeight: '600',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '4px', cursor: 'pointer', padding: '8px', width: '100%', boxSizing: 'border-box'
          },
          onclick: function () { openGoalDialog(g.id); }
        }, [
          el('span', { style: { fontSize: '15px', lineHeight: '1' }, text: '＋' }),
          el('span', { text: '添加关键结果' })
        ]));
      }
    }
    card.appendChild(krBox);

    /* 第 4 级：关联的每日微行动与日程拆解（Vis OKR 目标 -> KR -> 每日微行动闭环） */
    var microList = Store.krMicroActions ? Store.krMicroActions(g.id) : [];
    if (!archived) {
      var microWrap = el('div', {
        class: 'goal-micro-section',
        style: {
          marginTop: '10px', padding: '9px 11px', borderRadius: '8px',
          background: 'var(--bg-2)', border: '1px dashed var(--line)'
        }
      });
      var microHead = el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: microList.length ? '6px' : '0' }
      }, [
        el('span', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-2)' }, text: '⚡ 第 4 级细化 · 每日微行动与日程排期（' + microList.length + '）' }),
        el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'btn btn-sm',
            style: { height: '24px', padding: '0 8px', fontSize: '11px' },
            onclick: function () {
              var firstKr = (g.krs && g.krs[0]) ? g.krs[0] : null;
              if (global.TaskDialog) {
                global.TaskDialog.open(null, {
                  goalId: g.id,
                  krId: firstKr ? firstKr.id : '',
                  energy: 'high',
                  dueDate: todayStr()
                });
              }
            }
          }, ['+ 拆解待办微行动']),
          el('button', {
            class: 'btn btn-sm',
            style: { height: '24px', padding: '0 8px', fontSize: '11px' },
            onclick: function () {
              if (global.openPlanDialog) {
                openPlanDialog({
                  title: '坚持: ' + g.title,
                  target: 30,
                  unit: '天'
                });
              }
            }
          }, ['+ 拆解习惯打卡'])
        ])
      ]);
      microWrap.appendChild(microHead);

      if (microList.length) {
        var mListEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } });
        microList.slice(0, 5).forEach(function (ma) {
          mListEl.appendChild(el('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
              padding: '5px 8px', borderRadius: '6px', background: 'var(--surface)',
              fontSize: '12px', opacity: ma.done ? '0.65' : '1'
            }
          }, [
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0', flex: '1' } }, [
              el('span', {
                style: { fontSize: '10.5px', padding: '1px 5px', borderRadius: '4px', background: ma.type === 'plan' ? '#10b98122' : '#0ea5e922', color: ma.type === 'plan' ? '#10b981' : '#0ea5e9', fontWeight: '600' },
                text: ma.type === 'plan' ? '习惯' : '待办'
              }),
              el('span', {
                style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: ma.done ? 'line-through' : 'none', cursor: 'pointer' },
                text: ma.title,
                onclick: function () {
                  if (ma.type === 'task' && global.TaskDialog) global.TaskDialog.open(ma.id);
                }
              }),
              el('span', { style: { fontSize: '11px', color: 'var(--text-3)', flex: '0 0 auto' }, text: '· ' + ma.scheduleText })
            ]),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' } }, [
              el('span', {
                style: { fontSize: '11px', fontWeight: '700', color: 'var(--green)' },
                title: '完成该微行动预计对目标的复利进度贡献',
                text: '⬆️ +' + ma.contribPct + '%'
              }),
              !ma.done ? el('button', {
                class: 'btn btn-sm',
                style: { height: '22px', padding: '0 7px', fontSize: '11px' },
                onclick: function () {
                  if (ma.type === 'plan') {
                    Store.togglePlanCheckin(ma.id, todayStr());
                    V.toast('已打卡微行动「' + ma.title + '」 ⬆️ +' + ma.contribPct + '%', 'ok');
                  } else {
                    Store.updateTask(ma.id, { status: 'done' });
                    V.toast('已完成微行动「' + ma.title + '」 ⬆️ +' + ma.contribPct + '%', 'ok');
                  }
                  renderPane();
                }
              }, [ma.doneToday ? '今日已打卡 ✓' : '推进 ✓']) : el('span', { style: { fontSize: '11px', color: 'var(--green)' }, text: '已完成 ✓' })
            ])
          ]));
        });
        microWrap.appendChild(mListEl);
      }
      card.appendChild(microWrap);
    }

    /* 底部：整体进度 + 周期 */
    var foot = el('div', { class: 'plan-foot', style: { marginTop: '10px' } }, [
      el('span', { class: 'plan-num', text: pg.pct + '%' }),
      el('span', {
        text: '总进度' + (pg.counted ? '（' + pg.counted + '/' + pg.total + ' 条可统计）' : '（暂无可统计的关键结果）')
      }),
      el('span', {
        style: { marginLeft: 'auto', color: 'var(--text-3)' },
        text: archived ? (g.endDate + ' 截止')
          : (left >= 0 ? '还剩 ' + left + ' 天' : '已过期')
      })
    ]);
    card.appendChild(foot);

    /* 操作 */
    var acts = el('div', { class: 'plan-foot', style: { marginTop: '8px', gap: '8px' } });
    if (!archived) {
      acts.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: function () { openGoalDialog(g.id); }
      }, [V.svg(V.icons.pen, 14), '编辑']));
      acts.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: function () { archive(g); }
      }, ['归档']));
    } else {
      acts.appendChild(el('button', {
        class: 'btn btn-sm',
        onclick: function () { Store.archiveGoal(g.id, false); V.toast('已恢复到在办'); renderPane(); }
      }, ['恢复']));
      acts.appendChild(el('button', {
        class: 'btn btn-sm btn-danger',
        onclick: function () { remove(g); }
      }, [V.svg(V.icons.trash, 14), '删除']));
    }
    card.appendChild(acts);

  /* ---- 长按拖动排序（整卡可拖，按钮 / KR 行不触发） ---- */
  if (global.DragGesture) {
    var beforeOrder = null;
    DragGesture.makeDraggable(card, {
      ignore: 'button, input, textarea, a, .goal-kr, .icon-btn',
      menuTitle: '目标「' + g.title + '」',
      menu: function () {
        return DragGesture.orderMenuItems('goals', g.id, function (x) { return !x.archivedAt; });
      },
      onStart: function () {
        beforeOrder = DragGesture.orderedIds(card.parentNode, '.cp-goal-card');
      },
      onMove: function (c) {
        DragGesture.moveWithin(card.parentNode, card, c.overEl, c.evt.clientY, '.cp-goal-card');
        DragGesture.showDropHint(c.overEl, c.evt.clientY, '.cp-goal-card');
      },
      onEnd: function (c) {
        var ids = DragGesture.orderedIds(card.parentNode, '.cp-goal-card');
        if (ids.length > 1) {
          Store.reorderInView('goals', ids);
          if (beforeOrder && beforeOrder.join(',') !== ids.join(',')) {
            UI.toastAction('已调整目标顺序', {
              onAction: function () { Store.reorderInView('goals', beforeOrder); }
            });
          }
        }
      }
    });
  }

  return card;
  }

  function archive(g) {
    var pg = Store.goalProgressOf(g);
    var willReward = !g.rewardedAt && pg.pct >= 100 && Store.goalDays(g) >= Store.GOAL_MIN_DAYS;
    var tail = willReward
      ? '\n\n这个目标已经推进到 100%，归档会发 ' + POMO.GOAL_DONE + ' 积分（只发一次）。'
      : '';
    V.confirm({
      title: '归档这个目标？',
      message: '归档不会删除任何数据，进度会按目标周期停住，之后还能在「已归档」里找到并恢复。没达成就没达成，不算失败。' + tail,
      okText: '归档'
    }).then(function (ok) {
      if (!ok) return;
      Store.archiveGoal(g.id, true);
      V.toast('已归档');
      renderPane();
    });
  }

  function remove(g) {
    V.confirm({
      title: '删除这个目标？',
      message: '只删目标本身，它引用的计划、待办都不动。',
      danger: true, okText: '删除'
    }).then(function (ok) {
      if (!ok) return;
      Store.removeGoal(g.id);
      V.toast('已删除');
      renderPane();
    });
  }

  /* ==========================================================
   * 月末复盘
   * ========================================================== */
  function reviewCard() {
    var today = todayStr();
    if (!Store.goalReviewDue(Store.state.settings, today)) return null;
    var active = Store.goalsActive();
    if (!active.length) return null;

    var lines = active.map(function (g) {
      return { title: g.title, pct: Store.goalProgressOf(g).pct };
    });
    var text = Store.goalReviewText(lines, today);

    /* 健康段：只在开了健康看板、本月又有记录时附在后面。
       和目标数字放一起，是因为复盘时最容易漏掉的恰恰是「这个月身体怎么样」。 */
    var healthLines = Store.healthReviewLines ? Store.healthReviewLines(today) : [];
    if (healthLines.length) text += '\n\n【这个月的身体】\n' + healthLines.join('\n');

    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '12px' } }, [
      el('div', { class: 'section-title' }, ['月末了，回顾一下']),
      el('div', { class: 'goal-note', text: '这个月几个目标推进得怎么样？点「写进日记」会把下面的数字填进今天的日记，剩下的交给你自己写。' }),
      el('pre', {
        style: {
          margin: '10px 0 12px', padding: '10px 12px', background: 'var(--surface-2)',
          border: '1px solid var(--line)', borderRadius: '8px',
          fontSize: '12.5px', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: '1.8'
        },
        text: text
      })
    ]);

    var row = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    row.appendChild(el('button', {
      class: 'btn btn-primary',
      onclick: function () {
        if (!global.DiaryPane) return;
        DiaryPane.appendPlain(text, today, function () {
          // 真的存进日记了才算一次复盘（点开又取消不算）
          Store.bumpUsage('goalReview');
          // 写完跳到日记分页，正好接着往下写
          if (global.App) App.go('tasks', { tab: 'diary' });
        });
      }
    }, [V.svg(V.icons.book, 16), '写进今天的日记']));
    row.appendChild(el('button', {
      class: 'btn',
      onclick: function () {
        Store.state.settings.goals.reviewDismissed = today.slice(0, 7);
        Store.save();
        V.toast('这个月不再提醒');
        renderPane();
      }
    }, ['这个月不再提醒']));
    card.appendChild(row);
    return card;
  }

  /* ==========================================================
   * 分页渲染
   * ========================================================== */
  var HOST = null;

  function renderPane() {
    if (HOST) GoalsPane.render(HOST);
  }

  var GoalsPane = {
    render: function (host) {
      HOST = host;
      // 目标到期是惰性的（没有写入动作），进页面时补一次结算
      Store.settleGoals();
      host.innerHTML = '';

      var active = Store.goalsActive();
      var archived = Store.goalsArchived();
      var avg = active.length
        ? Math.round(active.reduce(function (s, g) { return s + Store.goalProgressOf(g).pct; }, 0) / active.length)
        : 0;
      var krTotal = active.reduce(function (s, g) { return s + (g.krs || []).length; }, 0);
      var compound = Store.goalCompoundSummary ? Store.goalCompoundSummary(todayStr()) : {
        avgPct: avg, todayAddedPct: 0, todayRecords: 0, tenDayIndex: 1, dayInCycle: 1, daysLeftInCycle: 10, groups: []
      };

      /* ---- 0) 待办/习惯/目标三层定位指引 ---- */
      host.appendChild(el('div', {
        class: 'card cp-okr-guide-card',
        style: {
          padding: '10px 14px', marginBottom: '10px',
          background: 'rgba(79,70,229,0.05)', border: '1px dashed var(--primary-weak, rgba(79,70,229,0.22))',
          borderRadius: '8px', fontSize: '11.5px', color: 'var(--text-2)', lineHeight: '1.6'
        }
      }, [
        el('div', { style: { fontWeight: '700', color: 'var(--primary)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
          el('span', { text: '🎯 目标 · 📅 习惯 · ✅ 待办 协同体系' })
        ]),
        el('div', { text: '• 🎯 目标(OKR)：宏观长期愿景与关键成果指标（“我去哪里”，统领方向）；' }),
        el('div', { text: '• 📅 习惯打卡：每日/周期的规律打卡习惯与连击（“我如何持续”，保持节奏）；' }),
        el('div', { text: '• ✅ 待办清单：具体执行事项与截止日（“我今天具体做什么”，清空负荷）。' })
      ]));

      /* ---- 1) Vis OKR 复利摘要大盘 (多彩环形图 + 今日增加进度 + 第 N 个 10 天微周期) ---- */
      var ringSvg = (function () {
        var r = 34, c = 2 * Math.PI * r;
        var pctVal = Math.max(0, Math.min(100, compound.avgPct || avg));
        var dash = (pctVal / 100) * c;
        var svgHtml = '<svg viewBox="0 0 84 84" style="width:84px;height:84px;min-width:84px;min-height:84px;flex:0 0 84px;display:block;overflow:visible;">' +
          '<circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="8" style="fill:none;stroke:var(--line);stroke-width:8px;"></circle>' +
          '<circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--primary)" stroke-width="8" stroke-linecap="round" ' +
          'stroke-dasharray="' + dash.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 42 42)" style="fill:none;stroke:var(--primary);stroke-width:8px;stroke-linecap:round;transition:stroke-dasharray .4s ease;"></circle>' +
          '<text x="42" y="38" text-anchor="middle" font-size="14" font-weight="800" fill="var(--text-1)" style="fill:var(--text-1);stroke:none;font-size:14px;font-weight:800;text-anchor:middle;dominant-baseline:central;">' + pctVal + '%</text>' +
          '<text x="42" y="53" text-anchor="middle" font-size="9.5" fill="var(--text-3)" style="fill:var(--text-3);stroke:none;font-size:9.5px;font-weight:500;text-anchor:middle;dominant-baseline:central;">总目标进度</text>' +
          '</svg>';
        var box = el('div', { class: 'cp-goal-ring-box', style: { flex: '0 0 84px', width: '84px', height: '84px', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
        box.innerHTML = svgHtml;
        return box;
      })();

      var tenDots = '';
      for (var di = 1; di <= 10; di++) {
        tenDots += (di <= compound.dayInCycle ? '●' : '○');
      }

      var compoundCard = el('div', {
        class: 'card goal-compound-hero',
        style: {
          padding: '14px 16px', marginBottom: '12px',
          display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
          background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)'
        }
      }, [
        ringSvg,
        el('div', { style: { flex: '1', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '6px' } }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
            el('span', {
              style: {
                fontSize: '13px', fontWeight: '800', color: 'var(--green)',
                background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '6px'
              },
              text: '⬆️ +' + (compound.todayAddedPct || 0).toFixed(2) + '% 今日增加进度'
            }),
            el('span', {
              style: {
                fontSize: '11.5px', fontWeight: '700', color: 'var(--amber)',
                background: 'rgba(245,158,11,0.12)', padding: '2px 8px', borderRadius: '6px'
              },
              text: '⏳ 第 ' + compound.tenDayIndex + ' 个 10 天（第 ' + compound.dayInCycle + '/10 天）'
            })
          ]),
          el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '今日推进记录 ' + (compound.todayRecords || 0) + ' 次 · 10天微周期进度 ' + tenDots }),
          el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '三层分工：🎯目标(长远愿景/KR水位) → 📅习惯(规律打卡连击) → ✅待办(今日执行拆解)' })
        ])
      ]);
      host.appendChild(compoundCard);

      /* ---- 2) 保留 4 格统计概览 (兼容 1/5 在办计数断言) ---- */
      host.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(active.length + '/' + Store.GOAL_MAX_ACTIVE, '在办目标', 'var(--primary)'),
        V.statCard(avg + '%', '平均进度', 'var(--green)'),
        V.statCard(krTotal, '关键结果', 'var(--amber)'),
        V.statCard(archived.length, '已归档', 'var(--text-2)')
      ]));

      /* ---- 3) 领域分组导航胶囊条 (带进度百分比) ---- */
      if (compound.groups && compound.groups.length) {
        var grpBar = el('div', {
          class: 'goal-group-bar',
          style: { display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', paddingBottom: '6px', marginBottom: '10px' }
        });
        grpBar.appendChild(el('button', {
          class: 'filter-tab' + (activeGroupFilter === 'all' ? ' active' : ''),
          text: '全部领域 (' + active.length + ')',
          onclick: function () { activeGroupFilter = 'all'; renderPane(); }
        }));
        compound.groups.forEach(function (gg) {
          grpBar.appendChild(el('button', {
            class: 'filter-tab' + (activeGroupFilter === gg.key ? ' active' : ''),
            style: activeGroupFilter === gg.key ? { borderColor: gg.color, color: gg.color } : null,
            text: gg.icon + ' ' + gg.name + (gg.count ? (' ' + Math.round(gg.pct) + '%') : ''),
            onclick: function () { activeGroupFilter = gg.key; renderPane(); }
          }));
        });
        host.appendChild(grpBar);
      }

      host.appendChild(el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '7px',
          fontSize: '11.5px', color: 'var(--text-3)', margin: '-6px 0 12px'
        }
      }, [
        V.svg(V.icons.tree, 14),
        el('span', { text: '可用积分 ' + Store.pomodoro.points }),
        V.ruleHelpBtn('目标积分规则', [
          { label: '+' + POMO.GOAL_DONE + ' 积分', text: '达成 100% 并归档（每个目标仅发一次，周期需满 ' + Store.GOAL_MIN_DAYS + ' 天）' },
          { label: '+' + POMO.KR_DONE + ' 积分', text: '单条关键结果（KR）首次推进到 100%（周期需满 ' + Store.GOAL_MIN_DAYS + ' 天）' }
        ], { label: '积分规则' })
      ]));

      var rc = reviewCard();
      if (rc) host.appendChild(rc);

      if (!active.length) {
        host.appendChild(V.empty(ICON, '还没有在办的目标',
          '目标不是待办清单：先写一句「想变成什么样」，再补 2–4 条能算出结果的数字。',
          el('button', {
            class: 'btn btn-primary',
            onclick: function () { openGoalDialog(); }
          }, [V.svg(V.icons.plus, 16), '新建目标'])));
      } else {
        host.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '-2px 0 10px' }
        }, ['长按卡片可拖动调整顺序']));
        var filteredActive = activeGroupFilter === 'all'
          ? active
          : active.filter(function (g) { return (g.group || 'study') === activeGroupFilter; });
        var activeWrap = el('div', { class: 'goal-active-list' });
        (filteredActive.length ? filteredActive : active).forEach(function (g) {
          activeWrap.appendChild(goalCard(g, false));
        });
        host.appendChild(activeWrap);
      }

      if (archived.length) {
        var box = el('div', { class: 'card goal-archive', style: { padding: '12px 14px' } });
        var open = false;
        var body = el('div', {});
        var head = el('button', {
          class: 'btn btn-sm',
          style: { width: '100%', justifyContent: 'space-between' },
          onclick: function () {
            open = !open;
            body.style.display = open ? '' : 'none';
            this.textContent = (open ? '收起已归档（' : '已归档（') + archived.length + (open ? '）' : '）');
          }
        }, ['已归档（' + archived.length + '）']);
        body.style.display = 'none';
        archived.forEach(function (g) { body.appendChild(goalCard(g, true)); });
        box.appendChild(head);
        box.appendChild(body);
        host.appendChild(box);
      }

      if (active.length) {
        host.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.8' },
          text: '同时在办最多 ' + Store.GOAL_MAX_ACTIVE + ' 个目标——目标页最大的失败形态不是功能少，是变成一张谁也不看的表。'
        }));
      }
    }
  };

  /* ==========================================================
   * 快速填写（自己填的 KR）
   * ========================================================== */
  function quickFill(g, kr) {
    var f = V.input({
      type: 'number', step: '0.5', min: '0',
      value: String(kr.current || 0)
    });
    var m;
    m = V.modal({
      title: '填一个数',
      body: [
        el('div', {
          style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
          text: kr.title + '（目标 ' + fmtNum(kr.target) + (kr.unit ? ' ' + kr.unit : '') + '）'
        }),
        V.field('当前值', f, '出了结果就填进来；没出结果就留 0')
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            var v = Math.max(0, parseFloat(f.value) || 0);
            var krs = (g.krs || []).map(function (k) {
              return k.id === kr.id ? Object.assign({}, k, { current: v }) : k;
            });
            Store.updateGoal(g.id, { krs: krs });
            V.toast('已更新');
            m.close();
            renderPane();
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 新建 / 编辑弹窗
   * ========================================================== */
  function termRange() {
    var sem = Store.semester;
    var start = Store.weekStartDate(1) || DateUtil.today();
    var end = DateUtil.addDays(Store.weekStartDate(sem.weeks || 18), 6);
    return { start: DateUtil.toStr(start), end: DateUtil.toStr(end) };
  }

  function openGoalDialog(id, seed) {
    var origin = id ? Store.getGoal(id) : null;
    if (!origin && !Store.canAddGoal()) {
      V.toast('在办目标已经有 ' + Store.GOAL_MAX_ACTIVE + ' 个了，先归档一个', 'err');
      return;
    }

    var tr = termRange();
    var draft = {
      title: origin ? origin.title : (seed && seed.title ? seed.title : ''),
      note: origin ? origin.note : (seed && seed.note ? seed.note : ''),
      group: origin ? (origin.group || 'study') : (seed && seed.group ? seed.group : 'study'),
      period: origin ? origin.period : (seed && seed.period ? seed.period : 'term'),
      startDate: origin ? origin.startDate : (seed && seed.startDate ? seed.startDate : tr.start),
      endDate: origin ? origin.endDate : (seed && seed.endDate ? seed.endDate : tr.end),
      krs: origin ? origin.krs.map(function (k) { return Object.assign({}, k); })
        : (seed && Array.isArray(seed.krs) ? seed.krs.map(function (k) { return Object.assign({}, k); }) : [])
    };
    if (!draft.krs.length) draft.krs.push({ title: '', kind: 'manual', target: 100, current: 0, unit: '' });

    var fTitle = V.input({ placeholder: '例如：这学期把高数补上来', value: draft.title });
    var fNote = V.input({ placeholder: '选填：为什么要做这件事', value: draft.note });
    var fStart = V.input({ type: 'date', value: draft.startDate });
    var fEnd = V.input({ type: 'date', value: draft.endDate });
    var krBox = el('div', { class: 'goal-kr-edit' });
    var periodSeg = el('div', {});

    function drawPeriod() {
      periodSeg.innerHTML = '';
      periodSeg.appendChild(V.segment([
        { value: 'term', label: '本学期' },
        { value: 'custom', label: '自定义' }
      ], draft.period, function (v) {
        draft.period = v;
        if (v === 'term') {
          draft.startDate = tr.start;
          draft.endDate = tr.end;
          fStart.value = tr.start;
          fEnd.value = tr.end;
        }
        drawPeriod();
      }));
    }
    drawPeriod();

    /* ---- KR 实时双列水位缩略图预览 + 编辑行 ---- */
    var livePreviewBox = el('div', {
      class: 'goal-kr-live-preview',
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '8px', marginBottom: '10px'
      }
    });

    function updateLivePreview() {
      livePreviewBox.innerHTML = '';
      var grp = groupMetaOf(draft.group || 'study');
      var accent = grp.color || '#4f46e5';
      draft.krs.forEach(function (kr, idx) {
        var tName = (kr.title && kr.title.trim()) ? kr.title.trim() : ('关键结果 #' + (idx + 1));
        var curV = Number(kr.current) || 0;
        var tarV = Number(kr.target) || 100;
        var stV = kr.startVal != null && kr.startVal !== '' ? Number(kr.startVal) : 0;
        var pct = 0;
        if (stV !== 0 && stV !== tarV) {
          pct = Math.max(0, Math.min(100, Math.round(((curV - stV) / (tarV - stV)) * 100)));
        } else if (tarV > 0) {
          pct = Math.max(0, Math.min(100, Math.round((curV / tarV) * 100)));
        }
        livePreviewBox.appendChild(el('div', {
          style: {
            position: 'relative', overflow: 'hidden', padding: '8px 10px',
            borderRadius: '10px', border: '1px solid ' + accent + '38',
            background: 'linear-gradient(90deg, ' + accent + '22 ' + pct + '%, ' + accent + '08 ' + pct + '%)',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            gap: '4px', minHeight: '58px', width: '100%', boxSizing: 'border-box'
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', width: '100%' } }, [
            el('span', {
              style: { fontSize: '12px', fontWeight: '650', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              text: krKindIcon(kr.kind) + ' ' + tName
            }),
            el('span', {
              style: { fontSize: '11px', fontWeight: '700', color: accent, flex: '0 0 auto' },
              text: pct + '%'
            })
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontSize: '11.5px', color: 'var(--text-2)', fontWeight: '600' } }, [
            el('span', { text: fmtNum(curV) + '/' + fmtNum(tarV) + (kr.unit ? ' ' + kr.unit : '') }),
            el('span', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: '缩略预览' })
          ])
        ]));
      });
    }

    function syncKrsFromDOM() {
      if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (e) {}
      }
      var rows = krBox.querySelectorAll('.goal-kr-edit-row');
      rows.forEach(function (row) {
        var kr = row._kr;
        if (!kr) return;
        var inps = row._inps || {};
        if (inps.title) {
          kr.title = inps.title.value.trim();
        }
        if (inps.target) {
          var tv = parseFloat(inps.target.value);
          if (!isNaN(tv)) kr.target = Math.max(0, tv);
        }
        if (inps.cur) {
          var cv = parseFloat(inps.cur.value);
          if (!isNaN(cv)) kr.current = Math.max(0, cv);
        }
        if (inps.unit) {
          kr.unit = inps.unit.value.trim();
        }
        if (inps.startVal) {
          var sv = inps.startVal.value.trim();
          kr.startVal = sv === '' ? null : (parseFloat(sv) || 0);
        }
        if (inps.stepVal) {
          var stv = parseFloat(inps.stepVal.value);
          if (!isNaN(stv)) kr.step = Math.max(0.1, stv);
        }
        if (inps.tags) {
          kr.tags = inps.tags.value.split(/[\s,，、]+/).filter(function (x) { return x; }).slice(0, 6);
        }
        if (inps.costMax) {
          kr.costMax = Math.max(0, parseFloat(inps.costMax.value) || 0);
        }
        if (inps.kcalMax) {
          kr.kcalMax = Math.max(0, parseInt(inps.kcalMax.value, 10) || 0);
        }
      });
      updateLivePreview();
    }

    function drawKrs() {
      if (krBox && krBox.querySelector('.goal-kr-edit-row')) {
        syncKrsFromDOM();
      }
      krBox.innerHTML = '';
      updateLivePreview();
      krBox.appendChild(livePreviewBox);
      draft.krs.forEach(function (kr, i) {
        var row = el('div', { class: 'goal-kr-edit-row' });
        row._kr = kr;
        var inps = {};
        row._inps = inps;

        var fKrTitle = V.input({
          placeholder: '关键结果，例如：每周自习 5 天', value: kr.title,
          oninput: function () { kr.title = this.value; updateLivePreview(); },
          onchange: function () { kr.title = this.value.trim(); updateLivePreview(); },
          onblur: function () { kr.title = this.value.trim(); updateLivePreview(); }
        });
        inps.title = fKrTitle;
        row.appendChild(V.field('第 ' + (i + 1) + ' 条', fKrTitle));

        var fKind = V.select(Store.KR_KINDS.map(function (k) {
          return { value: k.key, label: k.name };
        }), kr.kind);
        fKind.addEventListener('change', function () {
          kr.kind = fKind.value;
          if (kr.kind === 'manual' && !kr.target) kr.target = 100;
          if (kr.kind === 'grade') { kr.metric = 'semesterGpa'; if (!kr.target || kr.target > 5) kr.target = 3; }
          if (kr.kind === 'sleep' || kr.kind === 'active') { if (!kr.target || kr.target > 366) kr.target = 12; kr.unit = '天'; }
          if (kr.kind === 'workout') {
            if (!kr.metric) kr.metric = 'minutes';
            kr.target = kr.metric === 'count' ? 12 : 300;
            kr.unit = kr.metric === 'count' ? '次' : '分钟';
          }
          if (kr.kind === 'diet') {
            if (!kr.target || kr.target > 366) kr.target = 14;
            kr.unit = '天';
          }
          if (kr.kind === 'focus') { if (!kr.target || kr.target > 500) kr.target = 20; kr.unit = '小时'; }
          if (kr.kind === 'budget') {
            var defB = (Store.getBudget && Store.getBudget().monthly) || 1500;
            if (!kr.target || kr.target < 50) kr.target = defB;
            kr.unit = '元';
          }
          drawKrs();
        });
        row.appendChild(V.field('怎么衡量', fKind, kindOf(kr.kind).desc));

        if (kr.kind === 'plan') {
          var plans = Store.plans.slice().sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
          var opts = [{ value: '', label: plans.length ? '选择一条计划…' : '还没有计划，先去「计划」里建一条' }]
            .concat(plans.map(function (p) { return { value: p.id, label: p.title }; }));
          var fPlan = V.select(opts, kr.planId || '');
          fPlan.addEventListener('change', function () { kr.planId = fPlan.value; });
          row.appendChild(V.field('绑定计划', fPlan, '只统计目标周期内的打卡'));
        } else if (kr.kind === 'task') {
          var fTags = V.input({
            placeholder: '标签，空格分隔（留空 = 全部）',
            value: (kr.tags || []).join(' '),
            oninput: function () {
              kr.tags = this.value.split(/[\s,，、]+/).filter(function (x) { return x; }).slice(0, 6);
            }
          });
          row.appendChild(V.field('按标签圈定', fTags, '任一标签命中就算；统计周期内有截止日期的顶层待办'));

          var courses = Store.courses || [];
          var cOpts = [{ value: '', label: '不限课程' }].concat(courses.map(function (c) {
            return { value: c.id, label: c.name };
          }));
          var fCourse = V.select(cOpts, kr.courseId || '');
          fCourse.addEventListener('change', function () { kr.courseId = fCourse.value; });
          row.appendChild(V.field('限定课程（可选）', fCourse));
        } else if (kr.kind === 'grade') {
          var sems = (Store.state.semesters || []);
          var sOpts = sems.map(function (s) { return { value: s.id, label: s.name }; });
          if (!sOpts.length) sOpts = [{ value: '', label: '当前学期' }];
          var fSem = V.select(sOpts, kr.semesterId || '');
          fSem.addEventListener('change', function () { kr.semesterId = fSem.value; });
          row.appendChild(V.field('学期', fSem, '按该学期已出分课程的加权 GPA 算'));

          var fGpa = V.input({
            type: 'number', step: '0.1', min: '0', max: '5', value: String(kr.target || 3),
            oninput: function () { kr.target = Math.max(0, parseFloat(this.value) || 0); }
          });
          row.appendChild(V.field('目标 GPA', fGpa, '例如 3.6；未出分时显示「待出分」'));
        } else if (kr.kind === 'focus') {
          var fHours = V.input({
            type: 'number', step: '1', min: '1', max: '1000', value: String(kr.target || 20),
            oninput: function () { kr.target = Math.max(0.5, parseFloat(this.value) || 1); kr.unit = '小时'; }
          });
          row.appendChild(V.field('目标专注时长（小时）', fHours, '周期内通过番茄钟累计完成的专注小时数'));
          var fCourses = Store.courses || [];
          var fcOpts = [{ value: '', label: '不限课程（计入全部专注）' }].concat(fCourses.map(function (c) {
            return { value: c.id, label: c.name };
          }));
          var fFocusCourse = V.select(fcOpts, kr.courseId || '');
          fFocusCourse.addEventListener('change', function () { kr.courseId = fFocusCourse.value; });
          row.appendChild(V.field('限定课程（可选）', fFocusCourse));
        } else if (kr.kind === 'sleep' || kr.kind === 'active') {
          var fDays = V.input({
            type: 'number', step: '1', min: '1', max: '366', value: String(kr.target || 12),
            oninput: function () { kr.target = Math.max(1, parseInt(this.value, 10) || 1); }
          });
          row.appendChild(V.field('目标天数', fDays, '周期内累计达标的总天数（睡眠看夜数、运动看步数达标日）'));
        } else if (kr.kind === 'workout') {
          var wMode = kr.metric === 'count' ? 'count' : 'minutes';
          var fWMode = V.select([
            { value: 'minutes', label: '按累计锻炼时长（分钟）' },
            { value: 'count',   label: '按累计锻炼次数（次）' }
          ], wMode);
          fWMode.addEventListener('change', function () {
            kr.metric = fWMode.value;
            kr.target = kr.metric === 'count' ? 12 : 300;
            kr.unit = kr.metric === 'count' ? '次' : '分钟';
            drawKrs();
          });
          row.appendChild(V.field('计量方式', fWMode, '自动汇总手环同步锻炼、手动锻炼及象限运动记录'));
          var fWTarget = V.input({
            type: 'number', step: wMode === 'count' ? '1' : '15', min: '1', max: '50000',
            value: String(kr.target || (wMode === 'count' ? 12 : 300)),
            oninput: function () { kr.target = Math.max(1, parseInt(this.value, 10) || 1); }
          });
          row.appendChild(V.field(wMode === 'count' ? '目标锻炼次数（次）' : '目标锻炼总时长（分钟）', fWTarget));
        } else if (kr.kind === 'diet') {
          var fDietDays = V.input({
            type: 'number', step: '1', min: '1', max: '366', value: String(kr.target || 14),
            oninput: function () { kr.target = Math.max(1, parseInt(this.value, 10) || 1); kr.unit = '天'; }
          });
          var fCostMax = V.input({
            type: 'number', step: '5', min: '0', placeholder: '0 = 不限花费',
            value: kr.costMax ? String(kr.costMax) : '',
            oninput: function () { kr.costMax = Math.max(0, parseFloat(this.value) || 0); }
          });
          var fKcalMax = V.input({
            type: 'number', step: '50', min: '0', placeholder: '0 = 沿用饮食目标',
            value: kr.kcalMax ? String(kr.kcalMax) : '',
            oninput: function () { kr.kcalMax = Math.max(0, parseInt(this.value, 10) || 0); }
          });
          row.appendChild(V.field('目标达标天数', fDietDays, '周期内有记录且花费/热量均不超上限的天数'));
          row.appendChild(el('div', { class: 'field-row' }, [
            V.field('单日花费上限(元，可选)', fCostMax),
            V.field('单日热量上限(kcal，可选)', fKcalMax)
          ]));
        } else if (kr.kind === 'budget') {
          var fBudgetAmt = V.input({
            type: 'number', step: '50', min: '10', max: '100000', value: String(kr.target || 1500),
            oninput: function () { kr.target = Math.max(1, parseFloat(this.value) || 1); kr.unit = '元'; }
          });
          row.appendChild(V.field('预算控制上限（元）', fBudgetAmt, '周期内累计支出不超过该金额即视为 100% 守住预算'));
          var expCats = (global.LEDGER_CATS && global.LEDGER_CATS.expense) || [
            { key: 'food', name: '餐饮' }, { key: 'shopping', name: '购物' }, { key: 'fun', name: '娱乐' }
          ];
          var bCatOpts = [{ value: '', label: '全部总支出' }].concat(expCats.map(function (c) {
            return { value: c.key, label: '仅统计「' + c.name + '」支出' };
          }));
          var fBudgetCat = V.select(bCatOpts, kr.category || '');
          fBudgetCat.addEventListener('change', function () { kr.category = fBudgetCat.value; });
          row.appendChild(V.field('统计范围', fBudgetCat));
        } else if (kr.kind === 'weight') {
          var fWTarget2 = V.input({
            type: 'number', step: '0.5', min: '20', max: '250', value: String(kr.target || 60),
            oninput: function () { kr.target = Math.max(20, parseFloat(this.value) || 60); kr.unit = kr.unit || 'kg'; }
          });
          var fWStart2 = V.input({
            type: 'number', step: '0.5', min: '20', max: '250',
            placeholder: '起始体重（如 70）',
            value: kr.startVal != null ? String(kr.startVal) : String(Store.latestWeight ? (Store.latestWeight() || 65) : 65),
            oninput: function () { kr.startVal = parseFloat(this.value) || null; }
          });
          row.appendChild(el('div', { class: 'field-row' }, [
            V.field('目标体重 (kg)', fWTarget2, '自动联动健康页最新体重记录'),
            V.field('起始体重 (kg)', fWStart2, '支持减脂(70→60)或增肌(55→62)')
          ]));
        } else {
          var fTarget = V.input({
            type: 'number', step: '0.5', min: '0', value: String(kr.target || 1),
            oninput: function () { kr.target = Math.max(0, parseFloat(this.value) || 1); updateLivePreview(); },
            onchange: function () { kr.target = Math.max(0, parseFloat(this.value) || 1); updateLivePreview(); },
            onblur: function () { kr.target = Math.max(0, parseFloat(this.value) || 1); updateLivePreview(); }
          });
          var fUnit = V.input({
            placeholder: '分 / 篇 / 次 / 斤', value: kr.unit || '',
            oninput: function () { kr.unit = this.value; updateLivePreview(); },
            onchange: function () { kr.unit = this.value.trim(); updateLivePreview(); },
            onblur: function () { kr.unit = this.value.trim(); updateLivePreview(); }
          });
          var fCur = V.input({
            type: 'number', step: '0.5', min: '0', value: String(kr.current || 0),
            oninput: function () { kr.current = Math.max(0, parseFloat(this.value) || 0); updateLivePreview(); },
            onchange: function () { kr.current = Math.max(0, parseFloat(this.value) || 0); updateLivePreview(); },
            onblur: function () { kr.current = Math.max(0, parseFloat(this.value) || 0); updateLivePreview(); }
          });
          var fStartVal = V.input({
            type: 'number', step: '0.5', placeholder: '选填：起始值（如减重填 104）',
            value: kr.startVal != null ? String(kr.startVal) : '',
            oninput: function () { kr.startVal = this.value === '' ? null : (parseFloat(this.value) || 0); },
            onchange: function () { kr.startVal = this.value === '' ? null : (parseFloat(this.value) || 0); },
            onblur: function () { kr.startVal = this.value === '' ? null : (parseFloat(this.value) || 0); }
          });
          var fStepVal = V.input({
            type: 'number', step: '0.5', min: '0.1', placeholder: '默认 1',
            value: kr.step != null ? String(kr.step) : '1',
            oninput: function () { kr.step = Math.max(0.1, parseFloat(this.value) || 1); },
            onchange: function () { kr.step = Math.max(0.1, parseFloat(this.value) || 1); },
            onblur: function () { kr.step = Math.max(0.1, parseFloat(this.value) || 1); }
          });
          inps.target = fTarget;
          inps.unit = fUnit;
          inps.cur = fCur;
          inps.startVal = fStartVal;
          inps.stepVal = fStepVal;
          row.appendChild(V.field('目标值 / 单位', el('div', { style: { display: 'flex', gap: '8px' } }, [fTarget, fUnit])));
          row.appendChild(V.field('当前值', fCur, '之后也能在卡片上直接点开填，或点右下角 + 号步进'));
          row.appendChild(el('div', { class: 'field-row' }, [
            V.field('起始基线（选填，支持递减目标）', fStartVal),
            V.field('每次点「+」步进量', fStepVal)
          ]));
        }

        if (draft.krs.length > 1) {
          row.appendChild(el('div', { style: { textAlign: 'right' } }, [
            el('button', {
              class: 'btn btn-sm',
              onclick: function () {
                draft.krs = draft.krs.filter(function (x) { return x !== kr; });
                drawKrs();
              }
            }, ['删掉这条'])
          ]));
        }
        krBox.appendChild(row);
      });

      if (draft.krs.length < 4) {
        krBox.appendChild(el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            draft.krs.push({ title: '', kind: 'manual', target: 100, current: 0, unit: '' });
            drawKrs();
          }
        }, [V.svg(V.icons.plus, 14), '添加关键结果']));
      }
    }
    drawKrs();

    var m;
    m = V.modal({
      title: origin ? '编辑目标' : '新建目标',
      width: '620px',
      body: [
        V.field('目标', fTitle, '一句话说清「想变成什么样」，不用写具体做什么'),
        V.field('所属领域', (function () {
          var gSel = V.select((Store.GOAL_GROUPS || []).map(function (gg) {
            return { value: gg.key, label: gg.icon + ' ' + gg.name };
          }), draft.group || 'study');
          gSel.addEventListener('change', function () { draft.group = gSel.value; });
          return gSel;
        })(), '按领域归类，顶部复利大盘会按领域展示进度环'),
        V.field('周期', periodSeg, '只做「本学期」和「自定义」两种：日/周目标和计划、待办完全重叠'),
        el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, [
          el('div', { style: { flex: '1 1 135px', minWidth: '0' } }, [V.field('开始', fStart)]),
          el('div', { style: { flex: '1 1 135px', minWidth: '0' } }, [V.field('结束', fEnd)])
        ]),
        V.field('关键结果', krBox, '每条只回答一个问题：到那时候，用什么数字证明它成了'),
        V.field('备注', fNote),
        el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', lineHeight: '1.75' },
          text: '总进度 = 各条关键结果的等权平均；没有数据的（比如期中还没考）先不计入。到期不会删除，只是归档留档。'
        })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
              try { document.activeElement.blur(); } catch (e) {}
            }
            syncKrsFromDOM();
            var title = fTitle.value.trim();
            if (!title) { V.toast('先写一句目标', 'err'); fTitle.focus(); return; }
            var start = fStart.value || draft.startDate;
            var end = fEnd.value || draft.endDate;
            if (end < start) { V.toast('结束日期不能早于开始日期', 'err'); return; }
            var krs = draft.krs.filter(function (k) { return String(k.title || '').trim(); });
            if (!krs.length) { V.toast('至少写一条关键结果，否则没法算进度', 'err'); return; }
            krs = krs.map(function (k, i) {
              return Object.assign({}, k, { title: k.title.trim(), id: k.id || ('kr_' + Date.now() + '_' + i) });
            });
            var data = {
              title: title, note: fNote.value.trim(),
              group: draft.group || 'study',
              period: draft.period, startDate: start, endDate: end, krs: krs
            };
            if (origin) { Store.updateGoal(origin.id, data); V.toast('已更新'); }
            else { Store.addGoal(data); V.toast('目标已创建'); }
            if (Store.flushSave) Store.flushSave();
            m.close();
            renderPane();
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 导出
   * ========================================================== */
  GoalsPane.open = openGoalDialog;
  GoalsPane.focusRecord = function (type, id) {
    if (type !== 'goal') return false;
    var g = Store.getGoal(id);
    if (!g) return false;
    var node = HOST ? HOST.querySelector('[data-rec="goal:' + id + '"]') : null;
    // 归档里的目标默认折叠：先展开再定位
    if (!node && HOST) {
      var head = HOST.querySelector('.cp-goal-archive .cp-btn, .goal-archive .btn');
      if (head) head.click();
      node = HOST.querySelector('[data-rec="goal:' + id + '"]');
    }
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (node) {
      node.classList.add('cp-goal-flash', 'goal-flash');
      setTimeout(function () { node.classList.remove('cp-goal-flash', 'goal-flash'); }, 1200);
    }
    return !!node;
  };

  global.GoalsPane = GoalsPane;
  global.openGoalDialog = openGoalDialog;
})(window);
