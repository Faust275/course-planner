# v1.4.10 更新说明（2026-10-30）

## 1. Store 拆分：课程域

- 新增 `assets/js/store-course.js`（1,241 行）：学期、周次、课程 CRUD、单次调课例外。
- `store.js` 从 9,922 行降到 **8,706 行**（原始 11,846）。
- 仍走 `Object.assign(Store, {...})`，对外 API 不变；新增 `Store._ctx` 暴露
  `normSlot / holidayPaused / buildCourseExamSlots / normCourseExamsInput / extractValidExams / pickPrimaryExam / COLORS` 等内部工具。
- 守卫测试更新：三个域文件必须存在且走 Object.assign，`store.js` 行数必须 < 9,000。

当前拆分进度：

| 文件 | 行数 |
|---|---|
| `store.js`（核心） | 8,706 |
| `store-course.js` | 1,241 |
| `store-health.js` | 1,139 |
| `store-ledger.js` | 630 |
| `store-tasks.js` | 340 |
| `attendance.js` | 102 |

还剩：奖励域（积分/商城/种树）、计划与目标、核心里的备份与导出导入。

## 2. 架构文档

- `HANDOFF.md` 新增 §2.0「Store 已拆成核心 + 域模块」：目录表、`Store._ctx` 约定、
  新增域模块的 5 步做法（含「必须加进 initTestStore」这个坑）。
- 新增 §6.0「GitHub Actions 签名 Secrets」。

## 3. 新手教程加入权限引导

- 第 5 步「把数据保住」新增一个按钮「开启通知与后台权限」（仅 App 内显示）：
  一次点击先申请通知权限，再跳到系统「电池优化」列表，把本应用设为不限制后台。
- 原生新增 `NotifyPlugin.openBatterySettings()`：优先打开电池优化列表，个别 ROM 没有该页面时退回应用详情页。
- 设置 → 提醒 的原生通知卡片也补了「后台白名单」按钮，教程看完也能找到。

## 4. CI 签名 Secrets 工具

- 新增 `tools/ci-secrets.mjs`：读取 keystore，打印 base64 与四条 `gh secret set` 命令，
  省得手动 base64、手动复制四个值。
- 输出含真实密钥，只在本机终端看，不要贴到聊天或 issue。

## 验证

- 单测 **1261 通过 / 0 失败**
- ESLint 0 错误
- `assembleRelease` 成功（含 `openBatterySettings`），`apksigner verify` 通过
- 浏览器实测：载入示例课表后课表表格、今日课程、考勤按钮均正常，无控制台报错
