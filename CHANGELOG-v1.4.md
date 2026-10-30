# 课程规划助手 CoursePlanner v1.4 更新说明

## 一、核心 Bug 修复（全量修复）
1. **成绩构成无法保存 & 误删修复**：
   - `assets/js/store.js`: 新增 `hasGradeStructure(gr)`，修改课程保存时保留所有仅配置了成绩分项比例但尚未填入分数的成绩结构，不再因 `score === null` 而误删；`saveGrade` 改为 `this.save(true)` 立即落盘。
   - `assets/js/views/grades.js`: 弹窗内切换模板（三七开/四六开/五五开等）、增删分项、归一权重、编辑平时分时实时静默保存（`silentPersist`），并在弹窗通过右上角 `×`、遮罩层或返回键关闭时自动落盘（`onClose` 钩子）；修复权重不等于 100% 时点遮罩关闭确认框导致不保存的问题。
   - `assets/js/views/schedule.js`: 课程详情弹窗新增「📊 成绩构成」与当前总评/绩点直观展示，并提供一键跳转编辑按钮。
2. **模态框死锁与确认弹窗悬挂修复**：
   - `assets/js/ui.js`: 为 `modal.close()` 增加 `isClosed` 幂等锁，防止重复关闭导致 `openCount` 下溢；`syncScrim()` 结合 DOM 实际活跃弹窗兜底清理残余遮罩与 `body.cp-modal-open`；`UI.confirm()` 新增 `onClose` 兜底结算与 `closeValue` 支持，以及 `opts.ok` / `opts.onOk` / `opts.onCancel` / `opts.extraButtons` 兼容。
   - `assets/js/views/gacha.js` & `assets/js/views/collection.js`: 替换全部 5 处裸 `.closest('.cp-modal-wrap').remove()` 为标准 `m.close()`，修复天井自选与限定池选择的确认回调失效问题。
   - `assets/js/views/diary.js` & `assets/js/views/pomodoro.js`: 修复凌晨 00:00~04:00 写日记日期确认点遮罩仍创建日记的问题，以及番茄钟提前结束确认点遮罩仍强制中断专注的问题。
3. **撤销（Undo）数据丢失修复**：
   - `assets/js/undo.js`: 扩展 `removeCourse` 快照范围至 `['courses', 'grades', 'tasks', 'courseLogs', 'courseExceptions']`，扩展 `removeSemester` 至 `['semesters', 'currentSemesterId', 'courses', 'grades', 'courseLogs']`，并补齐 `removeNote`、`removeDiary`、`removeLedger` 快照目标。

## 二、五大改进方向落地
1. **导出 / 打印全面适配 Android WebView**：
   - `assets/js/save-file.js`、`assets/js/white-paper.js`、`assets/js/views/grades.js`、`assets/js/views/ledger.js`：白皮书 PNG 长图支持应用内高清长按保存/系统分享；成绩单与账本报表在 WebView 拦截 `window.open` 时自动弹出应用内排版预览，支持一键导出独立 HTML 或调用系统打印。
2. **原生系统闹钟提醒闭环**：
   - `assets/js/remind.js` & `assets/js/app.js`：将作业截止提醒 ID 从 `2000+` 修正至 `1000+` 段（对齐原生 `NotifyPlugin.cancelAll()` 的 `1000..1200` 清理范围）；`lastNativeKey` 纳入提醒内容签名并在 `Store.subscribe` 中防抖自动同步。
3. **跨年自定义法定节假日 / 调休补班管理**：
   - `assets/js/holidays-cn.js` & `assets/js/views/settings.js`：支持用户在「设置 → 作息与显示」中自由添加、删除任意年份的放假或调休补班日期，实时合入课表角标与调休横幅。
4. **桌面小组件双通道合并与 14 天快照扩展**：
   - `assets/js/store.js` & `DataBridge.kt`：合并冗余双通道写入，快照新增未来 14 天完整日程映射，原生层改为包级广播一次唤醒全部尺寸小组件。
5. **瘦身构建产物（移除冗余 Debug 副本）**：
   - 移除 Release APK 资产目录中未使用的 `index.debug.html` 与 `build-meta.json`，减小安装包体积。

## 三、四款多尺寸桌面小组件（1×2 / 2×2 / 1×4 / 2×4）
- **1×2 迷你胶囊 (`CourseWidgetProv1x2A`, 110dp×40dp)**：紧凑显示当前/下节课状态与最近待办/考试倒计时胶囊。
- **2×2 紧凑方卡 (`CourseWidgetProv2x2B`, 110dp×110dp)**：适合与其它图标混排，展示今日课程精简列表与底部待办/考试提醒。
- **1×4 横向通栏 (`CourseWidgetProv1x4C`, 250dp×40dp)**：适合桌面顶部/底部通栏摆放，展示今日课程与待办速览。
- **2×4 完整看板 (`CourseWidgetProvider`, 250dp×110dp)**：完整展示今日全部课程时间线、教室、状态及底部待办/考试倒计时卡片。
- **设置内可视化预览中心**：在「设置 → 桌面小组件」中内置 1×2、2×2、1×4、2×4 四款小组件实时数据预览与一键强制同步按钮。
