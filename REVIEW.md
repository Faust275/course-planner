# 代码审查报告（course-planner-web）

> 生成时间：2026-10-22
> 范围：导出/同步、备份导入、抽卡、签到摸鱼券、全局下载实现
> 状态：**方案已实施**（2026-10-22 开工，见 ROADMAP §十四；P1 修复、统一保存通道、同步重构、死代码清理均已完成并通过回归）

---

## 零、实施结果（2026-10-22）

| 项 | 落地情况 | 验证 |
|---|---|---|
| P1 导出"如实反馈" | 备份导出改走 `SaveFile.save`，分享取消不再谎报成功、下载/WebView 弹诚实兜底面板 | `verify_backup.mjs` / `verify_export.mjs` 通过 |
| 统一保存通道 | 新增 `assets/js/save-file.js`（`SaveFile.save`：picker→share→download→复制兜底），5 处重复下载统一收敛 | `verify_ics.mjs` / `verify_sync_ui.mjs` 通过 |
| 同步重构（JSON 文件取代分片同步码） | 删除 base64 分片整套（packSync/splitSyncCode/joinSyncParts 等约 150 行），改为导出 .json + 复制文本兜底；保留旧 CP1R/CP1G 解码兼容 | `verify_sync.mjs` / `verify_sync_scope.mjs` / `verify_sync_ui.mjs` / `verify_diary.mjs` 通过 |
| 死代码/冗余清理 | 删 `settleCard` 旧别名、`ticketInfo` 的 `makeUp`、`exportJSON` lite 重复清空行 | `tests/run.mjs` 582 条全过 |
| 导入崩溃修复（前序） | importJSON 打底覆盖 + mergeShop + 失败回滚 | `verify_backup.mjs` 通过 |

> 注：本轮**未发布**（本地领先远程 10+ 提交），也未对 WorkBuddy 内置浏览器做适配（按约定用本地 html 测试）。



---

## 一、P1：导出"如实反馈"修复方案（上轮遗留）

`assets/js/views/settings.js` 的 `exportData()`（1847–1899）仍有两处问题：

| 问题 | 位置 | 现状 |
|---|---|---|
| 取消分享被当失败 | `:1861-1862` | `share().catch(download)` —— 用户点分享面板「取消」(AbortError) 也转去下载并提示"备份已导出" |
| 下载未落地也报成功 | `:1876-1894` | `download()` 永远 toast"备份已导出" + 弹窗"已存到浏览器的下载目录"，iOS PWA/部分 WebView 里 `a[download]` 静默无文件也照报成功 |

**改法（仅动 `exportData` + `saveSyncFile`）**：
1. `share` 的 `.catch` 区分 `AbortError`（用户取消→仅轻提示"已取消"，**不**转下载）与真错误（才回落）；
2. `download()` 弹窗改写为"备份已生成 + 复制内容 + 尝试存为文件 + 平台引导"，**不再无条件下"已保存"**；按 UA 分支写文案（iOS Safari「文件 App→下载」/ Android「文件管理→Download」/ 桌面「下载目录」）；
3. `saveSyncFile()`（:2122）同样把"文件已保存"改为诚实反馈 + 复制兜底。

> 成绩单/提醒/.ics/课表 PNG 四处是同一套 `a[download]`，问题同源，但 P1 先只动用户最常点的备份+同步码两处，统一重构放优化项。

---

## 二、代码审查：矛盾与冗余

| 严重 | 位置 | 问题 | 性质 |
|---|---|---|---|
| 🔴 | `store.js:3689` | `settleCard()` 无任何调用方，是重构为 `settleCardFor` 后残留的**死代码** | 冗余/死代码 |
| 🔴 | `grades.js:438` vs `remind.js:286` | 两个同名 `downloadText`，**参数顺序相反**（一个 `name,text,mime`，一个 `text,filename,mime`），加 settings 内联 2 处、schedule-export 1 处，共 **5 处重复下载实现** | 冗余+易错 |
| 🟡 | `store.js:5903` | `exportJSON('full')` 直接 `JSON.stringify(state)`，把明文密钥（asr.apiKey/apiSecret、ocr.apiKey）、1.3MB 背景图、桌宠素材全带进**文件备份** | 与 `:5911-5913` 同步码主动脱敏**意图矛盾** |
| 🟡 | `store.js:5938-5939` | lite 分支重复清空 `background.dataUrl`/`pet.src`（`:5909-5910` 已清；且 `pet` 不在 lite 的 `keep` 名单，5939 是**死代码**) | 冗余 |
| 🟡 | `store.js:3780` | `ticketInfo()` 仍返回 `makeUp` 别名，视图已无人消费 | 兼容壳残留 |
| 🟢 | `store.js` `mergeShop` vs `ensure()` | 两者都补 shop 子键（双保险） | 可接受，建议加注释说明分工 |

**一致性健康检查（无问题）**：无 `console.log`/debugger 残留、无 TODO/FIXME、无测试数据泄漏、已删「新手池」无残留、`.modal-wrap` 选择器已全部修正、`/workspace/index.html` 与 git HEAD 完全一致。

---

## 三、优化评估

| 优先级 | 项 | 收益 | 状态 |
|---|---|---|---|
| **高** | **统一保存通道**：抽 `SaveFile.save(name, content, opts)`（picker→share→下载→复制兜底），5 处共用 | 直接消 P1 同源 bug + 消 5 处冗余 + 修签名不一致 | ✅ 已实施（`assets/js/save-file.js`，挂 `window.SaveFile`） |
| **中** | **拆分 `ensure()`**：一次性 `migrate()`（仅在 version/model 不符时跑旧树迁移、课程 v2 合并、学期迁移）+ 热路径 `ensure()` 只做字段补齐 | 当前每次启动都整份 state 走几十个 `if (!x)` + forEach 迁移，大状态有成本 | ⬜ 未做（本次未涉及） |
| **中** | **`exportJSON` full 脱敏**：文件备份也剥离密钥（或文档明示"文件在你自己手里故保留"） | 消除与同步码的自相矛盾 | ✅ 已明确：文件备份保留密钥（信任模型——文件在用户自己手里）；同步文件走不可控中转故脱敏 |
| **低** | 删死代码 `settleCard`、去掉 `makeUp` 别名、`exportJSON` lite 重复清空行 | 减体积、降维护噪音 | ✅ `settleCard` 旧别名与 `makeUp` 已删；`exportJSON` lite 重复清空行已清 |

---

## 四、待确认问题

1. P1 是否按上面方案只动 `exportData`+`saveSyncFile`（其余 4 处下载列入"统一保存通道"一起重构），还是 P1 就顺手把 5 处全统一？
2. 文件备份的**明文密钥**怎么处理：① 也脱敏（与同步码一致，最干净）；② 保留（理由：本地文件自己保管）？
3. 同步码是否改为"全部用 JSON 文件备份同步"（见对话讨论：可行，但需保留弱网/WebView 下的文本兜底，且同步文件应沿用脱敏）。
4. 「主动脱敏」的信任模型：不可控通道（剪贴板/聊天）脱敏、可控通道（本地文件）不脱敏——若改用文件同步，需重新决定密钥是否随文件外传。
