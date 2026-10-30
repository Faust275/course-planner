# v1.4.11 更新说明（2026-10-30）

## Store 拆分：奖励域 + 备份域 + 导入导出域

`store.js` 从 11,846 行降到 **6,318 行**（-47%）。本轮新增三个域：

| 文件 | 负责 | 行数 |
|---|---|---|
| `store-reward.js` | 番茄钟积分、商城、抽卡、种树、成就 | 1,740 |
| `store-backup.js` | 自动备份、每日快照、裁剪、小组件快照 | 410 |
| `store-io.js` | 导出 / 导入 / 差异预览 / 重置 | 335 |

做法与前面一致：`Object.assign(Store, {...})`，对外 API 不变；内部工具从 `Store._ctx` 取。

新增两个约定：

- 域模块里**不能直接给 `state` 赋值**（`Store.state` 只有 getter），需要整体换状态时调 `ctx.setState(next)`
  和 `ctx.defaultState()`。
- 对象字面量里的 `state:` 键在机械拆分时容易被误改，拆分脚本已注意，后续手拆也要检查。

当前域分布：

| 文件 | 行数 |
|---|---|
| `store.js` | 6,318 |
| `store-reward.js` | 1,740 |
| `store-course.js` | 1,251 |
| `store-health.js` | 1,139 |
| `store-ledger.js` | 630 |
| `store-backup.js` | 410 |
| `store-tasks.js` | 340 |
| `store-io.js` | 333 |
| `attendance.js` | 102 |

还剩「计划与目标」与统计胶水（约 1,000 行）。

## 顺手修的一个 Windows 构建问题

- `build.py` 开头把 stdout/stderr 切到 UTF-8：Windows 默认 GBK 控制台遇到特殊符号会直接
  `UnicodeEncodeError` 中断构建（本轮就踩到了）。

## 验证

- 单测 **1267 通过 / 0 失败**（守卫测试新增三个域文件与 <7,000 行断言）
- ESLint 0 错误
- 浏览器实测：专注页（积分/森林）、收集页、设置·数据管理、统计页、今日页均无控制台报错
