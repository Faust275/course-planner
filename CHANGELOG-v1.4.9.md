# v1.4.9 更新说明（2026-10-30）

## 1. 专注页去掉「累计获得」

- 概览卡片由 4 格降到 3 格：可用积分 / 合成玉、累计专注、森林（或已获得干员）。
- `pm.earned` 仍在数据里（奖励结算要用），只是不再展示，避免首页、专注页到处是「累计获得多少分」。

## 2. 指纹解锁备份密码（App 内）

- 设置 → 数据管理 → 文件备份新增一行「🔒 指纹解锁备份密码」：
  - 未启用时显示「用指纹保存密码」：先输入一次备份密码，指纹确认后存进 Android Keystore；
  - 已启用后，导出 / 导入加密备份时直接弹指纹，不用每次输密码；
  - 可随时「清除」。
- 实现：`VaultPlugin`（平台 `BiometricPrompt`，API 28+，不引入 androidx.biometric 依赖）
  + Keystore 认证型 AES 密钥（`setUserAuthenticationRequired(true)`、`setInvalidatedByBiometricEnrollment(true)`）。
- 换机、删除指纹、重录指纹都会让本机保存的密码失效；此时导出/导入会退回手动输入密码，文件本身不受影响。
- 不支持指纹/面容或未设锁屏的设备，这一行会显示原因并置灰，不影响普通密码加密。

## 验证

- 单测 **1259 通过 / 0 失败**（新增 Vault 方法契约与注册断言）
- ESLint 0 错误
- `assembleRelease` 编译通过（含新 Kotlin 插件）
