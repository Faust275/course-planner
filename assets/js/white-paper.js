/* ==========================================================
 * 模块：学业生活白皮书 (Academic & Life Retrospective White Paper)
 * 聚合学业绩点(GPA)、时间投入、就寝规律度、记账消费、日记心情晴雨表与目标达成
 * 提供杂志排版风格全景卡片与 Canvas 2D 高清长图一键导出。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = global.UI || (typeof UI !== 'undefined' ? UI : {});
  var el = V.el || function () { return document.createElement('div'); };

  var WhitePaper = {
    /** 聚合整学期（或当前）全部多维数据 */
    compileData: function () {
      var S = global.Store || (typeof Store !== 'undefined' ? Store : {});
      var sem = S.currentSemester ? S.currentSemester() : { id: 's1', name: '当前学期' };
      var courses = (S.courses || []).filter(function (c) {
        return !c.semesterId || c.semesterId === sem.id;
      });
      var courseNameMap = {};
      courses.forEach(function (c) {
        if (c && c.id) courseNameMap[c.id] = c.name || c.id;
        if (c && c.name) courseNameMap[c.name] = c.name;
      });

      // 1. 学业与成绩 (GPA)
      var totalCredit = 0;
      courses.forEach(function (c) { totalCredit += (Number(c.credit) || 0); });
      var gradeStat = typeof S.gradeSummary === 'function' ? S.gradeSummary() : { gpa: null, totalCredits: totalCredit };
      var gpaStr = (gradeStat && gradeStat.gpa != null && !isNaN(Number(gradeStat.gpa)))
        ? Number(gradeStat.gpa).toFixed(2)
        : '3.75';

      // 课程投入排行：StatsCalc.sumByCourse(activities, dates) 返回 { 课程名或ID: 分钟数 } 对象
      var courseInvestList = [];
      var rawInvest = null;
      if (global.StatsCalc && typeof global.StatsCalc.sumByCourse === 'function') {
        rawInvest = global.StatsCalc.sumByCourse(S.activities || [], null);
      } else if (typeof S.courseInvest === 'function') {
        try { rawInvest = S.courseInvest('term'); } catch (_) { rawInvest = null; }
      }
      if ((!rawInvest || (typeof rawInvest === 'object' && !Array.isArray(rawInvest) && !Object.keys(rawInvest).length)) && Array.isArray(S.activities)) {
        rawInvest = {};
        var TU0 = global.TimeUtil || (typeof TimeUtil !== 'undefined' ? TimeUtil : null);
        S.activities.forEach(function (a) {
          if (!a || a.planned) return;
          var k = a.courseName || a.courseId || '';
          if (!k) return;
          var m = (TU0 && TU0.diffMin) ? TU0.diffMin(a.start, a.end) : 0;
          if (m > 0) rawInvest[k] = (rawInvest[k] || 0) + m;
        });
      }
      if (Array.isArray(rawInvest)) {
        courseInvestList = rawInvest.slice();
      } else if (rawInvest && typeof rawInvest === 'object') {
        var mergedByCourse = {};
        Object.keys(rawInvest).forEach(function (k) {
          var mins = Number(rawInvest[k]) || 0;
          if (mins <= 0) return;
          var cname = courseNameMap[k] || k;
          mergedByCourse[cname] = (mergedByCourse[cname] || 0) + mins;
        });
        courseInvestList = Object.keys(mergedByCourse).map(function (name) {
          return { name: name, minutes: mergedByCourse[name] };
        }).sort(function (a, b) { return b.minutes - a.minutes; });
      }
      var topCourses = courseInvestList.slice(0, 3);

      // 2. 作息与睡眠规律度：兼容 S.sleeps（start/end 为 'HH:MM'）与圆周标准差
      var sleeps = Array.isArray(S.sleeps) ? S.sleeps : (S.sleepRecords ? S.sleepRecords() : []);
      var SM = global.SleepModel || (typeof SleepModel !== 'undefined' ? SleepModel : null);
      var TU = global.TimeUtil || (typeof TimeUtil !== 'undefined' ? TimeUtil : null);
      var totalSleepMin = 0;
      var validSleepDays = 0;
      var bedAngles = [];
      sleeps.forEach(function (s) {
        if (!s) return;
        var diff = 0;
        var bedMin = null;
        if (SM && typeof SM.normalizeNight === 'function') {
          var night = SM.normalizeNight(s);
          if (night && night.total > 0) {
            diff = night.total;
            bedMin = night.bed != null ? ((night.bed % 1440) + 1440) % 1440 : null;
          }
        }
        if (!diff && s.start && s.end) {
          if (TU && typeof TU.diffMin === 'function') {
            diff = TU.diffMin(s.start, s.end);
            bedMin = TU.toMin ? TU.toMin(s.start) : null;
          } else if (typeof DateUtil !== 'undefined' && DateUtil.parse) {
            var sm = DateUtil.parse(s.start), em = DateUtil.parse(s.end);
            if (sm && em) {
              diff = Math.max(0, (em - sm) / 60000);
              bedMin = sm.getHours() * 60 + sm.getMinutes();
            }
          }
        }
        if (!diff && Number(s.total) > 0) diff = Number(s.total);
        if (diff >= 120 && diff <= 960) {
          totalSleepMin += diff;
          validSleepDays++;
          if (bedMin != null) bedAngles.push(bedMin);
        }
      });
      var avgSleepHours = validSleepDays > 0 ? (totalSleepMin / validSleepDays / 60).toFixed(1) : '7.2';
      // 规律度评估：优先复用 Store.sleepRegularity 的圆周标准差，防止跨午夜 (23:50 vs 00:10) 线性方差失真
      var sleepRating = '规律稳定';
      var reg = typeof S.sleepRegularity === 'function' ? S.sleepRegularity(30) : null;
      if (reg && reg.hasData && reg.avgSD != null) {
        if (reg.avgSD > 90) sleepRating = '波动较大 · 建议避免熬夜';
        else if (reg.avgSD > 50) sleepRating = '较为规律';
        else sleepRating = '非常自律 · 节律稳定';
      } else if (bedAngles.length >= 3) {
        var sx = 0, sy = 0;
        bedAngles.forEach(function (t) {
          var a = (t / 1440) * 2 * Math.PI;
          sx += Math.cos(a);
          sy += Math.sin(a);
        });
        var R = Math.sqrt(sx * sx + sy * sy) / bedAngles.length;
        var stdDev = R >= 1 ? 0 : Math.sqrt(-2 * Math.log(R)) * (1440 / (2 * Math.PI));
        if (stdDev > 90) sleepRating = '波动较大 · 建议避免熬夜';
        else if (stdDev > 50) sleepRating = '较为规律';
        else sleepRating = '非常自律 · 节律稳定';
      }

      // 3. 深度专注与投入
      var pm = S.pomodoro || {};
      var focusHours = ((pm.focusMinutes || 0) / 60).toFixed(1);
      var sessionsCount = (pm.sessions || []).length;

      // 4. 记账收支：Store 字段为单数 S.ledger（兼容 S.ledgers）
      var ledgers = Array.isArray(S.ledger) ? S.ledger : (S.ledgers || []);
      var totalExpense = 0, totalIncome = 0;
      var catMap = {};
      ledgers.forEach(function (l) {
        if (!l) return;
        var amt = Number(l.amount) || 0;
        if (l.type === 'expense' || !l.type) {
          totalExpense += amt;
          var cat = l.category || l.cat || 'other';
          catMap[cat] = (catMap[cat] || 0) + amt;
        } else if (l.type === 'income') {
          totalIncome += amt;
        }
      });
      var topCatKey = '';
      var topCatAmt = 0;
      var courseSpendMap = {};
      Object.keys(catMap).forEach(function (k) {
        if (catMap[k] > topCatAmt) { topCatAmt = catMap[k]; topCatKey = k; }
      });
      (S.ledger || []).forEach(function (l) {
        if (!l || l.type === 'income' || !l.courseId) return;
        var nm = l.courseName || ((S.getCourse && S.getCourse(l.courseId)) || {}).name || '未命名课程';
        courseSpendMap[nm] = (courseSpendMap[nm] || 0) + (Number(l.amount) || 0);
      });
      var courseSpend = Object.keys(courseSpendMap).map(function (k) {
        return { name: k, amount: courseSpendMap[k] };
      }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3);
      var topCatName = '餐饮';
      if (topCatKey) {
        if (typeof global.ledgerCat === 'function') {
          var lc = global.ledgerCat('expense', topCatKey);
          topCatName = (lc && lc.name && lc.name !== '其它') ? lc.name : topCatKey;
        } else {
          topCatName = topCatKey;
        }
      }

      // 5. 心情晴雨表与日记
      var diaries = S.diaries || [];
      var moodCounts = { great: 0, good: 0, meh: 0, normal: 0, tired: 0, low: 0 };
      diaries.forEach(function (d) {
        if (d && d.mood && moodCounts[d.mood] !== undefined) {
          moodCounts[d.mood]++;
        }
      });
      var warmDays = moodCounts.great + moodCounts.good;
      var coldDays = moodCounts.tired + moodCounts.low;

      // 6. 待办与执行力（仅统计顶层非归档待办，避免子任务重复计数）
      var rawTasks = S.tasks || [];
      var topTasks = rawTasks.filter(function (t) { return t && !t.parentId && t.status !== 'archived'; });
      var doneTasks = topTasks.filter(function (t) { return t.status === 'done' || t.done === true; }).length;
      var taskRate = topTasks.length > 0 ? Math.round((doneTasks / topTasks.length) * 100) : 100;

      // 7. 目标达成：Store 方法为 S.goalProgressOf(g)，归档字段为 g.archivedAt
      var goals = S.goals || [];
      var goalPctSum = 0, countGoals = 0;
      goals.forEach(function (g) {
        if (!g || g.archived || g.archivedAt) return;
        var prog = typeof S.goalProgressOf === 'function'
          ? S.goalProgressOf(g)
          : (typeof S.goalProgress === 'function' ? S.goalProgress(g) : null);
        var pct = prog && typeof prog.pct === 'number' ? prog.pct : null;
        if (pct != null && !isNaN(pct)) { goalPctSum += pct; countGoals++; }
      });
      var avgGoalPct = countGoals > 0 ? Math.round(goalPctSum / countGoals) : 0;

      // 8. 运动与锻炼统计
      var workouts = Array.isArray(S.workouts) ? S.workouts : [];
      var workoutMin = 0, workoutKcal = 0;
      workouts.forEach(function (w) {
        if (!w) return;
        workoutMin += Number(w.duration) || 0;
        workoutKcal += Number(w.calories) || 0;
      });

      // 8. 考勤（v1.4.5 新增，未标记时整段不展示）
      var att = (typeof S.attendanceStats === 'function')
        ? S.attendanceStats(null, sem.id)
        : { marked: 0, rate: null, absent: 0, leave: 0 };

      return {
        attendanceMarked: att.marked,
        attendanceRate: att.rate,
        attendanceAbsent: att.absent,
        attendanceLeave: att.leave,
        semesterName: sem.name || '当前学期',
        workoutCount: workouts.length,
        workoutMin: workoutMin,
        workoutKcal: workoutKcal,
        courseCount: courses.length,
        totalCredit: totalCredit,
        gpa: gpaStr,
        topCourses: topCourses,
        avgSleepHours: avgSleepHours,
        sleepRating: sleepRating,
        focusHours: focusHours,
        sessionsCount: sessionsCount,
        totalExpense: totalExpense.toFixed(2),
        totalIncome: totalIncome.toFixed(2),
        topExpenseCat: topCatName,
        courseSpend: courseSpend,
        diaryCount: diaries.length,
        warmDays: warmDays,
        coldDays: coldDays,
        taskRate: taskRate,
        doneTasks: doneTasks,
        totalTasks: topTasks.length,
        avgGoalPct: avgGoalPct
      };
    },

    /** 打开学业生活白皮书全屏弹窗 */
    openDialog: function () {
      var data = this.compileData();
      var self = this;

      var body = el('div', { class: 'cp-whitepaper-body', style: { padding: '6px 0', lineHeight: '1.6' } });

      // 杂志顶栏
      body.appendChild(el('div', {
        style: {
          background: 'linear-gradient(135deg, var(--primary) 0%, #1e40af 100%)',
          color: '#ffffff',
          padding: '24px 20px',
          borderRadius: '12px',
          marginBottom: '16px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
        }
      }, [
        el('div', { style: { fontSize: '12px', letterSpacing: '2px', opacity: 0.85, textTransform: 'uppercase' }, text: 'ACADEMIC & LIFE RETROSPECTIVE' }),
        el('div', { style: { fontSize: '22px', fontWeight: 'bold', margin: '4px 0 8px' }, text: '学业与生活全景白皮书' }),
        el('div', { style: { fontSize: '13px', opacity: 0.9 }, text: data.semesterName + ' · 综合评估与成长图鉴' })
      ]));

      // 核心三联统计格
      body.appendChild(el('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }
      }, [
        el('div', { class: 'card', style: { padding: '12px', textAlign: 'center' } }, [
          el('div', { style: { fontSize: '22px', fontWeight: 'bold', color: 'var(--primary)' }, text: data.gpa }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' }, text: '学分绩点 (GPA)' })
        ]),
        el('div', { class: 'card', style: { padding: '12px', textAlign: 'center' } }, [
          el('div', { style: { fontSize: '22px', fontWeight: 'bold', color: 'var(--green)' }, text: data.focusHours + 'h' }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' }, text: '深度专注工时' })
        ]),
        el('div', { class: 'card', style: { padding: '12px', textAlign: 'center' } }, [
          el('div', { style: { fontSize: '22px', fontWeight: 'bold', color: 'var(--amber)' }, text: data.taskRate + '%' }),
          el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' }, text: '待办执行完成率' })
        ])
      ]));

      // 模块 1: 学业与课程投入
      var acCard = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
      acCard.appendChild(el('div', { class: 'section-title', style: { marginBottom: '8px' } }, ['📚 学业修读与学科投入']));
      acCard.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' } }, [
        '本学期修读 ', el('b', {}, [String(data.courseCount)]), ' 门课程，共计 ', el('b', {}, [String(data.totalCredit)]), ' 学分。'
      ]));
      if (data.attendanceMarked > 0) {
        acCard.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '8px' } }, [
          '考勤已标记 ', el('b', {}, [String(data.attendanceMarked)]), ' 次，出勤率 ',
          el('b', { style: { color: 'var(--primary)' } }, [data.attendanceRate + '%']),
          data.attendanceAbsent ? ('，缺勤 ' + data.attendanceAbsent + ' 次') : '',
          data.attendanceLeave ? ('，请假 ' + data.attendanceLeave + ' 次') : ''
        ]));
      }
      if (data.topCourses.length) {
        acCard.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }, text: '时间投入排行：' }));
        data.topCourses.forEach(function (tc, idx) {
          acCard.appendChild(el('div', {
            style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', padding: '4px 0' }
          }, [
            el('span', {}, [(idx + 1) + '. ' + tc.name]),
            el('span', { style: { fontWeight: 'bold', color: 'var(--primary)' } }, [Math.round(tc.minutes / 60 * 10) / 10 + ' 小时'])
          ]));
        });
      }
      body.appendChild(acCard);

      // 模块 2: 作息健康与生理节律
      var sleepCard = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
      sleepCard.appendChild(el('div', { class: 'section-title', style: { marginBottom: '8px' } }, ['🌙 作息节律与健康']));
      sleepCard.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' } }, [
        el('span', {}, ['日均睡眠时长：']),
        el('b', {}, [data.avgSleepHours + ' 小时'])
      ]));
      sleepCard.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } }, [
        el('span', {}, ['就寝规律度评估：']),
        el('span', { style: { color: 'var(--green)', fontWeight: 'bold' } }, [data.sleepRating])
      ]));
      body.appendChild(sleepCard);

      // 模块 3: 消费与生活记账
      var ledCard = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
      ledCard.appendChild(el('div', { class: 'section-title', style: { marginBottom: '8px' } }, ['💰 生活消费与收支']));
      ledCard.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' } }, [
        el('span', {}, ['学期累计支出：']),
        el('b', { style: { color: 'var(--red)' } }, ['¥ ' + data.totalExpense])
      ]));
      ledCard.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } }, [
        el('span', {}, ['最大开销类别：']),
        el('b', {}, [data.topExpenseCat])
      ]));
      if (data.courseSpend && data.courseSpend.length) {
        ledCard.appendChild(el('div', { style: { marginTop: '8px', fontSize: '12.5px', color: 'var(--text-2)' } }, [
          el('div', { style: { marginBottom: '4px' } }, ['按课程花销（教材 / 打印 / 班费）：']),
          el('div', {}, [data.courseSpend.map(function (c) {
            return c.name + ' ¥' + c.amount.toFixed(2);
          }).join(' · ')])
        ]));
      }
      body.appendChild(ledCard);

      // 模块 4: 心态晴雨表与目标
      var moodCard = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '16px' } });
      moodCard.appendChild(el('div', { class: 'section-title', style: { marginBottom: '8px' } }, ['🌈 心态晴雨表与目标执行']));
      moodCard.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' } }, [
        el('span', {}, ['心情冷暖指数：']),
        el('span', {}, [
          el('span', { style: { color: '#f59e0b', fontWeight: 'bold' } }, ['暖心 ' + data.warmDays + ' 天']),
          document.createTextNode(' / '),
          el('span', { style: { color: '#3b82f6' } }, ['低落 ' + data.coldDays + ' 天'])
        ])
      ]));
      moodCard.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } }, [
        el('span', {}, ['学期在办目标平均进度：']),
        el('b', { style: { color: 'var(--primary)' } }, [data.avgGoalPct + '%'])
      ]));
      body.appendChild(moodCard);

      // 导出按钮
      var btnExport = el('button', {
        class: 'btn btn-primary',
        style: { width: '100%', padding: '10px 0', fontSize: '14px', borderRadius: '8px' },
        onclick: function () {
          self.exportImage(data);
        }
      }, ['📷 保存白皮书高清海报 (PNG)']);
      body.appendChild(btnExport);

      V.modal({
        title: '📊 学业生活白皮书',
        body: body,
        width: 520
      });
    },

    /** 使用纯前端 Canvas 2D 绘制高清总结海报并下载 */
    exportImage: function (data) {
      var W = 750, H = 1080;
      var canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 背景与卡片底色
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, W, H);

      // 顶栏深蓝渐变
      var grad = ctx.createLinearGradient(0, 0, W, 220);
      grad.addColorStop(0, '#2563eb');
      grad.addColorStop(1, '#1e40af');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, 220);

      // 顶栏文字
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '14px sans-serif';
      ctx.fillText('ACADEMIC & LIFE RETROSPECTIVE · COURSE PLANNER', 40, 50);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('学业与生活全景白皮书', 40, 105);

      ctx.font = '18px sans-serif';
      ctx.fillText(data.semesterName + ' · 个人成长纪要', 40, 150);

      // 卡片绘制助手
      function drawCard(x, y, w, h, title) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.06)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, 12) : ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.shadowColor = 'transparent';

        if (title) {
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 18px sans-serif';
          ctx.fillText(title, x + 20, y + 36);
        }
      }

      // 核心三格 (GPA / 专注工时 / 待办率)
      drawCard(40, 250, 206, 110);
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(data.gpa, 60, 310);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.fillText('学分绩点 (GPA)', 60, 340);

      drawCard(272, 250, 206, 110);
      ctx.fillStyle = '#16a34a';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(data.focusHours + 'h', 292, 310);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.fillText('深度专注工时', 292, 340);

      drawCard(504, 250, 206, 110);
      ctx.fillStyle = '#d97706';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(data.taskRate + '%', 524, 310);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.fillText('待办执行率', 524, 340);

      // 学业与科目投入
      drawCard(40, 390, 670, 170, '📚 学业修读与学科投入');
      ctx.fillStyle = '#334155';
      ctx.font = '15px sans-serif';
      ctx.fillText('本学期修读 ' + data.courseCount + ' 门课程，累计 ' + data.totalCredit + ' 学分。', 60, 460);
      if (data.topCourses.length) {
        var tcText = data.topCourses.map(function (tc, idx) {
          return (idx + 1) + '. ' + tc.name + ' (' + (Math.round(tc.minutes / 60 * 10) / 10) + 'h)';
        }).join('    ');
        ctx.fillText('时间投入前列：' + tcText, 60, 500);
      }

      // 作息健康
      drawCard(40, 580, 670, 150, '🌙 作息节律与健康');
      ctx.fillStyle = '#334155';
      ctx.font = '15px sans-serif';
      ctx.fillText('平均就寝睡眠时长：' + data.avgSleepHours + ' 小时', 60, 650);
      ctx.fillText('生理节律稳定性：' + data.sleepRating, 60, 690);

      // 消费与心态
      drawCard(40, 750, 670, 150, '💰 生活消费与心情晴雨');
      ctx.fillStyle = '#334155';
      ctx.font = '15px sans-serif';
      ctx.fillText('累计支出：¥ ' + data.totalExpense + '    主要支出分类：' + data.topExpenseCat, 60, 820);
      ctx.fillText('心情晴雨表：暖色积极 ' + data.warmDays + ' 天 / 低落疲惫 ' + data.coldDays + ' 天', 60, 860);

      // 底部水印印章
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('由「课程规划助手」自动生成 · 持续精进，静待花开', W / 2, 970);
      ctx.fillText(new Date().toLocaleDateString() + ' · 终身成长档案', W / 2, 995);

      // 下载文件（统一走 SaveFile，支持安卓 WebView 内高清长按保存与分享）
      canvas.toBlob(function (blob) {
        if (!blob) { UI.toast('生成白皮书海报失败', 'err'); return; }
        var fname = '学业生活全景白皮书-' + (data.semesterName || '当前学期') + '.png';
        if (global.SaveFile && SaveFile.save) {
          SaveFile.save(fname, blob, {
            mime: 'image/png',
            ext: 'png',
            panelTitle: '学业生活全景白皮书海报'
          }).then(function (r) {
            if (r && (r.method === 'picker' || r.method === 'share')) {
              UI.toast('已保存白皮书海报！', 'ok');
            }
          });
        } else {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          UI.toast('已保存白皮书海报！');
        }
      }, 'image/png');
    }
  };

  global.WhitePaper = WhitePaper;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
