# v1.4.3 更新说明（2026-10-30）

本版做四件事：今日出门清单、通知点开直达对应页面、备份写到系统下载目录、发布流程收口。

## 1. 今日出门清单

- 新增 `assets/js/packing.js`（纯函数，只读 Store）。
- 今日页在「今日要点」下方生成一张「🎒 今天带什么」卡片：
  - 当天每门课 → 《课程名》教材 / 讲义（超过 4 门合并成「其余 N 门课的讲义」）
  - 课程名含「实验 / 实训」→ 实验报告 / 实验服
  - 课程名含「体育 / 体测 / 游泳」→ 运动鞋 / 水
  - 当天到期的待办 → 「交：XXX」
  - 当天有考试 → 学生证 / 准考证
  - 有课或有 DDL 时补一条「校园卡 / 水杯」；空白天不出现
- 右上角「复制清单」一键复制成待办式文本；不联网、不写数据。
- 单测覆盖：空白天为空、教材、DDL、基础项、去重、实验课、复制格式。

## 2. 通知点开直达对应页面

- 上课提醒 → 点开进「课程表」；待办到期 → 点开进「待办」。
- 链路：`remind.js` 给每条提醒带 `route` → `NotifyScheduler` 写进闹钟 extras → 通知的 contentIntent 带 `cp_route` → `MainActivity.applyRoute()` 在 WebView 就绪后执行 `App.go(route)`。
- 已打开 App 时走 `onNewIntent`，不会重启页面；路由只放行 `[a-z]{1,20}`，不拼任意字符串进 JS。

## 3. 备份写到系统下载目录

- 新增原生插件 `BackupExportPlugin`（`saveToDownloads`）：
  - Android 10+ 用 MediaStore 写入 `下载/CoursePlanner/course-planner-YYYY-MM-DD.json`，**不需要存储权限**；
  - Android 9 及以下退回 App 专属外部目录。
- 设置 → 数据管理新增「存到手机下载目录」按钮（仅 App 内显示）。
- 今日页已有的「🛡️ 数据防丢提醒」在 App 内改为**一键直接导出**（原来只是跳设置页）。
- 导出后调用 `Store.markBackupExported()`，备份健康度与提醒周期继续生效。

## 4. 发布流程收口

- `versionName` 改为直接读 `package.json`；`versionCode` 由 semver 推导（1.4.3 → 10403），只增不减。
- CI（`.github/workflows/android-apk.yml`）不再「没有 keystore 就现生成一把」——那会让每次构建签名都不同、覆盖升级永远失败。
  现在只从 Secrets 还原：`ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD`。
- CI 构建后强制 `apksigner verify`，并校验 APK 的 `versionName` 与 `package.json` 一致，不一致直接失败。
- 没配 Secret 时只产出 debug 包，产物名明确写 `debug-not-upgradeable`。

## 验证

- 单测 **1224 通过 / 0 失败**
- ESLint 0 错误
- `assembleRelease` 成功：`versionCode 10403` / `versionName 1.4.3`，证书指纹不变
- 浏览器实测：载入示例课表后，「今天带什么」正确列出教材与校园卡
