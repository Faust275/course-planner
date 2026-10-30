# v1.4.12 更新说明（2026-10-30）

## Store 拆分收官：计划与目标 + 统计聚合

| 文件 | 负责 | 行数 |
|---|---|---|
| `store-plans.js`（新） | 计划、打卡、目标、KR 结算、rangeStat | 963 |
| `store-stats.js`（新） | 月复盘健康段、24 小时统计、健康聚合 | 288 |

`store.js` 从 **11,846 行降到 5,160 行（-56%）**，现在只剩：
状态与 getter、持久化、迁移、校验、设置、日记/标签、各类联动入口。

## 拆分时踩到并修掉的两个坑

1. **`get settings()` 差点被搬走**：它是 Store 对象里的一个 getter，位置恰好在统计段开头，
   机械切块把它带进了 `store-stats.js`，导致 `Object.assign` 时读取 getter、`state` 还是 null，直接崩。
   已搬回 `store.js`，并新增守卫测试（`Store.settings / semester / pomodoro` 三个 getter）。
2. **`state:` 对象键被误替换**：拆分脚本把 `\bstate\b` 全量替换成 `Store.state`，
   把小组件快照里的 `{ state: 'none' }` 改成了 `{ Store.state: 'none' }`（语法错误）。已修。
3. **`_ctx` 重复键**：`goalActive / krProgress` 被加了两次，ESLint 的 `no-dupe-keys` 抓到，已去重。

## 验证

- 单测 **1274 通过 / 0 失败**（新增 3 条 getter 守卫 + 2 个域文件断言）
- ESLint 0 错误
- 浏览器实测：统计页、计划页、今日页、待办页、设置页均无控制台报错

## 至此拆分完成度

| 文件 | 行数 |
|---|---|
| `store.js` | 5,160 |
| `store-planner.js` | 1,957 |
| `store-reward.js` | 1,740 |
| `store-course.js` | 1,251 |
| `store-health.js` | 1,139 |
| `store-plans.js` | 963 |
| `store-ledger.js` | 630 |
| `store-backup.js` | 410 |
| `store-presets.js` | 341 |
| `store-tasks.js` | 340 |
| `store-io.js` | 333 |
| `store-stats.js` | 288 |
| `attendance.js` | 102 |
