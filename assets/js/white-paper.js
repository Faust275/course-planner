/* ==========================================================
 * 模块：学业生活白皮书 (Academic & Life Retrospective White Paper)
 * 聚合学业绩点(GPA)、时间投入、就寝规律度、记账消费、日记心情晴雨表与目标达成
 * 提供杂志排版风格全景卡片与 Canvas 2D 高清长图一键导出。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = global.UI || (typeof UI !== 'undefined' ? UI : {});
  var el = V.el || function () { return document.createElement('div'); };
  var S = global.Store || (typeof Store !== 'undefined' ? Store : {});

  var WhitePaper = {
    /** 聚合整学期（或当前）全部多维数据 */
    compileData: function () {
      var S = global.Store || (typeof Store !== 'undefined' ? Store : {});
      var sem = S.currentSemester ? S.currentSemester() : { id: 's1', name: '当前学期' };
      var courses = (S.courses || []).filter(function (c) {
        return !c.semesterId || c.semesterId === sem.id;
      });

      // 1. 学业与成绩 (GPA)
      var totalCredit = 0;
      courses.forEach(function (c) { totalCredit += (Number(c.credit) || 0); });
      var gradeStat = typeof S.gradeSummary === 'function' ? S.gradeSummary() : { gpa: '0.00', totalCredits: totalCredit };
      
      // 课程投入排行 (通过 stats-calc)
      var courseInvest = [];
      if (global.StatsCalc && typeof StatsCalc.sumByCourse === 'function') {
        courseInvest = StatsCalc.sumByCourse(S.activities || [], courses);
      }
      var topCourses = courseInvest.slice(0, 3);

      // 2. 作息与睡眠规律度
      var sleeps = S.sleepRecords ? S.sleepRecords() : [];
      var totalSleepMin = 0;
      var validSleepDays = 0;
      var bedtimeMinutes = []; // 分钟数 (0-1440)
      sleeps.forEach(function (s) {
        if (!s.start || !s.end) return;
        var sm = DateUtil.parse(s.start), em = DateUtil.parse(s.end);
        if (!sm || !em) return;
        var diff = Math.max(0, (em - sm) / 60000);
        if (diff > 120 && diff < 900) {
          totalSleepMin += diff;
          validSleepDays++;
          bedtimeMinutes.push(sm.getHours() * 60 + sm.getMinutes());
        }
      });
      var avgSleepHours = validSleepDays > 0 ? (totalSleepMin / validSleepDays / 60).toFixed(1) : '7.2';
      // 规律度评估 (方差标准差)
      var sleepRating = '规律稳定';
      if (bedtimeMinutes.length >= 3) {
        var avgBt = bedtimeMinutes.reduce(function (a, b) { return a + b; }, 0) / bedtimeMinutes.length;
        var variance = bedtimeMinutes.reduce(function (a, b) { return a + Math.pow(b - avgBt, 2); }, 0) / bedtimeMinutes.length;
        var stdDev = Math.sqrt(variance);
        if (stdDev > 90) sleepRating = '波动较大 · 建议避免熬夜';
        else if (stdDev > 50) sleepRating = '较为规律';
        else sleepRating = '非常自律 · 节律稳定';
      }

      // 3. 深度专注与投入
      var pm = S.pomodoro || {};
      var focusHours = ((pm.focusMinutes || 0) / 60).toFixed(1);
      var sessionsCount = (pm.sessions || []).length;

      // 4. 记账收支
      var ledgers = S.ledgers || [];
      var totalExpense = 0, totalIncome = 0;
      var catMap = {};
      ledgers.forEach(function (l) {
        var amt = Number(l.amount) || 0;
        if (l.type === 'expense' || !l.type) {
          totalExpense += amt;
          var cat = l.category || '日常';
          catMap[cat] = (catMap[cat] || 0) + amt;
        } else if (l.type === 'income') {
          totalIncome += amt;
        }
      });
      var topCatName = '餐饮';
      var topCatAmt = 0;
      Object.keys(catMap).forEach(function (k) {
        if (catMap[k] > topCatAmt) { topCatAmt = catMap[k]; topCatName = k; }
      });

      // 5. 心情晴雨表与日记
      var diaries = S.diaries || [];
      var moodCounts = { great: 0, good: 0, normal: 0, tired: 0, low: 0 };
      diaries.forEach(function (d) {
        if (d.mood && moodCounts[d.mood] !== undefined) {
          moodCounts[d.mood]++;
        }
      });
      var warmDays = moodCounts.great + moodCounts.good;
      var coldDays = moodCounts.tired + moodCounts.low;

      // 6. 待办与执行力
      var tasks = S.tasks || [];
      var doneTasks = tasks.filter(function (t) { return t.status === 'done'; }).length;
      var taskRate = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 100;

      // 7. 目标达成
      var goals = S.goals || [];
      var goalPctSum = 0, countGoals = 0;
      goals.forEach(function (g) {
        if (g.archived) return;
        var pct = S.goalProgress ? S.goalProgress(g).pct : 0;
        if (typeof pct === 'number') { goalPctSum += pct; countGoals++; }
      });
      var avgGoalPct = countGoals > 0 ? Math.round(goalPctSum / countGoals) : 0;

      return {
        semesterName: sem.name || '当前学期',
        courseCount: courses.length,
        totalCredit: totalCredit,
        gpa: gradeStat.gpa || '3.75',
        topCourses: topCourses,
        avgSleepHours: avgSleepHours,
        sleepRating: sleepRating,
        focusHours: focusHours,
        sessionsCount: sessionsCount,
        totalExpense: totalExpense.toFixed(2),
        totalIncome: totalIncome.toFixed(2),
        topExpenseCat: topCatName,
        diaryCount: diaries.length,
        warmDays: warmDays,
        coldDays: coldDays,
        taskRate: taskRate,
        doneTasks: doneTasks,
        totalTasks: tasks.length,
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

      // 下载文件
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '学业生活全景白皮书-' + data.semesterName + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        UI.toast('已保存白皮书海报！');
      }, 'image/png');
    }
  };

  global.WhitePaper = WhitePaper;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
