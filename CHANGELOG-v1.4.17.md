# v1.4.17 文档与配置同步（2026-11-02）

本版无功能改动，只把文档、配置与版本元数据对齐到当前真实状态。

## 1. 文档数字同步
- 单测：**1294 通过 / 0 失败**（此前文档误写为 1259 / 1292）。
- e2e：**83 个 `verify_*.mjs` 全过**（此前误写为 81）。
- 构建产物：`index.html` 约 **1.7 MB**（此前误写为 2.0 MB / 2100KB）。
- 受影响文件：`START-HERE.md`、`HANDOFF.md`。

## 2. 系统级通知：标记已完成
- `NotifyPlugin.kt` + `AlarmManager` + `NotifyReceiver` 已实现上课/待办到点系统通知（含开机/覆盖安装重排），`remind.js` 也已接入原生调度。
- `START-HERE.md`、`HANDOFF.md` 中「系统级通知 ❌ 未做」更正为已实现，并从 HANDOFF 待办清单移除该条（此前误当成未完成）。
- 清理 `remind.js` 头部「为什么不做定时通知」的旧注释，改为说明 PWA 网页侧与 Capacitor App 侧两条提醒通路的真实边界。

## 3. 配置与元数据
- 删除废弃的 `.eslintignore`：ESLint 9 已不再读取该文件，其规则已在 `eslint.config.mjs` 的 `ignores` 中等价存在；删除后不再有 deprecation 警告。
- `ci.yml`：`npm install` 改为 `npm ci`（仓库已有 `package-lock.json`），可复现性更强。
- 修正 `package-lock.json` 滞后的 `version` 字段：`1.4.1` → `1.4.17`。
